window.AchievementLib = window.AchievementLib || {};

window.AchievementLib.sanitizeRarity = function sanitizeRarity(rarity) {
    const normalized = String(rarity || "common").toLowerCase();
    return ["common", "rare", "epic", "legendary", "secret"].includes(normalized) ? normalized : "common";
};

window.AchievementLib.isCompleted = function isCompleted(state, id) {
    return Boolean(state.completionMap[id]);
};

window.AchievementLib.getSummary = function getSummary(state) {
    const achievements = Array.from(state.achievementsMap.values());
    const unlocked = achievements.filter(achievement => window.AchievementLib.isCompleted(state, achievement.id));
    return {
        total: achievements.length,
        unlocked: unlocked.length,
        locked: Math.max(achievements.length - unlocked.length, 0),
        progress: achievements.length ? unlocked.length / achievements.length : 0,
        totalPoints: achievements.reduce((sum, achievement) => sum + (achievement.points || 0), 0),
        unlockedPoints: unlocked.reduce((sum, achievement) => sum + (achievement.points || 0), 0) + (state.bonusPoints || 0)
    };
};
