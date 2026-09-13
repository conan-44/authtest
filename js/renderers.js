window.AchievementLib = window.AchievementLib || {};

// Builds the DOM-rendering functions bound to one module instance's state and elements.
window.AchievementLib.createRenderers = function createRenderers(state, elements) {
    const { isCompleted, getSummary } = window.AchievementLib;

    const POPUP_SOUNDS = {
        info: "../assets/info.wav",
        error: "../assets/error.wav"
    };

    function playNotificationSound(type, isStacked = false) {
        const soundPath = POPUP_SOUNDS[type] || POPUP_SOUNDS.info;
        const play = () => {
            const audio = new Audio(soundPath);
            audio.play().catch(() => {});
        };

        if (isStacked) {
            setTimeout(play, 100);
        } else {
            play();
        }
    }

    function dismissPopup(popup) {
        if (!popup || popup.classList.contains("notification-out")) return;
        popup.classList.add("notification-out");
        let removed = false;
        const onEnd = () => {
            if (removed) return;
            removed = true;
            popup.remove();
        };
        popup.addEventListener("animationend", onEnd, { once: true });
        setTimeout(onEnd, 380);
    }

    function renderAll() {
        const summary = getSummary(state);
        if (elements.scoreEl) elements.scoreEl.textContent = `Points: ${summary.unlockedPoints} / ${summary.totalPoints}`;
        if (!elements.gridEl) return;
        elements.gridEl.innerHTML = "";
        state.achievementsMap.forEach(achievement => {
            const complete = isCompleted(state, achievement.id);
            const card = document.createElement("article");
            card.className = "achievement-card" + ` rarity-${achievement.rarity}` + (complete ? " is-completed" : " is-locked") + (achievement.rarity === "secret" && !complete ? " is-secret-locked" : "");
            const banner = document.createElement("span"); banner.className = `banners banners-${achievement.rarity}`;
            const cardInner = document.createElement("div"); cardInner.className = "achievement-card-inner";
            const icon = document.createElement("div"); icon.className = "achievement-icon"; icon.textContent = achievement.icon;
            const body = document.createElement("div");
            const title = document.createElement("h3"); title.className = `achievement-title rarity-${achievement.rarity}`; title.textContent = achievement.title;
            const description = document.createElement("p"); description.className = "achievement-description"; description.textContent = achievement.rarity === "secret" && !complete ? "???" : (achievement.description || "No description.");
            const points = document.createElement("span"); points.className = "achievement-pts"; points.textContent = `+${achievement.points}p`;
            const status = document.createElement("span"); status.className = "achievement-status"; status.title = complete ? "Completed" : "Locked";
            const statusIcon = document.createElement("span"); statusIcon.className = "icons_status " + (complete ? "icons_status-unlocked" : "icons_status-locked");
            status.append(statusIcon);
            const meta = document.createElement("div"); meta.className = "achievement-meta";
            meta.append(points, status);
            body.append(title, description, meta); cardInner.append(icon, body); card.append(banner, cardInner); elements.gridEl.append(card);
        });
    }

    function renderMilestones() {
        if (!elements.milestonesGridEl) return;
        const unlockedPoints = getSummary(state).unlockedPoints;
        elements.milestonesGridEl.innerHTML = "";
        state.milestones.forEach(milestone => {
            const unlocked = unlockedPoints >= milestone.points;
            const chip = document.createElement("article");
            const tier = milestone.name.toLowerCase();
            const hasMedal = tier !== "mythical";
            chip.className = "milestone-chip " + (unlocked ? "is-unlocked" : "is-locked") + (hasMedal ? " has-medal" : "");
            if (hasMedal) {
                const medalWrap = document.createElement("span"); medalWrap.className = "milestone-medal";
                const medal = document.createElement("span"); medal.className = `icons_medal icons_medal-${tier}`;
                medalWrap.append(medal);
                chip.append(medalWrap);
            }
            const name = document.createElement("p"); name.className = "milestone-name"; name.textContent = milestone.name;
            const req = document.createElement("p"); req.className = "milestone-req"; req.textContent = `${milestone.points}p`;
            const status = document.createElement("p"); status.className = "milestone-status"; status.title = unlocked ? "Reached" : "Locked";
            const statusIcon = document.createElement("span"); statusIcon.className = "icons_status " + (unlocked ? "icons_status-unlocked" : "icons_status-locked");
            status.append(statusIcon);
            chip.append(name, req, status);
            elements.milestonesGridEl.append(chip);
        });
    }

    function showPopup(titleText, subtitleText) {
        if (!elements.popupContainer) return;
        const stack = elements.popupContainer;
        const hasExisting = stack.querySelectorAll(".notification:not(.notification-out)").length > 0;

        const popup = document.createElement("div");
        popup.className = "notification notification-info unlock-notification";
        popup.setAttribute("role", "status");

        const icon = document.createElement("span");
        icon.className = "notification-label label-info";
        icon.setAttribute("aria-hidden", "true");

        const content = document.createElement("div");
        content.className = "notification-content";

        const title = document.createElement("div");
        title.className = "notification-title";
        title.textContent = titleText;

        const subtitle = document.createElement("div");
        subtitle.className = "notification-subtitle";
        subtitle.textContent = subtitleText;

        content.append(title, subtitle);
        popup.append(icon, content);
        stack.appendChild(popup);

        playNotificationSound("info", hasExisting);

        popup.dismissTimer = setTimeout(() => {
            dismissPopup(popup);
        }, 4000);
    }

    function showUnlockPopup(achievement) {
        showPopup(
            `Unlocked: ${achievement.title}`,
            `${achievement.rarity.toUpperCase()} (+${achievement.points} pts)`
        );
    }

    function showMilestonePopup(milestone) {
        showPopup(
            `Milestone: ${milestone.name}`,
            `${milestone.points} points reached!`
        );
    }

    return { renderAll, renderMilestones, showUnlockPopup, showMilestonePopup };
};
