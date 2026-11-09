const test = require('node:test');
const assert = require('node:assert/strict');
const createRules = require('../js/gacha-rules.js');
const config = require('../data/gacha/packs.json');

const milestones = [
    { name: 'Silver', points: 100 },
    { name: 'Gold', points: 250 },
    { name: 'Diamond', points: 500 },
    { name: 'Platinum', points: 1000 },
    { name: 'Mythical', points: 1800 }
];
const rules = createRules(config);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('configured packs preserve milestone caps, probabilities, and fragment progression', () => {
    assert.deepEqual(rules.chances(0, milestones).shards, [1, 0, 0, 0]);
    near(rules.chances(100, milestones).shards[1], 1 / 6);
    near(rules.chances(250, milestones, 'yellow').shards[1], 0.3838709677419355);
    near(rules.chances(500, milestones, 'blue').shards[3], 0.016869095816464244);
    near(rules.chances(1800, milestones).fragments[0], 0.001 / 3);
    near(rules.chances(1800, milestones, 'green').fragments[0], 0.012473684210526317);
    assert.ok(rules.chances(2300, milestones).fragments[0] > rules.chances(1800, milestones).fragments[0]);
    for (const points of [0, 99, 100, 249, 250, 499, 500, 999, 1000, 1799, 1800, 2200, 2300, 3200, 10000]) {
        for (const pack of config.packs) {
            const chance = rules.chances(points, milestones, pack.id);
            near([...chance.shards, ...chance.fragments].reduce((a, b) => a + b, 0), 1);
            assert.ok([...chance.shards, ...chance.fragments].every(p => p >= 0 && p <= 1));
            assert.equal(new Set(chance.fragments).size, 1);
        }
    }
});

test('batch sizes and achievement thresholds remain unchanged', () => {
    for (const pack of config.packs) {
        assert.equal(rules.drawBatch(24, 0, milestones, () => 0, pack.id).length, 24 * pack.size);
    }
    assert.throws(() => rules.drawBatch(25, 0, milestones, () => 0), /between 1 and 24/);
    const inventory = Object.fromEntries([...rules.shards, ...rules.fragments].map(name => [name, 0]));
    assert.deepEqual(rules.achievementIds(inventory), []);
    inventory.silver = 250;
    inventory.nebula = 1;
    assert.deepEqual(rules.achievementIds(inventory), [
        'main:gacha-first-draw', 'main:gacha-ten-draws', 'main:gacha-fifty-draws', 'main:gacha-paragon-fragment'
    ]);
});

test('all pack odds match the original Mythical milestone values', () => {
    const expected = {
        classic: [0.8004807692307693, 0.16009615384615386, 0.03201923076923077, 0.006403846153846155, 0.0003333333333333333],
        red: [0.8004807692307693, 0.16009615384615386, 0.03201923076923077, 0.006403846153846155, 0.0003333333333333333],
        yellow: [0.5030096153846152, 0.4537250000000002, 0.03522115384615385, 0.007044230769230771, 0.0003333333333333333],
        green: [0.7712972334682862, 0.15425944669365724, 0.03085188933873145, 0.00617037786774629, 0.012473684210526317],
        blue: [0.7917257085020243, 0.15834514170040487, 0.03166902834008098, 0.017260121457489883, 0.0003333333333333333]
    };
    for (const [pack, values] of Object.entries(expected)) {
        const chance = rules.chances(1800, milestones, pack);
        [...chance.shards, chance.fragments[0]].forEach((value, i) => near(value, values[i]));
    }
});

test('changing data changes both exposed pack metadata and computed odds', () => {
    const changed = createRules({
        ...config,
        rarityWeightRatio: 0.1,
        packs: config.packs.map(pack => pack.id === 'red' ? { ...pack, description: 'A new description' } : pack)
    });
    assert.equal(changed.packs.find(pack => pack.id === 'red').description, 'A new description');
    near(changed.chances(100, milestones).shards[1], 1 / 11);
    const boosted = createRules({
        ...config,
        packs: config.packs.map(pack => pack.id === 'blue' ? { ...pack, targetPercent: 120 } : pack)
    });
    assert.ok(boosted.chances(1800, milestones, 'blue').shards[3] > rules.chances(1800, milestones, 'blue').shards[3]);
});

test('bad configuration is reported instead of falling back', () => {
    for (const change of [
        { rarityWeightRatio: 0 },
        { fragmentChance: { base: 1, growth: 1, scale: 10 } },
        { packs: config.packs.map(pack => pack.id === 'blue' ? { ...pack, targetPercent: 0 } : pack) },
        { packs: config.packs.map(pack => pack.id === 'red' ? { ...pack, size: 8 } : pack) },
        { shards: ['gold'] }
    ]) {
        assert.throws(() => createRules({ ...config, ...change }), /configuration is invalid/);
    }
});
