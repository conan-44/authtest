import { chooseBotLine, loadBotDialogue } from "../bot-dialogue.js";
import DoudizhuAI from "./vendor/doudizhu/js/ai/engine.js";
import DoudizhuDifficulty from "./vendor/doudizhu/js/difficulty.js";
import { TYPE as DoudizhuType } from "./vendor/doudizhu/js/rules.js";

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
let onlineMatch = null;
let onlineUnsubscribe = null;
let onlineBusy = false;
const douDizhuBotLevel = document.getElementById("douDizhuBotLevel");
const douDizhuBotPersonalitySelects = [
  document.getElementById("leftBotPersonality"),
  document.getElementById("rightBotPersonality")
];
const douDizhuPersonalities = {
  bob: { name: "Bob", profile: "bob", sprite: 0 },
  banana: { name: "Banana", profile: "banana", sprite: 1 },
  beryll: { name: "Beryll", profile: "beryll", sprite: 2 },
  bot: { name: "Bot", profile: "bot", sprite: 3 }
};
const douDizhuBotDialogueRow = document.getElementById("douDizhuBotDialogueRow");
const douDizhuBotDialogueElement = document.getElementById("douDizhuBotDialogue");
const douDizhuBotIcon = document.getElementById("douDizhuBotIcon");
let douDizhuDialogue = null;
const defaultDouDizhuDialogue = {
  idle: ["Let's see how this hand goes.", "Ready when you are."],
  bid: ["I'll take the lead.", "Let's see what this hand can do."],
  pass: ["I'll wait for a better chance.", "Not this time."],
  play: ["Your turn.", "Let's keep things moving."],
  win: ["Good round. Well played!", "That's the round!"],
  lose: ["You got us this time.", "Nice teamwork."]
};
douDizhuDialogue = defaultDouDizhuDialogue;

loadBotDialogue(new URL("../../data/minigames/dou-dizhu/bots.skvwcfgml", import.meta.url), defaultDouDizhuDialogue)
  .then(dialogue => { douDizhuDialogue = dialogue; })
  .catch(error => {
    console.error("Could not load Dou Dizhu bot dialogue.", error);
    douDizhuDialogue = defaultDouDizhuDialogue;
  });

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

function recordCardGameRating(game, delta) {
  try {
    const updater = window.parent?.gameRatings?.adjust;
    if (typeof updater !== "function") {
      console.error(`Game rating tracker is unavailable for ${game}.`);
      return;
    }
    Promise.resolve(updater(game, delta)).catch(error => {
      console.error(`Could not update ${game} rating.`, error);
    });
  } catch (error) {
    console.error(`Could not reach the game rating tracker for ${game}.`, error);
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
  if (onlineMatch && game !== "doudizhu") return;
  selectedGame = game;
  resetAnalysis();
  gameChoices.forEach(button => {
    const selected = button.dataset.gameChoice === game;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  blackjackView.hidden = game !== "blackjack";
  douDizhuView.hidden = game !== "doudizhu";
  document.getElementById("douDizhuMultiplayerControls").hidden = game !== "doudizhu";
  newGame();
}

function newGame() {
  if (onlineMatch) return;
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
  if (blackjack.status === "win" || blackjack.status === "blackjack") {
    recordCardGameRating("blackjack", 12);
  } else if (blackjack.status === "lose" || blackjack.status === "bust" || blackjack.status === "dealer-blackjack") {
    recordCardGameRating("blackjack", -12);
  }
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

function createOnlineDouDizhuSetup() {
  const deck = createDouDizhuDeck();
  const hands = [deck.splice(0, 17), deck.splice(0, 17), deck.splice(0, 17)];
  const bottom = deck;
  const initialSeat = Math.floor(Math.random() * 3);
  return {
    publicState: {
      players: hands.map((hand, seat) => ({ name: `Player ${seat + 1}`, handCount: hand.length })),
      stage: "bidding",
      bidTurn: initialSeat,
      bidsMade: 0,
      highestBid: 0,
      landlord: null,
      currentPlayer: null,
      currentTrick: null,
      lastPlayer: null,
      passes: 0,
      passesAfterBid: 0,
      playedCounts: Array(15).fill(0),
      status: "choosing landlord"
    },
    privateStates: {
      "0": { hand: hands[0] },
      "1": { hand: hands[1] },
      "2": { hand: hands[2] },
      bottom
    }
  };
}

function makeHiddenHand(count) {
  return Array.from({ length: count }, () => makeCard(3));
}

function onlineDouPublicState() {
  const seat = onlineMatch.seat;
  const toAbsoluteSeat = localSeat => (seat + localSeat) % 3;
  const players = douDizhu.players.map((player, localSeat) => ({
    name: localSeat === 0 ? "You" : `Player ${toAbsoluteSeat(localSeat) + 1}`,
    handCount: player.hand.length
  }));
  const trick = douDizhu.currentTrick;
  return {
    players,
    stage: douDizhu.stage,
    bidTurn: douDizhu.bidTurn === null ? null : toAbsoluteSeat(douDizhu.bidTurn),
    bidsMade: douDizhu.bidsMade,
    highestBid: douDizhu.highestBid,
    landlord: douDizhu.landlord === null ? null : toAbsoluteSeat(douDizhu.landlord),
    currentPlayer: douDizhu.currentPlayer === null ? null : toAbsoluteSeat(douDizhu.currentPlayer),
    currentTrick: trick ? {
      cards: trick.cards.map(({ rank, red }) => ({ rank, red: Boolean(red) })),
      combo: trick.combo,
      player: toAbsoluteSeat(trick.player)
    } : null,
    lastPlayer: douDizhu.lastPlayer === undefined ? null : toAbsoluteSeat(douDizhu.lastPlayer),
    passes: douDizhu.passes,
    passesAfterBid: douDizhu.passesAfterBid || 0,
    playedCounts: douDizhu.playedCounts.slice(),
    status: douDizhu.status
  };
}

function loadOnlineDouDizhu(publicState, privateState, seat) {
  if (onlineMatch && Array.isArray(privateState?.bottom)) {
    onlineMatch.bottomAvailable = true;
    onlineMatch.privateBottom = privateState.bottom;
  }
  const toLocalSeat = absoluteSeat => absoluteSeat === null || absoluteSeat === undefined
    ? null
    : (absoluteSeat - seat + 3) % 3;
  const ownHand = Array.isArray(privateState?.hand) ? privateState.hand : [];
  const publicOwnCount = publicState.players?.[seat]?.handCount ?? ownHand.length;
  const bottomCards = privateState?.bottom || onlineMatch?.privateBottom;
  if (
    publicState.landlord === seat &&
    publicOwnCount > ownHand.length &&
    Array.isArray(bottomCards)
  ) {
    ownHand.push(...bottomCards);
  }
  const players = [0, 1, 2].map(localSeat => {
    const absoluteSeat = (seat + localSeat) % 3;
    const count = publicState.players?.[absoluteSeat]?.handCount ?? 0;
    return {
      name: localSeat === 0 ? "You" : `Player ${absoluteSeat + 1}`,
      isHuman: true,
      hand: localSeat === 0 ? ownHand : makeHiddenHand(count)
    };
  });
  const trick = publicState.currentTrick;
  douDizhu = {
    players,
    stage: publicState.stage,
    bidTurn: toLocalSeat(publicState.bidTurn),
    bidsMade: publicState.bidsMade,
    highestBid: publicState.highestBid,
    landlord: toLocalSeat(publicState.landlord),
    bottom: [],
    currentPlayer: toLocalSeat(publicState.currentPlayer),
    currentTrick: trick ? {
      cards: trick.cards.map(card => ({ ...card, id: `played-${Math.random()}` })),
      combo: trick.combo,
      player: toLocalSeat(trick.player)
    } : null,
    lastPlayer: toLocalSeat(publicState.lastPlayer),
    passes: publicState.passes,
    passesAfterBid: publicState.passesAfterBid,
    playedCounts: publicState.playedCounts.slice(),
    humanTurnReviews: [],
    selected: new Set(),
    status: publicState.status
  };
  if (onlineMatch && onlineMatch.seat === publicState.landlord && Array.isArray(bottomCards)) {
    douDizhu.bottom = bottomCards;
  }
  renderDouDizhu();
}

function subscribeOnlineDouDizhu(match) {
  onlineUnsubscribe?.();
  onlineMatch = match;
  if (match.invite_code) {
    document.getElementById("multiplayerInviteCode").value = match.invite_code;
    document.getElementById("multiplayerInviteActions").hidden = false;
  }
  onlineUnsubscribe = window.parent.gameMultiplayer.subscribe(
    match.id,
    payload => {
      if (payload.version !== onlineMatch.version + 1) {
        refreshOnlineDouDizhu().catch(error => {
          document.getElementById("multiplayerStatus").textContent = error.message;
        });
        return;
      }
      onlineMatch.version = payload.version;
      onlineMatch.currentTurn = payload.public_state.currentPlayer ?? payload.public_state.bidTurn;
      if (payload.public_state.landlord === onlineMatch.seat && !onlineMatch.bottomAvailable) {
        refreshOnlineDouDizhu().catch(error => {
          document.getElementById("multiplayerStatus").textContent = error.message;
        });
        return;
      }
      loadOnlineDouDizhu(payload.public_state, {
        hand: douDizhu.players[0].hand,
        bottom: onlineMatch.privateBottom
      }, onlineMatch.seat);
    },
    payload => {
      if (Number.isInteger(payload.seat)) {
        onlineMatch.players ??= [];
        onlineMatch.players[payload.seat] = true;
        renderDouDizhu();
      }
    },
    status => {
      if (status === "SUBSCRIBED") {
        refreshOnlineDouDizhu().catch(error => {
          document.getElementById("multiplayerStatus").textContent = error.message;
        });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        document.getElementById("multiplayerStatus").textContent =
          "Live updates unavailable. Apply supabase/game_sessions.sql.";
      }
    }
  );
}

async function refreshOnlineDouDizhu() {
  const state = await window.parent.gameMultiplayer.get(onlineMatch.id);
  if (state.game !== "doudizhu") throw new Error("This invite is not for Dou Dizhu.");
  onlineMatch.version = state.version;
  onlineMatch.currentTurn = state.current_turn;
  onlineMatch.players = state.players;
  loadOnlineDouDizhu(state.public_state, state.private_state, onlineMatch.seat);
}

async function persistOnlineDouDizhuMove(action) {
  if (!onlineMatch || onlineBusy) return;
  onlineBusy = true;
  renderDouDizhu();
  const absoluteNextTurn = (onlineMatch.seat + (douDizhu.stage === "bidding" ? douDizhu.bidTurn : douDizhu.currentPlayer)) % 3;
  try {
    let privateHand = douDizhu.players[0].hand;
    if (
      action.type === "bid" &&
      douDizhu.stage === "playing" &&
      douDizhu.landlord === 0 &&
      !onlineMatch.bottomAvailable
    ) {
      privateHand = privateHand.slice(0, 17);
    }
    const result = await window.parent.gameMultiplayer.submit(
      onlineMatch.id,
      onlineMatch.version,
      absoluteNextTurn,
      action,
      onlineDouPublicState(),
      { hand: privateHand }
    );
    onlineMatch.version = result.version;
    onlineMatch.currentTurn = absoluteNextTurn;
  } catch (error) {
    let refreshFailed = false;
    await refreshOnlineDouDizhu().catch(refreshError => {
      refreshFailed = true;
      document.getElementById("multiplayerStatus").textContent =
        `${error.message} Latest state unavailable: ${refreshError.message}`;
    });
    if (!refreshFailed) document.getElementById("multiplayerStatus").textContent = error.message;
  } finally {
    onlineBusy = false;
    renderDouDizhu();
  }
}

function sortedHand(hand) {
  return [...hand].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

function startDouDizhu() {
  resetAnalysis();
  douDizhuBotDialogueRow.hidden = true;
  douDizhuBotDialogueElement.textContent = "";
  douDizhu = {
    players: [
      { name: "You", isHuman: true, hand: [] },
      ...douDizhuBotPersonalitySelects.map(select => {
        const personality = douDizhuPersonalities[select.value];
        return {
          name: personality.name,
          personality: select.value,
          isHuman: false,
          hand: []
        };
      })
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
  setDouDizhuBotDialogue(1 + Math.floor(Math.random() * 2), "idle");
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

function bidStrength(hand) {
  const counts = groupByRank(hand);
  return hand.reduce((score, card) => score
    + (card.rank === 17 ? 3 : card.rank === 16 ? 2 : card.rank === 15 ? 1.5 : card.rank === 14 ? 0.9 : 0), 0)
    + [...counts.values()].reduce((score, group) => score + (group.length === 4 ? 1.6 : group.length === 3 ? 0.6 : 0), 0);
}

function botBid(player) {
  const strength = bidStrength(douDizhu.players[player].hand);
  const thresholdShift = (3 - Number(douDizhuBotLevel.value)) * 0.12;
  const target = strength >= 5.2 + thresholdShift ? 3
    : strength >= 3.7 + thresholdShift ? 2
      : strength >= 2.2 + thresholdShift ? 1 : 0;
  return target > douDizhu.highestBid ? target : 0;
}

function setDouDizhuBotDialogue(playerIndex, category) {
  if (playerIndex === 0 || !douDizhu?.players[playerIndex]) return;
  const personality = douDizhuPersonalities[douDizhu.players[playerIndex].personality];
  if (!personality) return;
  const profile = personality.profile;
  const line = chooseBotLine(douDizhuDialogue, category, Math.random, profile);
  douDizhuBotDialogueRow.hidden = !line;
  douDizhuBotDialogueElement.textContent = line;
  douDizhuBotIcon.style.backgroundPosition = `${-personality.sprite * 24}px 0`;
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
  setDouDizhuBotDialogue(player, bid ? "bid" : "pass");

  if (bid === 3 || (douDizhu.landlord !== null && douDizhu.passesAfterBid >= 2)) {
    beginDouDizhuPlay();
    if (onlineMatch && player === 0) void persistOnlineDouDizhuMove({ type: "bid", bid });
    return;
  }
  if (douDizhu.bidsMade >= 3 && douDizhu.landlord === null) {
    douDizhu.stage = onlineMatch ? "finished" : "dealing";
    douDizhu.status = onlineMatch ? "everyone passed · start a new game to redeal" : "everyone passed…";
    renderDouDizhu();
    if (onlineMatch) void persistOnlineDouDizhuMove({ type: "bid", bid });
    else turnTimer = window.setTimeout(startDouDizhu, 900);
    return;
  }
  douDizhu.bidTurn = (player + 1) % 3;
  renderDouDizhu();
  scheduleBotTurn();
  if (onlineMatch && player === 0) void persistOnlineDouDizhuMove({ type: "bid", bid });
}

function beginDouDizhuPlay() {
  const landlord = douDizhu.landlord ?? 0;
  douDizhu.stage = "playing";
  const bottomCards = douDizhu.bottom.length === 3
    ? douDizhu.bottom
    : onlineMatch
      ? makeHiddenHand(3)
      : [];
  douDizhu.players[landlord].hand.push(...bottomCards);
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
    douDizhu.players.forEach((roundPlayer, index) => {
      if (index !== 0) setDouDizhuBotDialogue(index, index === playerIndex ? "win" : "lose");
    });
    recordCardGameAchievement("dou-dizhu", "round-completed", {
      won: playerIndex === 0,
      humanWasLandlord: douDizhu.landlord === 0,
      winnerWasLandlord: landlordWon
    });
    const humanWon = (playerIndex === douDizhu.landlord) === (douDizhu.landlord === 0);
    recordCardGameRating("doudizhu", humanWon ? 12 : -12);
  } else {
    douDizhu.currentPlayer = (playerIndex + 1) % 3;
    setDouDizhuBotDialogue(playerIndex, "play");
  }
  if (combo.type === "rocket") triggerDouDizhuImpact("nuke");
  else if (combo.type === "bomb") triggerDouDizhuImpact("bomb");
  else if (cards.some(card => card.rank === 16 || card.rank === 17)) triggerDouDizhuImpact("joker");
  else if (cards.some(card => card.rank === 15)) triggerDouDizhuImpact("two");
  renderDouDizhu();
  if (douDizhu.stage === "playing") scheduleBotTurn();
  if (onlineMatch && playerIndex === 0) {
    void persistOnlineDouDizhuMove({ type: "play", ranks: cards.map(card => card.rank).sort((a, b) => a - b) });
  }
  return true;
}

function passDouDizhu(playerIndex) {
  if (douDizhu.currentTrick === null || playerIndex !== douDizhu.currentPlayer) return;
  if (playerIndex === 0) recordHumanTurn(null);
  resetAnalysis();
  douDizhu.passes += 1;
  douDizhu.status = `${douDizhu.players[playerIndex].name} passed.`;
  setDouDizhuBotDialogue(playerIndex, "pass");
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
  if (onlineMatch && playerIndex === 0) void persistOnlineDouDizhuMove({ type: "pass" });
}

function botPlay(playerIndex) {
  const player = douDizhu.players[playerIndex];
  const rankCopies = new Map();
  const cardsByEngineId = new Map();
  const engineHand = player.hand.map(card => {
    const rank = card.rank - 3;
    const engineId = card.rank === 16 ? 52
      : card.rank === 17 ? 53
        : rank * 4 + (rankCopies.get(rank) ?? 0);
    rankCopies.set(rank, (rankCopies.get(rank) ?? 0) + 1);
    cardsByEngineId.set(engineId, card);
    return engineId;
  });
  const comboTypes = {
    single: DoudizhuType.SOLO,
    pair: DoudizhuType.PAIR,
    triple: DoudizhuType.TRIO,
    "triple-single": DoudizhuType.TRIO_SOLO,
    "triple-pair": DoudizhuType.TRIO_PAIR,
    straight: DoudizhuType.STRAIGHT,
    "pair-sequence": DoudizhuType.PAIR_STRAIGHT,
    "triple-sequence": DoudizhuType.PLANE,
    "airplane-singles": DoudizhuType.PLANE_SOLO,
    "airplane-pairs": DoudizhuType.PLANE_PAIR,
    "four-two-singles": DoudizhuType.FOUR_SOLO,
    "four-two-pairs": DoudizhuType.FOUR_PAIR,
    bomb: DoudizhuType.BOMB,
    rocket: DoudizhuType.ROCKET
  };
  const lastPlay = douDizhu.currentTrick
    ? {
      seat: douDizhu.currentTrick.player,
      type: comboTypes[douDizhu.currentTrick.combo.type],
      rank: douDizhu.currentTrick.combo.high - 3,
      len: douDizhu.currentTrick.combo.length
    }
    : null;
  const decision = DoudizhuAI.decide(engineHand, lastPlay, {
    seat: playerIndex,
    landlord: douDizhu.landlord,
    handSizes: douDizhu.players.map(other => other.hand.length),
    playedCounts: douDizhu.playedCounts,
    passCount: douDizhu.passes,
    level: Number(douDizhuBotLevel.value)
  });
  const picked = DoudizhuDifficulty.pickMove(decision.candidates, Number(douDizhuBotLevel.value));
  const chosenCards = picked?.cards?.map(id => cardsByEngineId.get(id)).filter(Boolean);
  if (!chosenCards?.length) {
    passDouDizhu(playerIndex);
    return;
  }
  playDouDizhuCards(playerIndex, chosenCards);
}

function scheduleBotTurn() {
  if (!douDizhu || douDizhu.stage === "finished" || onlineMatch) return;
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
  const allPlayersReady = !onlineMatch || onlineMatch.players?.length === 3 && onlineMatch.players.every(Boolean);
  const humanTurn = allPlayersReady && !onlineBusy
    && (douDizhu.stage === "bidding" ? douDizhu.bidTurn === 0 : douDizhu.currentPlayer === 0);
  const bidding = douDizhu.stage === "bidding";
  const playing = douDizhu.stage === "playing";
  douDizhuBotLevel.closest(".bot-level-controls").hidden = Boolean(onlineMatch);
  analyzePositionButton.hidden = !playing || !humanTurn;
  document.getElementById("doudizhuStatus").textContent = onlineMatch
    ? allPlayersReady ? (bidding ? "Online bidding" : playing ? "Online play" : "Round over") : "Waiting for players"
    : bidding ? "Bidding" : playing ? "Play" : "Round over";
  document.getElementById("trickStatus").textContent = allPlayersReady
    ? onlineBusy ? "Saving move…" : douDizhu.status
    : `Invite ${3 - (onlineMatch?.players?.filter(Boolean).length || 1)} more player${3 - (onlineMatch?.players?.filter(Boolean).length || 1) === 1 ? "" : "s"} to start.`;
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
  document.getElementById("playCardsBtn").disabled = !humanTurn || douDizhu.selected.size === 0;
  document.getElementById("passTurnBtn").disabled = !humanTurn || !douDizhu.currentTrick;

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
  newGameButton.disabled = Boolean(onlineMatch);

  const bottom = document.getElementById("bottomCards");
  bottom.replaceChildren();
  bottom.hidden = douDizhu.landlord !== 0 || !douDizhu.bottom.length;
  if (!bottom.hidden) douDizhu.bottom.forEach(card => bottom.appendChild(createCardElement(card)));

  const trickCards = document.getElementById("trickCards");
  trickCards.replaceChildren();
  douDizhu.currentTrick?.cards.forEach(card => trickCards.appendChild(createCardElement(card)));
}

document.getElementById("createMultiplayerGameBtn").addEventListener("click", async () => {
  const button = document.getElementById("createMultiplayerGameBtn");
  const status = document.getElementById("multiplayerStatus");
  button.disabled = true;
  try {
    if (selectedGame !== "doudizhu") throw new Error("Select Dou Dizhu before creating an online game.");
    if (!window.parent.gameMultiplayer) throw new Error("Open Card Games from the main app to use online games.");
    const setup = createOnlineDouDizhuSetup();
    const result = await window.parent.gameMultiplayer.create(
      "doudizhu",
      document.getElementById("multiplayerMode").value,
      3,
      setup.publicState,
      setup.privateStates
    );
    const state = await window.parent.gameMultiplayer.get(result.id);
    const match = {
      ...result,
      mode: state.mode,
      version: state.version,
      currentTurn: state.current_turn,
      players: state.players,
      invite_code: state.invite_code || result.invite_code
    };
    onlineMatch = match;
    loadOnlineDouDizhu(setup.publicState, {
      hand: setup.privateStates["0"].hand,
      bottom: setup.privateStates.bottom
    }, 0);
    douDizhu.bottom = setup.privateStates.bottom;
    subscribeOnlineDouDizhu(match);
    status.textContent = `Dou Dizhu · ${state.mode === "live" ? "live" : "turn-based, no timer"} · invite code ${result.invite_code}`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function joinOnlineDouDizhu(inviteCode) {
  const status = document.getElementById("multiplayerStatus");
  try {
    if (selectedGame !== "doudizhu") throw new Error("Select Dou Dizhu before joining an online game.");
    if (!window.parent.gameMultiplayer) throw new Error("Open Card Games from the main app to use online games.");
    const result = await window.parent.gameMultiplayer.join(
      inviteCode,
      "doudizhu"
    );
    const state = await window.parent.gameMultiplayer.get(result.id);
    const match = {
      ...result,
      mode: state.mode,
      version: state.version,
      currentTurn: state.current_turn,
      players: state.players,
      invite_code: state.invite_code || result.invite_code
    };
    subscribeOnlineDouDizhu(match);
    loadOnlineDouDizhu(state.public_state, state.private_state, result.seat);
    status.textContent = `Joined ${state.mode === "live" ? "live" : "turn-based"} Dou Dizhu · seat ${result.seat + 1}`;
  } catch (error) {
    status.textContent = error.message;
  }
}

document.getElementById("joinMultiplayerGameBtn").addEventListener("click", async () => {
  const button = document.getElementById("joinMultiplayerGameBtn");
  button.disabled = true;
  try {
    await joinOnlineDouDizhu(document.getElementById("multiplayerInviteCode").value);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("copyGameInviteLinkBtn").addEventListener("click", async () => {
  try {
    const link = window.parent.gameMultiplayer.createInviteLink("doudizhu", onlineMatch?.invite_code);
    await navigator.clipboard.writeText(link);
    document.getElementById("multiplayerStatus").textContent = "Invite link copied.";
  } catch (error) {
    document.getElementById("multiplayerStatus").textContent = error.message || "Could not copy the invite link.";
  }
});

document.getElementById("shareGameInviteChatBtn").addEventListener("click", async () => {
  try {
    await window.parent.gameMultiplayer.shareInviteToChat("doudizhu", onlineMatch?.invite_code);
    document.getElementById("multiplayerStatus").textContent = "Invite shared in chat.";
  } catch (error) {
    document.getElementById("multiplayerStatus").textContent = error.message;
  }
});

document.getElementById("sendGameInviteBtn").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await window.parent.gameMultiplayer.sendInvite(
      onlineMatch?.id,
      document.getElementById("inviteUsername").value
    );
    document.getElementById("multiplayerStatus").textContent = `Game popup sent to ${result.username}.`;
  } catch (error) {
    document.getElementById("multiplayerStatus").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

douDizhuBotPersonalitySelects.forEach((select, index) => {
  select.addEventListener("change", () => {
    const player = douDizhu?.players[index + 1];
    const personality = douDizhuPersonalities[select.value];
    if (!player || !personality || onlineMatch) return;
    player.personality = select.value;
    player.name = personality.name;
    setDouDizhuBotDialogue(index + 1, "idle");
    renderDouDizhu();
  });
});

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
const inviteCodeFromUrl = new URLSearchParams(window.location.search).get("invite");
if (inviteCodeFromUrl) {
  setGame("doudizhu");
  document.getElementById("multiplayerInviteCode").value = inviteCodeFromUrl;
  joinOnlineDouDizhu(inviteCodeFromUrl);
}
