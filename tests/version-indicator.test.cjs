const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/achievements.js', 'utf8');
const versionCode = source.slice(
    source.indexOf('    const versionEl = document.getElementById("versionIndicator");'),
    source.indexOf('\n    const achievements = window.AchievementModule.create')
);
const invocation = source.slice(
    source.indexOf('    if (versionEl) loadVersionIndicator();'),
    source.indexOf('\n\n    window.achieve')
);

test('a missing version indicator skips the request and does not throw', async () => {
    let fetched = false;
    const context = {
        document: { getElementById: () => null },
        fetch: () => { fetched = true; throw new Error('unexpected request'); }
    };
    await vm.runInNewContext(versionCode + invocation, context);
    assert.equal(fetched, false);
});

test('a present version indicator shows a loading failure', async () => {
    const element = {};
    const warnings = [];
    const context = {
        document: { getElementById: () => element },
        history_file: '/history',
        fetch: async () => ({ ok: false }),
        console: { warn: (...args) => warnings.push(args) }
    };
    await vm.runInNewContext(versionCode + invocation, context);
    assert.equal(element.textContent, 'build unavailable');
    assert.equal(warnings.length, 1);
});
