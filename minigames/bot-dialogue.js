export async function loadBotDialogue(url, fallback = {}) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load bot dialogue: ${response.status}`);

    const dialogue = { profiles: {} };
    let category = null;
    let profile = null;
    for (const rawLine of (await response.text()).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            const profileMatch = sectionMatch[1].match(/^bot\s+(.+)$/i);
            profile = profileMatch
                ? profileMatch[1].trim().toLowerCase().replace(/\s+/g, "-")
                : sectionMatch[1].trim().toLowerCase().replace(/\s+/g, "-");
            category = null;
            dialogue.profiles[profile] ??= {};
            continue;
        }

        const categoryMatch = line.match(/^([a-z][a-z0-9_-]*):\s*$/i);
        if (categoryMatch) {
            category = categoryMatch[1].toLowerCase();
            const target = profile ? dialogue.profiles[profile] : dialogue;
            target[category] = [];
            continue;
        }

        const quoteMatch = line.match(/^-\s*(["'])(.*)\1\s*$/);
        if (category && quoteMatch && quoteMatch[2].trim()) {
            const target = profile ? dialogue.profiles[profile] : dialogue;
            target[category].push(quoteMatch[2].trim());
        }
    }

    for (const profileDialogue of Object.values(dialogue.profiles)) {
        for (const [key, lines] of Object.entries(profileDialogue)) {
            if (!dialogue[key]?.length) dialogue[key] = lines;
        }
    }
    for (const [key, lines] of Object.entries(fallback)) {
        if (!dialogue[key]?.length) dialogue[key] = lines;
    }
    return dialogue;
}

export function chooseBotLine(dialogue, category, random = Math.random, profile = null) {
    const profileLines = profile ? dialogue?.profiles?.[profile]?.[category] : null;
    const lines = profileLines?.length ? profileLines : dialogue?.[category];
    return Array.isArray(lines) && lines.length
        ? lines[Math.floor(random() * lines.length)]
        : "";
}
