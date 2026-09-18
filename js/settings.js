const settingsConfigFile = "./data/settings/settings.skvwcfgml";

(() => {
    const settingsList = document.getElementById("settingsList");

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

    function renderSettings(settings) {
        settingsList.innerHTML = "";
        Object.entries(settings).forEach(([section, values]) => {
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