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
    const paragonNames = new Map();
    let readingParagonNames = false;
    for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (!line) continue;
        if (line.startsWith("#")) {
            if (/^#+\s*paragon names\b/i.test(line)) readingParagonNames = true;
            continue;
        }
        const separatorIndex = line.indexOf(":");
        if (separatorIndex <= 0) continue;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (readingParagonNames) {
            const tier = parseInt(key, 10);
            if (!isNaN(tier) && value) paragonNames.set(tier, value);
            continue;
        }
        const points = parseInt(key, 10);
        const name = value;
        if (!isNaN(points) && name) milestones.push({ points, name });
    }
    return milestones.sort((a, b) => a.points - b.points).map(milestone => {
        const paragonTier = milestone.name.match(/^Paragon\s+([IVXLCDM]+)$/i)?.[1];
        const paragonNumber = { I: 1, II: 2, III: 3 }[paragonTier?.toUpperCase()];
        return paragonNumber && paragonNames.has(paragonNumber)
            ? { ...milestone, paragonName: paragonNames.get(paragonNumber) }
            : milestone;
    });
};

window.AchievementLib.parseSettingsConfig = function parseSettingsConfig(text) {
    const settings = {};
    let section = "general";
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index].trim();
        if (!line) continue;
        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            section = sectionMatch[1].trim();
            settings[section] = settings[section] || {};
            continue;
        }
        const dropdownMatch = line.match(/^\+([^:]+):\s*$/);
        if (dropdownMatch) {
            const options = [];
            while (index + 1 < lines.length && lines[index + 1].trim().startsWith("#")) {
                const option = lines[++index].trim().slice(1).trim();
                if (option) options.push(option);
            }
            if (options.length) {
                settings[section] = settings[section] || {};
                settings[section][dropdownMatch[1].trim()] = { type: "dropdown", options };
            }
            continue;
        }
        const sliderMatch = line.match(/^-\s*([^:]+):\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (sliderMatch) {
            const key = sliderMatch[1].trim();
            const slider = {
                type: "slider",
                step: Number(sliderMatch[2]),
                value: null,
                min: null,
                default: null,
                max: null,
                stops: []
            };
            while (index + 1 < lines.length && lines[index + 1].trim().startsWith("#")) {
                const stopLine = lines[++index].trim().slice(1).trim();
                const stopMatch = stopLine.match(/^(.+?)\s*\[\s*(-?\d+(?:\.\d+)?)\s*\]$/);
                if (!stopMatch) continue;

                const name = stopMatch[1].trim();
                const value = Number(stopMatch[2]);
                if (!name || !Number.isFinite(value)) continue;

                const directive = name.toLowerCase();
                if (directive === "min" || directive === "default" || directive === "max") {
                    slider[directive] = value;
                }
                slider.stops.push({ name, value });
            }
            if (slider.min !== null && slider.default !== null && slider.max !== null
                && slider.min < slider.max
                && slider.default >= slider.min && slider.default <= slider.max) {
                slider.value = slider.default;
                slider.stops = slider.stops
                    .filter(stop => stop.value >= slider.min && stop.value <= slider.max)
                    .sort((a, b) => a.value - b.value);
                if (!Number.isFinite(slider.step) || slider.step <= 0) continue;
                settings[section] = settings[section] || {};
                settings[section][key] = slider;
            }
            continue;
        }
        if (line.startsWith("#")) continue;
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
