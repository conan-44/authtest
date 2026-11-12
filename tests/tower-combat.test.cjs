const test = require('node:test');
const assert = require('node:assert/strict');
const combat = require('../minigames/tower-defence/combat.js');
const waves = require('../minigames/tower-defence/waves.js');

test('boomerangs cycle four frames before each quarter turn', () => {
    for (let frame = 0; frame < 12; frame++) {
        assert.deepEqual(combat.boomerangFrame(frame * 0.12 + 0.001), {
            row: frame % 4,
            rotation: Math.floor(frame / 4) * 90
        });
    }
});

test('boomerangs pierce multiple enemies, return, and hit each enemy only once', () => {
    const tower = { row: 0, column: 0 };
    const enemies = [
        { id: 1, row: 0, column: 1, size: 0.5, hp: 30 },
        { id: 2, row: 0, column: 2, size: 0.5, hp: 30 },
        { id: 3, row: 1, column: 2, size: 0.5, hp: 30 }
    ];
    const shot = combat.createBoomerang(tower, enemies[0], 10);
    combat.advanceBoomerang(shot, enemies, 1.2);
    assert.equal(shot.column, 3);
    assert.equal(shot.returning, true);
    assert.deepEqual(enemies.map(enemy => enemy.hp), [20, 20, 30]);
    enemies.push({ id: 4, row: 0, column: 1.5, size: 0.5, hp: 30 });
    combat.advanceBoomerang(shot, enemies, 1.2);
    assert.equal(shot.column, 0);
    assert.equal(shot.row, 0);
    assert.equal(shot.done, true);
    assert.deepEqual(enemies.map(enemy => enemy.hp), [20, 20, 30, 20]);
});

test('boomerangs return without their original target and handle a full trip in one update', () => {
    const shot = combat.createBoomerang({ row: 2, column: 2 }, { row: 2, column: 2 }, 10);
    const enemies = [{ id: 2, row: 2, column: 4, size: 0.5, hp: 10 }];
    combat.advanceBoomerang(shot, enemies, 3);
    assert.equal(enemies[0].hp, 0);
    assert.equal(shot.done, true);
    assert.equal(shot.row, 2);
    assert.equal(shot.column, 2);
});

test('boomerangs decelerate toward their turnaround and accelerate on return', () => {
    const shot = combat.createBoomerang({ row: 0, column: 0 }, { row: 0, column: 1 }, 10);
    const positions = [shot.distance];
    for (let i = 0; i < 12; i++) {
        combat.advanceBoomerang(shot, [], 0.1);
        positions.push(shot.distance);
    }
    const early = positions[1] - positions[0];
    const late = positions[12] - positions[11];
    assert.ok(late < early / 5);
    assert.ok(Math.abs(shot.distance - shot.range) < 1e-10);
    combat.advanceBoomerang(shot, [], 0.1);
    const returnEarly = shot.range - shot.distance;
    for (let i = 0; i < 10; i++) combat.advanceBoomerang(shot, [], 0.1);
    const beforeEnd = shot.distance;
    combat.advanceBoomerang(shot, [], 0.1);
    assert.ok(beforeEnd > returnEarly * 5);
    assert.ok(shot.done);
});

test('targeting priorities choose only living enemies in range', () => {
    const tower = { id: 'cookie', row: 0, column: 0 };
    const enemies = [
        { id: 1, row: 0, column: 1, hp: 20, progress: 5 },
        { id: 2, row: 0, column: 2, hp: 50, progress: 2 },
        { id: 3, row: 0, column: 4, hp: 100, progress: 10 },
        { id: 4, row: 0, column: 0, hp: 0, progress: 11 }
    ];
    for (const [mode, id] of Object.entries({ first: 1, last: 2, highest: 2, lowest: 1, closest: 1, furthest: 2 })) {
        assert.equal(combat.chooseTarget(tower, enemies, mode).id, id);
    }
    assert.throws(() => combat.chooseTarget(tower, enemies, 'bad'));
    assert.equal(combat.chooseTarget({ id: 'toast', row: 8, column: 8 }, enemies, 'first'), null);
});

test('impacts damage targets, explosions affect nearby enemies and deaths leave the wave', () => {
    const enemies = [
        { id: 0, row: 0, column: 0, hp: 10, sprite: 0, spawn: 0, speed: 1 },
        { id: 1, row: 0, column: 0.5, hp: 15, sprite: 0, spawn: 0, speed: 1 },
        { id: 2, row: 0, column: 2, hp: 30, sprite: 0, spawn: 0, speed: 1 }
    ];
    combat.impact({ damage: 10, splash: 0.9 }, enemies[0], enemies);
    assert.deepEqual(enemies.map(enemy => enemy.hp), [0, 5, 30]);
    assert.equal(waves.atTime(enemies, [[0, 0], [0, 1]], 0).remaining, 2);
    combat.impact({ damage: 10 }, enemies[1], enemies);
    assert.equal(enemies[1].hp, 0);
    assert.equal(enemies[2].hp, 30);
});
