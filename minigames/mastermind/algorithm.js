export function aiSolve(secret, onGuess, options = {}) {
    const digits = options.digits ?? 4;
    const allowRepeats = options.allowRepeats ?? false;

    let possible = [];
    const max = 10 ** digits;
    for (let i = 0; i < max; i++) {
        let s = i.toString().padStart(digits, '0');
        if (allowRepeats || new Set(s).size === digits) possible.push(s);
    }
    let tries = 0;

    function getBullsAndCows(secret, guess) {
        let bulls = 0, cows = 0;
        for (let i = 0; i < secret.length; i++) {
            if (guess[i] === secret[i]) bulls++;
            else if (secret.includes(guess[i])) cows++;
        }
        return { bulls, cows };
    }

    function filterPossible(possible, guess, bulls, cows) {
        return possible.filter(code => {
            const res = getBullsAndCows(code, guess);
            return res.bulls === bulls && res.cows === cows;
        });
    }

    function step() {
        if (possible.length === 0) return;
        const guess = possible[0];
        const { bulls, cows } = getBullsAndCows(secret, guess);
        tries++;
        onGuess(guess, bulls, cows, tries);
        if (bulls === digits) {
            return;
        }
        possible = filterPossible(possible, guess, bulls, cows);
        setTimeout(step, 300);
    }
    step();
}
