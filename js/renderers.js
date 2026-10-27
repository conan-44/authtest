window.AchievementLib = window.AchievementLib || {};

window.AchievementLib.createRenderers = function createRenderers(state, elements) {
    const { isCompleted, getSummary } = window.AchievementLib;

    const POPUP_AUDIO_ROOT = new URL("../assets/audio/", document.currentScript?.src || window.location.href);
    const POPUP_SOUNDS = {
        info: new URL("info.wav", POPUP_AUDIO_ROOT).href,
        error: new URL("error.wav", POPUP_AUDIO_ROOT).href
    };
    const popupAudio = new Map();
    let popupAudioUnlocked = false;
    let activeTreeNamespace = null;
    let treeMode = false;

    const ACHIEVEMENT_SPRITES = {
        icons: { url: "./assets/icons.png", width: 288, height: 32, tileWidth: 8, tileHeight: 8, columns: 36 },
        main: { url: "./assets/minigames/games.png", width: 48, height: 8, tileWidth: 8, tileHeight: 8, columns: 6 },
        mastermind: { url: "./assets/minigames/bots.png", width: 32, height: 8, tileWidth: 8, tileHeight: 8, columns: 4 },
        "number-pillars": { url: "./assets/minigames/games.png", width: 48, height: 8, tileWidth: 8, tileHeight: 8, columns: 6 },
        chess: { url: "./assets/minigames/chess/pieces.png", width: 48, height: 32, tileWidth: 8, tileHeight: 16, columns: 6 },
        blackjack: { url: "./assets/minigames/cards.png", width: 24, height: 24, tileWidth: 8, tileHeight: 12, columns: 3 },
        "dou-dizhu": { url: "./assets/minigames/cards.png", width: 24, height: 24, tileWidth: 8, tileHeight: 12, columns: 3 }
    };

    function mainAchievementSprite(achievement) {
        const key = achievement.key.toLowerCase();
        if (key === "codebreaker") return { sheet: "mastermind", column: 0, row: 0 };
        if (key === "team-fort") return { sheet: "main", column: 4, row: 0 };
        if (/beginning|suit-up/.test(key)) return { column: 25, row: 3 };
        if (/profile/.test(key)) return { column: 3, row: 3 };
        if (/poll|suggestion|idea|eight-options/.test(key)) return { column: 31, row: 3 };
        if (/chat|message|channel|gif/.test(key)) return { column: 23, row: 3 };
        return { column: 24, row: 3 };
    }

    function achievementSpritePosition(achievement, sprite) {
        const key = achievement.key.toLowerCase();
        if (achievement.namespace === "main") return mainAchievementSprite(achievement);
        if (achievement.namespace === "number-pillars") {
            return key === "custom-level"
                ? { sheet: "icons", column: 25, row: 3 }
                : { column: 1, row: 0 };
        }
        if (achievement.namespace === "chess") {
            if (/king|checkmate|castle/.test(key)) return { column: 5, row: 1 };
            if (/opening|analysis/.test(key)) return { column: 4, row: 1 };
            if (/enpassant/.test(key)) return { column: 0, row: 1 };
            return { column: 1 + (key.length % 4), row: 1 };
        }
        if (achievement.namespace === "dou-dizhu" && /joker/.test(key)) {
            return { column: 2, row: 0 };
        }
        if ((achievement.namespace === "blackjack" || achievement.namespace === "dou-dizhu")
            && /bomb|rocket|bust|natural/.test(key)) {
            return { column: 0, row: 1 };
        }
        let hash = 0;
        for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
        return { column: hash % sprite.columns, row: sprite.height / sprite.tileHeight > 1 ? hash % 2 : 0 };
    }

    function addAchievementSprite(element, achievement, size) {
        const defaultSheet = achievement.namespace === "main"
            ? "icons"
            : achievement.namespace === "number-pillars"
                ? "number-pillars"
                : achievement.namespace;
        const position = achievementSpritePosition(
            achievement,
            ACHIEVEMENT_SPRITES[defaultSheet] || ACHIEVEMENT_SPRITES.main
        );
        const sprite = ACHIEVEMENT_SPRITES[position.sheet || defaultSheet] || ACHIEVEMENT_SPRITES.main;
        const { column, row } = position;
        const scale = Math.min(3.5, size / Math.max(sprite.tileWidth, sprite.tileHeight));
        const image = document.createElement("span");
        image.className = "achievement-sprite-image";
        image.setAttribute("aria-hidden", "true");
        image.style.width = `${sprite.tileWidth * scale}px`;
        image.style.height = `${sprite.tileHeight * scale}px`;
        image.style.backgroundImage = `url("${sprite.url}")`;
        image.style.backgroundSize = `${sprite.width * scale}px ${sprite.height * scale}px`;
        image.style.backgroundPosition = `${-column * sprite.tileWidth * scale}px ${-row * sprite.tileHeight * scale}px`;
        element.replaceChildren(image);
    }

    function unlockPopupAudio() {
        if (popupAudioUnlocked) return;
        popupAudioUnlocked = true;
        Object.values(POPUP_SOUNDS).forEach(soundPath => {
            const audio = new Audio(soundPath);
            audio.muted = true;
            audio.load();
            audio.play().then(() => {
                audio.pause();
                audio.currentTime = 0;
            }).catch(() => {});
            popupAudio.set(soundPath, audio);
        });
    }

    document.addEventListener("pointerdown", unlockPopupAudio, { once: true, capture: true });
    document.addEventListener("keydown", unlockPopupAudio, { once: true, capture: true });

    function playNotificationSound(type, isStacked = false) {
        const soundPath = POPUP_SOUNDS[type] || POPUP_SOUNDS.info;
        const play = () => {
            const audio = popupAudio.get(soundPath) || new Audio(soundPath);
            popupAudio.set(soundPath, audio);
            audio.muted = false;
            audio.currentTime = 0;
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

    function getNamespaceOrder() {
        const namespaces = new Set(
            Array.from(state.achievementsMap.values(), achievement => achievement.namespace)
        );
        return [
            ...[...namespaces].filter(namespace => namespace === "main"),
            ...[...namespaces].filter(namespace => namespace !== "main").sort()
        ];
    }

    function renderAchievementTreeTabs() {
        const tabs = elements.treeTabsElement;
        if (!tabs) return;
        const namespaces = getNamespaceOrder();
        const focusedNamespace = tabs.contains(document.activeElement)
            ? document.activeElement.dataset.namespace
            : null;
        if (!namespaces.includes(activeTreeNamespace)) activeTreeNamespace = namespaces[0] ?? null;
        tabs.replaceChildren();
        const labels = {
            main: "Main",
            blackjack: "Blackjack",
            chess: "Chess",
            "dou-dizhu": "Dou Dizhu",
            mastermind: "Bulls & Cows",
            "number-pillars": "Number Pillars"
        };
        namespaces.forEach(namespace => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `chat-channel-tab-button${namespace === activeTreeNamespace ? " is-active" : ""}`;
            button.id = `achievement-tree-tab-${namespace}`;
            button.dataset.namespace = namespace;
            button.setAttribute("role", "tab");
            button.setAttribute("aria-selected", String(namespace === activeTreeNamespace));
            button.setAttribute("aria-controls", "achievementTreeCanvas");
            button.textContent = labels[namespace] ?? namespace;
            tabs.append(button);
        });
        if (focusedNamespace && namespaces.includes(focusedNamespace)) {
            [...tabs.querySelectorAll("[data-namespace]")]
                .find(button => button.dataset.namespace === focusedNamespace)
                ?.focus();
        }
    }

    function renderAchievementTree() {
        const canvas = elements.treeCanvasElement;
        if (!canvas || !activeTreeNamespace) return;
        elements.treeCanvasElement.setAttribute("role", "tabpanel");
        elements.treeCanvasElement.setAttribute("aria-labelledby", `achievement-tree-tab-${activeTreeNamespace}`);
        const achievements = [...state.achievementsMap.values()]
            .filter(achievement => achievement.namespace === activeTreeNamespace);
        const byId = new Map(achievements.map(achievement => [achievement.id, achievement]));
        const successors = new Map(achievements.map(achievement => [
            achievement.id,
            achievement.successors.filter(id => byId.has(id))
        ]));
        const incoming = new Map(achievements.map(achievement => [achievement.id, 0]));
        successors.forEach(ids => ids.forEach(id => incoming.set(id, incoming.get(id) + 1)));

        const roots = achievements.filter(achievement => incoming.get(achievement.id) === 0);
        const queue = [...roots];
        const remainingIncoming = new Map(incoming);
        const depths = new Map(roots.map(achievement => [achievement.id, 0]));
        const order = new Map(achievements.map((achievement, index) => [achievement.id, index]));
        let nextOrder = 0;
        const ordered = new Set();
        const orderQueue = [...roots];
        while (orderQueue.length) {
            const achievement = orderQueue.shift();
            if (ordered.has(achievement.id)) continue;
            ordered.add(achievement.id);
            order.set(achievement.id, nextOrder++);
            successors.get(achievement.id).forEach(id => {
                if (!ordered.has(id)) orderQueue.push(byId.get(id));
            });
        }
        while (queue.length) {
            const parent = queue.shift();
            const nextDepth = depths.get(parent.id) + 1;
            successors.get(parent.id).forEach(id => {
                depths.set(id, Math.max(depths.get(id) ?? 0, nextDepth));
                const remaining = remainingIncoming.get(id) - 1;
                remainingIncoming.set(id, remaining);
                if (remaining === 0) queue.push(byId.get(id));
            });
        }
        achievements.forEach(achievement => {
            if (!depths.has(achievement.id)) depths.set(achievement.id, 0);
        });

        const maxDepth = Math.max(0, ...depths.values());
        const columns = Array.from({ length: maxDepth + 1 }, () => []);
        achievements
            .sort((a, b) => order.get(a.id) - order.get(b.id))
            .forEach(achievement => columns[depths.get(achievement.id)].push(achievement));

        canvas.replaceChildren();
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("achievement-tree-edges");
        svg.setAttribute("aria-hidden", "true");
        const columnsElement = document.createElement("div");
        columnsElement.className = "achievement-tree-columns";
        const nodeElements = new Map();

        columns.forEach((columnAchievements, depth) => {
            const column = document.createElement("div");
            column.className = "achievement-tree-column";
            column.dataset.depth = String(depth);
            columnAchievements.forEach(achievement => {
                const complete = isCompleted(state, achievement.id);
                const node = document.createElement("div");
                node.className = `achievement-tree-node rarity-${achievement.rarity}${complete ? " is-completed" : " is-locked"}`;
                node.dataset.achievementId = achievement.id;
                node.dataset.description = achievement.rarity === "secret" && !complete
                    ? "???"
                    : achievement.description;
                node.setAttribute("role", "group");
                node.setAttribute("tabindex", "0");
                node.setAttribute("aria-label", `${achievement.title}${node.dataset.description ? `: ${node.dataset.description}` : ""}`);

                const icon = document.createElement("span");
                icon.className = "achievement-tree-icon";
                icon.setAttribute("aria-hidden", "true");
                addAchievementSprite(icon, achievement, 25);
                const title = document.createElement("span");
                title.className = "achievement-tree-title";
                title.textContent = achievement.title;
                node.append(icon, title);
                nodeElements.set(achievement.id, node);
                column.append(node);
            });
            columnsElement.append(column);
        });

        const nodeRowStep = 86;
        const subtreeSpans = new Map();
        const getSubtreeSpan = (id, active = new Set()) => {
            if (subtreeSpans.has(id)) return subtreeSpans.get(id);
            if (active.has(id)) return 1;
            active.add(id);
            const children = successors.get(id);
            const span = children.length
                ? children.reduce((total, childId) => total + getSubtreeSpan(childId, active), 0)
                : 1;
            active.delete(id);
            subtreeSpans.set(id, span);
            return span;
        };
        const placed = new Set();
        let layoutRows = 0;
        const placeSubtree = (id, topRow) => {
            if (placed.has(id)) return;
            placed.add(id);
            const node = nodeElements.get(id);
            const span = getSubtreeSpan(id);
            const centerY = (topRow + (span - 1) / 2) * nodeRowStep + 29;
            node.style.top = `${centerY - node.offsetHeight / 2}px`;
            let childTopRow = topRow;
            successors.get(id).forEach(childId => {
                placeSubtree(childId, childTopRow);
                childTopRow += getSubtreeSpan(childId);
            });
        };
        roots.forEach(root => {
            placeSubtree(root.id, layoutRows);
            layoutRows += getSubtreeSpan(root.id) + 1;
        });
        achievements.forEach(achievement => {
            if (placed.has(achievement.id)) return;
            placeSubtree(achievement.id, layoutRows);
            layoutRows += getSubtreeSpan(achievement.id) + 1;
        });
        columnsElement.style.height = `${Math.max(252, layoutRows * nodeRowStep)}px`;
        columnsElement.querySelectorAll(".achievement-tree-column").forEach(column => {
            column.style.height = columnsElement.style.height;
        });
        canvas.append(svg, columnsElement);

        const drawEdges = () => {
            const bounds = canvas.getBoundingClientRect();
            const width = Math.max(canvas.scrollWidth, bounds.width);
            const height = Math.max(canvas.scrollHeight, bounds.height);
            svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
            svg.setAttribute("width", String(width));
            svg.setAttribute("height", String(height));
            svg.replaceChildren();
            successors.forEach((ids, fromId) => {
                const from = nodeElements.get(fromId);
                const targets = ids.map(id => nodeElements.get(id)).filter(Boolean);
                if (!from || !targets.length) return;
                const fromBounds = from.getBoundingClientRect();
                const x1 = fromBounds.right - bounds.left;
                const y1 = fromBounds.top + fromBounds.height / 2 - bounds.top;
                if (targets.length === 1) {
                    const targetBounds = targets[0].getBoundingClientRect();
                    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    path.classList.add("achievement-tree-edge");
                    const x2 = targetBounds.left - bounds.left;
                    const y2 = targetBounds.top + targetBounds.height / 2 - bounds.top;
                    if (Math.abs(y1 - y2) < 1) {
                        path.setAttribute("d", `M ${x1} ${y1} H ${x2}`);
                    } else {
                        const splitX = x1 + (x2 - x1) / 2;
                        path.setAttribute("d", `M ${x1} ${y1} H ${splitX} V ${y2} H ${x2}`);
                    }
                    svg.append(path);
                    return;
                }

                const targetBounds = targets.map(target => target.getBoundingClientRect());
                const targetX = targetBounds[0].left - bounds.left;
                const splitX = x1 + (targetX - x1) / 2;
                const targetYs = targetBounds.map(rect => rect.top + rect.height / 2 - bounds.top);
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.classList.add("achievement-tree-edge");
                const segments = [
                    `M ${x1} ${y1} H ${splitX}`,
                    `M ${splitX} ${Math.min(y1, ...targetYs)} V ${Math.max(y1, ...targetYs)}`
                ];
                targetBounds.forEach((rect, index) => {
                    segments.push(`M ${splitX} ${targetYs[index]} H ${rect.left - bounds.left}`);
                });
                path.setAttribute("d", segments.join(" "));
                svg.append(path);
            });
        };
        if (elements.treeViewElement?.getClientRects().length) {
            drawEdges();
        }
        window.setTimeout(() => {
            if (!elements.treeViewElement?.getClientRects().length) return;
            if (document.fonts?.status !== "loading") {
                drawEdges();
                return;
            }
            document.fonts.ready.then(() => {
                if (elements.treeViewElement?.getClientRects().length) drawEdges();
            });
        }, 0);
    }

    function setTreeMode(enabled) {
        treeMode = enabled;
        elements.treeViewElement?.closest(".panel-body")?.classList.toggle("achievement-tree-mode", enabled);
        elements.listViewElement?.classList.toggle("is-hidden", enabled);
        elements.treeTabsElement?.classList.toggle("is-hidden", !enabled);
        elements.treeViewElement?.classList.toggle("is-hidden", !enabled);
        if (elements.treeToggleElement) {
            elements.treeToggleElement.textContent = enabled ? "List view" : "Tree view";
            elements.treeToggleElement.setAttribute("aria-pressed", String(enabled));
        }
        if (enabled) {
            renderAchievementTreeTabs();
            renderAchievementTree();
        }
    }

    elements.treeToggleElement?.addEventListener("click", () => setTreeMode(!treeMode));
    elements.treeTabsElement?.addEventListener("click", event => {
        const button = event.target.closest("[data-namespace]");
        if (!button) return;
        activeTreeNamespace = button.dataset.namespace;
        renderAchievementTreeTabs();
        renderAchievementTree();
    });
    elements.treeTabsElement?.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        const tabs = [...elements.treeTabsElement.querySelectorAll("[role='tab']")];
        const currentIndex = tabs.indexOf(document.activeElement);
        if (currentIndex < 0 || !tabs.length) return;
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(currentIndex + step + tabs.length) % tabs.length];
        next.focus();
        next.click();
    });
    if (elements.treeViewElement && "ResizeObserver" in window) {
        const treeResizeObserver = new ResizeObserver(() => {
            if (treeMode && elements.treeViewElement.clientWidth && elements.treeViewElement.clientHeight) {
                renderAchievementTree();
            }
        });
        treeResizeObserver.observe(elements.treeViewElement);
    }
    let treePan = null;
    elements.treeViewElement?.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        treePan = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            scrollLeft: elements.treeViewElement.scrollLeft,
            scrollTop: elements.treeViewElement.scrollTop
        };
        elements.treeViewElement.classList.add("is-panning");
    });
    window.addEventListener("pointermove", event => {
        if (!treePan || event.pointerId !== treePan.pointerId) return;
        const deltaX = event.clientX - treePan.startX;
        const deltaY = event.clientY - treePan.startY;
        if (Math.abs(deltaX) + Math.abs(deltaY) < 3) return;
        elements.treeViewElement.scrollLeft = treePan.scrollLeft - deltaX;
        elements.treeViewElement.scrollTop = treePan.scrollTop - deltaY;
        event.preventDefault();
    }, { passive: false });
    const endTreePan = event => {
        if (!treePan || (event && event.pointerId !== treePan.pointerId)) return;
        treePan = null;
        elements.treeViewElement.classList.remove("is-panning");
    };
    window.addEventListener("pointerup", endTreePan);
    window.addEventListener("pointercancel", endTreePan);
    window.addEventListener("resize", () => {
        if (treeMode) renderAchievementTree();
    });

    function renderAll() {
        const summary = getSummary(state);
        if (elements.scoreEl) elements.scoreEl.textContent = `Points: ${summary.unlockedPoints} / ${summary.totalPoints}`;
        if (!elements.gridEl) return;
        elements.gridEl.innerHTML = "";
        const groups = new Map();
        state.achievementsMap.forEach(achievement => {
            if (!groups.has(achievement.namespace)) groups.set(achievement.namespace, []);
            groups.get(achievement.namespace).push(achievement);
        });
        const namespaceOrder = getNamespaceOrder();
        namespaceOrder.forEach(namespace => {
            const achievements = groups.get(namespace);
            if (!achievements?.length) return;

            const section = document.createElement("section");
            section.className = "achievement-namespace";
            section.setAttribute("aria-labelledby", `achievement-namespace-${namespace}`);
            const heading = document.createElement("h2");
            heading.className = "achievement-namespace-heading";
            heading.id = `achievement-namespace-${namespace}`;
            heading.textContent = `---- ${namespace} ----`;
            const groupGrid = document.createElement("div");
            groupGrid.className = "achievement-namespace-grid";

            achievements.forEach(achievement => {
                const complete = isCompleted(state, achievement.id);
                const card = document.createElement("article");
                card.className = "achievement-card" + ` rarity-${achievement.rarity}` + (complete ? " is-completed" : " is-locked") + (achievement.rarity === "secret" && !complete ? " is-secret-locked" : "");
                const banner = document.createElement("span"); banner.className = `banners banners-${achievement.rarity}`;
                const cardInner = document.createElement("div"); cardInner.className = "achievement-card-inner";
                const icon = document.createElement("div"); icon.className = "achievement-icon";
                icon.setAttribute("aria-hidden", "true");
                addAchievementSprite(icon, achievement, 30);
                const body = document.createElement("div");
                const title = document.createElement("h3"); title.className = `achievement-title rarity-${achievement.rarity}`; title.textContent = achievement.title;
                const description = document.createElement("p"); description.className = "achievement-description"; description.textContent = achievement.rarity === "secret" && !complete ? "???" : (achievement.description || "No description.");
                const points = document.createElement("span"); points.className = "achievement-pts"; points.textContent = `+${achievement.points}p`;
                const status = document.createElement("span"); status.className = "achievement-status"; status.title = complete ? "Completed" : "Locked";
                const statusIcon = document.createElement("span"); statusIcon.className = "icons_status " + (complete ? "icons_status-unlocked" : "icons_status-locked");
                status.append(statusIcon);
                const meta = document.createElement("div"); meta.className = "achievement-meta";
                meta.append(points, status);
                body.append(title, description, meta); cardInner.append(icon, body); card.append(banner, cardInner); groupGrid.append(card);
            });

            section.append(heading, groupGrid);
            elements.gridEl.append(section);
        });
        if (treeMode) {
            renderAchievementTreeTabs();
            renderAchievementTree();
        }
    }

    function renderMilestones() {
        if (!elements.milestonesGridEl) return;
        const unlockedPoints = getSummary(state).unlockedPoints;
        elements.milestonesGridEl.innerHTML = "";
        const paragonMilestones = [];
        state.milestones.forEach(milestone => {
            if (/^Paragon\s+/i.test(milestone.name)) {
                paragonMilestones.push(milestone);
                return;
            }
            const unlocked = unlockedPoints >= milestone.points;
            const chip = document.createElement("article");
            const tier = milestone.name.toLowerCase();
            chip.className = "milestone-chip " + (unlocked ? "is-unlocked" : "is-locked") + " has-medal";
            const medalWrap = document.createElement("span"); medalWrap.className = "milestone-medal";
            const medal = document.createElement("span"); medal.className = `icons_medal icons_medal-${tier}`;
            medalWrap.append(medal);
            chip.append(medalWrap);
            const name = document.createElement("p"); name.className = "milestone-name"; name.textContent = milestone.name;
            const req = document.createElement("p"); req.className = "milestone-req"; req.textContent = `${milestone.points}p`;
            const status = document.createElement("p"); status.className = "milestone-status"; status.title = unlocked ? "Reached" : "Locked";
            const statusIcon = document.createElement("span"); statusIcon.className = "icons_status " + (unlocked ? "icons_status-unlocked" : "icons_status-locked");
            status.append(statusIcon);
            chip.append(name, req, status);
            elements.milestonesGridEl.append(chip);
        });
        if (paragonMilestones.length) {
            const card = document.createElement("article");
            const hasUnlockedParagon = paragonMilestones.some(milestone => unlockedPoints >= milestone.points);
            card.className = "milestone-chip paragon-milestone-chip" + (hasUnlockedParagon ? " is-unlocked" : "");
            const heading = document.createElement("h3");
            heading.className = "milestone-name paragon-milestone-heading";
            heading.textContent = "Paragon";
            const tiers = document.createElement("div");
            tiers.className = "paragon-milestone-tiers";
            paragonMilestones.forEach((milestone, index) => {
                const unlocked = unlockedPoints >= milestone.points;
                const tier = document.createElement("div");
                tier.className = `paragon-tier ${unlocked ? "is-unlocked" : "is-locked"}`;
                const badge = document.createElement("span");
                badge.className = "paragon-badge";
                const medal = document.createElement("span");
                medal.className = `icons_medal icons_medal-paragon-${index + 1}`;
                medal.setAttribute("aria-hidden", "true");
                const number = document.createElement("span");
                number.className = "paragon-badge-number";
                number.textContent = String(index + 1);
                badge.append(medal, number);
                const details = document.createElement("span");
                details.className = "paragon-tier-details";
                const name = document.createElement("span");
                name.className = "paragon-tier-name";
                const tierName = milestone.name.match(/^Paragon\s+([IVXLCDM]+)$/i)?.[1];
                name.textContent = `${tierName || index + 1} - ${milestone.paragonName || milestone.name}`;
                const req = document.createElement("span");
                req.className = "milestone-req";
                req.textContent = `${milestone.points}p`;
                details.append(name, req);
                tier.append(badge, details);
                tiers.append(tier);
            });
            card.append(heading, tiers);
            elements.milestonesGridEl.append(card);
        }
    }

    function showPopup(titleText, subtitleText, type = "achievement") {
        if (!elements.popupContainer) return;
        const stack = elements.popupContainer;
        const hasExisting = stack.querySelectorAll(".notification:not(.notification-out)").length > 0;

        const popup = document.createElement("div");
        popup.className = `notification notification-${type} unlock-notification`;
        popup.setAttribute("role", "status");

        const icon = document.createElement("span");
        icon.className = `notification-label label-${type}`;
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
