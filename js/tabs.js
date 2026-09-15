// TAB NAVIGATION (main menu shown by default)
(() => {
    const TAB_PANELS = {
        home: document.getElementById('mainMenuPanel'),
        achievements: document.getElementById('achievementsPanel'),
        chat: document.getElementById('chatPanel'),
        settings: document.getElementById('settingsPanel'),
        games: document.getElementById('gamesPanel')
    };
    const tabBar = document.querySelector('.tab-bar');

    function activateTab(tabName) {
        const panel = TAB_PANELS[tabName];
        if (!panel) return;

        Object.entries(TAB_PANELS).forEach(([name, el]) => {
            el.classList.toggle('is-hidden', name !== tabName);
        });

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.tab === tabName);
        });

        if (tabName === 'chat' && typeof window.initChatTab === 'function') window.initChatTab();
    }

    // Called by auth.js on sign in/out: non-home tabs slide/fade in or out.
    function setTabsGuestMode(isGuest) {
        tabBar.classList.toggle('is-guest', isGuest);
        if (isGuest) {
            const activeBtn = document.querySelector('.tab-btn.is-active');
            if (activeBtn && activeBtn.dataset.tab !== 'home') activateTab('home');
        }
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });

    // Replay the checkmark/x flipbook animation whenever a settings toggle changes.
    document.querySelectorAll('.settings-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const icon = checkbox.nextElementSibling;
            if (!icon) return;
            icon.classList.remove('is-playing');
            void icon.offsetWidth;
            icon.classList.add('is-playing');
        });
    });

    window.activateTab = activateTab;
    window.setTabsGuestMode = setTabsGuestMode;

    setTabsGuestMode(true);
    activateTab('home');
})();
