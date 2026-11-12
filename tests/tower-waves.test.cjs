const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const rules = require('../minigames/tower-defence/waves.js');
const levels = require('../minigames/tower-defence/level.js');

test('configured waves grow and include a smaller fourth-column swarm', () => {
    const data = JSON.parse(fs.readFileSync('data/minigames/tower-defence/waves.skvwameta', 'utf8'));
    const waves = rules.validate(data);
    assert.ok(waves.length >= 3);
    assert.ok(waves[1].groups[0].size > waves[0].groups[0].size);
    const swarm = waves.flatMap(wave => wave.groups).find(group => group.sprite === 3);
    assert.ok(swarm && swarm.count >= 10 && swarm.interval < 0.3);
    assert.ok(swarm.size < waves[0].groups[0].size);
});

test('wave spawns in sequence, follows turns, and completes at the end', () => {
    const wave = rules.validate([{ groups: [
        { sprite: 0, count: 2, interval: 1, size: 1, speed: 1 },
        { sprite: 3, count: 2, interval: 0.2, size: 0.4, speed: 2 }
    ] }])[0];
    const schedule = rules.schedule(wave);
    assert.deepEqual(schedule.map(enemy => enemy.spawn), [0, 1, 2, 2.2]);
    const path = levels.decode('TD1:0,0;0,1;1,1');
    let state = rules.atTime(schedule, path, 0.5);
    assert.equal(state.remaining, 4);
    assert.equal(state.visible.length, 1);
    assert.equal(state.visible[0].column, 0.5);
    state = rules.atTime(schedule, path, 1.5);
    assert.equal(state.visible[0].row, 0.5);
    assert.equal(state.visible[0].column, 1);
    state = rules.atTime(schedule, path, 10);
    assert.equal(state.remaining, 0);
    assert.equal(state.visible.length, 0);
});

test('invalid wave data fails explicitly', () => {
    assert.throws(() => rules.validate([]));
    assert.throws(() => rules.validate([{ groups: [{ sprite: 3, count: 0, interval: 1, size: 1, speed: 1 }] }]));
    assert.throws(() => rules.validate([{ groups: [{ sprite: 5, count: 1, interval: 1, size: 1, speed: 1 }] }]));
    assert.throws(() => rules.validate([{ groups: [{ sprite: 0, count: 1, interval: 0, size: 1, speed: 1 }] }]));
});
