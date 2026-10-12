// TAB NAVIGATION (main menu shown by default)
(() => {
    const TAB_PANELS = {
        home: document.getElementById('mainMenuPanel'),
        achievements: document.getElementById('achievementsPanel'),
        chat: document.getElementById('chatPanel'),
        settings: document.getElementById('settingsPanel'),
        games: document.getElementById('gamesPanel'),
        blog: document.getElementById('blogPanel')
    };
    const milestonesPanel = document.getElementById('milestonesPanel');
    const chatOptionsPanel = document.getElementById('chatOptionsPanel');
    const tabBar = document.querySelector('.tab-bar');

    function activateTab(tabName) {
        const panel = TAB_PANELS[tabName];
        if (!panel) return;

        Object.entries(TAB_PANELS).forEach(([name, el]) => {
            if (el) el.classList.toggle('is-hidden', name !== tabName);
        });

        milestonesPanel?.classList.toggle('is-hidden', tabName === 'chat');
        chatOptionsPanel?.classList.toggle('is-hidden', tabName !== 'chat');

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.tab === tabName);
        });

        if (tabName === 'chat' && typeof window.initChatTab === 'function') window.initChatTab();
        if (tabName === 'blog' && typeof window.initBlogTab === 'function') window.initBlogTab();
        if (tabName === 'experimental') {
            showPopup("Redirecting to Experiments...", "info");
            window.location.href = "https://skybase-cookie.duckdns.org";
        }
    }

    // Called by auth.js on sign in/out: non-home tabs slide/fade in or out.
    function setTabsGuestMode(isGuest) {
        tabBar.classList.toggle('is-guest', isGuest);
        if (isGuest) {
            const activeBtn = document.querySelector('.tab-btn.is-active');
            if (activeBtn && !['home', 'blog'].includes(activeBtn.dataset.tab)) activateTab('home');
        }
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });

    window.activateTab = activateTab;
    window.setTabsGuestMode = setTabsGuestMode;

    setTabsGuestMode(true);
    activateTab('home');
})();
