window.AchievementLib = window.AchievementLib || {};

// Strips // and /* */ comments that live outside of string literals, then parses as JSON.
window.AchievementLib.parseJsonWithComments = function parseJsonWithComments(text) {
    let cleanText = "";
    let inString = false;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        const nextCharacter = text[index + 1];
        if (inLineComment) {
            if (character === "\n" || character === "\r") {
                inLineComment = false;
                cleanText += character;
            }
            continue;
        }
        if (inBlockComment) {
            if (character === "*" && nextCharacter === "/") {
                inBlockComment = false;
                index += 1;
            } else if (character === "\n" || character === "\r") {
                cleanText += character;
            }
            continue;
        }
        if (inString) {
            cleanText += character;
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') {
            inString = true;
            cleanText += character;
        } else if (character === "/" && nextCharacter === "/") {
            inLineComment = true;
            index += 1;
        } else if (character === "/" && nextCharacter === "*") {
            inBlockComment = true;
            index += 1;
        } else {
            cleanText += character;
        }
    }
    return JSON.parse(cleanText);
};
