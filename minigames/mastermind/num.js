export function getRandomNumber(digits, return_type, allowRepeats = false) {
    if (!allowRepeats && digits > 10) {
        throw new Error('Cannot generate a unique-digit number longer than 10 digits.');
    }

    let arr = [];
    let used = new Set();
    while (arr.length < digits) {
        let d = Math.floor(Math.random() * 10);
        if (allowRepeats || !used.has(d)) {
            arr.push(d);
            used.add(d);
        }
    }
    let NUMBER = arr.join('');
    if (return_type === 'string') return NUMBER;
    return parseInt(NUMBER, 10);
}
export function getDigits(number) {
    if (typeof number === 'number') number = number.toString();
    return number.split('');
}