// Change file paths here.
const pointscfg_file = "./data/achievements/config/points.skvwcfgml";
const milestonescfg_file = "./data/achievements/config/milestones.skvwcfgml";
const indexmeta_file = "./data/achievements/index.skvwmeta";
const history_file = "./history/achievements.skvwhist";

(() => {
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
        const gameProgressStorageKey = "skvwaffle.game-achievement-progress.v1";
        let gameProgress = loadGameProgress();
        let achievementsLoadPromise = null;

        const config = {
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

        function loadAllFromDirectoryIndex() {
            if (!achievementsLoadPromise) {
                achievementsLoadPromise = (async () => {
                    const list = await loaders.loadAllFromDirectoryIndex();
                    await loadUserProfile();
                    // Baseline so existing progress doesn't retrigger popups on page load.
                    state.lastMilestonePoints = getSummary(state).unlockedPoints;
                    renderers.renderAll();
                    renderers.renderMilestones();
                    if (onRender) onRender(getSummary(state));
                    return list;
                })();
            }
            return achievementsLoadPromise;
        }

        function loadGameProgress() {
            const emptyProgress = {
                mastermind: { solves: 0 },
                chess: { games: 0, analyses: 0, openings: [] }
            };
            try {
                const saved = JSON.parse(localStorage.getItem(gameProgressStorageKey) || "null");
                if (!saved || saved.version !== 1) return emptyProgress;
                return {
                    mastermind: {
                        solves: Number.isInteger(saved.mastermind?.solves) && saved.mastermind.solves >= 0
                            ? saved.mastermind.solves
                            : 0
                    },
                    chess: {
                        games: Number.isInteger(saved.chess?.games) && saved.chess.games >= 0
                            ? saved.chess.games
                            : 0,
                        analyses: Number.isInteger(saved.chess?.analyses) && saved.chess.analyses >= 0
                            ? saved.chess.analyses
                            : 0,
                        openings: Array.isArray(saved.chess?.openings)
                            ? [...new Set(saved.chess.openings.filter(name => typeof name === "string"))]
                            : []
                    }
                };
            } catch (error) {
                console.warn("Could not load saved game achievement progress.", error);
                return emptyProgress;
            }
        }

        function saveGameProgress() {
            try {
                localStorage.setItem(gameProgressStorageKey, JSON.stringify({
                    version: 1,
                    ...gameProgress
                }));
            } catch (error) {
                console.warn("Could not save game achievement progress.", error);
            }
        }

        async function recordGameEvent(gameName, eventName, details = {}) {
            if (!achievementsLoadPromise) await loadAllFromDirectoryIndex();
            else await achievementsLoadPromise;

            const unlockedIds = [];
            if (gameName === "main" && eventName === "cloak-used") {
                unlockedIds.push("main:beginning");
            } else if (gameName === "main" && eventName === "channel-joined") {
                unlockedIds.push("main:channel-join");
            } else if (gameName === "main" && eventName === "channel-created") {
                unlockedIds.push("main:channel-host");
            } else if (gameName === "main" && eventName === "gif-sent") {
                unlockedIds.push("main:gif-sender");
            } else if (gameName === "mastermind" && eventName === "solved") {
                gameProgress.mastermind.solves += 1;
                unlockedIds.push("mastermind:beginner");
                if (Number.isInteger(details.guesses) && details.guesses <= 5) {
                    unlockedIds.push("mastermind:codebreaker");
                }
                if (details.difficulty === "hard") {
                    unlockedIds.push("mastermind:hard-mode");
                }
                if (gameProgress.mastermind.solves >= 10) {
                    unlockedIds.push("mastermind:master");
                }
            } else if (gameName === "chess" && eventName === "completed") {
                gameProgress.chess.games += 1;
                unlockedIds.push("chess:first-game");
                if (gameProgress.chess.games >= 10) {
                    unlockedIds.push("chess:ten-games");
                }
                if (details.winner === "white" || details.winner === "black") {
                    unlockedIds.push("chess:checkmate");
                }
            } else if (gameName === "chess" && eventName === "analyzed") {
                gameProgress.chess.analyses += 1;
                unlockedIds.push("chess:first-analysis");
                if (gameProgress.chess.analyses >= 10) {
                    unlockedIds.push("chess:ten-analyses");
                }
            } else if (gameName === "chess" && eventName === "opening-discovered") {
                const opening = typeof details.name === "string" ? details.name.trim() : "";
                if (opening && !gameProgress.chess.openings.includes(opening)) {
                    gameProgress.chess.openings.push(opening);
                    unlockedIds.push("chess:first-opening");
                    if (gameProgress.chess.openings.length >= 5) {
                        unlockedIds.push("chess:opening-collector");
                    }
                }
            } else {
                console.warn(`Ignoring unknown game achievement event: ${gameName}.${eventName}`);
                return false;
            }

            saveGameProgress();
            await Promise.all(unlockedIds.map(id => unlock(id)));
            return true;
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
            renderers.renderAll(); renderers.showUnlockPopup(achievement);
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
                return null;
            }
            return data;
        }

        async function syncUnlockToSupabase(achievementId) {
            if (typeof _supabase === "undefined") return;
            const { data: { user } } = await _supabase.auth.getUser();
            if (!user) return; 
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
            delete state.completionMap[id]; renderers.renderAll();
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
            recordGameEvent,
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
