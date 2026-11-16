(() => {
    const GRID_SIZE = window.TowerDefenceLevels.SIZE;
    const levels = window.TowerDefenceLevels;
    const waveRules = window.TowerDefenceWaves;
    const combat = window.TowerDefenceCombat;
    const upgradeRules = window.TowerDefenceUpgrades;
    const modeRules = window.TowerDefenceModes;
    const progression = window.TowerDefenceProgression;
    const matchProgress = progression.create();
    const DATA_ROOT = '../../data/minigames/tower-defence/';
    const HIT_FLASH_DURATION = 0.1;
    const DEFEAT_FADE_DURATION = 0.3;
    const board = document.getElementById('board');
    const tools = document.getElementById('tower-tools');
    const status = document.getElementById('status');
    const count = document.getElementById('tower-count');
    const name = document.getElementById('tower-name');
    const description = document.getElementById('tower-description');
    const attributes = document.getElementById('tower-attributes');
    const note = document.getElementById('tower-note');
    const editor = document.getElementById('level-editor');
    const editorStatus = document.getElementById('editor-status');
    const levelCode = document.getElementById('level-code');
    const enemyLayer = document.getElementById('enemy-layer');
    const projectileLayer = document.getElementById('projectile-layer');
    const reticle = document.getElementById('tower-reticle');
    const targeting = document.getElementById('tower-targeting');
    const targetMode = document.getElementById('target-mode');
    const targetModeLabel = document.getElementById('target-mode-label');
    const upgrades = document.getElementById('tower-upgrades');
    const upgradePanel = document.getElementById('upgrade-panel');
    const bitsDisplay = document.getElementById('bits');
    const butterDisplay = document.getElementById('butter');
    const butterIcon = document.getElementById('butter-icon');
    const waveStatus = document.getElementById('wave-status');
    const modeSelect = document.getElementById('game-mode');
    const modeDescription = document.getElementById('mode-description');
    const ratingStatus = document.getElementById('rating-status');
    const seedInput = document.getElementById('wave-seed');
    const startWaves = document.getElementById('start-waves');
    const resetWaves = document.getElementById('reset-waves');
    const cells = [];
    let towers = [];
    let selected = 0;
    let placed = 0;
    let path = [];
    let draft = null;
    let drawing = false;
    let waves = [];
    let waveIndex = 0;
    let waveRunning = false;
    let waveFrame = null;
    let waveTime = 0;
    let lastFrameTime = null;
    let waveEnemies = [];
    let waveSeed = null;
    let pauseUntil = null;
    let waveButterAward = 0;
    const enemyElements = new Map();
    const placedTowers = new Map();
    let inspectedTower = null;
    let hoveredCell = null;
    let focusedCell = null;
    let projectiles = [];
    let effects = [];
    let economy;
    let gameModes = [];
    let gameMode;
    let modeLocked = false;
    let bits = 0;
    let butter = 0;
    const rewardedEnemies = new Set();
    const rewardedWaves = new Set();
    const ratedWaves = new Set();
    let ranked = true;
    let ratingQueue = Promise.resolve();

    function recordAchievements(ids) {
        if (!ids.length || window.parent === window) return;
        const recorder = window.parent.achievements?.recordGameEvent;
        if (typeof recorder !== 'function') {
            console.error('Tower Defence achievement tracker is unavailable.');
            return;
        }
        ids.forEach(id => recorder('tower-defence', 'achievement', { id }).catch(error => {
            console.error('Could not record Tower Defence achievement.', error);
            ratingStatus.textContent = 'Could not save an achievement. Check your connection.';
        }));
    }

    async function showRating() {
        if (window.parent === window) {
            ratingStatus.textContent = 'Elo: open from the site to save.';
            return;
        }
        const ratings = window.parent.gameRatings;
        if (!ratings) throw new Error('Game rating tracker is unavailable.');
        if (!await ratings.signedIn()) {
            ratingStatus.textContent = 'Elo: sign in to save.';
            return;
        }
        const rating = await ratings.get('tower-defence');
        ratingStatus.textContent = ranked ? `Elo ${rating}` : `Elo ${rating} · custom path, unranked`;
    }

    function rateWave(number, perfect) {
        if (!ranked || ratedWaves.has(number)) return;
        ratedWaves.add(number);
        ratingQueue = ratingQueue.then(async () => {
            if (window.parent === window || !await window.parent.gameRatings.signedIn()) return;
            const ratings = window.parent.gameRatings;
            const current = await ratings.get('tower-defence');
            const delta = progression.ratingDelta(current, number, perfect);
            const updated = await ratings.adjust('tower-defence', delta);
            ratingStatus.textContent = `Elo ${updated} (${delta >= 0 ? '+' : ''}${delta})`;
        }).catch(error => {
            console.error('Could not update Tower Defence Elo.', error);
            ratingStatus.textContent = 'Could not save Elo. Check your connection.';
        });
    }
    const reticlePixel = new Image();
    reticlePixel.onload = () => renderReticle();
    reticlePixel.onerror = () => {
        console.error('Could not load the tower range reticle.');
        status.textContent = 'Could not load the range reticle. Please reload the game.';
    };
    reticlePixel.src = '../../assets/minigames/tower-defence/recticle.png';

    async function readJson(path) {
        const response = await fetch(`${DATA_ROOT}${path}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not load tower data: ${path} (${response.status})`);
        return response.json();
    }

    async function loadTowers() {
        const index = await readJson('index.json');
        if (!Array.isArray(index) || !index.length || index.some(item =>
            !item || typeof item.id !== 'string' || !/^[a-z0-9_]+$/.test(item.id)
            || !Number.isInteger(item.sprite) || item.sprite < 0 || item.sprite > 4)
            || new Set(index.map(item => item.id)).size !== index.length) {
            throw new Error('Invalid tower index.');
        }
        return Promise.all(index.map(async item => {
            const data = await readJson(`${item.id}.json`);
            if (!combat.settings[item.id] || !data || ['name', 'description', 'note', 'category'].some(key =>
                typeof data[key] !== 'string' || !data[key].trim())
                || ['damage', 'cost'].some(key => typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0)
                || (item.id === 'muffin' && (!Number.isFinite(data.blockSeconds) || data.blockSeconds <= 0))) {
                throw new Error(`Invalid tower data: ${item.id}.json`);
            }
            return { ...data, id: item.id, sprite: item.sprite };
        }));
    }

    function upgradeValue(tower, id, fallback) {
        const level = tower.levels[id] || 0;
        return level ? upgradeRules.value(economy.upgrades[id], level, fallback) : fallback;
    }

    function towerStats(type) {
        return modeRules.stats(gameMode, towers[type], combat.settings[towers[type].id]);
    }

    function showMode() {
        modeDescription.textContent = `${gameMode.description} ${modeLocked ? 'Reload to change.' : 'Locks on build/start.'}`;
        modeSelect.querySelectorAll('button').forEach(button => {
            button.disabled = modeLocked;
            button.setAttribute('aria-pressed', String(button.dataset.mode === gameMode.id));
        });
        enemyLayer.style.setProperty('--enemy-sprite', `url("../../assets/minigames/tower-defence/enemies/${gameMode.id}.png")`);
        enemyLayer.style.setProperty('--enemy-animation-duration', `${0.4 / gameMode.enemySpeed}s`);
    }

    function lockMode() {
        modeLocked = true;
        showMode();
    }

    function updateCurrency() {
        bitsDisplay.textContent = String(bits);
        butterDisplay.textContent = String(butter);
        if (inspectedTower !== null && placedTowers.has(inspectedTower)) renderUpgrades();
    }

    function renderUpgrades() {
        const tower = placedTowers.get(inspectedTower);
        const focused = upgrades.contains(document.activeElement) ? document.activeElement.dataset.upgrade : null;
        upgrades.replaceChildren();
        if (!tower) return;
        tower.choices.forEach(id => {
            const upgrade = economy.upgrades[id];
            const level = tower.levels[id] || 0;
            const next = upgradeRules.next(economy, id, level);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'upgrade-button';
            button.dataset.upgrade = id;
            button.disabled = !Number.isSafeInteger(next.cost) || butter < next.cost;
            const title = document.createElement('span');
            title.className = 'upgrade-name';
            title.textContent = `${upgrade.name} · ${upgradeRules.formatLevel(level)} → ${upgradeRules.formatLevel(level + 1)}`;
            const detail = document.createElement('span');
            detail.className = 'upgrade-description';
            const number = value => Number(value.toFixed(2)).toString();
            const valueText = ({
                damage: `${number(next.value)}× damage`,
                rate: `${number((1 - next.value) * 100)}% shorter cooldown`,
                pierce: `${number(next.value)} enemies per shot on average`,
                range: `${number((next.value - 1) * 100)}% more range`,
                speed: `${number((next.value - 1) * 100)}% faster shots`,
                blast: `${number((next.value - 1) * 100)}% larger blast`,
                yield: `${number(next.value)} Bits per production`,
                productionRate: `${number((1 - next.value) * 100)}% shorter interval`,
                block: `${number(next.value)}× block duration`,
                waveBonus: `${number(next.value * 100)}% bonus Butter`
            })[id];
            detail.textContent = `${upgrade.description} Next: ${valueText}.`;
            const price = document.createElement('span');
            price.className = 'upgrade-cost';
            const icon = document.createElement('span');
            icon.className = 'currency-icon currency-butter';
            icon.setAttribute('aria-hidden', 'true');
            price.append(icon, document.createTextNode(`${next.cost} Butter${level === 10 ? ' · breakthrough' : ''}`));
            button.append(title, detail, price);
            button.addEventListener('click', () => {
                if (butter < next.cost) {
                    status.textContent = `Not enough Butter. ${next.cost} required.`;
                    return;
                }
                butter -= next.cost;
                tower.levels[id] = level + 1;
                recordAchievements(matchProgress.upgrade(level + 1));
                tower.choices = upgradeRules.choices(economy.towerUpgrades[tower.id], tower.choices);
                showDetails(towers[tower.type], tower);
                updateCurrency();
                renderReticle();
                status.textContent = `${upgrade.name} upgraded to level ${upgradeRules.formatLevel(level + 1)}.`;
            });
            upgrades.append(button);
        });
        if (focused) {
            const button = upgrades.querySelector(`[data-upgrade="${focused}"]`);
            if (button && !button.disabled) button.focus();
        }
    }

    function makePlacedTower(type, row, column) {
        return { id: towers[type].id, type, row, column, mode: 'first', nextShot: waveTime,
            nextIncome: waveTime + economy.muffinInterval / gameMode.towerSpeed, incomeRemainder: 0, levels: {},
            choices: upgradeRules.choices(economy.towerUpgrades[towers[type].id]) };
    }

    function sprite(tower, className = '') {
        const element = document.createElement('span');
        element.className = `tower-sprite ${className}`;
        element.style.backgroundPosition = `${tower.sprite * 25}% 0`;
        element.setAttribute('aria-hidden', 'true');
        return element;
    }

    function showDetails(tower, placedTower = null) {
        attributes.replaceChildren();
        if (!tower) {
            name.textContent = 'Remove tower';
            description.textContent = 'Select a tile to remove its tower.';
            note.textContent = '';
            return;
        }
        name.textContent = tower.name;
        description.textContent = tower.description;
        note.textContent = tower.note;
        const stats = modeRules.stats(gameMode, tower, combat.settings[tower.id]);
        const damage = stats.damage * (placedTower ? upgradeValue(placedTower, 'damage', 1) : 1);
        const reach = stats.range * (placedTower ? upgradeValue(placedTower, 'range', 1) : 1);
        const block = stats.block * (placedTower ? upgradeValue(placedTower, 'block', 1) : 1);
        const rangeOrBlock = tower.id === 'muffin'
            ? ['Block', `${Number(block.toFixed(2))}s`]
            : ['Range', Number(reach.toFixed(2))];
        [['Category', tower.category], ['Damage', tower.id === 'muffin' ? 'None' : Number(damage.toFixed(2))],
            rangeOrBlock, ['Cost', `${stats.cost} Bits`]].forEach(([label, value]) => {
            const term = document.createElement('dt');
            const detail = document.createElement('dd');
            term.textContent = label;
            detail.textContent = String(value);
            attributes.append(term, detail);
        });
    }

    function selectTool(id) {
        selected = id;
        inspectedTower = null;
        targeting.hidden = true;
        upgradePanel.hidden = true;
        tools.querySelectorAll('button').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.tool === String(id)));
        });
        showDetails(id === 'remove' ? null : towers[id]);
        cells.forEach(({ element, row, column }) => updateCell(element, row, column, element.dataset.tower));
        renderReticle();
        status.textContent = id === 'remove' ? 'Remove selected. Choose a tile.' : `${towers[id].name} selected. Choose a tile.`;
    }

    function updateCell(cell, row, column, towerId) {
        const tower = towerId === '' ? null : towers[Number(towerId)];
        const currentPath = draft || path;
        const pathIndex = currentPath.findIndex(point => point[0] === row && point[1] === column);
        const pathName = pathIndex < 0 ? '' : pathIndex === 0 ? 'start' : pathIndex === currentPath.length - 1 ? 'end' : 'path';
        cell.replaceChildren();
        cell.dataset.tower = towerId;
        cell.dataset.path = pathName;
        if (tower) cell.append(sprite(tower, 'placed-sprite'));
        if (selected !== 'remove' && (!pathName || towers[selected].id === 'muffin') && !draft && !tower) cell.append(sprite(towers[selected], 'preview-sprite'));
        if (pathName === 'start' || pathName === 'end') {
            const marker = document.createElement('span');
            marker.className = 'path-marker';
            marker.textContent = pathName === 'start' ? 'S' : 'E';
            marker.setAttribute('aria-hidden', 'true');
            cell.append(marker);
        }
        cell.setAttribute('aria-label', `Row ${row + 1}, column ${column + 1}: ${tower ? `${tower.name}${pathName ? ` on ${pathName}` : ''}` : pathName || 'empty'}`);
    }

    function renderBoard() {
        cells.forEach(({ element, row, column }) => updateCell(element, row, column, element.dataset.tower));
        renderReticle();
    }

    function renderReticle() {
        const index = hoveredCell ?? focusedCell ?? inspectedTower;
        const cell = cells[index];
        if (draft || !cell) {
            reticle.hidden = true;
            return;
        }
        const tower = placedTowers.get(index);
        const type = tower ? tower.type : selected;
        if (type === 'remove' || (cell.element.dataset.path && towers[type].id !== 'muffin')) {
            reticle.hidden = true;
            return;
        }
        const range = towerStats(type).range * (tower ? upgradeValue(tower, 'range', 1) : 1);
        const diameter = Math.max(1, range * 2);
        const size = reticle.parentElement.clientWidth;
        const pixels = Math.max(1, Math.ceil(size / 3));
        reticle.width = pixels;
        reticle.height = pixels;
        reticle.style.width = `${pixels * 3}px`;
        reticle.style.height = `${pixels * 3}px`;
        const context = reticle.getContext('2d');
        const centerX = (cell.column + 0.5) * size / (3 * GRID_SIZE);
        const centerY = (cell.row + 0.5) * size / (3 * GRID_SIZE);
        const radius = diameter * size / (6 * GRID_SIZE);
        if (reticlePixel.complete && reticlePixel.naturalWidth) {
            for (let y = 0; y < pixels; y++) {
                for (let x = 0; x < pixels; x++) {
                    if (Math.abs(Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY) - radius) <= 0.5) {
                        context.drawImage(reticlePixel, x, y, 1, 1);
                    }
                }
            }
        }
        reticle.hidden = false;
    }

    function appendPath(row, column) {
        const cell = cells[row * GRID_SIZE + column].element;
        if (cell.dataset.tower !== '') {
            editorStatus.textContent = 'Remove the tower before drawing a path on this tile.';
            return;
        }
        const last = draft[draft.length - 1];
        if (last && last[0] === row && last[1] === column) return;
        const previous = draft[draft.length - 2];
        if (previous && previous[0] === row && previous[1] === column) {
            draft.pop();
        } else if (draft.some(point => point[0] === row && point[1] === column)) {
            editorStatus.textContent = 'A path cannot cross itself.';
            return;
        } else if (last && Math.abs(last[0] - row) + Math.abs(last[1] - column) !== 1) {
            editorStatus.textContent = 'Choose a horizontally or vertically adjacent tile.';
            return;
        } else {
            draft.push([row, column]);
        }
        editorStatus.textContent = `${draft.length} path tiles.`;
        levelCode.value = '';
        renderBoard();
    }

    function applyPath(next) {
        if (waveRunning) throw new Error('Reset waves before changing the path.');
        const validated = levels.validate(next);
        if (validated.some(([row, column]) => {
            const tower = placedTowers.get(row * GRID_SIZE + column);
            return tower && tower.id !== 'muffin';
        })) {
            throw new Error('Remove non-muffin towers from the new path first.');
        }
        path = validated;
        ranked = false;
        showRating().catch(error => {
            console.error('Could not load Tower Defence Elo.', error);
            ratingStatus.textContent = 'Could not load Elo.';
        });
        draft = null;
        drawing = false;
        editor.hidden = true;
        board.classList.remove('is-editing');
        renderBoard();
        return levels.encode(path);
    }

    function enableEditor() {
        if (waveRunning) throw new Error('Reset waves before editing the path.');
        draft = [];
        drawing = false;
        editor.hidden = false;
        board.classList.add('is-editing');
        levelCode.value = '';
        editorStatus.textContent = 'Draw a path from start to end.';
        renderBoard();
    }

    function updateCount() {
        count.textContent = `${placed} ${placed === 1 ? 'tower' : 'towers'}`;
    }

    function clearEnemies() {
        enemyElements.clear();
        enemyLayer.replaceChildren();
    }

    function resetWaveState() {
        waveRunning = false;
        if (waveFrame !== null) cancelAnimationFrame(waveFrame);
        waveFrame = null;
        waveIndex = 0;
        waveTime = 0;
        lastFrameTime = null;
        pauseUntil = null;
        waveButterAward = 0;
        waveEnemies = [];
        clearEnemies();
        projectiles = [];
        effects = [];
        projectileLayer.replaceChildren();
        placedTowers.forEach(tower => { tower.nextShot = 0; tower.nextIncome = economy.muffinInterval / gameMode.towerSpeed; delete tower.blockUntil; });
        startWaves.disabled = false;
        resetWaves.disabled = true;
        waveStatus.textContent = 'Endless waves ready.';
    }

    function renderEnemies(visible) {
        const present = new Set(visible.map(enemy => enemy.id));
        enemyElements.forEach((element, id) => {
            if (!present.has(id)) {
                element.remove();
                enemyElements.delete(id);
            }
        });
        visible.forEach(enemy => {
            let element = enemyElements.get(enemy.id);
            if (!element) {
                element = document.createElement('span');
                element.className = 'enemy-sprite';
                element.style.width = `${enemy.size * 100 / GRID_SIZE}%`;
                const art = document.createElement('span');
                art.className = 'enemy-art';
                art.style.backgroundPositionX = `${enemy.sprite * 25}%`;
                const health = document.createElement('span');
                health.className = 'enemy-health';
                element.append(art, health);
                enemyLayer.append(element);
                enemyElements.set(enemy.id, element);
            }
            const art = element.firstChild;
            const health = element.lastChild;
            const defeated = enemy.hp <= 0;
            art.style.filter = defeated || waveTime - enemy.hitAt < HIT_FLASH_DURATION ? 'brightness(0) invert(1)' : '';
            art.style.opacity = defeated ? String(Math.max(0, 1 - (waveTime - enemy.defeatedAt) / DEFEAT_FADE_DURATION)) : '';
            health.hidden = defeated;
            health.style.width = `${enemy.hp / enemy.maxHp * 100}%`;
            element.style.left = `${(enemy.column + 0.5) * 100 / GRID_SIZE}%`;
            element.style.top = `${(enemy.row + 0.5) * 100 / GRID_SIZE}%`;
        });
    }

    function inspectTower(index) {
        inspectedTower = index;
        const tower = placedTowers.get(index);
        showDetails(towers[tower.type], tower);
        targeting.hidden = false;
        upgradePanel.hidden = false;
        targetMode.value = tower.mode;
        targetMode.hidden = tower.id === 'muffin';
        targetModeLabel.hidden = tower.id === 'muffin';
        renderUpgrades();
        renderReticle();
        status.textContent = `Selected ${towers[tower.type].name} at row ${tower.row + 1}, column ${tower.column + 1}.`;
    }

    function clearCombatVisuals() {
        projectiles = [];
        effects = [];
        projectileLayer.replaceChildren();
    }

    function renderCombat() {
        projectileLayer.replaceChildren();
        [...projectiles, ...effects].forEach(item => {
            const element = document.createElement('span');
            element.className = `combat-sprite combat-${item.kind}`;
            element.style.left = `${(item.column + 0.5) * 100 / GRID_SIZE}%`;
            element.style.top = `${(item.row + 0.5) * 100 / GRID_SIZE}%`;
            if (item.kind === 'boomerang') {
                const frame = combat.boomerangFrame(item.age * gameMode.towerSpeed);
                element.style.backgroundPositionY = `${frame.row * 10 / 38 * 100}%`;
                element.style.transform = `translate(-50%, -50%) rotate(${frame.rotation}deg)`;
            } else if (item.kind === 'toast') {
                element.style.backgroundPositionY = `${Math.min(2, Math.floor(item.age / 0.12)) * 20}%`;
            } else if (item.kind === 'explosion') {
                element.style.backgroundPositionY = `${Math.min(2, Math.floor(item.age / 0.12)) * 50}%`;
            } else if (item.kind === 'crumb') {
                element.style.top = `${(item.row + 0.5 + item.age * 0.65) * 100 / GRID_SIZE}%`;
            } else if (item.kind === 'dust') {
                element.style.left = `${(item.column + 0.5 + item.age * item.dx) * 100 / GRID_SIZE}%`;
                element.style.top = `${(item.row + 0.5 + item.age * item.dy) * 100 / GRID_SIZE}%`;
                element.style.opacity = String(Math.max(0, 1 - item.age / item.duration));
            } else if (item.kind === 'bit') {
                element.style.top = `${(item.row + 0.5 - item.age * 1.2) * 100 / GRID_SIZE}%`;
                element.style.opacity = String(Math.max(0, 1 - item.age / item.duration));
                const icon = document.createElement('span');
                icon.className = 'currency-icon currency-bit';
                element.append(icon, document.createTextNode(`+${item.amount}`));
            }
            projectileLayer.append(element);
        });
    }

    function advanceCombat(enemies, delta) {
        effects.forEach(effect => { effect.age += delta; });
        effects = effects.filter(effect => effect.age < effect.duration);
        projectiles.forEach(shot => {
            shot.age += delta;
            if (shot.kind === 'boomerang') {
                combat.advanceBoomerang(shot, enemies, delta);
                return;
            }
            if (shot.hitEnemies) {
                combat.advancePiercingShot(shot, enemies, delta);
                return;
            }
            const target = enemies.find(enemy => enemy.id === shot.target && enemy.hp > 0);
            if (!target) {
                shot.done = true;
                return;
            }
            const distance = Math.hypot(target.row - shot.row, target.column - shot.column);
            if (distance <= shot.speed * delta) {
                combat.impact(shot, target, enemies);
                shot.done = true;
                return;
            }
            shot.row += (target.row - shot.row) / distance * shot.speed * delta;
            shot.column += (target.column - shot.column) / distance * shot.speed * delta;
        });
        projectiles = projectiles.filter(shot => !shot.done);
        placedTowers.forEach(tower => {
            const config = combat.settings[tower.id];
            const stats = towerStats(tower.type);
            if (tower.id === 'muffin' && waveTime >= tower.nextIncome) {
                const earned = tower.incomeRemainder + upgradeValue(tower, 'yield', 1);
                const whole = Math.floor(earned + 1e-9);
                tower.incomeRemainder = earned - whole;
                bits += whole;
                tower.nextIncome = waveTime + economy.muffinInterval / gameMode.towerSpeed * upgradeValue(tower, 'productionRate', 1);
                updateCurrency();
            }
            if (waveTime < tower.nextShot) return;
            if (tower.id === 'muffin') {
                for (let i = 0; i < 3; i++) effects.push({
                    kind: 'crumb', row: tower.row - i * 0.12, column: tower.column + (i - 1) * 0.22,
                    age: 0, duration: 0.65
                });
            } else {
                const reach = upgradeValue(tower, 'range', 1);
                const speed = upgradeValue(tower, 'speed', 1);
                const target = combat.chooseTarget(tower, enemies, tower.mode, stats.range * reach);
                if (!target) return;
                const damage = stats.damage * upgradeValue(tower, 'damage', 1);
                if (config.projectile === 'explosion') {
                    combat.impact({ damage, splash: stats.splash * upgradeValue(tower, 'blast', 1) }, target, enemies);
                    effects.push({ kind: 'explosion', row: target.row, column: target.column, age: 0, duration: 0.36 });
                } else if (config.projectile === 'boomerang') {
                    const shot = combat.createBoomerang(tower, target, damage, stats.range * reach);
                    shot.speed = stats.projectileSpeed * speed;
                    projectiles.push(shot);
                } else if (tower.levels.pierce || tower.id === 'toast') {
                    const average = upgradeValue(tower, 'pierce', 1);
                    const pierce = Math.floor(average) + (Math.random() < average % 1 ? 1 : 0);
                    projectiles.push(combat.createPiercingShot(tower, target,
                        { ...config, range: stats.range * reach, speed: stats.projectileSpeed * speed }, damage, pierce));
                } else {
                    projectiles.push({
                        kind: config.projectile, row: tower.row, column: tower.column,
                        target: target.id, speed: stats.projectileSpeed * speed, damage,
                        splash: config.splash, age: 0
                    });
                }
            }
            tower.nextShot = waveTime + stats.cooldown * upgradeValue(tower, tower.id === 'muffin' ? 'productionRate' : 'rate', 1);
        });
        renderCombat();
    }

    function startWave() {
        const wave = waveRules.generate(waves, waveSeed, waveIndex);
        waveButterAward = 0;
        waveEnemies = waveRules.schedule({
            ...wave,
            groups: wave.groups.map(group => ({
                ...group, speed: group.speed * gameMode.enemySpeed, interval: group.interval / gameMode.enemySpeed
            }))
        });
        waveEnemies.forEach(enemy => {
            enemy.maxHp = combat.hpBySprite[enemy.sprite] * wave.healthMultiplier;
            enemy.hp = enemy.maxHp;
        });
        placedTowers.forEach(tower => {
            tower.nextShot = 0;
            tower.nextIncome = economy.muffinInterval / gameMode.towerSpeed;
            delete tower.blockUntil;
        });
    }

    function advanceBlockers(previousTime) {
        const blockers = [];
        path.forEach(([row, column], pathIndex) => {
            const index = row * GRID_SIZE + column;
            const tower = placedTowers.get(index);
            if (tower && tower.id === 'muffin') blockers.push({
                index, pathIndex, tower, duration: towerStats(tower.type).block * upgradeValue(tower, 'block', 1)
            });
        });
        const duration = towers.find(tower => tower.id === 'muffin').blockSeconds;
        const expired = waveRules.blockEnemies(waveEnemies, path, blockers, previousTime, waveTime, duration);
        expired.forEach(({ index, tower }) => {
            placedTowers.delete(index);
            placed--;
            const cell = cells[index];
            updateCell(cell.element, cell.row, cell.column, '');
            if (inspectedTower === index) {
                inspectedTower = null;
                targeting.hidden = true;
                upgradePanel.hidden = true;
            }
            for (let i = 0; i < 7; i++) effects.push({
                kind: 'dust', row: tower.row, column: tower.column,
                dx: (i - 3) * 0.28, dy: -0.8 + Math.abs(i - 3) * 0.16,
                age: 0, duration: 0.5
            });
            updateCount();
            renderReticle();
            status.textContent = 'Muffin blocked the path and crumbled.';
        });
    }

    function tickWave(timestamp) {
        if (!waveRunning) return;
        const delta = lastFrameTime === null ? 0 : Math.min((timestamp - lastFrameTime) / 1000, 0.1);
        const previousTime = waveTime;
        waveTime += delta;
        lastFrameTime = timestamp;
        if (pauseUntil !== null) {
            if (waveTime >= pauseUntil) {
                waveIndex++;
                waveTime = 0;
                pauseUntil = null;
                startWave();
                clearCombatVisuals();
            }
        } else {
            advanceBlockers(previousTime);
            const result = waveRules.atTime(waveEnemies, path, waveTime);
            const byId = new Map(waveEnemies.map(enemy => [enemy.id, enemy]));
            const visible = result.visible.map(enemy => {
                const original = byId.get(enemy.id);
                original.row = enemy.row;
                original.column = enemy.column;
                original.progress = enemy.progress;
                return original;
            });
            const previousHealth = new Map(visible.map(enemy => [enemy.id, enemy.hp]));
            advanceCombat(visible, delta);
            visible.forEach(enemy => {
                if (enemy.hp < previousHealth.get(enemy.id)) {
                    enemy.hitAt = waveTime;
                    if (enemy.hp <= 0) {
                        enemy.defeatedAt = waveTime;
                        const rewardId = `${waveIndex}:${enemy.id}`;
                        if (!rewardedEnemies.has(rewardId)) {
                            rewardedEnemies.add(rewardId);
                            recordAchievements(matchProgress.kill());
                            bits += economy.bitsPerEnemy;
                            effects.push({ kind: 'bit', row: enemy.row, column: enemy.column,
                                age: 0, duration: 0.9, amount: economy.bitsPerEnemy });
                            updateCurrency();
                        }
                    }
                }
            });
            const fading = waveEnemies.filter(enemy => enemy.defeatedAt !== undefined
                && waveTime - enemy.defeatedAt < DEFEAT_FADE_DURATION);
            renderEnemies([...visible.filter(enemy => enemy.hp > 0), ...fading]);
            const remaining = waveRules.atTime(waveEnemies, path, waveTime).remaining;
            if (!remaining) {
                const bonus = [...placedTowers.values()].reduce((sum, tower) => sum + upgradeValue(tower, 'waveBonus', 0), 0);
                const reward = upgradeRules.waveReward(waveEnemies, waveIndex, rewardedWaves, economy, bonus);
                if (reward > 0) {
                    rewardedWaves.add(waveIndex);
                    butter += reward;
                    waveButterAward = reward;
                    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                        butterIcon.getAnimations().forEach(animation => animation.cancel());
                        butterIcon.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.7)' }, { transform: 'scale(1)' }],
                            { duration: 450, easing: 'ease-out' });
                    }
                    updateCurrency();
                }
            }
            waveStatus.textContent = `Wave ${waveIndex + 1} · ${remaining} remaining`;
            if (!remaining && !fading.length && !effects.some(effect => ['explosion', 'dust', 'bit'].includes(effect.kind))
                && ![...placedTowers.values()].some(tower => tower.blockUntil !== undefined)
                && !projectiles.some(shot => shot.kind === 'boomerang')) {
                clearCombatVisuals();
                pauseUntil = waveTime + 1.5;
                const perfect = !waveEnemies.some(enemy => enemy.hp > 0);
                recordAchievements(matchProgress.wave(waveIndex + 1, perfect, gameMode.id));
                rateWave(waveIndex + 1, perfect);
                const outcome = !perfect ? 'enemies escaped; no Butter'
                    : waveButterAward ? `+${waveButterAward} Butter` : 'Butter already claimed';
                waveStatus.textContent = `Wave ${waveIndex + 1} complete · ${outcome}. Next wave incoming.`;
            }
        }
        waveFrame = requestAnimationFrame(tickWave);
    }

    function initialize() {
        new ResizeObserver(renderReticle).observe(reticle.parentElement);
        gameModes.forEach((mode, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mode-button';
            button.dataset.mode = mode.id;
            button.title = mode.name;
            button.setAttribute('aria-label', mode.name);
            const icon = document.createElement('span');
            icon.className = 'mode-icon';
            icon.style.backgroundPositionX = `${-24 * index}px`;
            icon.setAttribute('aria-hidden', 'true');
            button.append(icon);
            button.addEventListener('click', () => {
                if (modeLocked) return;
                gameMode = mode;
                showMode();
                showDetails(selected === 'remove' ? null : towers[selected]);
                renderReticle();
            });
            modeSelect.append(button);
        });
        showMode();
        towers.forEach((tower, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tool';
            button.dataset.tool = String(index);
            button.setAttribute('aria-label', tower.name);
            button.title = tower.name;
            button.setAttribute('aria-pressed', String(index === selected));
            button.append(sprite(tower));
            button.addEventListener('click', () => selectTool(index));
            tools.append(button);
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'tool remove-tool';
        remove.dataset.tool = 'remove';
        remove.setAttribute('aria-pressed', 'false');
        remove.setAttribute('aria-label', 'Remove tower');
        remove.title = 'Remove tower';
        remove.textContent = '×';
        remove.addEventListener('click', () => selectTool('remove'));
        tools.append(remove);

        for (let row = 0; row < GRID_SIZE; row++) {
            for (let column = 0; column < GRID_SIZE; column++) {
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = `cell square ${(row + column) % 2 === 0 ? 'light' : 'dark'}`;
                updateCell(cell, row, column, '');
                cell.addEventListener('pointerdown', event => {
                    if (!draft || event.button !== 0) return;
                    event.preventDefault();
                    drawing = true;
                    appendPath(row, column);
                });
                cell.addEventListener('pointerenter', () => {
                    if (draft && drawing) appendPath(row, column);
                });
                const index = row * GRID_SIZE + column;
                cell.addEventListener('pointerenter', event => {
                    if (event.pointerType === 'touch') return;
                    hoveredCell = index;
                    renderReticle();
                });
                cell.addEventListener('pointerleave', () => {
                    if (hoveredCell === index) hoveredCell = null;
                    renderReticle();
                });
                cell.addEventListener('focus', () => {
                    if (cell.matches(':focus-visible')) focusedCell = index;
                    renderReticle();
                });
                cell.addEventListener('blur', () => {
                    if (focusedCell === index) focusedCell = null;
                    renderReticle();
                });
                cell.addEventListener('click', event => {
                    if (draft) {
                        if (event.detail === 0) appendPath(row, column);
                        return;
                    }
                    if (cell.dataset.tower !== '' && selected !== 'remove') {
                        inspectTower(index);
                        return;
                    }
                    const hadTower = cell.dataset.tower !== '';
                    const nextTower = selected === 'remove' ? '' : String(selected);
                    if (cell.dataset.path && nextTower !== '' && towers[selected].id !== 'muffin') {
                        status.textContent = 'Only muffins can be placed on the path.';
                        return;
                    }
                    const cost = nextTower === '' ? 0 : towerStats(selected).cost;
                    if (nextTower !== '' && bits < cost) {
                        status.textContent = `Not enough Bits. ${cost} required.`;
                        return;
                    }
                    if (!hadTower && nextTower !== '') placed++;
                    if (hadTower && nextTower === '') placed--;
                    if (nextTower === '') {
                        placedTowers.delete(index);
                        if (inspectedTower === index) {
                            inspectedTower = null;
                            targeting.hidden = true;
                            upgradePanel.hidden = true;
                        }
                    } else {
                        lockMode();
                        bits -= cost;
                        placedTowers.set(index, makePlacedTower(selected, row, column));
                        recordAchievements(matchProgress.build(towers[selected].id));
                        updateCurrency();
                    }
                    updateCell(cell, row, column, nextTower);
                    if (nextTower !== '') inspectTower(index);
                    else renderReticle();
                    updateCount();
                    status.textContent = nextTower === ''
                        ? `Cleared row ${row + 1}, column ${column + 1}.`
                        : `Placed ${towers[selected].name} at row ${row + 1}, column ${column + 1}.`;
                });
                cells.push({ element: cell, row, column });
                board.append(cell);
            }
        }

        document.getElementById('clear-board').addEventListener('click', () => {
            placedTowers.clear();
            inspectedTower = null;
            targeting.hidden = true;
            upgradePanel.hidden = true;
            cells.forEach(({ element, row, column }) => updateCell(element, row, column, ''));
            renderReticle();
            placed = 0;
            updateCount();
            status.textContent = 'Board cleared.';
        });
        targetMode.addEventListener('change', () => {
            const tower = placedTowers.get(inspectedTower);
            if (!tower || !combat.modes.includes(targetMode.value)) {
                console.error('Cannot update the tower targeting mode.');
                status.textContent = 'Could not change targeting. Select a tower and try again.';
                return;
            }
            tower.mode = targetMode.value;
        });
        document.getElementById('remove-placed-tower').addEventListener('click', () => {
            if (!placedTowers.has(inspectedTower)) return;
            const index = inspectedTower;
            const cell = cells[index];
            placedTowers.delete(index);
            placed--;
            inspectedTower = null;
            targeting.hidden = true;
            upgradePanel.hidden = true;
            updateCell(cell.element, cell.row, cell.column, '');
            renderReticle();
            updateCount();
            status.textContent = 'Tower removed.';
        });
        document.getElementById('replace-placed-tower').addEventListener('click', () => {
            if (!placedTowers.has(inspectedTower)) return;
            if (selected === 'remove') {
                status.textContent = 'Select a tower tool before replacing.';
                return;
            }
            const index = inspectedTower;
            const cell = cells[index];
            if (cell.element.dataset.path && towers[selected].id !== 'muffin') {
                status.textContent = 'Only muffins can be placed on the path.';
                return;
            }
            const cost = towerStats(selected).cost;
            if (bits < cost) {
                status.textContent = `Not enough Bits. ${cost} required.`;
                return;
            }
            lockMode();
            bits -= cost;
            placedTowers.set(index, makePlacedTower(selected, cell.row, cell.column));
            recordAchievements(matchProgress.build(towers[selected].id));
            updateCurrency();
            updateCell(cell.element, cell.row, cell.column, String(selected));
            inspectTower(index);
            status.textContent = `Replaced tower with ${towers[selected].name}.`;
        });
        window.addEventListener('pointerup', () => { drawing = false; });
        window.addEventListener('pointercancel', () => { drawing = false; });
        window.addEventListener('blur', () => { drawing = false; });
        board.addEventListener('pointermove', event => {
            if (!draft || !drawing || event.pointerType !== 'touch') return;
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.cell');
            const index = cells.findIndex(cell => cell.element === target);
            if (index >= 0) appendPath(Math.floor(index / GRID_SIZE), index % GRID_SIZE);
        });
        document.getElementById('editor-undo').addEventListener('click', () => {
            draft.pop();
            levelCode.value = '';
            editorStatus.textContent = `${draft.length} path tiles.`;
            renderBoard();
        });
        document.getElementById('editor-clear').addEventListener('click', () => {
            draft = [];
            levelCode.value = '';
            editorStatus.textContent = 'Draw a path from start to end.';
            renderBoard();
        });
        document.getElementById('editor-cancel').addEventListener('click', () => {
            draft = null;
            drawing = false;
            editor.hidden = true;
            board.classList.remove('is-editing');
            renderBoard();
        });
        document.getElementById('editor-apply').addEventListener('click', () => {
            try {
                const encoded = applyPath(draft);
                draft = path.map(point => [...point]);
                board.classList.add('is-editing');
                levelCode.value = encoded;
                editor.hidden = false;
                editorStatus.textContent = 'Path applied. Copy the level string below.';
                status.textContent = 'Level path applied.';
                renderBoard();
            } catch (error) {
                editorStatus.textContent = error.message;
            }
        });
        startWaves.addEventListener('click', () => {
            if (draft) {
                waveStatus.textContent = 'Finish or cancel the level editor before starting waves.';
                return;
            }
            const seed = seedInput.value.trim();
            if (!seed) {
                waveStatus.textContent = 'Enter a wave seed before starting.';
                seedInput.focus();
                return;
            }
            if (waveSeed === null) {
                waveSeed = seed;
                seedInput.value = seed;
                seedInput.readOnly = true;
            }
            lockMode();
            waveRunning = true;
            waveIndex = 0;
            waveTime = 0;
            lastFrameTime = null;
            pauseUntil = null;
            startWave();
            startWaves.disabled = true;
            resetWaves.disabled = false;
            waveFrame = requestAnimationFrame(tickWave);
        });
        resetWaves.addEventListener('click', resetWaveState);
        window.towerDefence = {
            enableEditor,
            exportLevel: () => levels.encode(draft || path),
            loadLevel: value => {
                const encoded = applyPath(levels.decode(value));
                status.textContent = 'Level path loaded.';
                return encoded;
            }
        };
        showDetails(towers[selected]);
        seedInput.value = String(Math.floor(Math.random() * 4294967296));
        updateCurrency();
        showRating().catch(error => {
            console.error('Could not load Tower Defence Elo.', error);
            ratingStatus.textContent = 'Could not load Elo.';
        });
        status.textContent = `${towers[selected].name} selected. Choose a tile.`;
        resetWaveState();
    }

    Promise.all([loadTowers(), readJson('level.json'), readJson('waves.skvwmeta'), readJson('economy.json'), readJson('modes.json')]).then(([loaded, level, waveData, economyData, modeData]) => {
        path = levels.decode(level.path);
        waves = waveRules.validate(waveData);
        towers = loaded;
        economy = upgradeRules.validate(economyData, towers);
        gameModes = modeRules.validate(modeData);
        gameMode = gameModes.find(mode => mode.id === 'bob');
        bits = economy.startingBits;
        butter = economy.startingButter;
        initialize();
    }).catch(error => {
        console.error('Could not initialize Tower Defence.', error);
        name.textContent = 'Towers unavailable';
        description.textContent = 'Could not load the game data. Please reload the game.';
        status.textContent = 'Could not load game data.';
        waveStatus.textContent = 'Could not load enemy waves. Please reload the game.';
        document.getElementById('clear-board').disabled = true;
    });
})();
