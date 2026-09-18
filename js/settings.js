const settingsConfigFile = "./data/settings/settings.skvwcfgml";
const musicManifestFile = "./assets/audio/music/index.skvwmeta";

(() => {
    const settingsList = document.getElementById("settingsList");

    window.getAppSetting = function getAppSetting(section, key, fallback = false) {
        const checkbox = settingsList?.querySelector(
            `.settings-checkbox[data-section="${CSS.escape(section)}"][data-setting="${CSS.escape(key)}"]`
        );
        return checkbox ? checkbox.checked : fallback;
    };

    function settingId(section, key) {
        return `setting-${section}-${key}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }

    function formatSettingName(key) {
        return key.replace(/\b\w/g, character => character.toUpperCase());
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

    function createMusicControls(heading) {
        const controls = document.createElement("span");
        controls.className = "music-controls";
        controls.innerHTML = `
            <button type="button" class="music-cycle-btn" data-direction="previous" aria-label="Previous song">&lt;</button>
            <span class="music-track-name">No music loaded</span>
            <button type="button" class="music-cycle-btn" data-direction="next" aria-label="Next song">&gt;</button>
        `;
        heading.appendChild(controls);
        return controls;
    }

    async function bindMusicControls(controls) {
        let tracks = [];
        let currentTrack = -1;
        const player = new Audio();
        const trackName = controls.querySelector(".music-track-name");
        const buttons = controls.querySelectorAll(".music-cycle-btn");

        try {
            const response = await fetch(musicManifestFile, { cache: "no-store" });
            if (response.ok) tracks = await response.json();
        } catch (error) {
            tracks = [];
        }

        tracks = tracks.filter(track => typeof track === "string" && track.trim());
        const updateMusicAvailability = () => {
            const enabled = window.getAppSetting ? window.getAppSetting("audio", "music", true) : true;
            buttons.forEach(button => {
                button.disabled = !enabled;
                button.title = enabled ? "Cycle music" : "Music is disabled";
            });
        };
        updateMusicAvailability();
        buttons.forEach(button => {
            button.addEventListener("click", () => {
                if (!window.getAppSetting("audio", "music", true)) {
                    if (typeof showPopup === "function") showPopup("Music is disabled in settings.", "info");
                    return;
                }
                if (!tracks.length) {
                    if (typeof showPopup === "function") showPopup("No music tracks are available yet.", "info");
                    return;
                }
                const direction = button.dataset.direction === "previous" ? -1 : 1;
                currentTrack = (currentTrack + direction + tracks.length) % tracks.length;
                const source = tracks[currentTrack];
                player.src = source.startsWith("./") ? source : `./assets/audio/music/${source}`;
                player.play().then(() => {
                    trackName.textContent = source.split("/").pop();
                    if (typeof showPopup === "function") showPopup(`Music playing: ${trackName.textContent}`, "info");
                }).catch(() => {
                    trackName.textContent = source.split("/").pop();
                });
            });
        });
        settingsList.querySelector('[data-section="audio"][data-setting="music"]')?.addEventListener("change", updateMusicAvailability);
    }

    function renderSettings(settings) {
        settingsList.innerHTML = "";
        Object.entries(settings).forEach(([section, values]) => {
            const heading = document.createElement("h2");
            heading.className = "settings-section-heading";
            heading.textContent = section.replace(/\b\w/g, character => character.toUpperCase());
            settingsList.appendChild(heading);
            const musicControls = section.toLowerCase() === "audio" ? createMusicControls(heading) : null;
            if (musicControls) bindMusicControls(musicControls);

            Object.entries(values).forEach(([key, enabled]) => {
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
                settingsList.appendChild(label);
            });
        });
        bindSettingAnimations();
        settingsList.querySelectorAll(".settings-checkbox").forEach(checkbox => {
            checkbox.addEventListener("change", () => {
                if (checkbox.dataset.section === "chat" && checkbox.dataset.setting === "censoring") {
                    window.dispatchEvent(new Event("censoring-setting-changed"));
                }
            });
        });
    }

    async function loadSettings() {
        try {
            const response = await fetch(settingsConfigFile, { cache: "no-store" });
            if (!response.ok) throw new Error(`Failed to read ${settingsConfigFile}`);
            renderSettings(window.AchievementLib.parseSettingsConfig(await response.text()));
        } catch (error) {
            console.error("Could not load settings.", error);
            settingsList.textContent = "Could not load settings.";
        }
    }

    loadSettings();
})();