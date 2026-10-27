        (() => {
            const canvas = document.getElementById('gameCanvas');
            const context = canvas.getContext('2d');
            const status = document.getElementById('gameStatus');
            const startBattleButton = document.getElementById('startBattleBtn');
            const spriteSheet = new Image();
            const mannequinSheet = new Image();
            const iconSheet = new Image();
            const frameSize = 24;
            const mannequinFrameSize = 16;
            const iconFrameSize = 8;
            const frameScale = 3;
            const groundY = 276;
            const frameDuration = 115;
            const animations = {
                idle: { row: 0, frames: [0] },
                run: { row: 2, frames: [0, 1, 2, 3] },
                jump: { row: 5, frames: [0, 1, 2, 3, 4], rate: 95 },
                punch: { row: 6, frames: [5, 6, 7, 8], rate: 105, duration: 560 }
            };
            const keysDown = new Set();
            const pointerDirections = new Set();
            const damageNumbers = [];
            const floatingIcons = [];
            let battleStarted = false;
            const maxHealth = 10;
            const comboWindows = [
                { minimum: 180, maximum: 350 },
                { minimum: 200, maximum: 320 }
            ];
            const comboDamage = [1, 2, 4];
            const impactFlash = document.getElementById('impactFlash');
            const impactSparks = [];
            let comboHits = 0;
            let comboLastHitAt = 0;
            let comboLockUntil = 0;
            let comboFeedbackUntil = 0;
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
                flashUntil: 0,
                jumpWindupUntil: 0,
                jumpAirStarted: 0,
                jumpLandingUntil: 0,
                animation: 'idle',
                animationStarted: 0,
                actionUntil: 0,
                demoAnimation: '',
                demoUntil: 0
            };
            const dummy = {
                x: 550,
                health: maxHealth,
                flashUntil: 0,
                attackTelegraphUntil: 0,
                deathAt: 0,
                nextAttackAt: 0
            };
            let lastTime = 0;
            let previousAnimation = 'idle';

            const debug = window.createStreetFighterDebug({
                canvas,
                menu: document.getElementById('debugMenu'),
                player,
                getBattleStarted: () => battleStarted,
                startAction,
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

            spriteSheet.addEventListener('load', () => {
                startBattleButton.disabled = false;
                status.textContent = battleStarted ? 'Battle started' : 'Click Start Battle to play';
                requestAnimationFrame(loop);
            }, { once: true });
            spriteSheet.addEventListener('error', () => {
                status.textContent = 'Could not load the character sprites';
                console.error('Could not load the Street Fighter character sprite sheet.');
            }, { once: true });
            spriteSheet.src = '../../assets/minigames/streetfighter/characters/master.png';
            mannequinSheet.addEventListener('error', () => {
                console.error('Could not load the Street Fighter mannequin sprite sheet.');
            }, { once: true });
            mannequinSheet.src = '../../assets/minigames/streetfighter/characters/mannequin.png';
            iconSheet.addEventListener('error', () => {
                console.error('Could not load the Street Fighter icon sprite sheet.');
            }, { once: true });
            iconSheet.src = '../../assets/minigames/streetfighter/icons.png?v=2';

            function jump(now = gameNow) {
                if (player.y < groundY || now < player.jumpLandingUntil || player.health <= 0) return;
                player.demoAnimation = '';
                player.actionUntil = 0;
                player.demoUntil = 0;
                player.velocityY = 0;
                player.jumpWindupUntil = now + 160;
                player.jumpAirStarted = 0;
                player.jumpLandingUntil = 0;
                player.animation = 'jump';
                player.animationStarted = now;
                previousAnimation = 'jump';
                status.textContent = 'Jump animation';
            }

            function startAction(name, now = gameNow) {
                const animation = animations[name];
                if (!animation || player.health <= 0 || performance.now() < impactUntilReal) return;
                if (name === 'punch') {
                    punch(now);
                    return;
                }
                if (name === 'jump') {
                    jump(now);
                    return;
                }
                player.demoAnimation = name;
                player.demoUntil = now + (animation.duration || 700);
                player.actionUntil = animation.duration ? now + animation.duration : 0;
                player.animation = name;
                player.animationStarted = now;
                previousAnimation = name;
                status.textContent = name === 'idle'
                    ? 'Ready to fight'
                    : `${name[0].toUpperCase()}${name.slice(1)} animation`;
            }

            function resetCombo(now, feedback = '') {
                comboHits = 0;
                comboLastHitAt = 0;
                comboFeedbackUntil = feedback ? now + 650 : 0;
                document.getElementById('comboText').textContent = feedback;
            }

            function rebuildDummy() {
                dummy.health = maxHealth;
                dummy.flashUntil = 0;
                dummy.attackTelegraphUntil = 0;
                dummy.deathAt = 0;
                dummy.nextAttackAt = gameNow + 900;
                damageNumbers.length = 0;
                floatingIcons.length = 0;
                comboHits = 0;
                comboLastHitAt = 0;
                comboLockUntil = 0;
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

                const centerX = dummy.x;
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

            function punch(now) {
                if (now < player.actionUntil || now < comboLockUntil) return;
                if (comboHits >= comboDamage.length) resetCombo(now);

                let nextHit = 0;
                if (comboHits > 0) {
                    const window = comboWindows[comboHits - 1];
                    const elapsed = now - comboLastHitAt;
                    if (elapsed < window.minimum) {
                        document.getElementById('comboText').textContent = 'TOO EARLY';
                        comboFeedbackUntil = now + 500;
                        return;
                    }
                    if (
                        elapsed <= window.maximum
                        && comboHits < comboDamage.length
                    ) {
                        nextHit = comboHits;
                    } else {
                        resetCombo(now);
                    }
                }

                const animation = animations.punch;
                player.demoAnimation = 'punch';
                player.demoUntil = now + animation.duration;
                player.actionUntil = now + 40;
                player.animation = 'punch';
                player.animationStarted = now;
                previousAnimation = 'punch';

                const playerCenter = player.x + frameSize * frameScale / 2;
                const isFacingDummy = player.facing > 0 && playerCenter < dummy.x;
                const hitDummy = dummy.health > 0 && isFacingDummy && dummy.x - playerCenter <= 105;
                if (!hitDummy) {
                    resetCombo(now, comboHits > 0 ? 'COMBO BROKEN' : '');
                    return;
                }

                const damageAmount = comboDamage[nextHit];
                damage(dummy, now, damageAmount);
                dummy.attackTelegraphUntil = 0;
                dummy.nextAttackAt = now + 900;
                comboHits = nextHit + 1;
                comboLastHitAt = now;
                const feedback = comboHits === 3 ? '3 HIT COMBO!' : `${comboHits} HIT`;
                document.getElementById('comboText').textContent = feedback;
                comboFeedbackUntil = now + 900;
                if (comboHits === 2) {
                    startHitStop(now, 75);
                } else if (comboHits === 3) {
                    comboLockUntil = now + 900;
                    startHitStop(now, 420, true);
                }
            }

            function damage(target, now, amount = 1) {
                if (target.health <= 0) return;
                target.health = Math.max(0, target.health - amount);
                target.flashUntil = now + 180;
                if (target === player) resetCombo(now, comboHits > 0 ? 'COMBO BROKEN' : '');
                const targetX = target === player
                    ? player.x + frameSize * frameScale / 2
                    : dummy.x;
                const targetY = target === player
                    ? player.y - frameSize * frameScale
                    : groundY - 58;
                damageNumbers.push({ x: targetX, y: targetY, amount, createdAt: now });
                if (target.health === 0) {
                    if (target === dummy) dummy.deathAt = now;
                    if (target === dummy) status.textContent = 'Dummy has been dummified';
                    const deathX = target === player ? player.x + frameSize * frameScale / 2 : dummy.x;
                    const deathY = target === player
                        ? player.y - frameSize * frameScale / 2
                        : groundY - mannequinFrameSize * frameScale / 2;
                    floatingIcons.push({ icon: 2, x: deathX, y: deathY, createdAt: now });
                    if (target === dummy) {
                        floatingIcons.push({
                            icon: 1,
                            x: player.x + frameSize * frameScale / 2,
                            y: player.y - frameSize * frameScale / 2,
                            createdAt: now
                        });
                    }
                }
            }

            function currentAnimation(now) {
                if (now < player.actionUntil) return player.demoAnimation;
                if (now < player.demoUntil && player.demoAnimation) return player.demoAnimation;
                player.demoAnimation = '';
                if (player.health <= 0) return 'idle';
                if (now < player.jumpWindupUntil || player.y < groundY || now < player.jumpLandingUntil) return 'jump';
                const movingLeft = keysDown.has('ArrowLeft') || keysDown.has('KeyA') || pointerDirections.has('left');
                const movingRight = keysDown.has('ArrowRight') || keysDown.has('KeyD') || pointerDirections.has('right');
                if (player.y < groundY) return 'jump';
                if (keysDown.has('KeyJ')) return 'punch';
                if (movingLeft || movingRight) return 'run';
                return 'idle';
            }

            function update(now, delta) {
                const movingLeft = keysDown.has('ArrowLeft') || keysDown.has('KeyA') || pointerDirections.has('left');
                const movingRight = keysDown.has('ArrowRight') || keysDown.has('KeyD') || pointerDirections.has('right');
                const running = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');
                const speed = running ? 260 : 155;
                if (player.health > 0 && movingLeft !== movingRight) {
                    const direction = movingLeft ? -1 : 1;
                    player.x = Math.max(36, Math.min(canvas.width - 36, player.x + direction * speed * delta));
                    player.facing = direction;
                }
                if (player.jumpWindupUntil && now >= player.jumpWindupUntil && player.y >= groundY) {
                    player.jumpWindupUntil = 0;
                    player.jumpAirStarted = now;
                    player.velocityY = -430;
                }
                const wasAirborne = player.y < groundY;
                player.velocityY += 1050 * delta;
                player.y += player.velocityY * delta;
                if (player.y >= groundY) {
                    player.y = groundY;
                    player.velocityY = 0;
                    if (wasAirborne) {
                        player.jumpAirStarted = 0;
                        player.jumpLandingUntil = now + 160;
                    }
                }
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
                if (comboHits === 3 && now >= comboLockUntil) {
                    comboHits = 0;
                    comboLastHitAt = 0;
                }
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
                const nextAnimation = currentAnimation(now);
                if (nextAnimation !== player.animation) {
                    player.animation = nextAnimation;
                    player.animationStarted = now;
                }
                if (player.animation !== previousAnimation) {
                    status.textContent = player.animation === 'idle'
                        ? 'Ready to fight'
                        : `${player.animation[0].toUpperCase()}${player.animation.slice(1)} animation`;
                    previousAnimation = player.animation;
                }
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
                document.getElementById('playerHealthText').textContent = `PLAYER ${player.health} / ${maxHealth}`;
                document.getElementById('dummyHealthText').textContent = `DUMMY ${dummy.health} / ${maxHealth}`;
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
                    right + barWidth * (1 - dummy.health / maxHealth),
                    top,
                    barWidth * (dummy.health / maxHealth),
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

            function drawPlayer(now) {
                const animation = animations[player.animation];
                let frame;
                if (player.animation === 'jump') {
                    if (now < player.jumpWindupUntil) {
                        frame = Math.min(1, Math.floor((now - player.animationStarted) / 95));
                    } else if (player.y < groundY) {
                        frame = 2 + Math.floor((now - player.jumpAirStarted) / 180) % 2;
                    } else {
                        frame = 4;
                    }
                } else {
                    const frameRate = animation.rate || frameDuration;
                    const frameIndex = Math.floor((now - player.animationStarted) / frameRate);
                    frame = animation.duration
                        ? animation.frames[Math.min(frameIndex, animation.frames.length - 1)]
                        : animation.frames[frameIndex % animation.frames.length];
                }
                const drawX = Math.round(player.x);
                const drawY = Math.round(player.y - frameSize * frameScale);
                context.save();
                context.translate(drawX, drawY);
                if (player.facing < 0) {
                    context.translate(frameSize * frameScale, 0);
                    context.scale(-1, 1);
                }
                context.imageSmoothingEnabled = false;
                if (now < player.flashUntil) context.filter = 'brightness(0) invert(1)';
                context.drawImage(
                    spriteSheet,
                    frame * frameSize,
                    animation.row * frameSize,
                    frameSize,
                    frameSize,
                    0,
                    0,
                    frameSize * frameScale,
                    frameSize * frameScale
                );
                context.restore();
                if (debug.isHitboxVisible()) {
                    context.strokeStyle = getComputedStyle(document.documentElement)
                        .getPropertyValue('--game-accent').trim();
                    context.lineWidth = 2;
                    context.strokeRect(drawX, drawY, frameSize * frameScale, frameSize * frameScale);
                }
                debug.update(animation, frame);
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
                if (dummy.health !== 0 || !isOverDummyScraps(event)) return;
                event.preventDefault();
                rebuildDummy();
            });

            canvas.addEventListener('pointermove', event => {
                canvas.style.cursor = dummy.health === 0 && isOverDummyScraps(event)
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
                drawBackground();
                drawHealthBars();
                drawDummy(sceneTime, impactActive && impactShowsSparks);
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
                if (isNewPress && ['Space', 'ArrowUp', 'KeyW'].includes(event.code)) jump();
                if (isNewPress && event.code === 'KeyJ') startAction('punch');
            }, { capture: true });
            window.addEventListener('keyup', event => keysDown.delete(event.code));
            window.addEventListener('blur', () => {
                keysDown.clear();
                pointerDirections.clear();
            });
            document.querySelectorAll('[data-action]').forEach(button => {
                button.addEventListener('click', () => {
                    if (battleStarted) startAction(button.dataset.action);
                });
            });

            startBattleButton.addEventListener('click', () => {
                battleStarted = true;
                document.getElementById('mobileControls').hidden = false;
                startBattleButton.textContent = 'Battle Started';
                startBattleButton.disabled = true;
                status.textContent = 'Battle started — use the keyboard to play';
                window.frameElement?.focus();
                window.focus();
                canvas.focus({ preventScroll: true });
            });

        })();
