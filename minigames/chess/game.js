import { Chess } from "./chess.js";
import { analyzeFens, chooseBotMove } from "./engine.js";
import { findOpening, loadOpeningBook } from "./opening-book.js";
import { chooseBotLine, loadBotDialogue } from "../bot-dialogue.js";

const game = new Chess();
const initialFen = game.fen();
const boardElement = document.getElementById("chessBoard");
const gameStatus = document.getElementById("gameStatus");
const gameHint = document.getElementById("gameHint");
const turnIndicator = document.getElementById("turnIndicator");
const moveList = document.getElementById("moveList");
const moveCount = document.getElementById("moveCount");
const emptyHistory = document.getElementById("emptyHistory");
const undoButton = document.getElementById("undoBtn");
const reviewButton = document.getElementById("reviewGameBtn");
const reviewStartButton = document.getElementById("reviewStartBtn");
const analyzeButton = document.getElementById("analyzeGameBtn");
const newGameButton = document.getElementById("newGameBtn");
const shareGameButton = document.getElementById("shareGameBtn");
const analysisStatus = document.getElementById("analysisStatus");
const evaluationScore = document.getElementById("evaluationScore");
const evaluationBar = document.getElementById("evaluationBar");
const evaluationWhite = document.getElementById("evaluationWhite");
const principalVariation = document.getElementById("principalVariation");
const openingNameElement = document.getElementById("openingName");
const openingBookStatus = document.getElementById("openingBookStatus");
const bookMovesElement = document.getElementById("bookMoves");
const promotionDialog = document.getElementById("promotionDialog");
const botLevelSelect = document.getElementById("chessBotLevel");
const botPersonalitySelect = document.getElementById("chessBotPersonality");
const botDialogueRow = document.getElementById("botDialogueRow");
const botDialogue = document.getElementById("botDialogue");
const botDialogueText = document.getElementById("botDialogueText");
const botIcon = document.getElementById("botIcon");
const files = "abcdefgh";
const pieceColumn = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };
const pieceName = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

let selectedSquare = null;
let legalMoves = [];
let isFlipped = false;
let pendingPromotion = null;
let isReviewing = false;
let reviewedPly = 0;
let evaluations = [];
let analysisInProgress = false;
let openingBook = null;
let openingBookError = "";
let chessGameRecorded = false;
let chessRatingRecorded = false;
let chessReviewPenaltyApplied = false;
let analysisAchievementRecorded = false;
let onlineMatch = null;
let onlineUnsubscribe = null;
let onlineBusy = false;
let botThinking = false;
let botGameToken = 0;
let cancelBotThinkDelay = null;
let botDialogueConfig = {};
const chessBots = [
  null,
  { depth: 1, skill: 0, multiPv: 5 },
  { depth: 2, skill: 2, multiPv: 5 },
  { depth: 4, skill: 5, multiPv: 4 },
  { depth: 7, skill: 10, multiPv: 3 },
  { depth: 11, skill: 18, multiPv: 2 },
];
const chessPersonalities = {
  bob: { name: "Bob", profile: "bob", style: "balanced", sprite: 0, thinkTime: [700, 1900] },
  banana: { name: "Banana", profile: "banana", style: "playful", sprite: 1, thinkTime: [250, 950] },
  beryll: { name: "Beryll", profile: "beryll", style: "cautious", sprite: 2, thinkTime: [1200, 3000] },
  bot: { name: "Bot", profile: "bot", style: "aggressive", sprite: 3, thinkTime: [300, 1400] }
};
const defaultChessDialogue = {
  idle: ["Your move. I'm ready.", "Let's see what you have."],
  capturing: ["I saw that piece hanging.", "That one is mine."],
  captured: ["Nice capture.", "You found a way through."],
  losing: ["I need to find a better plan.", "You're making this difficult."],
  winning: ["I like my position.", "Things are going according to plan."],
  draw: ["A fair draw.", "Neither of us could break through."],
  won: ["Checkmate. Good game!", "That was a fun game."],
  lost: ["You got me. Well played!", "A well-earned win."]
};
botDialogueConfig = defaultChessDialogue;
const discoveredOpenings = new Set();

function recordGameAchievementEvent(eventName, details = {}) {
  if (window.parent === window) return;
  try {
    const recorder = window.parent.achievements?.recordGameEvent;
    if (typeof recorder !== "function") {
      console.error("Game achievement tracker is unavailable.");
      return;
    }
    recorder("chess", eventName, details).catch(error => {
      console.error("Could not record Chess achievement progress.", error);
    });
  } catch (error) {
    console.error("Could not reach the game achievement tracker.", error);
  }
}

function recordChessRating(delta) {
  try {
    const updater = window.parent.gameRatings?.adjust;
    if (typeof updater !== "function") {
      console.error("Game rating tracker is unavailable for Chess.");
      return;
    }
    Promise.resolve(updater("chess", delta)).catch(error => {
      console.error("Could not update Chess rating.", error);
    });
  } catch (error) {
    console.error("Could not reach the Chess rating tracker.", error);
  }
}

function chessRatingPlayerColor() {
  if (onlineMatch) return onlineMatch.seat === 0 ? "w" : "b";
  return chessBotProfile() ? "w" : null;
}

function recordChessResult() {
  if (!game.isGameOver() || chessRatingRecorded) return;
  const playerColor = chessRatingPlayerColor();
  if (!playerColor) return;
  chessRatingRecorded = true;
  if (game.isDraw()) {
    recordChessRating(0);
    return;
  }
  const winnerColor = game.turn() === "w" ? "b" : "w";
  recordChessRating(winnerColor === playerColor ? 16 : -16);
}

function applyChessReviewPenalty() {
  const history = historyWithFen();
  const playerColor = chessRatingPlayerColor();
  if (
    chessReviewPenaltyApplied ||
    game.isGameOver() ||
    !history.length ||
    !playerColor
  ) return;
  chessReviewPenaltyApplied = true;
  const currentEvaluation = evaluations.length === history.length + 1
    ? evaluations[history.length]?.centipawns
    : null;
  const whiteAdvantage = Number.isFinite(currentEvaluation) ? currentEvaluation : -materialBalance() * 100;
  const playerAdvantage = whiteAdvantage * (playerColor === "w" ? 1 : -1);
  recordChessRating(playerAdvantage >= 300 ? -1 : playerAdvantage <= -300 ? -5 : -3);
}

loadOpeningBook()
  .then(book => {
    openingBook = book;
    renderOpeningBook();
  })
  .catch(error => {
    openingBookError = error.message;
    renderOpeningBook();
  });

loadBotDialogue(new URL("../../data/minigames/chess/bots.skvwcfgml", import.meta.url), defaultChessDialogue)
  .then(dialogue => { botDialogueConfig = dialogue; })
  .catch(error => {
    console.error("Could not load Chess bot dialogue.", error);
    botDialogueConfig = defaultChessDialogue;
    gameHint.textContent = "Bot dialogue config could not be loaded; built-in lines will be used.";
  });

function historyWithFen() {
  return game.history({ verbose: true });
}

function fenAtPly(ply) {
  if (ply === 0) return initialFen;
  return historyWithFen()[ply - 1]?.after ?? game.fen();
}

function displayGame() {
  if (!isReviewing) return game;
  const preview = new Chess();
  preview.load(fenAtPly(reviewedPly));
  return preview;
}

function squareName(file, rank) {
  return `${files[file]}${rank + 1}`;
}

function pieceSpritePosition(piece) {
  const x = (pieceColumn[piece.type] / 5) * 100;
  const y = piece.color === "b" ? 0 : 100;
  return `${x}% ${y}%`;
}

function renderBoard() {
  const boardGame = displayGame();
  const history = historyWithFen();
  const lastMove = isReviewing ? history[reviewedPly - 1] : history.at(-1);
  const checkedKing = boardGame.isCheck()
    ? boardGame.findPiece({ type: "k", color: boardGame.turn() })[0]
    : null;
  boardElement.replaceChildren();

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const file = isFlipped ? 7 - column : column;
      const rank = isFlipped ? row : 7 - row;
      const square = squareName(file, rank);
      const piece = boardGame.get(square);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `square ${(file + rank) % 2 === 0 ? "light" : "dark"}`;
      button.dataset.square = square;
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", `${square}${piece ? `, ${piece.color === "w" ? "white" : "black"} ${pieceName[piece.type]}` : ""}`);

      if (lastMove && (square === lastMove.from || square === lastMove.to)) button.classList.add("last-move");
      if (square === selectedSquare) button.classList.add("selected");
      if (square === checkedKing) button.classList.add("in-check");
      if (!isReviewing && legalMoves.some(move => move.to === square)) {
        button.classList.add(piece ? "legal-capture" : "legal-target");
      }

      if (piece) {
        const sprite = document.createElement("span");
        sprite.className = "piece";
        sprite.style.backgroundPosition = pieceSpritePosition(piece);
        sprite.setAttribute("aria-hidden", "true");
        button.appendChild(sprite);
      }

      if ((!isFlipped && file === 0) || (isFlipped && file === 7)) {
        const coordinate = document.createElement("span");
        coordinate.className = "square-coordinate";
        coordinate.textContent = String(rank + 1);
        button.appendChild(coordinate);
      }
      if ((!isFlipped && rank === 0) || (isFlipped && rank === 7)) {
        const coordinate = document.createElement("span");
        coordinate.className = "square-coordinate";
        coordinate.textContent = files[file];
        coordinate.style.inset = "auto 4px 2px auto";
        button.appendChild(coordinate);
      }

      boardElement.appendChild(button);
    }
  }

  renderStatus(boardGame);
}

function renderStatus(boardGame) {
  const turn = boardGame.turn();
  const side = turn === "w" ? "White" : "Black";
  const kingSquare = boardGame.findPiece({ type: "k", color: turn })[0];
  turnIndicator.style.backgroundPosition = `100% ${turn === "w" ? 100 : 0}%`;

  if (boardGame.isCheckmate()) {
    gameStatus.textContent = `Checkmate — ${turn === "w" ? "Black" : "White"} wins`;
    gameHint.textContent = `${side} has no legal moves.`;
  } else if (boardGame.isStalemate()) {
    gameStatus.textContent = "Draw by stalemate";
    gameHint.textContent = "There are no legal moves, but the king is not in check.";
  } else if (!isReviewing && game.isThreefoldRepetition()) {
    gameStatus.textContent = "Draw by repetition";
    gameHint.textContent = "The same position occurred three times.";
  } else if (boardGame.isInsufficientMaterial()) {
    gameStatus.textContent = "Draw by insufficient material";
    gameHint.textContent = "Neither side has enough pieces to force checkmate.";
  } else if (boardGame.isDraw()) {
    gameStatus.textContent = "Draw";
    gameHint.textContent = "The game has ended.";
  } else {
    gameStatus.textContent = `${side} to move${boardGame.isCheck() ? " — check" : ""}`;
    gameHint.textContent = isReviewing
      ? `Reviewing position after ${reviewedPly === 0 ? "the start" : `ply ${reviewedPly}`}.`
      : onlineMatch
      ? onlineBusy
        ? "Saving move…"
        : onlineMatch.players?.[1 - onlineMatch.seat]
          ? onlineMatch.seat === (turn === "w" ? 0 : 1)
            ? `Your ${side.toLowerCase()} turn.`
            : `Waiting for ${side.toLowerCase()}.`
          : "Waiting for your opponent to join."
      : boardGame.isCheck()
      ? `${side}'s king on ${kingSquare} is under attack.`
      : selectedSquare
        ? "choose a move"
        : "choose a piece";
  }
}

function renderMoveHistory() {
  const history = historyWithFen();
  moveList.replaceChildren();
  for (let index = 0; index < history.length; index += 2) {
    const number = document.createElement("li");
    number.className = "move-number";
    number.textContent = `${Math.floor(index / 2) + 1}.`;
    moveList.appendChild(number);

    for (const moveIndex of [index, index + 1]) {
      const move = history[moveIndex];
      if (!move) continue;
      const item = document.createElement("li");
      item.className = `move-${move.color === "w" ? "white" : "black"}${moveIndex === history.length - 1 ? " latest-move" : ""}${isReviewing && reviewedPly === moveIndex + 1 ? " reviewed-move" : ""}`;
      const moveButton = document.createElement("button");
      moveButton.className = "move-entry";
      moveButton.type = "button";
      moveButton.dataset.ply = String(moveIndex + 1);
      moveButton.disabled = !isReviewing;
      const moveSan = document.createElement("span");
      moveSan.className = "move-entry-san";
      moveSan.textContent = move.san;
      moveButton.appendChild(moveSan);
      item.appendChild(moveButton);
      const quality = moveQuality(moveIndex);
      if (quality) {
        const qualityBadge = document.createElement("span");
        qualityBadge.className = `move-quality quality-${quality.toLowerCase()}`;
        qualityBadge.setAttribute("aria-label", `Move quality: ${quality}`);
        const qualityIcon = document.createElement("span");
        qualityIcon.className = `quality-icon ${qualityIconClass(quality)}`;
        qualityIcon.setAttribute("aria-hidden", "true");
        qualityBadge.append(qualityIcon, document.createTextNode(quality === "Book" ? "BOOK" : quality));
        item.appendChild(qualityBadge);
      }
      moveList.appendChild(item);
    }
  }
  const fullMoves = Math.ceil(history.length / 2);
  moveCount.textContent = `${fullMoves} ${fullMoves === 1 ? "move" : "moves"}`;
  emptyHistory.hidden = history.length > 0;
  undoButton.disabled = history.length === 0 || isReviewing || botThinking || Boolean(onlineMatch);
  reviewStartButton.disabled = !isReviewing;
  reviewButton.disabled = analysisInProgress || botThinking;
  newGameButton.disabled = analysisInProgress || botThinking || Boolean(onlineMatch);
  botLevelSelect.disabled = botThinking || Boolean(onlineMatch);
  botPersonalitySelect.disabled = botThinking || Boolean(onlineMatch);
  reviewButton.textContent = isReviewing ? "Exit review" : "Review game";
  analyzeButton.disabled = history.length === 0 || analysisInProgress || botThinking;
  shareGameButton.hidden = !game.isGameOver() && evaluations.length !== history.length + 1;
  shareGameButton.disabled = analysisInProgress;
  renderCapturedPieces();
  renderOpeningBook();
}

function isBookMove(moveIndex, history = historyWithFen()) {
  if (!openingBook) return false;
  const move = history[moveIndex];
  if (!move) return false;
  const previousSans = history.slice(0, moveIndex).map(previousMove => previousMove.san);
  return findOpening(openingBook, previousSans).moves.some(bookMove => bookMove.san === move.san);
}

function renderOpeningBook() {
  bookMovesElement.replaceChildren();
  if (!openingBook) {
    openingNameElement.textContent = openingBookError ? "Opening book unavailable" : "Loading openings…";
    openingBookStatus.textContent = openingBookError
      ? `Could not load the opening data: ${openingBookError}`
      : "Loading opening names and moves.";
    return;
  }

  const history = historyWithFen();
  const sans = history
    .slice(0, isReviewing ? reviewedPly : undefined)
    .map(move => move.san);
  const opening = findOpening(openingBook, sans);
  openingNameElement.textContent = opening.openingName;
  if (
    !isReviewing &&
    sans.length > 0 &&
    opening.openingName !== "Not in book" &&
    opening.openingName !== "Starting position" &&
    !discoveredOpenings.has(opening.openingName)
  ) {
    discoveredOpenings.add(opening.openingName);
    recordGameAchievementEvent("opening-discovered", { name: opening.openingName });
  }

  if (!opening.moves.length) {
    openingBookStatus.textContent = isReviewing
      ? "No book continuations from this position."
      : "No book continuations. Play any legal move to continue.";
    return;
  }

  const canPlayBookMove = !isReviewing && !analysisInProgress && !game.isGameOver() && canMoveOnline();
  const displayedMoves = opening.moves.slice(0, 6);
  openingBookStatus.textContent = isReviewing
    ? `Showing ${displayedMoves.length} of ${opening.moves.length} book moves.`
    : "Choose a book move, or play any legal move.";
  for (const bookMove of displayedMoves) {
    const button = document.createElement("button");
    button.className = "book-move";
    button.type = "button";
    button.disabled = !canPlayBookMove;
    button.dataset.from = bookMove.move.from;
    button.dataset.to = bookMove.move.to;
    if (bookMove.move.promotion) button.dataset.promotion = bookMove.move.promotion;

    const san = document.createElement("span");
    san.className = "book-move-san";
    san.textContent = bookMove.san;
    button.appendChild(san);
    if (bookMove.openingName && bookMove.openingName !== opening.openingName) {
      const name = document.createElement("span");
      name.className = "book-move-name";
      name.textContent = bookMove.openingName;
      button.appendChild(name);
    }
    bookMovesElement.appendChild(button);
  }
}

function renderCapturedPieces() {
  const whiteCaptured = document.getElementById("whiteCaptured");
  const blackCaptured = document.getElementById("blackCaptured");
  whiteCaptured.replaceChildren();
  blackCaptured.replaceChildren();

  historyWithFen().slice(0, isReviewing ? reviewedPly : undefined).forEach(move => {
    if (!move.captured) return;
    const capturedPiece = { type: move.captured, color: move.color === "w" ? "b" : "w" };
    const icon = document.createElement("span");
    icon.className = "captured-piece";
    icon.style.backgroundPosition = pieceSpritePosition(capturedPiece);
    icon.setAttribute("aria-label", pieceName[capturedPiece.type]);
    (move.color === "w" ? whiteCaptured : blackCaptured).appendChild(icon);
  });
}

function clearAnalysis() {
  evaluations = [];
  analysisStatus.textContent = "Play a few moves, then review your game.";
  principalVariation.textContent = "Engine line will appear here.";
  evaluationScore.textContent = "—";
  evaluationWhite.style.width = "50%";
  evaluationBar.setAttribute("aria-valuenow", "0");
}

function moveQuality(moveIndex, history = historyWithFen()) {
  if (isBookMove(moveIndex, history)) return "Book";
  if (
    evaluations.length !== history.length + 1 ||
    !evaluations[moveIndex] ||
    !evaluations[moveIndex + 1]
  ) return "";
  const move = history[moveIndex];
  const sign = move.color === "w" ? 1 : -1;
  const before = evaluations[moveIndex];
  const after = evaluations[moveIndex + 1];
  const loss = (before.centipawns - after.centipawns) * sign;
  const playedMove = `${move.from}${move.to}${move.promotion ?? ""}`;
  const bestLine = before.lines[0];
  const secondLine = before.lines[1];
  const moveIsTopEngineChoice = bestLine?.move === playedMove || before.bestMove === playedMove;
  const bestMoveLead = bestLine && secondLine
    ? (bestLine.centipawns - secondLine.centipawns) * sign
    : 0;

  if (moveIsTopEngineChoice && loss <= 50 && bestMoveLead >= 200) return "Great";
  if (loss <= 50) return "Best";
  if (loss <= 300) return "Inaccuracy";
  return "Blunder";
}

function qualityIconClass(quality) {
  return {
    Blunder: "label-error",
    Inaccuracy: "label-warn",
    Best: "label-success",
    Great: "label-info",
    Book: "label-book",
  }[quality];
}

function whiteEvaluation(result, fen) {
  const sideToMoveSign = fen.split(" ")[1] === "w" ? 1 : -1;
  const centipawnsFor = ({ scoreType, score }) => {
    if (scoreType !== "mate") return score;
    const mateSign = score === 0 ? -1 : Math.sign(score);
    return mateSign * (30_000 - Math.min(Math.abs(score), 100) * 100);
  };
  const centipawns = centipawnsFor(result);
  return {
    centipawns: centipawns * sideToMoveSign,
    mate: result.scoreType === "mate" ? result.score * sideToMoveSign : null,
    pv: result.pv,
    depth: result.depth,
    bestMove: result.bestMove,
    lines: (result.lines ?? []).map(line => ({
      move: line.pv[0],
      centipawns: centipawnsFor(line) * sideToMoveSign,
    })),
  };
}

function formatEvaluation(evaluation) {
  if (evaluation.mate !== null) {
    return evaluation.mate === 0
      ? `${evaluation.centipawns > 0 ? "" : "−"}M0`
      : `${evaluation.mate > 0 ? "" : "−"}M${Math.abs(evaluation.mate)}`;
  }
  const pawns = evaluation.centipawns / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

function principalVariationSan(fen, pv) {
  const variation = new Chess();
  variation.load(fen);
  const sanMoves = [];
  for (const uciMove of pv) {
    const match = uciMove.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (!match) break;
    try {
      sanMoves.push(variation.move({ from: match[1], to: match[2], promotion: match[3] }).san);
    } catch {
      break;
    }
  }
  return sanMoves.join(" ");
}

function renderAnalysisPosition() {
  const evaluation = evaluations[reviewedPly];
  if (!evaluation) {
    evaluationScore.textContent = "—";
    evaluationWhite.style.width = "50%";
    evaluationBar.setAttribute("aria-valuenow", "0");
    principalVariation.textContent = "Engine line will appear here.";
    return;
  }

  evaluationScore.textContent = formatEvaluation(evaluation);
  const clamped = Math.max(-1000, Math.min(1000, evaluation.centipawns));
  const whiteWidth = ((clamped + 1000) / 2000) * 100;
  evaluationWhite.style.width = `${whiteWidth}%`;
  evaluationBar.setAttribute("aria-valuenow", String((clamped / 100).toFixed(1)));
  const line = principalVariationSan(fenAtPly(reviewedPly), evaluation.pv);
  principalVariation.textContent = line
    ? `Depth ${evaluation.depth}: ${line}`
    : `Depth ${evaluation.depth}: no suggested line.`;
}

async function analyzeGame() {
  const history = historyWithFen();
  if (!history.length || analysisInProgress) return;
  applyChessReviewPenalty();

  analysisInProgress = true;
  isReviewing = true;
  reviewedPly = history.length;
  selectedSquare = null;
  legalMoves = [];
  evaluations = [];
  analysisStatus.textContent = "Starting Stockfish…";
  renderBoard();
  renderMoveHistory();
  renderAnalysisPosition();

  const fens = [initialFen, ...history.map(move => move.after)];
  try {
    const results = await analyzeFens(fens, (current, total) => {
      analysisStatus.textContent = `Analyzing position ${current} of ${total}…`;
    });
    evaluations = results.map((result, index) => whiteEvaluation(result, fens[index]));
    analysisStatus.textContent = `Analysis complete · depth ${results[0]?.depth ?? 12} · move labels are approximate`;
    const playerColor = onlineMatch
      ? (onlineMatch.seat === 0 ? "w" : "b")
      : Number(botLevelSelect.value) > 0 ? "w" : null;
    history.forEach((move, index) => {
      if (playerColor && move.color !== playerColor) return;
      const enPassant = move.isEnPassant();
      const castling = move.isKingsideCastle() || move.isQueensideCastle();
      if (!enPassant && !castling) return;
      recordGameAchievementEvent("special-move-analyzed", {
        enPassant,
        castling,
        quality: moveQuality(index, history)
      });
    });
    if (!analysisAchievementRecorded) {
      analysisAchievementRecorded = true;
      recordGameAchievementEvent("analyzed");
    }
  } catch (error) {
    evaluations = [];
    analysisStatus.textContent = `Stockfish is not ready. Add stockfish-19-lite-single.js and stockfish-19-lite-single.wasm to minigames/chess/, then reload. ${error.message}`;
  } finally {
    analysisInProgress = false;
    renderMoveHistory();
    renderAnalysisPosition();
  }
}

function validSharedEvaluations(sharedEvaluations, expectedLength) {
  return Array.isArray(sharedEvaluations)
    && sharedEvaluations.length === expectedLength
    && sharedEvaluations.length <= 200
    && sharedEvaluations.every(evaluation =>
      evaluation &&
      Number.isFinite(evaluation.centipawns) &&
      (evaluation.mate === null || Number.isFinite(evaluation.mate)) &&
      Number.isFinite(evaluation.depth) &&
      Array.isArray(evaluation.pv) &&
      evaluation.pv.length <= 80 &&
      evaluation.pv.every(move => typeof move === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) &&
      typeof evaluation.bestMove === "string" &&
      evaluation.bestMove.length <= 6 &&
      Array.isArray(evaluation.lines) &&
      evaluation.lines.length <= 2 &&
      evaluation.lines.every(line =>
        typeof line.move === "string" &&
        /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(line.move) &&
        Number.isFinite(line.centipawns)
      )
    );
}

function loadSharedGame() {
  const serialized = new URLSearchParams(window.location.search).get("shared");
  if (!serialized) return;

  try {
    const shared = JSON.parse(serialized);
    if (
      shared?.game !== "chess" ||
      typeof shared.pgn !== "string" ||
      !shared.pgn.trim() ||
      shared.pgn.length > 16_000
    ) {
      throw new Error("The shared Chess game is invalid.");
    }
    game.loadPgn(shared.pgn);
    const history = historyWithFen();
    if (validSharedEvaluations(shared.evaluations, history.length + 1)) {
      evaluations = shared.evaluations;
      analysisStatus.textContent = "Shared engine analysis loaded.";
    } else {
      analysisStatus.textContent = "Shared game loaded. Analyze it to see engine evaluations.";
    }
    isReviewing = true;
    reviewedPly = history.length;
  } catch (error) {
    game.reset();
    analysisStatus.textContent = `Could not load the shared game: ${error.message}`;
  }
}

shareGameButton.addEventListener("click", async () => {
  const share = window.parent.shareGameToChat;
  if (typeof share !== "function") {
    gameHint.textContent = "Sharing is available when Chess is opened from the app.";
    return;
  }

  shareGameButton.disabled = true;
  try {
    const analyzed = evaluations.length === historyWithFen().length + 1;
    await share("chess", {
      pgn: game.pgn(),
      evaluations: analyzed ? evaluations : null
    });
    gameHint.textContent = "Game shared in chat.";
  } catch (error) {
    gameHint.textContent = error.message || "Could not share the game.";
  } finally {
    renderMoveHistory();
  }
});

function selectSquare(square) {
  if (isReviewing || !canMoveOnline() || botThinking || (!onlineMatch && Number(botLevelSelect.value) > 0 && game.turn() !== "w")) return;
  const piece = game.get(square);
  if (!piece || piece.color !== game.turn() || game.isGameOver()) {
    selectedSquare = null;
    legalMoves = [];
    renderBoard();
    return;
  }
  selectedSquare = square;
  legalMoves = game.moves({ square, verbose: true });
  renderBoard();
}

function canMoveOnline() {
  if (!onlineMatch) return true;
  if (onlineBusy || !onlineMatch.players?.[1 - onlineMatch.seat]) return false;
  const turnSeat = game.turn() === "w" ? 0 : 1;
  return onlineMatch.seat === turnSeat;
}

async function makeMove(from, to, promotion = "q") {
  if (!canMoveOnline() || botThinking || (!onlineMatch && Number(botLevelSelect.value) > 0 && game.turn() !== "w")) return;
  let move;
  try {
    move = game.move({ from, to, promotion });
    if (onlineMatch) {
      onlineBusy = true;
      renderBoard();
      const saved = await window.parent.gameMultiplayer.submit(
        onlineMatch.id,
        onlineMatch.version,
        game.turn() === "w" ? 0 : 1,
        { from, to, promotion },
        { pgn: game.pgn() }
      );
      onlineMatch.version = saved.version;
      onlineBusy = false;
    }
    const enPassant = move.isEnPassant();
    const castling = move.isKingsideCastle() || move.isQueensideCastle();
    if (enPassant || castling) {
      recordGameAchievementEvent("special-move", {
        enPassant,
        castling,
        checkmate: castling && game.isCheckmate()
      });
    }
    if (game.isGameOver() && !chessGameRecorded) {
      chessGameRecorded = true;
      recordGameAchievementEvent("completed", {
        winner: game.isCheckmate() ? (game.turn() === "w" ? "black" : "white") : null,
      });
    }
    recordChessResult();
    selectedSquare = null;
    legalMoves = [];
    clearAnalysis();
    renderBoard();
    renderMoveHistory();
    if (game.isGameOver()) {
      setChessBotDialogue(game.isDraw() ? "draw" : "lost");
    } else if (!onlineMatch && Number(botLevelSelect.value) > 0 && game.turn() === "b") {
      setChessBotDialogue(move?.captured ? "captured" : "idle");
      void playChessBotTurn();
    }
  } catch (error) {
    if (move) game.undo();
    onlineBusy = false;
    if (onlineMatch) await refreshOnlineMatch().catch(refreshError => {
      gameHint.textContent = `${error.message} Latest game state could not be loaded: ${refreshError.message}`;
    });
    gameHint.textContent = error.message;
    renderBoard();
    renderMoveHistory();
  }
}

function chessBotProfile() {
  const strength = chessBots[Number(botLevelSelect.value)];
  if (!strength) return null;
  return { ...strength, ...chessPersonalities[botPersonalitySelect.value] };
}

function setChessBotDialogue(category) {
  const bot = chessBotProfile();
  const line = chooseBotLine(botDialogueConfig, category, Math.random, bot?.profile);
  botDialogueRow.hidden = !bot || !line;
  botDialogueText.textContent = bot && line ? line : "";
  if (bot) botIcon.style.backgroundPosition = `${-bot.sprite * 24}px 0`;
}

function materialBalance() {
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  return Object.entries(values).reduce((balance, [type, value]) => balance
    + game.findPiece({ type, color: "b" }).length * value
    - game.findPiece({ type, color: "w" }).length * value, 0);
}

function waitForBotThinkDelay(duration) {
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      if (cancelBotThinkDelay === cancel) cancelBotThinkDelay = null;
      resolve();
    }, duration);
    const cancel = () => {
      window.clearTimeout(timer);
      if (cancelBotThinkDelay === cancel) cancelBotThinkDelay = null;
      resolve();
    };
    cancelBotThinkDelay = cancel;
  });
}

async function playChessBotTurn() {
  const bot = chessBotProfile();
  if (!bot || onlineMatch || game.turn() !== "b" || game.isGameOver() || botThinking) return;
  const token = ++botGameToken;
  botThinking = true;
  gameHint.textContent = `${bot.name} is thinking…`;
  renderMoveHistory();
  try {
    const [minimum, maximum] = bot.thinkTime;
    const thinkDuration = minimum + Math.random() * (maximum - minimum);
    await waitForBotThinkDelay(thinkDuration);
    if (token !== botGameToken || !chessBotProfile() || game.turn() !== "b" || game.isGameOver()) return;

    const result = await chooseBotMove(game.fen(), bot);
    if (token !== botGameToken || !chessBotProfile() || game.turn() !== "b" || game.isGameOver()) return;
    const candidates = result.lines?.filter(line => line.pv?.[0]) ?? [];
    const topCandidates = candidates.slice(0, 3);
    let selected = candidates[0];
    if (bot.style === "playful" && topCandidates.length > 1) {
      selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    } else if (bot.style === "cautious" && topCandidates.length > 1) {
      const topScore = topCandidates[0].score;
      const alternative = topCandidates.find((candidate, index) => index > 0
        && candidate.scoreType === topCandidates[0].scoreType
        && topScore - candidate.score <= 80);
      if (alternative) selected = alternative;
    } else if (bot.style === "aggressive" && topCandidates.length > 1) {
      const legalMoves = game.moves({ verbose: true });
      const capture = topCandidates
        .map(candidate => ({
          candidate,
          move: legalMoves.find(move => `${move.from}${move.to}${move.promotion ?? ""}` === candidate.pv[0])
        }))
        .find(entry => entry.move?.captured && topCandidates[0].score - entry.candidate.score <= 120);
      if (capture) selected = capture.candidate;
    }
    const uci = selected?.pv?.[0] ?? result.bestMove;
    if (!uci || uci === "(none)") return;
    const botMove = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" });
    clearAnalysis();
    selectedSquare = null;
    legalMoves = [];
    renderBoard();
    renderMoveHistory();
    if (game.isGameOver()) {
      setChessBotDialogue(game.isDraw() ? "draw" : game.isCheckmate() ? "won" : "draw");
      if (!chessGameRecorded) {
        chessGameRecorded = true;
        recordGameAchievementEvent("completed", {
          winner: game.isCheckmate() ? "black" : null,
        });
      }
      recordChessResult();
    } else {
      const balance = materialBalance();
      setChessBotDialogue(botMove.captured ? "capturing" : balance >= 2 ? "winning" : balance <= -2 ? "losing" : "idle");
    }
  } catch (error) {
    console.error("Chess bot could not select a move.", error);
    botDialogueText.textContent = `I could not move: ${error.message}`;
    botDialogueRow.hidden = false;
  } finally {
    if (token === botGameToken) {
      botThinking = false;
      renderBoard();
      renderMoveHistory();
    }
  }
}

async function refreshOnlineMatch() {
  const state = await window.parent.gameMultiplayer.get(onlineMatch.id);
  if (state.game !== "chess") throw new Error("This invite is not for Chess.");
  onlineMatch.version = state.version;
  onlineMatch.currentTurn = state.current_turn;
  onlineMatch.players = state.players;
  game.loadPgn(state.public_state.pgn || "");
  recordChessResult();
  clearAnalysis();
  renderBoard();
  renderMoveHistory();
}

function attachOnlineMatch(match, version = 0) {
  onlineUnsubscribe?.();
  chessGameRecorded = false;
  chessRatingRecorded = false;
  chessReviewPenaltyApplied = false;
  onlineMatch = { ...match, version };
  const inviteActions = document.getElementById("multiplayerInviteActions");
  if (match.invite_code) {
    document.getElementById("multiplayerInviteCode").value = match.invite_code;
    inviteActions.hidden = false;
  }
  document.getElementById("gamePlayerMode").textContent =
    `${match.mode === "live" ? "Live" : "Turn-based · no timer"} · ${match.seat === 0 ? "White" : "Black"}`;
  document.getElementById("multiplayerStatus").textContent =
    `Invite code ${match.invite_code || "—"} · waiting for player`;
  newGameButton.disabled = true;
  undoButton.disabled = true;
  onlineUnsubscribe = window.parent.gameMultiplayer.subscribe(
    match.id,
    payload => {
      if (payload.version !== onlineMatch.version + 1) {
        refreshOnlineMatch().catch(error => {
          document.getElementById("multiplayerStatus").textContent = error.message;
        });
        return;
      }
      try {
        game.loadPgn(payload.public_state?.pgn || "");
      } catch (error) {
        document.getElementById("multiplayerStatus").textContent = "Received an invalid Chess update.";
        return;
      }
      onlineMatch.version = payload.version;
      onlineMatch.currentTurn = 1 - payload.actor_seat;
      clearAnalysis();
      renderBoard();
      renderMoveHistory();
      recordChessResult();
    },
    payload => {
      if (Number.isInteger(payload.seat)) {
        onlineMatch.players ??= [];
        onlineMatch.players[payload.seat] = true;
        document.getElementById("multiplayerStatus").textContent = "Opponent joined. Game ready.";
        renderBoard();
      }
    },
    status => {
      if (status === "SUBSCRIBED") {
        refreshOnlineMatch().catch(error => {
          document.getElementById("multiplayerStatus").textContent = error.message;
        });
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        document.getElementById("multiplayerStatus").textContent =
          "Live updates unavailable. Apply supabase/game_sessions.sql.";
      }
    }
  );
}

document.getElementById("createMultiplayerGameBtn").addEventListener("click", async () => {
  const button = document.getElementById("createMultiplayerGameBtn");
  const status = document.getElementById("multiplayerStatus");
  button.disabled = true;
  try {
    if (!window.parent.gameMultiplayer) throw new Error("Open Chess from the main app to use online games.");
    const result = await window.parent.gameMultiplayer.create(
      "chess",
      document.getElementById("multiplayerMode").value,
      2,
      { pgn: "" }
    );
    const state = await window.parent.gameMultiplayer.get(result.id);
    attachOnlineMatch({ ...result, mode: state.mode, players: state.players }, state.version);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("joinMultiplayerGameBtn").addEventListener("click", async () => {
  const button = document.getElementById("joinMultiplayerGameBtn");
  button.disabled = true;
  try {
    await joinOnlineChess(document.getElementById("multiplayerInviteCode").value);
  } finally {
    button.disabled = false;
  }
});

async function joinOnlineChess(inviteCode) {
  const status = document.getElementById("multiplayerStatus");
  try {
    if (!window.parent.gameMultiplayer) throw new Error("Open Chess from the main app to use online games.");
    const result = await window.parent.gameMultiplayer.join(
      inviteCode,
      "chess"
    );
    const state = await window.parent.gameMultiplayer.get(result.id);
    attachOnlineMatch({ ...result, invite_code: state.invite_code, mode: state.mode, players: state.players }, state.version);
    game.loadPgn(state.public_state.pgn || "");
    onlineMatch.currentTurn = state.current_turn;
    renderBoard();
    renderMoveHistory();
    status.textContent = `Joined ${state.mode === "live" ? "live" : "turn-based"} Chess · ${result.seat === 0 ? "White" : "Black"}`;
  } catch (error) {
    status.textContent = error.message;
  }
}

document.getElementById("copyGameInviteLinkBtn").addEventListener("click", async () => {
  try {
    const link = window.parent.gameMultiplayer.createInviteLink("chess", onlineMatch?.invite_code);
    await navigator.clipboard.writeText(link);
    document.getElementById("multiplayerStatus").textContent = "Invite link copied.";
  } catch (error) {
    document.getElementById("multiplayerStatus").textContent = error.message || "Could not copy the invite link.";
  }
});

document.getElementById("shareGameInviteChatBtn").addEventListener("click", async () => {
  try {
    await window.parent.gameMultiplayer.shareInviteToChat("chess", onlineMatch?.invite_code);
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

function requestPromotion(from, to) {
  pendingPromotion = { from, to };
  const color = game.turn();
  promotionDialog.querySelectorAll("[data-promotion]").forEach(button => {
    const piece = { type: button.dataset.promotion, color };
    button.style.backgroundPosition = pieceSpritePosition(piece);
  });
  promotionDialog.showModal();
  promotionDialog.querySelector("[data-promotion='q']").focus();
}

boardElement.addEventListener("click", event => {
  const button = event.target.closest("[data-square]");
  if (!button) return;
  const square = button.dataset.square;

  if (selectedSquare) {
    const matchingMoves = legalMoves.filter(move => move.to === square);
    if (matchingMoves.length) {
      if (matchingMoves.some(move => move.promotion)) requestPromotion(selectedSquare, square);
      else makeMove(selectedSquare, square);
      return;
    }
  }

  selectSquare(square);
});

promotionDialog.querySelectorAll("[data-promotion]").forEach(button => {
  button.addEventListener("click", () => {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;
    pendingPromotion = null;
    promotionDialog.close();
    makeMove(from, to, button.dataset.promotion);
  });
});

document.getElementById("cancelPromotionBtn").addEventListener("click", () => {
  pendingPromotion = null;
  promotionDialog.close();
});

reviewButton.addEventListener("click", () => {
  if (botThinking) return;
  applyChessReviewPenalty();
  isReviewing = !isReviewing;
  reviewedPly = historyWithFen().length;
  selectedSquare = null;
  legalMoves = [];
  if (isReviewing) {
    analysisStatus.textContent = "Review positions with the move list. Add Stockfish to enable engine evaluations.";
  }
  renderBoard();
  renderMoveHistory();
  renderAnalysisPosition();
});

reviewStartButton.addEventListener("click", () => {
  if (!isReviewing) return;
  reviewedPly = 0;
  renderBoard();
  renderMoveHistory();
  renderAnalysisPosition();
});

moveList.addEventListener("click", event => {
  const moveButton = event.target.closest("[data-ply]");
  if (!isReviewing || !moveButton) return;
  reviewedPly = Number(moveButton.dataset.ply);
  renderBoard();
  renderMoveHistory();
  renderAnalysisPosition();
});

analyzeButton.addEventListener("click", analyzeGame);

bookMovesElement.addEventListener("click", event => {
  const button = event.target.closest("[data-from][data-to]");
  if (!button || button.disabled || isReviewing || analysisInProgress) return;
  makeMove(button.dataset.from, button.dataset.to, button.dataset.promotion ?? "q");
});

document.getElementById("undoBtn").addEventListener("click", () => {
  if (botThinking) return;
  if (!game.undo()) return;
  if (!onlineMatch && Number(botLevelSelect.value) > 0 && game.turn() === "b" && game.history().length) game.undo();
  selectedSquare = null;
  legalMoves = [];
  clearAnalysis();
  renderBoard();
  renderMoveHistory();
});

newGameButton.addEventListener("click", () => {
  cancelBotThinkDelay?.();
  botGameToken += 1;
  botThinking = false;
  game.reset();
  chessGameRecorded = false;
  chessRatingRecorded = false;
  chessReviewPenaltyApplied = false;
  analysisAchievementRecorded = false;
  discoveredOpenings.clear();
  isReviewing = false;
  reviewedPly = 0;
  selectedSquare = null;
  legalMoves = [];
  clearAnalysis();
  renderBoard();
  renderMoveHistory();
  setChessBotDialogue("idle");
});

botLevelSelect.addEventListener("change", () => {
  cancelBotThinkDelay?.();
  botGameToken += 1;
  botThinking = false;
  game.reset();
  chessGameRecorded = false;
  chessRatingRecorded = false;
  chessReviewPenaltyApplied = false;
  analysisAchievementRecorded = false;
  isReviewing = false;
  reviewedPly = 0;
  selectedSquare = null;
  legalMoves = [];
  clearAnalysis();
  const bot = chessBotProfile();
  document.getElementById("gamePlayerMode").textContent = bot
    ? `You as White · ${bot.name} as Black`
    : "two players · same device";
  botDialogueRow.hidden = !bot;
  setChessBotDialogue("idle");
  renderBoard();
  renderMoveHistory();
});

botPersonalitySelect.addEventListener("change", () => {
  cancelBotThinkDelay?.();
  botGameToken += 1;
  botThinking = false;
  game.reset();
  chessGameRecorded = false;
  chessRatingRecorded = false;
  chessReviewPenaltyApplied = false;
  analysisAchievementRecorded = false;
  isReviewing = false;
  reviewedPly = 0;
  selectedSquare = null;
  legalMoves = [];
  clearAnalysis();
  const bot = chessBotProfile();
  document.getElementById("gamePlayerMode").textContent = bot
    ? `You as White · ${bot.name} as Black`
    : "two players · same device";
  botDialogueRow.hidden = !bot;
  setChessBotDialogue("idle");
  renderBoard();
  renderMoveHistory();
});

document.getElementById("flipBoardBtn").addEventListener("click", () => {
  isFlipped = !isFlipped;
  renderBoard();
});

loadSharedGame();
renderBoard();
renderMoveHistory();
renderAnalysisPosition();
const inviteCodeFromUrl = new URLSearchParams(window.location.search).get("invite");
if (inviteCodeFromUrl) {
  document.getElementById("multiplayerInviteCode").value = inviteCodeFromUrl;
  joinOnlineChess(inviteCodeFromUrl);
}
