import { decide } from "./vendor/doudizhu/js/ai/engine.js";
import { classify, rankOf } from "./vendor/doudizhu/js/rules.js";

function toEngineCards(ranks) {
  const copies = new Uint8Array(13);
  return ranks.map(rank => {
    if (rank === 16) return 52;
    if (rank === 17) return 53;
    const index = rank - 3;
    return index * 4 + copies[index]++;
  });
}

self.addEventListener("message", event => {
  const { id, handRanks, lastPlayRanks, context } = event.data || {};
  if (!Array.isArray(handRanks) || !context) return;

  try {
    const hand = toEngineCards(handRanks);
    let lastPlay = null;
    if (Array.isArray(lastPlayRanks) && lastPlayRanks.length) {
      const cards = toEngineCards(lastPlayRanks);
      const shape = classify(cards);
      if (!shape) throw new Error("Could not classify the previous play.");
      lastPlay = { ...shape, cards, seat: context.lastPlayer };
    }

    const result = decide(hand, lastPlay, {
      seat: context.seat,
      landlord: context.landlord,
      handSizes: context.handSizes,
      playedCounts: context.playedCounts,
      passCount: context.passCount,
      level: 6
    });

    self.postMessage({
      id,
      elapsedMs: result.info.elapsedMs,
      candidates: result.candidates.map(candidate => ({
        ranks: candidate.cards === null
          ? null
          : candidate.cards.map(card => {
            const rank = rankOf(card);
            return rank < 13 ? rank + 3 : rank === 13 ? 16 : 17;
          }),
        score: candidate.score,
        meta: candidate.meta
      }))
    });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
