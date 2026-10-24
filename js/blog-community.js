(() => {
    const sectionTabs = [...document.querySelectorAll(".blog-section-tab")];
    const sectionPanels = {
        posts: document.getElementById("blogPostsPanel"),
        polls: document.getElementById("blogPollsPanel"),
        suggestions: document.getElementById("blogSuggestionsPanel")
    };
    const pollForm = document.getElementById("createBlogPollForm");
    const pollOptionsFieldset = document.getElementById("blogPollOptionsFieldset");
    const pollList = document.getElementById("blogPollList");
    const pollCreateStatus = document.getElementById("blogPollCreateStatus");
    const suggestionForm = document.getElementById("createBlogSuggestionForm");
    const suggestionList = document.getElementById("blogSuggestionList");
    const suggestionCreateStatus = document.getElementById("blogSuggestionCreateStatus");
    let currentUserId = null;
    let pollsLoaded = false;
    let suggestionsLoaded = false;

    function setStatus(element, message, isError = false) {
        element.textContent = message;
        element.classList.toggle("blog-community-error", isError);
    }

    function recordCommunityAchievement(eventName, details = {}) {
        const recorder = window.achievements?.recordGameEvent;
        if (typeof recorder !== "function") {
            console.error("Achievement tracker is unavailable for blog community activity.");
            return;
        }
        recorder("main", eventName, details).catch(error => {
            console.error("Could not record blog community achievement.", error);
        });
    }

    function makeMessage(className, message) {
        const element = document.createElement("p");
        element.className = className;
        element.textContent = message;
        return element;
    }

    function formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? ""
            : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    }

    function activateSection(sectionName) {
        sectionTabs.forEach(tab => {
            const active = tab.dataset.blogSection === sectionName;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        Object.entries(sectionPanels).forEach(([name, panel]) => {
            const active = name === sectionName;
            panel.hidden = !active;
            panel.classList.toggle("is-hidden", !active);
        });
        if (sectionName === "polls") loadPolls();
        if (sectionName === "suggestions") loadSuggestions();
    }

    function showSignedInStatus() {
        if (currentUserId) {
            if (pollCreateStatus.textContent === "Sign in to create a poll.") setStatus(pollCreateStatus, "");
            if (suggestionCreateStatus.textContent === "Sign in to post a suggestion.") setStatus(suggestionCreateStatus, "");
        } else {
            setStatus(pollCreateStatus, "Sign in to create a poll.");
            setStatus(suggestionCreateStatus, "Sign in to post a suggestion.");
        }
    }

    function getPollOptions() {
        return [...pollOptionsFieldset.querySelectorAll('input[name="option"]')];
    }

    function addPollOption(value = "") {
        const optionNumber = getPollOptions().length + 1;
        const label = document.createElement("label");
        label.textContent = `Option ${optionNumber}`;
        const input = document.createElement("input");
        input.type = "text";
        input.name = "option";
        input.maxLength = 100;
        input.required = true;
        input.value = value;
        label.appendChild(input);
        pollOptionsFieldset.appendChild(label);
    }

    function resetPollOptionFields() {
        const legend = pollOptionsFieldset.querySelector("legend");
        pollOptionsFieldset.replaceChildren(legend);
        addPollOption();
        addPollOption();
    }

    function updateAddOptionButton() {
        document.getElementById("addBlogPollOptionBtn").disabled = getPollOptions().length >= 8;
    }

    function buildPollCard(poll, options, selectedOptionId) {
        const card = document.createElement("article");
        card.className = "blog-community-card";
        const heading = document.createElement("h3");
        heading.textContent = poll.title;
        card.appendChild(heading);

        const meta = document.createElement("span");
        meta.className = "blog-community-meta";
        meta.textContent = `Poll · ${formatDate(poll.created_at)}`;
        card.appendChild(meta);

        const totalVotes = options.reduce((total, option) => total + Number(option.vote_count || 0), 0);
        const optionsContainer = document.createElement("div");
        optionsContainer.className = "blog-poll-options";
        options.forEach(option => {
            const row = document.createElement("div");
            row.className = "blog-poll-option";

            const label = document.createElement("span");
            label.textContent = option.label;
            const voteCount = Number(option.vote_count || 0);
            const result = document.createElement("span");
            result.textContent = `${voteCount} · ${totalVotes ? Math.round(voteCount / totalVotes * 100) : 0}%`;
            row.append(label, result);

            const track = document.createElement("div");
            track.className = "blog-poll-option-track";
            const fill = document.createElement("span");
            fill.style.width = `${totalVotes ? voteCount / totalVotes * 100 : 0}%`;
            track.appendChild(fill);
            row.appendChild(track);

            if (currentUserId && !selectedOptionId) {
                const voteButton = document.createElement("button");
                voteButton.type = "button";
                voteButton.className = "blog-poll-vote";
                voteButton.textContent = "Vote";
                voteButton.addEventListener("click", () => castVote(poll.id, option.id, voteButton));
                row.appendChild(voteButton);
            } else if (selectedOptionId === option.id) {
                const selected = document.createElement("span");
                selected.className = "blog-poll-selected";
                selected.textContent = "Your vote";
                row.appendChild(selected);
            }
            optionsContainer.appendChild(row);
        });
        card.appendChild(optionsContainer);

        if (!currentUserId) {
            card.appendChild(makeMessage("blog-community-meta", "Sign in to vote."));
        } else if (selectedOptionId && !options.some(option => option.id === selectedOptionId)) {
            card.appendChild(makeMessage("blog-community-meta", "You have voted in this poll."));
        }
        card.appendChild(makeMessage("blog-community-meta", `${totalVotes} vote${totalVotes === 1 ? "" : "s"}`));
        return card;
    }

    async function loadPolls() {
        if (pollsLoaded) return;
        pollsLoaded = true;
        pollList.replaceChildren(makeMessage("blog-status", "Loading polls..."));
        try {
            const { data: polls, error: pollError } = await _supabase
                .from("blog_polls")
                .select("id, title, created_at")
                .order("created_at", { ascending: false })
                .limit(100);
            if (pollError) throw pollError;
            if (!polls?.length) {
                pollList.replaceChildren(makeMessage("blog-community-empty", "No polls yet. Be the first to create one."));
                return;
            }

            const pollIds = polls.map(poll => poll.id);
            const [optionsResult, votesResult] = await Promise.all([
                _supabase.from("blog_poll_options")
                    .select("id, poll_id, label, vote_count")
                    .in("poll_id", pollIds)
                    .order("position", { ascending: true }),
                currentUserId
                    ? _supabase.from("blog_poll_votes")
                        .select("poll_id, option_id")
                        .eq("user_id", currentUserId)
                        .in("poll_id", pollIds)
                    : Promise.resolve({ data: [], error: null })
            ]);
            if (optionsResult.error) throw optionsResult.error;
            if (votesResult.error) throw votesResult.error;
            const optionsByPoll = new Map();
            (optionsResult.data || []).forEach(option => {
                const options = optionsByPoll.get(option.poll_id) || [];
                options.push(option);
                optionsByPoll.set(option.poll_id, options);
            });
            const votesByPoll = new Map((votesResult.data || []).map(vote => [vote.poll_id, vote.option_id]));
            const cards = polls.map(poll => {
                const options = optionsByPoll.get(poll.id) || [];
                if (options.length < 2) throw new Error(`Poll "${poll.title}" has incomplete options.`);
                return buildPollCard(poll, options, votesByPoll.get(poll.id));
            });
            pollList.replaceChildren(...cards);
        } catch (error) {
            console.error("Could not load community polls.", error);
            pollsLoaded = false;
            pollList.replaceChildren(makeMessage(
                "blog-community-error",
                `Could not load polls. Apply supabase/blog_community.sql in the Supabase SQL Editor. ${error.message || ""}`
            ));
        }
    }

    async function castVote(pollId, optionId, button) {
        if (!currentUserId) {
            setStatus(pollCreateStatus, "Sign in to vote.");
            return;
        }
        button.disabled = true;
        try {
            const { error } = await _supabase.rpc("cast_blog_poll_vote", {
                p_poll_id: pollId,
                p_option_id: optionId
            });
            if (error) throw error;
            recordCommunityAchievement("poll-voted");
            pollsLoaded = false;
            await loadPolls();
        } catch (error) {
            console.error("Could not submit poll vote.", error);
            button.disabled = false;
            const message = error.message?.includes("already voted")
                ? "You have already voted in this poll."
                : `Could not submit vote: ${error.message || "please try again."}`;
            setStatus(pollCreateStatus, message, true);
        }
    }

    async function submitPoll(event) {
        event.preventDefault();
        if (!currentUserId) {
            setStatus(pollCreateStatus, "Sign in to create a poll.", true);
            return;
        }
        const title = document.getElementById("blogPollTitle").value.trim();
        const optionLabels = getPollOptions().map(input => input.value.trim()).filter(Boolean);
        if (!title || optionLabels.length < 2 || optionLabels.length > 8) {
            setStatus(pollCreateStatus, "Enter a question and between 2 and 8 non-empty options.", true);
            return;
        }
        if (new Set(optionLabels.map(option => option.toLocaleLowerCase())).size !== optionLabels.length) {
            setStatus(pollCreateStatus, "Poll options must be unique.", true);
            return;
        }

        const submitButton = pollForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        setStatus(pollCreateStatus, "Publishing poll...");
        try {
            const { data: pollId, error } = await _supabase.rpc("create_blog_poll", {
                p_title: title,
                p_options: optionLabels
            });
            if (error) throw error;
            if (!pollId) throw new Error("Poll creation returned no poll ID.");
            if (optionLabels.length === 8) {
                recordCommunityAchievement("poll-created", { optionCount: optionLabels.length });
            }
            pollForm.reset();
            resetPollOptionFields();
            updateAddOptionButton();
            setStatus(pollCreateStatus, "Poll published.");
            pollsLoaded = false;
            await loadPolls();
        } catch (error) {
            console.error("Could not publish poll.", error);
            setStatus(pollCreateStatus, `Could not publish poll. Check the Supabase setup and try again: ${error.message || "unknown error."}`, true);
        } finally {
            submitButton.disabled = false;
        }
    }

    function buildSuggestionCard(suggestion) {
        const card = document.createElement("article");
        card.className = "blog-community-card";
        const heading = document.createElement("h3");
        heading.textContent = suggestion.title;
        const meta = document.createElement("span");
        meta.className = "blog-community-meta";
        meta.textContent = `Suggestion · ${formatDate(suggestion.created_at)}`;
        const body = makeMessage("blog-community-body", suggestion.body);
        card.append(heading, meta, body);
        return card;
    }

    async function loadSuggestions() {
        if (suggestionsLoaded) return;
        suggestionsLoaded = true;
        suggestionList.replaceChildren(makeMessage("blog-status", "Loading suggestions..."));
        try {
            const { data, error } = await _supabase
                .from("blog_suggestions")
                .select("id, title, body, created_at")
                .order("created_at", { ascending: false })
                .limit(100);
            if (error) throw error;
            if (!data?.length) {
                suggestionList.replaceChildren(makeMessage("blog-community-empty", "No suggestions yet. Share the first one."));
                return;
            }
            suggestionList.replaceChildren(...data.map(buildSuggestionCard));
        } catch (error) {
            console.error("Could not load community suggestions.", error);
            suggestionsLoaded = false;
            suggestionList.replaceChildren(makeMessage(
                "blog-community-error",
                `Could not load suggestions. Apply supabase/blog_community.sql in the Supabase SQL Editor. ${error.message || ""}`
            ));
        }
    }

    async function submitSuggestion(event) {
        event.preventDefault();
        if (!currentUserId) {
            setStatus(suggestionCreateStatus, "Sign in to post a suggestion.", true);
            return;
        }
        const title = document.getElementById("blogSuggestionTitle").value.trim();
        const body = document.getElementById("blogSuggestionBody").value.trim();
        if (!title || !body) {
            setStatus(suggestionCreateStatus, "Enter a title and suggestion.", true);
            return;
        }
        const submitButton = suggestionForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        setStatus(suggestionCreateStatus, "Posting suggestion...");
        try {
            const { error } = await _supabase.from("blog_suggestions").insert({
                user_id: currentUserId,
                title,
                body
            });
            if (error) throw error;
            suggestionForm.reset();
            recordCommunityAchievement("suggestion-created");
            setStatus(suggestionCreateStatus, "Suggestion posted.");
            suggestionsLoaded = false;
            await loadSuggestions();
        } catch (error) {
            console.error("Could not post community suggestion.", error);
            setStatus(suggestionCreateStatus, `Could not post suggestion. Check the Supabase setup and try again: ${error.message || "unknown error."}`, true);
        } finally {
            submitButton.disabled = false;
        }
    }

    sectionTabs.forEach(tab => {
        tab.addEventListener("click", () => activateSection(tab.dataset.blogSection));
    });
    document.getElementById("addBlogPollOptionBtn").addEventListener("click", () => {
        if (getPollOptions().length >= 8) return;
        addPollOption();
        updateAddOptionButton();
    });
    pollForm.addEventListener("submit", submitPoll);
    suggestionForm.addEventListener("submit", submitSuggestion);

    window.addEventListener("app-auth-state-changed", event => {
        currentUserId = event.detail?.userId || null;
        showSignedInStatus();
        pollsLoaded = false;
        if (!sectionPanels.polls.hidden) loadPolls();
    });

    currentUserId = null;
    _supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (error) throw error;
        currentUserId = session?.user?.id || null;
        showSignedInStatus();
    }).catch(error => {
        console.error("Could not check the signed-in user for blog community features.", error);
        setStatus(pollCreateStatus, "Could not check your sign-in status. Refresh and try again.", true);
        setStatus(suggestionCreateStatus, "Could not check your sign-in status. Refresh and try again.", true);
    });
    window.initBlogCommunity = () => activateSection(
        document.querySelector(".blog-section-tab.is-active")?.dataset.blogSection || "posts"
    );
    showSignedInStatus();
    updateAddOptionButton();
})();
