import { Chess } from "./chess.js";

const BOOK_FILES = ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"];
const BOOK_URL = new URL("../../data/minigames/chess/tsv/", import.meta.url);

function createNode() {
  return {
    children: new Map(),
    names: new Set(),
    count: 0,
    bestName: "",
  };
}

export async function loadOpeningBook() {
  const responses = await Promise.all(
    BOOK_FILES.map(async file => {
      const response = await fetch(new URL(file, BOOK_URL));
      if (!response.ok) {
        throw new Error(`Could not load opening file ${file} (${response.status}).`);
      }
      return response.text();
    }),
  );

  const root = createNode();
  let loadedLines = 0;
  for (const text of responses) {
    for (const row of text.split(/\r?\n/).slice(1)) {
      if (!row.trim()) continue;
      const [eco, name, pgn] = row.split("\t");
      if (!eco || !name || !pgn) continue;
      const moves = parsePgnMoves(pgn);
      if (!moves.length) continue;

      let node = root;
      const chess = new Chess();
      for (const san of moves) {
        let move;
        try {
          move = chess.move(san);
        } catch {
          throw new Error(`Invalid opening move "${san}" in ${name} (${eco}).`);
        }
        const key = move.san;
        if (!node.children.has(key)) {
          node.children.set(key, { ...createNode(), san: key, move });
        }
        node = node.children.get(key);
        node.count += 1;
      }
      node.names.add(name);
      loadedLines += 1;
    }
  }

  if (loadedLines === 0) {
    throw new Error("The opening files did not contain any usable lines.");
  }
  chooseBestNames(root);
  return { root, loadedLines };
}

export function findOpening(book, sans) {
  let node = book.root;
  let openingName = "";
  if (sans.length === 0) {
    node = book.root;
    openingName = "Starting position";
  }
  for (const san of sans) {
    node = node.children.get(san);
    if (!node) return { openingName: "Not in book", moves: [] };
    if (node.names.size) openingName = preferredName(node.names);
  }

  const moves = [...node.children.values()]
    .sort((a, b) => b.count - a.count || a.san.localeCompare(b.san))
    .map(child => ({
      san: child.san,
      move: child.move,
      openingName: child.bestName,
      lineCount: child.count,
    }));

  return { openingName: openingName || "Opening line", moves };
}

function parsePgnMoves(pgn) {
  return pgn
    .replace(/\d+\.(?:\.\.)?/g, " ")
    .split(/\s+/)
    .filter(token => token && !/^(?:1-0|0-1|1\/2-1\/2|\*)$/.test(token))
    .map(token => token.replace(/[!?]+$/g, ""));
}

function chooseBestNames(node) {
  node.bestName = node.names.size
    ? preferredName(node.names)
    : [...node.children.values()]
      .map(child => {
        chooseBestNames(child);
        return child.bestName;
      })
      .filter(Boolean)
      .sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? "";

  if (node.names.size) {
    for (const child of node.children.values()) chooseBestNames(child);
  }
}

function preferredName(names) {
  return [...names].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}
