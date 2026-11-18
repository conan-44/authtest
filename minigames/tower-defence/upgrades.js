((root, factory) => {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TowerDefenceUpgrades = api;
})(globalThis, () => {
    const roman = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

    function validate(data, towers) {
        const integer = value => Number.isSafeInteger(value) && value >= 0;
        if (!data || !['startingBits', 'startingButter', 'bitsPerEnemy', 'butterPerWave', 'butterPerWaveGrowth',
            'breakthroughCost', 'postBreakthroughCost', 'postBreakthroughCostGrowth'].every(key => integer(data[key]))
            || data.butterPerWave <= 0 || data.breakthroughCost <= data.postBreakthroughCost
            || !Number.isFinite(data.muffinInterval) || data.muffinInterval <= 0
            || !Number.isFinite(data.placementCooldownSeconds) || data.placementCooldownSeconds <= 0
            || !data.upgrades || !data.towerUpgrades) throw new Error('Invalid tower economy.');
        towers.forEach(tower => {
            const paths = data.towerUpgrades[tower.id];
            if (!Array.isArray(paths) || paths.length < 4 || new Set(paths).size !== paths.length) {
                throw new Error(`Invalid upgrade paths for ${tower.id}.`);
            }
            paths.forEach(id => {
                const upgrade = data.upgrades[id];
                if (!upgrade || typeof upgrade.name !== 'string' || typeof upgrade.description !== 'string'
                    || !Array.isArray(upgrade.costs) || upgrade.costs.length !== 10 || !upgrade.costs.every(integer)
                    || !Array.isArray(upgrade.values) || upgrade.values.length !== 10
                    || upgrade.values.some(value => !Number.isFinite(value) || value <= 0)
                    || !Number.isFinite(upgrade.postStep) || upgrade.postStep <= 0
                    || (upgrade.postMode !== undefined && upgrade.postMode !== 'inverse')) {
                    throw new Error(`Invalid upgrade: ${id}.`);
                }
            });
        });
        return data;
    }

    function value(upgrade, level, fallback) {
        if (!level) return fallback;
        if (level <= 10) return upgrade.values[level - 1];
        const extra = level - 10;
        return upgrade.postMode === 'inverse'
            ? upgrade.values[9] / (1 + extra * upgrade.postStep)
            : upgrade.values[9] + extra * upgrade.postStep;
    }

    function next(data, id, level) {
        const cost = level < 10 ? data.upgrades[id].costs[level]
            : level === 10 ? data.breakthroughCost
                : data.postBreakthroughCost + (level - 11) * data.postBreakthroughCostGrowth;
        return { cost, value: value(data.upgrades[id], level + 1, 0) };
    }

    function choices(pool, previous = [], random = Math.random) {
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const chosen = shuffled.slice(0, 3);
        if (previous.length === 3 && chosen.every(id => previous.includes(id))) {
            chosen[2] = shuffled.find(id => !previous.includes(id));
        }
        return chosen;
    }

    function formatLevel(level) { return level <= 10 ? roman[level] : String(level); }

    function waveReward(enemies, waveIndex, rewarded, data, bonus) {
        if (!enemies.length || rewarded.has(waveIndex) || enemies.some(enemy => enemy.hp > 0)) return 0;
        return Math.floor((data.butterPerWave + waveIndex * data.butterPerWaveGrowth) * (1 + bonus));
    }

    return { validate, value, next, choices, formatLevel, waveReward };
});
