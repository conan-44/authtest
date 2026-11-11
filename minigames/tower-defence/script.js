(() => {
    const GRID_SIZE = 12;
    const DATA_ROOT = '../../data/minigames/tower-defence/';
    const board = document.getElementById('board');
    const tools = document.getElementById('tower-tools');
    const status = document.getElementById('status');
    const count = document.getElementById('tower-count');
    const name = document.getElementById('tower-name');
    const description = document.getElementById('tower-description');
    const attributes = document.getElementById('tower-attributes');
    const note = document.getElementById('tower-note');
    const cells = [];
    let towers = [];
    let selected = 0;
    let placed = 0;

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
        cell.replaceChildren();
        cell.dataset.tower = towerId;
        if (tower) cell.append(sprite(tower, 'placed-sprite'));
        if (selected !== 'remove') cell.append(sprite(towers[selected], 'preview-sprite'));
        cell.setAttribute('aria-label', `Row ${row + 1}, column ${column + 1}: ${tower ? tower.name : 'empty'}`);
    }

    function updateCount() {
        count.textContent = `${placed} ${placed === 1 ? 'tower' : 'towers'}`;
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
                cell.addEventListener('click', () => {
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
        showDetails(towers[selected]);
        status.textContent = `${towers[selected].name} selected. Choose a tile.`;
    }

    loadTowers().then(loaded => {
        towers = loaded;
        initialize();
    }).catch(error => {
        console.error('Could not initialize Tower Defence.', error);
        name.textContent = 'Towers unavailable';
        description.textContent = 'Could not load tower data. Please reload the game.';
        status.textContent = 'Could not load tower data.';
        document.getElementById('clear-board').disabled = true;
    });
})();
