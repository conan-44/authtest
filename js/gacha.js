(async () => {
    const button = document.getElementById('gachaDrawButton');
    const drawCount = document.getElementById('gachaDrawCount');
    const status = document.getElementById('gachaStatus');
    const dialog = document.getElementById('gachaDrawDialog');
    const resultsStatus = document.getElementById('gachaResultsStatus');
    const fragmentStatus = document.getElementById('gachaFragmentStatus');
    const soundStatus = document.getElementById('gachaSoundStatus');
    const closeDialog = document.getElementById('gachaCloseDialog');
    const results = document.getElementById('gachaResults');
    const inventory = document.getElementById('gachaInventory');
    const packsContainer = document.getElementById('gachaPacks');
    const selectedPackLabel = document.getElementById('gachaSelectedPack');
    const balanceLabel = document.getElementById('gachaBalance');
    const payment = document.getElementById('gachaPayment');
    const ticketChoice = document.getElementById('gachaTicketChoice');
    const ticketLabel = document.getElementById('gachaTicketLabel');
    const ticketColor = document.getElementById('gachaTicketColor');
    const claimTicket = document.getElementById('gachaClaimTicket');
    let rules;
    try {
        rules = await window.GachaRulesReady;
    } catch (error) {
        console.error('Could not load Gacha pack configuration.', error);
        status.textContent = `Could not load Gacha packs: ${error.message}`;
        balanceLabel.textContent = 'Gacha is unavailable.';
        return;
    }
    const { shards, fragments, packs, chances, drawBatch } = rules;
    const names = [...shards, ...fragments];
    const revealInterval = 20;
    let userId = null;
    let authGeneration = 0;
    let authReceived = false;
    let expectedUserId;
    let collection = null;
    let selectedPack = 'classic';
    let revealTimers = [];
    let economy = null;
    let busy = false;
    let refreshQueued = false;
    function ticketKey(id) { return `skvwaffle.gacha-tickets.v1:${id}`; }
    function loadTickets(id) {
        const saved = localStorage.getItem(ticketKey(id));
        if (!saved) return {
            version: 1, tickets: Object.fromEntries(packs.map(pack => [pack.id, 0])),
            claimed: [], dailyAt: 0, migrated: false, pending: null
        };
        const value = JSON.parse(saved);
        if (!value || value.version !== 1 || !value.tickets ||
            packs.some(pack => !Number.isSafeInteger(value.tickets[pack.id]) || value.tickets[pack.id] < 0) ||
            !Array.isArray(value.claimed) || !value.claimed.every(Number.isSafeInteger) ||
            !Number.isSafeInteger(value.dailyAt) || value.dailyAt < 0 || typeof value.migrated !== 'boolean' ||
            (value.pending !== null && (typeof value.pending !== 'object' || typeof value.pending.id !== 'string'))) {
            throw new Error('Your saved tickets have an invalid format.');
        }
        return value;
    }
    function saveTickets(id, value) { localStorage.setItem(ticketKey(id), JSON.stringify(value)); }
    function milestonesToClaim(value, claimed = economy?.claimed || []) {
        const points = window.achievements.getSummary().unlockedPoints;
        return window.achievements.getMilestones().filter(m =>
            points >= m.points && !value.claimed.includes(m.points) && !claimed.includes(m.points));
    }
    function renderEconomy() {
        if (!economy) {
            balanceLabel.textContent = 'Sign in to see orbs and tickets.';
            delete balanceLabel.dataset.balance;
            ticketChoice.hidden = true;
            window.dispatchEvent(new CustomEvent('gacha-ticket-availability', { detail: { available: false } }));
            return;
        }
        const makeBalance = (label, count, className) => {
            const item = document.createElement('div');
            item.className = `gacha-balance-item ${className}`;
            const name = document.createElement('span');
            name.className = 'gacha-balance-label';
            name.textContent = label;
            const value = document.createElement('strong');
            value.textContent = count.toLocaleString();
            item.append(name, value);
            return item;
        };
        const balanceKey = JSON.stringify([economy.orbs, ...packs.map(pack => economy.local.tickets[pack.id])]);
        if (balanceLabel.dataset.balance !== balanceKey) {
            balanceLabel.replaceChildren(
                makeBalance('Orbs', economy.orbs, 'gacha-balance-orbs'),
                ...packs.map(pack => makeBalance(`${pack.name} tickets`, economy.local.tickets[pack.id], `gacha-balance-${pack.id}`))
            );
            balanceLabel.dataset.balance = balanceKey;
        }
        const available = milestonesToClaim(economy.local);
        ticketChoice.hidden = !available.length;
        window.dispatchEvent(new CustomEvent('gacha-ticket-availability', { detail: { available: available.length > 0 } }));
        if (available.length) ticketLabel.textContent = `${available[0].name} milestone: choose a ticket (${available.length} available)`;
        updateDrawButton();
    }
    async function applyOperation(id, pending) {
        const { data, error } = await _supabase.rpc('gacha_apply', {
            p_user_id: id, p_operation_id: pending.id, p_kind: pending.kind, p_payload: pending.payload
        });
        if (error) {
            const failure = new Error(error.message);
            failure.code = error.code;
            throw failure;
        }
        return data;
    }
    async function syncEconomy(id) {
        const points = window.achievements.getSummary().unlockedPoints;
        if (!Number.isSafeInteger(points) || points < 0) throw new Error('Milestone progress is invalid.');
        const { data, error } = await _supabase.rpc('gacha_sync', { p_user_id: id, p_points: points });
        if (error) throw new Error(error.message);
        return data;
    }
    async function applyTicketClaim(id, pending) {
        const { milestone, color, points } = pending.payload;
        const { error } = await _supabase.rpc('gacha_claim_ticket', {
            p_user_id: id, p_operation_id: pending.id, p_milestone: milestone, p_color: color, p_points: points
        });
        if (error) {
            const failure = new Error(error.message);
            failure.code = error.code;
            throw failure;
        }
    }
    async function finishPending(id, local) {
        const pending = local.pending;
        if (pending.kind === 'daily') {
            const { data, error } = await _supabase.rpc('gacha_daily_ticket', { p_user_id: id, p_operation_id: pending.id });
            if (error) throw new Error(error.message);
            if (!data || !Number.isSafeInteger(data.granted) || data.granted < 0 ||
                !Number.isSafeInteger(data.next_at) || !Number.isSafeInteger(local.tickets.classic + data.granted)) {
                throw new Error('Daily ticket grant is invalid.');
            }
            local.tickets.classic += data.granted;
            local.dailyAt = data.next_at;
            if (data.granted > 0 && id === userId) {
                window.dispatchEvent(new CustomEvent('app-new-activity', { detail: { kind: 'gacha' } }));
            }
        } else if (pending.kind === 'ticket') {
            try {
                await applyTicketClaim(id, pending);
            } catch (error) {
                if (error.code === 'P0001' && error.message === 'Milestone ticket already claimed') {
                    local.pending = null;
                    saveTickets(id, local);
                }
                throw error;
            }
            const { milestone, color } = pending.payload;
            if (!['red', 'yellow', 'green', 'blue'].includes(color) || !Number.isSafeInteger(milestone)) {
                throw new Error('Pending ticket claim is invalid.');
            }
            if (!Number.isSafeInteger(local.tickets[color] + 1)) throw new Error('Ticket balance is too large.');
            local.tickets[color]++;
            local.claimed.push(milestone);
        } else {
            await applyOperation(id, pending);
            if (pending.kind === 'migration') local.migrated = true;
        }
        local.pending = null;
        saveTickets(id, local);
        return pending.kind;
    }
    function useServerState(data, local) {
        if (!data || !Number.isSafeInteger(data.orbs) || data.orbs < 0 ||
            !Array.isArray(data.claimed_milestones) || !data.claimed_milestones.every(Number.isSafeInteger) ||
            !data.collection || names.some(name => !Number.isSafeInteger(data.collection[name]) || data.collection[name] < 0)) {
            throw new Error('The saved Gacha balance has an invalid format.');
        }
        economy = { orbs: data.orbs, local, claimed: data.claimed_milestones };
        collection = Object.fromEntries(names.map(name => [name, data.collection[name]]));
        renderInventory();
        renderEconomy();
        updatePackRates();
    }
    async function locked(id, action) {
        if (!navigator.locks) throw new Error('This browser does not support safe ticket storage across tabs.');
        return navigator.locks.request(`skvwaffle-gacha:${id}`, action);
    }
    async function prepareEconomy(id) {
        let local = loadTickets(id);
        let recovered = false;
        if (local.pending) {
            recovered = await finishPending(id, local);
        }
        if (Date.now() >= local.dailyAt) {
            local.pending = { id: crypto.randomUUID(), kind: 'daily' };
            saveTickets(id, local);
            await finishPending(id, local);
        }
        if (!local.migrated) {
            const migrationKey = `skvwaffle.gacha-migration.v1:${id}`;
            const savedMigration = localStorage.getItem(migrationKey);
            const migration = savedMigration ? JSON.parse(savedMigration) : {
                id: crypto.randomUUID(), collection: loadCollection(id)
            };
            if (typeof migration.id !== 'string' || !migration.collection ||
                names.some(name => !Number.isSafeInteger(migration.collection[name]) || migration.collection[name] < 0)) {
                throw new Error('Your saved shard migration has an invalid format.');
            }
            if (!savedMigration) localStorage.setItem(migrationKey, JSON.stringify(migration));
            local.pending = { id: migration.id, kind: 'migration', payload: { collection: migration.collection } };
            saveTickets(id, local);
            await finishPending(id, local);
        }
        return { data: await syncEconomy(id), local, recovered };
    }

    function formatChance(value) {
        if (value === 0) return '0%';
        const percentage = value * 100;
        if (percentage < 0.001) return '<0.001%';
        return `${Number(percentage.toFixed(3))}%`;
    }

    const packCards = packs.map(pack => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'gacha-pack-card';
        const icon = document.createElement('span');
        icon.className = `gacha-pack-icon gacha-pack-icon-${pack.id}`;
        icon.setAttribute('aria-hidden', 'true');
        const title = document.createElement('span');
        title.className = 'gacha-pack-title';
        title.textContent = `${pack.name} pack`;
        const description = document.createElement('span');
        description.className = 'gacha-pack-description';
        description.textContent = `${pack.size} shards · ${pack.description}`;
        const price = document.createElement('span');
        price.className = 'gacha-pack-price';
        price.textContent = '20 orbs / 1 ticket';
        const rates = document.createElement('span');
        rates.className = 'gacha-pack-rates';
        rates.id = `gacha-pack-rates-${pack.id}`;
        rates.setAttribute('role', 'tooltip');
        card.setAttribute('aria-describedby', rates.id);
        card.append(icon, title, description, price);
        document.body.appendChild(rates);
        const showRates = () => {
            const rect = card.getBoundingClientRect();
            packCards.forEach(({ rates: otherRates }) => otherRates.classList.remove('is-visible'));
            rates.classList.add('is-visible');
            rates.style.setProperty('--gacha-rate-left', `${Math.max(8, Math.min(rect.left, window.innerWidth - rates.offsetWidth - 8))}px`);
            rates.style.setProperty('--gacha-rate-top', `${Math.max(8, Math.min(rect.top, window.innerHeight - rates.offsetHeight - 8))}px`);
        };
        const hideRates = () => rates.classList.remove('is-visible');
        card.addEventListener('pointerenter', event => {
            if (event.pointerType === 'mouse') showRates();
        });
        card.addEventListener('pointerleave', event => {
            if (event.pointerType === 'mouse' && document.activeElement !== card) hideRates();
        });
        card.addEventListener('focus', showRates);
        card.addEventListener('blur', hideRates);
        card.addEventListener('click', () => {
            selectedPack = pack.id;
            updatePackRates();
            showRates();
        });
        packsContainer.appendChild(card);
        return { pack, card, description, rates };
    });

    document.addEventListener('pointerdown', event => {
        if (!event.target.closest('.gacha-pack-card')) {
            packCards.forEach(({ rates }) => rates.classList.remove('is-visible'));
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') packCards.forEach(({ rates }) => rates.classList.remove('is-visible'));
    });
    document.addEventListener('scroll', () => {
        packCards.forEach(({ rates }) => rates.classList.remove('is-visible'));
    }, true);

    function updatePackSelection() {
        packCards.forEach(({ pack, card }) => card.setAttribute('aria-pressed', String(pack.id === selectedPack)));
        selectedPackLabel.textContent = `Selected pack: ${packs.find(pack => pack.id === selectedPack).name}`;
        updateDrawButton();
    }

    function updatePackRates() {
        const points = window.achievements.getSummary().unlockedPoints;
        const milestones = window.achievements.getMilestones();
        packCards.forEach(({ pack, card, description, rates }) => {
            card.disabled = !collection;
            if (!collection) rates.classList.remove('is-visible');
            if (!collection) {
                description.textContent = `${pack.size} shards · ${pack.description}`;
                rates.textContent = 'Sign in to see rates.';
                return;
            }
            const probabilities = chances(points, milestones, pack.id);
            let note = pack.description;
            if (pack.id === 'green' && probabilities.fragments[0] === 0) note = 'Fragments unlock at Mythical';
            if (pack.id === 'blue' && probabilities.shards[3] === 0) note = 'Platinum not yet available';
            if (pack.id === 'yellow' && probabilities.shards[1] === 0) note = 'Higher shards not yet available';
            description.textContent = `${pack.size} shards · ${note}`;
            rates.textContent = shards.map((name, index) =>
                `${name[0].toUpperCase()}${name.slice(1)} ${formatChance(probabilities.shards[index])}`
            ).join(' · ') + ` · Each fragment ${formatChance(probabilities.fragments[0])}`;
        });
        updatePackSelection();
    }

    function makeShard(name, count, grouped = false) {
        const card = document.createElement('div');
        card.className = 'gacha-shard-card';
        const sprite = document.createElement('span');
        sprite.className = `gacha-shard gacha-shard-${name}`;
        sprite.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        const title = `${name[0].toUpperCase()}${name.slice(1)}`;
        label.textContent = grouped
            ? `${title} x${count}`
            : count === undefined
                ? `${title} ${fragments.includes(name) ? 'fragment' : 'shard'}`
                : `${title} · ${count}`;
        card.append(sprite, label);
        return card;
    }

    function revealFragment(name, card) {
        if (!dialog.open || !card.isConnected) return;
        fragmentStatus.className = `gacha-fragment-status gacha-fragment-${name}`;
        fragmentStatus.textContent = `Found fragment: ${name[0].toUpperCase()}${name.slice(1)}!`;
        if (window.getAppSetting && !window.getAppSetting('audio', 'sound effects', true)) return;
        const audio = new Audio('./assets/audio/gacha.wav');
        audio.play().catch(error => {
            console.error('Could not play the Gacha fragment sound.', error);
            if (dialog.open && card.isConnected) soundStatus.textContent = 'Could not play the fragment sound.';
        });
    }

    function clearRevealTimers() {
        revealTimers.forEach(clearTimeout);
        revealTimers = [];
    }

    function renderInventory() {
        const shardLabel = document.createElement('span');
        shardLabel.className = 'gacha-inventory-label';
        shardLabel.textContent = 'Shards';
        const fragmentLabel = document.createElement('span');
        fragmentLabel.className = 'gacha-inventory-label';
        fragmentLabel.textContent = 'Fragments';
        inventory.replaceChildren(
            shardLabel,
            ...shards.map(name => makeShard(name, collection[name])),
            fragmentLabel,
            ...fragments.map(name => makeShard(name, collection[name]))
        );
    }

    function loadCollection(id) {
        const stored = localStorage.getItem(`skvwaffle.gacha-shards.v1:${id}`);
        if (!stored) return Object.fromEntries(names.map(name => [name, 0]));
        const value = JSON.parse(stored);
        if (!value || typeof value !== 'object' || names.some(name => !Number.isSafeInteger(value[name]) || value[name] < 0)) {
            throw new Error('Your saved shard collection has an invalid format.');
        }
        return Object.fromEntries(names.map(name => [name, value[name]]));
    }

    function randomValue() {
        if (!globalThis.crypto?.getRandomValues) throw new Error('Secure randomness is unavailable.');
        return crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
    }

    async function recordAchievements(currentCollection) {
        await window.achievements.recordGameEvent('main', 'gacha-collection', { collection: currentCollection });
    }

    async function setUser(id) {
        const generation = ++authGeneration;
        userId = id || null;
        collection = null;
        economy = null;
        renderEconomy();
        button.disabled = true;
        updatePackRates();
        clearRevealTimers();
        if (dialog.open) dialog.close();
        results.replaceChildren();
        fragmentStatus.textContent = '';
        soundStatus.textContent = '';
        inventory.replaceChildren();
        if (!userId) {
            status.textContent = 'Sign in to draw shards.';
            return;
        }
        status.textContent = 'Loading your milestones...';
        try {
            await window.achievements.loadAllFromDirectoryIndex();
            if (generation !== authGeneration) return;
            await window.achievements.loadUserProfile(id);
            if (generation !== authGeneration) return;
            chances(window.achievements.getSummary().unlockedPoints, window.achievements.getMilestones());
            const prepared = await locked(id, () => prepareEconomy(id));
            if (generation !== authGeneration) return;
            useServerState(prepared.data, prepared.local);
            try {
                await recordAchievements(collection);
                if (generation !== authGeneration) return;
                const refreshed = await locked(id, () => prepareEconomy(id));
                if (generation !== authGeneration) return;
                useServerState(refreshed.data, refreshed.local);
                status.textContent = prepared.recovered
                    ? 'Previous Gacha operation recovered. Choose a pack and payment method.'
                    : 'Choose a pack and payment method.';
            } catch (error) {
                if (generation !== authGeneration) return;
                console.error('Could not update Gacha achievements.', error);
                status.textContent = 'Could not update Gacha achievements. Draw again to retry.';
            }
            if (generation !== authGeneration) return;
            updateDrawButton();
        } catch (error) {
            if (generation !== authGeneration) return;
            console.error('Could not prepare shard draws.', error);
            status.textContent = `Could not prepare shard draws: ${error.message}`;
        }
    }

    button.addEventListener('click', async () => {
        if (!userId || !collection || !economy || busy) return;
        if (!drawCount.reportValidity()) return;
        const generation = authGeneration;
        const id = userId;
        const packId = selectedPack;
        const paymentMethod = payment.value;
        const numberOfDraws = drawCount.valueAsNumber;
        busy = true;
        button.disabled = true;
        let saved = false;
        try {
            const points = window.achievements.getSummary().unlockedPoints;
            const milestones = window.achievements.getMilestones();
            let drawn;
            const prepared = await locked(id, async () => {
                const existing = loadTickets(id);
                if (existing.pending) throw new Error('A previous operation needs recovery. Reopen Gacha to retry.');
                const current = await prepareEconomy(id);
                if (generation !== authGeneration) throw new Error('Account changed.');
                if (paymentMethod === 'tickets' && current.local.tickets[packId] < numberOfDraws) {
                    throw new Error(`Not enough ${packId} tickets.`);
                }
                if (paymentMethod === 'orbs' && current.data.orbs < 20 * numberOfDraws) {
                    throw new Error('Not enough orbs.');
                }
                drawn = drawBatch(numberOfDraws, points, milestones, randomValue, packId);
                const additions = Object.fromEntries(names.map(name => [name, 0]));
                drawn.forEach(name => { additions[name]++; });
                if (paymentMethod === 'tickets') current.local.tickets[packId] -= numberOfDraws;
                current.local.pending = {
                    id: crypto.randomUUID(), kind: 'draw',
                    payload: { pack: packId, count: numberOfDraws, payment: paymentMethod, collection: additions }
                };
                saveTickets(id, current.local);
                let data;
                try {
                    data = await applyOperation(id, current.local.pending);
                } catch (error) {
                    if (error.code === 'P0001' && error.message === 'Not enough orbs') {
                        current.local.pending = null;
                        saveTickets(id, current.local);
                    }
                    throw error;
                }
                current.local.pending = null;
                saveTickets(id, current.local);
                return { data, local: current.local };
            });
            saved = true;
            if (generation !== authGeneration) return;
            useServerState(prepared.data, prepared.local);
            clearRevealTimers();
            fragmentStatus.textContent = '';
            soundStatus.textContent = '';
            const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const grouped = numberOfDraws > 5;
            const entries = grouped
                ? Array.from(drawn.reduce((counts, name) => counts.set(name, (counts.get(name) || 0) + 1), new Map()),
                    ([name, count]) => ({ name, count }))
                : drawn.map(name => ({ name, count: 1 }));
            results.replaceChildren(...entries.map(({ name, count }, index) => {
                const card = makeShard(name, grouped ? count : undefined, grouped);
                card.style.setProperty('--reveal-delay', `${index * revealInterval}ms`);
                if (fragments.includes(name)) {
                    const message = document.createElement('span');
                    message.className = `gacha-fragment-message gacha-fragment-${name}`;
                    message.textContent = 'Found fragment!';
                    card.appendChild(message);
                }
                return card;
            }));
            const packName = packs.find(pack => pack.id === packId).name;
            status.textContent = `You drew ${drawn.length} shards from the ${packName} pack at ${points} points.`;
            resultsStatus.textContent = status.textContent;
            try {
                dialog.showModal();
                results.scrollTop = 0;
                entries.forEach(({ name, count }, index) => {
                    if (!fragments.includes(name)) return;
                    const card = results.children[index];
                    const reveal = () => {
                        for (let i = 0; i < count; i++) revealFragment(name, card);
                    };
                    if (reducedMotion) reveal();
                    else revealTimers.push(setTimeout(reveal, index * revealInterval));
                });
            } catch (error) {
                console.error('Could not display Gacha results.', error);
                status.textContent = `Shards saved, but results could not be displayed: ${error.message}`;
            }
            try {
                await recordAchievements(collection);
                if (generation === authGeneration) {
                    const refreshed = await locked(id, () => prepareEconomy(id));
                    if (generation === authGeneration) useServerState(refreshed.data, refreshed.local);
                }
            } catch (error) {
                console.error('Could not update Gacha achievements.', error);
                if (generation === authGeneration) {
                    status.textContent = 'Shards saved, but achievements could not be updated. Try again.';
                    resultsStatus.textContent = status.textContent;
                }
            }
        } catch (error) {
            console.error('Could not draw shards.', error);
            status.textContent = saved
                ? `Shards saved, but results could not be displayed: ${error.message}`
                : `Could not draw shards: ${error.message} Reopen Gacha to retry any pending operation.`;
        } finally {
            busy = false;
            updateDrawButton();
        }
    });

    function updateDrawButton() {
        const count = drawCount.valueAsNumber;
        const pack = packs.find(item => item.id === selectedPack);
        button.textContent = Number.isInteger(count) && count >= 1 && count <= 24
            ? `Draw ${count * pack.size} shards · ${payment.value === 'tickets' ? `${count} ticket${count === 1 ? '' : 's'}` : `${count * 20} orbs`}`
            : 'Draw shards';
        button.disabled = !collection || !economy || busy;
    }
    drawCount.addEventListener('input', updateDrawButton);
    payment.addEventListener('change', updateDrawButton);
    claimTicket.addEventListener('click', async () => {
        if (!userId || !economy || busy) return;
        const id = userId;
        const generation = authGeneration;
        busy = true;
        claimTicket.disabled = true;
        updateDrawButton();
        try {
            const prepared = await locked(id, async () => {
                const current = await prepareEconomy(id);
                if (generation !== authGeneration) throw new Error('Account changed.');
                const milestone = milestonesToClaim(current.local, current.data.claimed_milestones)[0];
                if (!milestone) throw new Error('No milestone ticket is available.');
                if (!['red', 'yellow', 'green', 'blue'].includes(ticketColor.value)) throw new Error('Choose a valid ticket.');
                current.local.pending = {
                    id: crypto.randomUUID(), kind: 'ticket',
                    payload: { milestone: milestone.points, color: ticketColor.value, points: window.achievements.getSummary().unlockedPoints }
                };
                saveTickets(id, current.local);
                await finishPending(id, current.local);
                return { data: await syncEconomy(id), local: current.local };
            });
            if (generation !== authGeneration) return;
            useServerState(prepared.data, prepared.local);
            status.textContent = 'Milestone ticket claimed.';
        } catch (error) {
            console.error('Could not claim the milestone ticket.', error);
            if (generation === authGeneration) status.textContent = `Could not claim ticket: ${error.message}`;
        } finally {
            busy = false;
            claimTicket.disabled = false;
            updateDrawButton();
        }
    });
    async function refreshEconomy() {
        if (!userId || !collection || busy || refreshQueued) return;
        const id = userId;
        const generation = authGeneration;
        refreshQueued = true;
        try {
            const prepared = await locked(id, () => prepareEconomy(id));
            if (generation === authGeneration) {
                useServerState(prepared.data, prepared.local);
                status.textContent = prepared.recovered
                    ? 'Previous Gacha operation recovered. Choose a pack and payment method.'
                    : 'Choose a pack and payment method.';
            }
        } catch (error) {
            console.error('Could not refresh Gacha economy.', error);
            if (generation === authGeneration) status.textContent = `Could not refresh Gacha economy: ${error.message}`;
        } finally {
            refreshQueued = false;
        }
    }
    closeDialog.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        if (!dialog.open) clearRevealTimers();
    });
    window.addEventListener('gacha-tab-opened', () => {
        if (collection) refreshEconomy();
        else if (userId) setUser(userId);
    });
    window.addEventListener('gacha-economy-refresh', refreshEconomy);
    window.addEventListener('focus', refreshEconomy);
    setInterval(refreshEconomy, 60000);
    updatePackRates();

    window.addEventListener('app-auth-state-changed', event => {
        authReceived = true;
        const id = event.detail?.userId || null;
        if (expectedUserId !== undefined && id !== expectedUserId) return;
        if (id !== userId || !collection) setUser(id);
    });
    window.addEventListener('home-dashboard-auth-changed', event => {
        authReceived = true;
        const id = event.detail?.userId || null;
        expectedUserId = id;
        if (id !== userId) setUser(null);
    });
    _supabase.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        if (!authReceived) setUser(data.session?.user?.id);
    }).catch(error => {
        console.error('Could not check sign-in for shard draws.', error);
        status.textContent = 'Could not check your sign-in for shard draws.';
    });
})();
