// Use the app's labeled notifications when embedded, with a standalone fallback.
function showPopup(message, type = 'info', opts = {}) {
    if (window.parent !== window) {
        try {
            if (typeof window.parent.showPopup === 'function') {
                window.parent.showPopup(message, type);
                return;
            }
        } catch (error) {
            console.warn('Could not use the app notification system.', error);
        }
    }

    const popup = document.getElementById('popup');
    if (!popup) return;
    popup.textContent = message;
    popup.classList.remove('hidden', 'show', 'shake', 'large');
    if (popupLarge) popup.classList.add('large');
    void popup.offsetWidth; // force reflow
    if (opts.shake) popup.classList.add('shake');
    popup.classList.add('show');
    if (color) { popup.style.color = color; } else { popup.style.color = ''; }
    setTimeout(() => {
        popup.classList.remove('show', 'shake', 'large');
        setTimeout(() => popup.classList.add('hidden'), 400);
    }, opts.duration || 1800);
}

// confetti effect
function confettiBurst() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.classList.remove('hidden');
    const ctx = canvas.getContext('2d');
    const palette = getComputedStyle(document.documentElement);
    const colors = [
        '--color-notification-warning',
        '--color-notification-error',
        '--color-heading',
        '--color-page',
        '--color-notification-success'
    ].map(name => palette.getPropertyValue(name).trim());
    const particles = Array.from({length: 80}, () => ({
        x: canvas.width/2,
        y: 80,
        r: Math.random()*7+4,
        c: colors[Math.floor(Math.random()*colors.length)],
        vx: (Math.random()-0.5)*12,
        vy: Math.random()*-8-6,
        g: 0.35+Math.random()*0.1
    }));
    let frame = 0;
    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        particles.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, 2*Math.PI);
            ctx.fillStyle = p.c;
            ctx.fill();
            p.x += p.vx;
            p.y += p.vy;
            p.vy += p.g;
        });
        frame++;
        if (frame < 60) requestAnimationFrame(draw);
        else setTimeout(() => canvas.classList.add('hidden'), 600);
    }
    draw();
}
// game data
let quizzes = [{
        numbers: [13, 19, 7, 9, 1, 3],
        answer: 11
    },
    {
        numbers: [11, 18, 6, 15, 8, 29, 4],
        answer: 23
    },
    {
        numbers: [7, 9, 3, 5, 4, 6, 9, 10],
        answer: 18
    },
    {
        numbers: [4.5, 4.5, 5.5, 7.5, 1.5],
        answer: 11.5
    },
    {
        numbers: [3.7, 2.3, 5.5, 4.8, 1.2, 8.1],
        answer: 11.5
    },

    {
        numbers: [2.25, 7.5, 5.25, 1.7, 2.3, 0.25],
        answer: 11.75
    },
    {
        numbers: [0.125, 3.375, 2.75, 1.25, 0.875, 0.125, 1.625, 3.75, 1.25, 3.475, 3.275],
        answer: 11.75
    },
];

// shuffle list function
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function shuffleAll() {
    quizzes.forEach(quiz => {
        quiz.numbers = shuffle(quiz.numbers);
    });
}

// game variables
let answer = [];
let quizIndex = 0;
let difficulty = "medium";
let difficultyIndex = 2;
let newlives = 3;
const hintCost = 15;
let usedHint = false;
// handle UI elements
let levelIndex = document.getElementById("levelIndex");
let stack = document.getElementById("stack");
let targetNum = document.getElementById("targetNum");
let answerSum = document.getElementById("answerSum");
let xp = document.getElementById("xp");
let lives = document.getElementById("lives");
// level editor elements
let levelEditor = document.getElementById('levelEditor');
let editorNumbers = document.getElementById('editorNumbers');
let editorTarget = document.getElementById('editorTarget');
let editorName = document.getElementById('editorName');
let editorSave = document.getElementById('editorSave');
let editorClose = document.getElementById('editorClose');
let customListEl = document.getElementById('customList');
let customQuizzes = [];
// handle buttons
let resetBtn = document.getElementById("resetBtn");
let easyBtn = document.getElementById("easyBtn");
let mediumBtn = document.getElementById("mediumBtn");
let hardBtn = document.getElementById("hardBtn");
let hintBtn = document.getElementById("hintBtn");
let editorToggle = document.getElementById('editorToggle');
const shareLevelBtn = document.getElementById('shareLevelBtn');
let versionInfo = document.getElementById('game-info');
// stats viewer elements
const statsBtn = document.getElementById('statsBtn');
const statsAchievementsModal = document.getElementById('statsAchievementsModal');
const statsClose = document.getElementById('statsClose');
const resetStatsBtn = document.getElementById('resetStatsBtn');
// handle sfx & music
let clickSfx = new Audio('click.wav');
// --- Info Modal for README and Version History ---
const infoBtn = document.getElementById('infoBtn');
const infoModal = document.getElementById('infoModal');
const infoClose = document.getElementById('infoClose');
const readmeTab = document.getElementById('readmeTab');
const versionTab = document.getElementById('versionTab');
const readmePanel = document.getElementById('readmePanel');
const versionPanel = document.getElementById('versionPanel');
const readmeContent = document.getElementById('readmeContent');
const versionContent = document.getElementById('versionContent');

// Preload README and version-history content (static, loaded at build time)
readmeContent.textContent = `# Number Pillars\nA simple math game I got and redesigned to be complex\n## how to play\nclick a box to remove it from the stack. \nTry to make the stack total sum equal to the target number, displayed on the left of the screen\n### more stuff\n - Change difficulty using the difficulty settings (EASY, MEDIUM, HARD)\n - Create your own levels using the level editor!\n - Check your stats in the stats viewer\n - Adjust settings in the settings menu\n## nerd stuff\nI just used nested dictionaries for the main levels\n// game data\nlet quizzes = [{\n        numbers: [13, 19, 7, 9, 1, 3],\n        answer: 11\n    },\n    {\n        numbers: [11, 18, 6, 15, 8, 29, 4],\n        answer: 23\n    },\n    {\n        numbers: [7, 9, 3, 5, 4, 6, 9, 10],\n        answer: 18\n    },\n    {\n        numbers: [4.5, 4.5, 5.5, 7.5, 1.5],\n        answer: 11.5\n    },\n    {\n        numbers: [3.7, 2.3, 5.5, 4.8, 1.2, 8.1],\n        answer: 11.5\n    },\n    {\n        numbers: [2.25, 7.5, 5.25, 1.7, 2.3, 0.25],\n        answer: 11.75\n    },\n    {\n        numbers: [0.125, 3.375, 2.75, 1.25, 0.875, 0.125, 1.625, 3.75, 1.25, 3.475, 3.275],\n        answer: 11.75\n    },\n];\nCustom quizzes are stored in localStorage like so:\nfunction loadCustomQuizzes() {\n    try {\n        const stored = localStorage.getItem('customQuizzes');`;
versionContent.textContent = `v0.9 INDEV: initial commit\nv1.0 PRE-ALPHA: added 3 new levels\nv1.1 ALPHA: added 2 new levels; added sound effects\nv1.1-2 BETA: added fonts\nv1.2: added 2 new levels\nv1.2-2: changed description\nv1.2-3: fixed minor bugs\nv1.2-20: redid layout; added reset button\nv1.3: added more fonts\nv1.4: added coins display\nv1.4-2: added level display\nv1.4-3: changed level display to show current level, not index\nv1.4-4: changed coin calculation formula\nv1.5: added lives system; fixed coin calculation bug\nv1.5-2: fixed lives not resetting on game over bug\nv1.5-3: changed game over behavior to reset level and coins\nv1.6: added styles to new displays\nv1.6-2: updated css for new displays\nv1.6-3: adjusted layout margins for better appearance\nv1.7: added animated background blobs\nv1.7-2: changed css display opacity\nv1.8: quiz data refactored\nv1.8-2: quiz answers are now shuffled every attempt\nv1.9: added button drop animation\nv1.9-2: fixed drop animation bugs; changed speed and distance\nv1.9-3: added button drop animation for other buttons\nv1.9-4: fixed button drop animation bugs\nv1.9-20: generateLevel function refactored\nv2.0: added difficulty settings (easy, medium, hard)\nv2.0-2: added difficulty buttons and related css\nv2.0-3: added modular resetGame function\nv2.0-20: reset game on difficulty change\nv2.0-21: fixed lives not resetting properly bug; refactored resetGame function\nv2.0-22: refactored resetBtn in css and html\nv2.1: changed difficulty-container layout; changed fonts for score displays\nv2.1-2: adjusted difficulty-container margins; changed button font size to 1rem\nv2.1-20: fixed some button hover bugs\nv2.1-21: fixed more button hover bugs\nv2.1-22: coins calculation now factors difficulty level\nv2.2: coins renamed to xp\nv2.2-2: updated css for xp display; closed bg div in html\nv2.3: added stack-container\nv2.3-1: added styles for stack-container in css; refactored difficulty-container in css\nv2.3-2: adjusted stack-container position; fixed xp integer display bug\nv2.3-3: changed fonts\nv2.4: on hard difficulty, answer sum is hidden\nv2.5: added hint button that costs xp; added mute button\nv2.5-2: adjusted hint button styles\nv2.5-20: hint button disabled on hard difficulty\nv2.5-21: added updateHintUI function; fixed bugs`;

function openInfoModal() {
    if (!infoModal) return;
    infoModal.classList.remove('hidden');
    void infoModal.offsetWidth;
    infoModal.classList.add('open');
    setDim(true, 'info');
    document.body.classList.add('modal-open');
}
function closeInfoModal() {
    if (!infoModal) return;
    infoModal.classList.remove('open');
    setDim(false, 'info');
    const onEnd = (e) => {
        if (e.target !== infoModal) return;
        infoModal.classList.add('hidden');
        document.body.classList.remove('modal-open');
        infoModal.removeEventListener('transitionend', onEnd);
    };
    infoModal.addEventListener('transitionend', onEnd);
    setTimeout(() => {
        if (!infoModal.classList.contains('hidden')) {
            infoModal.classList.add('hidden');
            document.body.classList.remove('modal-open');
            infoModal.removeEventListener('transitionend', onEnd);
        }
    }, 420);
}
if (infoBtn) infoBtn.addEventListener('click', openInfoModal);
if (infoClose) infoClose.addEventListener('click', closeInfoModal);

// Tab switching for info modal
if (readmeTab && versionTab && readmePanel && versionPanel) {
    readmeTab.addEventListener('click', () => {
        readmeTab.classList.add('active');
        versionTab.classList.remove('active');
        readmePanel.classList.remove('hidden');
        versionPanel.classList.add('hidden');
    });
    versionTab.addEventListener('click', () => {
        versionTab.classList.add('active');
        readmeTab.classList.remove('active');
        versionPanel.classList.remove('hidden');
        readmePanel.classList.add('hidden');
    });
}
versionContent.textContent += '\nv5.0: integrated with the mini-games tab, refreshed the interface, and moved achievements into the shared system';
let resetSfx = new Audio('reset.wav');
let passSfx = new Audio('pass.wav');
let bgMusic = document.getElementById('bgMusic');
bgMusic.loop = true;
bgMusic.volume = 0.5;
let overlay = document.body;

// dim background
function setDim(on, edit=null) {
    const bg = document.getElementById('bg');
    if (!bg) return;
    Array.from(bg.children).forEach(child => {
        if (versionInfo && child.contains(versionInfo)) return;
        if (edit === 'editor') {
            if (child === levelEditor || (levelEditor && child.contains(levelEditor))) return;
        }
        if (edit === 'stats' && child === statsAchievementsModal) return;
        if (edit === 'info' && child === infoModal) return;
        if (on) child.classList.add('dimmed'); else child.classList.remove('dimmed');
    });
}
// open/close with animation
function openEditor() {
    if (!levelEditor) return;
    if (!levelEditor.classList.contains('hidden')) return;
    // prep
    levelEditor.classList.remove('hidden');
    levelEditor.offsetHeight;
    levelEditor.classList.add('open');
    setDim(true, 'editor');
    document.body.classList.add('modal-open');
}

function closeEditor() {
    if (!levelEditor) return;
    if (levelEditor.classList.contains('hidden')) return;
    levelEditor.classList.remove('open');
    setDim(false, 'editor');
    const onEnd = (e) => {
        if (e.target !== levelEditor) return;
        levelEditor.classList.add('hidden');
        document.body.classList.remove('modal-open');
        levelEditor.removeEventListener('transitionend', onEnd);
    };
    levelEditor.addEventListener('transitionend', onEnd);
    setTimeout(() => {
        if (!levelEditor.classList.contains('hidden')) {
            levelEditor.classList.add('hidden');
            document.body.classList.remove('modal-open');
            levelEditor.removeEventListener('transitionend', onEnd);
        }
    }, 420);
}

// editor close keybinds
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (levelEditor && !levelEditor.classList.contains('hidden')) {
            closeEditor();
        }
    }
});
// sound state persisted
let soundEffectsEnabled = true;
let confettiEnabled = true;
let musicEnabled = false;
let popupLarge = false;

function getAppSetting(section, key, fallback) {
    if (window.parent !== window && typeof window.parent.getAppSetting === 'function') {
        return window.parent.getAppSetting(section, key, fallback);
    }
    return fallback;
}

function syncAppSettings() {
    soundEffectsEnabled = Boolean(getAppSetting('audio', 'sound effects', true));
    confettiEnabled = Boolean(getAppSetting('number pillars', 'confetti', true));
    musicEnabled = Boolean(getAppSetting('number pillars', 'music', false));
    popupLarge = Boolean(getAppSetting('number pillars', 'large popups', false));
    [clickSfx, resetSfx, passSfx].forEach(audio => {
        audio.muted = !soundEffectsEnabled;
    });
    bgMusic.muted = !musicEnabled;
    if (!musicEnabled) bgMusic.pause();
}

if (window.parent !== window && window.parent.settingsReady) {
    window.parent.settingsReady.then(syncAppSettings).catch(error => {
        console.error('Could not load Number Pillars settings.', error);
    });
}
if (window.parent !== window) {
    window.parent.addEventListener('app-setting-changed', event => {
        if (event.detail?.section === 'audio' || event.detail?.section === 'number pillars') {
            syncAppSettings();
        }
    });
}
syncAppSettings();

document.addEventListener('pointerdown', () => {
    if (!musicEnabled || !bgMusic.paused) return;
    bgMusic.play().catch(error => {
        console.warn('Could not play Number Pillars background music.', error);
    });
});

// tooltip helper
function attachTooltip(el, getMessage) {
    if (!el) return () => {};
    let _prevTitle = null;
    const resolveMessage = () => (typeof getMessage === 'function' ? getMessage() : getMessage);
    const show = () => {
        const msg = resolveMessage();
        _prevTitle = el.getAttribute('title');
        if (_prevTitle !== null) el.removeAttribute('title');
        if (msg) el.setAttribute('data-tooltip', msg);
        // mark visible for css
        el.setAttribute('data-tooltip-visible', 'true');
    };
    const hide = () => {
        el.removeAttribute('data-tooltip-visible');
        setTimeout(() => el.removeAttribute('data-tooltip'), 220);
        if (_prevTitle !== null) {
            el.setAttribute('title', _prevTitle);
            _prevTitle = null;
        }
    };
    el.addEventListener('mouseenter', show);
    el.addEventListener('focus', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('blur', hide);
    // return a detach function
    return () => {
        el.removeEventListener('mouseenter', show);
        el.removeEventListener('focus', show);
        el.removeEventListener('mouseleave', hide);
        el.removeEventListener('blur', hide);
        hide();
    };
}


// attach generic tooltips
attachTooltip(resetBtn, 'Reset the level');
attachTooltip(easyBtn, 'EASY mode - 5 lives, hints enabled');
attachTooltip(mediumBtn, 'MEDIUM mode - 3 lives, hints enabled');
attachTooltip(hardBtn, 'HARD mode - 1 life, no hints. Sum is hidden');
attachTooltip(editorToggle, 'LEVEL EDITOR - Create and save your own levels!');
// hint button with dynamic message
attachTooltip(hintBtn, () => {
    if (difficulty === 'hard') return 'Hints disabled in HARD mode';
    if (parseInt(xp.innerText) < hintCost) return `You need ${hintCost - parseInt(xp.innerText)} more XP for a hint`;
    return `Cost: ${hintCost} XP`;
});

attachTooltip(xp, ' Earn XP by completing levels. Spend your XP on hints!');
attachTooltip(lives, 'Number of LIVES remaining. Lose all lives and it\'s GAME OVER!');
attachTooltip(levelIndex, 'Current LEVEL. Advance by completing quizzes.');
attachTooltip(targetNum, 'TARGET number. You need to reach it by removing numbers from the stack.');
attachTooltip(answerSum, () => {
    if (difficulty === 'hard') return 'Sum hidden in HARD mode';
    return 'Current SUM of remaining numbers in the stack.';
}
);

// Level editor: storage and UI
function loadCustomQuizzes() {
    try {
        const stored = localStorage.getItem('customQuizzes');
        if (stored) {
            customQuizzes = JSON.parse(stored);
            console.log(customQuizzes);
            // push to quizzes
            customQuizzes.forEach(q => quizzes.push(q));
        }
    } catch (e) { customQuizzes = []; }
    renderCustomList();
}

function storeCustomQuizzes() {
    localStorage.setItem('customQuizzes', JSON.stringify(customQuizzes));
}

function renderCustomList() {
    if (!customListEl) return;
    customListEl.innerHTML = '';
    customQuizzes.forEach((quiz, i) => {
        const li = document.createElement('li');
        const meta = document.createElement('div');
        meta.textContent = `#${i+1} ${quiz.name} — Target: ${quiz.answer} — [${quiz.numbers.join(', ')}]`;
        const actions = document.createElement('div');
        const play = document.createElement('button'); play.textContent = 'Play';
        const del = document.createElement('button'); del.textContent = 'Delete';
        play.addEventListener('click', () => {
            // push to quizzes (avoid duplicating if already present)
            quizzes.push(quiz);
            quizIndex = quizzes.length - 1;
            recordNumberPillarsAchievementEvent('custom-level-played');
            generateLevel();
            closeEditor();
        });
        del.addEventListener('click', () => {
            // remove from custom list and from quizzes
            customQuizzes.splice(i, 1);
            // remove first matching quiz from quizzes array
            const idx = quizzes.findIndex(x => x.answer === quiz.answer && JSON.stringify(x.numbers) === JSON.stringify(quiz.numbers));
            if (idx !== -1) quizzes.splice(idx, 1);
            storeCustomQuizzes();
            renderCustomList();
        });
        actions.appendChild(play);
        actions.appendChild(del);
        li.appendChild(meta);
        li.appendChild(actions);
        customListEl.appendChild(li);
    });
}

if (editorToggle) {
    editorToggle.addEventListener('click', () => {
        if (!levelEditor) return;
        const isHidden = levelEditor.classList.contains('hidden');
        if (isHidden) {
            openEditor();
        } else {
            closeEditor();
        }
    });
}
if (editorClose) {
    editorClose.addEventListener('click', () => {
        if (!levelEditor) return;
        closeEditor();
    });
}

if (editorSave) {
    editorSave.addEventListener('click', () => {
        const rawNumbers = (editorNumbers && editorNumbers.value) || '';
        const rawTarget = (editorTarget && editorTarget.value) || '';
        const numbers = rawNumbers.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
        const target = parseFloat(rawTarget);
        const editname = editorName.value;
        console.log(editname)
        if (numbers.length === 0 || isNaN(target)) {
            alert('Please enter valid numbers and a numeric target.');
            return;
        }
        const newQuiz = {name: editname, numbers, answer: target};
        customQuizzes.push(newQuiz);
        quizzes.push(newQuiz);
        storeCustomQuizzes();
        renderCustomList();
        quizIndex = quizzes.length - 1;
        recordNumberPillarsAchievementEvent('custom-level-played');
        generateLevel();
        // close with animation
        closeEditor();
    });
}

if (shareLevelBtn) {
    shareLevelBtn.addEventListener('click', async () => {
        const share = window.parent.shareGameToChat;
        if (typeof share !== 'function') {
            showPopup('Sharing is available when Number Pillars is opened from the app.', 'warning', {shake: true});
            return;
        }

        const quiz = quizzes[quizIndex];
        shareLevelBtn.disabled = true;
        try {
            await share('number-pillars', {
                name: quiz.name || `Level ${quizIndex + 1}`,
                numbers: [...quiz.numbers],
                answer: quiz.answer
            });
            showPopup('Level shared in chat!', 'success');
        } catch (error) {
            showPopup(error.message || 'Could not share the level.', 'error', {shake: true});
        } finally {
            shareLevelBtn.disabled = false;
        }
    });
}

// load stored custom quizzes at startup
loadCustomQuizzes();

function loadSharedLevel() {
    const serialized = new URLSearchParams(window.location.search).get('shared');
    if (!serialized) return;

    try {
        const shared = JSON.parse(serialized);
        if (
            shared?.game !== 'number-pillars' ||
            !Array.isArray(shared.numbers) ||
            shared.numbers.length === 0 ||
            shared.numbers.length > 40 ||
            !shared.numbers.every(number => Number.isFinite(number) && Math.abs(number) <= 1_000_000) ||
            !Number.isFinite(shared.answer) ||
            Math.abs(shared.answer) > 1_000_000 ||
            (shared.name !== undefined && (typeof shared.name !== 'string' || shared.name.length > 60))
        ) {
            throw new Error('The shared Number Pillars level is invalid.');
        }

        quizzes.push({
            name: shared.name || 'Shared level',
            numbers: [...shared.numbers],
            answer: shared.answer
        });
        quizIndex = quizzes.length - 1;
        showPopup(`Loaded ${shared.name || 'shared level'}.`, 'success');
    } catch (error) {
        showPopup(error.message || 'Could not load the shared level.', 'error', {shake: true});
    }
}

function resetGame() {
    quizIndex = 0;
    currentStreak = 0;
    if (difficulty == "easy") {
        newlives = 5;
        difficultyIndex = 1;
    } else if (difficulty == "medium") {
        newlives = 3;
        difficultyIndex = 2;
    } else if (difficulty == "hard") {
        newlives = 1;
        answerSum.style.cursor = 'not-allowed';
        difficultyIndex = 3;
    }
    lives.innerText = newlives;
    xp.innerText = 0;
    levelIndex.innerText = 1;
    updateHintUI();
    generateLevel();
}
resetBtn.addEventListener("click", () => {
    resetSfx.play();
    generateLevel();
});

easyBtn.addEventListener("click", () => {
    difficulty = "easy";
    clickSfx.play();
    showPopup("Difficulty set to EASY.", 'success');
    resetGame();
    updateDifficultyButtons();
});

mediumBtn.addEventListener("click", () => {
    difficulty = "medium";
    clickSfx.play();
    showPopup("Difficulty set to MEDIUM.", 'info');
    resetGame();
    updateDifficultyButtons();
});

hardBtn.addEventListener("click", () => {
    difficulty = "hard";
    clickSfx.play();
    showPopup("Difficulty set to HARD.", 'warning');
    resetGame();
    updateDifficultyButtons();
});


function updateHintUI() {
    if (!hintBtn) return;
    const currentXP = parseInt(xp.innerText) || 0;
    if (difficulty === 'hard' || currentXP < hintCost) {
        hintBtn.disabled = true;
        hintBtn.removeEventListener('click', giveHint);
    } else {
        hintBtn.disabled = false;
        hintBtn.title = '';
        hintBtn.removeEventListener('click', giveHint);
        hintBtn.addEventListener('click', giveHint);
    }
}

// initial UI update
updateHintUI();

function generateLevel() {
    // setup quiz
    if (difficulty != "easy") {
        shuffleAll();
    }
    let quiz = quizzes[quizIndex];
    targetNum.innerText = quiz.answer;
    answer = [...quiz.numbers];
    answerSum.innerText = difficulty === "hard"
        ? "???"
        : answer.reduce((sum, num) => sum + num, 0);
    stack.innerHTML = "";

    quiz.numbers.forEach((num, index) => {
        let li = document.createElement("li");
        li.dataset.index = index;
        li.innerText = num;
        li.addEventListener("click", (e) => {
            // prevent double-clicks
            li.style.pointerEvents = 'none';
            // update answer for this index now, but defer level logic until after animation
            answer[index] = 0;

            // animate removal
            const liStyle = getComputedStyle(li);
            const liHeight = li.offsetHeight;
            const liMargin = parseFloat(liStyle.marginBottom) || 0;

            const placeholder = document.createElement('li');
            placeholder.className = 'placeholder';
            placeholder.style.height = liHeight + 'px';
            placeholder.style.marginBottom = liMargin + 'px';

            const clone = li.cloneNode(true);
            clone.className = 'floating-clone';

            const liRect = li.getBoundingClientRect();
            clone.style.position = 'fixed';
            clone.style.left = liRect.left + 'px';
            clone.style.top = liRect.top + 'px';
            clone.style.width = liRect.width + 'px';
            clone.style.height = liRect.height + 'px';
            clone.style.margin = '0';
            clone.style.zIndex = 10000;

            // safe finalize to run findAnswerSum once after animation completes
            let finalized = false;
            const finalize = () => {
                if (finalized) return;
                finalized = true;
                console.log('calling findAnswerSum');
                findAnswerSum();
            };

            // replace block (this will always run before generateLevel can clear stack because we defer calling it)
            try {
                stack.replaceChild(placeholder, li);
            } catch (err) {
                // if replaceChild fails (li not found), quietly insert placeholder at end
                if (stack.contains(li)) stack.replaceChild(placeholder, li);
            }

            overlay.appendChild(clone);
            requestAnimationFrame(() => {
                placeholder.classList.add('collapse');
                clone.classList.add('drop-out');
                // cleanup & finalize
                clone.addEventListener('animationend', () => {
                    if (clone.parentElement === overlay) overlay.removeChild(clone);
                    finalize();
                }, { once: true });
                // fallback: if animationend doesn't fire, remove after animation duration
                setTimeout(() => {
                    if (clone.parentElement === overlay) overlay.removeChild(clone);
                    finalize();
                }, 800);
                placeholder.addEventListener('transitionend', () => {
                    if (placeholder.parentElement === stack) stack.removeChild(placeholder);
                }, { once: true });
            });
        });

        stack.appendChild(li);
    });
    // Do NOT call findAnswerSum() here!
}

function findAnswerSum() {
    let sum = 0;
    answer.forEach((num) => {
        sum += num;
    });
    if (difficulty == "hard") {
        answerSum.innerText = "???";
    } else {
        answerSum.innerText = sum;
    }
    // check if the sum matches the target number
    if (sum == quizzes[quizIndex].answer) {
        setTimeout(() => {
            showPopup('Correct', 'success');
            if (confettiEnabled) confettiBurst();
            setTimeout(() => {
                try {
                    nextQuiz();
                } catch (err) {
                    console.error('nextQuiz threw', err);
                    showPopup('Error advancing to next level.', 'error', {shake:true});
                }
            }, 900);
        }, 500);
        return;
    }
    if (sum < quizzes[quizIndex].answer) {
        generateLevel();
        resetSfx.play();
        lives.innerText = parseInt(lives.innerText) - 1;
        showPopup('Your sum is too small. Try again.', 'warning', {shake:true});
        resetStreak();
    }
    if (parseInt(lives.innerText) <= 0) {
        showPopup('Game Over', 'error', {shake:true, duration: 2200});
        setTimeout(() => resetGame(), 1200);
        resetStreak();
    }
}

function giveHint() {
    xp.innerText = parseInt(xp.innerText) - hintCost;
    usedHint = true;
    updateHintUI();

    // find removal candidates
    const target = quizzes[quizIndex].answer;
    const sum = answer.reduce((a,b)=>a+b, 0);
    const diff = sum - target;

    let candidates = [];
    answer.forEach((num, i) => {
        if (num > 0 && num <= diff) candidates.push({num, i});
    });
    let chosen;
    if (candidates.length > 0) {
        chosen = candidates.reduce((a,b) => (b.num > a.num ? b : a));
    } else {
        // fallback: choose smallest positive number
        const pos = answer.map((n,i)=>({n,i})).filter(x=>x.n>0).sort((a,b)=>a.n-b.n);
        chosen = pos[0];
    }
    console.log('giveHint: chosen', chosen);

    // Remove previous hint glows
    document.querySelectorAll('#stack li.hint').forEach(el => el.classList.remove('hint'));
    // Add hint glow to the chosen box
    if (chosen && typeof chosen.i === 'number') {
        const stackItems = document.querySelectorAll('#stack li');
        // stack is rendered in reverse, so find the correct index
        const idx = answer.length - 1 - chosen.i;
        if (stackItems[idx]) {
            stackItems[idx].classList.add('hint');
        }
    }
    // tooltip handling done above
    updateHintUI();
}

// advance to the next quiz/level
function nextQuiz() {
    console.log('nextQuiz: current index', quizIndex);
    const completedQuiz = quizzes[quizIndex];
    const previousXP = parseInt(xp.innerText, 10) || 0;
    quizIndex++;
    if (quizIndex >= quizzes.length) {
        quizIndex = 0;
    }
    levelIndex.innerText = quizIndex + 1;
    generateLevel();
    passSfx.play();
    // showPopup and confetti handled in findAnswerSum
    if (usedHint) {
        xp.innerText = parseInt(xp.innerText) + (difficultyIndex*2) + (quizIndex * 1) - 2;
    } else {
        xp.innerText = parseInt(xp.innerText) + (difficultyIndex*4) + (quizIndex * 3) + 5;
    }
    const earnedXp = Math.max((parseInt(xp.innerText, 10) || 0) - previousXP, 0);
    updateStatsOnWin(earnedXp);
    recordNumberPillarsAchievementEvent('level-completed', {
        streak: currentStreak,
        earnedXp,
        difficulty,
        customLevel: Boolean(completedQuiz?.name)
    });
    usedHint = false;
    // Remove any hint glows from previous level
    setTimeout(() => {
        document.querySelectorAll('#stack li.hint').forEach(el => el.classList.remove('hint'));
    }, 0);
    updateHintUI();
}

loadSharedLevel();
generateLevel();

(function(){
    const blobs = document.querySelectorAll('.animated-bg .blob');
    if(!blobs || blobs.length === 0) return;
    let mouseX = 0, mouseY = 0, ticking = false;
    window.addEventListener('mousemove', (e)=>{
        mouseX = (e.clientX / window.innerWidth - 0.5);
        mouseY = (e.clientY / window.innerHeight - 0.5);
        if(!ticking){
            ticking = true;
            requestAnimationFrame(()=>{
                blobs.forEach((b,i)=>{
                    const depth = (i+1) * 500;
                    b.style.transform = `translate3d(${mouseX*depth}vw, ${mouseY*depth}vh, 0)`;
                });
                ticking = false;
            });
        }
    }, {passive:true});
})();

function updateDifficultyButtons() {
    const buttons = [easyBtn, mediumBtn, hardBtn];
    buttons.forEach(btn => {
        btn.classList.remove('difficulty-selected');
        btn.disabled = false;
        btn.style.pointerEvents = '';
    });
    if (difficulty === 'easy') {
        easyBtn.classList.add('difficulty-selected');
        easyBtn.disabled = true;
        easyBtn.style.pointerEvents = 'none';
    } else if (difficulty === 'medium') {
        mediumBtn.classList.add('difficulty-selected');
        mediumBtn.disabled = true;
        mediumBtn.style.pointerEvents = 'none';
    } else if (difficulty === 'hard') {
        hardBtn.classList.add('difficulty-selected');
        hardBtn.disabled = true;
        hardBtn.style.pointerEvents = 'none';
    }
}

// Call on startup and after reset
updateDifficultyButtons();

// Stats/Achievements Modal logic

function openStatsModal() {
    if (!statsAchievementsModal) return;
    statsAchievementsModal.classList.remove('hidden');
    void statsAchievementsModal.offsetWidth;
    statsAchievementsModal.classList.add('open');
    setDim(true, 'stats');
    document.body.classList.add('modal-open');
    updateStatsAndAchievements();
}
function closeStatsModal() {
    if (!statsAchievementsModal) return;
    statsAchievementsModal.classList.remove('open');
    setDim(false, 'stats');
    const onEnd = (e) => {
        if (e.target !== statsAchievementsModal) return;
        statsAchievementsModal.classList.add('hidden');
        document.body.classList.remove('modal-open');
        statsAchievementsModal.removeEventListener('transitionend', onEnd);
    };
    statsAchievementsModal.addEventListener('transitionend', onEnd);
    setTimeout(() => {
        if (!statsAchievementsModal.classList.contains('hidden')) {
            statsAchievementsModal.classList.add('hidden');
            document.body.classList.remove('modal-open');
            statsAchievementsModal.removeEventListener('transitionend', onEnd);
        }
    }, 420);
}
if (statsBtn) statsBtn.addEventListener('click', openStatsModal);
if (statsClose) statsClose.addEventListener('click', closeStatsModal);

let currentStreak = 0;

function updateStatsAndAchievements() {
    document.getElementById('statGamesPlayed').textContent = localStorage.getItem('gamesPlayed') || '0';
    document.getElementById('statBestStreak').textContent = localStorage.getItem('bestStreak') || '0';
    document.getElementById('statAvgScore').textContent = localStorage.getItem('avgScore') || '0';
    document.getElementById('statTotalXP').textContent = localStorage.getItem('totalXP') || '0';
}

function recordNumberPillarsAchievementEvent(eventName, details = {}) {
    if (window.parent === window) return;
    try {
        const recorder = window.parent.achievements?.recordGameEvent;
        if (typeof recorder !== 'function') {
            console.error('Game achievement tracker is unavailable.');
            return;
        }
        Promise.resolve(recorder('number-pillars', eventName, details)).catch(error => {
            console.error('Could not record Number Pillars achievement progress.', error);
        });
    } catch (error) {
        console.error('Could not reach the game achievement tracker.', error);
    }
}

function updateStatsOnWin(earnedXp) {
    const gamesPlayed = parseInt(localStorage.getItem('gamesPlayed') || '0', 10) + 1;
    localStorage.setItem('gamesPlayed', gamesPlayed);
    currentStreak++;
    const previousBestStreak = parseInt(localStorage.getItem('bestStreak') || '0', 10);
    const bestStreak = Math.max(currentStreak, previousBestStreak);
    localStorage.setItem('bestStreak', bestStreak);
    const totalXP = parseInt(localStorage.getItem('totalXP') || '0', 10) + earnedXp;
    localStorage.setItem('totalXP', totalXP);
    localStorage.setItem('avgScore', Math.round(totalXP / gamesPlayed));
    updateStatsAndAchievements();
}

function resetStreak() {
    currentStreak = 0;
}

if (resetStatsBtn) {
    resetStatsBtn.addEventListener('click', () => {
        if (!window.confirm('Reset your Number Pillars statistics?')) return;
        ['gamesPlayed', 'bestStreak', 'avgScore', 'totalXP'].forEach(key => localStorage.removeItem(key));
        currentStreak = 0;
        updateStatsAndAchievements();
    });
}