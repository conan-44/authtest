// Change file paths here.
const pointscfg_file = "./data/achievements/config/points.skvwcfgml";
const milestonescfg_file = "./data/achievements/config/milestones.skvwcfgml";
const indexmeta_file = "./data/achievements/index.skvwmeta";
const history_file = "./history/achievements.skvwhist";

(() => {
    const SECRET_KEY = "demo_game_achievements";
    const { getSummary, isCompleted } = window.AchievementLib;

    function createAchievementModule(options = {}) {
        const state = {
            achievementsMap: new Map(),
            completionMap: {},
            bonusPoints: 0,
            pointsConfig: { common: 10, rare: 25, epic: 50, legendary: 80, secret_default: 100 },
            milestones: [],
            lastMilestonePoints: 0,
            profile: null
        };

        const config = {
            storageKey: options.storageKey || SECRET_KEY,
            indexUrl: options.indexUrl || indexmeta_file,
            pointsConfigUrl: options.pointsConfigUrl || pointscfg_file,
            milestonesConfigUrl: options.milestonesConfigUrl || milestonescfg_file
        };

        const elements = {
            gridEl: options.gridElement,
            scoreEl: options.scoreElement,
            popupContainer: options.popupContainer,
            milestonesGridEl: options.milestonesGridElement
        };

        const onRender = typeof options.onRender === "function" ? options.onRender : null;

        const loaders = window.AchievementLib.createLoaders(state, config);
        const renderers = window.AchievementLib.createRenderers(state, elements);

        const savedState = loaders.loadState();
        state.completionMap = savedState.completionMap;
        state.bonusPoints = savedState.bonusPoints;

        async function loadAllFromDirectoryIndex() {
            const list = await loaders.loadAllFromDirectoryIndex();
            await loadUserProfile();
            // Baseline so existing progress doesn't retrigger popups on page load.
            state.lastMilestonePoints = getSummary(state).unlockedPoints;
            renderers.renderAll();
            renderers.renderMilestones();
            if (onRender) onRender(getSummary(state));
            return list;
        }

        async function loadUserProfile(userId) {
            if (typeof _supabase === "undefined") return null;

            if (!userId) {
                const { data: { user } } = await _supabase.auth.getUser();
                if (!user) return null; // Guest mode / not logged in
                userId = user.id;
            }

            const { data: profile } = await _supabase
                .from('profiles')
                .select('username, flair')
                .eq('id', userId)
                .maybeSingle();
            state.profile = profile || null;

            const { data, error } = await _supabase
                .from('user_stats')
                .select('achievements')
                .eq('user_id', userId)
                .single();

            if (error) {
                console.error("Error fetching stats:", error.message);
                return state.profile;
            }

            console.log("Unlocked Achievements Array:", data.achievements);

            (data.achievements || []).forEach(achievementId => {
                if (!state.completionMap[achievementId]) {
                    state.completionMap[achievementId] = { unlockedAt: Date.now() };
                }
            });
            loaders.saveState();
            return state.profile;
        }

        function executeCodeCommand(commandString) {
            if (!commandString || typeof commandString !== "string") return false;
            const cleanCmd = commandString.trim().replace(/^\//, "");
            const pointsMatch = cleanCmd.match(/^points\s*\(\s*(add|remove|reach|calc)\s*\(\s*(?:"([^"]+)"|'([^']+)'|(-?\d+(?:\.\d+)?))\s*\)\s*\)$/i);
            if (pointsMatch) {
                const action = pointsMatch[1].toLowerCase();
                const value = pointsMatch[2] || pointsMatch[3] || pointsMatch[4];
                return executePointsCommand(action, value);
            }
            const commandParts = cleanCmd.split(/\s+/);
            if (["achieve", "achievement"].includes(commandParts[0].toLowerCase())) commandParts.shift();
            const command = commandParts.join(" ");
            const targetMatch = command.match(/^([^:\s]+):([^\.\s]+)\.(unlock|revoke)$/i) || command.match(/^([^:\s]+):([^\.\s]+)\s+(unlock|revoke)$/i);
            const actionFirstMatch = command.match(/^(unlock|revoke)\s+([^:\s]+):([^\.\s]+)$/i);
            const match = targetMatch || actionFirstMatch;
            if (!match) return false;
            const namespace = targetMatch ? match[1] : match[2];
            const name = targetMatch ? match[2] : match[3];
            const action = (targetMatch ? match[3] : match[1]).toLowerCase();
            return action === "unlock" ? unlock(`${namespace}:${name}`) : revoke(`${namespace}:${name}`);
        }

        function getMilestoneTarget(value) {
            const normalized = value.toLowerCase().replace(/\.until$/, "");
            const milestone = state.milestones.find(item => item.name.toLowerCase() === normalized);
            return milestone ? milestone.points : null;
        }

        function getPointsNeeded(value) {
            const target = getMilestoneTarget(value);
            if (target === null) return null;
            return Math.max(target - getSummary(state).unlockedPoints, 0);
        }

        function calculateRarityNeeds(pointsNeeded) {
            const rarityPoints = {
                common: state.pointsConfig.common,
                rare: state.pointsConfig.rare,
                epic: state.pointsConfig.epic,
                legendary: state.pointsConfig.legendary,
                secret: state.pointsConfig.secret_default
            };
            return Object.fromEntries(Object.entries(rarityPoints)
                .filter(([, points]) => Number.isFinite(points) && points > 0)
                .map(([rarity, points]) => [rarity, Math.ceil(pointsNeeded / points)]));
        }

        async function executePointsCommand(action, value) {
            if (action === "calc") {
                const pointsNeeded = getPointsNeeded(value);
                if (pointsNeeded === null) return false;
                const rarities = calculateRarityNeeds(pointsNeeded);
                console.log(`Required points: ${pointsNeeded}`);
                console.log(`Achievements: ${Object.entries(rarities).map(([rarity, count]) => `${rarity}: ${count}`).join(" | ")}`);
                return { pointsNeeded, rarities };
            }
            const previousBonus = state.bonusPoints;
            if (action === "reach") {
                const pointsNeeded = getPointsNeeded(value);
                if (pointsNeeded === null) return false;
                state.bonusPoints += pointsNeeded;
            } else {
                const amount = value.toLowerCase() === "all" ? state.bonusPoints : (value.endsWith(".until") ? getPointsNeeded(value) : Number(value));
                if (!Number.isFinite(amount) || amount < 0) return false;
                state.bonusPoints = action === "add" ? state.bonusPoints + amount : Math.max(state.bonusPoints - amount, 0);
            }
            loaders.saveState();
            renderers.renderAll();
            checkMilestones();
            if (onRender) onRender(getSummary(state));
            const delta = state.bonusPoints - previousBonus;
            if (delta !== 0) await syncPointsToSupabase(delta);
            return getSummary(state).unlockedPoints;
        }

        async function unlock(id) {
            const achievement = state.achievementsMap.get(id);
            if (!achievement || state.completionMap[id]) return false;
            state.completionMap[id] = { unlockedAt: Date.now() };
            loaders.saveState(); renderers.renderAll(); renderers.showUnlockPopup(achievement);
            checkMilestones();
            if (onRender) onRender(getSummary(state));
            console.log(`[Achievement] Unlocked: ${id} (+${achievement.points} pts)`);
            await syncUnlockToSupabase(id);
            return true;
        }

        async function getUserStats(userId) {
            if (typeof _supabase === "undefined") return null;
            const { data, error } = await _supabase
                .from('user_stats')
                .select('points, achievements')
                .eq('user_id', userId)
                .single();

            if (error) {
                console.error("Error fetching stats:", error.message);
                return null;
            }
            return data;
        }

        async function syncUnlockToSupabase(achievementId) {
            if (typeof _supabase === "undefined") return;
            const { data: { user } } = await _supabase.auth.getUser();
            if (!user) return; // Guest mode / not logged in

            if (typeof printLog === "function") printLog(`Unlocking achievement: ${achievementId}...`);

            const stats = await getUserStats(user.id);
            const currentList = stats?.achievements || [];
            if (currentList.includes(achievementId)) {
                console.log(`Achievement '${achievementId}' already unlocked.`);
                return;
            }
            const updatedList = [...currentList, achievementId];

            const { error } = await _supabase
                .from('user_stats')
                .update({ achievements: updatedList })
                .eq('user_id', user.id);
            if (error) console.error("Error unlocking achievement:", error.message);
            else console.log(`\uD83C\uDFC6 Unlocked: ${achievementId}`);
        }

        async function syncPointsToSupabase(amount) {
            if (typeof _supabase === "undefined") return;
            const { data: { user } } = await _supabase.auth.getUser();
            if (!user) return; // Guest mode / not logged in

            const stats = await getUserStats(user.id);
            const newTotal = (stats?.points || 0) + amount;

            const { error } = await _supabase
                .from('user_stats')
                .update({ points: newTotal })
                .eq('user_id', user.id);
            if (error) console.error("Error updating points:", error.message);
            else console.log(`Added ${amount} points! New total: ${newTotal}`);
        }

        function revoke(id) {
            if (!state.achievementsMap.has(id) || !state.completionMap[id]) return false;
            delete state.completionMap[id]; loaders.saveState(); renderers.renderAll();
            state.lastMilestonePoints = Math.min(state.lastMilestonePoints, getSummary(state).unlockedPoints);
            renderers.renderMilestones();
            if (onRender) onRender(getSummary(state));
            console.log(`[Achievement] Revoked: ${id}`);
            return true;
        }

        function checkMilestones() {
            const unlockedPoints = getSummary(state).unlockedPoints;
            const crossed = state.milestones.filter(milestone => milestone.points > state.lastMilestonePoints && milestone.points <= unlockedPoints);
            state.lastMilestonePoints = unlockedPoints;
            renderers.renderMilestones();
            crossed.forEach(renderers.showMilestonePopup);
        }

        function reset() {
            state.completionMap = {};
            state.bonusPoints = 0;
            loaders.saveState();
            state.lastMilestonePoints = 0;
            renderers.renderAll();
            renderers.renderMilestones();
            if (onRender) onRender(getSummary(state));
            console.log("[Achievement] All progress reset.");
        }

        return {
            loadAllFromDirectoryIndex,
            loadAchievement: loaders.loadAchievement,
            loadUserProfile,
            executeCodeCommand,
            points: command => {
                if (command && typeof command === "object") return executePointsCommand(command.action, command.value);
                return executeCodeCommand(command.startsWith("points") ? command : `points(${command})`);
            },
            unlock,
            revoke,
            reset,
            isCompleted: id => isCompleted(state, id),
            getSummary: () => getSummary(state),
            getAchievements: () => Array.from(state.achievementsMap.values()),
            getMilestones: () => state.milestones.slice(),
            getProfile: () => state.profile
        };    }

    window.AchievementModule = { create: createAchievementModule };

    const gridEl = document.getElementById("achievementsGrid");
    const scoreEl = document.getElementById("scoreTracker");
    const popupEl = document.getElementById("popupStack");
    const milestonesGridEl = document.getElementById("milestonesGrid");
    const versionEl = document.getElementById("versionIndicator");

    async function loadVersionIndicator() {
        try {
            const response = await fetch(history_file, { cache: "no-store" });
            if (!response.ok) throw new Error(`Failed to read history file from ${history_file}`);
            const lastEntry = (await response.text())
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line && !line.startsWith("#"))
                .at(-1);
            if (!lastEntry) throw new Error("History file contains no version entries.");
            let entry = lastEntry.split(":", 1)[0];
            let entrytempa = entry.slice(0, 4); 
            let entrytempb = entry.slice(4);
            entry = entrytempa.concat(" v", entrytempb);
            if (entry.includes("pr")) versionEl.textContent = `prerelease ${entry.split("pr", 1)[0]}`;
            if (entry.includes("ex")) versionEl.textContent = `experiment ${entry.split("ex", 1)[0]}`;
            if (!entry.includes("pr") && !entry.includes("ex")) {
                let buildlist = entry.split("-", 2);
                if (buildlist[1] === "x") buildlist[1] = "first subrelease"
                else buildlist[1] = `subrelease ${buildlist[1]}`;
                versionEl.innerHTML = `build ${buildlist[0]}<br>${buildlist[1]}`;
            }
        } catch (error) {
            console.warn("Could not load version indicator.", error);
            versionEl.textContent = "build unavailable";
        }
    }

    const achievements = window.AchievementModule.create({
        storageKey: "sample_game_achievements",
        indexUrl: indexmeta_file,
        pointsConfigUrl: pointscfg_file,
        milestonesConfigUrl: milestonescfg_file,
        gridElement: gridEl,
        scoreElement: scoreEl,
        popupContainer: popupEl,
        milestonesGridElement: milestonesGridEl
    });

    achievements.loadAllFromDirectoryIndex().catch(error => {
        console.error(error);
        gridEl.innerHTML = "<p>Could not load achievements list from data/achievements/index.skvwmeta.</p>";
    });
    loadVersionIndicator();

    window.achieve = command => achievements.executeCodeCommand(command);
    window.points = command => achievements.points(command);
    window.add = value => ({ action: "add", value: String(value) });
    window.remove = value => ({ action: "remove", value: String(value) });
    window.reach = value => ({ action: "reach", value: String(value) });
    window.calc = value => ({ action: "calc", value: String(value) });
    window.achievements = achievements;
})();

