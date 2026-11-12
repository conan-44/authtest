(() => {
    const GRID_SIZE = window.TowerDefenceLevels.SIZE;
    const levels = window.TowerDefenceLevels;
    const waveRules = window.TowerDefenceWaves;
    const DATA_ROOT = '../../data/minigames/tower-defence/';
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
    const waveStatus = document.getElementById('wave-status');
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
    let pauseUntil = null;
    const enemyElements = new Map();

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
            if (!data || ['name', 'description', 'note', 'category'].some(key =>
                typeof data[key] !== 'string' || !data[key].trim())
                || ['damage', 'cost'].some(key => typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0)) {
                throw new Error(`Invalid tower data: ${item.id}.json`);
            }
            return { ...data, id: item.id, sprite: item.sprite };
        }));
    }

    function sprite(tower, className = '') {
        const element = document.createElement('span');
        element.className = `tower-sprite ${className}`;
        element.style.backgroundPosition = `${tower.sprite * 25}% 0`;
        element.setAttribute('aria-hidden', 'true');
        return element;
    }

    function showDetails(tower) {
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
        [['Category', tower.category], ['Damage', tower.damage], ['Cost', tower.cost]].forEach(([label, value]) => {
            const term = document.createElement('dt');
            const detail = document.createElement('dd');
            term.textContent = label;
            detail.textContent = String(value);
            attributes.append(term, detail);
        });
    }

    function selectTool(id) {
        selected = id;
        tools.querySelectorAll('button').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.tool === String(id)));
        });
        showDetails(id === 'remove' ? null : towers[id]);
        cells.forEach(({ element, row, column }) => updateCell(element, row, column, element.dataset.tower));
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
        if (selected !== 'remove' && !pathName && !draft) cell.append(sprite(towers[selected], 'preview-sprite'));
        if (pathName === 'start' || pathName === 'end') {
            const marker = document.createElement('span');
            marker.className = 'path-marker';
            marker.textContent = pathName === 'start' ? 'S' : 'E';
            marker.setAttribute('aria-hidden', 'true');
            cell.append(marker);
        }
        cell.setAttribute('aria-label', `Row ${row + 1}, column ${column + 1}: ${pathName || (tower ? tower.name : 'empty')}`);
    }

    function renderBoard() {
        cells.forEach(({ element, row, column }) => updateCell(element, row, column, element.dataset.tower));
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
        if (validated.some(([row, column]) => cells[row * GRID_SIZE + column].element.dataset.tower !== '')) {
            throw new Error('Remove towers from the new path first.');
        }
        path = validated;
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
        waveEnemies = [];
        clearEnemies();
        startWaves.disabled = false;
        resetWaves.disabled = true;
        waveStatus.textContent = `${waves.length} waves ready.`;
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
                element.style.backgroundPositionX = `${enemy.sprite * 25}%`;
                element.style.width = `${enemy.size * 100 / GRID_SIZE}%`;
                enemyLayer.append(element);
                enemyElements.set(enemy.id, element);
            }
            element.style.left = `${(enemy.column + 0.5) * 100 / GRID_SIZE}%`;
            element.style.top = `${(enemy.row + 0.5) * 100 / GRID_SIZE}%`;
        });
    }

    function tickWave(timestamp) {
        if (!waveRunning) return;
        if (lastFrameTime !== null) waveTime += Math.min((timestamp - lastFrameTime) / 1000, 0.1);
        lastFrameTime = timestamp;
        if (pauseUntil !== null) {
            if (waveTime >= pauseUntil) {
                waveIndex++;
                waveTime = 0;
                pauseUntil = null;
                waveEnemies = waveRules.schedule(waves[waveIndex]);
            }
        } else {
            const result = waveRules.atTime(waveEnemies, path, waveTime);
            renderEnemies(result.visible);
            waveStatus.textContent = `Wave ${waveIndex + 1} / ${waves.length} · ${result.remaining} remaining`;
            if (!result.remaining) {
                if (waveIndex === waves.length - 1) {
                    waveRunning = false;
                    waveFrame = null;
                    clearEnemies();
                    waveStatus.textContent = 'All waves complete. Reset to play again.';
                    return;
                }
                pauseUntil = waveTime + 1.5;
                waveStatus.textContent = `Wave ${waveIndex + 1} complete. Next wave incoming.`;
            }
        }
        waveFrame = requestAnimationFrame(tickWave);
    }

    function initialize() {
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
                cell.addEventListener('click', event => {
                    if (draft) {
                        if (event.detail === 0) appendPath(row, column);
                        return;
                    }
                    if (cell.dataset.path) {
                        status.textContent = 'Towers cannot be placed on the path.';
                        return;
                    }
                    const hadTower = cell.dataset.tower !== '';
                    const nextTower = selected === 'remove' ? '' : String(selected);
                    if (!hadTower && nextTower !== '') placed++;
                    if (hadTower && nextTower === '') placed--;
                    updateCell(cell, row, column, nextTower);
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
            cells.forEach(({ element, row, column }) => updateCell(element, row, column, ''));
            placed = 0;
            updateCount();
            status.textContent = 'Board cleared.';
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
            waveRunning = true;
            waveIndex = 0;
            waveTime = 0;
            lastFrameTime = null;
            pauseUntil = null;
            waveEnemies = waveRules.schedule(waves[0]);
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
        status.textContent = `${towers[selected].name} selected. Choose a tile.`;
        resetWaveState();
    }

    Promise.all([loadTowers(), readJson('level.json'), readJson('waves.skvwameta')]).then(([loaded, level, waveData]) => {
        path = levels.decode(level.path);
        waves = waveRules.validate(waveData);
        towers = loaded;
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
