(() => {
    const originalTitle = document.title;
    const originalFavicon = document.querySelector('link[rel="icon"]');
    const originalFaviconHref = originalFavicon?.getAttribute("href");
    const state = window.cloakConfigState || {
        resetWhileDisabled: false,
        appliedConfig: null
    };
    window.cloakConfigState = state;

    function recordCloakAchievement() {
        const recorder = window.achievements?.recordGameEvent;
        if (typeof recorder !== "function") {
            console.error("Game achievement tracker is unavailable for the invisibility cloak.");
            return;
        }
        recorder("main", "cloak-used").catch(error => {
            console.error("Could not record invisibility cloak achievement.", error);
        });
    }

    function applyCloakSettings() {
        const cloakApi = window.cloak;
        if (!cloakApi || typeof cloakApi.setCloak !== "function" || typeof cloakApi.reset !== "function") {
            console.error("Cloak could not be configured because the cloak library did not load.");
            return;
        }

        if (window.getAppSetting("cloak", "enabled") !== true) {
            if (!state.resetWhileDisabled) {
                cloakApi.reset(false);
                document.title = originalTitle;
                if (originalFavicon && originalFaviconHref !== null) {
                    originalFavicon.href = originalFaviconHref;
                }
                state.resetWhileDisabled = true;
                state.appliedConfig = null;
            }
            return;
        }

        state.resetWhileDisabled = false;
        const config = window.getAppSetting("cloak", "cloak");
        if (state.appliedConfig === config) return;

        switch (config) {
            case "managebac": {
                cloakApi.setCloak("ManageBac | My Workspace", "./assets/cloak/managebac.png");
                state.appliedConfig = config;
                recordCloakAchievement();
                break; }
            case "drive": {
                cloakApi.setCloak("Home - Google Drive", "./assets/cloak/drive.png");
                state.appliedConfig = config;
                recordCloakAchievement();
                break; }
            case "portal": {
                cloakApi.setCloak("VSA - Announcements", "./assets/cloak/vsa.png");
                state.appliedConfig = config; 
                recordCloakAchievement();
                break; }
            default: {
                console.error(`Cloak option "${config}" is not configured.`);
                break; }
        }
    }

    const domReady = document.readyState === "loading"
        ? new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }))
        : Promise.resolve();

    Promise.all([window.settingsReady, domReady]).then(applyCloakSettings).catch(error => {
        console.error("Could not initialize cloak settings.", error);
    });

    document.getElementById("settingsList").addEventListener("change", event => {
        if (event.target.matches(
            '.settings-checkbox[data-section="cloak"], .settings-select[data-section="cloak"]'
        )) {
            applyCloakSettings();
        }
    });
})();
