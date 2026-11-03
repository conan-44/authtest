(() => {
    window.createStreetFighterDebug = ({
        canvas,
        menu,
        player,
        getBattleStarted,
        playDemoAnimation,
        beginMove,
        endMove,
        resetPlayer
    }) => {
        const position = document.getElementById('debugPosition');
        const state = document.getElementById('debugState');
        const facing = document.getElementById('debugFacing');
        const frameLabel = document.getElementById('debugFrame');
        const battle = document.getElementById('debugBattle');
        const hitboxToggle = document.getElementById('hitboxToggle');
        const gridToggle = document.getElementById('gridToggle');
        let showHitbox = false;
        let showGrid = false;

        function toggle(force) {
            const shouldOpen = typeof force === 'boolean' ? force : menu.hidden;
            menu.hidden = !shouldOpen;
            if (!shouldOpen && getBattleStarted()) canvas.focus({ preventScroll: true });
            return shouldOpen;
        }

        window.streetfighter = command => {
            if (String(command).trim().toLowerCase() !== 'debug') {
                console.info('Usage: streetfighter("debug")');
                return false;
            }
            return toggle();
        };
        window.streetfighter.debug = toggle;

        window.addEventListener('keydown', event => {
            if (event.code === 'Escape' && !menu.hidden) {
                event.preventDefault();
                event.stopImmediatePropagation();
                toggle(false);
            }
        }, { capture: true });

        document.querySelectorAll('[data-demo]').forEach(button => {
            button.addEventListener('click', () => playDemoAnimation(button.dataset.demo));
        });

        document.querySelectorAll('[data-move]').forEach(button => {
            const direction = button.dataset.move;
            const stop = () => endMove(direction);
            button.addEventListener('pointerdown', event => {
                event.preventDefault();
                beginMove(direction);
                button.setPointerCapture(event.pointerId);
            });
            button.addEventListener('pointerup', stop);
            button.addEventListener('pointercancel', stop);
            button.addEventListener('lostpointercapture', stop);
        });

        hitboxToggle.addEventListener('click', () => {
            showHitbox = !showHitbox;
            hitboxToggle.setAttribute('aria-pressed', String(showHitbox));
            hitboxToggle.textContent = showHitbox ? 'Hide hitbox' : 'Show hitbox';
        });
        gridToggle.addEventListener('click', () => {
            showGrid = !showGrid;
            gridToggle.setAttribute('aria-pressed', String(showGrid));
            gridToggle.textContent = showGrid ? 'Hide grid' : 'Show grid';
        });
        document.getElementById('resetFighterBtn').addEventListener('click', resetPlayer);
        document.getElementById('closeDebugBtn').addEventListener('click', () => toggle(false));

        return {
            isHitboxVisible: () => showHitbox,
            isGridVisible: () => showGrid,
            update(animation, frame) {
                position.textContent = `Position: X ${Math.round(player.x)} · Y ${Math.round(player.y)}`;
                state.textContent = `State: ${player.animation}`;
                facing.textContent = `Facing: ${player.facing > 0 ? 'right' : 'left'}`;
                frameLabel.textContent = `Sprite: row ${animation.row} · frame ${frame}`;
                battle.textContent = `Battle: ${getBattleStarted() ? 'active' : 'waiting'}`;
            }
        };
    };
})();