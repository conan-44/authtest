import { Chess } from "./chess.js";
import { analyzeFens } from "./engine.js";
import { findOpening, loadOpeningBook } from "./opening-book.js";

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
const analysisStatus = document.getElementById("analysisStatus");
const evaluationScore = document.getElementById("evaluationScore");
const evaluationBar = document.getElementById("evaluationBar");
const evaluationWhite = document.getElementById("evaluationWhite");
const principalVariation = document.getElementById("principalVariation");
const openingNameElement = document.getElementById("openingName");
const openingBookStatus = document.getElementById("openingBookStatus");
const bookMovesElement = document.getElementById("bookMoves");
const promotionDialog = document.getElementById("promotionDialog");
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
let analysisAchievementRecorded = false;
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

loadOpeningBook()
  .then(book => {
    openingBook = book;
    renderOpeningBook();
  })
  .catch(error => {
    openingBookError = error.message;
    renderOpeningBook();
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
  undoButton.disabled = history.length === 0 || isReviewing;
  reviewStartButton.disabled = !isReviewing;
  reviewButton.disabled = analysisInProgress;
  newGameButton.disabled = analysisInProgress;
  reviewButton.textContent = isReviewing ? "Exit review" : "Review game";
  analyzeButton.disabled = history.length === 0 || analysisInProgress;
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

  const canPlayBookMove = !isReviewing && !analysisInProgress && !game.isGameOver();
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

function moveQuality(moveIndex) {
  if (isBookMove(moveIndex)) return "Book";
  if (evaluations.length !== historyWithFen().length + 1) return "";
  const move = historyWithFen()[moveIndex];
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

function selectSquare(square) {
  if (isReviewing) return;
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

function makeMove(from, to, promotion = "q") {
  try {
    game.move({ from, to, promotion });
    if (game.isGameOver() && !chessGameRecorded) {
      chessGameRecorded = true;
      recordGameAchievementEvent("completed", {
        winner: game.isCheckmate() ? (game.turn() === "w" ? "black" : "white") : null,
      });
    }
    selectedSquare = null;
    legalMoves = [];
    clearAnalysis();
    renderBoard();
    renderMoveHistory();
  } catch (error) {
    gameHint.textContent = error.message;
  }
}

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
  if (!game.undo()) return;
  selectedSquare = null;
  legalMoves = [];
  clearAnalysis();
  renderBoard();
  renderMoveHistory();
});

newGameButton.addEventListener("click", () => {
  game.reset();
  chessGameRecorded = false;
  analysisAchievementRecorded = false;
  discoveredOpenings.clear();
  isReviewing = false;
  reviewedPly = 0;
  selectedSquare = null;
  legalMoves = [];
  clearAnalysis();
  renderBoard();
  renderMoveHistory();
});

document.getElementById("flipBoardBtn").addEventListener("click", () => {
  isFlipped = !isFlipped;
  renderBoard();
});

renderBoard();
renderMoveHistory();
