((root, factory) => {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TowerDefenceWaves = api;
})(globalThis, () => {
    function validate(waves) {
        if (!Array.isArray(waves) || !waves.length) throw new Error('Waves must be a non-empty array.');
        return waves.map((wave, index) => {
            if (!wave || !Array.isArray(wave.groups) || !wave.groups.length) {
                throw new Error(`Wave ${index + 1} needs at least one group.`);
            }
            return {
                groups: wave.groups.map(group => {
                    if (!group || !Number.isInteger(group.sprite) || group.sprite < 0 || group.sprite > 4
                        || !Number.isInteger(group.count) || group.count < 1 || group.count > 200
                        || !Number.isFinite(group.interval) || group.interval <= 0 || group.interval > 60
                        || !Number.isFinite(group.size) || group.size <= 0 || group.size > 2
                        || !Number.isFinite(group.speed) || group.speed <= 0 || group.speed > 20) {
                        throw new Error(`Invalid enemy group in wave ${index + 1}.`);
                    }
                    return { ...group };
                })
            };
        });
    }

    function schedule(wave) {
        let next = 0;
        const enemies = [];
        wave.groups.forEach(group => {
            for (let index = 0; index < group.count; index++) {
                enemies.push({ id: enemies.length, spawn: next, sprite: group.sprite, size: group.size, speed: group.speed });
                next += group.interval;
            }
        });
        return enemies;
    }

    function atTime(enemies, path, time) {
        let remaining = 0;
        const visible = [];
        enemies.forEach(enemy => {
            if (enemy.hp !== undefined && enemy.hp <= 0) return;
            const distance = (time - enemy.spawn) * enemy.speed;
            if (distance < 0) {
                remaining++;
            } else if (distance < path.length - 1) {
                remaining++;
                const index = Math.floor(distance);
                const fraction = distance - index;
                const from = path[index];
                const to = path[index + 1];
                visible.push({
                    ...enemy,
                    progress: distance,
                    row: from[0] + (to[0] - from[0]) * fraction,
                    column: from[1] + (to[1] - from[1]) * fraction
                });
            }
        });
        return { visible, remaining };
    }

    return { validate, schedule, atTime };
});
