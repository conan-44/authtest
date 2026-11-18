const test = require('node:test');
const assert = require('node:assert/strict');
const waves = require('../minigames/tower-defence/waves.js');
const combat = require('../minigames/tower-defence/combat.js');
const upgrades = require('../minigames/tower-defence/upgrades.js');

test('living escaped enemies deal size-based damage once and forfeit perfect rewards', () => {
    const path = [[0, 0], [0, 1], [0, 2]];
    const enemies = [
        { id: 0, hp: 10, size: 0.45, spawn: 0, speed: 1 },
        { id: 1, hp: 10, size: 1.15, spawn: 0, speed: 1 },
        { id: 2, hp: 0, size: 2, spawn: 0, speed: 1 },
        { id: 3, hp: 10, size: 1, spawn: 3, speed: 1 }
    ];
    assert.equal(waves.collectEscapes(enemies, path, 1.99), 0);
    assert.equal(waves.collectEscapes(enemies, path, 2), 17);
    assert.equal(waves.collectEscapes(enemies, path, 2), 0);
    assert.equal(waves.atTime(enemies, path, 2).remaining, 1);
    assert.equal(upgrades.waveReward(enemies, 0, new Set(), { butterPerWave: 1, butterPerWaveGrowth: 1 }, 0), 0);
});

test('chocolate-coated explosions add fountain damage and slow every surviving victim', () => {
    const tower = { row: 0, column: 0 };
    const fountain = { row: 0, column: 1, range: 1, damage: 3, slowFactor: 0.8, slowSeconds: 2 };
    const victims = [{ hp: 20, row: 0, column: 0 }, { hp: 20, row: 0, column: 1 }];
    const blast = combat.coatProjectile({ damage: 5, splash: 2, hitTime: 4 }, tower, [fountain]);
    combat.impact(blast, victims[0], victims);
    assert.equal(blast.chocolate, true);
    for (const victim of victims) {
        assert.equal(victim.hp, 12);
        assert.equal(victim.slowFactor, 0.8);
        assert.equal(victim.slowUntil, 6);
    }
});

test('waves 20 through 25 sharply increase difficulty without dropping it afterwards', () => {
    const templates = [{ groups: [{ sprite: 0, count: 10, interval: 1, size: 0.6, speed: 1 }] }];
    const wave = number => waves.generate(templates, 'difficulty', number - 1);
    assert.equal(wave(19).healthMultiplier, 1 + 18 * 0.12);
    for (let number = 20; number <= 25; number++) {
        assert.ok(wave(number).healthMultiplier > wave(number - 1).healthMultiplier);
    }
    assert.ok(wave(25).healthMultiplier > (1 + 24 * 0.12) * 2.5);
    assert.ok(wave(26).healthMultiplier > wave(25).healthMultiplier);
    assert.ok(wave(25).groups[0].speed > 1.3);
    assert.ok(wave(25).groups[0].count > Math.ceil(10 * (1 + 24 * 0.07) * 1.1));
});
