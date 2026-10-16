import * as num from './num.js';
import { aiSolve } from './algorithm.js';

const DIFFICULTY_SETTINGS = {
    easy: { digits: 3, allowRepeats: true },
    medium: { digits: 4, allowRepeats: false },
    hard: { digits: 5, allowRepeats: false }
};

// Utility functions
function getBullsAndCows(secret, guess) {
    let bulls = 0, cows = 0;
    for (let i = 0; i < secret.length; i++) {
        if (guess[i] === secret[i]) bulls++;
        else if (secret.includes(guess[i])) cows++;
    }
    return { bulls, cows };
}

function addGuess(guess, bulls, cows, solver = 'you') {
    const li = document.createElement('li');
    li.className = 'guess-row';

    const guessNumber = document.createElement('span');
    guessNumber.className = 'guess-number';
    guessNumber.textContent = String(++attemptCount).padStart(2, '0');

    const pegRow = document.createElement('div');
    pegRow.className = 'peg-row';
    guess.split('').forEach(digit => {
        const peg = document.createElement('span');
        peg.className = `peg peg-${digit}`;
        peg.textContent = digit;
        pegRow.appendChild(peg);
    });

    const feedbackRow = document.createElement('div');
    feedbackRow.className = 'feedback-row';
    const feedbackPegs = document.createElement('div');
    feedbackPegs.className = 'feedback-pegs';
    for (let i = 0; i < bulls; i++) {
        const peg = document.createElement('span');
        peg.className = 'feedback-peg feedback-peg-bull';
        feedbackPegs.appendChild(peg);
    }
    for (let i = 0; i < cows; i++) {
        const peg = document.createElement('span');
        peg.className = 'feedback-peg feedback-peg-cow';
        feedbackPegs.appendChild(peg);
    }
    const feedbackText = document.createElement('span');
    feedbackText.className = 'feedback-text';
    feedbackText.textContent = `${bulls}B · ${cows}C`;
    feedbackText.setAttribute(
        'aria-label',
        `${bulls} ${bulls === 1 ? 'bull' : 'bulls'}, ${cows} ${cows === 1 ? 'cow' : 'cows'}`
    );
    feedbackRow.className = 'guess-feedback';
    feedbackRow.append(feedbackPegs, feedbackText);

    li.append(guessNumber, pegRow, feedbackRow);
    guessesList.appendChild(li);
    document.getElementById('attempt-count').textContent =
        `${attemptCount} ${attemptCount === 1 ? 'guess' : 'guesses'}`;
    document.getElementById('empty-history').hidden = true;
    const gameStatus = document.getElementById('gameStatus');
    const gameHint = document.getElementById('gameHint');
    gameStatus.textContent = bulls === digits
        ? (solver === 'computer' ? 'The AI cracked the code!' : 'Code cracked!')
        : 'Guess recorded';
    gameHint.textContent = bulls === digits
        ? `${solver === 'computer' ? 'The AI' : 'You'} solved the ${digits}-digit code in ${attemptCount} ${attemptCount === 1 ? 'guess' : 'guesses'}.`
        : `${bulls} ${bulls === 1 ? 'bull' : 'bulls'} and ${cows} ${cows === 1 ? 'cow' : 'cows'} — keep going.`;
    if (bulls === digits) {
        gameFinished = true;
        guessInput.disabled = true;
        document.getElementById('submit-guess').disabled = true;
    }
}

function addRevealedSecretToList() {
    if (!guessesList) return;
    const existingReveal = guessesList.querySelector('.secret-reveal-item');
    if (existingReveal) {
        existingReveal.textContent = `SECRET: ${secret}`;
        return;
    }

    const li = document.createElement('li');
    li.className = 'secret-reveal-item';
    li.textContent = `SECRET: ${secret}`;
    guessesList.appendChild(li);
    document.getElementById('empty-history').hidden = true;
    document.getElementById('gameStatus').textContent = 'Code revealed';
    document.getElementById('gameHint').textContent = 'Start a new game when you are ready to try again.';
    gameFinished = true;
    guessInput.disabled = true;
    document.getElementById('submit-guess').disabled = true;
}
// Universal elements
let secret = num.getRandomNumber(4, 'string');
let guesses = [];
let attemptCount = 0;
let gameFinished = false;
let currentDifficulty = 'medium';
const guessForm = document.getElementById('guess-form');
const guessInput = document.getElementById('guess-input');
const guessesList = document.getElementById('guesses-list');
const revealSecretBtn = document.getElementById('reveal-secret');
const bullsElem = document.getElementById('bulls');
const cowsElem = document.getElementById('cows');
//AI solve elements
const aiSolveBtn = document.getElementById('ai-solve-btn');
const youBtn = document.getElementById('you-btn');
const aiSolveModal = document.getElementById('ai-solve-modal');
const easyBtn = document.getElementById('easy-btn');
const mediumBtn = document.getElementById('medium-btn');
const hardBtn = document.getElementById('hard-btn');
const aiSecretLabel = document.getElementById('ai-secret-label');
let digits = DIFFICULTY_SETTINGS[currentDifficulty].digits;
let allowRepeats = DIFFICULTY_SETTINGS[currentDifficulty].allowRepeats;
const userSecretInput = document.getElementById('user-secret-input');
const startAiSolveBtn = document.getElementById('start-ai-solve');
const closeAiSolveBtn = document.getElementById('close-ai-solve');

function setModeButtonActive(btn) {
    aiSolveBtn.classList.remove('pressed');
    youBtn.classList.remove('pressed');
    if (btn) btn.classList.add('pressed');
}

function setDifficultyButtonActive(btn) {
    easyBtn.classList.remove('pressed');
    mediumBtn.classList.remove('pressed');
    hardBtn.classList.remove('pressed');
    if (btn) btn.classList.add('pressed');
}

function getDefaultPlaceholder() {
    return Array.from({ length: digits }, (_, idx) => idx.toString()).join('');
}

function updateInputRules() {
    if (guessInput) {
        guessInput.maxLength = digits;
        guessInput.pattern = `\\d{${digits}}`;
        guessInput.placeholder = getDefaultPlaceholder();
    }
    if (userSecretInput) {
        userSecretInput.maxLength = digits;
        userSecretInput.pattern = `\\d{${digits}}`;
        userSecretInput.placeholder = getDefaultPlaceholder();
    }
    if (aiSecretLabel) {
        const repeatHint = allowRepeats ? ' Repeated digits are allowed.' : ' Digits must be unique.';
        aiSecretLabel.textContent = `Enter a ${digits}-digit number for the AI to solve.${repeatHint}`;
    }
    const inputHint = document.getElementById('input-hint');
    if (inputHint) {
        inputHint.textContent = allowRepeats
            ? 'Repeated digits are allowed for this difficulty.'
            : 'Use each digit once on this difficulty.';
    }
}

function isValidCode(code) {
    if (!new RegExp(`^\\d{${digits}}$`).test(code)) return false;
    if (!allowRepeats && new Set(code).size !== digits) return false;
    return true;
}
function recordGameAchievementEvent(eventName, details) {
    if (window.parent === window) return;
    try {
        const recorder = window.parent.achievements?.recordGameEvent;
        if (typeof recorder !== 'function') {
            console.error('Game achievement tracker is unavailable.');
            return;
        }
        recorder('mastermind', eventName, details).catch(error => {
            console.error('Could not record Bulls & Cows achievement progress.', error);
        });
    } catch (error) {
        console.error('Could not reach the game achievement tracker.', error);
    }
}

function resetGameState() {
    guesses = [];
    attemptCount = 0;
    gameFinished = false;
    guessesList.innerHTML = '';
    guessInput.removeAttribute('aria-invalid');
    guessInput.disabled = false;
    document.getElementById('submit-guess').disabled = false;
    document.getElementById('attempt-count').textContent = '0 guesses';
    document.getElementById('empty-history').hidden = false;
    bullsElem.textContent = '0';
    cowsElem.textContent = '0';
    document.getElementById('gameStatus').textContent = 'Crack the secret code';
    document.getElementById('gameHint').textContent =
        'Enter a code to see how many digits are in the right place.';
    secret = num.getRandomNumber(digits, 'string', allowRepeats);
}

function applyDifficulty(level, btn) {
    currentDifficulty = level;
    digits = DIFFICULTY_SETTINGS[level].digits;
    allowRepeats = DIFFICULTY_SETTINGS[level].allowRepeats;
    setDifficultyButtonActive(btn);
    updateInputRules();
    resetGameState();
}

// Set 'You' as default pressed on load
setModeButtonActive(youBtn);
setDifficultyButtonActive(mediumBtn);
updateInputRules();
secret = num.getRandomNumber(digits, 'string', allowRepeats);

if (guessForm) {
    guessForm.addEventListener('submit', function(e) {
        e.preventDefault();
        if (gameFinished) return;
        const guess = guessInput.value;
        if (!isValidCode(guess)) {
            guessInput.setAttribute('aria-invalid', 'true');
            document.getElementById('gameStatus').textContent = 'That code is not valid';
            document.getElementById('gameHint').textContent = allowRepeats
                ? `Enter exactly ${digits} digits.`
                : `Enter ${digits} different digits.`;
            return;
        }
        guessInput.removeAttribute('aria-invalid');
        const { bulls, cows } = getBullsAndCows(secret, guess);
        bullsElem.textContent = bulls;
        cowsElem.textContent = cows;
        addGuess(guess, bulls, cows);
        guesses.push({ guess, bulls, cows });
        guessInput.value = '';
        if (bulls === digits) {
            recordGameAchievementEvent('solved', {
                difficulty: currentDifficulty,
                guesses: attemptCount
            });
        }
    });
}

const resetBtn = document.getElementById('reset-game');
if (resetBtn) {
    resetBtn.addEventListener('click', function() {
        resetGameState();
    });
}

if (revealSecretBtn) {
    revealSecretBtn.addEventListener('click', function() {
        addRevealedSecretToList();
    });
}

if (easyBtn) {
    easyBtn.addEventListener('click', () => applyDifficulty('easy', easyBtn));
}
if (mediumBtn) {
    mediumBtn.addEventListener('click', () => applyDifficulty('medium', mediumBtn));
}
if (hardBtn) {
    hardBtn.addEventListener('click', () => applyDifficulty('hard', hardBtn));
}

if (aiSolveBtn && aiSolveModal) {
    aiSolveBtn.addEventListener('click', () => {
        setModeButtonActive(aiSolveBtn);
        aiSolveModal.hidden = false;
        userSecretInput.focus();
    });
}
if (closeAiSolveBtn && aiSolveModal) {
    closeAiSolveBtn.addEventListener('click', () => {
        aiSolveModal.hidden = true;
        userSecretInput.value = '';
        userSecretInput.removeAttribute('aria-invalid');
        setModeButtonActive(youBtn);
    });
}
if (youBtn) {
    youBtn.addEventListener('click', () => {
        setModeButtonActive(youBtn);
        // Optionally reset UI for user mode
    });
}
if (startAiSolveBtn && userSecretInput) {
    startAiSolveBtn.addEventListener('click', () => {
        const userSecret = userSecretInput.value;
        if (!isValidCode(userSecret)) {
            userSecretInput.setAttribute('aria-invalid', 'true');
            return;
        }
        userSecretInput.removeAttribute('aria-invalid');
        aiSolveModal.hidden = true;
        userSecretInput.value = '';
        guesses = [];
        attemptCount = 0;
        gameFinished = false;
        guessInput.disabled = false;
        document.getElementById('submit-guess').disabled = false;
        guessesList.innerHTML = '';
        document.getElementById('attempt-count').textContent = '0 guesses';
        document.getElementById('empty-history').hidden = false;
        bullsElem.textContent = '0';
        cowsElem.textContent = '0';
        document.getElementById('gameStatus').textContent = 'AI is cracking the code';
        document.getElementById('gameHint').textContent = 'The computer is testing possible combinations.';
        setModeButtonActive(aiSolveBtn);
        aiSolve(userSecret, (guess, bulls, cows, tries) => {
            addGuess(guess, bulls, cows, 'computer');
            bullsElem.textContent = bulls;
            cowsElem.textContent = cows;
            if (bulls === digits) setModeButtonActive(youBtn); // Return to You mode after solve
        }, { digits, allowRepeats });
    });
}