const settingsConfigFile = "./data/settings/settings.skvwcfgml";
const musicManifestFile = "./assets/audio/music/index.skvwmeta";
const APP_THEME_STORAGE_KEY = "skvwaffle.theme.v1";
const DEFAULT_APP_THEME = { accent: "#2a4d67", secondary: "#8a5a00" };
const APP_THEME_PRESETS = [
    { name: "Classic", accent: DEFAULT_APP_THEME.accent, secondary: DEFAULT_APP_THEME.secondary },
    { name: "Cheese", accent: "#ff7b29", secondary: "#f5b904" },
    { name: "Gameboy", accent: "#0f380f", secondary: "#8bac0f" },
    { name: "Forest", accent: "#59433d", secondary: "#26806f" },
    { name: "Sculking", accent: "#063b5b", secondary: "#c8c4bf" },
    { name: "Sunset", accent: "#ff5e5e", secondary: "#ffb86c" },
    { name: "Ocean", accent: "#1ca9c9", secondary: "#144e75" },
    { name: "Midnight", accent: "#0d1b2a", secondary: "#1b263b" }
];

(() => {
    const settingsList = document.getElementById("settingsList");
    let musicController = null;
    let musicAutoplayRequested = false;
    let appTheme = loadAppTheme();
    applyAppTheme();

    window.getAppSetting = function getAppSetting(section, key, fallback = false) {
        const control = settingsList?.querySelector(
            `.settings-checkbox[data-section="${CSS.escape(section)}"][data-setting="${CSS.escape(key)}"]`
            + `, .settings-select[data-section="${CSS.escape(section)}"][data-setting="${CSS.escape(key)}"]`
            + `, .settings-slider[data-section="${CSS.escape(section)}"][data-setting="${CSS.escape(key)}"]`
        );
        if (!control) return fallback;
        if (!(control instanceof HTMLInputElement)) return control.value;
        if (control.type === "checkbox") return control.checked;
        if (control.type === "range") return control.valueAsNumber;
        return fallback;
    };

    function settingId(section, key) {
        return `setting-${section}-${key}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }

    function formatSettingName(key) {
        return key.replace(/\b\w/g, character => character.toUpperCase());
    }

    function normalizeHexColor(value) {
        return typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
    }

    function loadAppTheme() {
        try {
            const saved = JSON.parse(localStorage.getItem(APP_THEME_STORAGE_KEY) || "null");
            const accent = normalizeHexColor(saved?.accent);
            const secondary = normalizeHexColor(saved?.secondary);
            if (accent && secondary) return { accent, secondary };
        } catch (error) {
            console.error("Could not load saved appearance settings.", error);
            if (typeof showPopup === "function") showPopup("Could not load saved colors. Using the default palette.", "warning");
        }
        return { ...DEFAULT_APP_THEME };
    }

    function mixColors(baseHex, tintHex, strength) {
        const base = baseHex.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16));
        const tint = tintHex.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16));
        return `#${base.map((channel, index) => Math.round(channel * (1 - strength) + tint[index] * strength)
            .toString(16).padStart(2, "0")).join("")}`;
    }

    function colorWithAlpha(hex, alpha) {
        const [red, green, blue] = hex.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16));
        return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }

    function applyAppTheme() {
        const root = document.documentElement;
        const isDefault = appTheme.accent === DEFAULT_APP_THEME.accent
            && appTheme.secondary === DEFAULT_APP_THEME.secondary;
        root.dataset.colorTheme = isDefault ? "classic" : "custom";
        root.style.setProperty("--theme-accent", appTheme.accent);
        root.style.setProperty("--theme-secondary", appTheme.secondary);

        if (!isDefault) {
            const accent = appTheme.accent;
            const secondary = appTheme.secondary;
            const variables = {
                "--color-heading": accent,
                "--color-panel-surface": mixColors("#dde2e7", accent, 0.08),
                "--color-panel-header-surface": mixColors("#dfe4ea", accent, 0.09),
                "--color-panel-body-surface": mixColors("#e9ebed", accent, 0.06),
                "--color-card-surface": mixColors("#cfcfcf", secondary, 0.08),
                "--color-control-surface": mixColors("#eef2f4", accent, 0.04),
                "--color-panel": mixColors("#eeeeee", accent, 0.08),
                "--color-panel-header": mixColors("#eeeeee", accent, 0.09),
                "--color-card": mixColors("#dddddd", secondary, 0.08),
                "--color-control": mixColors("#eeeeee", accent, 0.04),
                "--color-rare": secondary,
                "--color-points": secondary,
                "--color-points-border": colorWithAlpha(secondary, 0.35),
                "--color-rarity-rare-border": colorWithAlpha(secondary, 0.75),
                "--color-score-surface": mixColors("#eef2f4", accent, 0.04),
                "--color-shadow": colorWithAlpha(accent, 0.18),
                "--shadow-heading": colorWithAlpha(accent, 0.18)
            };
            Object.entries(variables).forEach(([name, value]) => root.style.setProperty(name, value));
        } else {
            [
                "--color-heading", "--color-panel-surface", "--color-panel-header-surface",
                "--color-panel-body-surface", "--color-card-surface", "--color-control-surface",
                "--color-panel", "--color-panel-header", "--color-card", "--color-control",
                "--color-rare", "--color-points", "--color-points-border",
                "--color-rarity-rare-border", "--color-score-surface", "--color-shadow",
                "--shadow-heading"
            ].forEach(name => root.style.removeProperty(name));
        }
    }

    function saveAppTheme() {
        applyAppTheme();
        try {
            localStorage.setItem(APP_THEME_STORAGE_KEY, JSON.stringify(appTheme));
        } catch (error) {
            console.error("Could not save appearance settings.", error);
            if (typeof showPopup === "function") showPopup("Your color changes could not be saved on this device.", "error");
        }
    }

    function findMatchingThemePreset() {
        return APP_THEME_PRESETS.find(preset => (
            preset.accent === appTheme.accent && preset.secondary === appTheme.secondary
        ))?.name || null;
    }

    function updateThemePresetSelection(presetButtons) {
        const selectedPreset = findMatchingThemePreset();
        presetButtons.forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.preset === selectedPreset));
        });
    }

    function renderAppearanceSettings() {
        const heading = document.createElement("h2");
        heading.className = "settings-section-heading";
        heading.textContent = "Appearance";
        settingsList.appendChild(heading);

        const section = document.createElement("section");
        section.className = "settings-appearance";
        section.setAttribute("aria-label", "Appearance colors");

        const description = document.createElement("p");
        description.className = "settings-appearance-description";
        description.textContent = "choose your colors";

        const colorControls = document.createElement("div");
        colorControls.className = "settings-color-controls";
        const inputs = {};
        [
            ["accent", "Accent color"],
            ["secondary", "Secondary color"]
        ].forEach(([key, labelText]) => {
            const label = document.createElement("label");
            label.className = "settings-color-label";
            label.htmlFor = `app-theme-${key}`;
            label.textContent = labelText;

            const input = document.createElement("input");
            input.type = "color";
            input.id = `app-theme-${key}`;
            input.value = appTheme[key];
            input.setAttribute("aria-label", labelText);
            inputs[key] = input;
            label.appendChild(input);
            colorControls.appendChild(label);
        });

        const presetHeading = document.createElement("h3");
        presetHeading.className = "settings-preset-heading";
        presetHeading.textContent = "Presets";
        const presets = document.createElement("div");
        presets.className = "settings-color-presets";
        const presetButtons = APP_THEME_PRESETS.map(preset => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "settings-color-preset";
            button.dataset.preset = preset.name;
            button.setAttribute("aria-pressed", "false");
            button.style.setProperty("--preset-accent", preset.accent);
            button.style.setProperty("--preset-secondary", preset.secondary);
            button.textContent = preset.name;
            button.addEventListener("click", () => {
                appTheme = { accent: preset.accent, secondary: preset.secondary };
                inputs.accent.value = appTheme.accent;
                inputs.secondary.value = appTheme.secondary;
                saveAppTheme();
                updateThemePresetSelection(presetButtons);
            });
            presets.appendChild(button);
            return button;
        });

        Object.entries(inputs).forEach(([key, input]) => {
            input.addEventListener("input", () => {
                appTheme = { ...appTheme, [key]: input.value.toLowerCase() };
                saveAppTheme();
                updateThemePresetSelection(presetButtons);
            });
        });
        section.append(description, colorControls, presetHeading, presets);
        settingsList.appendChild(section);
        updateThemePresetSelection(presetButtons);
    }

    function createDropdownSetting(section, key, options) {
        const label = document.createElement("label");
        label.className = "settings-select-label";
        label.htmlFor = settingId(section, key);

        const text = document.createElement("span");
        text.className = "settings-toggle-label";
        text.textContent = `-  ${formatSettingName(key)}`;

        const select = document.createElement("select");
        select.className = "settings-select";
        select.id = settingId(section, key);
        select.dataset.section = section;
        select.dataset.setting = key;

        options.forEach(optionName => {
            const option = document.createElement("option");
            option.value = optionName;
            option.textContent = formatSettingName(optionName);
            select.appendChild(option);
        });

        label.append(text, select);
        return label;
    }

    function createSliderSetting(section, key, slider) {
        const label = document.createElement("label");
        label.className = "settings-slider-setting";

        const text = document.createElement("span");
        text.className = "settings-toggle-label";
        text.textContent = `-  ${formatSettingName(key)}`;

        const control = document.createElement("div");
        control.className = "settings-slider-control";

        const track = document.createElement("div");
        track.className = "settings-slider-track";

        const input = document.createElement("input");
        input.type = "range";
        input.className = "settings-slider";
        input.id = settingId(section, key);
        input.min = String(slider.min);
        input.max = String(slider.max);
        input.step = String(slider.step);
        input.dataset.section = section;
        input.dataset.setting = key;

        const value = document.createElement("output");
        value.className = "settings-slider-value";
        value.htmlFor = input.id;
        value.setAttribute("aria-live", "polite");

        const stops = document.createElement("span");
        stops.className = "settings-slider-stops";
        stops.setAttribute("aria-hidden", "true");

        slider.stops.forEach(stop => {
            const marker = document.createElement("span");
            marker.className = "settings-slider-stop";
            marker.textContent = formatSettingName(stop.name);
            marker.style.left = `${((stop.value - slider.min) / (slider.max - slider.min)) * 100}%`;
            stops.appendChild(marker);
        });

        const snapDistance = (slider.max - slider.min) * 0.05;
        let skipMagneticSnap = false;
        const nearestStop = currentValue => slider.stops.reduce((nearest, stop) => (
            Math.abs(stop.value - currentValue) < Math.abs(nearest.value - currentValue) ? stop : nearest
        ), slider.stops[0]);
        const updateValue = () => {
            const steppedValue = slider.min
                + Math.round((input.valueAsNumber - slider.min) / slider.step) * slider.step;
            input.value = String(Math.max(slider.min, Math.min(slider.max, steppedValue)));
            const currentValue = input.valueAsNumber;
            const stop = nearestStop(currentValue);
            if (!skipMagneticSnap && Math.abs(stop.value - currentValue) <= snapDistance) {
                input.value = String(stop.value);
                value.value = formatSettingName(stop.name);
                value.textContent = formatSettingName(stop.name);
                input.setAttribute("aria-valuetext", formatSettingName(stop.name));
            } else {
                const formattedValue = currentValue.toLocaleString();
                value.value = formattedValue;
                value.textContent = formattedValue;
                input.setAttribute("aria-valuetext", formattedValue);
            }
        };

        input.value = String(slider.value);
        input.addEventListener("input", updateValue);
        input.addEventListener("keydown", event => {
            const arrowStep = slider.step;
            const pageStep = slider.step * 10;
            let nextValue;
            if (event.key === "ArrowRight" || event.key === "ArrowUp") nextValue = input.valueAsNumber + arrowStep;
            else if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextValue = input.valueAsNumber - arrowStep;
            else if (event.key === "PageUp") nextValue = input.valueAsNumber + pageStep;
            else if (event.key === "PageDown") nextValue = input.valueAsNumber - pageStep;
            else if (event.key === "Home") nextValue = slider.min;
            else if (event.key === "End") nextValue = slider.max;
            else return;
            event.preventDefault();
            input.value = String(Math.max(slider.min, Math.min(slider.max, nextValue)));
            skipMagneticSnap = true;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            skipMagneticSnap = false;
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        input.addEventListener("change", () => {
            window.dispatchEvent(new CustomEvent("app-setting-changed", {
                detail: { section, key, value: input.valueAsNumber }
            }));
        });
        updateValue();

        track.append(input, stops);
        control.append(track, value);
        label.append(text, control);
        return label;
    }

    function bindSettingAnimations() {
        settingsList.querySelectorAll(".settings-checkbox").forEach(checkbox => {
            checkbox.addEventListener("change", () => {
                const icon = checkbox.nextElementSibling;
                if (!icon) return;
                icon.classList.remove("is-playing");
                void icon.offsetWidth;
                icon.classList.add("is-playing");
            });
        });
    }

    function createMusicControls() {
        const controls = document.createElement("span");
        controls.className = "music-controls";
        controls.innerHTML = `
            <button type="button" class="music-cycle-btn" data-direction="previous" aria-label="Previous song">&lt;</button>
            <span class="music-track-name">No music loaded</span>
            <button type="button" class="music-cycle-btn" data-direction="next" aria-label="Next song">&gt;</button>
        `;
        return controls;
    }

    function createMusicVolumeControl() {
        const volume = document.createElement("label");
        volume.className = "music-volume";
        volume.title = "Music volume";
        volume.innerHTML = `
            <span class="music-volume-label">Volume</span>
            <input class="music-volume-input" type="range" min="0" max="1" step="0.01" value="0.3" aria-label="Music volume">
        `;
        return volume;
    }

    function parseMusicTrack(track) {
        const [file, ...creditParts] = track.split("+");
        return {
            source: file.trim(),
            credit: creditParts.join("+").trim()
        };
    }

    function getTrackDisplayName(source) {
        return source.split("/").pop().split(".")[0];
    }

    function updateMusicCredit(creditElement, track) {
        creditElement.textContent = track.credit ? `${track.credit}` : "";
        creditElement.hidden = !track.credit;
    }

    async function bindMusicControls(controls, creditElement, volumeInput) {
        let tracks = [];
        let currentTrack = -1;
        const player = new Audio();
        musicController = player;
        const trackName = controls.querySelector(".music-track-name");
        const buttons = controls.querySelectorAll(".music-cycle-btn");

        try {
            const response = await fetch(musicManifestFile, { cache: "no-store" });
            if (response.ok) tracks = await response.json();
        } catch (error) {
            tracks = [];
        }

        tracks = tracks
            .filter(track => typeof track === "string" && track.trim())
            .map(parseMusicTrack)
            .filter(track => track.source);
        creditElement.textContent = "";
        creditElement.hidden = true;
        player.volume = Number(volumeInput.value);
        volumeInput.addEventListener("input", () => {
            player.volume = Number(volumeInput.value);
        });
        const updateMusicAvailability = () => {
            const enabled = window.getAppSetting ? window.getAppSetting("audio", "music", true) : true;
            if (!enabled) player.pause();
            buttons.forEach(button => {
                button.disabled = !enabled;
                button.title = enabled ? "Cycle music" : "Music is disabled";
            });
        };
        updateMusicAvailability();
        window.playMusicOnLogin = function playMusicOnLogin() {
            musicAutoplayRequested = true;
            if (!window.getAppSetting("audio", "music", true) || !tracks.length) return;
            if (currentTrack < 0) currentTrack = 0;
            const track = tracks[currentTrack];
            player.src = track.source.startsWith("./") ? track.source : `./assets/audio/music/${track.source}`;
            player.play().then(() => {
                trackName.textContent = getTrackDisplayName(track.source);
                updateMusicCredit(creditElement, track);
            }).catch(() => {});
        };
        const retryAutoplay = () => {
            if (musicAutoplayRequested && window.getAppSetting("audio", "music", true) && player.paused) {
                window.playMusicOnLogin();
            }
        };
        document.addEventListener("pointerdown", retryAutoplay);
        document.addEventListener("keydown", retryAutoplay);
        buttons.forEach(button => {
            button.addEventListener("click", () => {
                if (!window.getAppSetting("audio", "music", true)) {
                    if (typeof showPopup === "function") showPopup("Music is disabled in settings.", "error");
                    return;
                }
                if (!tracks.length) {
                    if (typeof showPopup === "function") showPopup("No music tracks are available yet.", "error");
                    return;
                }
                const direction = button.dataset.direction === "previous" ? -1 : 1;
                currentTrack = (currentTrack + direction + tracks.length) % tracks.length;
                const track = tracks[currentTrack];
                player.src = track.source.startsWith("./") ? track.source : `./assets/audio/music/${track.source}`;
                player.play().then(() => {
                    trackName.textContent = getTrackDisplayName(track.source);
                    updateMusicCredit(creditElement, track);
                    if (typeof showPopup === "function") showPopup(`Music playing: ${trackName.textContent}`, "music");
                }).catch(() => {
                    trackName.textContent = getTrackDisplayName(track.source);
                });
            });
        });
        settingsList.querySelector('[data-section="audio"][data-setting="music"]')?.addEventListener("change", () => {
            updateMusicAvailability();
            if (window.getAppSetting("audio", "music", true) && musicAutoplayRequested) window.playMusicOnLogin();
        });
    }

    function renderSettings(settings) {
        settingsList.innerHTML = "";
        renderAppearanceSettings();
        Object.entries(settings).forEach(([section, values]) => {
            const heading = document.createElement("h2");
            heading.className = "settings-section-heading";
            heading.textContent = section.replace(/\b\w/g, character => character.toUpperCase());
            settingsList.appendChild(heading);
            const isAudioSection = section.toLowerCase() === "audio";
            const audioLayout = isAudioSection ? document.createElement("div") : null;
            const audioTopRow = isAudioSection ? document.createElement("div") : null;
            const musicCredit = isAudioSection ? document.createElement("p") : null;
            const musicVolume = isAudioSection ? createMusicVolumeControl() : null;
            const musicMeta = isAudioSection ? document.createElement("div") : null;
            if (audioLayout) {
                audioLayout.className = "settings-audio-layout";
                audioTopRow.className = "settings-audio-top-row";
                musicCredit.className = "music-credit";
                musicMeta.className = "music-meta";
                musicMeta.append(musicCredit, musicVolume);
                audioTopRow.append(musicMeta);
                audioLayout.append(audioTopRow);
                settingsList.appendChild(audioLayout);
            }

            Object.entries(values).forEach(([key, enabled]) => {
                if (enabled && typeof enabled === "object" && enabled.type === "slider"
                    && Array.isArray(enabled.stops) && enabled.stops.length) {
                    settingsList.appendChild(createSliderSetting(section, key, enabled));
                    return;
                }
                if (enabled && typeof enabled === "object" && enabled.type === "dropdown" && Array.isArray(enabled.options)) {
                    settingsList.appendChild(createDropdownSetting(section, key, enabled.options));
                    return;
                }
                const label = document.createElement("label");
                label.className = "settings-toggle";

                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.className = "settings-checkbox";
                checkbox.id = settingId(section, key);
                checkbox.checked = enabled;
                checkbox.dataset.section = section;
                checkbox.dataset.setting = key;

                const icon = document.createElement("span");
                icon.className = "settings-toggle-icon";
                icon.setAttribute("aria-hidden", "true");

                const text = document.createElement("span");
                text.className = "settings-toggle-label";
                text.textContent = `-  ${formatSettingName(key)}`;

                label.append(checkbox, icon, text);
                if (isAudioSection && key.toLowerCase() === "sound effects") {
                    audioTopRow.prepend(label);
                } else if (isAudioSection && key.toLowerCase() === "music") {
                    const musicControls = createMusicControls();
                    const audioRow = document.createElement("div");
                    audioRow.className = "settings-audio-row";
                    audioRow.append(label, musicControls);
                    audioLayout.append(audioRow);
                    bindMusicControls(musicControls, musicCredit, musicVolume.querySelector(".music-volume-input"));
                } else {
                    settingsList.appendChild(label);
                }
            });
        });
        bindSettingAnimations();
        settingsList.querySelectorAll(".settings-checkbox").forEach(checkbox => {
            checkbox.addEventListener("change", () => {
                window.dispatchEvent(new CustomEvent("app-setting-changed", {
                    detail: {
                        section: checkbox.dataset.section,
                        key: checkbox.dataset.setting,
                        value: checkbox.checked
                    }
                }));
                if (checkbox.dataset.section === "chat" && checkbox.dataset.setting === "censoring") {
                    window.dispatchEvent(new Event("censoring-setting-changed"));
                }
                if (checkbox.dataset.section === "chat" && checkbox.dataset.setting === "hide gifs") {
                    window.dispatchEvent(new Event("chat-gifs-setting-changed"));
                }
            });
        });
    }

    async function loadSettings() {
        try {
            const response = await fetch(settingsConfigFile, { cache: "no-store" });
            if (!response.ok) throw new Error(`Failed to read ${settingsConfigFile}`);
            renderSettings(window.AchievementLib.parseSettingsConfig(await response.text()));
            if (typeof _supabase !== "undefined") {
                const { data: { session } } = await _supabase.auth.getSession();
                if (session && typeof window.playMusicOnLogin === "function") window.playMusicOnLogin();
            }
        } catch (error) {
            console.error("Could not load settings.", error);
            settingsList.textContent = "Could not load settings.";
        }
    }

    window.settingsReady = loadSettings();
})();