window.AchievementLib = window.AchievementLib || {};

window.AchievementLib.parseYamlSimple = function parseYamlSimple(text) {
    const config = {};
    for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (!line || line.startsWith("#")) continue;
        const separatorIndex = line.lastIndexOf(":");
        if (separatorIndex > 0) {
            const key = line.slice(0, separatorIndex).trim();
            const value = parseInt(line.slice(separatorIndex + 1).trim(), 10);
            if (!isNaN(value)) config[key] = value;
        }
    }
    return config;
};

window.AchievementLib.parseMilestonesConfig = function parseMilestonesConfig(text) {
    const milestones = [];
    for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (!line || line.startsWith("#")) continue;
        const separatorIndex = line.indexOf(":");
        if (separatorIndex <= 0) continue;
        const points = parseInt(line.slice(0, separatorIndex).trim(), 10);
        const name = line.slice(separatorIndex + 1).trim();
        if (!isNaN(points) && name) milestones.push({ points, name });
    }
    return milestones.sort((a, b) => a.points - b.points);
};
