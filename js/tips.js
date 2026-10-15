(() => {
    const TIPS_URL = "./data/tips/tips.skvwmeta";
    const DEFAULT_TIP_DELAY = 15000;
    const TIP_DISPLAY_DURATION = 12000;
    const toast = document.getElementById("tipToast");
    const bubble = toast?.querySelector(".tip-toast-bubble");
    const icon = toast?.querySelector(".tip-toast-icon");

    if (!toast || !bubble || !icon) return;

    let firstTipTimer = null;
    let repeatTipTimer = null;
    let hideTipTimer = null;

    async function loadTips() {
        const response = await fetch(TIPS_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`Could not load tips (${response.status}).`);

        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("The tips manifest must contain an array.");

        const tips = data.filter(tip => typeof tip === "string" && tip.trim());
        if (!tips.length) throw new Error("The tips manifest does not contain any usable tips.");
        return tips;
    }

    function startIconAnimation() {
        icon.classList.remove("is-animating");
        void icon.offsetWidth;
        icon.classList.add("is-animating");
    }

    function showTip(tip) {
        bubble.textContent = tip;
        toast.classList.remove("is-visible");
        void toast.offsetWidth;
        toast.classList.add("is-visible");
        startIconAnimation();

        window.clearTimeout(hideTipTimer);
        hideTipTimer = window.setTimeout(() => {
            toast.classList.remove("is-visible");
        }, Math.min(TIP_DISPLAY_DURATION, getTipDelay()));
    }

    function getTipDelay() {
        const delay = window.getAppSetting?.("tips", "delay", DEFAULT_TIP_DELAY);
        return Number.isFinite(delay) && delay > 0 ? delay : DEFAULT_TIP_DELAY;
    }

    function shuffleTips(tips, avoidFirst) {
        const shuffled = [...tips];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        if (shuffled.length > 1 && shuffled[0] === avoidFirst) {
            const swapIndex = shuffled.findIndex(tip => tip !== avoidFirst);
            if (swapIndex > 0) {
                [shuffled[0], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[0]];
            }
        }
        return shuffled;
    }

    loadTips()
        .then(async tips => {
            await window.settingsReady;
            let shuffledTips = shuffleTips(tips);
            let nextTip = 0;
            let previousTip = null;
            const giveTip = () => {
                if (nextTip === shuffledTips.length) {
                    shuffledTips = shuffleTips(tips, previousTip);
                    nextTip = 0;
                }
                previousTip = shuffledTips[nextTip];
                showTip(previousTip);
                nextTip++;
            };

            const scheduleTips = () => {
                window.clearTimeout(firstTipTimer);
                window.clearInterval(repeatTipTimer);
                const delay = getTipDelay();
                firstTipTimer = window.setTimeout(() => {
                    giveTip();
                    repeatTipTimer = window.setInterval(giveTip, delay);
                }, delay);
            };

            window.addEventListener("app-setting-changed", event => {
                if (event.detail?.section === "tips" && event.detail?.key === "delay") {
                    scheduleTips();
                }
            });
            scheduleTips();
        })
        .catch(error => {
            console.error("Could not start tip rotation.", error);
        });
})();