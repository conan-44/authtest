/**
 * rules.js - 裁判层 + 规则内核（主线程与 AI Worker 共用的唯一事实来源）
 *
 * 斗地主和五子棋最大的不同：**合法出牌生成本身就是 AI 的一部分**。
 * 如果主线程（校验玩家出的牌）和 AI（生成候选）各写一套牌型判定，
 * 迟早出现「玩家这么出合法、AI 不这么想」的诡异 bug。所以这个文件被
 * 主线程的 app.js 与 ai/engine.js 同时 import——规则只有一处实现。
 *
 * ── 卡牌表示 ──────────────────────────────────────────────────────────
 *
 *   卡牌 id：0..51 为四种花色的 3..2（rank = id >> 2，suit = id & 3），
 *            52 = 小王，53 = 大王。
 *   点数下标 0..14：3 4 5 6 7 8 9 10 J Q K A 2 小王 大王。
 *   顺子/连对/飞机的有效区间是 0..11（3 到 A），2 与双王不能进顺。
 *   花色只影响显示，不影响任何规则判定。
 *
 *   规则层内部用手牌计数 Int8Array(15)（counts[r] = 该点数几张）运算，
 *   界面层用 card id 数组（要画花色）。两者互转是纯函数。
 *
 * ── 出口一览 ──────────────────────────────────────────────────────────
 *
 *   卡牌：rankOf / suitOf / cardLabel / countsOf / TOTAL_OF_RANK
 *   牌型：TYPE / TYPE_NAMES / classify / beats / isBombLike
 *   生成：generateMoves(hand, lastPlay, opts)
 *   手数：minHands(counts, budget)
 *   状态：createGame / deal / nextBid / startPlay / play / pass / aiContext
 *
 * @license MIT
 */

// ── 常量 ─────────────────────────────────────────────────────────────

export const RANK_COUNT = 15;
export const DECK_SIZE = 54;

/** 点数的显示名（下标即点数） */
export const RANK_NAMES = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王'];

/** 每个点数的总张数（双王各 1 张，其余各 4 张） */
export const TOTAL_OF_RANK = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1];

/** 花色符号，下标 = suit */
export const SUITS = ['♠', '♥', '♣', '♦'];

/** 顺子/连对/飞机允许的最高点数（A = 11） */
const MAX_CHAIN_RANK = 11;

// ── 卡牌工具 ─────────────────────────────────────────────────────────

/** 卡牌 id → 点数下标（0..14） */
export function rankOf(card) {
  if (card < 52) return card >> 2;
  return card === 52 ? 13 : 14;
}

/** 卡牌 id → 花色下标（0..3）；双王返回 -1 */
export function suitOf(card) {
  return card < 52 ? (card & 3) : -1;
}

/** 是否是大小王 */
export function isJoker(card) {
  return card >= 52;
}

/** 卡牌 id → 显示文本（"K" / "小王"） */
export function cardLabel(card) {
  return RANK_NAMES[rankOf(card)];
}

/** 手牌（card id 数组）→ 点数计数 Int8Array(15) */
export function countsOf(cards) {
  const cnt = new Int8Array(RANK_COUNT);
  for (let i = 0; i < cards.length; i++) cnt[rankOf(cards[i])]++;
  return cnt;
}

/** 点数计数 → 一个紧凑显示标签，如 "K×3 7"（面板用） */
export function countsLabel(counts) {
  const parts = [];
  for (let r = RANK_COUNT - 1; r >= 0; r--) {
    if (!counts[r]) continue;
    parts.push(counts[r] > 1 ? RANK_NAMES[r] + '×' + counts[r] : RANK_NAMES[r]);
  }
  return parts.length ? parts.join(' ') : '—';
}

/** 手牌排序：点数降序（大牌在前），同点数同花色相邻 */
export function sortHand(hand) {
  return hand.slice().sort((a, b) => {
    const d = rankOf(b) - rankOf(a);
    return d !== 0 ? d : a - b;
  });
}

// ── 牌型 ─────────────────────────────────────────────────────────────

export const TYPE = {
  SOLO: 'solo',
  PAIR: 'pair',
  TRIO: 'trio',
  TRIO_SOLO: 'trio_solo',
  TRIO_PAIR: 'trio_pair',
  STRAIGHT: 'straight',
  PAIR_STRAIGHT: 'pair_straight',
  PLANE: 'plane',
  PLANE_SOLO: 'plane_solo',
  PLANE_PAIR: 'plane_pair',
  FOUR_SOLO: 'four_solo',
  FOUR_PAIR: 'four_pair',
  BOMB: 'bomb',
  ROCKET: 'rocket'
};

export const TYPE_NAMES = {
  [TYPE.SOLO]: '单张',
  [TYPE.PAIR]: '对子',
  [TYPE.TRIO]: '三张',
  [TYPE.TRIO_SOLO]: '三带一',
  [TYPE.TRIO_PAIR]: '三带二',
  [TYPE.STRAIGHT]: '顺子',
  [TYPE.PAIR_STRAIGHT]: '连对',
  [TYPE.PLANE]: '飞机',
  [TYPE.PLANE_SOLO]: '飞机带单',
  [TYPE.PLANE_PAIR]: '飞机带对',
  [TYPE.FOUR_SOLO]: '四带二',
  [TYPE.FOUR_PAIR]: '四带两对',
  [TYPE.BOMB]: '炸弹',
  [TYPE.ROCKET]: '火箭'
};

function mk(type, rank, len) {
  return { type: type, rank: rank, len: len };
}

function isConsecutive(ranks) {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

/**
 * 识别一组牌的牌型。
 *
 * @param {number[]} cards card id 数组
 * @returns {{type:string, rank:number, len:number}|null}
 *          rank = 比较用的主点数，len = 长度（顺子的张数 / 飞机的组数 / 其余为 1）
 *          非法组合返回 null
 */
export function classify(cards) {
  const n = cards.length;
  if (n === 0) return null;

  const cnt = new Int8Array(RANK_COUNT);
  let maxRank = -1;
  for (let i = 0; i < n; i++) {
    const r = rankOf(cards[i]);
    cnt[r]++;
    if (r > maxRank) maxRank = r;
  }

  // byCount[k] = 恰好有 k 张的点数列表（升序）
  const byCount = [[], [], [], [], []];
  for (let r = 0; r < RANK_COUNT; r++) {
    if (cnt[r]) byCount[cnt[r]].push(r);
  }

  // 火箭
  if (n === 2 && cnt[13] === 1 && cnt[14] === 1) return mk(TYPE.ROCKET, 14, 1);
  // 炸弹
  if (n === 4 && byCount[4].length === 1) return mk(TYPE.BOMB, byCount[4][0], 1);

  // 单 / 对 / 三
  if (n === 1) return mk(TYPE.SOLO, maxRank, 1);
  if (n === 2 && byCount[2].length === 1) return mk(TYPE.PAIR, byCount[2][0], 1);
  if (n === 3 && byCount[3].length === 1) return mk(TYPE.TRIO, byCount[3][0], 1);

  // 顺子（≥5 张连续单牌，且点数不超过 A）
  if (n >= 5 && byCount[1].length === n && maxRank <= MAX_CHAIN_RANK && isConsecutive(byCount[1])) {
    return mk(TYPE.STRAIGHT, maxRank, n);
  }
  // 连对（≥3 组连续对子）
  if (n >= 6 && n % 2 === 0 && byCount[2].length * 2 === n &&
      maxRank <= MAX_CHAIN_RANK && isConsecutive(byCount[2])) {
    return mk(TYPE.PAIR_STRAIGHT, maxRank, byCount[2].length);
  }

  // 三带一 / 三带二
  if (n === 4 && byCount[3].length === 1 && byCount[1].length === 1) {
    return mk(TYPE.TRIO_SOLO, byCount[3][0], 1);
  }
  if (n === 5 && byCount[3].length === 1 && byCount[2].length === 1) {
    return mk(TYPE.TRIO_PAIR, byCount[3][0], 1);
  }

  // 飞机系（三顺，可带单或带对）
  if (byCount[3].length >= 2) {
    const trios = byCount[3];
    let lo = 0;
    while (lo < trios.length) {
      let hi = lo;
      while (hi + 1 < trios.length && trios[hi + 1] === trios[hi] + 1) hi++;
      const run = trios.slice(lo, hi + 1);
      if (run.length >= 2 && run[run.length - 1] <= MAX_CHAIN_RANK) {
        const res = classifyPlane(cnt, n, run);
        if (res) return res;
      }
      lo = hi + 1;
    }
  }

  // 四带二（四张 + 2 张单牌，这 2 张也可以是一对）
  if (n === 6 && byCount[4].length === 1) {
    // 副牌不能是双王（王炸不作四带二的翅膀）
    if (!(cnt[13] === 1 && cnt[14] === 1)) return mk(TYPE.FOUR_SOLO, byCount[4][0], 1);
  }
  // 四带两对
  if (n === 8 && byCount[4].length === 1 && byCount[2].length === 2) {
    return mk(TYPE.FOUR_PAIR, byCount[4][0], 1);
  }

  return null;
}

/** 飞机的子判定：run 是一段连续的三张点数，尝试「不带 / 带单 / 带对」 */
function classifyPlane(cnt, n, run) {
  const m = run.length;
  const rest = n - 3 * m;
  if (rest === 0) return mk(TYPE.PLANE, run[m - 1], m);

  // 剩余牌分布（把飞机本体各扣掉 3 张）
  const restCnt = new Int8Array(RANK_COUNT);
  let restTotal = 0;
  for (let r = 0; r < RANK_COUNT; r++) {
    const c = cnt[r] - (run.indexOf(r) >= 0 ? 3 : 0);
    if (c > 0) { restCnt[r] = c; restTotal += c; }
  }
  if (restTotal !== rest) return null;

  // 带单：m 张翅膀（可含一对拆成两张单），但不能出现三张/四张同点
  if (rest === m) {
    let ok = true;
    for (let r = 0; r < RANK_COUNT; r++) {
      if (restCnt[r] > 2) { ok = false; break; }
    }
    if (ok) return mk(TYPE.PLANE_SOLO, run[m - 1], m);
  }
  // 带对：m 个对子
  if (rest === 2 * m) {
    let ok = true;
    for (let r = 0; r < RANK_COUNT; r++) {
      if (restCnt[r] !== 0 && restCnt[r] !== 2) { ok = false; break; }
    }
    if (ok) return mk(TYPE.PLANE_PAIR, run[m - 1], m);
  }
  return null;
}

/** a 能否压过 b（b 为当前场上待压的牌型） */
export function beats(a, b) {
  if (!a || !b) return false;
  if (b.type === TYPE.ROCKET) return false;            // 火箭无敌
  if (a.type === TYPE.ROCKET) return true;
  if (a.type === TYPE.BOMB) {
    if (b.type === TYPE.BOMB) return a.rank > b.rank;  // 炸比炸
    return true;                                       // 炸压一切非炸
  }
  if (b.type === TYPE.BOMB) return false;
  if (a.type !== b.type || a.len !== b.len) return false;
  return a.rank > b.rank;
}

/** 是否炸弹或火箭 */
export function isBombLike(m) {
  return !!m && (m.type === TYPE.BOMB || m.type === TYPE.ROCKET);
}

// ── 合法出牌生成（AI 的候选来源 / 玩家的提示）────────────────────────

function idsByRank(hand) {
  const ids = [];
  for (let r = 0; r < RANK_COUNT; r++) ids.push([]);
  for (let i = 0; i < hand.length; i++) ids[rankOf(hand[i])].push(hand[i]);
  return ids;
}

/**
 * 从点数计数中挑翅膀。
 *
 * 优先挑「恰好是一整组」的牌（avail[r] === unit，说明这一组没有别的用途，
 * 拆它不心疼），其次按点数从小到大。variant 用于生成不同的备选（跳过前
 * variant 个候选），给 AI 一点选择余地。
 */
function wingRanks(avail, excludeSet, k, unit, variant) {
  const cands = [];
  for (let r = 0; r < RANK_COUNT; r++) {
    if (excludeSet.has(r)) continue;
    if (avail[r] < unit) continue;
    cands.push(r);
  }
  cands.sort((a, b) => {
    const sa = avail[a] === unit ? 0 : 1;
    const sb = avail[b] === unit ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return a - b;
  });
  if (cands.length - variant < k) return null;
  return cands.slice(variant, variant + k);
}

function cardsFor(ids, ranks, unit) {
  const out = [];
  for (let i = 0; i < ranks.length; i++) {
    const pool = ids[ranks[i]];
    for (let j = 0; j < unit; j++) out.push(pool[j]);
  }
  return out;
}

/**
 * 生成当前手牌的所有合法出牌。
 *
 * @param {number[]} hand 手牌（card id 数组）
 * @param {Object|null} lastPlay 当前待压牌型（{type,rank,len}）或 null
 * @param {Object} [opts]
 *        wingChoices - 每个带牌主牌型额外生成几种翅膀搭配（默认 1）
 *        maxMoves    - 候选硬上限（默认 240，防极端手牌下爆炸）
 * @returns {Array<{cards:number[], counts:Int8Array, type:string, rank:number, len:number}>}
 */
export function generateMoves(hand, lastPlay, opts) {
  opts = opts || {};
  const wingChoices = Math.max(1, opts.wingChoices || 1);
  const maxMoves = opts.maxMoves || 240;

  const avail = countsOf(hand);
  const ids = idsByRank(hand);
  const out = [];
  const seen = new Set();

  function push(cards) {
    if (out.length >= maxMoves) return;
    const c = classify(cards);
    if (!c) return;
    if (lastPlay && !beats(c, lastPlay)) return;
    const key = cards.slice().sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ cards: cards, counts: countsOf(cards), type: c.type, rank: c.rank, len: c.len });
  }

  // 1) 火箭
  if (avail[13] >= 1 && avail[14] >= 1) push([ids[13][0], ids[14][0]]);

  // 2) 炸弹
  for (let r = 0; r < RANK_COUNT; r++) {
    if (avail[r] === 4) push(ids[r].slice(0, 4));
  }

  // 3) 单 / 对 / 三
  for (let r = 0; r < RANK_COUNT; r++) {
    if (avail[r] >= 1) push([ids[r][0]]);
    if (avail[r] >= 2) push([ids[r][0], ids[r][1]]);
    if (avail[r] >= 3) push([ids[r][0], ids[r][1], ids[r][2]]);
  }

  // 4) 三带一 / 三带二
  for (let t = 0; t < RANK_COUNT; t++) {
    if (avail[t] < 3) continue;
    const body = [ids[t][0], ids[t][1], ids[t][2]];
    const excl = new Set([t]);
    for (let v = 0; v < wingChoices; v++) {
      const w1 = wingRanks(avail, excl, 1, 1, v);
      if (w1) push(body.concat(cardsFor(ids, w1, 1)));
      const w2 = wingRanks(avail, excl, 1, 2, v);
      if (w2) push(body.concat(cardsFor(ids, w2, 2)));
    }
  }

  // 5) 顺子（≥5 张连续单牌）
  for (let s = 0; s <= MAX_CHAIN_RANK - 4; s++) {
    let run = 0;
    while (s + run <= MAX_CHAIN_RANK && avail[s + run] >= 1) run++;
    const ranks = [];
    for (let r = s; r < s + run; r++) ranks.push(r);
    for (let L = 5; L <= run; L++) push(cardsFor(ids, ranks.slice(0, L), 1));
  }

  // 6) 连对（≥3 组连续对子）
  for (let s = 0; s <= MAX_CHAIN_RANK - 2; s++) {
    let run = 0;
    while (s + run <= MAX_CHAIN_RANK && avail[s + run] >= 2) run++;
    const ranks = [];
    for (let r = s; r < s + run; r++) ranks.push(r);
    for (let L = 3; L <= run; L++) push(cardsFor(ids, ranks.slice(0, L), 2));
  }

  // 7) 飞机（≥2 组连续三张，可带单 / 带对）
  for (let s = 0; s <= MAX_CHAIN_RANK - 1; s++) {
    let run = 0;
    while (s + run <= MAX_CHAIN_RANK && avail[s + run] >= 3) run++;
    if (run < 2) continue;
    const ranks = [];
    for (let r = s; r < s + run; r++) ranks.push(r);
    for (let L = 2; L <= run; L++) {
      const bodyRanks = ranks.slice(0, L);
      const body = cardsFor(ids, bodyRanks, 3);
      push(body);                                        // 飞机不带
      const excl = new Set(bodyRanks);
      // 带单
      const spareCnt = avail.slice();
      for (let i = 0; i < bodyRanks.length; i++) spareCnt[bodyRanks[i]] -= 3;
      for (let v = 0; v < wingChoices; v++) {
        const w1 = wingRanks(spareCnt, excl, L, 1, v);
        if (w1) push(body.concat(cardsFor(ids, w1, 1)));
        const w2 = wingRanks(spareCnt, excl, L, 2, v);
        if (w2) push(body.concat(cardsFor(ids, w2, 2)));
      }
    }
  }

  // 8) 四带二（四张 + 2 张单牌，这 2 张也可以是一对）
  for (let q = 0; q < RANK_COUNT; q++) {
    if (avail[q] !== 4) continue;
    const body = ids[q].slice(0, 4);
    const excl = new Set([q]);
    const w = wingRanks(avail, excl, 2, 1, 0);
    if (w) push(body.concat(cardsFor(ids, w, 1)));
    // 四带两对
    const w2 = wingRanks(avail, excl, 2, 2, 0);
    if (w2) push(body.concat(cardsFor(ids, w2, 2)));
  }

  return out;
}

// ── 手数（最少几手出完）───────────────────────────────────────────────

const DEFAULT_HAND_BUDGET = 20000;

/**
 * 「剩余 {单张, 对子, 三张, 炸弹} 四元组」的精确最小手数（记忆化）。
 *
 * 只处理 单/对/三/炸 以及它们的带牌形式（三带一/二、四带二/两对）。
 * 顺子/连对/飞机不在这里处理——那是外层 DFS 的职责（要按点数位置枚举）。
 */
const dpRestMemo = new Map();

function dpRest(c1, c2, c3, c4) {
  if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) return Infinity;
  if (c1 === 0 && c2 === 0 && c3 === 0 && c4 === 0) return 0;
  const key = ((c1 * 64 + c2) * 64 + c3) * 64 + c4;
  const hit = dpRestMemo.get(key);
  if (hit !== undefined) return hit;

  let best = Infinity;
  // 基本出法
  if (c1 > 0) best = Math.min(best, 1 + dpRest(c1 - 1, c2, c3, c4));
  if (c2 > 0) best = Math.min(best, 1 + dpRest(c1, c2 - 1, c3, c4));
  if (c3 > 0) best = Math.min(best, 1 + dpRest(c1, c2, c3 - 1, c4));
  if (c4 > 0) best = Math.min(best, 1 + dpRest(c1, c2, c3, c4 - 1));
  // 带牌
  if (c3 > 0 && c1 > 0) best = Math.min(best, 1 + dpRest(c1 - 1, c2, c3 - 1, c4));
  if (c3 > 0 && c2 > 0) best = Math.min(best, 1 + dpRest(c1, c2 - 1, c3 - 1, c4));
  if (c4 > 0 && c1 >= 2) best = Math.min(best, 1 + dpRest(c1 - 2, c2, c3, c4 - 1));
  if (c4 > 0 && c2 >= 2) best = Math.min(best, 1 + dpRest(c1, c2 - 2, c3, c4 - 1));
  // 拆牌（不额外耗手数，只是把大组降级，覆盖「四张拆成三带一」等）
  if (c4 > 0) best = Math.min(best, dpRest(c1 + 1, c2, c3 + 1, c4 - 1));   // 4 → 3+1
  if (c4 > 0) best = Math.min(best, dpRest(c1, c2 + 2, c3, c4 - 1));       // 4 → 2+2
  if (c3 > 0) best = Math.min(best, dpRest(c1 + 1, c2 + 1, c3 - 1, c4));   // 3 → 2+1
  if (c3 > 0) best = Math.min(best, dpRest(c1 + 3, c2, c3 - 1, c4));       // 3 → 1+1+1
  if (c2 > 0) best = Math.min(best, dpRest(c1 + 2, c2 - 1, c3, c4));       // 2 → 1+1

  if (best === Infinity) best = 0;
  dpRestMemo.set(key, best);
  return best;
}

/** 不含顺子的最小手数（含双王的火箭/单张处理） */
function restHands(w) {
  let c1 = 0, c2 = 0, c3 = 0, c4 = 0;
  for (let r = 0; r < 13; r++) {
    const c = w[r];
    if (c === 1) c1++;
    else if (c === 2) c2++;
    else if (c === 3) c3++;
    else if (c === 4) c4++;
  }
  const j = (w[13] ? 1 : 0) + (w[14] ? 1 : 0);
  if (j === 2) {
    // 双王：当火箭一手，或拆成两张单牌（可作三带翅膀）
    return Math.min(1 + dpRest(c1, c2, c3, c4), dpRest(c1 + 2, c2, c3, c4));
  }
  return dpRest(c1 + j, c2, c3, c4);
}

/**
 * 最少需要几手才能出完（斗地主 AI 的核心评估量）。
 *
 * 做法（NOIP2015 斗地主的标准思路）：
 *   1. 外层 DFS 枚举「拆出哪些顺子/连对/飞机」，每拆出一组算一手；
 *   2. 对剩下的牌用 restHands（{单,对,三,炸} 四元组的精确 DP）求手数；
 *   3. 取所有拆法的下界。
 *
 * 飞机的翅膀取「当前最小可用牌」而不穷举翅膀组合——这是一处刻意的启发式，
 * 换来的是单步决策始终毫秒级；对 17 张手牌而言误差极小。
 *
 * 节点预算（默认 20000）耗尽时退化为 restHands 上界，绝不让 Worker 卡死。
 *
 * @param {Int8Array|number[]} counts 点数计数（15 项）
 * @param {number} [budget] 节点预算
 * @returns {number} 最少手数
 */
export function minHands(counts, budget) {
  const LIMIT = budget || DEFAULT_HAND_BUDGET;
  const w = Int8Array.from(counts);
  const memo = new Map();
  let nodes = 0;

  function rec() {
    let empty = true;
    for (let r = 0; r < RANK_COUNT; r++) {
      if (w[r]) { empty = false; break; }
    }
    if (empty) return 0;

    const key = w.join(',');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    nodes++;
    let best = restHands(w);          // 基线：不拆顺子

    if (nodes <= LIMIT) {
      // 单顺
      for (let s = 0; s <= MAX_CHAIN_RANK - 4; s++) {
        let run = 0;
        while (s + run <= MAX_CHAIN_RANK && w[s + run] >= 1) run++;
        for (let L = 5; L <= run; L++) {
          for (let i = 0; i < L; i++) w[s + i]--;
          const sub = 1 + rec();
          for (let i = 0; i < L; i++) w[s + i]++;
          if (sub < best) best = sub;
          if (nodes > LIMIT) break;
        }
        if (nodes > LIMIT) break;
      }
    }
    if (nodes <= LIMIT) {
      // 连对
      for (let s = 0; s <= MAX_CHAIN_RANK - 2; s++) {
        let run = 0;
        while (s + run <= MAX_CHAIN_RANK && w[s + run] >= 2) run++;
        for (let L = 3; L <= run; L++) {
          for (let i = 0; i < L; i++) w[s + i] -= 2;
          const sub = 1 + rec();
          for (let i = 0; i < L; i++) w[s + i] += 2;
          if (sub < best) best = sub;
          if (nodes > LIMIT) break;
        }
        if (nodes > LIMIT) break;
      }
    }
    if (nodes <= LIMIT) {
      // 飞机（本体 + 一对最小可用翅膀）
      for (let s = 0; s <= MAX_CHAIN_RANK - 1; s++) {
        let run = 0;
        while (s + run <= MAX_CHAIN_RANK && w[s + run] >= 3) run++;
        if (run < 2) continue;
        for (let L = 2; L <= run; L++) {
          const bodyRanks = [];
          for (let i = 0; i < L; i++) bodyRanks.push(s + i);
          // 不带翅膀
          for (let i = 0; i < L; i++) w[s + i] -= 3;
          let sub = 1 + rec();
          for (let i = 0; i < L; i++) w[s + i] += 3;
          if (sub < best) best = sub;
          // 带单 / 带对：翅膀取最小的 L 张（组）
          for (const unit of [1, 2]) {
            const wings = pickSmallestWings(w, bodyRanks, L, unit);
            if (!wings) continue;
            applyWings(w, wings, -1);
            for (let i = 0; i < L; i++) w[s + i] -= 3;
            const sub2 = 1 + rec();
            for (let i = 0; i < L; i++) w[s + i] += 3;
            applyWings(w, wings, 1);
            if (sub2 < best) best = sub2;
          }
          if (nodes > LIMIT) break;
        }
        if (nodes > LIMIT) break;
      }
    }

    memo.set(key, best);
    return best;
  }

  return rec();
}

/** 为飞机挑最小的 L 个翅膀（unit=1 取单张，unit=2 取对子）；返回 {ranks, unit} 或 null */
function pickSmallestWings(w, bodyRanks, L, unit) {
  const excl = new Set(bodyRanks);
  const cands = [];
  for (let r = 0; r < RANK_COUNT; r++) {
    if (excl.has(r) || w[r] < unit) continue;
    cands.push(r);
  }
  cands.sort((a, b) => a - b);
  if (cands.length < L) return null;
  return { ranks: cands.slice(0, L), unit: unit };
}

/** 按 unit 增/减翅膀牌张（delta = +1 恢复 / -1 扣除） */
function applyWings(w, wings, delta) {
  for (let i = 0; i < wings.ranks.length; i++) w[wings.ranks[i]] += delta * wings.unit;
}

// ── 对局状态机 ───────────────────────────────────────────────────────

export const SEATS = [0, 1, 2];
export const SEAT_NAMES = ['你', '右家', '左家'];

/** 座位 s 的下一个座位（斗地主固定 0→1→2→0） */
export function nextSeat(s) {
  return (s + 1) % 3;
}

/** createGame 的默认随机源（可注入固定种子做校准复现） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame(seed) {
  const rng = (seed === undefined || seed === null) ? Math.random : mulberry32(seed);
  return {
    rng: rng,
    hands: [[], [], []],
    bottom: [],
    bids: [null, null, null],   // null = 未表态；0 = 不叫；1/2/3 = 叫分
    bidTurn: 0,
    highestBid: 0,
    highestSeat: -1,
    landlord: -1,
    phase: 'idle',              // idle | bidding | playing | over
    turn: 0,
    lastPlay: null,             // { seat, cards, type, rank, len }
    passCount: 0,
    played: [],                 // 已出过的所有 card id（公开信息，记牌器用）
    playedCounts: new Int8Array(RANK_COUNT),
    playCount: [0, 0, 0],       // 各家出牌次数（春天判定）
    multiplier: 1,
    bombCount: 0,
    over: false,
    landlordWin: false,
    log: []
  };
}

/** 发牌（每人 17 张 + 3 张底牌），并把叫分状态复位 */
export function deal(game) {
  const deck = [];
  for (let i = 0; i < DECK_SIZE; i++) deck.push(i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(game.rng() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  for (let s = 0; s < 3; s++) {
    game.hands[s] = sortHand(deck.slice(s * 17, s * 17 + 17));
  }
  game.bottom = deck.slice(51, 54);
  game.bids = [null, null, null];
  game.highestBid = 0;
  game.highestSeat = -1;
  game.landlord = -1;
  game.bidTurn = Math.floor(game.rng() * 3);
  game.lastPlay = null;
  game.passCount = 0;
  game.played = [];
  game.playedCounts = new Int8Array(RANK_COUNT);
  game.playCount = [0, 0, 0];
  game.multiplier = 1;
  game.bombCount = 0;
  game.over = false;
  game.landlordWin = false;
  game.log = [];
  game.phase = 'bidding';
  return game;
}

/**
 * 叫分。score ∈ {0,1,2,3}，0 = 不叫。
 * 必须高于当前最高分（除非不叫）。叫满 3 分立即结束叫分。
 *
 * @returns {{legal:boolean, reason?:string, done:boolean, redeal:boolean}}
 */
export function nextBid(game, seat, score) {
  if (game.phase !== 'bidding') return { legal: false, reason: '当前不是叫分阶段', done: false, redeal: false };
  if (seat !== game.bidTurn) return { legal: false, reason: '还没轮到你叫分', done: false, redeal: false };
  if (score !== 0 && (score < 1 || score > 3)) return { legal: false, reason: '叫分只能是 1/2/3 或不叫', done: false, redeal: false };
  if (score !== 0 && score <= game.highestBid) return { legal: false, reason: `必须高于当前最高分 ${game.highestBid || '无'}`, done: false, redeal: false };

  game.bids[seat] = score;
  if (score > game.highestBid) {
    game.highestBid = score;
    game.highestSeat = seat;
  }
  game.log.push({ kind: 'bid', seat: seat, score: score });

  const allBid = game.bids.every((b) => b !== null);
  if (score === 3 || allBid) {
    if (game.highestSeat < 0) {
      // 三家都不叫 → 流局重发
      deal(game);
      return { legal: true, done: false, redeal: true };
    }
    game.landlord = game.highestSeat;
    return { legal: true, done: true, redeal: false };
  }
  game.bidTurn = nextSeat(seat);
  return { legal: true, done: false, redeal: false };
}

/** 定地主：发底牌、地主首出 */
export function startPlay(game) {
  if (game.landlord < 0) return false;
  game.hands[game.landlord] = sortHand(game.hands[game.landlord].concat(game.bottom));
  game.phase = 'playing';
  game.turn = game.landlord;
  game.lastPlay = null;
  game.passCount = 0;
  game.multiplier = game.highestBid > 0 ? game.highestBid : 1;
  return true;
}

/**
 * 出牌。
 * @returns {{legal:boolean, reason?:string, over?:boolean}}
 */
export function play(game, seat, cards) {
  if (game.phase !== 'playing') return { legal: false, reason: '当前不是出牌阶段' };
  if (game.over) return { legal: false, reason: '对局已结束' };
  if (seat !== game.turn) return { legal: false, reason: '还没轮到你出牌' };
  if (!cards || cards.length === 0) return { legal: false, reason: '请选择要出的牌' };

  // 手牌包含校验
  const have = countsOf(game.hands[seat]);
  const give = countsOf(cards);
  for (let r = 0; r < RANK_COUNT; r++) {
    if (give[r] > have[r]) return { legal: false, reason: '你没有这么多' + RANK_NAMES[r] };
  }
  const c = classify(cards);
  if (!c) return { legal: false, reason: '不构成合法牌型' };
  if (game.lastPlay && !beats(c, game.lastPlay)) {
    return { legal: false, reason: '压不过上家的' + (TYPE_NAMES[game.lastPlay.type] || '牌') };
  }

  // 落地
  const remove = new Map();
  for (let i = 0; i < cards.length; i++) {
    const r = rankOf(cards[i]);
    remove.set(r, (remove.get(r) || 0) + 1);
  }
  const next = [];
  const used = new Map();
  const orig = game.hands[seat];
  for (let i = 0; i < orig.length; i++) {
    const r = rankOf(orig[i]);
    const need = remove.get(r) || 0;
    const got = used.get(r) || 0;
    if (got < need) { used.set(r, got + 1); continue; }
    next.push(orig[i]);
  }
  game.hands[seat] = next;

  for (let i = 0; i < cards.length; i++) {
    game.played.push(cards[i]);
    game.playedCounts[rankOf(cards[i])]++;
  }
  game.playCount[seat]++;

  if (isBombLike(c)) {
    game.bombCount++;
    game.multiplier *= 2;
  }

  game.lastPlay = { seat: seat, cards: cards.slice(), type: c.type, rank: c.rank, len: c.len };
  game.passCount = 0;
  game.log.push({ kind: 'play', seat: seat, cards: cards.slice(), type: c.type });

  if (next.length === 0) {
    finish(game, seat);
    return { legal: true, over: true };
  }
  game.turn = nextSeat(seat);
  return { legal: true, over: false };
}

/** 过牌（领出时不能过） */
export function pass(game, seat) {
  if (game.phase !== 'playing') return { legal: false, reason: '当前不是出牌阶段' };
  if (game.over) return { legal: false, reason: '对局已结束' };
  if (seat !== game.turn) return { legal: false, reason: '还没轮到你' };
  if (!game.lastPlay) return { legal: false, reason: '你是领出方，必须出牌' };

  const leader = game.lastPlay.seat;
  game.passCount++;
  game.log.push({ kind: 'pass', seat: seat });

  if (game.passCount >= 2) {
    game.lastPlay = null;
    game.passCount = 0;
    game.turn = leader;          // 连过两家 → 最后出牌者重新领出
  } else {
    game.turn = nextSeat(seat);
  }
  return { legal: true };
}

/** 结算 */
function finish(game, seat) {
  game.over = true;
  game.phase = 'over';
  game.landlordWin = seat === game.landlord;

  // 春天 / 反春天
  const farmers = SEATS.filter((s) => s !== game.landlord);
  if (game.landlordWin) {
    if (farmers.every((s) => game.playCount[s] === 0)) game.multiplier *= 2;
  } else {
    if (game.playCount[game.landlord] <= 1) game.multiplier *= 2;
  }
  game.winSeat = seat;
}

/** 当前行棋方是否处于「必须出牌、不能过」的领出状态 */
export function mustLead(game) {
  return game.phase === 'playing' && !game.over && !game.lastPlay;
}

/** 给 AI 的公开上下文（不含任何隐藏手牌） */
export function aiContext(game, seat) {
  return {
    seat: seat,
    landlord: game.landlord,
    handSizes: [game.hands[0].length, game.hands[1].length, game.hands[2].length],
    playedCounts: Array.from(game.playedCounts),
    passCount: game.passCount,
    multiplier: game.multiplier
  };
}

/** 结算得分（地主 ±2×倍数，农民 ∓1×倍数） */
export function settle(game) {
  const base = game.multiplier;
  const out = [0, 0, 0];
  for (const s of SEATS) {
    if (s === game.landlord) out[s] = game.landlordWin ? base * 2 : -base * 2;
    else out[s] = game.landlordWin ? -base : base;
  }
  return out;
}

export { mulberry32 };
