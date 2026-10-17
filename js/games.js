// GAMES TAB (loads the actual game in place of the game list, same panel slot as achievements)
(() => {
    // Change this to adjust the embedded game frame size (any CSS size, e.g. '100%', '900px')
    const GAME_FRAME_WIDTH = '100%';
    const GAME_FRAME_HEIGHT = '100%';

    const gamesGrid = document.getElementById('gamesGrid');
    const gamePlayer = document.getElementById('gamePlayer');
    const gameFrame = document.getElementById('gameFrame');
    const backToGamesBtn = document.getElementById('backToGamesBtn');
    let gameInviteChannel = null;
    let gameInviteUserId = null;
    let gameInviteSubscriptionGeneration = 0;

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
        }
    };

    function createGameInviteLink(game, inviteCode) {
        if (!['chess', 'doudizhu'].includes(game) || !/^[A-Z0-9]{8}$/.test(inviteCode)) {
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
            !['chess', 'doudizhu'].includes(payload.game) ||
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
        message.textContent = `${sender} invited you to ${payload.game === 'chess' ? 'Chess' : 'Dou Dizhu'}.`;
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
        if (!['chess', 'doudizhu'].includes(game) || !/^[A-Z0-9]{8}$/.test(inviteCode)) {
            throw new Error('This game invite is invalid.');
        }
        const routes = {
            chess: './minigames/chess/game.html',
            doudizhu: './minigames/cards/main.html'
        };
        window.activateTab('games');
        loadGameSource(`${routes[game]}?invite=${encodeURIComponent(inviteCode)}`);
    };

    function loadGame(card) {
        const src = card.dataset.src;
        if (!src || src === 'link here') return;
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

    backToGamesBtn.addEventListener('click', closeGame);

    _supabase.auth.onAuthStateChange((_event, session) => {
        subscribeGameInvites(session?.user || null).catch(error => {
            console.error('Could not update game invite notifications.', error);
        });
    });
    _supabase.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        return subscribeGameInvites(data.session?.user || null);
    }).catch(error => {
        console.error('Could not initialize game invite notifications.', error);
    });

    const inviteFromUrl = new URLSearchParams(window.location.search).get('gameInvite');
    const inviteParts = inviteFromUrl?.match(/^(chess|doudizhu):([A-Z0-9]{8})$/);
    if (inviteParts) window.openGameInvite(inviteParts[1], inviteParts[2]);
})();
