((root, createRules) => {
    if (typeof module !== 'undefined' && module.exports) module.exports = createRules;
    else {
        root.GachaRulesReady = fetch('./data/gacha/packs.json', { cache: 'no-store' }).then(response => {
            if (!response.ok) throw new Error(`Could not load Gacha pack configuration (${response.status}).`);
            return response.json();
        }).then(config => {
            root.GachaRules = createRules(config);
            return root.GachaRules;
        });
    }
})(globalThis, config => {
    const expectedShards = ['silver', 'gold', 'diamond', 'platinum'];
    const expectedFragments = ['nebula', 'celeste', 'void'];
    const expectedSizes = { classic: 5, red: 7, yellow: 5, green: 3, blue: 5 };
    const expectedPacks = Object.keys(expectedSizes);
    const { shards, fragments, packs, shardValues, fragmentValue, rarityWeightRatio, fragmentChance: fragmentConfig, balancePack } = config || {};
    if (JSON.stringify(shards) !== JSON.stringify(expectedShards) ||
        JSON.stringify(fragments) !== JSON.stringify(expectedFragments) ||
        !Array.isArray(packs) || packs.length !== expectedPacks.length ||
        expectedPacks.some(id => packs.filter(pack => pack?.id === id && pack.size === expectedSizes[id]).length !== 1) ||
        packs.some(pack => !pack || typeof pack.name !== 'string' || !pack.name || typeof pack.description !== 'string' ||
            !['original', 'higher-shards', 'fragments', 'platinum'].includes(pack.strategy) ||
            (pack.strategy !== 'original' && (!Number.isFinite(pack.targetPercent) || pack.targetPercent <= 0)) ||
            (pack.strategy === 'higher-shards' && (!Number.isFinite(pack.minimumBoost) || pack.minimumBoost < 0 || pack.minimumBoost > 1))) ||
        !Array.isArray(shardValues) || shardValues.length !== shards.length ||
        shardValues.some((value, i) => !Number.isFinite(value) || value <= 0 || (i > 0 && value <= shardValues[i - 1])) ||
        !Number.isFinite(fragmentValue) || fragmentValue < shardValues.at(-1) ||
        !Number.isFinite(rarityWeightRatio) || !(rarityWeightRatio > 0 && rarityWeightRatio < 1) || !fragmentConfig ||
        ![fragmentConfig.base, fragmentConfig.growth, fragmentConfig.scale].every(Number.isFinite) ||
        !(fragmentConfig.base >= 0 && fragmentConfig.growth >= 0 && fragmentConfig.base + fragmentConfig.growth < 1 && fragmentConfig.scale > 0) ||
        !packs.some(pack => pack.id === balancePack && pack.strategy === 'original')) {
        throw new Error('Gacha pack configuration is invalid.');
    }
    const targetSize = packs.find(pack => pack.id === balancePack).size;

    function chances(points, milestones, packId = 'classic') {
        if (!Number.isFinite(points) || !Array.isArray(milestones)) throw new Error('Milestone progress is unavailable.');
        const pack = packs.find(item => item.id === packId);
        if (!pack) throw new Error('The selected pack is unavailable.');
        const thresholds = ['silver', 'gold', 'diamond', 'platinum', 'mythical'].map(name => {
            const milestone = milestones.find(item => typeof item.name === 'string' && item.name.toLowerCase() === name);
            if (!milestone || !Number.isFinite(milestone.points)) throw new Error(`The ${name} milestone is unavailable.`);
            return milestone.points;
        });
        if (thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1])) {
            throw new Error('Milestone thresholds are out of order.');
        }
        const achieved = thresholds.filter(threshold => points >= threshold).length;
        const maxIndex = Math.min(achieved, shards.length - 1);
        let fragmentChance = points >= thresholds[4]
            ? fragmentConfig.base + fragmentConfig.growth * (1 - Math.exp(-(points - thresholds[4]) / fragmentConfig.scale))
            : 0;
        const weights = shards.map((_, index) => index <= maxIndex ? rarityWeightRatio ** index : 0);
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let ordinary = weights.map(weight => weight / total);
        const ordinaryValue = ordinary.reduce((sum, probability, index) => sum + probability * shardValues[index], 0);
        const classicValue = (1 - fragmentChance) * ordinaryValue + fragmentChance * fragmentValue;
        const targetValue = pack.strategy === 'original' ? 0 : targetSize * classicValue * pack.targetPercent / 100;

        if (pack.strategy === 'fragments' && fragmentChance > 0) {
            fragmentChance = Math.min(1, (targetValue / pack.size - ordinaryValue) / (fragmentValue - ordinaryValue));
        } else if (pack.strategy === 'platinum' && maxIndex === 3) {
            const target = (targetValue / pack.size - fragmentChance * fragmentValue) / (1 - fragmentChance);
            const shift = Math.min(1, (target - ordinaryValue) / (shardValues[3] - ordinaryValue));
            ordinary = ordinary.map((probability, index) => probability * (1 - shift) + (index === 3 ? shift : 0));
        } else if (pack.strategy === 'higher-shards' && maxIndex >= 1) {
            const target = (targetValue / pack.size - fragmentChance * fragmentValue) / (1 - fragmentChance);
            const original = ordinary.slice();
            for (let index = 1; index <= maxIndex; index++) {
                const extra = original[index] * pack.minimumBoost;
                ordinary[index] += extra;
                ordinary[0] -= extra;
            }
            let remaining = target - ordinary.reduce((sum, probability, index) => sum + probability * shardValues[index], 0);
            const transfer = (from, to, available) => {
                const amount = Math.min(available, Math.max(0, remaining) / (shardValues[to] - shardValues[from]));
                ordinary[from] -= amount;
                ordinary[to] += amount;
                remaining -= amount * (shardValues[to] - shardValues[from]);
            };
            transfer(0, 1, ordinary[0]);
            if (maxIndex > 1) {
                transfer(0, maxIndex, ordinary[0]);
                transfer(1, maxIndex, ordinary[1] - original[1] * (1 + pack.minimumBoost));
            }
        }
        const probabilities = {
            shards: ordinary.map(probability => (1 - fragmentChance) * probability),
            fragments: fragments.map(() => fragmentChance / fragments.length)
        };
        if ([...probabilities.shards, ...probabilities.fragments].some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
            throw new Error(`Gacha pack ${pack.id} has invalid probabilities.`);
        }
        return probabilities;
    }

    function draw(points, milestones, random, packId = 'classic') {
        const probabilities = chances(points, milestones, packId);
        const value = random();
        if (!(value >= 0 && value < 1)) throw new Error('Random draw returned an invalid value.');
        const names = [...shards, ...fragments];
        const weights = [...probabilities.shards, ...probabilities.fragments];
        let cumulative = 0;
        for (let index = 0; index < names.length; index += 1) {
            cumulative += weights[index];
            if (value < cumulative) return names[index];
        }
        return names[weights.findLastIndex(weight => weight > 0)];
    }

    function drawBatch(count, points, milestones, random, packId = 'classic') {
        if (!Number.isInteger(count) || count < 1 || count > 24) {
            throw new Error('Choose between 1 and 24 draws.');
        }
        const pack = packs.find(item => item.id === packId);
        if (!pack) throw new Error('The selected pack is unavailable.');
        return Array.from({ length: count * pack.size }, () => draw(points, milestones, random, packId));
    }

    function achievementIds(collection) {
        const names = [...shards, ...fragments];
        if (!collection || names.some(name => !Number.isSafeInteger(collection[name]) || collection[name] < 0)) {
            throw new Error('Shard collection is invalid.');
        }
        const total = names.reduce((sum, name) => sum + collection[name], 0);
        if (!Number.isSafeInteger(total)) throw new Error('Shard collection total is too large.');
        const ids = [];
        if (total >= 1) ids.push('main:gacha-first-draw');
        if (total >= 50) ids.push('main:gacha-ten-draws');
        if (total >= 250) ids.push('main:gacha-fifty-draws');
        if (fragments.some(name => collection[name] > 0)) ids.push('main:gacha-paragon-fragment');
        return ids;
    }

    return { shards, fragments, packs, chances, draw, drawBatch, achievementIds };
});
