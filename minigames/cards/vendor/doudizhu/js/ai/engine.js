/**
 * engine.js - 自研斗地主 AI 本体（纯逻辑）
 *
 * 没有任何 Worker / DOM 全局依赖，因此：
 *   - 主线程的 ai/engine.worker.js 直接 import 它在 Worker 里跑；
 *   - Node 也能直接 import 它做「机机对战」难度校准（不启动浏览器）。
 *
 * ── 决策流程 ──────────────────────────────────────────────────────────
 *
 *   decide(hand, lastPlay, ctx)
 *     1. 硬规则：手里只剩一手牌（minHands === 1）且这一手能走完 → 必走
 *     2. 生成候选：rules.generateMoves（牌型枚举 + 翅膀选取都在规则层完成）
 *     3. 逐个候选打分：出牌后剩几手是主轴，出牌成本/炸弹代价/控制权是修正项
 *     4. 跟牌时再插入一个「不出」候选（含队友让牌与对手威胁的修正）
 *     5. 返回候选列表 + 本步的如实信息（手数前→后 / 是否炸弹 / 是否残局）
 *        —— 最终的「挑哪一手」交给 difficulty.pickMove 按档位采样
 *
 * ── 为什么不做搜索 ────────────────────────────────────────────────────
 *
 * 斗地主是不完全信息博弈：另外两家的手牌看不见，任何固定深度的 α-β 都会在
 * 「对手可能持有什么」上做任意假设，反而不如一个诚实的手数 DP + 记牌推断。
 * 本作把「深度」用在**认知**上（记牌 / 队友 / 残局），这是这一档难度真正
 * 该有的能力差异，也是每一步都能向玩家解释清楚的。
 *
 * ── 打分量纲（与 difficulty.js 的 HAND_UNIT 对齐）─────────────────────
 *
 *   1 手 = 1000 分。候选分主轴 -剩手数×1000；下面这些是修正项，量级都在
 *   一手以内，只用来在「手数相同」的候选之间分高低。
 *
 * @license MIT
 */

import {
  TYPE, TYPE_NAMES, RANK_COUNT, TOTAL_OF_RANK,
  rankOf, countsOf, countsLabel, minHands, generateMoves, isBombLike
} from '../rules.js';
import Difficulty from '../difficulty.js';

const HAND_UNIT = Difficulty.HAND_UNIT;

// ── 打分权重（量纲见文件头）────────────────────────────────────────────

const FREE_PLAY_BONUS = 400;    // 「不吃亏的一手」（出完剩手数不增加）的节奏收益
const BOMB_COST = 2500;         // 动炸弹/火箭的额外代价（约 2.5 手）
const TOP_BONUS = 400;          // 记牌推断出「这手对手压不住」的收益（拿回出牌权）
const TEAM_PASS_BONUS = 900;    // 队友领出时让牌的收益
const DANGER_PENALTY = 2200;    // 对手快走完时让牌的代价
const LEAD_SOLO_PENALTY = 1500; // 对手仅剩 1 张时领出单张的代价

// ── 工具 ─────────────────────────────────────────────────────────────

function countsEqual(a, b) {
  for (let r = 0; r < RANK_COUNT; r++) {
    if (a[r] !== b[r]) return false;
  }
  return true;
}

function subCounts(a, b) {
  const out = new Int8Array(RANK_COUNT);
  for (let r = 0; r < RANK_COUNT; r++) out[r] = a[r] - b[r];
  return out;
}

/** 出牌成本：点数越高越贵（引导「先出小牌、留住大牌」） */
function cardCost(cards) {
  let s = 0;
  for (let i = 0; i < cards.length; i++) s += rankOf(cards[i]) + 1;
  return s * 8;
}

/** 我的对手是谁（地主 vs 两个农民；农民 vs 地主，另一个农民是队友） */
function opponentsOf(seat, landlord) {
  if (seat === landlord) {
    const out = [];
    for (let s = 0; s < 3; s++) if (s !== seat) out.push(s);
    return out;
  }
  return [landlord];
}

function minOpponentSize(ctx, seat) {
  const opps = opponentsOf(seat, ctx.landlord);
  let m = Infinity;
  for (let i = 0; i < opps.length; i++) {
    const n = ctx.handSizes[opps[i]];
    if (n < m) m = n;
  }
  return m;
}

/** 由公开信息反推「对手手里还剩哪些点数、各几张」 */
function remainingForOpponents(myCounts, ctx) {
  const remain = new Int8Array(RANK_COUNT);
  for (let r = 0; r < RANK_COUNT; r++) {
    const played = ctx.playedCounts ? (ctx.playedCounts[r] || 0) : 0;
    const v = TOTAL_OF_RANK[r] - played - myCounts[r];
    remain[r] = v > 0 ? v : 0;
  }
  return remain;
}

/**
 * 记牌推断：这一手对手压得住吗？
 * 只对「单张 / 对子 / 三张 / 炸弹 / 火箭」做严格判断，其余（顺子、飞机…
 * 需要多家配合的牌型）一律保守地认为压得住。
 */
function likelyUnbeatable(move, myCounts, ctx) {
  const remain = remainingForOpponents(myCounts, ctx);
  const rocketPossible = remain[13] >= 1 && remain[14] >= 1;

  if (move.type === TYPE.ROCKET) return true;

  if (move.type === TYPE.BOMB) {
    if (rocketPossible) return false;
    for (let r = move.rank + 1; r < RANK_COUNT; r++) {
      if (remain[r] >= 4) return false;
    }
    return true;
  }

  // 非炸弹：只要有更大的同型组合或任意炸弹/火箭，就压得住
  if (rocketPossible) return false;
  for (let r = 0; r < RANK_COUNT; r++) {
    if (remain[r] >= 4) return false;
  }
  const unit = move.type === TYPE.SOLO ? 1 : move.type === TYPE.PAIR ? 2 : move.type === TYPE.TRIO ? 3 : 0;
  if (unit === 0) return false;      // 其他牌型的压制关系复杂，保守返回 false
  for (let r = move.rank + 1; r < RANK_COUNT; r++) {
    if (remain[r] >= unit) return false;
  }
  return true;
}

/** 残局修正：对手只剩一两张时的出法偏好 */
function endgameAdjust(move, myCounts, ctx, leading) {
  const oppMin = minOpponentSize(ctx, ctx.seat);
  let s = 0;
  if (leading && oppMin <= 1) {
    // 对手一张牌：他压得住就能立刻走完。领出单张很危险，优先出组合牌
    if (move.type === TYPE.SOLO) {
      s -= LEAD_SOLO_PENALTY;
      // 同一惩罚下，越大的单张越安全（对手更可能接不住）
      s += move.rank * 30;
    } else {
      s += 300;
    }
  }
  return s;
}

// ── 主入口 ───────────────────────────────────────────────────────────

/**
 * 为 seat 决定这一步怎么走。
 *
 * @param {number[]} hand 我的手牌（card id 数组）
 * @param {{seat:number,type:string,rank:number,len:number}|null} lastPlay 当前待压牌型
 * @param {Object} ctx 公开上下文
 *        { seat, landlord, handSizes:[3], playedCounts:[15], passCount, level }
 * @returns {{ candidates: Array, info: Object }}
 */
export function decide(hand, lastPlay, ctx) {
  const t0 = now();
  const def = Difficulty.getLevel(ctx.level || Difficulty.DEFAULT_LEVEL);
  const myCounts = countsOf(hand);
  const handsBefore = minHands(myCounts);
  const leading = !lastPlay;

  const moves = generateMoves(hand, lastPlay, { wingChoices: def.wingChoices });

  const ctxFull = {
    seat: ctx.seat,
    landlord: ctx.landlord,
    handSizes: ctx.handSizes,
    playedCounts: ctx.playedCounts || new Array(RANK_COUNT).fill(0),
    passCount: ctx.passCount || 0
  };

  // ── 硬规则 1：手里就是一手牌 → 必走（任何档位）──
  if (handsBefore === 1 && moves.length) {
    const win = moves.find((m) => countsEqual(m.counts, myCounts));
    if (win) {
      return finish([
        { cards: win.cards, score: WIN_SCORE(), meta: meta(win, 1, true, def, ctxFull, myCounts) }
      ], { handsBefore: 1, handsAfter: 0, forced: 'win', level: def.level }, t0);
    }
  }

  // ── 候选为空：只能过（跟牌时；领出时不可能为空）──
  if (!moves.length) {
    return finish(
      [{ cards: null, score: 0, meta: { type: 'pass', typeName: '不出', handsAfter: handsBefore } }],
      { handsBefore: handsBefore, handsAfter: handsBefore, forced: 'none', level: def.level, note: '无牌可压' },
      t0
    );
  }

  // ── 逐个候选打分 ──
  const scored = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const after = subCounts(myCounts, m.counts);
    const h = minHands(after);

    let s = -h * HAND_UNIT;
    s -= cardCost(m.cards);
    if (h <= handsBefore) s += FREE_PLAY_BONUS;
    if (isBombLike(m)) s -= BOMB_COST;
    if (leading && def.remember && likelyUnbeatable(m, myCounts, ctxFull)) s += TOP_BONUS;
    if (def.endgame) s += endgameAdjust(m, myCounts, ctxFull, leading);

    scored.push({ cards: m.cards, score: s, meta: meta(m, h, false, def, ctxFull, myCounts) });
  }

  // 同 (牌型, 主点, 长度) 只留分最高的一手：翅膀的具体搭配对局面几乎无差，
  // 去掉它们能让采样池干净很多
  const bestByShape = new Map();
  for (let i = 0; i < scored.length; i++) {
    const c = scored[i];
    const key = c.meta.type + '|' + c.meta.rank + '|' + c.meta.len;
    const prev = bestByShape.get(key);
    if (!prev || c.score > prev.score) bestByShape.set(key, c);
  }
  let candidates = Array.from(bestByShape.values());

  // ── 跟牌时插入「不出」候选 ──
  if (!leading) {
    const leaderIsTeammate = def.teamwork && ctx.seat !== ctx.landlord && lastPlay.seat !== ctx.landlord;
    let ps = -handsBefore * HAND_UNIT;
    if (leaderIsTeammate) {
      ps += TEAM_PASS_BONUS;
    } else {
      const danger = minOpponentSize(ctxFull, ctx.seat);
      if (danger <= 2) ps -= DANGER_PENALTY;
      else if (danger <= 4) ps -= DANGER_PENALTY / 3;
    }
    candidates.push({
      cards: null,
      score: ps,
      meta: {
        type: 'pass', typeName: '不出', rank: -1, len: 0,
        handsAfter: handsBefore, bomb: false, endgame: false, remembered: false,
        teammatePass: !!(def.teamwork && ctx.seat !== ctx.landlord && lastPlay.seat !== ctx.landlord)
      }
    });
  }

  const info = {
    handsBefore: handsBefore,
    handsAfter: Math.min.apply(null, candidates.map((c) => c.meta.handsAfter)),
    forced: 'none',
    level: def.level,
    candidateCount: candidates.length
  };
  return finish(candidates, info, t0);
}

/** 候选的如实元信息（面板展示用，不参与采样） */
function meta(move, handsAfter, forcedWin, def, ctx, myCounts) {
  return {
    type: move.type,
    typeName: TYPE_NAMES[move.type] || move.type,
    rank: move.rank,
    len: move.len,
    handsAfter: handsAfter,
    bomb: isBombLike(move),
    endgame: !!def.endgame,
    remembered: !!(def.remember && likelyUnbeatable(move, myCounts, ctx)),
    forcedWin: !!forcedWin
  };
}

function WIN_SCORE() {
  return Difficulty.WIN_BASE + 1000;
}

function finish(candidates, info, t0) {
  info.elapsedMs = Math.max(0, Math.round(now() - t0));
  return { candidates: candidates, info: info };
}

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

// ── 给侧栏用的牌面摘要 ───────────────────────────────────────────────

/** 候选牌面摘要，如 "K×3 7" */
export function cardsSummary(cards) {
  if (!cards || !cards.length) return '不出';
  return countsLabel(countsOf(cards));
}

export default { decide, cardsSummary };
