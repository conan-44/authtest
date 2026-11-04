const EMOJI_MANIFEST_URL = "./assets/emojis/index.skvwmeta";
const EMOJI_TEXTURE_ROOT = "./assets/emojis/textures/font/";
const EMOJI_STORAGE = document.getElementById("chatInput");
const EMOJI_CATEGORIES = [
  "Smileys",
  "People",
  "Animals & Nature",
  "Food & Drink",
  "Travel & Places",
  "Activities",
  "Symbols"
];
const EMOJI_CATEGORY_BY_SHEET = new Map([
  ["Smileys", ["face_", "cat_face", "monkey_face"]],
  ["People", ["hand_", "hands", "body_parts", "hair_style", "person_symbol"]],
  ["Animals & Nature", ["animal_", "plant_flower", "sky_weather"]],
  ["Food & Drink", ["food_"]],
  ["Travel & Places", ["transport_", "hotel", "time"]],
  ["Activities", ["sport", "award_medal", "event"]],
  ["Symbols", ["heart", "emotion", "geometric", "flag"]]
]);
const EMOJI_SEGMENTER = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;
const emojiCategoryTabs = document.getElementById("chatEmojiCategories");
const emojiGrid = document.getElementById("chatEmojiGrid");
const emojiSearchInput = document.getElementById("chatEmojiSearch");
const emojiPickerStatus = document.getElementById("chatEmojiPickerStatus");
let emojiByCharacter = new Map();
let activeEmojiCategory = EMOJI_CATEGORIES[0];
let supportedEmoji = new Set();
let emojiLoadError = null;
let emojiReady = false;
let lastFocusedTextInput = EMOJI_STORAGE;

function getGraphemes(value) {
  if (EMOJI_SEGMENTER) return [...EMOJI_SEGMENTER.segment(value)].map(item => item.segment);
  const codepoints = Array.from(value);
  const segments = [];
  for (let index = 0; index < codepoints.length; index += 1) {
    let segment = codepoints[index];
    if (/^[\u{1F1E6}-\u{1F1FF}]$/u.test(segment) && /^[\u{1F1E6}-\u{1F1FF}]$/u.test(codepoints[index + 1] || "")) {
      segment += codepoints[++index];
    }
    while (/^[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}\u20E3]$/u.test(codepoints[index + 1] || "")) {
      segment += codepoints[++index];
    }
    while (codepoints[index + 1] === "\u200D" && codepoints[index + 2]) {
      segment += codepoints[++index] + codepoints[++index];
      while (/^[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]$/u.test(codepoints[index + 1] || "")) {
        segment += codepoints[++index];
      }
    }
    segments.push(segment);
  }
  return segments;
}

function getCategory(sheetName) {
  for (const [category, prefixes] of EMOJI_CATEGORY_BY_SHEET) {
    if (prefixes.some(prefix => sheetName.startsWith(prefix))) return category;
  }
  return "Symbols";
}

function makeSprite(character) {
  const emoji = emojiByCharacter.get(character);
  if (!emoji) return null;
  const sprite = document.createElement("span");
  sprite.className = "chat-emoji-sprite";
  sprite.setAttribute("role", "img");
  sprite.setAttribute("aria-label", character);
  sprite.style.backgroundImage = `url("${emoji.url}")`;
  sprite.style.backgroundSize = `${emoji.sheetWidth * 3}px 24px`;
  sprite.style.backgroundPosition = `${-emoji.index * 24}px 0`;
  return sprite;
}

function renderText(container, value) {
  const text = String(value ?? "");
  container.dataset.emojiRaw = text;
  if (!emojiReady) {
    container.textContent = text;
    return;
  }
  container.replaceChildren();
  const fragments = [];
  let plainText = "";
  const flushText = () => {
    if (!plainText) return;
    fragments.push(document.createTextNode(plainText));
    plainText = "";
  };

  getGraphemes(text).forEach(segment => {
    const character = segment.replace(/[\uFE0E\uFE0F]/g, "");
    const sprite = character.length > 0 && Array.from(character).length === 1
      ? makeSprite(character)
      : null;
    if (sprite) {
      flushText();
      fragments.push(sprite);
    } else if (!EMOJI_PATTERN.test(segment)) {
      plainText += segment;
    }
  });
  flushText();
  container.append(...fragments);
}

function sanitize(value) {
  if (!emojiReady) return value;
  if (emojiLoadError) return getGraphemes(value).filter(segment => !EMOJI_PATTERN.test(segment)).join("");
  return getGraphemes(value).filter(segment => {
    if (!EMOJI_PATTERN.test(segment)) return true;
    const character = segment.replace(/[\uFE0E\uFE0F]/g, "");
    return Array.from(character).length === 1 && supportedEmoji.has(character);
  }).join("");
}

function updateInputValue(input) {
  const original = input.value;
  const cursor = input.selectionStart ?? original.length;
  const sanitizedPrefix = sanitize(original.slice(0, cursor));
  const sanitized = sanitize(original);
  if (sanitized === original) return;
  input.value = sanitized;
  const nextCursor = sanitizedPrefix.length;
  input.setSelectionRange(nextCursor, nextCursor);
}

function insertEmoji(character) {
  if (!supportedEmoji.has(character)) return;
  const activeInput = document.activeElement;
  const isEmojiInput = element => (
    (element instanceof HTMLInputElement && ["chatInput", "smileyInput"].includes(element.id))
    || (element instanceof HTMLTextAreaElement && element.classList.contains("chat-message-editor"))
  );
  const target = isEmojiInput(activeInput)
    ? activeInput
    : lastFocusedTextInput;
  if (!target) return;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  const prefix = target.value.slice(0, start);
  const suffix = target.value.slice(end);
  target.value = `${prefix}${character}${suffix}`;
  const cursor = prefix.length + character.length;
  target.focus();
  target.setSelectionRange(cursor, cursor);
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderCategoryTabs() {
  emojiCategoryTabs.replaceChildren();
  EMOJI_CATEGORIES.filter(category =>
    [...emojiByCharacter.values()].some(emoji => emoji.category === category)
  ).forEach(category => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-emoji-category";
    button.textContent = category;
    button.setAttribute("aria-pressed", String(category === activeEmojiCategory));
    button.addEventListener("click", () => {
      activeEmojiCategory = category;
      renderCategoryTabs();
      renderEmojiGrid();
    });
    emojiCategoryTabs.appendChild(button);
  });
}

function renderEmojiGrid() {
  const query = emojiSearchInput.value.trim();
  emojiGrid.replaceChildren();
  const matches = [...emojiByCharacter.entries()].filter(([character, emoji]) =>
    emoji.category === activeEmojiCategory
    && (!query || character.includes(query) || emoji.name.includes(query))
  );
  matches.forEach(([character, emoji]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-emoji-button";
    button.title = `${character} · ${emoji.name}`;
    button.setAttribute("aria-label", `Insert ${character}`);
    const sprite = makeSprite(character);
    if (sprite) {
      sprite.removeAttribute("role");
      sprite.removeAttribute("aria-label");
      button.appendChild(sprite);
    }
    button.addEventListener("click", () => insertEmoji(character));
    emojiGrid.appendChild(button);
  });
  emojiPickerStatus.textContent = matches.length
    ? `${matches.length} supported emojis`
    : "No supported emojis match this search.";
}

async function loadEmojis() {
  try {
    const response = await fetch(EMOJI_MANIFEST_URL);
    if (!response.ok) throw new Error(`Could not load emoji assets (${response.status}).`);
    const manifest = await response.json();
    if (!Array.isArray(manifest?.providers)) throw new Error("The emoji manifest has an invalid format.");

    manifest.providers.forEach(provider => {
      if (provider.type !== "bitmap" || !Array.isArray(provider.chars)) return;
      if (typeof provider.file !== "string") return;
      const sheetName = provider.file.split("/").at(-1)?.replace(/\.png$/i, "");
      if (!/^[a-z0-9_]+$/i.test(sheetName || "")) return;
      const characters = provider.chars.flatMap(row => Array.from(row));
      characters.forEach((character, index) => {
        if (emojiByCharacter.has(character)) return;
        emojiByCharacter.set(character, {
          category: getCategory(sheetName),
          index,
          name: sheetName.replaceAll("_", " "),
          sheetWidth: characters.length * 8,
          url: `${EMOJI_TEXTURE_ROOT}${sheetName}.png`
        });
      });
    });

    supportedEmoji = new Set(emojiByCharacter.keys());
    if (!supportedEmoji.size) throw new Error("The emoji manifest contains no supported emojis.");
    emojiReady = true;
    renderCategoryTabs();
    renderEmojiGrid();
    if (![...emojiByCharacter.values()].some(emoji => emoji.category === activeEmojiCategory)) {
      activeEmojiCategory = emojiByCharacter.values().next().value.category;
      renderCategoryTabs();
      renderEmojiGrid();
    }
    if (EMOJI_STORAGE) updateInputValue(EMOJI_STORAGE);
    const smileyInput = document.getElementById("smileyInput");
    if (smileyInput) updateInputValue(smileyInput);
    document.querySelectorAll(".chat-message-editor").forEach(updateInputValue);
    window.dispatchEvent(new Event("chat-emojis-ready"));
  } catch (error) {
    emojiLoadError = error;
    emojiReady = true;
    console.error("Could not load supported chat emojis.", error);
    emojiPickerStatus.textContent = "Supported emojis could not be loaded.";
    window.dispatchEvent(new Event("chat-emojis-ready"));
  }
}

emojiSearchInput.addEventListener("input", renderEmojiGrid);
EMOJI_STORAGE?.addEventListener("input", () => updateInputValue(EMOJI_STORAGE));
document.getElementById("smileyInput")?.addEventListener("input", event => updateInputValue(event.currentTarget));
document.addEventListener("focusin", event => {
  const target = event.target;
  if (
    (target instanceof HTMLInputElement && ["chatInput", "smileyInput"].includes(target.id))
    || (target instanceof HTMLTextAreaElement && target.classList.contains("chat-message-editor"))
  ) {
    lastFocusedTextInput = target;
  }
});
document.addEventListener("input", event => {
  if (event.target instanceof HTMLTextAreaElement && event.target.classList.contains("chat-message-editor")) {
    updateInputValue(event.target);
  }
});
window.addEventListener("chat-emojis-ready", () => {
  document.querySelectorAll(".chat-reply-preview, #chatReplyText, .notification-text, .notification-title, .notification-subtitle")
    .forEach(element => renderText(element, element.dataset.emojiRaw ?? element.textContent));
  document.querySelectorAll(".smiley-message-text").forEach(message => {
    renderText(message, message.dataset.raw || "");
  });
});
window.ChatEmoji = {
  renderText,
  sanitize,
  ready: loadEmojis()
};
