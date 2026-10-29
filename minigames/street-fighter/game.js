        (() => {
            const canvas = document.getElementById('gameCanvas');
            const context = canvas.getContext('2d');
            const status = document.getElementById('gameStatus');
            const startBattleButton = document.getElementById('startBattleBtn');
            const newBattleButton = document.getElementById('newBattleBtn');
            const fightBotButton = document.getElementById('fightBotBtn');
            const reviveButton = document.getElementById('reviveBtn');
            const botDifficultySelect = document.getElementById('botDifficulty');
            const createOnlineBattleButton = document.getElementById('createOnlineBattleBtn');
            const joinOnlineBattleButton = document.getElementById('joinOnlineBattleBtn');
            const onlineInviteCode = document.getElementById('onlineInviteCode');
            const multiplayerStatus = document.getElementById('multiplayerStatus');
            const copyOnlineInviteButton = document.getElementById('copyOnlineInviteBtn');
            const shareOnlineInviteButton = document.getElementById('shareOnlineInviteBtn');
            const mannequinSheet = new Image();
            const iconSheet = new Image();
            const playerSheets = {
                idle: new Image(),
                walk: new Image(),
                jump: new Image(),
                attack: new Image(),
                interact: new Image()
            };
            const punchChargeMax = 1200;
            const punchWindupFrameDuration = 55;
            const punchMaxWindupFrameDuration = 110;
            const punchFollowThroughFrameDuration = 70;
            const punchImpactDelay = punchWindupFrameDuration * 3;
            const punchAnimationDuration = punchImpactDelay + punchFollowThroughFrameDuration * 3;
            const punchFrames = [0, 1, 2, 3, 4, 5];
            const chargedPunchAnimations = Object.fromEntries(
                Array.from({ length: 5 }, (_, row) => [
                    `punch-row-${row}`,
                    {
                        sheet: 'attack',
                        row,
                        width: 24,
                        height: 24,
                        frames: punchFrames,
                        rate: punchWindupFrameDuration,
                        duration: punchAnimationDuration
                    }
                ])
            );
            const playerSheetFrames = {
                idle: { sheet: 'idle', row: 2, width: 24, height: 24, frames: [0, 1, 2, 3], rate: 210 },
                run: { sheet: 'walk', row: 2, width: 24, height: 24, frames: [0, 1, 2, 3], rate: 90 },
                jump: { sheet: 'jump', row: 2, width: 24, height: 22, frames: [0, 1, 2, 3, 4], rate: 95 },
                punch: chargedPunchAnimations['punch-row-0'],
                ...chargedPunchAnimations
            };
            const frameSize = 24;
            const mannequinFrameSize = 16;
            const iconFrameSize = 8;
            const frameScale = 3;
            const groundY = 276;
            const frameDuration = 115;
            const punchRange = 112;
            const animations = {
                idle: { row: 0, frames: [0] },
                run: { row: 2, frames: [0, 1, 2, 3] },
                jump: { row: 5, frames: [0, 1, 2, 3, 4], rate: 95 },
                punch: { row: 0, frames: punchFrames, rate: punchWindupFrameDuration, duration: punchAnimationDuration },
                ...Object.fromEntries(
                    Array.from({ length: 5 }, (_, row) => [
                        `punch-row-${row}`,
                        { row, frames: punchFrames, rate: punchWindupFrameDuration, duration: punchAnimationDuration }
                    ])
                )
            };
            const keysDown = new Set();
            const pointerDirections = new Set();
            const damageNumbers = [];
            const floatingIcons = [];
            let battleStarted = false;
            let multiplayerActive = false;
            let botActive = false;
            let multiplayerRole = null;
            let multiplayerInviteCode = null;
            let multiplayerConnection = null;
            let claimedGuestId = null;
            let opponentReady = false;
            let localReady = false;
            let lastInputSentAt = 0;
            let lastStateSentAt = 0;
            let inputSendPending = false;
            let stateSendPending = false;
            let localInputSequence = 0;
            let localJumpSequence = 0;
            let localAttackSequence = 0;
            let localAttackCharge = 0;
            let receivedInputSequence = 0;
            let receivedJumpSequence = 0;
            let receivedAttackSequence = 0;
            let receivedStateSequence = 0;
            let pendingRemoteJump = false;
            let pendingRemoteAttackCharge = null;
            let punchChargeStartedAt = 0;
            let punchChargeActive = false;
            let remoteInput = { left: false, right: false, run: false };
            let remoteTarget = null;
            let localServerTarget = null;
            const maxHealth = 10;
            const comboWindows = [
                { minimum: 100, maximum: 600 },
                { minimum: 120, maximum: 600 },
                { minimum: 140, maximum: 600 }
            ];
            const botComboDamage = [1, 1, 2];
            const botDifficulties = {
                easy: {
                    label: 'Rookie',
                    reaction: 620,
                    dodgeChance: 0.18,
                    dodgeCooldown: 2600,
                    attackDelay: 1050,
                    comboChance: 0.42,
                    comboInterval: 315,
                    comboJitter: 80,
                    runDistance: 260,
                    preferredRange: 92
                },
                normal: {
                    label: 'Fighter',
                    reaction: 380,
                    dodgeChance: 0.46,
                    dodgeCooldown: 1900,
                    attackDelay: 720,
                    comboChance: 0.7,
                    comboInterval: 265,
                    comboJitter: 65,
                    runDistance: 210,
                    preferredRange: 84
                },
                hard: {
                    label: 'Champion',
                    reaction: 210,
                    dodgeChance: 0.76,
                    dodgeCooldown: 1350,
                    attackDelay: 470,
                    comboChance: 0.88,
                    comboInterval: 220,
                    comboJitter: 55,
                    runDistance: 165,
                    preferredRange: 76
                }
            };
            const impactFlash = document.getElementById('impactFlash');
            const impactSparks = [];
            let comboHits = 0;
            let comboLastHitAt = 0;
            let comboLockUntil = 0;
            let comboMaxHits = 0;
            let comboRewarded = false;
            let comboFeedbackUntil = 0;
            let streetFighterResultRecorded = false;
            let botComboHits = 0;
            let botComboLastHitAt = 0;
            let botNextActionAt = 0;
            let botNextDodgeAt = 0;
            let botReactPunchAt = 0;
            let botHandledPunchStartedAt = 0;
            let botDifficulty = botDifficulties[botDifficultySelect.value];
            let impactStartedReal = 0;
            let impactUntilReal = 0;
            let impactSceneTime = 0;
            let impactDuration = 0;
            let impactShowsSparks = false;
            let pauseDuration = 0;
            let gameNow = 0;
            const player = {
                x: 130,
                y: groundY,
                velocityY: 0,
                facing: 1,
                health: maxHealth,
                stunnedUntil: 0,
                flashUntil: 0,
                jumpWindupUntil: 0,
                jumpAirStarted: 0,
                jumpLandingUntil: 0,
                animation: 'idle',
                animationStarted: 0,
                actionUntil: 0,
                demoAnimation: '',
                demoUntil: 0,
                lastPunchAt: 0,
                punchCooldownUntil: 0,
                punchCooldownDuration: 0,
                pendingPunch: null,
                punchWindupFrameDuration
            };
            const dummy = {
                x: 550,
                health: maxHealth,
                flashUntil: 0,
                attackTelegraphUntil: 0,
                deathAt: 0,
                nextAttackAt: 0
            };
            const remotePlayer = {
                x: 550,
                y: groundY,
                velocityY: 0,
                facing: -1,
                health: maxHealth,
                stunnedUntil: 0,
                flashUntil: 0,
                jumpWindupUntil: 0,
                jumpAirStarted: 0,
                jumpLandingUntil: 0,
                animation: 'idle',
                animationStarted: 0,
                actionUntil: 0,
                demoAnimation: '',
                demoUntil: 0,
                lastPunchAt: 0,
                punchCooldownUntil: 0,
                punchCooldownDuration: 0,
                pendingPunch: null,
                punchWindupFrameDuration
            };
            let lastTime = 0;
            let previousAnimation = 'idle';

            const debug = window.createStreetFighterDebug({
                canvas,
                menu: document.getElementById('debugMenu'),
                player,
                getBattleStarted: () => battleStarted,
                playDemoAnimation,
                beginMove: direction => pointerDirections.add(direction),
                endMove: direction => pointerDirections.delete(direction),
                resetPlayer() {
                    player.x = 130;
                    player.y = groundY;
                    player.velocityY = 0;
                    player.facing = 1;
                    player.health = maxHealth;
                    player.flashUntil = 0;
                    player.jumpWindupUntil = 0;
                    player.jumpAirStarted = 0;
                    player.jumpLandingUntil = 0;
                    player.demoAnimation = '';
                    player.actionUntil = 0;
                    player.demoUntil = 0;
                    resetPunchCooldown(player);
                    player.animation = 'idle';
                    player.animationStarted = gameNow;
                    dummy.health = maxHealth;
                    dummy.flashUntil = 0;
                    dummy.attackTelegraphUntil = 0;
                    dummy.deathAt = 0;
                    dummy.nextAttackAt = 0;
                    damageNumbers.length = 0;
                    floatingIcons.length = 0;
                    comboHits = 0;
                    comboLastHitAt = 0;
                    comboLockUntil = 0;
                    comboMaxHits = 0;
                    comboRewarded = false;
                    comboFeedbackUntil = 0;
                    impactStartedReal = 0;
                    impactUntilReal = 0;
                    impactSceneTime = 0;
                    impactDuration = 0;
                    impactShowsSparks = false;
                    pauseDuration = 0;
                    gameNow = 0;
                    impactSparks.length = 0;
                    impactFlash.replaceChildren();
                    document.getElementById('comboText').textContent = '';
                    impactFlash.hidden = true;
                    previousAnimation = 'idle';
                }
            });

            const playerSheetNames = {
                idle: 'idle',
                walk: 'walk',
                jump: 'jump',
                attack: 'attack',
                interact: 'interact'
            };
            const loadSheet = (image, source, label) => new Promise((resolve, reject) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', () => reject(new Error(`Could not load ${label}.`)), { once: true });
                image.src = source;
            });
            Promise.all([
                ...Object.entries(playerSheetNames).map(([name, file]) => loadSheet(
                    playerSheets[name],
                    `../../assets/minigames/streetfighter/characters/player/${file}.png`,
                    `player ${name} sprites`
                ))
            ]).then(() => {
                startBattleButton.disabled = false;
                fightBotButton.disabled = false;
                status.textContent = battleStarted ? 'Battle started' : 'Click Start Battle to play';
                requestAnimationFrame(loop);
            }).catch(error => {
                status.textContent = 'Could not load the character sprites';
                console.error(error);
            });
            mannequinSheet.addEventListener('error', () => {
                console.error('Could not load the Street Fighter mannequin sprite sheet.');
            }, { once: true });
            mannequinSheet.src = '../../assets/minigames/streetfighter/characters/mannequin.png';
            iconSheet.addEventListener('error', () => {
                console.error('Could not load the Street Fighter icon sprite sheet.');
            }, { once: true });
            iconSheet.src = '../../assets/minigames/streetfighter/icons.png?v=2';

            function jump(now = gameNow) {
                if (!startFighterJump(player, now)) return;
                previousAnimation = 'jump';
                status.textContent = 'Jump animation';
            }

            function startFighterJump(fighter, now) {
                if (fighter.y < groundY || now < fighter.jumpLandingUntil || now < fighter.stunnedUntil
                    || fighter.health <= 0) return false;
                fighter.demoAnimation = '';
                fighter.actionUntil = 0;
                fighter.demoUntil = 0;
                fighter.velocityY = 0;
                fighter.jumpWindupUntil = now + 160;
                fighter.jumpAirStarted = 0;
                fighter.jumpLandingUntil = 0;
                fighter.animation = 'jump';
                fighter.animationStarted = now;
                return true;
            }

            function startAction(name, now = gameNow) {
                if (!animations[name] || player.health <= 0 || now < player.stunnedUntil
                    || performance.now() < impactUntilReal) return;
                if (name === 'jump') {
                    jump(now);
                    return;
                }
                playDemoAnimation(name, now);
            }

            function playDemoAnimation(name, now = gameNow) {
                if (name === 'punch') name = 'punch-row-0';
                if (!animations[name]) return;
                if (name === 'jump') {
                    jump(now);
                    return;
                }
                const duration = animations[name].duration || 700;
                player.demoAnimation = name;
                player.demoUntil = now + duration;
                player.actionUntil = player.demoUntil;
                player.animation = name;
                player.animationStarted = now;
                previousAnimation = name;
                status.textContent = name === 'idle'
                    ? 'Ready to fight'
                    : `${name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ')} animation`;
            }

            function resetCombo(now, feedback = '') {
                if (battleStarted && comboHits > 0 && !comboRewarded) {
                    recordStreetFighterRating(-1);
                }
                comboHits = 0;
                comboLastHitAt = 0;
                comboLockUntil = 0;
                comboMaxHits = 0;
                comboRewarded = false;
                comboFeedbackUntil = feedback ? now + 650 : 0;
                document.getElementById('comboText').textContent = feedback;
            }

            function resetPunchCooldown(fighter) {
                fighter.punchCooldownUntil = 0;
                fighter.punchCooldownDuration = 0;
                fighter.pendingPunch = null;
            }

            function startPunchCharge(now = gameNow) {
                if (punchChargeActive || player.health <= 0 || now < player.stunnedUntil
                    || now < player.actionUntil || now < comboLockUntil
                    || performance.now() < impactUntilReal) return;
                punchChargeActive = true;
                punchChargeStartedAt = now;
            }

            function releasePunchCharge(now = gameNow) {
                if (!punchChargeActive) return false;
                const charge = Math.max(0, Math.min(1, (now - punchChargeStartedAt) / punchChargeMax));
                punchChargeActive = false;
                firePunch(player, charge, now);
                return true;
            }

            function firePunch(actor, charge, now) {
                if (actor.health <= 0 || now < actor.stunnedUntil || now < actor.actionUntil
                    || (actor === player && now < comboLockUntil)
                    || performance.now() < impactUntilReal) return false;
                const level = Math.max(0, Math.min(1, Number.isFinite(charge) ? charge : 0));
                const row = Math.round(level * 4);
                const animationName = `punch-row-${row}`;
                const windupFrameDuration = Math.round(
                    punchWindupFrameDuration
                    + level * (punchMaxWindupFrameDuration - punchWindupFrameDuration)
                );
                const impactDelay = windupFrameDuration * 3;
                const animationDuration = impactDelay + punchFollowThroughFrameDuration * 3;
                const baseDamage = 1 + Math.round(level * 3);
                const stunDuration = row === 0 ? 0 : Math.round(level * 850);
                const hitStop = Math.round(55 + level * 165);
                const cooldown = Math.round(450 + level * 1350);
                const comboLimit = Math.max(1, 3 - Math.max(0, row - 1));
                const cooldownRemaining = Math.max(0, actor.punchCooldownUntil - now);
                const cooldownRecovery = actor.punchCooldownDuration
                    ? 1 - cooldownRemaining / actor.punchCooldownDuration
                    : 1;
                const damageAmount = Math.max(1, Math.round(baseDamage * (0.4 + 0.6 * cooldownRecovery)));

                if (actor === player && comboHits > 0) {
                    if (comboHits >= comboMaxHits) {
                        resetCombo(now);
                    } else {
                        const window = comboWindows[Math.min(comboHits - 1, comboWindows.length - 1)];
                        const elapsed = now - comboLastHitAt;
                        if (elapsed < window.minimum) {
                            document.getElementById('comboText').textContent = 'TOO EARLY';
                            comboFeedbackUntil = now + 500;
                            return false;
                        }
                        if (elapsed > window.maximum) resetCombo(now);
                    }
                }

                actor.punchCooldownDuration = cooldown;
                actor.punchCooldownUntil = now + cooldown;
                actor.lastPunchAt = now;
                actor.animation = animationName;
                actor.animationStarted = now;
                actor.punchWindupFrameDuration = windupFrameDuration;
                actor.actionUntil = now + impactDelay;
                actor.demoAnimation = animationName;
                actor.demoUntil = now + animationDuration;
                actor.pendingPunch = multiplayerActive && multiplayerRole !== 0
                    ? null
                    : {
                        resolveAt: now + impactDelay,
                        stats: { damage: damageAmount, stunDuration, hitStop, comboLimit }
                    };
                if (actor === player) {
                    previousAnimation = animationName;
                    if (multiplayerActive && multiplayerRole === 1) {
                        localAttackCharge = level;
                        localAttackSequence += 1;
                    }
                }

                if (multiplayerActive && multiplayerRole !== 0) return true;
                return true;
            }

            function resolvePendingPunch(actor, now) {
                if (!actor.pendingPunch || now < actor.pendingPunch.resolveAt) return;
                const { stats } = actor.pendingPunch;
                actor.pendingPunch = null;
                const target = actor === player
                    ? (multiplayerActive || botActive ? remotePlayer : dummy)
                    : player;
                performPunch(actor, target, stats, now);
            }

            function performPunch(actor, target, stats, now) {
                const actorCenter = actor.x + frameSize * frameScale / 2;
                const targetCenter = target === dummy ? dummy.x : target.x + frameSize * frameScale / 2;
                const facingTarget = Math.sign(targetCenter - actorCenter) === actor.facing;
                if (!facingTarget || Math.abs(targetCenter - actorCenter) > punchRange || target.health <= 0) {
                    if (actor === player) {
                        status.textContent = 'Punch missed — cooldown started';
                        resetCombo(now, comboHits > 0 ? 'COMBO BROKEN' : '');
                    }
                    return false;
                }

                damage(target, now, stats.damage, stats.stunDuration
                    ? { stunDuration: stats.stunDuration }
                    : {});
                startHitStop(now, stats.hitStop);
                if (actor === player) {
                    if (comboHits === 0) comboMaxHits = stats.comboLimit;
                    else comboMaxHits = Math.min(comboMaxHits, stats.comboLimit);
                    comboHits += 1;
                    comboLastHitAt = now;
                    if (comboHits >= 2 && !comboRewarded) {
                        comboRewarded = true;
                        recordStreetFighterRating(2);
                    }
                    document.getElementById('comboText').textContent = stats.stunDuration
                        ? 'STUN!'
                        : comboHits >= 2 ? `${comboHits} HIT COMBO!` : `${comboHits} HIT`;
                    comboFeedbackUntil = now + 900;
                    status.textContent = 'Punch landed';
                    if (comboHits >= comboMaxHits) {
                        comboRewarded = true;
                        comboLockUntil = now + 360;
                    }
                }
                if (target === dummy) {
                    dummy.attackTelegraphUntil = 0;
                    dummy.nextAttackAt = now + 900;
                }
                return true;
            }

            function recordStreetFighterRating(delta) {
                try {
                    const updater = window.parent?.gameRatings?.adjust;
                    if (typeof updater !== 'function') {
                        console.error('Game rating tracker is unavailable for Street Fighter.');
                        return;
                    }
                    Promise.resolve(updater('streetfighter', delta)).catch(error => {
                        console.error('Could not update Street Fighter rating.', error);
                    });
                } catch (error) {
                    console.error('Could not reach the Street Fighter rating tracker.', error);
                }
            }

            function recordStreetFighterResult(playerWon) {
                if (streetFighterResultRecorded) return;
                streetFighterResultRecorded = true;
                recordStreetFighterRating(playerWon ? 8 : -8);
            }

            function publishOnlineStatus(message) {
                multiplayerStatus.textContent = message;
            }

            function beginBattle() {
                if (battleStarted) return;
                battleStarted = true;
                streetFighterResultRecorded = false;
                newBattleButton.disabled = multiplayerActive;
                document.getElementById('mobileControls').hidden = false;
                startBattleButton.textContent = 'Battle Started';
                startBattleButton.disabled = true;
                fightBotButton.disabled = true;
                botDifficultySelect.disabled = true;
                status.textContent = multiplayerActive
                    ? 'Online battle started'
                    : 'Battle started — use the keyboard to play';
                if (multiplayerActive) publishOnlineStatus('Online battle started.');
                window.frameElement?.focus();
                window.focus();
                canvas.focus({ preventScroll: true });
            }

            function beginBotBattle() {
                if (multiplayerActive || multiplayerConnection) return;
                battleStarted = false;
                botActive = true;
                punchChargeActive = false;
                player.x = 130;
                player.y = groundY;
                player.velocityY = 0;
                player.facing = 1;
                player.health = maxHealth;
                player.stunnedUntil = 0;
                player.flashUntil = 0;
                player.jumpWindupUntil = 0;
                player.jumpAirStarted = 0;
                player.jumpLandingUntil = 0;
                player.actionUntil = 0;
                player.demoAnimation = '';
                player.demoUntil = 0;
                player.lastPunchAt = 0;
                resetPunchCooldown(player);
                player.animation = 'idle';
                player.animationStarted = gameNow;
                previousAnimation = 'idle';
                remotePlayer.x = 550;
                remotePlayer.y = groundY;
                remotePlayer.velocityY = 0;
                remotePlayer.facing = -1;
                remotePlayer.health = maxHealth;
                remotePlayer.stunnedUntil = 0;
                remotePlayer.flashUntil = 0;
                remotePlayer.jumpWindupUntil = 0;
                remotePlayer.jumpAirStarted = 0;
                remotePlayer.jumpLandingUntil = 0;
                remotePlayer.actionUntil = 0;
                remotePlayer.demoAnimation = '';
                remotePlayer.demoUntil = 0;
                remotePlayer.lastPunchAt = 0;
                resetPunchCooldown(remotePlayer);
                remotePlayer.animation = 'idle';
                remotePlayer.animationStarted = gameNow;
                botComboHits = 0;
                botComboLastHitAt = 0;
                botNextActionAt = gameNow + 700;
                botNextDodgeAt = gameNow + 900;
                botReactPunchAt = 0;
                botHandledPunchStartedAt = 0;
                comboHits = 0;
                comboLastHitAt = 0;
                comboLockUntil = 0;
                comboMaxHits = 0;
                comboRewarded = false;
                dummy.health = 0;
                damageNumbers.length = 0;
                floatingIcons.length = 0;
                startBattleButton.disabled = true;
                startBattleButton.textContent = 'Training';
                newBattleButton.disabled = false;
                fightBotButton.disabled = true;
                createOnlineBattleButton.disabled = true;
                joinOnlineBattleButton.disabled = true;
                copyOnlineInviteButton.hidden = true;
                shareOnlineInviteButton.hidden = true;
                document.getElementById('comboText').textContent = '';
                beginBattle();
                status.textContent = 'Battle started — fight the AI';
            }

            function reviveFighter(fighter, x, facing) {
                fighter.x = x;
                fighter.y = groundY;
                fighter.velocityY = 0;
                fighter.facing = facing;
                fighter.health = maxHealth;
                fighter.stunnedUntil = 0;
                fighter.flashUntil = 0;
                fighter.jumpWindupUntil = 0;
                fighter.jumpAirStarted = 0;
                fighter.jumpLandingUntil = 0;
                fighter.actionUntil = 0;
                fighter.demoAnimation = '';
                fighter.demoUntil = 0;
                fighter.lastPunchAt = 0;
                resetPunchCooldown(fighter);
                fighter.animation = 'idle';
                fighter.animationStarted = gameNow;
            }

            function reviveBotBattle() {
                if (!botActive || (player.health > 0 && remotePlayer.health > 0)) return;
                reviveFighter(player, 130, 1);
                reviveFighter(remotePlayer, 550, -1);
                streetFighterResultRecorded = false;
                botComboHits = 0;
                botComboLastHitAt = 0;
                botNextActionAt = gameNow + botDifficulty.attackDelay;
                botNextDodgeAt = gameNow + botDifficulty.dodgeCooldown;
                botReactPunchAt = 0;
                botHandledPunchStartedAt = 0;
                comboHits = 0;
                comboLastHitAt = 0;
                comboLockUntil = 0;
                comboMaxHits = 0;
                comboRewarded = false;
                comboFeedbackUntil = 0;
                damageNumbers.length = 0;
                floatingIcons.length = 0;
                document.getElementById('comboText').textContent = '';
                reviveButton.hidden = true;
                status.textContent = 'Both fighters are back — fight!';
                previousAnimation = 'idle';
            }

            function startNewBattle() {
                if (multiplayerActive || multiplayerConnection) return;
                battleStarted = false;
                punchChargeActive = false;
                keysDown.clear();
                pointerDirections.clear();
                streetFighterResultRecorded = false;
                if (botActive) {
                    botActive = false;
                    fightBotButton.disabled = false;
                    beginBotBattle();
                    return;
                }

                reviveFighter(player, 130, 1);
                rebuildDummy();
                startBattleButton.textContent = 'Start Training';
                startBattleButton.disabled = false;
                fightBotButton.disabled = false;
                botDifficultySelect.disabled = false;
                newBattleButton.disabled = true;
                beginBattle();
            }

            function requestBattleStart() {
                if (!multiplayerActive) {
                    beginBattle();
                    return;
                }
                if (localReady || battleStarted) return;
                localReady = true;
                startBattleButton.textContent = 'Ready — waiting';
                startBattleButton.disabled = true;
                publishOnlineStatus('Ready. Waiting for your opponent.');
                sendOnlineMessage('ready', { seat: multiplayerRole });
                if (multiplayerRole === 0 && opponentReady) beginBattle();
            }

            async function sendOnlineMessage(event, payload) {
                if (!multiplayerConnection) return;
                try {
                    await multiplayerConnection.send(event, payload);
                } catch (error) {
                    publishOnlineStatus(error.message);
                }
            }

            async function connectOnlineMatch(sessionId, inviteCode, role) {
                if (!window.parent.gameMultiplayer?.connectStreetFighter) {
                    throw new Error('Open Street Fighter from the games tab to connect online.');
                }
                if (multiplayerConnection) await multiplayerConnection.close();
                multiplayerActive = true;
                multiplayerRole = role;
                multiplayerInviteCode = inviteCode;
                claimedGuestId = null;
                opponentReady = false;
                localReady = false;
                botActive = false;
                battleStarted = false;
                newBattleButton.disabled = true;
                player.x = role === 0 ? 130 : 550;
                player.y = groundY;
                player.velocityY = 0;
                player.facing = role === 0 ? 1 : -1;
                player.health = maxHealth;
                player.stunnedUntil = 0;
                player.flashUntil = 0;
                player.jumpWindupUntil = 0;
                player.jumpAirStarted = 0;
                player.jumpLandingUntil = 0;
                player.actionUntil = 0;
                player.demoAnimation = '';
                player.demoUntil = 0;
                player.lastPunchAt = 0;
                resetPunchCooldown(player);
                player.animation = 'idle';
                player.animationStarted = gameNow;
                previousAnimation = 'idle';
                remotePlayer.x = role === 0 ? 550 : 130;
                remotePlayer.y = groundY;
                remotePlayer.velocityY = 0;
                remotePlayer.facing = role === 0 ? -1 : 1;
                remotePlayer.health = maxHealth;
                remotePlayer.stunnedUntil = 0;
                remotePlayer.flashUntil = 0;
                remotePlayer.jumpWindupUntil = 0;
                remotePlayer.jumpAirStarted = 0;
                remotePlayer.jumpLandingUntil = 0;
                remotePlayer.actionUntil = 0;
                remotePlayer.demoAnimation = '';
                remotePlayer.demoUntil = 0;
                remotePlayer.lastPunchAt = 0;
                resetPunchCooldown(remotePlayer);
                remotePlayer.animation = 'idle';
                remotePlayer.animationStarted = gameNow;
                remoteTarget = null;
                localServerTarget = null;
                receivedInputSequence = 0;
                receivedJumpSequence = 0;
                receivedAttackSequence = 0;
                receivedStateSequence = 0;
                localInputSequence = 0;
                localJumpSequence = 0;
                localAttackSequence = 0;
                localAttackCharge = 0;
                pendingRemoteJump = false;
                pendingRemoteAttackCharge = null;
                remoteInput = { left: false, right: false, run: false };
                damageNumbers.length = 0;
                floatingIcons.length = 0;
                dummy.health = 0;
                startBattleButton.textContent = 'Start Battle';
                startBattleButton.disabled = false;
                newBattleButton.disabled = true;
                createOnlineBattleButton.disabled = true;
                joinOnlineBattleButton.disabled = true;
                fightBotButton.disabled = true;
                onlineInviteCode.value = inviteCode || '';
                copyOnlineInviteButton.hidden = role !== 0;
                shareOnlineInviteButton.hidden = role !== 0;
                publishOnlineStatus(role === 0 ? 'Connecting to your private session...' : 'Connecting to the host...');

                try {
                    multiplayerConnection = await window.parent.gameMultiplayer.connectStreetFighter(sessionId, {
                    onInput(payload) {
                        if (role !== 0 || !battleStarted || !payload || payload.seat !== 1
                            || !Number.isSafeInteger(payload.sequence) || payload.sequence <= receivedInputSequence
                            || !Number.isSafeInteger(payload.jumpSequence)
                            || !Number.isSafeInteger(payload.attackSequence)
                            || (payload.attackSequence > receivedAttackSequence
                                && (!Number.isFinite(payload.attackCharge)
                                    || payload.attackCharge < 0 || payload.attackCharge > 1))
                            || !payload.held || typeof payload.held !== 'object') return;
                        receivedInputSequence = payload.sequence;
                        remoteInput = {
                            left: payload.held?.left === true,
                            right: payload.held?.right === true,
                            run: payload.held?.run === true
                        };
                        if (Number.isInteger(payload.jumpSequence) && payload.jumpSequence > receivedJumpSequence) {
                            receivedJumpSequence = payload.jumpSequence;
                            pendingRemoteJump = true;
                        }
                        if (payload.attackSequence > receivedAttackSequence) {
                            receivedAttackSequence = payload.attackSequence;
                            pendingRemoteAttackCharge = payload.attackCharge;
                        }
                    },
                    onState(payload) {
                        if (role !== 1 || !payload || !Number.isSafeInteger(payload.sequence)
                            || payload.sequence <= receivedStateSequence || !Array.isArray(payload.players)
                            || payload.players.length !== 2 || typeof payload.started !== 'boolean') return;
                        const localState = payload.players[1];
                        const opponentState = payload.players[0];
                        if (!isValidOnlineFighter(localState) || !isValidOnlineFighter(opponentState)) return;
                        if (localState.health < player.health) damage(player, gameNow, player.health - localState.health);
                        if (opponentState.health < remotePlayer.health) {
                            damage(remotePlayer, gameNow, remotePlayer.health - opponentState.health);
                        }
                        receivedStateSequence = payload.sequence;
                        localServerTarget = localState;
                        player.health = localState.health;
                        player.stunnedUntil = gameNow + localState.stunRemaining;
                        remoteTarget = opponentState;
                        if (opponentState.animation !== remotePlayer.animation) {
                            remotePlayer.animation = opponentState.animation;
                            remotePlayer.animationStarted = gameNow;
                        }
                        remotePlayer.facing = opponentState.facing;
                        remotePlayer.health = opponentState.health;
                        remotePlayer.stunnedUntil = gameNow + opponentState.stunRemaining;
                        if (localState.health === 0 || opponentState.health === 0) {
                            recordStreetFighterResult(localState.health > 0);
                        }
                        remotePlayer.flashUntil = opponentState.flashing ? gameNow + 100 : 0;
                        if (localState.health === 0) status.textContent = 'You were defeated';
                        else if (opponentState.health === 0) status.textContent = 'Opponent defeated';
                        if (payload.started && !battleStarted) beginBattle();
                    },
                    onJoin(payload) {
                        if (role !== 0 || payload?.seat !== 1) return;
                        if (claimedGuestId) return;
                        claimedGuestId = true;
                        publishOnlineStatus('Opponent connected. Both players must be ready.');
                        if (localReady) sendOnlineMessage('ready', { seat: 0 });
                    },
                    onReady(payload) {
                        if (role !== 0 || payload?.seat !== 1) return;
                        opponentReady = true;
                        if (localReady) beginBattle();
                    },
                    onStatus(connectionStatus) {
                        if (connectionStatus === 'CHANNEL_ERROR' || connectionStatus === 'TIMED_OUT') {
                            if (role === 0) remoteInput = { left: false, right: false, run: false };
                            publishOnlineStatus('Connection interrupted. Try joining again.');
                        }
                    }
                    });
                } catch (error) {
                    multiplayerActive = false;
                    multiplayerRole = null;
                    fightBotButton.disabled = false;
                    dummy.health = maxHealth;
                    dummy.flashUntil = 0;
                    dummy.attackTelegraphUntil = 0;
                    dummy.deathAt = 0;
                    createOnlineBattleButton.disabled = false;
                    joinOnlineBattleButton.disabled = false;
                    throw error;
                }
                if (role === 1) {
                    await sendOnlineMessage('joined', { seat: 1 });
                    publishOnlineStatus('Connected. Click Start Battle when ready.');
                } else {
                    publishOnlineStatus(`Invite code: ${inviteCode}. Share it with one opponent.`);
                }
            }

            function isValidOnlineFighter(fighter) {
                return fighter && Number.isFinite(fighter.x) && fighter.x >= 36 && fighter.x <= canvas.width - 36
                    && Number.isFinite(fighter.y) && fighter.y >= 0 && fighter.y <= groundY
                    && (fighter.facing === -1 || fighter.facing === 1)
                    && Number.isInteger(fighter.health) && fighter.health >= 0 && fighter.health <= maxHealth
                    && Number.isFinite(fighter.stunRemaining) && fighter.stunRemaining >= 0
                    && fighter.stunRemaining <= 2000
                    && typeof fighter.flashing === 'boolean'
                    && Object.hasOwn(animations, fighter.animation);
            }

            function sendOnlineInput(now) {
                if (!battleStarted || !multiplayerConnection || multiplayerRole !== 1
                    || now - lastInputSentAt < 50 || inputSendPending) return;
                lastInputSentAt = now;
                inputSendPending = true;
                const held = {
                    left: keysDown.has('ArrowLeft') || keysDown.has('KeyA') || pointerDirections.has('left'),
                    right: keysDown.has('ArrowRight') || keysDown.has('KeyD') || pointerDirections.has('right'),
                    run: keysDown.has('ShiftLeft') || keysDown.has('ShiftRight')
                };
                const payload = {
                    seat: 1,
                    sequence: ++localInputSequence,
                    jumpSequence: localJumpSequence,
                    attackSequence: localAttackSequence,
                    attackCharge: localAttackCharge,
                    held
                };
                multiplayerConnection.send('input', payload)
                    .catch(error => publishOnlineStatus(error.message))
                    .finally(() => { inputSendPending = false; });
            }

            function sendOnlineState(now) {
                if (!multiplayerConnection || multiplayerRole !== 0 || now - lastStateSentAt < 50 || stateSendPending) return;
                lastStateSentAt = now;
                stateSendPending = true;
                const serialize = fighter => ({
                    x: fighter.x,
                    y: fighter.y,
                    facing: fighter.facing,
                    health: fighter.health,
                    stunRemaining: Math.max(0, Math.min(2000, fighter.stunnedUntil - gameNow)),
                    animation: fighter.animation,
                    flashing: now < fighter.flashUntil
                });
                multiplayerConnection.send('state', {
                    sequence: ++receivedStateSequence,
                    started: battleStarted,
                    players: [serialize(player), serialize(remotePlayer)]
                })
                    .catch(error => publishOnlineStatus(error.message))
                    .finally(() => { stateSendPending = false; });
            }

            createOnlineBattleButton.addEventListener('click', async () => {
                createOnlineBattleButton.disabled = true;
                try {
                    if (!window.parent.gameMultiplayer?.create) throw new Error('Online games are unavailable.');
                    const match = await window.parent.gameMultiplayer.create(
                        'streetfighter',
                        'live',
                        2,
                        { type: 'streetfighter', started: false }
                    );
                    if (!match || !match.id || !/^[A-Z0-9]{8}$/.test(match.invite_code)) {
                        throw new Error('The server returned an invalid Street Fighter invite.');
                    }
                    const state = await window.parent.gameMultiplayer.get(match.id);
                    if (state.game !== 'streetfighter') throw new Error('The server created the wrong game session.');
                    await connectOnlineMatch(match.id, match.invite_code, 0);
                } catch (error) {
                    createOnlineBattleButton.disabled = false;
                    publishOnlineStatus(error.message);
                }
            });

            joinOnlineBattleButton.addEventListener('click', async () => {
                const inviteCode = onlineInviteCode.value.trim().toUpperCase();
                if (!/^[A-Z0-9]{8}$/.test(inviteCode)) {
                    publishOnlineStatus('Enter a valid 8-character invite code.');
                    return;
                }
                joinOnlineBattleButton.disabled = true;
                try {
                    if (!window.parent.gameMultiplayer?.join) throw new Error('Online games are unavailable.');
                    const match = await window.parent.gameMultiplayer.join(inviteCode, 'streetfighter');
                    if (!match?.id || match.seat !== 1) {
                        throw new Error('This invite does not have an available opponent seat.');
                    }
                    const state = await window.parent.gameMultiplayer.get(match.id);
                    if (state.game !== 'streetfighter') throw new Error('This invite is not for Street Fighter.');
                    await connectOnlineMatch(match.id, inviteCode, 1);
                } catch (error) {
                    joinOnlineBattleButton.disabled = false;
                    publishOnlineStatus(error.message);
                }
            });

            copyOnlineInviteButton.addEventListener('click', async () => {
                try {
                    const link = window.parent.gameMultiplayer.createInviteLink('streetfighter', multiplayerInviteCode);
                    await navigator.clipboard.writeText(link);
                    publishOnlineStatus('Invite link copied.');
                } catch (error) {
                    publishOnlineStatus(error.message || 'Could not copy the invite link.');
                }
            });

            shareOnlineInviteButton.addEventListener('click', async () => {
                try {
                    await window.parent.gameMultiplayer.shareInviteToChat('streetfighter', multiplayerInviteCode);
                    publishOnlineStatus('Invite shared in chat.');
                } catch (error) {
                    publishOnlineStatus(error.message);
                }
            });

            function rebuildDummy() {
                dummy.health = maxHealth;
                dummy.stunnedUntil = 0;
                dummy.flashUntil = 0;
                dummy.attackTelegraphUntil = 0;
                dummy.deathAt = 0;
                dummy.nextAttackAt = gameNow + 900;
                damageNumbers.length = 0;
                floatingIcons.length = 0;
                comboHits = 0;
                comboLastHitAt = 0;
                comboLockUntil = 0;
                comboMaxHits = 0;
                comboRewarded = false;
                comboFeedbackUntil = 0;
                document.getElementById('comboText').textContent = '';
                status.textContent = 'Training dummy rebuilt';
            }

            function startHitStop(now, duration, showSparks = false) {
                impactStartedReal = performance.now();
                impactUntilReal = impactStartedReal + duration;
                impactSceneTime = now;
                impactDuration = duration;
                impactShowsSparks = showSparks;
                impactSparks.length = 0;
                impactFlash.replaceChildren();
                if (!showSparks) return;

                const centerX = botActive
                    ? remotePlayer.x + frameSize * frameScale / 2
                    : dummy.x;
                const centerY = groundY - 36;
                const sharedRotation = 45;
                for (let index = 0; index < 36; index += 1) {
                    const angle = (Math.PI * 2 * index) / 36;
                    const size = 3 + ((index * 7) % 6);
                    const element = document.createElement('span');
                    element.className = 'impact-spark';
                    element.style.setProperty('--spark-rotation', `${sharedRotation}deg`);
                    element.style.width = `${size / canvas.width * 100}%`;
                    element.style.height = `${size / canvas.width * 100}%`;
                    impactFlash.appendChild(element);
                    impactSparks.push({
                        element,
                        x: centerX,
                        y: centerY,
                        velocityX: Math.cos(angle) * (65 + (index % 5) * 14),
                        velocityY: Math.sin(angle) * (65 + (index % 4) * 13) - 22,
                        size
                    });
                }
            }

            function applyStun(target, now, duration) {
                if (target === dummy) {
                    target.attackTelegraphUntil = 0;
                    target.nextAttackAt = Math.max(target.nextAttackAt, now + duration);
                    return;
                }
                target.pendingPunch = null;
                target.stunnedUntil = Math.max(target.stunnedUntil, now + duration);
                target.actionUntil = 0;
                target.demoAnimation = '';
                target.demoUntil = 0;
            }

            function drawImpactSparks(now) {
                if (!impactShowsSparks) return;
                const elapsed = Math.min((now - impactStartedReal) / 1000, impactDuration / 1000);
                impactSparks.forEach(spark => {
                    const x = spark.x + spark.velocityX * elapsed;
                    const y = spark.y + spark.velocityY * elapsed + 22 * elapsed * elapsed;
                    spark.element.style.left = `${x / canvas.width * 100}%`;
                    spark.element.style.top = `${y / canvas.height * 100}%`;
                    spark.element.style.opacity = String(Math.max(0, 1 - elapsed / (impactDuration / 1000)));
                });
            }

            function botInput(now) {
                if (remotePlayer.health <= 0 || player.health <= 0 || now < remotePlayer.stunnedUntil) {
                    return { left: false, right: false, run: false };
                }
                const botCenter = remotePlayer.x + frameSize * frameScale / 2;
                const playerCenter = player.x + frameSize * frameScale / 2;
                const distance = Math.abs(playerCenter - botCenter);
                const towardPlayer = playerCenter < botCenter ? 'left' : 'right';
                const inAttackRange = distance <= 105;

                if (player.animation.startsWith('punch')
                    && player.animationStarted !== botHandledPunchStartedAt) {
                    botHandledPunchStartedAt = player.animationStarted;
                    botReactPunchAt = player.animationStarted + botDifficulty.reaction;
                }
                if (player.health > 0 && player.animation.startsWith('punch') && distance < 145
                    && now >= botReactPunchAt && now >= botNextDodgeAt && remotePlayer.y >= groundY) {
                    if (Math.random() < botDifficulty.dodgeChance) {
                        startFighterJump(remotePlayer, now);
                    }
                    botReactPunchAt = Infinity;
                    botNextDodgeAt = now + botDifficulty.dodgeCooldown;
                }

                const movement = distance > botDifficulty.preferredRange ? towardPlayer : '';
                if (inAttackRange && now >= botNextActionAt && remotePlayer.y >= groundY
                    && !remotePlayer.jumpWindupUntil) {
                    if (botComboHits > 0 && Math.random() > botDifficulty.comboChance) {
                        botComboHits = 0;
                        botComboLastHitAt = 0;
                        botNextActionAt = now + botDifficulty.attackDelay;
                        document.getElementById('comboText').textContent = 'BOT DROPPED COMBO';
                        comboFeedbackUntil = now + 650;
                        return {
                            left: movement === 'left',
                            right: movement === 'right',
                            run: distance > botDifficulty.runDistance
                        };
                    }
                    let hitIndex = 0;
                    if (botComboHits > 0) {
                        const window = comboWindows[botComboHits - 1];
                        const elapsed = now - botComboLastHitAt;
                        if (elapsed < window.minimum) return { left: false, right: false, run: false };
                        if (elapsed <= window.maximum && botComboHits < botComboDamage.length) {
                            hitIndex = botComboHits;
                        } else {
                            botComboHits = 0;
                        }
                    }
                    botComboHits = hitIndex + 1;
                    botComboLastHitAt = now;
                    remotePlayer.facing = playerCenter < botCenter ? -1 : 1;
                    remotePlayer.lastPunchAt = now;
                    remotePlayer.actionUntil = now + 150;
                    const botPunchAnimation = `punch-row-${Math.min(hitIndex, 4)}`;
                    remotePlayer.demoAnimation = botPunchAnimation;
                    remotePlayer.demoUntil = now + animations[botPunchAnimation].duration;
                    remotePlayer.animation = botPunchAnimation;
                    remotePlayer.animationStarted = now;
                    botNextActionAt = botComboHits === 3
                        ? now + botDifficulty.attackDelay + 500
                        : now + (botComboHits > 0
                            ? botDifficulty.comboInterval + Math.random() * botDifficulty.comboJitter
                            : botDifficulty.attackDelay);
                    if (remotePlayer.facing === Math.sign(playerCenter - botCenter)
                        && Math.abs(playerCenter - botCenter) <= 105) {
                        damage(player, now, botComboDamage[hitIndex]);
                    }
                    document.getElementById('comboText').textContent = `BOT ${botComboHits} HIT`;
                    comboFeedbackUntil = now + 650;
                    if (botComboHits === 3) {
                        document.getElementById('comboText').textContent = 'BOT 3 HIT COMBO';
                        comboFeedbackUntil = now + 900;
                        botComboHits = 0;
                        botComboLastHitAt = 0;
                    }
                }

                return {
                    left: movement === 'left',
                    right: movement === 'right',
                    run: distance > botDifficulty.runDistance
                };
            }

            function damage(target, now, amount = 1, { stunDuration = 0 } = {}) {
                if (target.health <= 0) return;
                target.health = Math.max(0, target.health - amount);
                target.flashUntil = now + 180;
                if (stunDuration > 0 && target.health > 0) applyStun(target, now, stunDuration);
                if (target.health === 0) target.pendingPunch = null;
                if (!multiplayerActive && target === player) resetCombo(now, comboHits > 0 ? 'COMBO BROKEN' : '');
                const isPlayer = target === player || target === remotePlayer;
                const targetX = isPlayer
                    ? target.x + frameSize * frameScale / 2
                    : dummy.x;
                const targetY = isPlayer
                    ? target.y - frameSize * frameScale
                    : groundY - 58;
                damageNumbers.push({ x: targetX, y: targetY, amount, createdAt: now });
                if (target.health === 0) {
                    if ((botActive || multiplayerActive) && isPlayer) {
                        recordStreetFighterResult(target !== player);
                    }
                    if (target === dummy) dummy.deathAt = now;
                    if (target === dummy) status.textContent = 'Dummy has been dummified';
                    if (botActive && target === remotePlayer) status.textContent = 'You defeated the bot!';
                    if (botActive && target === player) status.textContent = 'The bot defeated you';
                    const deathX = isPlayer ? target.x + frameSize * frameScale / 2 : dummy.x;
                    const deathY = isPlayer
                        ? target.y - frameSize * frameScale / 2
                        : groundY - mannequinFrameSize * frameScale / 2;
                    floatingIcons.push({ icon: 2, x: deathX, y: deathY, createdAt: now });
                    if (multiplayerActive && isPlayer || botActive && isPlayer || target === dummy) {
                        const winner = (multiplayerActive || botActive) && isPlayer
                            ? (target === player ? remotePlayer : player)
                            : player;
                        floatingIcons.push({
                            icon: 1,
                            x: winner.x + frameSize * frameScale / 2,
                            y: winner.y - frameSize * frameScale / 2,
                            createdAt: now
                        });
                    }
                }
            }

            function currentAnimation(fighter, input, now) {
                if (now < fighter.stunnedUntil) return 'idle';
                if (now < fighter.actionUntil) return fighter.demoAnimation;
                if (now < fighter.demoUntil && fighter.demoAnimation) return fighter.demoAnimation;
                fighter.demoAnimation = '';
                if (fighter.health <= 0) return 'idle';
                if (now < fighter.jumpWindupUntil || fighter.y < groundY || now < fighter.jumpLandingUntil) return 'jump';
                const movingLeft = input.left;
                const movingRight = input.right;
                if (fighter.y < groundY) return 'jump';
                if (movingLeft || movingRight) return 'run';
                return 'idle';
            }

            function readLocalInput() {
                return {
                    left: keysDown.has('ArrowLeft') || keysDown.has('KeyA') || pointerDirections.has('left'),
                    right: keysDown.has('ArrowRight') || keysDown.has('KeyD') || pointerDirections.has('right'),
                    run: keysDown.has('ShiftLeft') || keysDown.has('ShiftRight')
                };
            }

            function updateFighter(fighter, input, now, delta) {
                const speed = input.run ? 260 : 155;
                if (fighter.health > 0 && now >= fighter.stunnedUntil && input.left !== input.right) {
                    const direction = input.left ? -1 : 1;
                    fighter.x = Math.max(36, Math.min(canvas.width - 36, fighter.x + direction * speed * delta));
                    fighter.facing = direction;
                }
                if (fighter.jumpWindupUntil && now >= fighter.jumpWindupUntil && fighter.y >= groundY) {
                    fighter.jumpWindupUntil = 0;
                    fighter.jumpAirStarted = now;
                    fighter.velocityY = -430;
                }
                const wasAirborne = fighter.y < groundY;
                fighter.velocityY += 1050 * delta;
                fighter.y += fighter.velocityY * delta;
                if (fighter.y >= groundY) {
                    fighter.y = groundY;
                    fighter.velocityY = 0;
                    if (wasAirborne) {
                        fighter.jumpAirStarted = 0;
                        fighter.jumpLandingUntil = now + 160;
                    }
                }
                const nextAnimation = currentAnimation(fighter, input, now);
                if (nextAnimation !== fighter.animation) {
                    fighter.animation = nextAnimation;
                    fighter.animationStarted = now;
                }
            }

            function update(now, delta) {
                if (punchChargeActive && now - punchChargeStartedAt >= punchChargeMax) {
                    releasePunchCharge(punchChargeStartedAt + punchChargeMax);
                }
                const localInput = readLocalInput();
                updateFighter(player, localInput, now, delta);
                resolvePendingPunch(player, now);
                if (multiplayerActive) {
                    if (multiplayerRole === 0) {
                        updateFighter(remotePlayer, remoteInput, now, delta);
                        if (battleStarted && pendingRemoteJump) startFighterJump(remotePlayer, now);
                        if (battleStarted && pendingRemoteAttackCharge !== null) {
                            firePunch(remotePlayer, pendingRemoteAttackCharge, now);
                        }
                        resolvePendingPunch(remotePlayer, now);
                        pendingRemoteJump = false;
                        pendingRemoteAttackCharge = null;
                    } else if (remoteTarget) {
                        remotePlayer.x += (remoteTarget.x - remotePlayer.x) * Math.min(1, delta * 14);
                        remotePlayer.y += (remoteTarget.y - remotePlayer.y) * Math.min(1, delta * 14);
                        if (localServerTarget) {
                            player.x += (localServerTarget.x - player.x) * Math.min(1, delta * 14);
                            player.y += (localServerTarget.y - player.y) * Math.min(1, delta * 14);
                            player.facing = localServerTarget.facing;
                            if (localServerTarget.animation !== player.animation) {
                                player.animation = localServerTarget.animation;
                                player.animationStarted = now;
                                previousAnimation = player.animation;
                            }
                        }
                    }
                    if (battleStarted && player.health > 0 && remotePlayer.health > 0) {
                        const playerCenter = player.x + frameSize * frameScale / 2;
                        const opponentCenter = remotePlayer.x + frameSize * frameScale / 2;
                        const gap = Math.abs(playerCenter - opponentCenter);
                        if (gap > 48 && gap < 120) {
                            if (playerCenter < opponentCenter) {
                                player.facing = 1;
                                remotePlayer.facing = -1;
                            } else {
                                player.facing = -1;
                                remotePlayer.facing = 1;
                            }
                        }
                    }
                } else if (botActive) {
                    updateFighter(remotePlayer, botInput(now), now, delta);
                    if (battleStarted && player.health > 0 && remotePlayer.health > 0) {
                        const playerCenter = player.x + frameSize * frameScale / 2;
                        const opponentCenter = remotePlayer.x + frameSize * frameScale / 2;
                        const gap = Math.abs(playerCenter - opponentCenter);
                        if (gap > 48 && gap < 120) {
                            player.facing = playerCenter < opponentCenter ? 1 : -1;
                            remotePlayer.facing = playerCenter < opponentCenter ? -1 : 1;
                        }
                    }
                } else {
                    const playerCenter = player.x + frameSize * frameScale / 2;
                    const dummyInRange = Math.abs(playerCenter - dummy.x) <= 100;
                    if (!dummyInRange) {
                        dummy.attackTelegraphUntil = 0;
                    } else if (player.health > 0 && dummy.health > 0) {
                        if (!dummy.attackTelegraphUntil && now >= dummy.nextAttackAt) {
                            dummy.attackTelegraphUntil = now + 450;
                        } else if (dummy.attackTelegraphUntil && now >= dummy.attackTelegraphUntil) {
                            damage(player, now);
                            dummy.attackTelegraphUntil = 0;
                            dummy.nextAttackAt = now + 1500;
                        }
                    }
                }
                if (comboHits >= comboMaxHits && comboMaxHits > 0 && now >= comboLockUntil) resetCombo(now);
                if (comboFeedbackUntil && now >= comboFeedbackUntil) {
                    comboFeedbackUntil = 0;
                    document.getElementById('comboText').textContent = '';
                }
                for (let index = damageNumbers.length - 1; index >= 0; index -= 1) {
                    if (now - damageNumbers[index].createdAt >= 700) damageNumbers.splice(index, 1);
                }
                for (let index = floatingIcons.length - 1; index >= 0; index -= 1) {
                    if (now - floatingIcons[index].createdAt >= 1200) floatingIcons.splice(index, 1);
                }
                if (player.animation !== previousAnimation) {
                    if (!(botActive && (player.health <= 0 || remotePlayer.health <= 0))) {
                        status.textContent = player.animation === 'idle'
                            ? 'Ready to fight'
                            : `${player.animation[0].toUpperCase()}${player.animation.slice(1)} animation`;
                    }
                    previousAnimation = player.animation;
                }
                reviveButton.hidden = !botActive || (player.health > 0 && remotePlayer.health > 0);
            }

            function drawBackground() {
                const palette = getComputedStyle(document.documentElement);
                context.fillStyle = palette.getPropertyValue('--game-surface-body').trim();
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.fillStyle = palette.getPropertyValue('--game-accent').trim();
                context.fillRect(0, groundY, canvas.width, 2);
                if (debug.isGridVisible()) {
                    context.strokeStyle = palette.getPropertyValue('--game-divider').trim();
                    context.lineWidth = 1;
                    for (let x = 0; x <= canvas.width; x += frameSize) {
                        context.beginPath();
                        context.moveTo(x + 0.5, 0);
                        context.lineTo(x + 0.5, canvas.height);
                        context.stroke();
                    }
                    for (let y = 0; y <= canvas.height; y += frameSize) {
                        context.beginPath();
                        context.moveTo(0, y + 0.5);
                        context.lineTo(canvas.width, y + 0.5);
                        context.stroke();
                    }
                }
            }

            function drawHealthBars() {
                const palette = getComputedStyle(document.documentElement);
                const opponentHealth = multiplayerActive || botActive ? remotePlayer.health : dummy.health;
                document.getElementById('playerHealthText').textContent = `PLAYER ${player.health} / ${maxHealth}`;
                const opponentName = multiplayerActive ? 'OPPONENT' : botActive ? 'BOT' : 'DUMMY';
                document.getElementById('dummyHealthText').textContent = `${opponentName} ${opponentHealth} / ${maxHealth}`;
                const barWidth = 280;
                const barHeight = 20;
                const top = 17;
                const left = 20;
                const right = canvas.width - left - barWidth;

                context.fillStyle = palette.getPropertyValue('--game-divider').trim();
                context.fillRect(left, top, barWidth, barHeight);
                context.fillRect(right, top, barWidth, barHeight);
                context.fillStyle = palette.getPropertyValue('--game-heading').trim();
                context.fillRect(left, top, barWidth * (player.health / maxHealth), barHeight);
                context.fillStyle = palette.getPropertyValue('--game-accent').trim();
                context.fillRect(
                    right + barWidth * (1 - opponentHealth / maxHealth),
                    top,
                    barWidth * (opponentHealth / maxHealth),
                    barHeight
                );
                drawIcon(0, canvas.width / 2 - 12, top - 2, 24);
            }

            function drawIcon(icon, x, y, size) {
                if (!iconSheet.complete || !iconSheet.naturalWidth) return;
                context.imageSmoothingEnabled = false;
                context.drawImage(
                    iconSheet,
                    icon * iconFrameSize,
                    0,
                    iconFrameSize,
                    iconFrameSize,
                    Math.round(x),
                    Math.round(y),
                    size,
                    size
                );
            }

            function drawDummy(now, impactActive) {
                if (multiplayerActive || botActive) return;
                if (!mannequinSheet.complete || !mannequinSheet.naturalWidth) return;
                let frame;
                if (dummy.health === 0) {
                    frame = Math.min(5, 3 + Math.floor((now - dummy.deathAt) / 180));
                } else if (dummy.health === 1) {
                    frame = 2;
                } else if (dummy.health < 3) {
                    frame = 1;
                } else {
                    frame = 0;
                }
                const drawX = Math.round(dummy.x - mannequinFrameSize * frameScale / 2);
                const drawY = groundY - mannequinFrameSize * frameScale;
                context.save();
                context.imageSmoothingEnabled = false;
                if (impactActive) {
                    context.filter = 'brightness(0)';
                } else if (now < dummy.flashUntil) {
                    context.filter = 'brightness(0) invert(1)';
                }
                context.drawImage(
                    mannequinSheet,
                    0,
                    frame * mannequinFrameSize,
                    mannequinFrameSize,
                    mannequinFrameSize,
                    drawX,
                    drawY,
                    mannequinFrameSize * frameScale,
                    mannequinFrameSize * frameScale
                );
                context.restore();
                if (dummy.attackTelegraphUntil > now) {
                    context.save();
                    context.textAlign = 'center';
                    context.font = '24px capsmall, sans-serif';
                    context.fillStyle = getComputedStyle(document.documentElement)
                        .getPropertyValue('--game-accent').trim();
                    context.fillText('!', dummy.x, groundY - 68);
                    context.restore();
                }
            }

            function drawDamageNumbers(now) {
                context.save();
                context.textAlign = 'center';
                context.font = '16px lowsmall, sans-serif';
                context.fillStyle = getComputedStyle(document.documentElement)
                    .getPropertyValue('--game-text').trim();
                damageNumbers.forEach(number => {
                    const elapsed = now - number.createdAt;
                    context.globalAlpha = 1 - elapsed / 700;
                    context.fillText(`-${number.amount}`, number.x, number.y - elapsed * 0.045);
                });
                floatingIcons.forEach(icon => {
                    const elapsed = now - icon.createdAt;
                    context.globalAlpha = 1 - elapsed / 1200;
                    drawIcon(icon.icon, icon.x - 12, icon.y - elapsed * 0.055 - 12, 24);
                });
                context.restore();
            }

            function drawPlayer(now, fighter = player) {
                const playerAnimation = playerSheetFrames[fighter.animation] || playerSheetFrames.idle;
                const animation = playerAnimation;
                const fallenBot = botActive && fighter === remotePlayer && fighter.health <= 0;
                const sourceWidth = playerAnimation?.width || frameSize;
                const sourceHeight = playerAnimation?.height || frameSize;
                const sourceSheet = playerSheets[playerAnimation.sheet];
                let frame;
                if (fallenBot) {
                    frame = 0;
                } else if (fighter.animation === 'jump') {
                    if (now < fighter.jumpWindupUntil) {
                        frame = Math.min(1, Math.floor((now - fighter.animationStarted) / 95));
                    } else if (fighter.y < groundY) {
                        frame = 2 + Math.floor((now - fighter.jumpAirStarted) / 180) % 2;
                    } else {
                        frame = 4;
                    }
                } else {
                    const elapsed = Math.max(0, now - fighter.animationStarted);
                    if (fighter.animation.startsWith('punch-row-') || fighter.animation === 'punch') {
                        const windupFrameDuration = fighter.punchWindupFrameDuration || punchWindupFrameDuration;
                        const impactDelay = windupFrameDuration * 3;
                        const frameIndex = elapsed < impactDelay
                            ? Math.floor(elapsed / windupFrameDuration)
                            : 3 + Math.floor((elapsed - impactDelay) / punchFollowThroughFrameDuration);
                        frame = animation.frames[Math.min(frameIndex, animation.frames.length - 1)];
                    } else {
                        const frameRate = animation.rate || frameDuration;
                        const frameIndex = Math.floor(elapsed / frameRate);
                        frame = animation.duration
                            ? animation.frames[Math.min(frameIndex, animation.frames.length - 1)]
                            : animation.frames[frameIndex % animation.frames.length];
                    }
                }
                const drawX = Math.round(fighter.x);
                const drawY = Math.round(fighter.y - frameSize * frameScale);
                context.save();
                if (fallenBot) {
                    context.translate(drawX + frameSize * frameScale / 2, drawY + frameSize * frameScale / 2);
                    context.rotate(-Math.PI / 2);
                    context.translate(-frameSize * frameScale / 2, -frameSize * frameScale / 2);
                    context.filter = 'brightness(0)';
                    context.globalAlpha = 0.72;
                } else {
                    context.translate(drawX, drawY);
                    if (fighter.facing < 0) {
                        context.translate(frameSize * frameScale, 0);
                        context.scale(-1, 1);
                    }
                }
                context.imageSmoothingEnabled = false;
                if (now < fighter.flashUntil) context.filter = 'brightness(0) invert(1)';
                context.drawImage(
                    sourceSheet,
                    frame * sourceWidth,
                    animation.row * sourceHeight,
                    sourceWidth,
                    sourceHeight,
                    0,
                    0,
                    frameSize * frameScale,
                    frameSize * frameScale
                );
                context.restore();
                if (fighter === player && debug.isHitboxVisible()) {
                    context.strokeStyle = getComputedStyle(document.documentElement)
                        .getPropertyValue('--game-accent').trim();
                    context.lineWidth = 2;
                    context.strokeRect(drawX, drawY, frameSize * frameScale, frameSize * frameScale);
                }
                if (fighter === player) drawPunchChargeBar(now);
                if (fighter === player) debug.update(animation, frame);
            }

            function drawPunchChargeBar(now) {
                if (!punchChargeActive) return;
                const progress = Math.max(0, Math.min(1, (now - punchChargeStartedAt) / punchChargeMax));
                const level = Math.round(progress * 4);
                if (level === 0 || !iconSheet.complete || !iconSheet.naturalWidth) return;
                const barRow = Math.min(3, Math.ceil(progress * 4) - 1);
                const width = iconFrameSize * 4 * 2;
                const height = iconFrameSize * 2;
                const x = Math.round(player.x + frameSize * frameScale / 2 - width / 2);
                const y = Math.round(player.y - frameSize * frameScale - height - 42);
                context.imageSmoothingEnabled = false;
                context.drawImage(
                    iconSheet,
                    0,
                    (barRow + 1) * iconFrameSize,
                    iconFrameSize * 4,
                    iconFrameSize,
                    x,
                    y,
                    width,
                    height
                );
            }

            function drawPlayerIndicator(now) {
                const drawY = player.y - frameSize * frameScale;
                const bob = Math.sin(now / 190) * 4;
                drawIcon(
                    3,
                    player.x + frameSize * frameScale / 2 - 12,
                    drawY - 26 + bob,
                    24
                );
            }

            function isOverDummyScraps(event) {
                const bounds = canvas.getBoundingClientRect();
                const x = (event.clientX - bounds.left) * canvas.width / bounds.width;
                const y = (event.clientY - bounds.top) * canvas.height / bounds.height;
                return Math.abs(x - dummy.x) <= 42 && y >= groundY - 54 && y <= groundY + 8;
            }

            canvas.addEventListener('click', event => {
                if (multiplayerActive || botActive || dummy.health !== 0 || !isOverDummyScraps(event)) return;
                event.preventDefault();
                rebuildDummy();
            });

            canvas.addEventListener('pointermove', event => {
                canvas.style.cursor = !multiplayerActive && !botActive && dummy.health === 0 && isOverDummyScraps(event)
                    ? 'context-menu'
                    : '';
            });

            function loop(now) {
                const delta = Math.min((now - (lastTime || now)) / 1000, 0.04);
                lastTime = now;
                const impactActive = now < impactUntilReal;
                if (impactActive) {
                    gameNow = impactSceneTime;
                } else {
                    if (impactStartedReal && now >= impactUntilReal) {
                        pauseDuration += now - impactStartedReal;
                        impactStartedReal = 0;
                    }
                    gameNow = now - pauseDuration;
                    update(gameNow, delta);
                }
                const sceneTime = gameNow;
                sendOnlineInput(now);
                sendOnlineState(now);
                drawBackground();
                drawHealthBars();
                drawDummy(sceneTime, impactActive && impactShowsSparks);
                if (multiplayerActive || botActive) drawPlayer(sceneTime, remotePlayer);
                drawPlayer(sceneTime);
                drawPlayerIndicator(sceneTime);
                drawDamageNumbers(sceneTime);
                impactFlash.hidden = !impactActive || !impactShowsSparks;
                if (impactActive) drawImpactSparks(now);
                requestAnimationFrame(loop);
            }

            window.addEventListener('keydown', event => {
                if (!battleStarted) return;
                const supported = [
                    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space',
                    'KeyA', 'KeyD', 'KeyW', 'KeyJ',
                    'ShiftLeft', 'ShiftRight'
                ];
                if (!supported.includes(event.code)) return;
                event.preventDefault();
                if (performance.now() < impactUntilReal) return;
                const isNewPress = !keysDown.has(event.code);
                keysDown.add(event.code);
                if (isNewPress && ['Space', 'ArrowUp', 'KeyW'].includes(event.code)) {
                    if (multiplayerRole === 1) localJumpSequence += 1;
                    jump();
                }
                if (isNewPress && event.code === 'KeyJ') startPunchCharge();
            }, { capture: true });
            window.addEventListener('keyup', event => {
                keysDown.delete(event.code);
                if (event.code === 'KeyJ') releasePunchCharge();
            });
            window.addEventListener('blur', () => {
                keysDown.clear();
                pointerDirections.clear();
                if (punchChargeActive) releasePunchCharge();
            });
            document.querySelectorAll('[data-action="jump"]').forEach(button => {
                button.addEventListener('click', () => {
                    if (!battleStarted) return;
                    if (multiplayerRole === 1) localJumpSequence += 1;
                    startAction('jump');
                });
            });
            document.querySelectorAll('[data-action="punch"]').forEach(button => {
                const stopCharge = () => releasePunchCharge();
                button.addEventListener('pointerdown', event => {
                    event.preventDefault();
                    if (!battleStarted) return;
                    startPunchCharge();
                    button.setPointerCapture(event.pointerId);
                });
                button.addEventListener('pointerup', stopCharge);
                button.addEventListener('pointercancel', stopCharge);
                button.addEventListener('lostpointercapture', stopCharge);
            });

            startBattleButton.addEventListener('click', requestBattleStart);
            newBattleButton.addEventListener('click', startNewBattle);
            fightBotButton.addEventListener('click', beginBotBattle);
            reviveButton.addEventListener('click', reviveBotBattle);
            botDifficultySelect.addEventListener('change', () => {
                botDifficulty = botDifficulties[botDifficultySelect.value];
            });
            window.addEventListener('pagehide', () => multiplayerConnection?.close());

            const inviteFromUrl = new URLSearchParams(window.location.search).get('invite');
            if (inviteFromUrl) {
                onlineInviteCode.value = inviteFromUrl;
                joinOnlineBattleButton.click();
            }

        })();
