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

window.AchievementLib.parseSettingsConfig = function parseSettingsConfig(text) {
    const settings = {};
    let section = "general";
    for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (!line || line.startsWith("#")) continue;
        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            section = sectionMatch[1].trim();
            settings[section] = settings[section] || {};
            continue;
        }
        const separatorIndex = line.indexOf(":");
        if (separatorIndex <= 0) continue;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim().toLowerCase();
        if (value === "true" || value === "false") {
            settings[section] = settings[section] || {};
            settings[section][key] = value === "true";
        }
    }
    return settings;
};
