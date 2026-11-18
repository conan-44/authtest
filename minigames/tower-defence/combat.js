((root, factory) => {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TowerDefenceCombat = api;
})(globalThis, () => {
    const settings = {
        cookie: { range: 7, cooldown: 0.4, projectile: 'chip', speed: 7 },
        muffin: { range: 0, cooldown: 1.5, projectile: 'crumb', speed: 0 },
        toast: { range: 2, cooldown: 1.2, projectile: 'toast', speed: 5 },
        banana_boomer: { range: 1.6, cooldown: 1.5, projectile: 'explosion', splash: 1.6 },
        banana_boomerang: { range: 2, cooldown: 4, projectile: 'boomerang', speed: 5 },
        fountain: { range: 1, cooldown: 2, projectile: 'drips', speed: 0 }
    };
    const hpBySprite = [42, 38, 64, 24, 167];
    const modes = ['first', 'last', 'highest', 'lowest', 'closest', 'furthest'];

    function boomerangFrame(age) {
        const frame = Math.floor(age / 0.12);
        return { row: frame % 4, rotation: Math.floor(frame / 4) * 90 };
    }

    function createBoomerang(tower, target, damage, range = settings.banana_boomerang.range) {
        const config = settings.banana_boomerang;
        const row = target.row - tower.row;
        const column = target.column - tower.column;
        const distance = Math.hypot(row, column);
        return {
            kind: 'boomerang', row: tower.row, column: tower.column,
            originRow: tower.row, originColumn: tower.column,
            directionRow: distance ? row / distance : 0,
            directionColumn: distance ? column / distance : 1,
            range, speed: config.speed, damage,
            distance: 0, phaseTime: 0, returning: false, hitEnemies: new Set(), age: 0
        };
    }

    function createPiercingShot(tower, target, config, damage, pierce) {
        const row = target.row - tower.row;
        const column = target.column - tower.column;
        const sideways = config.projectile === 'toast';
        const distance = sideways ? Math.abs(column) : Math.hypot(row, column);
        return {
            kind: config.projectile, row: tower.row, column: tower.column,
            directionRow: sideways ? 0 : distance ? row / distance : 0,
            directionColumn: distance ? column / distance : 1,
            range: config.range, distance: 0, speed: config.speed, damage,
            hitRadius: sideways ? 2 / 3 : 1 / 3, pierce, hitEnemies: new Set(), age: 0
        };
    }

    function hitAlongSegment(shot, enemies, nextRow, nextColumn, limit = Infinity) {
        const row = nextRow - shot.row;
        const column = nextColumn - shot.column;
        const lengthSquared = row * row + column * column;
        const hits = [];
        enemies.forEach(enemy => {
            if (enemy.hp <= 0 || shot.hitEnemies.has(enemy.id)) return;
            const fraction = lengthSquared
                ? Math.max(0, Math.min(1, ((enemy.row - shot.row) * row + (enemy.column - shot.column) * column) / lengthSquared))
                : 0;
            const separation = Math.hypot(enemy.row - shot.row - fraction * row, enemy.column - shot.column - fraction * column);
            if (separation <= enemy.size / 2 + (shot.hitRadius ?? 1 / 3)) hits.push({ enemy, fraction });
        });
        hits.sort((a, b) => a.fraction - b.fraction || a.enemy.id - b.enemy.id);
        hits.slice(0, limit).forEach(({ enemy }) => {
            impact(shot, enemy, enemies);
            shot.hitEnemies.add(enemy.id);
        });
    }

    function advancePiercingShot(shot, enemies, delta) {
        const step = Math.min(shot.speed * delta, shot.range - shot.distance);
        const nextRow = shot.row + shot.directionRow * step;
        const nextColumn = shot.column + shot.directionColumn * step;
        hitAlongSegment(shot, enemies, nextRow, nextColumn, shot.pierce - shot.hitEnemies.size);
        shot.row = nextRow;
        shot.column = nextColumn;
        shot.distance += step;
        shot.done = shot.hitEnemies.size >= shot.pierce || shot.range - shot.distance < 1e-9;
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
            hitAlongSegment(shot, enemies, nextRow, nextColumn);
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

    function chooseTarget(tower, enemies, mode, range = settings[tower.id].range) {
        const candidates = enemies.map(enemy => ({
            enemy,
            distance: Math.hypot(enemy.row - tower.row, enemy.column - tower.column)
        })).filter(item => item.distance <= range && item.enemy.hp > 0
            && (tower.id !== 'toast' || (item.enemy.column !== tower.column
                && Math.abs(item.enemy.row - tower.row) <= item.enemy.size / 2 + 2 / 3)));
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

    function coatProjectile(projectile, tower, fountains) {
        const fountain = fountains.filter(item => Math.hypot(item.row - tower.row, item.column - tower.column) <= item.range)
            .sort((a, b) => b.damage - a.damage || a.row - b.row || a.column - b.column)[0];
        if (!fountain) return projectile;
        projectile.chocolate = true;
        projectile.damage += fountain.damage;
        projectile.slowFactor = fountain.slowFactor;
        projectile.slowSeconds = fountain.slowSeconds;
        return projectile;
    }

    function impact(projectile, target, enemies) {
        const victims = projectile.splash
            ? enemies.filter(enemy => enemy.hp > 0 && Math.hypot(enemy.row - target.row, enemy.column - target.column) <= projectile.splash)
            : [target];
        victims.forEach(enemy => {
            enemy.hp = Math.max(0, enemy.hp - projectile.damage);
            if (projectile.chocolate && enemy.hp > 0) {
                if (!(enemy.slowUntil > projectile.hitTime)) enemy.slowFactor = 1;
                enemy.slowFactor = Math.min(enemy.slowFactor, projectile.slowFactor);
                enemy.slowUntil = Math.max(enemy.slowUntil || 0, projectile.hitTime + projectile.slowSeconds);
            }
        });
    }

    return { settings, hpBySprite, modes, boomerangFrame, createBoomerang, advanceBoomerang, createPiercingShot, advancePiercingShot, chooseTarget, coatProjectile, impact };
});
