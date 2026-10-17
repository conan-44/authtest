/**
 * difficulty.js - 难度档位的单一事实来源
 *
 * 这个文件只描述「什么档位用什么参数」，以及「拿到引擎候选后怎么挑一手」。
 * 它不碰 DOM、不碰 Worker 消息，只 export 一个 Difficulty 对象。
 * 主线程（UI 显示、根节点采样）与 ai/engine.js（认知开关）import 同一份定义，
 * 杜绝「同一条难度规则散落在多个文件」。
 *
 * ── 与 04.Gomoku 的差异 ───────────────────────────────────────────────
 *
 * 五子棋的难度旋钮是「搜索深度 + 候选宽度 + 根节点采样」；斗地主是**不完全信息
 * 博弈**，没有能精确求解的浅层搜索（对手手牌看不见），所以本作的难度旋钮是
 * 「认知能力 + 根节点采样」：
 *
 *   1) 认知弱化（"看不看得懂局面"）：
 *      wingChoices - 每个带牌主牌型枚举几种翅膀搭配（低档只想到一种出法）
 *      remember    - 是否记牌（由已出牌反推对手可能持有的大牌）
 *      teamwork    - 农民之间是否懂得不互相压牌
 *      endgame     - 残局求解（一手走完 / 对手剩一张时的防守）
 *
 *   2) 根节点采样（"看懂了会不会走歪"）：
 *      temperature - softmax 温度（候选分单位，1 手 = HAND_UNIT 分）
 *      blunder     - 触发「从更宽的池子里随机挑一手」的概率
 *
 * ── 不可弱化的硬底线（防"看起来像 bug"）──────────────────────────────
 *
 * 不论什么档位，引擎根节点始终执行：
 *   ① 能一手走完 → 必走（"能赢不赢"不叫菜，叫坏了）；
 *   ② 领出时不能过（规则约束，不是难度问题）。
 * 这两条在 ai/engine.js 里实现，采样层永远碰不到它们。
 *
 * 此外采样带**损失上限**：候选分差超过档位上限时强制回引擎首选，
 * 避免"放着顺子不拆、去拆一张 2"这种不像弱、像坏的出牌。
 *
 * ── 分数刻度 ─────────────────────────────────────────────────────────
 *
 * 引擎的候选分以「手数」为主轴：HAND_UNIT = 1000 分 = 少一手牌。
 * 一发牌（17 张）的典型手数是 5~9 手，所以候选分常见区间是 -9000 ~ -1000，
 * 温度与损失上限都按这个量级调。
 *
 * ── 校准记录 ─────────────────────────────────────────────────────────
 *
 * 2026-09-12，Node 直接 import rules.js + ai/engine.js 驱动机机对战
 * （每组 300 局，地主座位 0/1/2 轮转，强制指定地主以隔离叫分运气）：
 *
 *   L2 vs L1 : 高当地主胜率 55%  vs 低当地主胜率 32%  → +23pt
 *   L3 vs L2 : 54% vs 37%  → +17pt
 *   L4 vs L3 : 45% vs 37%  →  +8pt
 *   L5 vs L4 : 47% vs 43%  →  +5pt
 *   L6 vs L5 : 44% vs 44%  →   0pt
 *   L6 vs L1 : 74% vs 21%  → +54pt
 *
 * 结论：L1→L5 梯度单调无倒挂；L6 与 L5 棋力接近——第六档唯一多出来的是
 * wingChoices 3（带牌主牌型多枚举几种翅膀搭配），实测收益落在噪声里。
 * 这一档的定位是「不加遮掩的引擎全力」，而不是「比大师强一个档次」，
 * 所以如实保留，不人为造出差距。
 *
 * 单步决策耗时（Node 22，真实 17 张手牌）：中位 <1ms，未见超过 3ms；
 * 400 局机机对战总耗时约 9 秒（含全部规则与 AI 计算）。
 *
 * @license MIT
 */

export const HAND_UNIT = 1000;       // 1 手 = 1000 候选分

/** 采样时允许的最大分差（候选分单位） */
export const LOSS_CAP = { 1: 1400, 2: 800, 3: 350, 4: 140, 5: 40, 6: 0 };

/** 失误模式下允许的最大分差（比正常采样更宽，但仍有底） */
export const BLUNDER_CAP = 2600;

/** 必胜分阈值：分值达到这个量级说明引擎已判定「这一手直接走完」 */
export const WIN_BASE = 90000;

/**
 * 六档难度。
 *
 * 字段说明：
 *   label       - 显示名，UI 难度按钮文案直接读它，不要另外硬编码
 *   wingChoices - 每个带牌主牌型枚举几种翅膀搭配
 *   remember    - 是否记牌（反推对手可能持有的大牌）
 *   teamwork    - 农民之间是否懂得不互相压牌
 *   endgame     - 是否启用残局求解
 *   temperature - softmax 温度（候选分）；0 表示永远取引擎首选
 *   blunder     - 在更宽候选池里随机挑一手的概率（0~1）
 *   desc        - 档位描述（难度选择菜单展示）
 */
export const LEVELS = [
  { level: 1, label: '入门', wingChoices: 1, remember: false, teamwork: false, endgame: false, temperature: 800, blunder: 0.35,
    desc: '只想到最基本的出法，不太会拆牌，经常把手牌拆散。' },
  { level: 2, label: '初级', wingChoices: 1, remember: false, teamwork: false, endgame: false, temperature: 400, blunder: 0.15,
    desc: '会按最少手数出牌，但不记牌、不懂配合，容易漏掉机会。' },
  { level: 3, label: '中级', wingChoices: 2, remember: false, teamwork: true,  endgame: false, temperature: 150, blunder: 0.03,
    desc: '农民之间知道让牌，出法也更多样，偶尔失手。' },
  { level: 4, label: '高级', wingChoices: 2, remember: true,  teamwork: true,  endgame: false, temperature: 40,  blunder: 0,
    desc: '会记牌，能判断自己出的牌压不压得住，收放有度。' },
  { level: 5, label: '大师', wingChoices: 2, remember: true,  teamwork: true,  endgame: true,  temperature: 0,   blunder: 0,
    desc: '残局不失误：能一手走完必走，对手剩一张时不乱送。' },
  { level: 6, label: '宗师', wingChoices: 3, remember: true,  teamwork: true,  endgame: true,  temperature: 0,   blunder: 0,
    desc: '引擎全力：更多出法枚举 + 完整记牌与残局求解。' }
];

export const DEFAULT_LEVEL = 3;

/** 允许「档位号」或「档位定义对象」两种入参 */
function resolveDef(levelOrDef) {
  if (levelOrDef && typeof levelOrDef === 'object') return levelOrDef;
  return getLevel(levelOrDef);
}

/** 按档位号取定义；越界回落到默认档位 */
function getLevel(level) {
  for (let i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].level === level) return LEVELS[i];
  }
  return getLevel(DEFAULT_LEVEL);
}

/** 候选是否是「已判定直接走完」的一手 */
function isWinning(candidate) {
  return typeof candidate.score === 'number' && candidate.score >= WIN_BASE;
}

/**
 * 按 softmax 权重在候选间采样。
 *
 *   w_i = exp(-(best - s_i) / temperature)
 *
 * temperature 越大越容易选中次优（越弱）；temperature <= 0 或只有一个候选时
 * 退化为取最优（同分随机打破平局）。
 */
function pickByTemperature(candidates, temperature) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  let best = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].score > best) best = candidates[i].score;
  }

  if (!(temperature > 0)) {
    const sameBest = [];
    for (let j = 0; j < candidates.length; j++) {
      if (candidates[j].score === best) sameBest.push(candidates[j]);
    }
    return sameBest[Math.floor(Math.random() * sameBest.length)];
  }

  let total = 0;
  const weights = new Array(candidates.length);
  for (let k = 0; k < candidates.length; k++) {
    let w = Math.exp(-(best - candidates[k].score) / temperature);
    if (!(w > 0)) w = 1e-9;   // 分差过大时 exp 下溢，给极小下限保证人人有机会
    weights[k] = w;
    total += w;
  }
  let roll = Math.random() * total;
  for (let m = 0; m < candidates.length; m++) {
    roll -= weights[m];
    if (roll <= 0) return candidates[m];
  }
  return candidates[candidates.length - 1];
}

/**
 * 从引擎给出的候选里，按档位挑一手。
 *
 * @param {Array<{cards:number[]|null, score:number}>} candidates
 *        cards === null 表示「不出」（过牌）
 * @param {number|Object} levelOrDef 档位号或档位定义对象
 * @returns {{cards:number[]|null, score:number, suboptimal:boolean}|null}
 *          suboptimal = true 表示这一手不是引擎评分最高的，UI 必须如实标注「次优」
 */
export function pickMove(candidates, levelOrDef) {
  if (!candidates || candidates.length === 0) return null;
  const def = resolveDef(levelOrDef);

  const tagged = candidates.slice().sort((a, b) => b.score - a.score);
  const top = tagged[0];

  // 已判定「直接走完」：永远走它，低档也不许错过
  if (isWinning(top)) return tag(top, top);

  if (tagged.length === 1 || (def.temperature <= 0 && def.blunder <= 0)) return tag(top, top);

  // 剔除分差过大的候选
  const cap = LOSS_CAP[def.level] !== undefined ? LOSS_CAP[def.level] : 300;
  const pool = [];
  for (let i = 0; i < tagged.length; i++) {
    if (top.score - tagged[i].score > cap) continue;
    pool.push(tagged[i]);
  }
  if (pool.length <= 1) return tag(top, top);

  // 失误模式：在更宽的候选池里均匀随机取一手
  if (def.blunder > 0 && Math.random() < def.blunder) {
    const wide = [];
    for (let j = 0; j < tagged.length; j++) {
      if (top.score - tagged[j].score > BLUNDER_CAP) continue;
      wide.push(tagged[j]);
    }
    if (wide.length > 1) return tag(top, wide[Math.floor(Math.random() * wide.length)]);
  }

  return tag(top, pickByTemperature(pool, def.temperature));
}

/** 把 pickMove 选中的候选打上「是否次优」标记 */
function tag(top, chosen) {
  return {
    cards: chosen.cards,
    score: chosen.score,
    suboptimal: chosen !== top,
    candidate: chosen
  };
}

const Difficulty = {
  HAND_UNIT: HAND_UNIT,
  LEVELS: LEVELS,
  DEFAULT_LEVEL: DEFAULT_LEVEL,
  LOSS_CAP: LOSS_CAP,
  BLUNDER_CAP: BLUNDER_CAP,
  WIN_BASE: WIN_BASE,
  resolveDef: resolveDef,
  getLevel: getLevel,
  isWinning: isWinning,
  pickByTemperature: pickByTemperature,
  pickMove: pickMove
};

export default Difficulty;
