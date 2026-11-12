((root, factory) => {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TowerDefenceCombat = api;
})(globalThis, () => {
    const settings = {
        cookie: { range: 3, cooldown: 0.8, projectile: 'chip', speed: 7 },
        muffin: { range: 0, cooldown: 1.5, projectile: 'crumb', speed: 0 },
        toast: { range: 1.3, cooldown: 1.2, projectile: 'toast', speed: 5 },
        banana_boomer: { range: 1.6, cooldown: 1.5, projectile: 'explosion', splash: 0.9 },
        banana_boomerang: { range: 3, cooldown: 1.1, projectile: 'boomerang', speed: 5 }
    };
    const hpBySprite = [20, 35, 55, 12, 90];
    const modes = ['first', 'last', 'highest', 'lowest', 'closest', 'furthest'];

    function boomerangFrame(age) {
        const frame = Math.floor(age / 0.12);
        return { row: frame % 4, rotation: Math.floor(frame / 4) * 90 };
    }

    function createBoomerang(tower, target, damage) {
        const config = settings.banana_boomerang;
        const row = target.row - tower.row;
        const column = target.column - tower.column;
        const distance = Math.hypot(row, column);
        return {
            kind: 'boomerang', row: tower.row, column: tower.column,
            originRow: tower.row, originColumn: tower.column,
            directionRow: distance ? row / distance : 0,
            directionColumn: distance ? column / distance : 1,
            range: config.range, speed: config.speed, damage,
            distance: 0, phaseTime: 0, returning: false, hitEnemies: new Set(), age: 0
        };
    }

    function advanceBoomerang(shot, enemies, delta) {
        let time = delta;
        const duration = 2 * shot.range / shot.speed;
        while (time > 0 && !shot.done) {
            const step = Math.min(time, duration - shot.phaseTime);
            shot.phaseTime += step;
            const progress = Math.min(1, shot.phaseTime / duration);
            const nextDistance = shot.returning
                ? shot.range * (1 - progress * progress)
                : shot.range * (1 - (1 - progress) ** 2);
            const nextRow = shot.originRow + shot.directionRow * nextDistance;
            const nextColumn = shot.originColumn + shot.directionColumn * nextDistance;
            const row = nextRow - shot.row;
            const column = nextColumn - shot.column;
            const lengthSquared = row * row + column * column;
            enemies.forEach(enemy => {
                if (enemy.hp <= 0 || shot.hitEnemies.has(enemy.id)) return;
                const fraction = lengthSquared
                    ? Math.max(0, Math.min(1, ((enemy.row - shot.row) * row + (enemy.column - shot.column) * column) / lengthSquared))
                    : 0;
                const separation = Math.hypot(enemy.row - shot.row - fraction * row, enemy.column - shot.column - fraction * column);
                if (separation <= enemy.size / 2 + 1 / 3) {
                    impact(shot, enemy, enemies);
                    shot.hitEnemies.add(enemy.id);
                }
            });
            shot.row = nextRow;
            shot.column = nextColumn;
            shot.distance = nextDistance;
            time -= step;
            if (progress === 1) {
                if (shot.returning) shot.done = true;
                else {
                    shot.returning = true;
                    shot.phaseTime = 0;
                }
            }
        }
    }

    function chooseTarget(tower, enemies, mode) {
        const range = settings[tower.id].range;
        const candidates = enemies.map(enemy => ({
            enemy,
            distance: Math.hypot(enemy.row - tower.row, enemy.column - tower.column)
        })).filter(item => item.distance <= range && item.enemy.hp > 0);
        const compare = {
            first: (a, b) => b.enemy.progress - a.enemy.progress,
            last: (a, b) => a.enemy.progress - b.enemy.progress,
            highest: (a, b) => b.enemy.hp - a.enemy.hp,
            lowest: (a, b) => a.enemy.hp - b.enemy.hp,
            closest: (a, b) => a.distance - b.distance,
            furthest: (a, b) => b.distance - a.distance
        }[mode];
        if (!compare) throw new Error(`Unknown targeting mode: ${mode}`);
        candidates.sort((a, b) => compare(a, b) || a.enemy.id - b.enemy.id);
        return candidates[0]?.enemy || null;
    }

    function impact(projectile, target, enemies) {
        const victims = projectile.splash
            ? enemies.filter(enemy => enemy.hp > 0 && Math.hypot(enemy.row - target.row, enemy.column - target.column) <= projectile.splash)
            : [target];
        victims.forEach(enemy => { enemy.hp = Math.max(0, enemy.hp - projectile.damage); });
    }

    return { settings, hpBySprite, modes, boomerangFrame, createBoomerang, advanceBoomerang, chooseTarget, impact };
});
