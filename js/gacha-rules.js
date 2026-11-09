((root, factory) => {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else root.GachaRules = factory();
})(globalThis, () => {
    const shards = ['silver', 'gold', 'diamond', 'platinum'];
    const fragments = ['nebula', 'celeste', 'void'];
    const packs = [
        { id: 'classic', name: 'Classic', size: 5, description: 'Original rates' },
        { id: 'red', name: 'Red', size: 7, description: 'More shards' },
        { id: 'yellow', name: 'Yellow', size: 5, description: 'More gold, diamond and platinum' },
        { id: 'green', name: 'Green', size: 3, description: 'Higher fragment chance' },
        { id: 'blue', name: 'Blue', size: 5, description: 'Higher platinum chance' }
    ];
    const shardValues = [1, 5, 25, 125];
    const fragmentValue = 125;

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
            ? 0.001 + 0.049 * (1 - Math.exp(-(points - thresholds[4]) / 4500))
            : 0;
        const weights = shards.map((_, index) => index <= maxIndex ? 0.2 ** index : 0);
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let ordinary = weights.map(weight => weight / total);
        const ordinaryValue = ordinary.reduce((sum, probability, index) => sum + probability * shardValues[index], 0);
        const classicValue = (1 - fragmentChance) * ordinaryValue + fragmentChance * fragmentValue;

        // Match the seven-item red pack using the rarity-based values above.
        if (pack.id === 'green' && fragmentChance > 0) {
            fragmentChance = Math.min(1, (7 * classicValue / 3 - ordinaryValue) / (fragmentValue - ordinaryValue));
        } else if (pack.id === 'blue' && maxIndex === 3) {
            const target = (7 * classicValue / 5 - fragmentChance * fragmentValue) / (1 - fragmentChance);
            const shift = Math.min(1, (target - ordinaryValue) / (shardValues[3] - ordinaryValue));
            ordinary = ordinary.map((probability, index) => probability * (1 - shift) + (index === 3 ? shift : 0));
        } else if (pack.id === 'yellow' && maxIndex >= 1) {
            const target = (7 * classicValue / 5 - fragmentChance * fragmentValue) / (1 - fragmentChance);
            const original = ordinary.slice();
            for (let index = 1; index <= maxIndex; index++) {
                const extra = original[index] * 0.1;
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
                transfer(1, maxIndex, ordinary[1] - original[1] * 1.1);
            }
        }
        return {
            shards: ordinary.map(probability => (1 - fragmentChance) * probability),
            fragments: fragments.map(() => fragmentChance / fragments.length)
        };
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
