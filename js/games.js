// GAMES TAB (loads the actual game in place of the game list, same panel slot as achievements)
(() => {
    // Change this to adjust the embedded game frame size (any CSS size, e.g. '100%', '900px')
    const GAME_FRAME_WIDTH = '100%';
    const GAME_FRAME_HEIGHT = '100%';

    const gamesGrid = document.getElementById('gamesGrid');
    const gamePlayer = document.getElementById('gamePlayer');
    const gameFrame = document.getElementById('gameFrame');
    const backToGamesBtn = document.getElementById('backToGamesBtn');
    function syncGameTheme() {
        if (!gameFrame.src) return;
        try {
            if (new URL(gameFrame.src, window.location.href).origin !== window.location.origin) return;
            const parentRoot = document.documentElement;
            const gameRoot = gameFrame.contentDocument?.documentElement;
            if (!gameRoot) return;
            const parentStyles = window.getComputedStyle(parentRoot);
            const isCustomTheme = parentRoot.dataset.colorTheme === 'custom';
            const themedProperties = Array.from(gameRoot.style)
                .filter(property => property.startsWith('--color-') || property.startsWith('--theme-')
                    || property.startsWith('--shadow-'));

            themedProperties.forEach(property => {
                if (property !== '--theme-secondary' || isCustomTheme) {
                    gameRoot.style.removeProperty(property);
                }
            });
            for (let index = 0; isCustomTheme && index < parentStyles.length; index += 1) {
                const property = parentStyles[index];
                if (!property.startsWith('--color-') && !property.startsWith('--theme-')
                    && !property.startsWith('--shadow-')) continue;
                const value = parentStyles.getPropertyValue(property).trim();
                if (value) gameRoot.style.setProperty(property, value);
            }
            if (!isCustomTheme) {
                const secondary = parentStyles.getPropertyValue('--theme-secondary').trim();
                if (secondary) gameRoot.style.setProperty('--theme-secondary', secondary);
            }
        } catch (error) {
            console.warn('Could not sync the game theme.', error);
        }
    }
    gameFrame.addEventListener('load', syncGameTheme);
    const gameThemeObserver = new MutationObserver(syncGameTheme);
    gameThemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'data-color-theme']
    });
    let gameInviteChannel = null;
    let gameInviteUserId = null;
    let gameInviteSubscriptionGeneration = 0;
    const gameRatingQueues = new Map();
    const gameRatingDefaults = {
        mastermind: 1000,
        chess: 1000,
        blackjack: 1000,
        doudizhu: 1000,
        'number-pillars': 0,
        minecraft: 0,
        streetfighter: 1000
    };
    const leaderboardGames = [
        { game: 'mastermind', achievement: 'mastermind:leaderboard-champion' },
        { game: 'chess', achievement: 'chess:leaderboard-champion' },
        { game: 'blackjack', achievement: 'blackjack:leaderboard-champion' },
        { game: 'doudizhu', achievement: 'dou-dizhu:leaderboard-champion' },
        { game: 'number-pillars', achievement: 'number-pillars:leaderboard-champion' },
        { game: 'streetfighter', achievement: 'streetfighter:leaderboard-champion' }
    ];
    let leaderboardCheck = Promise.resolve();

    window.gameRatings = {
        adjust(game, amount) {
            return updateGameRating(game, amount, null);
        },
        set(game, rating) {
            return updateGameRating(game, 0, rating);
        },
        checkAchievements() {
            return checkGameRatingAchievements();
        },
        defaults: { ...gameRatingDefaults }
    };

    async function checkGameRatingAchievements() {
        const previous = leaderboardCheck;
        leaderboardCheck = previous.catch(() => {}).then(async () => {
            const { data: { user }, error: authError } = await _supabase.auth.getUser();
            if (authError) throw new Error(`Could not verify your account for leaderboard achievements: ${authError.message}`);
            if (!user || !window.achievements) return;
            await window.achievements.loadAllFromDirectoryIndex();

            const leaders = await Promise.all(leaderboardGames.map(async ({ game }) => {
                const { data, error } = await _supabase
                    .from('game_ratings')
                    .select('user_id, rating')
                    .eq('game', game)
                    .order('rating', { ascending: false })
                    .limit(2);
                if (error) throw new Error(`Could not check the ${game} leaderboard: ${error.message}`);
                const [first, second] = data || [];
                return {
                    game,
                    isUniqueLeader: first?.user_id === user.id && (!second || first.rating > second.rating)
                };
            }));

            for (const { game, achievement } of leaderboardGames) {
                if (leaders.find(leader => leader.game === game)?.isUniqueLeader) {
                    await window.achievements.unlock(achievement);
                }
            }

            const reachedEveryGame = leaderboardGames.every(({ achievement }) => (
                window.achievements.isCompleted(achievement)
            ));
            if (reachedEveryGame) await window.achievements.unlock('main:all-game-leaderboards');

            if (leaders.every(leader => leader.isUniqueLeader)) {
                await window.achievements.unlock('main:all-game-leaderboards-at-once');
            }
        });
        return leaderboardCheck;
    }

    function updateGameRating(game, delta, rating) {
        if (!Object.hasOwn(gameRatingDefaults, game)) {
            return Promise.reject(new Error(`Unknown game rating: ${game}`));
        }
        if (!Number.isSafeInteger(delta) || (rating !== null && !Number.isSafeInteger(rating))) {
            return Promise.reject(new Error('Game rating updates must use whole numbers.'));
        }
        const previous = gameRatingQueues.get(game) || Promise.resolve();
        const update = previous.catch(() => {}).then(async () => {
            const { data: { user }, error: authError } = await _supabase.auth.getUser();
            if (authError) throw new Error(`Could not verify your sign-in for game ratings: ${authError.message}`);
            if (!user) throw new Error('Sign in to save game ratings to your profile.');
            const { error } = await _supabase.rpc('update_game_rating', {
                p_game: game,
                p_delta: delta,
                p_rating: rating
            });
            if (error) throw new Error(`Could not save your ${game} rating: ${error.message}`);
            checkGameRatingAchievements().catch(error => {
                console.error('Could not update leaderboard achievements.', error);
            });
        });
        gameRatingQueues.set(game, update);
        return update.finally(() => {
            if (gameRatingQueues.get(game) === update) gameRatingQueues.delete(game);
        });
    }

    let activeGameId = null;
    let minecraftPlaytimeTimer = null;
    let minecraftLastTick = null;
    let minecraftRemainderSeconds = 0;

    function flushMinecraftPlaytime() {
        if (minecraftLastTick === null) return;
        if (document.visibilityState === 'visible') {
            minecraftRemainderSeconds += (Date.now() - minecraftLastTick) / 1000;
            const wholeMinutes = Math.floor(minecraftRemainderSeconds / 60);
            if (wholeMinutes > 0) {
                minecraftRemainderSeconds -= wholeMinutes * 60;
                window.gameRatings.adjust('minecraft', wholeMinutes).catch(error => {
                    console.error('Could not save Minecraft playtime.', error);
                });
            }
        }
        minecraftLastTick = Date.now();
    }

    function startMinecraftPlaytime() {
        window.clearInterval(minecraftPlaytimeTimer);
        minecraftRemainderSeconds = 0;
        minecraftLastTick = Date.now();
        minecraftPlaytimeTimer = window.setInterval(flushMinecraftPlaytime, 15000);
    }

    document.addEventListener('visibilitychange', () => {
        minecraftLastTick = Date.now();
    });

    window.gameMultiplayer = {
        async create(game, mode, seatCount, publicState, privateStates = {}) {
            const { data: { user }, error: authError } = await _supabase.auth.getUser();
            if (authError) throw new Error(`Could not verify your sign-in: ${authError.message}`);
            if (!user) throw new Error('Sign in before creating a multiplayer game.');
            const { data, error } = await _supabase.rpc('create_game_session', {
                p_game: game,
                p_mode: mode,
                p_seat_count: seatCount,
                p_public_state: publicState,
                p_private_states: privateStates
            });
            if (error) throw new Error(`Could not create the game: ${error.message}`);
            return data;
        },
        async join(inviteCode, game) {
            const { data: { user }, error: authError } = await _supabase.auth.getUser();
            if (authError) throw new Error(`Could not verify your sign-in: ${authError.message}`);
            if (!user) throw new Error('Sign in before joining a multiplayer game.');
            const { data, error } = await _supabase.rpc('join_game_session', {
                p_invite_code: inviteCode,
                p_game: game
            });
            if (error) throw new Error(`Could not join the game: ${error.message}`);
            return data;
        },
        async get(sessionId) {
            const { data, error } = await _supabase.rpc('get_game_session', { p_session_id: sessionId });
            if (error) throw new Error(`Could not load the game: ${error.message}`);
            return data;
        },
        async submit(sessionId, expectedVersion, nextTurn, action, publicState, privateState = {}) {
            const { data, error } = await _supabase.rpc('submit_game_move', {
                p_session_id: sessionId,
                p_expected_version: expectedVersion,
                p_next_turn: nextTurn,
                p_action: action,
                p_public_state: publicState,
                p_private_state: privateState
            });
            if (error) throw new Error(`Could not save the move: ${error.message}`);
            return data;
        },
        async sendInvite(sessionId, username) {
            const { data, error } = await _supabase.rpc('send_game_invite', {
                p_session_id: sessionId,
                p_username: username
            });
            if (error) throw new Error(`Could not send the invite: ${error.message}`);
            return data;
        },
        createInviteLink(game, inviteCode) {
            return createGameInviteLink(game, inviteCode);
        },
        async shareInviteToChat(game, inviteCode) {
            if (typeof window.shareGameInviteToChat !== 'function') {
                throw new Error('Chat sharing is unavailable.');
            }
            return window.shareGameInviteToChat(game, inviteCode);
        },
        subscribe(sessionId, onMove, onJoin, onStatus) {
            const channel = _supabase
                .channel(`game-session:${sessionId}`, { config: { private: true } })
                .on('broadcast', { event: 'move' }, ({ payload }) => onMove(payload))
                .on('broadcast', { event: 'joined' }, ({ payload }) => onJoin(payload))
                .subscribe(status => onStatus(status));
            return () => _supabase.removeChannel(channel);
        },
        async connectStreetFighter(sessionId, handlers = {}) {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
                throw new Error('This Street Fighter session is invalid.');
            }
            const channel = _supabase
                .channel(`game-session:${sessionId}`, {
                    config: { private: true, broadcast: { self: false } }
                })
                .on('broadcast', { event: 'input' }, ({ payload }) => handlers.onInput?.(payload))
                .on('broadcast', { event: 'state' }, ({ payload }) => handlers.onState?.(payload))
                .on('broadcast', { event: 'joined' }, ({ payload }) => handlers.onJoin?.(payload))
                .on('broadcast', { event: 'ready' }, ({ payload }) => handlers.onReady?.(payload))
                .on('broadcast', { event: 'denied' }, ({ payload }) => handlers.onDenied?.(payload));
            try {
                await new Promise((resolve, reject) => {
                    const timeout = window.setTimeout(() => reject(new Error('Timed out connecting to the match.')), 12000);
                    channel.subscribe(status => {
                        handlers.onStatus?.(status);
                        if (status === 'SUBSCRIBED') {
                            window.clearTimeout(timeout);
                            resolve();
                        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                            window.clearTimeout(timeout);
                            reject(new Error('Could not connect to the Street Fighter match.'));
                        }
                    });
                });
            } catch (error) {
                await _supabase.removeChannel(channel);
                throw error;
            }
            return {
                async send(event, payload) {
                    const result = await channel.send({ type: 'broadcast', event, payload });
                    if (result !== 'ok') throw new Error(`Could not send match ${event}.`);
                },
                async close() {
                    await _supabase.removeChannel(channel);
                }
            };
        }
    };

    function createGameInviteLink(game, inviteCode) {
        if (!['chess', 'doudizhu', 'streetfighter'].includes(game) || !/^[A-Z0-9]{8}$/.test(inviteCode)) {
            throw new Error('This game invite is invalid.');
        }
        const inviteUrl = new URL(window.location.href);
        inviteUrl.searchParams.set('gameInvite', `${game}:${inviteCode}`);
        inviteUrl.hash = '';
        return inviteUrl.href;
    }

    function showGameInvitePopup(payload) {
        if (
            !payload ||
            !['chess', 'doudizhu', 'streetfighter'].includes(payload.game) ||
            typeof payload.invite_code !== 'string' ||
            !/^[A-Z0-9]{8}$/.test(payload.invite_code)
        ) return;

        let stack = document.getElementById('gameInvitePopups');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'gameInvitePopups';
            stack.className = 'game-invite-popups';
            stack.setAttribute('aria-live', 'polite');
            document.body.appendChild(stack);
        }

        const popup = document.createElement('section');
        popup.className = 'game-invite-popup';
        popup.setAttribute('role', 'status');
        const message = document.createElement('p');
        const sender = typeof payload.sender_username === 'string' ? payload.sender_username : 'A player';
        const gameName = { chess: 'Chess', doudizhu: 'Dou Dizhu', streetfighter: 'Street Fighter' }[payload.game];
        message.textContent = `${sender} invited you to ${gameName}.`;
        const actions = document.createElement('div');
        actions.className = 'game-invite-popup-actions';
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.textContent = 'Join game';
        accept.addEventListener('click', () => {
            try {
                window.openGameInvite(payload.game, payload.invite_code);
                popup.remove();
            } catch (error) {
                if (typeof window.showPopup === 'function') window.showPopup(error.message, 'error');
            }
        });
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = 'Dismiss';
        dismiss.addEventListener('click', () => popup.remove());
        actions.append(accept, dismiss);
        popup.append(message, actions);
        stack.appendChild(popup);
    }

    async function subscribeGameInvites(user) {
        const nextUserId = user?.id || null;
        if (nextUserId === gameInviteUserId) return;
        const generation = ++gameInviteSubscriptionGeneration;
        const previousChannel = gameInviteChannel;
        gameInviteChannel = null;
        gameInviteUserId = nextUserId;
        if (previousChannel) await _supabase.removeChannel(previousChannel);
        if (generation !== gameInviteSubscriptionGeneration) return;
        if (!nextUserId) return;

        gameInviteChannel = _supabase
            .channel(`game-invite:${nextUserId}`, { config: { private: true } })
            .on('broadcast', { event: 'game_invite' }, ({ payload }) => showGameInvitePopup(payload))
            .subscribe(status => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error('Could not subscribe to game invites. Apply supabase/game_sessions.sql.');
                }
            });
    }

    window.openGameInvite = (game, inviteCode) => {
        if (!['chess', 'doudizhu', 'streetfighter'].includes(game) || !/^[A-Z0-9]{8}$/.test(inviteCode)) {
            throw new Error('This game invite is invalid.');
        }
        const routes = {
            chess: './minigames/chess/game.html',
            doudizhu: './minigames/cards/main.html',
            streetfighter: './minigames/street-fighter/game.html'
        };
        window.activateTab('games');
        loadGameSource(`${routes[game]}?invite=${encodeURIComponent(inviteCode)}`);
    };

    function loadGame(card) {
        const src = card.dataset.src;
        if (!src || src === 'link here') return;
        activeGameId = card.dataset.game || null;
        if (activeGameId === 'mc') startMinecraftPlaytime();
        loadGameSource(src);
    }

    function loadGameSource(src) {
        gameFrame.src = src;
        gameFrame.width = GAME_FRAME_WIDTH;
        gameFrame.height = GAME_FRAME_HEIGHT;
        gamesGrid.classList.add('is-hidden');
        gamePlayer.classList.remove('is-hidden');
    }

    window.openSharedGame = (game, data) => {
        if (game === 'game-invite') {
            window.openGameInvite(data?.game, data?.invite_code);
            return;
        }
        const routes = {
            chess: './minigames/chess/game.html',
            'number-pillars': './minigames/number-pillars/main.html'
        };
        const src = routes[game];
        if (!src || !data || typeof data !== 'object') {
            throw new Error('This shared game is not supported.');
        }
        const shared = encodeURIComponent(JSON.stringify({ game, ...data }));
        window.activateTab('games');
        loadGameSource(`${src}?shared=${shared}`);
    };

    function closeGame() {
        if (activeGameId === 'mc') {
            flushMinecraftPlaytime();
            window.clearInterval(minecraftPlaytimeTimer);
            minecraftPlaytimeTimer = null;
            minecraftLastTick = null;
        }
        activeGameId = null;
        gamePlayer.classList.add('is-hidden');
        gamesGrid.classList.remove('is-hidden');
        gameFrame.src = 'about:blank';
    }

    document.querySelectorAll('.game-card').forEach(card => {
        card.addEventListener('click', () => loadGame(card));
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                loadGame(card);
            }
        });
    });

    const gameCards = [...gamesGrid.querySelectorAll('.game-card')];
    const gamesPagination = document.getElementById('gamesPagination');
    const pageButtons = [...(gamesPagination?.querySelectorAll('button') || [])];
    let snapAnimation = null;
    let isSettling = false;
    let hoverSnapped = false;
    let selectedSlide = 0;
    let selectedVisualCard = gameCards[0];

    function getCarouselAnimation() {
        return gamesGrid.getAnimations().find(animation => animation.animationName === 'games-carousel-scroll');
    }

    function updateGamesPagination(index) {
        selectedSlide = (index + gameCards.length) % gameCards.length;
        pageButtons.forEach((button, buttonIndex) => {
            if (buttonIndex === selectedSlide) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');
        });
    }

    function getSlideOffset(indexOrCard) {
        const card = typeof indexOrCard === 'number' ? gameCards[indexOrCard] : indexOrCard;
        return card.offsetLeft - gameCards[0].offsetLeft;
    }

    function getCardSlideIndex(card) {
        return card.classList.contains('game-card-clone') ? 0 : gameCards.indexOf(card);
    }

    function isCardAligned(card) {
        const panelBounds = gamesGrid.parentElement.getBoundingClientRect();
        return Math.abs(card.getBoundingClientRect().left - panelBounds.left) < 1;
    }

    function isCardEntering(card) {
        const panelLeft = gamesGrid.parentElement.getBoundingClientRect().left;
        return card.getBoundingClientRect().left > panelLeft + 1;
    }

    function setCarouselTime(index, visualCard) {
        const animation = getCarouselAnimation();
        if (!animation) return;
        const duration = Number.parseFloat(getComputedStyle(gamesGrid).animationDuration) * 1000;
        const isLoopClone = visualCard?.classList.contains('game-card-clone');
        animation.currentTime = duration * (isLoopClone ? 1 : index / gameCards.length);
    }

    function resumeCarouselAt(index, visualCard = selectedVisualCard) {
        isSettling = false;
        snapAnimation?.cancel();
        snapAnimation = null;
        const animation = getCarouselAnimation();
        if (!animation) return;
        setCarouselTime(index, visualCard);
        animation.play();
    }

    function snapToSlide(index, resumeAfterSnap = false, visualCard = gameCards[index], force = false) {
        if (!gameCards[index]) return;
        const animation = getCarouselAnimation();
        if (resumeAfterSnap) animation?.pause();
        snapAnimation?.cancel();
        snapAnimation = null;
        selectedVisualCard = visualCard;
        isSettling = true;
        const currentTransform = new DOMMatrixReadOnly(getComputedStyle(gamesGrid).transform);
        const fromX = currentTransform.m41;
        const targetOffset = getSlideOffset(visualCard);
        const toX = -targetOffset;
        updateGamesPagination(index);
        if (Math.abs(fromX - toX) < 0.5) {
            isSettling = false;
            setCarouselTime(index, visualCard);
            if (resumeAfterSnap && !gamesGrid.querySelector('.game-card:hover, .game-card-clone:hover')) {
                resumeCarouselAt(index, visualCard);
            }
            return;
        }
        if (!force && isCardAligned(visualCard)) {
            isSettling = false;
            return;
        }
        snapAnimation = gamesGrid.animate(
            [{ transform: `translateX(${fromX}px)` }, { transform: `translateX(${toX}px)` }],
            { duration: 550, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' }
        );
        snapAnimation.onfinish = () => {
            setCarouselTime(index, visualCard);
            snapAnimation.cancel();
            snapAnimation = null;
            isSettling = false;
            const hoveredCard = gamesGrid.querySelector('.game-card:hover, .game-card-clone:hover');
            const hoveredIndex = hoveredCard ? getCardSlideIndex(hoveredCard) : -1;
            if (hoveredIndex >= 0) {
                updateGamesPagination(hoveredIndex);
                selectedVisualCard = hoveredCard;
                if (!isCardAligned(hoveredCard) && isCardEntering(hoveredCard)) {
                    snapToSlide(hoveredIndex, false, hoveredCard);
                }
            } else if (resumeAfterSnap) {
                resumeCarouselAt(index, visualCard);
            }
        };
    }

    gamesGrid.addEventListener('pointerover', event => {
        if (event.pointerType !== 'mouse') return;
        getCarouselAnimation()?.pause();
        if (isSettling) return;
        const card = event.target.closest('.game-card, .game-card-clone');
        if (!card) return;
        const index = getCardSlideIndex(card);
        if (index < 0) return;
        updateGamesPagination(index);
        selectedVisualCard = card;
        hoverSnapped = !isCardAligned(card) && isCardEntering(card);
        if (hoverSnapped) snapToSlide(index, false, card);
    });
    gamesGrid.addEventListener('pointerout', event => {
        if (event.pointerType !== 'mouse') return;
        const card = event.target.closest('.game-card, .game-card-clone');
        if (!card) return;
        const nextCard = event.relatedTarget?.closest?.('.game-card, .game-card-clone');
        if (nextCard) {
            if (nextCard === card) return;
            const nextIndex = getCardSlideIndex(nextCard);
            if (nextIndex >= 0) {
                updateGamesPagination(nextIndex);
                selectedVisualCard = nextCard;
                hoverSnapped = !isCardAligned(nextCard) && isCardEntering(nextCard);
                if (hoverSnapped) snapToSlide(nextIndex, false, nextCard);
            }
            return;
        }
        if (snapAnimation?.playState === 'running') {
            snapAnimation.cancel();
            snapAnimation = null;
            isSettling = false;
            getCarouselAnimation()?.play();
        } else if (hoverSnapped) {
            resumeCarouselAt(selectedSlide, selectedVisualCard);
        } else {
            getCarouselAnimation()?.play();
        }
        hoverSnapped = false;
    });
    gamesPagination?.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        const index = pageButtons.indexOf(button);
        if (index >= 0) snapToSlide(index, true, gameCards[index], true);
    });
    window.setInterval(() => {
        if (snapAnimation?.playState === 'running' || gamesGrid.classList.contains('is-hidden')) return;
        const animation = getCarouselAnimation();
        if (!animation || animation.playState !== 'running' || !Number.isFinite(animation.currentTime)) return;
        const duration = Number.parseFloat(getComputedStyle(gamesGrid).animationDuration) * 1000;
        if (duration > 0) updateGamesPagination(Math.floor(animation.currentTime / duration * gameCards.length + 0.5));
    }, 300);

    backToGamesBtn.addEventListener('click', closeGame);

    _supabase.auth.onAuthStateChange((_event, session) => {
        subscribeGameInvites(session?.user || null).catch(error => {
            console.error('Could not update game invite notifications.', error);
        });
        if (session?.user) {
            checkGameRatingAchievements().catch(error => {
                console.error('Could not check leaderboard achievements after sign in.', error);
            });
        }
    });
    _supabase.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        return subscribeGameInvites(data.session?.user || null);
    }).catch(error => {
        console.error('Could not initialize game invite notifications.', error);
    });

    const inviteFromUrl = new URLSearchParams(window.location.search).get('gameInvite');
    const inviteParts = inviteFromUrl?.match(/^(chess|doudizhu|streetfighter):([A-Z0-9]{8})$/);
    if (inviteParts) window.openGameInvite(inviteParts[1], inviteParts[2]);
})();
