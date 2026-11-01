(() => {
    const STORAGE_KEY = 'skvwaffle.streetfighter.characters.v1';
    const ACTIVE_STORAGE_KEY = 'skvwaffle.streetfighter.active-character.v1';
    const SHARE_PREFIX = 'sfchar1.';
    const SLOT_LIMIT = 20;
    const MAX_STAT_POINTS = 40;
    const statLimits = { health: 40, power: 40, crit: 20, speed: 20, debuff: 10 };
    const statNames = ['health', 'power', 'crit', 'speed', 'debuff'];
    const overlayCanvas = document.getElementById('characterOverlayCanvas');
    const hatCanvas = document.getElementById('characterHatCanvas');
    const overlayContext = overlayCanvas.getContext('2d');
    const hatContext = hatCanvas.getContext('2d');
    const roster = document.getElementById('characterRoster');
    const nameInput = document.getElementById('characterName');
    const attackTypeInput = document.getElementById('characterAttackType');
    const attackColorInput = document.getElementById('characterAttackColor');
    const hatColorInput = document.getElementById('characterHatColor');
    const shareCodeInput = document.getElementById('characterShareCode');
    const pointsSummary = document.getElementById('characterPointsSummary');
    const budgetSummary = document.getElementById('characterBudgetSummary');
    const status = document.getElementById('characterWorkshopStatus');
    const eraserButton = document.getElementById('characterEraserBtn');
    let budget = 10;
    let elo = 1000;
    let isEraserOn = false;
    let painting = false;
    let savedCharacters = loadCharacters();
    let active = loadActiveCharacter();
    let draft = structuredClone(active);

    function createCharacter(name = 'New Fighter') {
        return {
            version: 1,
            id: globalThis.crypto?.randomUUID?.() || `fighter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            stats: { health: 0, power: 0, crit: 0, speed: 0, debuff: 0 },
            attack: { type: 'beam', color: '#2a4d67', overlay: '0'.repeat(256) },
            hat: Array(32).fill('')
        };
    }

    function normalizeCharacter(value, maxPoints = MAX_STAT_POINTS) {
        if (!value || typeof value !== 'object' || value.version !== 1) return null;
        if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 24) return null;
        if (typeof value.id !== 'string' || value.id.length > 80) return null;
        if (!value.stats || typeof value.stats !== 'object') return null;
        const stats = {};
        for (const key of statNames) {
            const amount = value.stats[key];
            if (!Number.isInteger(amount) || amount < 0 || amount > statLimits[key]) return null;
            stats[key] = amount;
        }
        if (statNames.reduce((sum, key) => sum + stats[key], 0) > maxPoints) return null;
        if (!value.attack || !['beam', 'overlay'].includes(value.attack.type)
            || !/^#[\da-f]{6}$/i.test(value.attack.color)
            || typeof value.attack.overlay !== 'string'
            || !/^[01]{256}$/.test(value.attack.overlay)) return null;
        if (!Array.isArray(value.hat) || value.hat.length !== 32
            || value.hat.some(color => color !== '' && (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)))) {
            return null;
        }
        return {
            version: 1,
            id: value.id,
            name: value.name.trim(),
            stats,
            attack: {
                type: value.attack.type,
                color: value.attack.color.toLowerCase(),
                overlay: value.attack.overlay
            },
            hat: value.hat.map(color => color ? color.toLowerCase() : '')
        };
    }

    function loadCharacters() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            if (!Array.isArray(parsed)) throw new TypeError('Saved fighter data must be a list.');
            return parsed.slice(0, SLOT_LIMIT).map(character => normalizeCharacter(character)).filter(Boolean);
        } catch (error) {
            console.error('Could not load saved Street Fighter characters.', error);
            status.textContent = 'Saved characters could not be loaded from this device.';
            return [];
        }
    }

    function loadActiveCharacter() {
        try {
            const activeId = localStorage.getItem(ACTIVE_STORAGE_KEY);
            return savedCharacters.find(character => character.id === activeId) || createCharacter('Street Fighter');
        } catch (error) {
            console.error('Could not load the selected Street Fighter character.', error);
            return createCharacter('Street Fighter');
        }
    }

    function saveCharacters() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(savedCharacters));
        } catch (error) {
            console.error('Could not save Street Fighter characters.', error);
            throw new Error('Could not save characters on this device. Check local storage space and permissions.');
        }
    }

    function usedPoints(character = draft) {
        return statNames.reduce((sum, key) => sum + character.stats[key], 0);
    }

    function drawGrid(context, canvas, pixels, columns, rows, pixelColor = null) {
        const cellWidth = canvas.width / columns;
        const cellHeight = canvas.height / rows;
        context.clearRect(0, 0, canvas.width, canvas.height);
        pixels.forEach((value, index) => {
            const color = pixelColor ? (value ? pixelColor : '') : value;
            if (color) {
                context.fillStyle = color;
                context.fillRect((index % columns) * cellWidth, Math.floor(index / columns) * cellHeight, cellWidth, cellHeight);
            }
        });
        context.strokeStyle = 'rgba(24, 35, 44, 0.32)';
        context.lineWidth = 1;
        for (let x = 0; x <= columns; x += 1) {
            context.beginPath();
            context.moveTo(x * cellWidth + 0.5, 0);
            context.lineTo(x * cellWidth + 0.5, canvas.height);
            context.stroke();
        }
        for (let y = 0; y <= rows; y += 1) {
            context.beginPath();
            context.moveTo(0, y * cellHeight + 0.5);
            context.lineTo(canvas.width, y * cellHeight + 0.5);
            context.stroke();
        }
    }

    function drawEditors() {
        drawGrid(overlayContext, overlayCanvas, [...draft.attack.overlay].map(pixel => pixel === '1'), 16, 16, draft.attack.color);
        drawGrid(hatContext, hatCanvas, draft.hat, 8, 4);
    }

    function renderEditor() {
        nameInput.value = draft.name;
        attackTypeInput.value = draft.attack.type;
        attackColorInput.value = draft.attack.color;
        hatColorInput.value = draft.hat.find(Boolean) || '#f4a261';
        document.querySelectorAll('[data-character-stat]').forEach(input => {
            const key = input.dataset.characterStat;
            input.max = String(Math.min(budget, statLimits[key]));
            input.value = String(draft.stats[key]);
        });
        const used = usedPoints();
        pointsSummary.textContent = `${used} / ${budget} points used · ${Math.max(0, budget - used)} remaining`;
        budgetSummary.textContent = `ELO ${elo.toLocaleString()} · ${budget} stat points`;
        eraserButton.setAttribute('aria-pressed', String(isEraserOn));
        eraserButton.textContent = `Eraser: ${isEraserOn ? 'on' : 'off'}`;
        drawEditors();
        renderRoster();
    }

    function renderRoster() {
        roster.replaceChildren();
        savedCharacters.forEach(character => {
            const slot = document.createElement('div');
            slot.className = 'character-slot';
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('aria-pressed', String(character.id === active.id));
            const icon = document.createElement('canvas');
            icon.width = 32;
            icon.height = 16;
            const iconContext = icon.getContext('2d');
            drawGrid(iconContext, icon, character.hat, 8, 4);
            const label = document.createElement('span');
            label.textContent = character.name;
            button.append(icon, label);
            button.addEventListener('click', () => {
                draft = structuredClone(character);
                if (!canUseDraft()) {
                    status.textContent = 'This character exceeds your current ELO budget. Adjust stats before using it.';
                    renderEditor();
                    return;
                }
                applyDraft();
                status.textContent = `${active.name} selected.`;
                renderEditor();
            });
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'character-remove-button';
            removeButton.setAttribute('aria-label', `Delete ${character.name}`);
            removeButton.textContent = '×';
            removeButton.addEventListener('click', () => {
                savedCharacters = savedCharacters.filter(saved => saved.id !== character.id);
                try {
                    saveCharacters();
                    if (active.id === character.id) {
                        active = createCharacter('Street Fighter');
                        localStorage.removeItem(ACTIVE_STORAGE_KEY);
                        window.dispatchEvent(new CustomEvent('streetfighter-character-selected', {
                            detail: { character: structuredClone(active) }
                        }));
                    }
                    status.textContent = `${character.name} deleted.`;
                    renderRoster();
                } catch (error) {
                    status.textContent = error.message;
                }
            });
            slot.append(button, removeButton);
            roster.appendChild(slot);
        });
    }

    function canUseDraft() {
        return Boolean(normalizeCharacter(draft, budget));
    }

    function applyDraft() {
        const normalized = normalizeCharacter(draft, budget);
        if (!normalized) {
            status.textContent = `Spend no more than ${budget} stat points to use this character.`;
            return false;
        }
        active = normalized;
        try {
            localStorage.setItem(ACTIVE_STORAGE_KEY, active.id);
        } catch (error) {
            console.error('Could not save the selected Street Fighter character.', error);
            status.textContent = 'Character selected, but the selection could not be saved on this device.';
        }
        window.dispatchEvent(new CustomEvent('streetfighter-character-selected', {
            detail: { character: structuredClone(active) }
        }));
        return true;
    }

    function persistDraft() {
        const normalized = normalizeCharacter(draft, budget);
        if (!normalized) {
            status.textContent = `Spend no more than ${budget} stat points before saving.`;
            return;
        }
        const existingIndex = savedCharacters.findIndex(character => character.id === normalized.id);
        if (existingIndex < 0 && savedCharacters.length >= SLOT_LIMIT) {
            status.textContent = `All ${SLOT_LIMIT} character slots are full. Delete a saved character first.`;
            return;
        }
        if (existingIndex < 0) savedCharacters.push(normalized);
        else savedCharacters[existingIndex] = normalized;
        try {
            saveCharacters();
        } catch (error) {
            status.textContent = error.message;
            return;
        }
        draft = structuredClone(normalized);
        applyDraft();
        status.textContent = `Saved ${normalized.name} · ${savedCharacters.length}/${SLOT_LIMIT} slots used.`;
        renderEditor();
    }

    function encodeCharacter(character) {
        const bytes = new TextEncoder().encode(JSON.stringify(character));
        let binary = '';
        bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return SHARE_PREFIX + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    }

    function decodeCharacter(code) {
        if (typeof code !== 'string' || !code.startsWith(SHARE_PREFIX)) return null;
        const encoded = code.slice(SHARE_PREFIX.length).replaceAll('-', '+').replaceAll('_', '/');
        const binary = atob(encoded + '='.repeat((4 - encoded.length % 4) % 4));
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return normalizeCharacter(JSON.parse(new TextDecoder().decode(bytes)), budget);
    }

    function paintCanvas(canvas, columns, rows, paint) {
        canvas.addEventListener('pointerdown', event => {
            event.preventDefault();
            painting = true;
            canvas.setPointerCapture(event.pointerId);
            paint(event);
        });
        canvas.addEventListener('pointermove', event => {
            if (painting) paint(event);
        });
        const finish = () => { painting = false; };
        canvas.addEventListener('pointerup', finish);
        canvas.addEventListener('pointercancel', finish);
        canvas.addEventListener('lostpointercapture', finish);
        canvas.addEventListener('contextmenu', event => event.preventDefault());
        return event => {
            const rect = canvas.getBoundingClientRect();
            const column = Math.max(0, Math.min(columns - 1, Math.floor((event.clientX - rect.left) / rect.width * columns)));
            const row = Math.max(0, Math.min(rows - 1, Math.floor((event.clientY - rect.top) / rect.height * rows)));
            return row * columns + column;
        };
    }

    const overlayCellAt = paintCanvas(overlayCanvas, 16, 16, event => {
        const index = overlayCellAt(event);
        const pixels = [...draft.attack.overlay];
        pixels[index] = isEraserOn || event.button === 2 ? '0' : '1';
        draft.attack.overlay = pixels.join('');
        drawEditors();
    });

    const hatCellAt = paintCanvas(hatCanvas, 8, 4, event => {
        const index = hatCellAt(event);
        draft.hat[index] = isEraserOn || event.button === 2 ? '' : hatColorInput.value;
        drawEditors();
        renderRoster();
    });

    nameInput.addEventListener('input', () => {
        draft.name = nameInput.value.trim().slice(0, 24) || 'New Fighter';
    });
    attackTypeInput.addEventListener('change', () => { draft.attack.type = attackTypeInput.value; });
    attackColorInput.addEventListener('input', () => {
        draft.attack.color = attackColorInput.value;
        drawEditors();
    });
    hatColorInput.addEventListener('input', () => {
        if (isEraserOn) {
            isEraserOn = false;
            eraserButton.setAttribute('aria-pressed', 'false');
            eraserButton.textContent = 'Eraser: off';
        }
    });
    document.querySelectorAll('[data-character-stat]').forEach(input => {
        input.addEventListener('input', () => {
            const key = input.dataset.characterStat;
            const others = usedPoints() - draft.stats[key];
            const max = Math.min(budget - others, statLimits[key]);
            const value = Number(input.value);
            draft.stats[key] = Number.isInteger(value) ? Math.max(0, Math.min(max, value)) : 0;
            renderEditor();
        });
    });

    document.getElementById('newCharacterBtn').addEventListener('click', () => {
        draft = createCharacter();
        status.textContent = 'New character draft ready.';
        renderEditor();
    });
    document.getElementById('saveCharacterBtn').addEventListener('click', persistDraft);
    document.getElementById('useCharacterBtn').addEventListener('click', () => {
        if (applyDraft()) {
            status.textContent = `${active.name} is ready for battle.`;
            renderEditor();
        }
    });
    eraserButton.addEventListener('click', () => {
        isEraserOn = !isEraserOn;
        renderEditor();
    });
    document.getElementById('copyCharacterCodeBtn').addEventListener('click', async () => {
        const normalized = normalizeCharacter(draft, budget);
        if (!normalized) {
            status.textContent = `Spend no more than ${budget} stat points before sharing.`;
            return;
        }
        const code = encodeCharacter(normalized);
        shareCodeInput.value = code;
        try {
            await navigator.clipboard.writeText(code);
            status.textContent = 'Share code copied. Send it to another player to import.';
        } catch (error) {
            console.warn('Could not copy the character share code.', error);
            status.textContent = 'Share code created below. Select and copy it to share.';
            shareCodeInput.focus();
            shareCodeInput.select();
        }
    });
    document.getElementById('importCharacterCodeBtn').addEventListener('click', () => {
        try {
            const character = decodeCharacter(shareCodeInput.value.trim());
            if (!character) throw new TypeError('The share code is invalid or exceeds your ELO stat budget.');
            draft = character;
            applyDraft();
            renderEditor();
            status.textContent = `${character.name} imported. Save or use this character.`;
        } catch (error) {
            console.error('Could not import Street Fighter character.', error);
            status.textContent = error.message || 'Could not import this character code.';
        }
    });

    async function loadRatingBudget() {
        try {
            const ratings = window.parent?.gameRatings;
            if (typeof ratings?.get === 'function') elo = await ratings.get('streetfighter');
            if (!Number.isSafeInteger(elo) || elo < 0) throw new TypeError('The Street Fighter ELO rating is invalid.');
            budget = Math.max(4, Math.min(MAX_STAT_POINTS, Math.floor(elo / 100)));
            if (!normalizeCharacter(active, budget)) {
                active = createCharacter('Street Fighter');
                draft = structuredClone(active);
                localStorage.removeItem(ACTIVE_STORAGE_KEY);
                status.textContent = 'Your selected character exceeds your current ELO budget. Choose another or lower its stats.';
            } else {
                draft = structuredClone(active);
            }
            renderEditor();
            window.dispatchEvent(new CustomEvent('streetfighter-character-selected', {
                detail: { character: structuredClone(active) }
            }));
        } catch (error) {
            console.error('Could not load the Street Fighter ELO stat budget.', error);
            status.textContent = 'Could not verify ELO. Using the default 1000 ELO stat budget.';
            renderEditor();
        }
    }

    window.StreetFighterCharacters = {
        getSelected: () => structuredClone(active),
        getDefault: () => createCharacter('Street Fighter'),
        normalize: normalizeCharacter,
        budgetForElo: rating => Math.max(4, Math.min(MAX_STAT_POINTS, Math.floor(rating / 100))),
        isWithinBudget: (character, maxPoints = budget) => Boolean(normalizeCharacter(character, maxPoints)),
        ready: null
    };

    renderEditor();
    window.StreetFighterCharacters.ready = loadRatingBudget();
})();
