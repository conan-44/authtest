(() => {
    const STORAGE_KEY = 'skvwaffle.streetfighter.formations.v1';
    const SLOT_COUNT = 5;
    const formationCards = [...document.querySelectorAll('[data-slot]')];
    const useFormationButtons = [...document.querySelectorAll('[data-use-formation]')];
    const pageButtons = [...document.querySelectorAll('[data-page]')];
    const carousel = document.querySelector('.formation-choices');
    const setup = document.querySelector('.formation-setup');
    const battle = document.getElementById('turnBattle');
    const startBattleButton = document.getElementById('turnStartBattleBtn');
    const status = document.getElementById('gameStatus');
    const playerUnitsElement = document.getElementById('playerUnits');
    const enemyUnitsElement = document.getElementById('enemyUnits');
    const characterSprites = [
        { x: 32, y: 0 },
        { x: 48, y: 0 },
        { x: 32, y: 16 },
        { x: 32, y: 32 }
    ];
    const roles = [
        { name: 'Attacker', action: 'Attack', icon: 'attack-icon', damage: 22 },
        { name: 'Defense', action: 'Guard', icon: 'defense-icon' },
        { name: 'Healer', action: 'Heal', icon: 'healer-icon', healing: 20 }
    ];
    const MAX_HEALTH = 100;
    const ENEMY_DAMAGE = 14;
    const ROTATION_INTERVAL = 5000;
    const RESUME_DELAY = 15000;
    let selectedSlot = 0;
    let selectedFormation = null;
    let rotationTimer = null;
    let resumeTimer = null;
    let enemyTurnTimer = null;
    let playerTeam = [];
    let enemyTeam = [];
    let playerGuard = false;
    let enemyGuard = false;
    let battleFinished = false;
    let playerTurn = true;

    function loadSelectedSlot() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (saved?.version === 1 && Array.isArray(saved.slots)
                && saved.slots.length === SLOT_COUNT
                && saved.slots.every((slot, index) => slot?.name === `Slot ${index + 1}`
                    && Array.isArray(slot.roles)
                    && slot.roles.join(',') === 'attacker,defense,healer')
                && Number.isInteger(saved.selectedSlot)
                && saved.selectedSlot >= 0 && saved.selectedSlot < SLOT_COUNT) {
                selectedSlot = saved.selectedSlot;
            }
        } catch (error) {
            console.error('Could not load Street Fighter formation slots.', error);
        }
    }

    function saveSelectedSlot() {
        const slots = Array.from({ length: SLOT_COUNT }, (_, index) => ({
            name: `Slot ${index + 1}`,
            roles: ['attacker', 'defense', 'healer']
        }));
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                version: 1,
                selectedSlot,
                slots
            }));
        } catch (error) {
            console.error('Could not save Street Fighter formation slots.', error);
            status.textContent = 'Formation selected, but the slots could not be saved on this device.';
        }
    }

    function renderSelection(announce = true) {
        formationCards.forEach((card, index) => {
            const isVisible = index === selectedSlot;
            card.setAttribute('aria-hidden', String(!isVisible));
            card.inert = !isVisible;
        });
        pageButtons.forEach((button, index) => {
            if (index === selectedSlot) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');
        });
        carousel.style.transform = `translateX(-${selectedSlot * 20}%)`;
        if (announce && selectedFormation === null) status.textContent = `Slot ${selectedSlot + 1}`;
    }

    function scheduleRotation(delay = ROTATION_INTERVAL) {
        window.clearTimeout(rotationTimer);
        rotationTimer = window.setTimeout(() => {
            selectedSlot = (selectedSlot + 1) % SLOT_COUNT;
            renderSelection(false);
            saveSelectedSlot();
            scheduleRotation();
        }, delay);
    }

    function noteActivity() {
        if (!setup || setup.hidden) return;
        window.clearTimeout(rotationTimer);
        window.clearTimeout(resumeTimer);
        resumeTimer = window.setTimeout(() => scheduleRotation(0), RESUME_DELAY);
    }

    function randomSprite() {
        return characterSprites[Math.floor(Math.random() * characterSprites.length)];
    }

    function setSprite(element, sprite) {
        const horizontalPosition = sprite.x === 32 ? '66.6667%' : '100%';
        const verticalPosition = sprite.y === 0 ? '0%' : sprite.y === 16 ? '50%' : '100%';
        element.style.backgroundPosition = `${horizontalPosition} ${verticalPosition}`;
    }

    function createUnit(role, side, index) {
        const unit = {
            role,
            side,
            index,
            health: MAX_HEALTH,
            sprite: randomSprite(),
            element: null,
            healthBar: null,
            healthLabel: null
        };
        const element = document.createElement(side === 'player' ? 'button' : 'div');
        element.className = 'battle-unit';
        if (side === 'player') {
            element.type = 'button';
            element.setAttribute('aria-label', `${role.name}, ${role.action}`);
            element.addEventListener('click', () => takePlayerTurn(unit));
        }

        const sprite = document.createElement('span');
        sprite.className = 'battle-character';
        sprite.setAttribute('aria-hidden', 'true');
        setSprite(sprite, unit.sprite);

        const healthTrack = document.createElement('span');
        healthTrack.className = 'battle-health-track';
        healthTrack.setAttribute('aria-hidden', 'true');
        unit.healthBar = document.createElement('span');
        unit.healthBar.className = 'battle-health-fill';
        healthTrack.appendChild(unit.healthBar);

        unit.healthLabel = document.createElement('span');
        unit.healthLabel.className = 'battle-health-label';

        const roleLabel = document.createElement('span');
        roleLabel.className = 'battle-role';
        const icon = document.createElement('span');
        icon.className = `game-icon ${role.icon}`;
        icon.setAttribute('aria-hidden', 'true');
        const action = document.createElement('span');
        action.textContent = role.action;
        roleLabel.append(icon, action);

        element.append(sprite, healthTrack, unit.healthLabel, roleLabel);
        unit.element = element;
        updateUnit(unit);
        return unit;
    }

    function updateUnit(unit) {
        const healthRatio = Math.max(0, unit.health / MAX_HEALTH);
        unit.healthBar.style.width = `${healthRatio * 100}%`;
        unit.healthLabel.textContent = `${Math.max(0, unit.health)} / ${MAX_HEALTH}`;
        unit.element.classList.toggle('is-defeated', unit.health <= 0);
        unit.element.disabled = unit.side === 'player' && (!playerTurn || battleFinished || unit.health <= 0);
    }

    function updateTeam(team) {
        team.forEach(updateUnit);
    }

    function aliveUnits(team) {
        return team.filter(unit => unit.health > 0);
    }

    function weakestUnit(team) {
        return aliveUnits(team).reduce((weakest, unit) => !weakest || unit.health < weakest.health ? unit : weakest, null);
    }

    function applyAction(unit, allies, opponents) {
        if (unit.role.action === 'Attack') {
            const target = weakestUnit(opponents);
            if (!target) return;
            const isGuarded = unit.side === 'player' ? enemyGuard : playerGuard;
            const damage = Math.max(1, unit.role.damage - (isGuarded ? 10 : 0));
            target.health = Math.max(0, target.health - damage);
            if (unit.side === 'player') enemyGuard = false;
            else playerGuard = false;
            status.textContent = `${unit.side === 'player' ? 'Player' : 'Enemy'} attacker deals ${damage} damage.`;
        } else if (unit.role.action === 'Guard') {
            if (unit.side === 'player') playerGuard = true;
            else enemyGuard = true;
            status.textContent = `${unit.side === 'player' ? 'Player' : 'Enemy'} defense is guarding.`;
        } else {
            const target = weakestUnit(allies);
            if (!target) return;
            const healed = Math.min(unit.role.healing, MAX_HEALTH - target.health);
            target.health += healed;
            status.textContent = `${unit.side === 'player' ? 'Player' : 'Enemy'} healer restores ${healed} health.`;
        }
    }

    function finishBattle() {
        const playerWon = aliveUnits(enemyTeam).length === 0;
        const playerLost = aliveUnits(playerTeam).length === 0;
        if (!playerWon && !playerLost) return false;
        battleFinished = true;
        playerTurn = false;
        window.clearTimeout(enemyTurnTimer);
        updateTeam(playerTeam);
        status.textContent = playerWon ? 'You win!' : 'Enemy wins.';
        return true;
    }

    function enemyTurn() {
        if (battleFinished) return;
        const available = aliveUnits(enemyTeam);
        const actor = available[Math.floor(Math.random() * available.length)];
        if (actor) applyAction(actor, enemyTeam, playerTeam);
        updateTeam(playerTeam);
        updateTeam(enemyTeam);
        if (finishBattle()) return;
        playerTurn = true;
        updateTeam(playerTeam);
        status.textContent = 'Your turn. Choose a player slot.';
    }

    function takePlayerTurn(unit) {
        if (!playerTurn || battleFinished || unit.health <= 0) return;
        playerTurn = false;
        updateTeam(playerTeam);
        applyAction(unit, playerTeam, enemyTeam);
        updateTeam(playerTeam);
        updateTeam(enemyTeam);
        if (finishBattle()) return;
        enemyTurnTimer = window.setTimeout(enemyTurn, 600);
    }

    function startBattle() {
        if (selectedFormation === null) return;
        window.clearTimeout(rotationTimer);
        window.clearTimeout(resumeTimer);
        playerGuard = false;
        enemyGuard = false;
        battleFinished = false;
        playerTurn = true;
        playerTeam = roles.map((role, index) => createUnit(role, 'player', index));
        enemyTeam = roles.map((role, index) => createUnit(role, 'enemy', index));
        playerUnitsElement.replaceChildren(...playerTeam.map(unit => unit.element));
        enemyUnitsElement.replaceChildren(...enemyTeam.map(unit => unit.element));
        setup.hidden = true;
        battle.hidden = false;
        startBattleButton.hidden = true;
        status.textContent = 'Your turn. Choose a player slot.';
    }

    loadSelectedSlot();
    document.querySelectorAll('.formation-stage').forEach(stage => {
        const omittedSpriteIndex = Math.floor(Math.random() * characterSprites.length);
        characterSprites.forEach((sprite, index) => {
            if (index === omittedSpriteIndex) return;
            const character = document.createElement('span');
            character.className = 'formation-character';
            setSprite(character, sprite);
            stage.appendChild(character);
        });
    });
    renderSelection();
    saveSelectedSlot();
    scheduleRotation();

    useFormationButtons.forEach(button => {
        button.addEventListener('click', () => {
            selectedFormation = Number(button.dataset.useFormation);
            useFormationButtons.forEach((candidate, index) => {
                const isSelected = index === selectedFormation;
                candidate.setAttribute('aria-pressed', String(isSelected));
                candidate.textContent = isSelected ? 'Using formation' : 'Use formation';
            });
            startBattleButton.disabled = false;
            status.textContent = `Slot ${selectedFormation + 1} formation selected.`;
            noteActivity();
        });
    });

    pageButtons.forEach((button, index) => {
        button.addEventListener('click', () => {
            selectedSlot = index;
            renderSelection();
            saveSelectedSlot();
            noteActivity();
        });
    });

    startBattleButton.addEventListener('click', startBattle);
    document.addEventListener('pointermove', noteActivity, { passive: true });
    document.addEventListener('pointerdown', noteActivity, { passive: true });
    document.addEventListener('keydown', noteActivity);
})();
