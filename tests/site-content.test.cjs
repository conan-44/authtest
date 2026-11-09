const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/site-content.js', 'utf8');
const content = JSON.parse(fs.readFileSync('data/site-content.json', 'utf8'));

async function render(response) {
    const guide = { dataset: { guestGuide: 'chat' }, textContent: '' };
    const game = { dataset: { gameDescription: 'mastermind' }, textContent: '' };
    const clone = { dataset: { gameDescription: 'mastermind' }, textContent: '' };
    const errors = [];
    vm.runInNewContext(source, {
        document: { querySelectorAll: selector => selector === '[data-guest-guide]' ? [guide] : [game, clone] },
        fetch: async () => response,
        console: { error: (...args) => errors.push(args) }
    });
    await new Promise(resolve => setImmediate(resolve));
    return { guide, game, clone, errors };
}

test('guest and game descriptions render from data including the carousel clone', async () => {
    const result = await render({ ok: true, json: async () => content });
    assert.equal(result.guide.textContent, content.guestGuide.chat);
    assert.equal(result.game.textContent, content.gameDescriptions.mastermind);
    assert.equal(result.clone.textContent, result.game.textContent);
    assert.equal(result.errors.length, 0);
});

test('failed or incomplete content is visible and logged', async () => {
    const failed = await render({ ok: false, status: 500 });
    assert.equal(failed.game.textContent, 'Description unavailable.');
    assert.equal(failed.errors.length, 1);
    const missing = await render({ ok: true, json: async () => ({}) });
    assert.equal(missing.guide.textContent, 'Description unavailable.');
    assert.equal(missing.errors.length, 3);
});
