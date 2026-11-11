const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
    constructor() {
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.attributes = {};
        this.listeners = {};
        this.textContent = '';
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    click() { this.listeners.click(); }
    querySelectorAll(selector) { return selector === 'button' ? this.children : []; }
}

function fixture(fetch) {
    const elements = Object.fromEntries(['board', 'tower-tools', 'status', 'tower-count', 'clear-board', 'tower-name', 'tower-description', 'tower-attributes', 'tower-note'].map(id => [id, new Element()]));
    const document = {
        getElementById: id => elements[id],
        createElement: () => new Element()
    };
    vm.runInNewContext(fs.readFileSync('minigames/tower-defence/script.js', 'utf8'), { document, fetch, console: { error() {} } });
    return elements;
}

const readData = async path => ({
    ok: true,
    json: async () => JSON.parse(fs.readFileSync(path.replace('../../', ''), 'utf8'))
});

test('tower selection, placement, replacement, removal, and clearing', async () => {
    const elements = fixture(readData);
    await new Promise(resolve => setImmediate(resolve));
    const board = elements.board.children;
    const tools = elements['tower-tools'].children;
    assert.equal(board.length, 144);
    assert.equal(tools.length, 6);
    board[0].click();
    assert.equal(board[0].attributes['aria-label'], 'Row 1, column 1: cookie');
    assert.equal(elements['tower-name'].textContent, 'cookie');
    assert.equal(elements['tower-description'].textContent, 'shoot chocolate chips at enemies');
    assert.deepEqual(elements['tower-attributes'].children.map(child => child.textContent), ['Category', 'ranged', 'Damage', '10', 'Cost', '5']);
    assert.equal(elements['tower-count'].textContent, '1 tower');
    tools[4].click();
    board[0].click();
    assert.equal(board[0].attributes['aria-label'], 'Row 1, column 1: backwards banana');
    assert.equal(elements['tower-name'].textContent, 'backwards banana');
    assert.equal(elements['tower-count'].textContent, '1 tower');
    tools[5].click();
    board[0].click();
    board[0].click();
    assert.equal(elements['tower-count'].textContent, '0 towers');
    tools[1].click();
    board[0].click();
    board[143].click();
    assert.equal(elements['tower-count'].textContent, '2 towers');
    elements['clear-board'].click();
    assert.equal(elements['tower-count'].textContent, '0 towers');
    assert.ok(board.every(cell => cell.dataset.tower === ''));
});

test('tower data failures are visible and prevent placement', async () => {
    const elements = fixture(async () => ({ ok: false, status: 404 }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements['tower-name'].textContent, 'Towers unavailable');
    assert.match(elements.status.textContent, /Could not load/);
    assert.equal(elements.board.children.length, 0);
    assert.equal(elements['clear-board'].disabled, true);
});
