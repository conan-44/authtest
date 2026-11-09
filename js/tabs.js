// TAB NAVIGATION (main menu shown by default)
(() => {
    const TAB_PANELS = {
        home: document.getElementById('mainMenuPanel'),
        achievements: document.getElementById('achievementsPanel'),
        chat: document.getElementById('chatPanel'),
        settings: document.getElementById('settingsPanel'),
        games: document.getElementById('gamesPanel'),
        blog: document.getElementById('blogPanel'),
        gacha: document.getElementById('gachaPanel')
    };
    const milestonesPanel = document.getElementById('milestonesPanel');
    const gachaPacksPanel = document.getElementById('gachaPacksPanel');
    const chatOptionsPanel = document.getElementById('chatOptionsPanel');
    const tabBar = document.querySelector('.tab-bar');

    function activateTab(tabName) {
        const panel = TAB_PANELS[tabName];
        if (!panel) return;

        Object.entries(TAB_PANELS).forEach(([name, el]) => {
            if (el) el.classList.toggle('is-hidden', name !== tabName);
        });

        milestonesPanel?.classList.toggle('is-hidden', tabName === 'home' || tabName === 'chat' || tabName === 'games' || tabName === 'gacha');
        gachaPacksPanel?.classList.toggle('is-hidden', tabName !== 'gacha');
        chatOptionsPanel?.classList.toggle('is-hidden', tabName !== 'chat');
        document.body.classList.toggle('is-home-tab', tabName === 'home');

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.tab === tabName);
        });

        if (tabName === 'chat' && typeof window.initChatTab === 'function') {
            window.initChatTab().catch(error => {
                console.error('Could not initialize chat.', error);
                if (typeof showPopup === 'function') showPopup('Could not initialize chat. Please try again.', 'error');
            });
        }
        if (tabName === 'blog' && typeof window.initBlogTab === 'function') window.initBlogTab();
        if (tabName === 'blog' && typeof window.initBlogCommunity === 'function') window.initBlogCommunity();
        if (tabName === 'home') window.dispatchEvent(new Event('home-dashboard-opened'));
        if (tabName === 'gacha') window.dispatchEvent(new Event('gacha-tab-opened'));
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
