((root, factory) => {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TowerDefenceProgression = api;
})(globalThis, () => {
    function ratingDelta(rating, wave, perfect) {
        if (!Number.isSafeInteger(rating) || rating < 0 || !Number.isSafeInteger(wave) || wave < 1
            || typeof perfect !== 'boolean') throw new Error('Invalid Tower Defence rating result.');
        const opponent = 1000 + (wave - 1) * 25;
        const expected = 1 / (1 + 10 ** ((opponent - rating) / 400));
        return Math.round(24 * ((perfect ? 1 : 0) - expected));
    }

    function create() {
        const awarded = new Set();
        const built = new Set();
        const completed = new Set();
        let kills = 0;
        let upgrades = 0;
        let streak = 0;
        const emit = ids => ids.filter(id => {
            if (awarded.has(id)) return false;
            awarded.add(id);
            return true;
        }).map(id => `tower-defence:${id}`);
        return {
            build(id) {
                built.add(id);
                const types = {
                    cookie: 'build-cookie', muffin: 'build-muffin', toast: 'build-toast',
                    banana_boomer: 'build-boom', banana_boomerang: 'build-boomerang',
                    fountain: 'build-fountain'
                };
                return emit(['first-tower', types[id], ...(built.size === 6 ? ['all-towers'] : [])].filter(Boolean));
            },
            upgrade(level) {
                upgrades++;
                return emit(['first-upgrade', ...(upgrades >= 5 ? ['five-upgrades'] : []),
                    ...(level >= 10 ? ['level-ten'] : [])]);
            },
            kill() {
                kills++;
                return emit([1, 50, 250, 1000].filter(n => kills === n).map(n => `kills-${n}`));
            },
            wave(number, perfect, mode) {
                if (completed.has(number)) return [];
                completed.add(number);
                streak = perfect ? streak + 1 : 0;
                if (!perfect) return [];
                return emit([
                    ...[1, 5, 10, 25, 50].filter(n => number >= n).map(n => `wave-${n}`),
                    ...(number >= 5 ? [`mode-${mode}`] : []),
                    ...(streak >= 5 ? ['perfect-five'] : [])
                ]);
            }
        };
    }

    return { ratingDelta, create };
});
