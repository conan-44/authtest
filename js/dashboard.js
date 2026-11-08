(() => {
    const dashboard = document.getElementById('homeDashboard');
    const elements = {
        blog: document.getElementById('homeLatestPost'),
        suggestion: document.getElementById('homeSuggestion'),
        polls: document.getElementById('homePolls'),
        channels: document.getElementById('homeChannels'),
        games: document.getElementById('homeGames')
    };
    const gameNames = {
        mastermind: 'Bulls & Cows',
        chess: 'Chess',
        blackjack: 'Blackjack',
        doudizhu: 'Dou Dizhu',
        streetfighter: 'Street Fighter'
    };
    let userId = null;
    let generation = 0;
    let authGeneration = 0;
    let authReceived = false;

    function clear() {
        Object.values(elements).forEach(element => {
            element.classList.remove('dashboard-error');
            element.textContent = 'Loading...';
        });
        document.getElementById('homeSmileyForm').reset();
        document.getElementById('homeSmileyStatus').textContent = '';
        document.getElementById('homeSuggestionForm').reset();
        document.getElementById('homeSuggestionStatus').textContent = '';
        dashboard.querySelectorAll('form button[type="submit"]').forEach(button => { button.disabled = false; });
        dashboard.querySelectorAll('details').forEach(details => { details.open = false; });
    }

    function showText(element, text) {
        element.replaceChildren(document.createTextNode(text));
    }

    function makeList(items, makeItem) {
        const list = document.createElement('ul');
        items.forEach(item => {
            const li = document.createElement('li');
            makeItem(li, item);
            list.appendChild(li);
        });
        return list;
    }

    async function readPages(makeQuery) {
        const rows = [];
        const size = 500;
        for (let offset = 0; ; offset += size) {
            const { data, error } = await makeQuery().range(offset, offset + size - 1);
            if (error) throw error;
            if (!Array.isArray(data)) throw new Error('The server returned an invalid response.');
            rows.push(...data);
            if (data.length < size) return rows;
        }
    }

    async function fetchText(url) {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
        return response.text();
    }

    function parseDate(value) {
        const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
        if (!match) return null;
        const [, day, month, year] = match;
        const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
        return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1
            && date.getUTCDate() === Number(day) ? date.getTime() : null;
    }

    async function loadBlog() {
        const entries = window.AchievementLib.parseJsonWithComments(await fetchText('./data/blog/index.skvwmeta'));
        if (!Array.isArray(entries)) throw new Error('The blog index is invalid.');
        const posts = await Promise.all(entries.map(async entry => {
            const post = typeof entry === 'string' ? { id: entry } : entry;
            const fileName = typeof post?.id === 'string' ? post.id : post?.file;
            const id = typeof fileName === 'string' ? fileName.replace(/\.siumingboke$/i, '') : '';
            if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error('The blog index contains an invalid post ID.');
            const markdown = await fetchText(`./data/blog/${encodeURIComponent(id)}.siumingboke`);
            const title = (typeof post.title === 'string' ? post.title.trim() : '') || markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || id;
            const date = markdown.match(/^#{1,6}\s+\+\+\s*DATE:\s*(.*?)\s*$/im)?.[1] || post.date || '';
            const timestamp = parseDate(date);
            if (timestamp === null) console.warn(`Invalid blog date for ${id}: ${date || '(missing)'}`);
            const excerpt = markdown.split(/\r?\n/).find(line => line.trim() && !/^\s*(#|```|[-*+] |>|!\[)/.test(line)) || '';
            return { id, title, date, timestamp, markdown, excerpt };
        }));
        const dated = posts.filter(post => post.timestamp !== null).sort((a, b) => b.timestamp - a.timestamp);
        return { post: dated[0], invalid: dated.length !== posts.length };
    }

    async function loadSuggestion(id) {
        const own = await readPages(() => _supabase.from('blog_suggestions').select('id').eq('user_id', id).order('id'));
        if (!own.length) return null;
        const ids = new Set(own.map(row => row.id));
        const suggestions = await readPages(() => _supabase.rpc('get_blog_suggestions', { p_sort: 'popular' }).order('id'));
        const matches = suggestions.filter(row => ids.has(row.id));
        if (matches.length !== ids.size) throw new Error('Some of your suggestions were not returned by the suggestions service.');
        matches.forEach(row => {
            if (typeof row.title !== 'string' || !Number.isFinite(Number(row.upvotes)) || !Number.isFinite(Number(row.downvotes))) {
                throw new Error('The suggestions service returned invalid vote data.');
            }
        });
        matches.sort((a, b) => (Number(b.upvotes) - Number(b.downvotes)) - (Number(a.upvotes) - Number(a.downvotes))
            || Date.parse(b.created_at) - Date.parse(a.created_at));
        return matches[0];
    }

    async function loadPolls(id) {
        const { data: polls, error } = await _supabase.from('blog_polls')
            .select('id, title, created_at').order('created_at', { ascending: false }).limit(100);
        if (error) throw error;
        if (!Array.isArray(polls)) throw new Error('The polls service returned an invalid response.');
        if (!polls.length) return [];
        const pollIds = polls.map(poll => poll.id);
        const [options, votes] = await Promise.all([
            readPages(() => _supabase.from('blog_poll_options')
                .select('id, poll_id, label, vote_count, position').in('poll_id', pollIds).order('position').order('id')),
            readPages(() => _supabase.from('blog_poll_votes')
                .select('poll_id, option_id').eq('user_id', id).in('poll_id', pollIds).order('poll_id'))
        ]);
        const totals = new Map(polls.map(poll => [poll.id, 0]));
        options.forEach(option => {
            const count = Number(option.vote_count);
            if (!Number.isFinite(count) || count < 0 || !totals.has(option.poll_id) || typeof option.label !== 'string') throw new Error('The polls service returned invalid vote data.');
            totals.set(option.poll_id, totals.get(option.poll_id) + count);
        });
        return polls.map(poll => {
            const choices = options.filter(option => option.poll_id === poll.id);
            if (choices.length < 2) throw new Error(`Poll "${poll.title}" has incomplete options.`);
            return { ...poll, votes: totals.get(poll.id), options: choices, selected: votes.find(vote => vote.poll_id === poll.id)?.option_id };
        })
            .sort((a, b) => b.votes - a.votes || Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 3);
    }

    async function loadChannels(id) {
        const joined = await readPages(() => _supabase.from('chat_channel_members')
            .select('channel_id, chat_channels!inner(id, name)').eq('user_id', id).order('channel_id'));
        const channels = joined.map(row => {
            const channel = Array.isArray(row.chat_channels) ? row.chat_channels[0] : row.chat_channels;
            if (!channel || typeof channel.id !== 'string' || typeof channel.name !== 'string') throw new Error('The channel service returned invalid channel data.');
            return { id: channel.id, name: channel.name, members: 0 };
        });
        if (!channels.length) return [];
        const ids = channels.map(channel => channel.id);
        const members = await readPages(() => _supabase.from('chat_channel_members')
            .select('channel_id, user_id').in('channel_id', ids).order('channel_id').order('user_id'));
        const counts = new Map(ids.map(channelId => [channelId, 0]));
        members.forEach(member => {
            if (!counts.has(member.channel_id)) throw new Error('The channel service returned invalid membership data.');
            counts.set(member.channel_id, counts.get(member.channel_id) + 1);
        });
        channels.forEach(channel => { channel.members = counts.get(channel.id); });
        return channels.sort((a, b) => b.members - a.members || a.name.localeCompare(b.name)).slice(0, 3);
    }

    async function loadGames(id) {
        const { data, error } = await _supabase.from('game_ratings').select('game, rating').eq('user_id', id);
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error('The ratings service returned an invalid response.');
        const ratings = Object.keys(gameNames).map(game => {
            const row = data.find(item => item.game === game);
            const value = row ? Number(row.rating) : window.gameRatings.defaults[game];
            if (!Number.isFinite(value)) throw new Error(`Invalid rating for ${gameNames[game]}.`);
            return { game, rating: value };
        });
        return ratings;
    }

    function renderGames(element, ratings) {
        const highest = Math.max(...ratings.map(item => item.rating));
        const lowest = Math.min(...ratings.map(item => item.rating));
        const groups = [
            ['Highest Elo', ratings.filter(item => item.rating === highest)],
            ['Lowest Elo', ratings.filter(item => item.rating === lowest)],
            ['Exactly 1000 Elo', ratings.filter(item => item.rating === 1000)]
        ];
        element.replaceChildren();
        groups.forEach(([title, games]) => {
            const heading = document.createElement('h4');
            heading.textContent = title;
            element.appendChild(heading);
            if (!games.length) {
                const message = document.createElement('p');
                message.textContent = 'No games at exactly 1000 Elo.';
                element.appendChild(message);
                return;
            }
            element.appendChild(makeList(games, (li, game) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = `${gameNames[game.game]} · ${game.rating} Elo`;
                button.addEventListener('click', () => {
                    try {
                        window.openRatedGame(game.game);
                    } catch (error) {
                        console.error('Could not open game.', error);
                        showPopup(error.message, 'error');
                    }
                });
                li.appendChild(button);
            }));
        });
    }

    function refresh() {
        if (!userId || document.body.classList.contains('is-guest')) return;
        const request = ++generation;
        const authRequest = authGeneration;
        const id = userId;
        const blogWasOpen = elements.blog.querySelector('details')?.open || false;
        const tasks = {
            blog: [loadBlog, (element, result) => {
                if (!result.post) showText(element, result.invalid ? 'No posts have a valid date.' : 'No blog posts yet.');
                else {
                    const note = document.createElement('p');
                    note.textContent = `Post popularity is not tracked; showing the latest valid date${result.invalid ? ' (some post dates are invalid)' : ''}.`;
                    const excerpt = document.createElement('p');
                    excerpt.textContent = result.post.excerpt;
                    const details = document.createElement('details');
                    details.open = blogWasOpen;
                    const summary = document.createElement('summary');
                    summary.textContent = `${result.post.title} · ${result.post.date} — read post`;
                    details.append(summary, window.renderBlogPost(result.post, result.post.markdown));
                    element.replaceChildren(note, details, excerpt);
                }
            }],
            suggestion: [() => loadSuggestion(id), (element, result) => showText(element,
                result ? `${result.title} · Score ${Number(result.upvotes) - Number(result.downvotes)}` : 'You have not posted a suggestion yet.')],
            polls: [() => loadPolls(id), (element, polls) => {
                if (!polls.length) return showText(element, 'No polls yet.');
                const note = document.createElement('p');
                note.textContent = 'Most votes among the latest 100 polls:';
                element.replaceChildren(note);
                polls.forEach(poll => {
                    const card = document.createElement('div');
                    const heading = document.createElement('h4');
                    heading.textContent = `${poll.title} · ${poll.votes} vote${poll.votes === 1 ? '' : 's'}`;
                    card.appendChild(heading);
                    poll.options.forEach(option => {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.textContent = `${option.label} · ${option.vote_count}${poll.selected === option.id ? ' (your vote)' : ''}`;
                        button.disabled = Boolean(poll.selected);
                        button.addEventListener('click', async () => {
                            const buttons = card.querySelectorAll('button');
                            buttons.forEach(item => { item.disabled = true; });
                            try {
                                await window.blogCommunityActions.votePoll(poll.id, option.id);
                                if (userId === id && authRequest === authGeneration) refresh();
                            } catch (error) {
                                console.error('Could not vote from the dashboard.', error);
                                if (userId !== id || request !== generation) return;
                                status.textContent = `Could not submit vote: ${error.message || 'please try again.'}`;
                                buttons.forEach(item => { item.disabled = false; });
                            }
                        });
                        card.appendChild(button);
                    });
                    const status = document.createElement('p');
                    status.setAttribute('role', 'status');
                    if (poll.selected) status.textContent = 'You have voted in this poll.';
                    card.appendChild(status);
                    element.appendChild(card);
                });
            }],
            channels: [() => loadChannels(id), (element, channels) => {
                if (!channels.length) return showText(element, 'You have not joined any channels yet.');
                const note = document.createElement('p');
                note.textContent = 'Ranked by visible members; permissions may limit counts:';
                element.replaceChildren(note, makeList(channels, (li, channel) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = `${channel.name} · ${channel.members} visible member${channel.members === 1 ? '' : 's'}`;
                    button.addEventListener('click', async () => {
                        try {
                            window.activateTab('chat');
                            await window.openJoinedChatChannel(channel.id);
                        } catch (error) {
                            console.error('Could not open channel.', error);
                            showPopup(error.message, 'error');
                        }
                    });
                    li.appendChild(button);
                }));
            }],
            games: [() => loadGames(id), renderGames]
        };
        Object.entries(tasks).forEach(([name, [load, render]]) => {
            const element = elements[name];
            element.classList.remove('dashboard-error');
            showText(element, 'Loading...');
            Promise.resolve().then(load).then(result => {
                if (request === generation && userId === id) render(element, result);
            }).catch(error => {
                if (request !== generation || userId !== id) return;
                console.error(`Could not load dashboard ${name}.`, error);
                element.classList.add('dashboard-error');
                showText(element, `Could not load ${name}: ${error.message || 'unknown error'}.`);
            });
        });
    }

    function setUser(id) {
        generation += 1;
        authGeneration += 1;
        userId = id || null;
        dashboard.hidden = !userId;
        clear();
        if (userId) refresh();
    }

    window.addEventListener('home-dashboard-auth-changed', event => {
        authReceived = true;
        setUser(event.detail?.userId);
    });
    window.addEventListener('home-dashboard-opened', refresh);
    window.addEventListener('home-dashboard-refresh', () => {
        if (document.body.classList.contains('is-home-tab')) refresh();
    });
    document.querySelectorAll('[data-home-blog]').forEach(button => button.addEventListener('click', () => {
        window.activateTab('blog');
        document.querySelector(`.blog-section-tab[data-blog-section="${button.dataset.homeBlog}"]`).click();
    }));
    document.querySelector('[data-home-chat]').addEventListener('click', () => window.activateTab('chat'));
    document.querySelector('[data-home-games]').addEventListener('click', () => window.activateTab('games'));
    document.getElementById('homeSuggestionForm').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const title = document.getElementById('homeSuggestionTitle').value.trim();
        const body = document.getElementById('homeSuggestionBody').value.trim();
        const status = document.getElementById('homeSuggestionStatus');
        const button = form.querySelector('button');
        const id = userId;
        const authRequest = authGeneration;
        if (!id || !title || !body) {
            status.textContent = 'Enter a title and suggestion while signed in.';
            return;
        }
        button.disabled = true;
        status.textContent = 'Posting suggestion...';
        try {
            await window.blogCommunityActions.postSuggestion(id, title, body);
            if (userId !== id || authRequest !== authGeneration) return;
            form.reset();
            status.textContent = 'Suggestion posted.';
            refresh();
        } catch (error) {
            console.error('Could not post suggestion from the dashboard.', error);
            if (userId === id && authRequest === authGeneration) status.textContent = `Could not post suggestion: ${error.message || 'please try again.'}`;
        } finally {
            if (authRequest === authGeneration) button.disabled = false;
        }
    });
    document.getElementById('homeSmileyForm').addEventListener('submit', async event => {
        event.preventDefault();
        const input = document.getElementById('homeSmileyInput');
        const status = document.getElementById('homeSmileyStatus');
        const button = event.currentTarget.querySelector('button');
        const prompt = input.value.trim();
        if (!prompt) return;
        const requestUserId = userId;
        const authRequest = authGeneration;
        button.disabled = true;
        try {
            if (typeof window.openQuickSmiley !== 'function') throw new Error('Smiley is still loading. Please try again.');
            window.activateTab('chat');
            await window.initChatTab();
            if (!requestUserId || userId !== requestUserId || authRequest !== authGeneration) throw new Error('Your account changed. Please try again.');
            window.openQuickSmiley(prompt);
            input.value = '';
            status.textContent = '';
        } catch (error) {
            console.error('Could not open Smiley.', error);
            if (authRequest === authGeneration) {
                status.textContent = error.message;
                if (document.body.classList.contains('is-home-tab') === false && typeof showPopup === 'function') showPopup(error.message, 'error');
            }
        } finally {
            if (authRequest === authGeneration) button.disabled = false;
        }
    });

    _supabase.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        if (!authReceived) setUser(data.session?.user?.id);
    }).catch(error => {
        console.error('Could not load dashboard sign-in state.', error);
        if (typeof showPopup === 'function') showPopup('Could not load dashboard sign-in state.', 'error');
    });
})();
