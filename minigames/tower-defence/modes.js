((root, factory) => {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TowerDefenceModes = api;
})(globalThis, () => {
    function validate(modes) {
        const ids = ['bob', 'banana', 'beryl', 'bot'];
        const factors = ['towerSpeed', 'enemySpeed', 'damage', 'range', 'block', 'bananaCost', 'bananaDamage'];
        if (!Array.isArray(modes) || modes.length !== ids.length
            || new Set(modes.map(mode => mode?.id)).size !== ids.length
            || modes.some(mode => !mode || !ids.includes(mode.id)
                || typeof mode.name !== 'string' || !mode.name.trim()
                || typeof mode.description !== 'string' || !mode.description.trim()
                || factors.some(key => !Number.isFinite(mode[key]) || mode[key] <= 0))) {
            throw new Error('Invalid tower defence modes.');
        }
        return modes;
    }

    function stats(mode, tower, config) {
        const banana = tower.id === 'banana_boomer' || tower.id === 'banana_boomerang';
        return {
            cost: Math.ceil(tower.cost * (banana ? mode.bananaCost : 1)),
            damage: tower.damage * mode.damage * (banana ? mode.bananaDamage : 1),
            range: config.range * mode.range,
            splash: (config.splash || 0) * mode.range,
            block: (tower.blockSeconds || 0) * mode.block,
            cooldown: config.cooldown / mode.towerSpeed,
            projectileSpeed: (config.speed || 0) * mode.towerSpeed
        };
    }

    return { validate, stats };
});
