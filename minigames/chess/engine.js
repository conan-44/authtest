const ENGINE_URL = new URL("./stockfish-19-lite-single.js", import.meta.url);
const SEARCH_DEPTH = 12;
const ENGINE_TIMEOUT_MS = 120_000;

export async function analyzeFens(fens, onProgress = () => {}) {
    const worker = new Worker(ENGINE_URL, { type: "classic" });
    const evaluations = [];
    try {
        await waitForCommand(worker, "uci", "uciok");
        worker.postMessage("setoption name Threads value 1");
        worker.postMessage("setoption name Hash value 32");
        worker.postMessage("setoption name MultiPV value 2");
        await waitForCommand(worker, "isready", "readyok");

        for (let index = 0; index < fens.length; index += 1) {
            onProgress(index + 1, fens.length);
            worker.postMessage(`position fen ${fens[index]}`);
            const bestMove = waitForBestMove(worker);
            worker.postMessage(`go depth ${SEARCH_DEPTH}`);
            const result = await bestMove;
            evaluations.push({
                ...result,
                pv: result.pv ?? [],
                depth: result.depth ?? SEARCH_DEPTH,
            });
        }
    } finally {
        worker.terminate();
    }

    return evaluations;
}

function waitForCommand(worker, command, expected) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error(`Stockfish timed out waiting for ${expected}.`)), ENGINE_TIMEOUT_MS);
        const onMessage = (event) => {
            if (String(event.data).trim() === expected) {
                finish();
            }
        };
        const onError = () => finish(new Error("Stockfish failed to load. Check that the engine JavaScript and WebAssembly files are installed together."));
        const finish = (error) => {
            clearTimeout(timeout);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            if (error) reject(error);
            else resolve();
        };

        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage(command);
    });
}

function waitForBestMove(worker) {
    return new Promise((resolve, reject) => {
        const latestInfo = new Map();
        const timeout = setTimeout(() => finish(new Error("Stockfish took too long to analyze a position.")), ENGINE_TIMEOUT_MS);
        const onMessage = (event) => {
            const line = String(event.data).trim();
            if (line.startsWith("info ")) {
                const info = parseInfo(line);
                if (info && (!latestInfo.has(info.multipv) || info.depth >= latestInfo.get(info.multipv).depth)) {
                    latestInfo.set(info.multipv, info);
                }
            } else if (line.startsWith("bestmove ")) {
                const lines = [...latestInfo.values()].sort((a, b) => a.multipv - b.multipv);
                finish({
                    ...(lines[0] ?? parseFinalScore(line)),
                    bestMove: line.split(/\s+/)[1],
                    lines,
                });
            }
        };
        const onError = () => finish(new Error("Stockfish stopped unexpectedly while analyzing."));
        const finish = (result) => {
            clearTimeout(timeout);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            if (result instanceof Error) reject(result);
            else resolve(result);
        };

        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
    });
}

function parseInfo(line) {
    const depth = line.match(/\bdepth (\d+)/);
    const multipv = line.match(/\bmultipv (\d+)/);
    const score = line.match(/\bscore (cp|mate) (-?\d+)/);
    if (!depth || !score) return null;
    const pvIndex = line.indexOf(" pv ");
    return {
        depth: Number(depth[1]),
        multipv: multipv ? Number(multipv[1]) : 1,
        scoreType: score[1],
        score: Number(score[2]),
        pv: pvIndex === -1 ? [] : line.slice(pvIndex + 4).trim().split(/\s+/),
    };
}

function parseFinalScore(line) {
    const score = line.match(/\bscore (cp|mate) (-?\d+)/);
    return score
        ? { scoreType: score[1], score: Number(score[2]) }
        : { scoreType: "cp", score: 0 };
}
