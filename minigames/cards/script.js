const gameChoices = [...document.querySelectorAll("[data-game-choice]")];
const blackjackView = document.getElementById("blackjackGame");
const douDizhuView = document.getElementById("doudizhuGame");
const newGameButton = document.getElementById("newGameBtn");
const analysisPanel = document.getElementById("analysisPanel");
const analyzePositionButton = document.getElementById("analyzePositionBtn");
const reviewGameButton = document.getElementById("reviewGameBtn");
const analysisSummary = document.getElementById("analysisSummary");
const analysisMoves = document.getElementById("analysisMoves");
const ownHand = document.getElementById("ownHand");
const handScrollbar = document.getElementById("handScrollbar");
const handScrollbarThumb = document.getElementById("handScrollbarThumb");
const rankNames = {
  1: "A", 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "SJ", 17: "BJ"
};
let selectedGame = "blackjack";
let cardSerial = 0;
let blackjack = null;
let douDizhu = null;
let turnTimer = null;
let impactTimer = null;
let analysisWorker = null;
let analysisRequestId = 0;
let analysisCleanup = null;
let handScrollbarDrag = null;

function recordCardGameAchievement(game, eventName, details = {}) {
  try {
    const parentAchievements = window.parent?.achievements;
    if (parentAchievements?.recordGameEvent) {
      parentAchievements.recordGameEvent(game, eventName, details).catch(error => {
        console.error(`Could not record ${game} achievement event.`, error);
      });
    } else {
      console.warn(`Achievement tracker unavailable for ${game}.${eventName}.`);
    }
  } catch (error) {
    console.error(`Could not access the parent achievement tracker for ${game}.${eventName}.`, error);
  }
}

function syncHandScrollbar() {
  const visibleWidth = ownHand.clientWidth;
  const contentWidth = ownHand.scrollWidth;
  const trackWidth = handScrollbar.clientWidth;
  const hasOverflow = contentWidth > visibleWidth;
  const thumbWidth = hasOverflow
    ? Math.max(36, trackWidth * visibleWidth / contentWidth)
    : trackWidth;
  const thumbTravel = Math.max(trackWidth - thumbWidth, 0);
  const scrollProgress = hasOverflow
    ? ownHand.scrollLeft / (contentWidth - visibleWidth)
    : 0;
  handScrollbarThumb.style.width = `${thumbWidth}px`;
  handScrollbarThumb.style.transform = `translateX(${thumbTravel * scrollProgress}px)`;
  handScrollbar.setAttribute("aria-valuenow", String(Math.round(scrollProgress * 100)));
  handScrollbar.setAttribute("aria-valuetext", hasOverflow
    ? `${Math.round(scrollProgress * 100)} percent through hand`
    : "All hand cards visible");
}

function setHandScrollFromPointer(clientX, thumbOffset = null) {
  const rect = handScrollbar.getBoundingClientRect();
  const thumbWidth = handScrollbarThumb.getBoundingClientRect().width;
  const travel = Math.max(rect.width - thumbWidth, 0);
  const position = thumbOffset === null
    ? clientX - rect.left - thumbWidth / 2
    : clientX - rect.left - thumbOffset;
  const progress = travel ? Math.max(0, Math.min(position / travel, 1)) : 0;
  ownHand.scrollLeft = progress * Math.max(ownHand.scrollWidth - ownHand.clientWidth, 0);
  syncHandScrollbar();
}

function scrollHandByKeyboard(event) {
  const scrollAmount = Math.max(ownHand.clientWidth * 0.2, 40);
  if (event.key === "ArrowLeft") ownHand.scrollLeft -= scrollAmount;
  else if (event.key === "ArrowRight") ownHand.scrollLeft += scrollAmount;
  else if (event.key === "Home") ownHand.scrollLeft = 0;
  else if (event.key === "End") ownHand.scrollLeft = ownHand.scrollWidth;
  else return;
  event.preventDefault();
  syncHandScrollbar();
}

function resetAnalysis() {
  analysisRequestId += 1;
  analysisCleanup?.();
  analysisCleanup = null;
  analysisPanel.hidden = true;
  analysisSummary.textContent = "";
  analysisMoves.replaceChildren();
  analyzePositionButton.disabled = false;
  analyzePositionButton.textContent = "Analyze position";
}

function getAnalysisWorker() {
  if (!analysisWorker) {
    if (window.location.protocol === "file:") {
      throw new Error("Move analysis needs the game opened from an HTTP(S) server or hosted site.");
    }
    analysisWorker = new Worker("./analysis-worker.js", { type: "module" });
    analysisWorker.addEventListener("error", event => {
      analysisCleanup?.();
      analysisCleanup = null;
      analysisPanel.hidden = false;
      analysisSummary.textContent = `Analysis engine failed to load: ${event.message || "worker error"}`;
      analyzePositionButton.disabled = false;
      analyzePositionButton.textContent = "Retry analysis";
      analysisWorker?.terminate();
      analysisWorker = null;
    });
  }
  return analysisWorker;
}

function formatAnalysisCards(ranks) {
  if (!ranks) return "Pass";
  const counts = new Map();
  ranks.forEach(rank => counts.set(rank, (counts.get(rank) || 0) + 1));
  return [...counts.entries()]
    .sort(([rankA], [rankB]) => rankA - rankB)
    .map(([rank, count]) => `${cardLabel(rank)}${count > 1 ? ` ×${count}` : ""}`)
    .join(" · ");
}

function analyzeCurrentPosition() {
  if (douDizhu?.stage !== "playing" || douDizhu.currentPlayer !== 0) return;

  const id = ++analysisRequestId;
  const hand = douDizhu.players[0].hand.map(card => card.rank);
  const trickCards = douDizhu.currentTrick?.cards.map(card => card.rank) || null;
  const context = {
    seat: 0,
    landlord: douDizhu.landlord,
    lastPlayer: douDizhu.currentTrick?.player ?? null,
    handSizes: douDizhu.players.map(player => player.hand.length),
    playedCounts: douDizhu.playedCounts.slice(),
    passCount: douDizhu.passes
  };

  analysisPanel.hidden = false;
  analysisSummary.textContent = "ranking moves…";
  analysisMoves.replaceChildren();
  analyzePositionButton.disabled = true;
  analyzePositionButton.textContent = "analysing…";

  try {
    const worker = getAnalysisWorker();
    const handleResult = event => {
      if (event.data?.id !== id) return;
      worker.removeEventListener("message", handleResult);
      if (analysisCleanup) analysisCleanup = null;
      analyzePositionButton.disabled = false;
      analyzePositionButton.textContent = "analyse again";
      if (event.data.error) {
        analysisSummary.textContent = `analysis failed: ${event.data.error}`;
        return;
      }
      recordCardGameAchievement("dou-dizhu", "analyzed");

      const candidates = event.data.candidates
        .filter(candidate => {
          if (candidate.ranks === null) return Boolean(douDizhu.currentTrick);
          const combo = classifyCombination(candidate.ranks.map(rank => ({ rank })));
          return combo && (!douDizhu.currentTrick || beats(combo, douDizhu.currentTrick.combo));
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (!candidates.length) {
        analysisSummary.textContent = "The analysis engine found no moves compatible with this game position.";
        return;
      }

      analysisSummary.textContent = `Top ${candidates.length} suggested moves · ${event.data.elapsedMs} ms · engine score (not win probability)`;
      candidates.forEach((candidate, index) => {
        const item = document.createElement("li");
        item.className = `analysis-move${index === 0 ? " is-best" : ""}`;
        const label = document.createElement("span");
        label.className = "analysis-move-label";
        label.textContent = `${index === 0 ? "Recommended" : `Option ${index + 1}`} · ${formatAnalysisCards(candidate.ranks)}`;
        const score = document.createElement("span");
        score.className = "analysis-move-score";
        score.textContent = `Score ${candidate.score >= 0 ? "+" : ""}${candidate.score}`;
        const detail = document.createElement("span");
        detail.className = "analysis-move-detail";
        detail.textContent = candidate.meta?.teammatePass
          ? "Pass keeps your teammate's lead."
          : `${candidate.meta?.handsAfter ?? "?"} estimated hand${candidate.meta?.handsAfter === 1 ? "" : "s"} left after this play${candidate.meta?.remembered ? " · tracking suggests opponents cannot beat it" : ""}${candidate.meta?.bomb ? " · spends a bomb" : ""}`;
        item.append(label, score, detail);
        analysisMoves.appendChild(item);
      });
    };
    worker.addEventListener("message", handleResult);
    analysisCleanup = () => worker.removeEventListener("message", handleResult);
    worker.postMessage({ id, handRanks: hand, lastPlayRanks: trickCards, context });
  } catch (error) {
    analysisSummary.textContent = `Analysis could not start: ${error instanceof Error ? error.message : String(error)}`;
    analyzePositionButton.disabled = false;
    analyzePositionButton.textContent = "Retry analysis";
  }
}

function requestMoveAnalysis(snapshot) {
  const id = ++analysisRequestId;
  const worker = getAnalysisWorker();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", handleResult);
      worker.removeEventListener("error", handleError);
    };
    const handleResult = event => {
      if (event.data?.id !== id) return;
      cleanup();
      resolve(event.data);
    };
    const handleError = event => {
      cleanup();
      reject(new Error(event.message || "Analysis worker failed."));
    };
    worker.addEventListener("message", handleResult);
    worker.addEventListener("error", handleError);
    worker.postMessage({ id, ...snapshot });
  });
}

async function analyzeCompletedGame() {
  if (douDizhu?.stage !== "finished" || !douDizhu.humanTurnReviews.length) return;
  const reviewedGame = douDizhu;
  const reviews = reviewedGame.humanTurnReviews;
  analysisPanel.hidden = false;
  analysisMoves.replaceChildren();
  analyzePositionButton.hidden = true;
  reviewGameButton.disabled = true;
  reviewGameButton.textContent = "analyzing game…";
  analysisSummary.textContent = `reviewing ${reviews.length} of your turns…`;

  try {
    for (const [index, review] of reviews.entries()) {
      const result = await requestMoveAnalysis({
        handRanks: review.handRanks,
        lastPlayRanks: review.lastPlayRanks,
        context: review.context
      });
      if (douDizhu !== reviewedGame) return;
      if (result.error) throw new Error(result.error);
      const lastCombo = review.lastPlayRanks
        ? classifyCombination(review.lastPlayRanks.map(rank => ({ rank })))
        : null;
      const candidates = result.candidates
        .filter(candidate => {
          if (candidate.ranks === null) return Boolean(lastCombo);
          const combo = classifyCombination(candidate.ranks.map(rank => ({ rank })));
          return combo && (!lastCombo || beats(combo, lastCombo));
        })
        .sort((a, b) => b.score - a.score);
      const bestMove = candidates[0] || null;
      const actualCombo = review.actualRanks
        ? classifyCombination(review.actualRanks.map(rank => ({ rank })))
        : null;
      const actualCandidate = candidates.find(candidate => {
        if (review.actualRanks === null) return candidate.ranks === null;
        if (candidate.ranks === null) return false;
        const combo = classifyCombination(candidate.ranks.map(rank => ({ rank })));
        return combo && actualCombo && combo.type === actualCombo.type
          && combo.high === actualCombo.high && combo.length === actualCombo.length;
      }) || null;
      const scoreLoss = bestMove && actualCandidate
        ? Math.max(0, bestMove.score - actualCandidate.score)
        : null;
      const bestMoveLead = bestMove && candidates[1]
        ? bestMove.score - candidates[1].score
        : 0;
      const quality = scoreLoss === null ? "Unknown"
        : scoreLoss === 0 && bestMoveLead >= 200 ? "Great"
          : scoreLoss <= 50 ? "Best"
            : scoreLoss <= 300 ? "Inaccuracy"
              : "Blunder";
      const actualMove = formatAnalysisCards(review.actualRanks);
      const recommendedMove = bestMove ? formatAnalysisCards(bestMove.ranks) : "No recommendation";
      const item = document.createElement("li");
      item.className = `analysis-move${quality === "Great" || quality === "Best" ? " is-best" : ""}`;
      const label = document.createElement("span");
      label.className = "analysis-move-label";
      label.textContent = `Turn ${index + 1} · You played ${actualMove}`;
      const qualityBadge = document.createElement("span");
      qualityBadge.className = `analysis-quality quality-${quality.toLowerCase()}`;
      qualityBadge.setAttribute("aria-label", `Move quality: ${quality}`);
      const qualityIcon = document.createElement("span");
      qualityIcon.className = `quality-icon ${({
        Great: "label-info",
        Best: "label-success",
        Inaccuracy: "label-warn",
        Blunder: "label-error"
      })[quality] || ""}`;
      qualityIcon.setAttribute("aria-hidden", "true");
      qualityBadge.append(qualityIcon, document.createTextNode(
        scoreLoss === null ? quality : `${quality} ${scoreLoss === 0 ? "+0" : `−${scoreLoss}`}`
      ));
      const detail = document.createElement("span");
      detail.className = "analysis-move-detail";
      detail.textContent = bestMove
        ? `Engine's top choice: ${recommendedMove} · score ${bestMove.score >= 0 ? "+" : ""}${bestMove.score}${bestMove.meta?.bomb ? " · spends a bomb" : ""}`
        : "The engine did not return a compatible move for this position.";
      item.append(label, qualityBadge, detail);
      analysisMoves.appendChild(item);
      analysisSummary.textContent = `Reviewed ${index + 1} of ${reviews.length} turns`;
    }
    recordCardGameAchievement("dou-dizhu", "analyzed");
    reviewGameButton.textContent = "Analyze again";
  } catch (error) {
    if (douDizhu !== reviewedGame) return;
    analysisSummary.textContent = `Game analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    reviewGameButton.textContent = "Retry game analysis";
  } finally {
    if (douDizhu === reviewedGame) reviewGameButton.disabled = false;
  }
}

function recordHumanTurn(actualRanks) {
  douDizhu.humanTurnReviews.push({
    handRanks: douDizhu.players[0].hand.map(card => card.rank),
    lastPlayRanks: douDizhu.currentTrick?.cards.map(card => card.rank) || null,
    actualRanks,
    context: {
      seat: 0,
      landlord: douDizhu.landlord,
      lastPlayer: douDizhu.currentTrick?.player ?? null,
      handSizes: douDizhu.players.map(player => player.hand.length),
      playedCounts: douDizhu.playedCounts.slice(),
      passCount: douDizhu.passes
    }
  });
}

function triggerDouDizhuImpact(type) {
  const gameView = douDizhuView;
  window.clearTimeout(impactTimer);
  gameView.classList.remove("impact-frame", "impact-bomb", "impact-joker", "impact-two", "impact-nuke");
  void gameView.offsetWidth;
  gameView.classList.add("impact-frame", `impact-${type}`);
  impactTimer = window.setTimeout(() => {
    gameView.classList.remove("impact-frame", `impact-${type}`);
  }, 720);
}

function shuffle(cards) {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
  return cards;
}

function makeCard(rank, red = false) {
  return { id: `card-${++cardSerial}`, rank, red };
}

function cardLabel(rank) {
  return rankNames[rank] || String(rank);
}

function createCardElement(card, { hidden = false, selected = false, selectable = false } = {}) {
  const element = selectable ? document.createElement("button") : document.createElement("span");
  const colorClass = card?.red ? " card-red" : "";
  const jokerClass = !hidden && card && (card.rank === 16 || card.rank === 17) ? " card-joker" : "";
  element.className = `playing-card ${hidden ? "back" : "face"}${colorClass}${jokerClass}${selected ? " card-selected" : ""}`;
  if (selectable) {
    element.type = "button";
    element.dataset.cardId = card.id;
    element.setAttribute("aria-pressed", String(selected));
    element.setAttribute("aria-label", selected ? `Selected ${cardLabel(card.rank)}` : `Select ${cardLabel(card.rank)}`);
  } else {
    element.setAttribute("aria-hidden", "true");
  }
  if (!hidden && !jokerClass) {
    const value = document.createElement("span");
    value.className = "card-value";
    value.textContent = cardLabel(card.rank);
    element.appendChild(value);
  }
  return element;
}

function setGame(game) {
  selectedGame = game;
  resetAnalysis();
  gameChoices.forEach(button => {
    const selected = button.dataset.gameChoice === game;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  blackjackView.hidden = game !== "blackjack";
  douDizhuView.hidden = game !== "doudizhu";
  newGame();
}

function newGame() {
  window.clearTimeout(turnTimer);
  window.clearTimeout(impactTimer);
  douDizhuView.classList.remove("impact-frame", "impact-bomb", "impact-joker", "impact-two", "impact-nuke");
  if (selectedGame === "blackjack") startBlackjack();
  else startDouDizhu();
}

function createBlackjackDeck() {
  const deck = [];
  for (let rank = 1; rank <= 13; rank += 1) {
    for (let copy = 0; copy < 4; copy += 1) deck.push(makeCard(rank, copy % 2 === 1));
  }
  return shuffle(deck);
}

function blackjackScore(hand) {
  let score = 0;
  let aces = 0;
  hand.forEach(card => {
    if (card.rank === 1) {
      score += 11;
      aces += 1;
    } else {
      score += Math.min(card.rank, 10);
    }
  });
  while (score > 21 && aces > 0) {
    score -= 10;
    aces -= 1;
  }
  return score;
}

function startBlackjack() {
  blackjack = { deck: createBlackjackDeck(), player: [], dealer: [], status: "playing", revealed: false, roundRecorded: false };
  blackjack.player.push(blackjack.deck.pop(), blackjack.deck.pop());
  blackjack.dealer.push(blackjack.deck.pop(), blackjack.deck.pop());
  const playerNatural = blackjackScore(blackjack.player) === 21;
  const dealerNatural = blackjackScore(blackjack.dealer) === 21;
  if (playerNatural || dealerNatural) {
    blackjack.revealed = true;
    blackjack.status = playerNatural && dealerNatural ? "push" : playerNatural ? "blackjack" : "dealer-blackjack";
  }
  renderBlackjack();
  if (blackjack.status !== "playing") recordBlackjackRound();
}

function recordBlackjackRound() {
  if (!blackjack || blackjack.roundRecorded || blackjack.status === "playing") return;
  blackjack.roundRecorded = true;
  recordCardGameAchievement("blackjack", "round-completed", {
    status: blackjack.status,
    playerCards: blackjack.player.length,
    natural: blackjack.status === "blackjack"
  });
}

function renderBlackjack() {
  if (!blackjack) return;
  const dealerHand = document.getElementById("dealerHand");
  const playerHand = document.getElementById("playerHand");
  dealerHand.replaceChildren();
  playerHand.replaceChildren();

  blackjack.dealer.forEach((card, index) => {
    const hidden = index === 1 && !blackjack.revealed;
    dealerHand.appendChild(createCardElement(card, { hidden }));
  });
  blackjack.player.forEach(card => playerHand.appendChild(createCardElement(card)));

  const playerScore = blackjackScore(blackjack.player);
  const dealerScore = blackjack.revealed ? blackjackScore(blackjack.dealer) : blackjackScore([blackjack.dealer[0]]);
  document.getElementById("playerScore").textContent = String(playerScore);
  document.getElementById("dealerScore").textContent = blackjack.revealed ? String(dealerScore) : `${dealerScore} + ?`;

  const results = {
    playing: "play",
    win: "you win",
    lose: "dealer wins",
    push: "push",
    blackjack: "blackjack!",
    "dealer-blackjack": "dealer blackjack",
    bust: "bust!"
  };
  document.getElementById("blackjackResult").textContent = results[blackjack.status];
  document.getElementById("hitBtn").disabled = blackjack.status !== "playing";
  document.getElementById("standBtn").disabled = blackjack.status !== "playing";
}

function hitBlackjack() {
  if (blackjack?.status !== "playing") return;
  blackjack.player.push(blackjack.deck.pop());
  if (blackjackScore(blackjack.player) > 21) {
    blackjack.status = "bust";
    blackjack.revealed = true;
  }
  renderBlackjack();
  recordBlackjackRound();
}

function standBlackjack() {
  if (blackjack?.status !== "playing") return;
  blackjack.revealed = true;
  while (blackjackScore(blackjack.dealer) < 17) blackjack.dealer.push(blackjack.deck.pop());
  const playerScore = blackjackScore(blackjack.player);
  const dealerScore = blackjackScore(blackjack.dealer);
  blackjack.status = dealerScore > 21 || playerScore > dealerScore ? "win"
    : playerScore < dealerScore ? "lose" : "push";
  renderBlackjack();
  recordBlackjackRound();
}

const doudizhuRanks = Array.from({ length: 13 }, (_, index) => index + 3);

function createDouDizhuDeck() {
  const deck = [];
  doudizhuRanks.forEach(rank => {
    for (let copy = 0; copy < 4; copy += 1) deck.push(makeCard(rank, copy % 2 === 1));
  });
  deck.push(makeCard(16), makeCard(17, true));
  return shuffle(deck);
}

function sortedHand(hand) {
  return [...hand].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

function startDouDizhu() {
  resetAnalysis();
  douDizhu = {
    players: [
      { name: "You", isHuman: true, hand: [] },
      { name: "Left bot", isHuman: false, hand: [] },
      { name: "Right bot", isHuman: false, hand: [] }
    ],
    stage: "bidding",
    bidTurn: Math.floor(Math.random() * 3),
    bidsMade: 0,
    highestBid: 0,
    landlord: null,
    bottom: [],
    currentPlayer: null,
    currentTrick: null,
    passes: 0,
    playedCounts: Array(15).fill(0),
    humanTurnReviews: [],
    selected: new Set(),
    status: "choosing landlord"
  };
  const deck = createDouDizhuDeck();
  douDizhu.players.forEach(player => {
    player.hand = deck.splice(0, 17);
  });
  douDizhu.bottom = deck;
  renderDouDizhu();
  scheduleBotTurn();
}

function groupByRank(cards) {
  const groups = new Map();
  cards.forEach(card => {
    if (!groups.has(card.rank)) groups.set(card.rank, []);
    groups.get(card.rank).push(card);
  });
  return groups;
}

function consecutiveRanks(ranks) {
  return ranks.every((rank, index) => index === 0 || rank === ranks[index - 1] + 1);
}

function classifyCombination(cards) {
  if (!cards.length) return null;
  const groups = groupByRank(cards);
  const ranks = [...groups.keys()].sort((a, b) => a - b);
  const counts = ranks.map(rank => groups.get(rank).length);
  const size = cards.length;
  const singleRank = ranks.length === 1 ? ranks[0] : 0;
  if (size === 2 && ranks.length === 2 && ranks[0] === 16 && ranks[1] === 17) {
    return { type: "rocket", high: 17, length: 1 };
  }
  if (ranks.length === 1) {
    if (size === 1) return { type: "single", high: singleRank, length: 1 };
    if (size === 2) return { type: "pair", high: singleRank, length: 1 };
    if (size === 3) return { type: "triple", high: singleRank, length: 1 };
    if (size === 4) return { type: "bomb", high: singleRank, length: 1 };
  }
  if (counts.every(count => count === 1) && size >= 5 && ranks.at(-1) <= 14 && consecutiveRanks(ranks)) {
    return { type: "straight", high: ranks.at(-1), length: size };
  }
  if (counts.every(count => count === 2) && size >= 6 && ranks.at(-1) <= 14 && consecutiveRanks(ranks)) {
    return { type: "pair-sequence", high: ranks.at(-1), length: ranks.length };
  }
  if (counts.every(count => count === 3) && size >= 6 && ranks.at(-1) <= 14 && consecutiveRanks(ranks)) {
    return { type: "triple-sequence", high: ranks.at(-1), length: ranks.length };
  }
  if (size === 4 && counts.includes(3)) {
    return { type: "triple-single", high: ranks[counts.indexOf(3)], length: 1 };
  }
  if (size === 5 && counts.includes(3) && counts.includes(2)) {
    return { type: "triple-pair", high: ranks[counts.indexOf(3)], length: 1 };
  }
  if (size === 6 && counts.includes(4)) {
    const quadRank = ranks[counts.indexOf(4)];
    const wings = cards.filter(card => card.rank !== quadRank);
    if (wings.length === 2) {
      return { type: "four-two-singles", high: ranks[counts.indexOf(4)], length: 1 };
    }
  }
  if (size === 8 && counts.includes(4)) {
    const wings = counts.filter(count => count !== 4);
    if (wings.length === 2 && wings.every(count => count === 2)) {
      return { type: "four-two-pairs", high: ranks[counts.indexOf(4)], length: 1 };
    }
  }

  const maxCoreLength = Math.floor(size / 4);
  for (let coreLength = 2; coreLength <= maxCoreLength; coreLength += 1) {
    for (let start = 0; start + coreLength <= ranks.length; start += 1) {
      const core = ranks.slice(start, start + coreLength);
      if (core.at(-1) > 14 || !consecutiveRanks(core) || !core.every(rank => (groups.get(rank)?.length ?? 0) >= 3)) continue;
      const remaining = new Map(groups);
      core.forEach(rank => remaining.set(rank, remaining.get(rank).slice(3)));
      const wings = [...remaining.values()].flat();
      if (size === coreLength * 4 && wings.length === coreLength && groupByRank(wings).size === coreLength) {
        return { type: "airplane-singles", high: core.at(-1), length: coreLength };
      }
      if (
        size === coreLength * 5 &&
        wings.length === coreLength * 2 &&
        [...groupByRank(wings).values()].length === coreLength &&
        [...groupByRank(wings).values()].every(group => group.length === 2)
      ) {
        return { type: "airplane-pairs", high: core.at(-1), length: coreLength };
      }
    }
  }
  return null;
}

function beats(candidate, current) {
  if (!candidate || !current) return false;
  if (candidate.type === "rocket") return current.type !== "rocket";
  if (current.type === "rocket") return false;
  if (candidate.type === "bomb") return current.type !== "bomb" || candidate.high > current.high;
  if (current.type === "bomb") return false;
  return candidate.type === current.type
    && candidate.length === current.length
    && candidate.high > current.high;
}

function takeRankCards(groups, rank, count) {
  return (groups.get(rank) || []).slice(0, count);
}

function generateBotCandidates(hand) {
  const groups = groupByRank(sortedHand(hand));
  const ranks = [...groups.keys()].sort((a, b) => a - b);
  const candidates = [];
  const add = cards => {
    const combo = classifyCombination(cards);
    if (combo) candidates.push({ cards, combo });
  };

  ranks.forEach(rank => {
    const group = groups.get(rank);
    add(group.slice(0, 1));
    if (group.length >= 2) add(group.slice(0, 2));
    if (group.length >= 3) add(group.slice(0, 3));
    if (group.length === 4) add(group);
  });
  if (groups.has(16) && groups.has(17)) add([groups.get(16)[0], groups.get(17)[0]]);

  ranks.filter(rank => groups.get(rank).length >= 3).forEach(rank => {
    const triple = takeRankCards(groups, rank, 3);
    ranks.filter(wing => wing !== rank).forEach(wing => {
      add([...triple, groups.get(wing)[0]]);
      if (groups.get(wing).length >= 2) add([...triple, ...takeRankCards(groups, wing, 2)]);
    });
  });

  ranks.filter(rank => groups.get(rank).length === 4).forEach(rank => {
    const quad = groups.get(rank);
    const otherRanks = ranks.filter(wing => wing !== rank);
    for (let first = 0; first < otherRanks.length; first += 1) {
      for (let second = first + 1; second < otherRanks.length; second += 1) {
        add([...quad, groups.get(otherRanks[first])[0], groups.get(otherRanks[second])[0]]);
      }
    }
    const pairRanks = otherRanks.filter(wing => groups.get(wing).length >= 2);
    for (let first = 0; first < pairRanks.length; first += 1) {
      for (let second = first + 1; second < pairRanks.length; second += 1) {
        add([...quad, ...takeRankCards(groups, pairRanks[first], 2), ...takeRankCards(groups, pairRanks[second], 2)]);
      }
    }
  });

  const addSequences = (minimumLength, copies, type) => {
    const eligible = ranks.filter(rank => rank <= 14 && groups.get(rank).length >= copies);
    for (let start = 0; start < eligible.length; start += 1) {
      for (let end = start + minimumLength; end <= eligible.length; end += 1) {
        const sequence = eligible.slice(start, end);
        if (!consecutiveRanks(sequence)) break;
        add(sequence.flatMap(rank => takeRankCards(groups, rank, copies)));
        if (type === "triple-sequence") {
          const core = sequence.flatMap(rank => takeRankCards(groups, rank, 3));
          const outsideByRank = [...groups.entries()]
            .filter(([rank]) => !sequence.includes(rank))
            .flatMap(([, group]) => group);
          const singleWings = [];
          const usedWingRanks = new Set();
          for (const card of outsideByRank) {
            if (usedWingRanks.has(card.rank)) continue;
            usedWingRanks.add(card.rank);
            singleWings.push(card);
            if (singleWings.length === sequence.length) break;
          }
          if (singleWings.length === sequence.length) add([...core, ...singleWings]);

          const pairWings = [...groups.entries()]
            .filter(([rank, group]) => !sequence.includes(rank) && group.length >= 2)
            .slice(0, sequence.length)
            .flatMap(([rank]) => takeRankCards(groups, rank, 2));
          if (pairWings.length === sequence.length * 2) add([...core, ...pairWings]);
        }
      }
    }
  };
  addSequences(5, 1, "straight");
  addSequences(3, 2, "pair-sequence");
  addSequences(2, 3, "triple-sequence");

  const seen = new Set();
  return candidates.filter(candidate => {
    const signature = `${candidate.combo.type}:${candidate.combo.high}:${candidate.combo.length}:${candidate.cards.map(card => card.id).sort().join(",")}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function bidStrength(hand) {
  const counts = groupByRank(hand);
  return hand.reduce((score, card) => score
    + (card.rank === 17 ? 3 : card.rank === 16 ? 2 : card.rank === 15 ? 1.5 : card.rank === 14 ? 0.9 : 0), 0)
    + [...counts.values()].reduce((score, group) => score + (group.length === 4 ? 1.6 : group.length === 3 ? 0.6 : 0), 0);
}

function botBid(player) {
  const strength = bidStrength(douDizhu.players[player].hand);
  const target = strength >= 5.2 ? 3 : strength >= 3.7 ? 2 : strength >= 2.2 ? 1 : 0;
  return target > douDizhu.highestBid ? target : 0;
}

function takeBid(player, bid) {
  if (douDizhu.stage !== "bidding" || player !== douDizhu.bidTurn) return;
  douDizhu.bidsMade += 1;
  if (bid > douDizhu.highestBid) {
    douDizhu.highestBid = bid;
    douDizhu.landlord = player;
    douDizhu.passesAfterBid = 0;
    douDizhu.status = `${douDizhu.players[player].name} bid ${bid}.`;
  } else if (douDizhu.landlord !== null) {
    douDizhu.passesAfterBid = (douDizhu.passesAfterBid || 0) + 1;
    douDizhu.status = `${douDizhu.players[player].name} passed.`;
  } else {
    douDizhu.status = `${douDizhu.players[player].name} passed.`;
  }

  if (bid === 3 || (douDizhu.landlord !== null && douDizhu.passesAfterBid >= 2)) {
    beginDouDizhuPlay();
    return;
  }
  if (douDizhu.bidsMade >= 3 && douDizhu.landlord === null) {
    douDizhu.stage = "dealing";
    douDizhu.status = "everyone passed…";
    renderDouDizhu();
    turnTimer = window.setTimeout(startDouDizhu, 900);
    return;
  }
  douDizhu.bidTurn = (player + 1) % 3;
  renderDouDizhu();
  scheduleBotTurn();
}

function beginDouDizhuPlay() {
  const landlord = douDizhu.landlord ?? 0;
  douDizhu.stage = "playing";
  douDizhu.players[landlord].hand.push(...douDizhu.bottom);
  douDizhu.players.forEach(player => {
    player.hand = sortedHand(player.hand);
  });
  douDizhu.currentPlayer = landlord;
  douDizhu.status = `${douDizhu.players[landlord].name} is landlord and leads.`;
  renderDouDizhu();
  scheduleBotTurn();
}

function selectDouDizhuCard(cardId) {
  if (douDizhu?.stage !== "playing" || douDizhu.currentPlayer !== 0) return;
  if (douDizhu.selected.has(cardId)) douDizhu.selected.delete(cardId);
  else douDizhu.selected.add(cardId);
  renderDouDizhu();
}

function playDouDizhuCards(playerIndex, cards) {
  const player = douDizhu.players[playerIndex];
  const combo = classifyCombination(cards);
  if (!combo) {
    if (playerIndex === 0) {
      douDizhu.status = "you can't combo these cards";
      renderDouDizhu();
    }
    return false;
  }
  if (douDizhu.currentTrick && !beats(combo, douDizhu.currentTrick.combo)) {
    if (playerIndex === 0) {
      douDizhu.status = "you can't play these cards";
      renderDouDizhu();
    }
    return false;
  }

  const ids = new Set(cards.map(card => card.id));
  if (playerIndex === 0) recordHumanTurn(cards.map(card => card.rank).sort((a, b) => a - b));
  player.hand = player.hand.filter(card => !ids.has(card.id));
  cards.forEach(card => {
    douDizhu.playedCounts[card.rank - 3] += 1;
  });
  if (playerIndex === 0) {
    const playedTwo = cards.some(card => card.rank === 15);
    const playedJoker = cards.some(card => card.rank === 16 || card.rank === 17);
    if (combo.type === "bomb" || combo.type === "rocket" || playedTwo || playedJoker) {
      recordCardGameAchievement("dou-dizhu", "special-played", {
        bomb: combo.type === "bomb",
        rocket: combo.type === "rocket",
        playedTwo,
        playedJoker
      });
    }
  }
  resetAnalysis();
  douDizhu.currentTrick = { cards, combo, player: playerIndex };
  douDizhu.lastPlayer = playerIndex;
  douDizhu.passes = 0;
  douDizhu.selected.clear();
  douDizhu.status = `${player.name} played ${comboName(combo)}.`;
  if (player.hand.length === 0) {
    douDizhu.stage = "finished";
    const landlordWon = playerIndex === douDizhu.landlord;
    douDizhu.status = landlordWon ? "Landlord wins!" : "Farmers win!";
    recordCardGameAchievement("dou-dizhu", "round-completed", {
      won: playerIndex === 0,
      humanWasLandlord: douDizhu.landlord === 0,
      winnerWasLandlord: landlordWon
    });
  } else {
    douDizhu.currentPlayer = (playerIndex + 1) % 3;
  }
  if (combo.type === "rocket") triggerDouDizhuImpact("nuke");
  else if (combo.type === "bomb") triggerDouDizhuImpact("bomb");
  else if (cards.some(card => card.rank === 16 || card.rank === 17)) triggerDouDizhuImpact("joker");
  else if (cards.some(card => card.rank === 15)) triggerDouDizhuImpact("two");
  renderDouDizhu();
  if (douDizhu.stage === "playing") scheduleBotTurn();
  return true;
}

function passDouDizhu(playerIndex) {
  if (douDizhu.currentTrick === null || playerIndex !== douDizhu.currentPlayer) return;
  if (playerIndex === 0) recordHumanTurn(null);
  resetAnalysis();
  douDizhu.passes += 1;
  douDizhu.status = `${douDizhu.players[playerIndex].name} passed.`;
  if (douDizhu.passes >= 2) {
    douDizhu.currentPlayer = douDizhu.lastPlayer;
    douDizhu.currentTrick = null;
    douDizhu.passes = 0;
    douDizhu.status = `${douDizhu.players[douDizhu.currentPlayer].name} leads the next trick.`;
  } else {
    douDizhu.currentPlayer = (playerIndex + 1) % 3;
  }
  renderDouDizhu();
  scheduleBotTurn();
}

function sameTeam(playerA, playerB) {
  return (playerA === douDizhu.landlord) === (playerB === douDizhu.landlord);
}

function botPlay(playerIndex) {
  const player = douDizhu.players[playerIndex];
  const candidates = generateBotCandidates(player.hand);
  if (douDizhu.currentTrick) {
    const lastCards = douDizhu.players[douDizhu.currentTrick.player].hand.length;
    if (sameTeam(playerIndex, douDizhu.currentTrick.player) && lastCards > 1) {
      passDouDizhu(playerIndex);
      return;
    }
    const response = candidates
      .filter(candidate => beats(candidate.combo, douDizhu.currentTrick.combo))
      .sort((a, b) => a.cards.length - b.cards.length || a.combo.high - b.combo.high)[0];
    if (!response) {
      passDouDizhu(playerIndex);
      return;
    }
    playDouDizhuCards(playerIndex, response.cards);
    return;
  }
  const lead = candidates.sort((a, b) => a.cards.length - b.cards.length || a.combo.high - b.combo.high)[0];
  if (lead) playDouDizhuCards(playerIndex, lead.cards);
}

function scheduleBotTurn() {
  if (!douDizhu || douDizhu.stage === "finished") return;
  const playerIndex = douDizhu.stage === "bidding" ? douDizhu.bidTurn : douDizhu.currentPlayer;
  if (playerIndex === 0) return;
  window.clearTimeout(turnTimer);
  turnTimer = window.setTimeout(() => {
    if (douDizhu.stage === "bidding") takeBid(playerIndex, botBid(playerIndex));
    else botPlay(playerIndex);
  }, 520);
}

function comboName(combo) {
  return ({
    single: "single", pair: "pair", triple: "triple", bomb: "bomb", rocket: "rocket",
    straight: "straight", "pair-sequence": "pair sequence", "triple-sequence": "triple sequence",
    "triple-single": "triple + 1", "triple-pair": "triple + 2",
    "four-two-singles": "four + 2", "four-two-pairs": "four + 4",
    "airplane-singles": "airplane + 1", "airplane-pairs": "airplane + 2"
  })[combo.type];
}

function renderOpponent(playerIndex, handId, countId) {
  const hand = douDizhu.players[playerIndex].hand;
  const container = document.getElementById(handId);
  container.replaceChildren();
  const visibleCount = Math.min(hand.length, 12);
  for (let index = 0; index < visibleCount; index += 1) {
    container.appendChild(createCardElement(hand[index], { hidden: true }));
  }
  document.getElementById(countId).textContent = `${hand.length} cards`;
}

function renderDouDizhu() {
  if (!douDizhu) return;
  const humanTurn = douDizhu.stage === "bidding" ? douDizhu.bidTurn === 0 : douDizhu.currentPlayer === 0;
  const bidding = douDizhu.stage === "bidding";
  const playing = douDizhu.stage === "playing";
  analyzePositionButton.hidden = !playing || !humanTurn;
  document.getElementById("doudizhuStatus").textContent = bidding ? "Bidding" : playing ? "Play" : "Round over";
  document.getElementById("trickStatus").textContent = douDizhu.status;
  document.getElementById("landlordInfo").textContent = douDizhu.landlord === null
    ? `Current bid: ${douDizhu.highestBid || "none"}`
    : `Landlord: ${douDizhu.players[douDizhu.landlord].name}`;

  const bidActions = document.getElementById("bidActions");
  bidActions.hidden = !bidding || !humanTurn;
  bidActions.querySelectorAll("[data-bid]").forEach(button => {
    button.disabled = Number(button.dataset.bid) <= douDizhu.highestBid;
  });
  document.getElementById("passBidBtn").disabled = !humanTurn;
  const playActions = document.getElementById("playActions");
  playActions.hidden = !playing || !humanTurn;
  const finishedActions = document.getElementById("finishedActions");
  finishedActions.hidden = douDizhu.stage !== "finished" || !douDizhu.humanTurnReviews.length;
  document.getElementById("playCardsBtn").disabled = douDizhu.selected.size === 0;
  document.getElementById("passTurnBtn").disabled = !douDizhu.currentTrick;

  const names = douDizhu.players;
  document.getElementById("leftPlayerName").textContent = `${names[1].name}${douDizhu.landlord === 1 ? " · Landlord" : ""}`;
  document.getElementById("rightPlayerName").textContent = `${names[2].name}${douDizhu.landlord === 2 ? " · Landlord" : ""}`;
  document.getElementById("yourRole").textContent = douDizhu.landlord === 0 ? "You · Landlord" : "Your hand";
  renderOpponent(1, "leftOpponentHand", "leftCardCount");
  renderOpponent(2, "rightOpponentHand", "rightCardCount");

  const ownHand = document.getElementById("ownHand");
  ownHand.replaceChildren();
  sortedHand(names[0].hand).forEach(card => {
    ownHand.appendChild(createCardElement(card, {
      selected: douDizhu.selected.has(card.id),
      selectable: playing && humanTurn
    }));
  });
  syncHandScrollbar();
  document.getElementById("ownCardCount").textContent = `${names[0].hand.length} cards`;

  const bottom = document.getElementById("bottomCards");
  bottom.replaceChildren();
  bottom.hidden = douDizhu.landlord !== 0 || !douDizhu.bottom.length;
  if (!bottom.hidden) douDizhu.bottom.forEach(card => bottom.appendChild(createCardElement(card)));

  const trickCards = document.getElementById("trickCards");
  trickCards.replaceChildren();
  douDizhu.currentTrick?.cards.forEach(card => trickCards.appendChild(createCardElement(card)));
}

gameChoices.forEach(button => {
  button.addEventListener("click", () => setGame(button.dataset.gameChoice));
});
newGameButton.addEventListener("click", newGame);
document.getElementById("hitBtn").addEventListener("click", hitBlackjack);
document.getElementById("standBtn").addEventListener("click", standBlackjack);
document.getElementById("bidActions").addEventListener("click", event => {
  const button = event.target.closest("[data-bid]");
  if (button && !button.disabled) takeBid(0, Number(button.dataset.bid));
});
document.getElementById("passBidBtn").addEventListener("click", () => takeBid(0, 0));
document.getElementById("ownHand").addEventListener("click", event => {
  const button = event.target.closest("[data-card-id]");
  if (button) selectDouDizhuCard(button.dataset.cardId);
});
document.getElementById("playCardsBtn").addEventListener("click", () => {
  if (!douDizhu || douDizhu.currentPlayer !== 0) return;
  const cards = douDizhu.players[0].hand.filter(card => douDizhu.selected.has(card.id));
  playDouDizhuCards(0, cards);
});
document.getElementById("passTurnBtn").addEventListener("click", () => {
  if (douDizhu?.currentPlayer === 0) passDouDizhu(0);
});
analyzePositionButton.addEventListener("click", analyzeCurrentPosition);
reviewGameButton.addEventListener("click", analyzeCompletedGame);
ownHand.addEventListener("scroll", syncHandScrollbar, { passive: true });
handScrollbar.addEventListener("pointerdown", event => {
  const isThumb = event.target === handScrollbarThumb || handScrollbarThumb.contains(event.target);
  handScrollbarDrag = isThumb
    ? event.clientX - handScrollbarThumb.getBoundingClientRect().left
    : null;
  if (!isThumb) setHandScrollFromPointer(event.clientX);
  else handScrollbar.setPointerCapture(event.pointerId);
  event.preventDefault();
});
handScrollbar.addEventListener("pointermove", event => {
  if (handScrollbarDrag !== null) setHandScrollFromPointer(event.clientX, handScrollbarDrag);
});
handScrollbar.addEventListener("pointerup", () => { handScrollbarDrag = null; });
handScrollbar.addEventListener("pointercancel", () => { handScrollbarDrag = null; });
handScrollbar.addEventListener("keydown", scrollHandByKeyboard);
window.addEventListener("resize", syncHandScrollbar);
if ("ResizeObserver" in window) {
  new ResizeObserver(syncHandScrollbar).observe(ownHand);
}

startBlackjack();
