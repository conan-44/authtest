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

function addGuess(guess, bulls, cows) {
    const li = document.createElement('li');
    li.className = 'guess-row';

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
    feedbackText.innerHTML =
        `<img src="${bullsIconSRC}" alt="Bulls" class="icon"> ${bulls} <img src="${cowsIconSRC}" alt="Cows" class="icon"> ${cows}`;
    feedbackRow.append(feedbackPegs, feedbackText);

    li.append(pegRow, feedbackRow);
    guessesList.appendChild(li);
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
}
// Universal elements
let secret = num.getRandomNumber(4, 'string');
let guesses = [];
let currentDifficulty = 'medium';
const guessForm = document.getElementById('guess-form');
const guessInput = document.getElementById('guess-input');
const guessesList = document.getElementById('guesses-list');
const revealSecretBtn = document.getElementById('reveal-secret');
const bullsElem = document.getElementById('bulls');
const cowsElem = document.getElementById('cows');
const bullsIconSRC = "../assets/sprites/bull.png";
const cowsIconSRC = "../assets/sprites/cow.png";
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
}

function isValidCode(code) {
    if (!new RegExp(`^\\d{${digits}}$`).test(code)) return false;
    if (!allowRepeats && new Set(code).size !== digits) return false;
    return true;
}
// Notify the parent achievements panel (same-origin embed) that the code was cracked.
function unlockCodebreakerAchievement() {
    try {
        const parentAchievements = window.parent !== window ? window.parent.achievements : null;
        if (parentAchievements && typeof parentAchievements.unlock === 'function') {
            parentAchievements.unlock('main:codebreaker');
        }
    } catch (error) {
        console.warn('Could not unlock achievement (not embedded or cross-origin):', error);
    }
}
function resetGameState() {
    guesses = [];
    guessesList.innerHTML = '';
    bullsElem.textContent = '0';
    cowsElem.textContent = '0';
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
        const guess = guessInput.value;
        if (!isValidCode(guess)) {
            guessInput.style.border = '2px solid red';
            return;
        }
        guessInput.style.border = '';
        const { bulls, cows } = getBullsAndCows(secret, guess);
        bullsElem.textContent = bulls;
        cowsElem.textContent = cows;
        addGuess(guess, bulls, cows);
        guesses.push({ guess, bulls, cows });
        guessInput.value = '';
        if (bulls === digits) unlockCodebreakerAchievement();
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
        aiSolveModal.style.display = 'flex';
    });
}
if (closeAiSolveBtn && aiSolveModal) {
    closeAiSolveBtn.addEventListener('click', () => {
        aiSolveModal.style.display = 'none';
        userSecretInput.value = '';
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
            userSecretInput.style.border = '2px solid red';
            return;
        }
        userSecretInput.style.border = '';
        aiSolveModal.style.display = 'none';
        userSecretInput.value = '';
        guessesList.innerHTML = '';
        bullsElem.textContent = '0';
        cowsElem.textContent = '0';
        setModeButtonActive(aiSolveBtn);
        aiSolve(userSecret, (guess, bulls, cows, tries) => {
            addGuess(guess, bulls, cows);
            bullsElem.textContent = bulls;
            cowsElem.textContent = cows;
            if (bulls === digits) setModeButtonActive(youBtn); // Return to You mode after solve
        }, { digits, allowRepeats });
    });
}