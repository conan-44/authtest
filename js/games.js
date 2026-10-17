// GAMES TAB (loads the actual game in place of the game list, same panel slot as achievements)
(() => {
    // Change this to adjust the embedded game frame size (any CSS size, e.g. '100%', '900px')
    const GAME_FRAME_WIDTH = '100%';
    const GAME_FRAME_HEIGHT = '100%';

    const gamesGrid = document.getElementById('gamesGrid');
    const gamePlayer = document.getElementById('gamePlayer');
    const gameFrame = document.getElementById('gameFrame');
    const backToGamesBtn = document.getElementById('backToGamesBtn');

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
})();
