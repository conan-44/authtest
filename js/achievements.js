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
            completionMap: loadCompletionMap(),
            bonusPoints: 0,
            pointsConfig: { common: 10, rare: 25, epic: 50, legendary: 80, secret_default: 100 },
            milestones: [],
            lastMilestonePoints: 0,
            profile: null
        };
        const gameProgressStorageKey = "skvwaffle.game-achievement-progress.v1";
        let gameProgress = loadGameProgress();
        let achievementsLoadPromise = null;
        let unlockSyncQueue = Promise.resolve();

        function loadCompletionMap() {
            try {
                const saved = JSON.parse(localStorage.getItem("skvwaffle.unlocked-achievements.v1") || "[]");
                if (!Array.isArray(saved)) return {};
                return Object.fromEntries([...new Set(saved.filter(id => typeof id === "string"))]
                    .map(id => [id, { unlockedAt: Date.now() }]));
            } catch (error) {
                console.warn("Could not load locally saved achievements.", error);
                return {};
            }
        }

        function saveCompletionMap() {
            try {
                localStorage.setItem(
                    "skvwaffle.unlocked-achievements.v1",
                    JSON.stringify(Object.keys(state.completionMap))
                );
            } catch (error) {
                console.warn("Could not save unlocked achievements locally.", error);
            }
        }

        async function getAuthenticatedUser() {
            if (typeof _supabase === "undefined") return null;
            try {
                const { data, error } = await _supabase.auth.getUser();
                if (error) {
                    if (error.name === "AuthSessionMissingError") return null;
                    throw error;
                }
                return data?.user || null;
            } catch (error) {
                if (error?.name === "AuthSessionMissingError") return null;
                throw error;
            }
        }

        const config = {
            indexUrl: options.indexUrl || indexmeta_file,
            pointsConfigUrl: options.pointsConfigUrl || pointscfg_file,
            milestonesConfigUrl: options.milestonesConfigUrl || milestonescfg_file
        };

        const elements = {
            gridEl: options.gridElement,
            scoreEl: options.scoreElement,
            popupContainer: options.popupContainer,
            milestonesGridEl: options.milestonesGridElement,
            listViewElement: options.listViewElement,
            treeViewElement: options.treeViewElement,
            treeTabsElement: options.treeTabsElement,
            treeCanvasElement: options.treeCanvasElement,
            treeToggleElement: options.treeToggleElement
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
                main: { messages: 0, profilesViewed: 0 },
                mastermind: { solves: 0, solvedDifficulties: [] },
                chess: { games: 0, analyses: 0, openings: [] },
                numberPillars: { completed: 0, bestStreak: 0, totalXp: 0, customLevels: 0 },
                blackjack: { hands: 0, wins: 0, naturals: 0, busts: 0, fiveCardHands: 0, winStreak: 0 },
                douDizhu: { games: 0, wins: 0, landlordWins: 0, landlordWinStreak: 0, farmerWins: 0, bombs: 0, rockets: 0, twos: 0, jokers: 0, analyses: 0 }
            };
            try {
                const saved = JSON.parse(localStorage.getItem(gameProgressStorageKey) || "null");
                if (!saved || ![1, 2, 3, 4].includes(saved.version)) return emptyProgress;
                return {
                    main: Object.fromEntries(Object.keys(emptyProgress.main).map(key => [
                        key,
                        Number.isInteger(saved.main?.[key]) && saved.main[key] >= 0 ? saved.main[key] : 0
                    ])),
                    mastermind: {
                        solves: Number.isInteger(saved.mastermind?.solves) && saved.mastermind.solves >= 0
                            ? saved.mastermind.solves
                            : 0,
                        solvedDifficulties: Array.isArray(saved.mastermind?.solvedDifficulties)
                            ? [...new Set(saved.mastermind.solvedDifficulties.filter(level => (
                                ["easy", "medium", "hard"].includes(level)
                            )))]
                            : []
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
                    },
                    numberPillars: {
                        completed: Number.isInteger(saved.numberPillars?.completed) && saved.numberPillars.completed >= 0
                            ? saved.numberPillars.completed
                            : 0,
                        bestStreak: Number.isInteger(saved.numberPillars?.bestStreak) && saved.numberPillars.bestStreak >= 0
                            ? saved.numberPillars.bestStreak
                            : 0,
                        totalXp: Number.isInteger(saved.numberPillars?.totalXp) && saved.numberPillars.totalXp >= 0
                            ? saved.numberPillars.totalXp
                            : 0,
                        customLevels: Number.isInteger(saved.numberPillars?.customLevels) && saved.numberPillars.customLevels >= 0
                            ? saved.numberPillars.customLevels
                            : 0
                    },
                    blackjack: Object.fromEntries(Object.keys(emptyProgress.blackjack).map(key => [
                        key,
                        Number.isInteger(saved.blackjack?.[key]) && saved.blackjack[key] >= 0
                            ? saved.blackjack[key]
                            : 0
                    ])),
                    douDizhu: Object.fromEntries(Object.keys(emptyProgress.douDizhu).map(key => [
                        key,
                        Number.isInteger(saved.douDizhu?.[key]) && saved.douDizhu[key] >= 0
                            ? saved.douDizhu[key]
                            : 0
                    ]))
                };
            } catch (error) {
                console.warn("Could not load saved game achievement progress.", error);
                return emptyProgress;
            }
        }

        function saveGameProgress() {
            try {
                localStorage.setItem(gameProgressStorageKey, JSON.stringify({
                    version: 4,
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
            } else if (gameName === "main" && eventName === "message-sent") {
                gameProgress.main.messages += 1;
                unlockedIds.push("main:first-message");
                if (gameProgress.main.messages >= 25) unlockedIds.push("main:chat-regular");
            } else if (gameName === "main" && eventName === "profile-viewed") {
                gameProgress.main.profilesViewed += 1;
                if (gameProgress.main.profilesViewed >= 10) unlockedIds.push("main:profile-explorer");
            } else if (gameName === "mastermind" && eventName === "solved") {
                gameProgress.mastermind.solves += 1;
                unlockedIds.push("mastermind:beginner");
                if (details.difficulty === "easy") unlockedIds.push("mastermind:easy-solve");
                if (["easy", "medium", "hard"].includes(details.difficulty)
                    && !gameProgress.mastermind.solvedDifficulties.includes(details.difficulty)) {
                    gameProgress.mastermind.solvedDifficulties.push(details.difficulty);
                }
                if (gameProgress.mastermind.solvedDifficulties.length === 3) {
                    unlockedIds.push("mastermind:all-difficulties");
                }
                if (Number.isInteger(details.guesses) && details.guesses <= 5) {
                    unlockedIds.push("mastermind:codebreaker");
                }
                if (details.difficulty === "hard") {
                    unlockedIds.push("mastermind:hard-mode");
                }
                if (gameProgress.mastermind.solves >= 10) {
                    unlockedIds.push("mastermind:master");
                }
                if (gameProgress.mastermind.solves >= 25) {
                    unlockedIds.push("mastermind:twenty-five");
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
            } else if (gameName === "chess" && eventName === "special-move") {
                if (details.castling) {
                    unlockedIds.push("chess:castle-first");
                    if (details.checkmate) unlockedIds.push("chess:castle-mate");
                }
                if (details.enPassant) unlockedIds.push("chess:enpassant-first");
            } else if (gameName === "chess" && eventName === "special-move-analyzed") {
                if (details.castling && details.quality === "Blunder") {
                    unlockedIds.push("chess:castle-blunder");
                }
                if (details.enPassant && details.quality === "Blunder") {
                    unlockedIds.push("chess:enpassant-blunder");
                }
                if (details.enPassant && details.quality === "Great") {
                    unlockedIds.push("chess:enpassant-great");
                }
            } else if (gameName === "number-pillars" && eventName === "level-completed") {
                gameProgress.numberPillars.completed += 1;
                gameProgress.numberPillars.bestStreak = Math.max(
                    gameProgress.numberPillars.bestStreak,
                    Number.isInteger(details.streak) && details.streak > 0 ? details.streak : 0
                );
                gameProgress.numberPillars.totalXp +=
                    Number.isInteger(details.earnedXp) && details.earnedXp > 0 ? details.earnedXp : 0;
                unlockedIds.push("number-pillars:first-win");
                if (gameProgress.numberPillars.bestStreak >= 5) {
                    unlockedIds.push("number-pillars:streak-five");
                }
                if (gameProgress.numberPillars.totalXp >= 100) {
                    unlockedIds.push("number-pillars:xp-hundred");
                }
                if (gameProgress.numberPillars.completed >= 10) {
                    unlockedIds.push("number-pillars:ten-levels");
                }
                if (gameProgress.numberPillars.bestStreak >= 10) {
                    unlockedIds.push("number-pillars:streak-ten");
                }
                if (details.difficulty === "hard") {
                    unlockedIds.push("number-pillars:hard-clear");
                }
            } else if (gameName === "number-pillars" && eventName === "custom-level-played") {
                gameProgress.numberPillars.customLevels += 1;
                unlockedIds.push("number-pillars:custom-level");
            } else if (gameName === "blackjack" && eventName === "round-completed") {
                gameProgress.blackjack.hands += 1;
                unlockedIds.push("blackjack:first-hand");
                if (details.status === "blackjack") {
                    gameProgress.blackjack.naturals += 1;
                    unlockedIds.push("blackjack:natural");
                }
                if (details.status === "bust") {
                    gameProgress.blackjack.busts += 1;
                    unlockedIds.push("blackjack:busted");
                }
                if (Number.isInteger(details.playerCards) && details.playerCards >= 5) {
                    gameProgress.blackjack.fiveCardHands += 1;
                    unlockedIds.push("blackjack:five-card-hand");
                }
                if (details.status === "win" || details.status === "blackjack") {
                    gameProgress.blackjack.wins += 1;
                    gameProgress.blackjack.winStreak += 1;
                    unlockedIds.push("blackjack:first-win");
                    if (gameProgress.blackjack.wins >= 10) unlockedIds.push("blackjack:ten-wins");
                    if (gameProgress.blackjack.winStreak >= 3) unlockedIds.push("blackjack:hot-streak");
                } else {
                    gameProgress.blackjack.winStreak = 0;
                }
            } else if (gameName === "dou-dizhu" && eventName === "round-completed") {
                gameProgress.douDizhu.games += 1;
                unlockedIds.push("dou-dizhu:first-game");
                if (gameProgress.douDizhu.games >= 5) unlockedIds.push("dou-dizhu:five-games");
                if (details.won) {
                    gameProgress.douDizhu.wins += 1;
                    unlockedIds.push("dou-dizhu:first-win");
                    if (details.humanWasLandlord) {
                        gameProgress.douDizhu.landlordWins += 1;
                        gameProgress.douDizhu.landlordWinStreak += 1;
                        unlockedIds.push("dou-dizhu:landlord-win");
                        if (gameProgress.douDizhu.landlordWinStreak >= 5) {
                            unlockedIds.push("dou-dizhu:landlord-five-streak");
                        }
                    } else {
                        gameProgress.douDizhu.landlordWinStreak = 0;
                        gameProgress.douDizhu.farmerWins += 1;
                        unlockedIds.push("dou-dizhu:farmer-win");
                    }
                } else {
                    gameProgress.douDizhu.landlordWinStreak = 0;
                }
            } else if (gameName === "dou-dizhu" && eventName === "special-played") {
                if (details.bomb) {
                    gameProgress.douDizhu.bombs += 1;
                    unlockedIds.push("dou-dizhu:bomb");
                }
                if (details.rocket) {
                    gameProgress.douDizhu.rockets += 1;
                    unlockedIds.push("dou-dizhu:rocket");
                }
                if (details.playedTwo) {
                    gameProgress.douDizhu.twos += 1;
                    unlockedIds.push("dou-dizhu:two");
                }
                if (details.playedJoker) {
                    gameProgress.douDizhu.jokers += 1;
                    unlockedIds.push("dou-dizhu:joker");
                }
            } else if (gameName === "dou-dizhu" && eventName === "analyzed") {
                gameProgress.douDizhu.analyses += 1;
                unlockedIds.push("dou-dizhu:first-analysis");
                if (gameProgress.douDizhu.analyses >= 10) unlockedIds.push("dou-dizhu:ten-analyses");
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
                const user = await getAuthenticatedUser();
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

            if (data.achievements !== null && data.achievements !== undefined && !Array.isArray(data.achievements)) {
                console.error("Supabase returned achievements in an unexpected format.", data.achievements);
                return state.profile;
            }
            (data.achievements || []).filter(achievementId => typeof achievementId === "string").forEach(achievementId => {
                if (!state.completionMap[achievementId]) {
                    state.completionMap[achievementId] = { unlockedAt: Date.now() };
                }
            });
            saveCompletionMap();
            await syncUnlocksToSupabase(Object.keys(state.completionMap));
            return state.profile;
        }

        window.addEventListener("app-auth-state-changed", event => {
            const userId = event.detail?.userId;
            if (!userId) return;
            loadUserProfile(userId).then(() => {
                state.lastMilestonePoints = getSummary(state).unlockedPoints;
                renderers.renderAll();
                renderers.renderMilestones();
                if (onRender) onRender(getSummary(state));
            }).catch(error => {
                console.error("Could not load achievements after authentication changed.", error);
            });
        });

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
            saveCompletionMap();
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

        function syncUnlockToSupabase(achievementId) {
            return syncUnlocksToSupabase([achievementId]);
        }

        function syncUnlocksToSupabase(achievementIds) {
            unlockSyncQueue = unlockSyncQueue.then(async () => {
                if (typeof _supabase === "undefined") return;
                const user = await getAuthenticatedUser();
                if (!user) return;
                if (typeof printLog === "function") printLog("Syncing unlocked achievements...");

                const { data, error: readError } = await _supabase
                    .from('user_stats')
                    .select('achievements')
                    .eq('user_id', user.id)
                    .single();
                if (readError) throw readError;
                if (data?.achievements !== null && !Array.isArray(data?.achievements)) {
                    throw new TypeError("Supabase returned achievements in an unexpected format.");
                }
                const currentList = (data?.achievements || []).filter(id => typeof id === "string");
                const updatedList = [...new Set([...currentList, ...achievementIds.filter(id => typeof id === "string")])];
                if (updatedList.length === currentList.length) return;

                const { error: updateError } = await _supabase
                    .from('user_stats')
                    .update({ achievements: updatedList })
                    .eq('user_id', user.id);
                if (updateError) throw updateError;
                console.log(`🏆 Synced ${updatedList.length - currentList.length} unlocked achievement(s).`);
            }).catch(error => {
                console.error("Error syncing unlocked achievements to Supabase.", error);
            });
            return unlockSyncQueue;
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
            saveCompletionMap();
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
            saveCompletionMap();
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
    const listViewEl = document.getElementById("achievementListView");
    const treeViewEl = document.getElementById("achievementTreeView");
    const treeTabsEl = document.getElementById("achievementTreeTabs");
    const treeCanvasEl = document.getElementById("achievementTreeCanvas");
    const treeToggleEl = document.getElementById("toggleAchievementTreeBtn");
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
        milestonesGridElement: milestonesGridEl,
        listViewElement: listViewEl,
        treeViewElement: treeViewEl,
        treeTabsElement: treeTabsEl,
        treeCanvasElement: treeCanvasEl,
        treeToggleElement: treeToggleEl
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
