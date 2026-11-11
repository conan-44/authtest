(() => {
    const kinds = ['achievements', 'chat', 'gacha', 'polls', 'suggestions'];
    const tracked = ['chat', 'polls', 'suggestions'];
    const tables = { chat: 'messages', polls: 'blog_polls', suggestions: 'blog_suggestions' };
    const buttons = Object.fromEntries(kinds.map(kind => [kind, document.querySelector(
        kind === 'polls' || kind === 'suggestions'
            ? `.blog-section-tab[data-blog-section="${kind}"]`
            : `.tab-btn[data-tab="${kind}"]`
    )]));
    let userId = null;
    let channel = null;
    let generation = 0;
    let receivedAuth = false;
    let pending = {};
    let seen = {};
    let ticketAvailable = false;

    function storageKey(id) { return `skvwaffle.activity-indicators.v1:${id}`; }
    function save() {
        if (!userId) return;
        try {
            localStorage.setItem(storageKey(userId), JSON.stringify({ pending, seen }));
        } catch (error) {
            console.warn('Could not save activity indicators.', error);
        }
    }

    function display(button, active) {
        if (!button) return;
        button.classList.toggle('has-new-activity', active);
        if (active) button.setAttribute('aria-description', 'New activity');
        else button.removeAttribute('aria-description');
    }

    function render() {
        kinds.forEach(kind => display(buttons[kind], !!pending[kind] || (kind === 'gacha' && ticketAvailable)));
        display(document.querySelector('.tab-btn[data-tab="blog"]'), !!pending.polls || !!pending.suggestions);
    }

    function active(kind, record) {
        if (kind === 'polls' || kind === 'suggestions') {
            return !document.getElementById('blogPanel').classList.contains('is-hidden')
                && document.querySelector(`.blog-section-tab[data-blog-section="${kind}"]`).classList.contains('is-active');
        }
        if (kind === 'chat' && record) {
            return buttons.chat.classList.contains('is-active')
                && typeof activeChatChannelId !== 'undefined'
                && (record.channel_id || null) === activeChatChannelId;
        }
        return buttons[kind]?.classList.contains('is-active') || false;
    }

    function clear(kind) {
        if (!userId) return;
        pending[kind] = false;
        if (tracked.includes(kind)) seen[kind] = new Date().toISOString();
        save();
        render();
    }

    function mark(kind, record) {
        if (!userId || !kinds.includes(kind)) return;
        if (active(kind, record)) {
            if (kind !== 'chat' || !record?.channel_id) clear(kind);
            return;
        }
        pending[kind] = true;
        save();
        render();
    }

    function onInsert(kind, record) {
        if (!record || record.user_id === userId) return;
        if (kind === 'polls' || kind === 'suggestions') {
            window.dispatchEvent(new CustomEvent('community-new-activity', { detail: { section: kind } }));
        }
        mark(kind, record);
    }

    async function checkMissed(id, currentGeneration) {
        await Promise.all(tracked.map(async kind => {
            try {
                let query = _supabase.from(tables[kind]).select('id, created_at')
                    .gt('created_at', seen[kind]).order('created_at', { ascending: false }).limit(1);
                if (kind === 'chat') query = query.is('channel_id', null).neq('user_id', id);
                const { data, error } = await query;
                if (error) throw error;
                if (currentGeneration === generation && data?.length) mark(kind, kind === 'chat' ? { channel_id: null } : null);
            } catch (error) {
                console.warn(`Could not check new ${kind} activity.`, error);
            }
        }));
    }

    function setUser(id) {
        if (id === userId) return;
        generation++;
        if (channel) {
            _supabase.removeChannel(channel);
            channel = null;
        }
        userId = id || null;
        pending = {};
        seen = {};
        ticketAvailable = false;
        if (!userId) {
            render();
            return;
        }
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey(userId)) || '{}');
            for (const kind of kinds) pending[kind] = saved.pending?.[kind] === true;
            for (const kind of tracked) {
                const timestamp = saved.seen?.[kind];
                seen[kind] = typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp))
                    ? timestamp : new Date().toISOString();
            }
        } catch (error) {
            console.warn('Could not load activity indicators.', error);
            for (const kind of tracked) seen[kind] = new Date().toISOString();
        }
        save();
        render();
        const currentGeneration = generation;
        channel = _supabase.channel(`activity-indicators:${userId}`);
        for (const kind of tracked) {
            channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: tables[kind] }, payload => {
                if (generation === currentGeneration) onInsert(kind, payload.new);
            });
        }
        channel.subscribe(status => {
            if (status === 'SUBSCRIBED' && currentGeneration === generation) checkMissed(userId, currentGeneration);
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('Could not subscribe to activity indicators:', status);
            }
        });
    }

    window.addEventListener('home-dashboard-auth-changed', event => {
        receivedAuth = true;
        setUser(event.detail?.userId || null);
    });
    window.addEventListener('app-new-activity', event => mark(event.detail?.kind));
    window.addEventListener('gacha-ticket-availability', event => {
        ticketAvailable = !!userId && event.detail?.available === true;
        render();
    });
    window.addEventListener('blog-section-opened', event => {
        if (!document.getElementById('blogPanel').classList.contains('is-hidden') && tracked.includes(event.detail?.section)) {
            clear(event.detail.section);
        }
    });
    window.addEventListener('app-tab-opened', event => {
        const kind = event.detail?.tab;
        if (kinds.includes(kind)) clear(kind);
        if (kind === 'blog') {
            const section = document.querySelector('.blog-section-tab.is-active')?.dataset.blogSection;
            if (tracked.includes(section)) clear(section);
        }
    });
    _supabase.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        if (!receivedAuth) setUser(data.session?.user?.id || null);
    }).catch(error => console.error('Could not initialize activity indicators.', error));
})();
