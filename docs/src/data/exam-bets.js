/**
 * 考前押卷（v3.6）：把「考试」从"读一个结果"变成"进考场前做一次判断"。
 *
 * 为什么加这个：这一局有 72 次决策，但玩家面对的**信息永远是确定的**——
 * 唯一变数是内容作者写好的 risk 骰子。考试本来是全场最有分量的时刻，
 * 却只是"刷了多少知识就考多少分"。押卷让那一周多一个真正的选择：
 * 你是把范围砍到七成去啃高频考点，还是赌出题方向，还是老老实实睡够。
 *
 * 设计上的四条约束（每条都有测试钉着）：
 *   1. **不是免费加分**：三种选择的期望因子都在 1 附近（见 expectedFactor，
 *      `test/exam-bet.test.js` 里有一条"期望不占优"）。谁的期望明显高的那天，
 *      这个机制就退化成"每场考试点一下的税"。
 *   2. **账一定要结**：押错的后果是可观测的（分数折算 + 那一科两周内掉得更快 +
 *      真实的疲劳/心情损失），不是一句旁白。
 *   3. **不消耗随机数**：命中判定走 betRoll（把 rngState 当**输入**混一次，
 *      不推进它），所以同种子下"押与不押"的随机序列逐位相同——
 *      押卷只改变它自己那一科/那一场的分数，不会把整局的随机流挪位。
 *      这也是它能被严格测试的前提（见 test/exam-bet.test.js 的 rngState 断言）。
 *   4. **纯数据 + 纯函数**：这个文件不 import 引擎，界面/引擎/测试都能单独用它。
 *
 * 刻意不做的事：押卷不进事件池（不登记 calendar.js）、不进内容包（PACK_SECTIONS 仍是 7 段）、
 * 也不进周目继承（legacy.js 一条都不加）——赌是这一局的事，赢了不该变成下一局的开局白拿。
 */

/** 押卷的四个选项（顺序就是界面上的顺序）。 */
export const BET_MODES = ['focus', 'gamble', 'rest', 'none'];

/** 押重点：命中/押错的分数系数，以及押错之后那一科额外遗忘的倍率与周数。 */
export const FOCUS_HIT_FACTOR = 1.25;
export const FOCUS_MISS_FACTOR = 0.72;
export const FOCUS_BACKFIRE_MUL = 1.9;
export const FOCUS_BACKFIRE_WEEKS = 2;

/** 押题（赌方向）：整场全科的系数，以及押错时的状态代价。 */
export const GAMBLE_HIT_FACTOR = 1.16;
export const GAMBLE_MISS_FACTOR = 0.86;
export const GAMBLE_CHANCE = 0.5;
export const GAMBLE_MISS_FATIGUE = 8;
export const GAMBLE_MISS_MOOD = -2;

/** 考前睡够：不当赌注，把状态养回来（考试当天的疲劳直接受益）。 */
export const REST_FATIGUE = -12;
export const REST_MOOD = 2;

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const round = (value, digits = 3) => Number(value.toFixed(digits));

/**
 * 押重点的命中率。
 *
 * 上限刻意压在 0.65：命中系数 1.25 / 押错系数 0.72 这一对数字下，
 * 命中率一旦超过 0.65，期望就明显赚了——那这个选择会退化成"每场考试都押"的税。
 * 「综合素质」代表你会不会看风向（老师强调过什么、往年怎么出），
 * 押自己的弱科再加一点：弱科本来就是老师单独拎出来讲的那几科，这是信息，不是运气。
 */
export function focusChance({ comprehensive = 50, weakKeys = [], subject = null } = {}) {
  const base = 0.55 + clamp(Number(comprehensive) || 0, 0, 100) / 1000;
  const weakBonus = subject && Array.isArray(weakKeys) && weakKeys.includes(subject) ? 0.05 : 0;
  return round(clamp(base + weakBonus, 0.4, 0.65));
}

/** 押题（赌方向）的命中率：固定五五开，谁都看得出来这是赌。 */
export function gambleChance() {
  return GAMBLE_CHANCE;
}

/** 某一档在本场考试的命中率（none / rest 恒为 1，用于界面统一显示）。 */
export function chanceFor(mode, ctx = {}) {
  if (mode === 'focus') return focusChance(ctx);
  if (mode === 'gamble') return gambleChance();
  return 1;
}

/** 命中时这一档的期望系数（全科口径；focus 只作用于押的那一科）。 */
export function hitFactor(mode) {
  if (mode === 'focus') return FOCUS_HIT_FACTOR;
  if (mode === 'gamble') return GAMBLE_HIT_FACTOR;
  return 1;
}

/** 押错时这一档的系数。 */
export function missFactor(mode) {
  if (mode === 'focus') return FOCUS_MISS_FACTOR;
  if (mode === 'gamble') return GAMBLE_MISS_FACTOR;
  return 1;
}

/**
 * 期望系数：`p × 命中系数 + (1-p) × 押错系数`。
 * 用来钉住"不是免费加分"——四条都必须在 1 附近（见测试）。
 */
export function expectedFactor(mode, chanceValue) {
  if (mode === 'focus' || mode === 'gamble') {
    const p = clamp(Number(chanceValue) || 0, 0, 1);
    return round(p * hitFactor(mode) + (1 - p) * missFactor(mode));
  }
  return 1;
}

/**
 * 不消耗游戏随机数的命中判定。
 *
 * `state` 直接喂 game.rngState：它是个 32 位整数、会随局面变化，
 * 但这里**只读不写**——玩家押与不押，整局的随机流因此逐位相同。
 * 同种子 + 同构筑 + 同操作序列 ⇒ 同一场考试的押卷结果必然相同（可复现、可测试）。
 */
export function betRoll(state, salt) {
  let h = (Number(state) >>> 0) ^ 0x9e3779b9;
  const text = String(salt ?? '');
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 押错之后，那一科在接下来的两周里忘得更快的记账。 */
export function backfireOf(game, key, turn) {
  return {
    key,
    mul: FOCUS_BACKFIRE_MUL,
    fromTurn: turn,
    untilTurn: turn + FOCUS_BACKFIRE_WEEKS,
  };
}

/**
 * 白名单归一：只认 BET_MODES 里的 id，focus 必须带一个合法科目；
 * 其余字段（比如前端夹带的 factor / score）一律丢掉——和 legacy.js 一个写法。
 * 不合法就返回 null（调用方抛 GameError），绝不"猜一个默认值"。
 */
export function normalizeBet(input, subjectKeys = []) {
  if (!input || typeof input !== 'object') return null;
  const mode = String(input.mode ?? '');
  if (!BET_MODES.includes(mode)) return null;
  if (mode !== 'focus') return { mode, subject: null };
  const subject = String(input.subject ?? '');
  if (!subjectKeys.includes(subject)) return null;
  return { mode, subject };
}

/** 界面用的选项文案（引擎只管数值，这里只管怎么说人话）。 */
export const EXAM_BETS = [
  {
    id: 'focus',
    name: '押重点（砍范围）',
    icon: '🔪',
    order: 1,
    desc: '把复习范围缩到七成，只啃高频考点。命中的话这一科 ×1.25；押错 ×0.72，而且没覆盖的那一块，往后两周补起来格外费劲。',
    risk: '押错：这一科当场打折，之后两周还得还债',
    gain: '押中：这一科 ×1.25',
    needsSubject: true,
  },
  {
    id: 'gamble',
    name: '押题（赌方向）',
    icon: '🎲',
    order: 2,
    desc: '花一整周研究"今年可能怎么出"，五五开。命中全科 ×1.16；押错全科 ×0.86，而且白熬一周。',
    risk: '押错：全科 ×0.86，疲劳 +8',
    gain: '押中：全科 ×1.16',
    needsSubject: false,
  },
  {
    id: 'rest',
    name: '考前睡够',
    icon: '🛌',
    order: 3,
    desc: '不赌分数，把状态养回来：疲劳 -12、心情 +2。夜里那盏灯，你关了。',
    risk: '不押：没有额外加成',
    gain: '疲劳 -12、心情 +2（考试当天少扣效率）',
    needsSubject: false,
  },
  {
    id: 'none',
    name: '不押（直接考）',
    icon: '🙅',
    order: 4,
    desc: '什么也不赌，复习到哪算哪。这一场的分数就是你这几周的样子。',
    risk: '没有任何加成，也没有任何代价',
    gain: '本场 ×1.0',
    needsSubject: false,
  },
];

export const BET_MAP = Object.fromEntries(EXAM_BETS.map((bet) => [bet.id, bet]));

/**
 * 押卷自带的成就：内容文件声明，引擎只按 flag 捡（和 events5/6/7 一个写法）。
 * 这些 flag 只写 game.flags，不写进 CHOICE_MEMORIES——
 * 押卷刻意不进周目继承，赢了不该变成下一局的开局白拿。
 */
export const BET_ACHIEVEMENTS = [
  { flag: 'betHitFocus', icon: '🔪', name: '押中重点', desc: '考前把范围砍到七成，还真的押中了' },
  { flag: 'betMissFocus', icon: '🩹', name: '押掉的那一科', desc: '砍掉的范围在成绩单上原形毕露' },
  { flag: 'betHitGamble', icon: '🎲', name: '赌对方向', desc: '花一周赌出题路子，赌赢了' },
  { flag: 'betMissGamble', icon: '💸', name: '白熬一周', desc: '研究的那一类题，一题没出' },
  { flag: 'betRest', icon: '🛌', name: '考前睡够的人', desc: '进考场前那一觉，比多做两套卷子值' },
  { flag: 'betAllIn', icon: '🧨', name: '每场都赌', desc: '12 场考试，你一场都没放过' },
];
