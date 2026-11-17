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
                        || !Number.isFinite(group.interval) || group.interval < 0 || group.interval > 60
                        || (group.interval === 0 && group.count !== 1)
                        || !Number.isFinite(group.size) || group.size <= 0 || group.size > 2
                        || !Number.isFinite(group.speed) || group.speed <= 0 || group.speed > 20) {
                        throw new Error(`Invalid enemy group in wave ${index + 1}.`);
                    }
                    return { ...group };
                })
            };
        });
    }

    function generate(templates, seed, waveIndex) {
        if (typeof seed !== 'string' || !seed.length || !Number.isSafeInteger(waveIndex) || waveIndex < 0) {
            throw new Error('Invalid wave seed or index.');
        }
        let state = 2166136261;
        for (const char of `${seed}:${waveIndex}`) {
            state = Math.imul(state ^ char.charCodeAt(0), 16777619);
        }
        function random() {
            state = (state + 0x6d2b79f5) | 0;
            let value = state;
            value = Math.imul(value ^ value >>> 15, value | 1);
            value ^= value + Math.imul(value ^ value >>> 7, value | 61);
            return ((value ^ value >>> 14) >>> 0) / 4294967296;
        }
        const pool = templates.slice(0, Math.min(templates.length, 1 + Math.floor(waveIndex / 3))).flatMap(wave => wave.groups);
        const groups = [];
        const groupCount = Math.min(3, 1 + Math.floor(waveIndex / 5));
        for (let i = 0; i < groupCount; i++) {
            const base = pool[Math.floor(random() * pool.length)];
            groups.push({
                sprite: base.sprite,
                count: Math.min(200, Math.max(1, Math.round(base.count * (1 + waveIndex * 0.07) * (0.9 + random() * 0.2)))),
                interval: Math.max(0.08, base.interval / (1 + waveIndex * 0.015)),
                size: Math.min(2, base.size * (1 + waveIndex * 0.015)),
                speed: Math.min(20, base.speed * (1 + waveIndex * 0.008))
            });
        }
        return { groups, healthMultiplier: 1 + waveIndex * 0.12 };
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
            const distance = (time - enemy.spawn - (enemy.delay || 0)) * enemy.speed;
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

    function blockEnemies(enemies, path, blockers, previousTime, time, duration) {
        const ordered = enemies.map(enemy => {
            const cursor = Math.max(previousTime, enemy.spawn);
            const progress = (cursor - enemy.spawn - (enemy.delay || 0)) * enemy.speed;
            let firstContact = Infinity;
            if (enemy.hp > 0 && cursor <= time) blockers.forEach(blocker => {
                const entry = Math.max(0, blocker.pathIndex - 0.5);
                if (progress >= blocker.pathIndex + 0.5) return;
                const crossing = cursor + Math.max(0, entry - progress) / enemy.speed;
                if (crossing <= time && (blocker.tower.blockUntil === undefined || crossing < blocker.tower.blockUntil)) {
                    firstContact = Math.min(firstContact, crossing);
                }
            });
            return { enemy, firstContact };
        }).sort((a, b) => a.firstContact - b.firstContact || a.enemy.id - b.enemy.id);
        ordered.forEach(({ enemy }) => {
            if (enemy.hp <= 0 || enemy.spawn > time) return;
            let cursor = Math.max(previousTime, enemy.spawn);
            enemy.delay ||= 0;
            while (cursor < time) {
                if (enemy.blockedBy) {
                    const blocker = blockers.find(item => item.tower === enemy.blockedBy);
                    if (blocker && blocker.tower.blockUntil > cursor) {
                        const end = Math.min(time, blocker.tower.blockUntil);
                        enemy.delay += end - cursor;
                        cursor = end;
                        if (cursor < blocker.tower.blockUntil) break;
                    }
                    enemy.blockedBy = null;
                }
                const progress = (cursor - enemy.spawn - enemy.delay) * enemy.speed;
                const endProgress = progress + (time - cursor) * enemy.speed;
                let next = null;
                blockers.forEach(blocker => {
                    const entry = Math.max(0, blocker.pathIndex - 0.5);
                    const exit = blocker.pathIndex + 0.5;
                    if (progress >= exit || endProgress < entry) return;
                    const crossing = cursor + Math.max(0, entry - progress) / enemy.speed;
                    if (blocker.tower.blockUntil !== undefined && crossing >= blocker.tower.blockUntil) return;
                    if (!next || crossing < next.crossing) next = { blocker, crossing };
                });
                if (!next) break;
                cursor = next.crossing;
                if (next.blocker.tower.blockUntil === undefined) next.blocker.tower.blockUntil = cursor + (next.blocker.duration ?? duration);
                enemy.blockedBy = next.blocker.tower;
            }
        });
        return blockers.filter(blocker => blocker.tower.blockUntil !== undefined && blocker.tower.blockUntil <= time);
    }

    return { validate, generate, schedule, atTime, blockEnemies };
});
