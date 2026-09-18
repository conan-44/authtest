const settingsConfigFile = "./data/settings/settings.skvwcfgml";
const musicManifestFile = "./assets/audio/music/index.skvwmeta";

(() => {
    const settingsList = document.getElementById("settingsList");
    let musicController = null;
    let musicAutoplayRequested = false;

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
            if (typeof _supabase !== "undefined") {
                const { data: { session } } = await _supabase.auth.getSession();
                if (session && typeof window.playMusicOnLogin === "function") window.playMusicOnLogin();
            }
        } catch (error) {
            console.error("Could not load settings.", error);
            settingsList.textContent = "Could not load settings.";
        }
    }

    loadSettings();
})();