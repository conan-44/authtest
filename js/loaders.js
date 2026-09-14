window.AchievementLib = window.AchievementLib || {};

// Builds the fetch functions bound to one module instance's state and file paths.
window.AchievementLib.createLoaders = function createLoaders(state, config) {
    const { parseJsonWithComments, parseYamlSimple, parseMilestonesConfig, sanitizeRarity } = window.AchievementLib;

    async function loadPointsConfig() {
        try {
            const response = await fetch(config.pointsConfigUrl, { cache: "no-store" });
            if (response.ok) state.pointsConfig = { ...state.pointsConfig, ...parseYamlSimple(await response.text()) };
        } catch (error) {
            console.info("Points config file not found. Using defaults.");
        }
    }

    async function loadMilestonesConfig() {
        try {
            const response = await fetch(config.milestonesConfigUrl, { cache: "no-store" });
            if (response.ok) state.milestones = parseMilestonesConfig(await response.text());
        } catch (error) {
            console.info("Milestones config file not found.");
        }
    }

    function getAchievementPoints(id, rarity) {
        if (rarity === "secret") {
            return typeof state.pointsConfig[id] === "number" ? state.pointsConfig[id] : (state.pointsConfig.secret_default || 100);
        }
        return state.pointsConfig[rarity] || state.pointsConfig.common || 10;
    }

    async function loadAchievement(namespace, id) {
        const fullId = `${namespace}:${id}`;
        const url = `./data/achievements/${namespace}/${id}.json`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`Failed to load achievement from ${url}`);
        const item = parseJsonWithComments(await response.text());
        const rarity = sanitizeRarity(item.rarity);
        const achievement = {
            id: fullId, namespace, key: id,
            title: String(item.title || "Untitled Achievement"),
            description: item.description == null ? "" : String(item.description),
            icon: String(item.icon || "??"), rarity,
            points: getAchievementPoints(fullId, rarity)
        };
        state.achievementsMap.set(fullId, achievement);
        return achievement;
    }

    async function loadAllFromDirectoryIndex() {
        await Promise.all([loadPointsConfig(), loadMilestonesConfig()]);
        const response = await fetch(config.indexUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`Failed to read index file from ${config.indexUrl}`);
        const textData = await response.text();
        let list;
        try { list = parseJsonWithComments(textData); }
        catch (error) { list = textData.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#")); }
        state.achievementsMap.clear();
        await Promise.all(list.map(item => {
            if (typeof item === "string") {
                const [namespace, id] = item.split(":");
                return loadAchievement(namespace, id).catch(error => console.warn(error.message));
            }
            return loadAchievement(item.namespace, item.id).catch(error => console.warn(error.message));
        }));
        return Array.from(state.achievementsMap.values());
    }

    return { loadPointsConfig, loadMilestonesConfig, getAchievementPoints, loadAchievement, loadAllFromDirectoryIndex };
};
