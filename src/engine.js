/**
 * 马鞍山二中模拟器 · 核心引擎 v2
 *
 * 纯逻辑、零依赖：CLI、网页服务、平衡脚本、测试都调用这一份引擎。
 *
 * v2 相对 v1 增加的自由度：
 *   - 3+1+2 选科：物理/历史二选一 + 四门再选二，还有一次改选科机会
 *   - 每周两段制：主行动 + 周末安排，一局 72 次决策
 *   - 天赋 / 家庭背景 / 高考目标，构筑影响全局
 *   - 五个人物好感度（班主任、数学老师、同桌、父母、喜欢的人）
 *   - 商店与道具，零花钱有了用途
 *   - 自由模式：什么时候高考由玩家决定
 */

import {
  ALL_SUBJECT_KEYS,
  COLLEGE_TIERS,
  CORE_KEYS,
  DEFAULT_WEEKS_PER_SEMESTER,
  ELECTIVE_KEYS,
  PRIMARY_KEYS,
  SCHOOL,
  SEMESTERS,
  STAT_META,
  SUBJECT_MAP,
  SUBJECT_POOL,
  TOTAL_MAX,
  collegeTierFor,
  examPlan,
  rankFromScore,
  subjectsFor,
  validateSelection,
} from './data/school.js';
import {
  AVATAR_MAP,
  AVATARS,
  BACKGROUND_MAP,
  BACKGROUNDS,
  CHARACTER_PRESETS,
  FLAW_MAP,
  FLAWS,
  GOALS,
  GOAL_MAP,
  LEGACY,
  NICKNAMES,
  NPCS,
  NPC_KEYS,
  NPC_MAP,
  PERSONALITIES,
  PERSONALITY_MAP,
  POINT_BUY,
  POINT_BUDGET,
  POINT_BUY_MAP,
  PRESET_MAP,
  TRAITS,
  TRAIT_MAP,
  TRACKS,
  TRACK_MAP,
  emptyMods,
  sumMods,
} from './data/character.js';
import { ITEMS, ITEM_MAP } from './data/items.js';
import { ACTIONS, ACTION_MAP } from './data/actions.js';
import { EVENTS } from './data/events.js';
import { EXTRA_EVENTS } from './data/events2.js';
import { SEASONAL_EVENTS } from './data/events3.js';
import { ABSTRACT_EVENTS } from './data/events4.js';
import { CAMPUS_ACHIEVEMENTS, CAMPUS_EVENTS } from './data/events5.js';
import { CHAIN_ACHIEVEMENTS, CHAIN_EVENTS } from './data/events6.js';
import {
  calendarOf,
  matchesSchedule,
  scheduleFor,
  scheduleHint,
} from './data/calendar.js';
import { buildCast, CAST_ROLES, CAST_ROLE_MAP, randomStudentName } from './data/cast.js';
import {
  VOLUNTEER_OPTIONS,
  VOLUNTEER_SLOTS,
  MAJORS,
  buildVolunteerBoard,
  levelFor,
  resolveVolunteers,
} from './data/colleges.js';
import { createStream } from './data/names.js';
import { advanceStory, recordStory, storyCatalog, storyEvents, storyProgress } from './story.js';
import { relationGraph, renderTreeText, treeStats } from './tree.js';
import { chance, hashSeed, nextFloat, pick, pickWeighted, randFloat, randInt, shuffle } from './rng.js';
import {
  PACK_FORMAT,
  checksumPack,
  normalizePack,
  parsePackText,
  planPack,
  summarizePack,
  validatePack,
} from './content.js';

/** 存档格式版本（结构变了才动它）。 */
export const VERSION = 2;
/** 游戏版本。内容包的 `requires.app` 拿它做兼容判断；和 package.json 必须一致（有测试盯着）。 */
export const GAME_VERSION = '2.7.0';

/* ------------------------------------------------------- 内容（可热更新） */

/**
 * 内容基线：**内置的那一份**。
 *
 * 所有内容包都基于这份基线合并，而不是"在上一份包上再叠一层"——
 * 否则连打三个包之后，谁也不知道最后是什么状态，也没法一键回到官方内容。
 */
const BASELINE = {
  events: [
    ...EVENTS,
    ...EXTRA_EVENTS,
    ...SEASONAL_EVENTS,
    ...ABSTRACT_EVENTS,
    ...CAMPUS_EVENTS,
    // 因果链事件：第一环从随机池进来，后面几环带 chainOnly，只能被"链"出来
    ...CHAIN_EVENTS,
    // 剧情事件也并进事件表，但带 story: true，不会进随机池
    ...storyEvents(),
  ],
  items: [...ITEMS],
  traits: [...TRAITS],
  personalities: [...PERSONALITIES],
  flaws: [...FLAWS],
  actions: [...ACTIONS],
  /*
   * 平衡基线：EFF / DIFFICULTY 在文件后面才定义（它们依赖更靠下的辅助函数），
   * 所以这里先占位，等它们定义完立刻由 initBalanceBaseline() 补上。
   */
  eff: {},
  difficulty: {},
};

/** EFF / DIFFICULTY 定义完之后立刻调用，把平衡基线补齐。 */
function initBalanceBaseline() {
  BASELINE.eff = { ...EFF };
  BASELINE.difficulty = Object.fromEntries(Object.entries(DIFFICULTY).map(([key, value]) => [key, { ...value }]));
}

/**
 * 全部事件。**注意：这是一个会被原地改写的数组。**
 *
 * 内容包不能重新赋值它（别处已经 import 了它的引用），所以热更新走
 * `arr.length = 0; arr.push(...)` 这条路——引用不变，内容全换。
 */
export const ALL_EVENTS = BASELINE.events.slice();
export const EVENT_MAP = Object.fromEntries(ALL_EVENTS.map((event) => [event.id, event]));

/** 当前生效的内容包（没打过包就是 null）。 */
let activePack = null;
let activeMeta = null;

/** 原地替换数组内容（保留引用）。 */
function replaceInPlace(array, list) {
  array.length = 0;
  for (const item of list) array.push(item);
}

/** 原地重建 id → 条目的索引（保留 map 的引用）。 */
function syncMap(map, list) {
  for (const key of Object.keys(map)) delete map[key];
  for (const item of list) if (item?.id !== undefined) map[item.id] = item;
}

/** 行动只能被改文案（名字 / 说明），结构永远来自代码。 */
function syncActions(list) {
  const byId = new Map(list.map((action) => [action.id, action]));
  for (const action of ACTIONS) {
    const next = byId.get(action.id);
    if (!next) continue;
    if (next.name !== undefined) action.name = next.name;
    if (next.desc !== undefined) action.desc = next.desc;
  }
}

/** 平衡：EFF 与各难度就地覆盖（引用同样不能换）。 */
function syncBalance(plan) {
  Object.assign(EFF, plan.eff);
  for (const [key, value] of Object.entries(plan.difficulty)) {
    if (DIFFICULTY[key]) Object.assign(DIFFICULTY[key], value);
  }
}

/** 内容包的校验上下文。 */
function packContext() {
  return {
    appVersion: GAME_VERSION,
    eventIds: BASELINE.events.map((event) => event.id),
    itemIds: BASELINE.items.map((item) => item.id),
    actionIds: BASELINE.actions.map((action) => action.id),
    difficultyKeys: Object.keys(DIFFICULTY),
  };
}

/**
 * 应用一个内容包（热更新）。**原地改写**引擎里的内容，不重启、不重装。
 *
 * 既接受解析好的对象，也接受**原始 JSON 文本**（顺带剥 BOM、识别中文标点 /
 * 尾逗号 / 注释这些 Windows 上最常见的坑，见 parsePackText）。
 * 文本读不懂时返回 `{ ok: false }` 而不是抛异常，让 CLI / 服务端 / 离线网页
 * 三条路径都能用同样的方式报错。
 *
 * @param {object|string} pack 内容包（对象或 JSON 文本）
 * @returns {{ ok: boolean, errors: string[], warnings: string[], summary: object|null, checksum: string|null }}
 */
export function applyContentPack(pack) {
  let input = pack;
  if (typeof input === 'string') {
    try {
      input = parsePackText(input);
    } catch (error) {
      return { ok: false, errors: [error.message], warnings: [], summary: null, checksum: null };
    }
  }
  const data = normalizePack(input);
  const check = validatePack(data, packContext());
  if (!check.ok) {
    return { ok: false, errors: check.errors, warnings: check.warnings, summary: null, checksum: null };
  }
  const plan = planPack(BASELINE, data);

  replaceInPlace(ALL_EVENTS, plan.events);
  syncMap(EVENT_MAP, plan.events);
  replaceInPlace(ITEMS, plan.items);
  syncMap(ITEM_MAP, plan.items);
  replaceInPlace(TRAITS, plan.traits);
  syncMap(TRAIT_MAP, plan.traits);
  replaceInPlace(PERSONALITIES, plan.personalities);
  syncMap(PERSONALITY_MAP, plan.personalities);
  replaceInPlace(FLAWS, plan.flaws);
  syncMap(FLAW_MAP, plan.flaws);
  syncActions(plan.actions);
  syncBalance(plan);

  activePack = data;
  activeMeta = {
    summary: summarizePack(data),
    checksum: checksumPack(data),
    format: data.format,
    appliedAt: null, // 由调用方（服务端 / 前端）填，引擎不碰系统时间
  };
  return { ok: true, errors: [], warnings: check.warnings, summary: activeMeta.summary, checksum: activeMeta.checksum };
}

/** 撤销内容包，回到内置内容。 */
export function resetContent() {
  const plan = planPack(BASELINE, {});
  replaceInPlace(ALL_EVENTS, plan.events);
  syncMap(EVENT_MAP, plan.events);
  replaceInPlace(ITEMS, plan.items);
  syncMap(ITEM_MAP, plan.items);
  replaceInPlace(TRAITS, plan.traits);
  syncMap(TRAIT_MAP, plan.traits);
  replaceInPlace(PERSONALITIES, plan.personalities);
  syncMap(PERSONALITY_MAP, plan.personalities);
  replaceInPlace(FLAWS, plan.flaws);
  syncMap(FLAW_MAP, plan.flaws);
  syncActions(plan.actions);
  syncBalance(plan);
  activePack = null;
  activeMeta = null;
  return { ok: true };
}

/** 当前生效的内容包状态（给界面显示用）。 */
export function contentStatus() {
  if (!activeMeta) {
    return {
      active: false,
      source: 'official',
      summary: null,
      checksum: null,
      baselineEventCount: BASELINE.events.filter((event) => !event.story).length,
      eventCount: ALL_EVENTS.filter((event) => !event.story).length,
    };
  }
  return {
    active: true,
    source: 'imported',
    summary: activeMeta.summary,
    checksum: activeMeta.checksum,
    format: activeMeta.format,
    packFormat: PACK_FORMAT,
    payload: activePack,
    baselineEventCount: BASELINE.events.filter((event) => !event.story).length,
    eventCount: ALL_EVENTS.filter((event) => !event.story).length,
  };
}

/**
 * 难度。除了学习收益，还会影响"遗忘速度"（decay）和初始底子（start）。
 *
 *   gain        学习收益倍率
 *   decay       遗忘倍率（1 = 标准）
 *   slopeScale  边际递减倍率（越大越"提不动分"）
 *   gainFloor   边际递减的下限（越小 = 越接近满分会越难提）
 *   examNoise   考试随机波动
 *   eventChance 每周触发随机事件的概率
 *   money       开局零花钱
 *   start       开局知识水平：{ min, max } 或 { min, max, lopsided: true }
 *               lopsided = 明显偏科，每科再乘一个 0.5~1.45 的随机系数
 */
export const DIFFICULTY = {
  easy: {
    key: 'easy',
    name: '轻松',
    icon: '🌤️',
    desc: '学习收益高、忘得慢，先把三年走一遍看看',
    gain: 1.25,
    forgetScale: 0.6,
    examNoise: 0.05,
    eventChance: 0.5,
    money: 1000,
    start: { min: 16, max: 30 },
  },
  normal: {
    key: 'normal',
    name: '正常',
    icon: '🏫',
    desc: '标准难度：底子一般，学过的会忘，得一直盯着',
    gain: 1.0,
    forgetScale: 1,
    examNoise: 0.075,
    eventChance: 0.55,
    money: 700,
    start: { min: 10, max: 24 },
  },
  hard: {
    key: 'hard',
    name: '困难',
    icon: '🔥',
    desc: '收益低、忘得快、考试波动大，容错很小',
    gain: 0.85,
    forgetScale: 1.3,
    examNoise: 0.11,
    eventChance: 0.62,
    money: 400,
    start: { min: 8, max: 20 },
  },
  realistic: {
    key: 'realistic',
    name: '真实（地狱开局）',
    icon: '💀',
    /**
     * 这一档的"地狱"跟 hard 不是一回事，设计意图写清楚：
     *   - 起点在及格线（48~62）而且明显偏科，有两科在班里倒数；
     *   - 忘得极快（forgetScale 4.5）、天花板低（gainFloor 0.16）。
     * 所以它的**地板高、天花板低**：不会像普通难度那样一路掉到专科，
     * 但也几乎爬不上 985——难点是"必须补弱科 + 一直对抗遗忘"，而不是"活不下来"。
     *
     * 实测（每档 16 局，normal 作对照）：
     *   normal    卷王 617（985+ 25%）均衡 592 佛系 391
     *   realistic 卷王 525（985+  0%）均衡 510 佛系 400 摆烂 320
     * 四个难度里它是最难的一档。
     */
    desc: '开学就在及格线上、明显偏科，而且学过的忘得极快；地板高，但爬不上去',
    gain: 0.78,
    forgetScale: 4.5,
    slopeScale: 1.6,
    gainFloor: 0.16,
    examNoise: 0.12,
    eventChance: 0.62,
    money: 350,
    start: { min: 48, max: 62, lopsided: true },
  },
  /**
   * 自定义难度：所有旋钮都由玩家给，缺省值等于「正常」。
   *
   * 注意：真正的数值不存在这个表里，而是 createGame 时解出来放进
   * `game.difficultyRules`（见 rulesOf）——否则同一局里各处读
   * `DIFFICULTY[game.difficulty]` 会读回默认值而不是玩家调的值。
   */
  custom: {
    key: 'custom',
    name: '自定义',
    icon: '🛠️',
    desc: '成长速度、遗忘速度、开局底子、零花钱、事件频率都自己调',
    gain: 1.0,
    forgetScale: 1,
    examNoise: 0.075,
    eventChance: 0.55,
    money: 700,
    start: { min: 10, max: 24 },
  },
};

/**
 * 自定义难度可调的旋钮（界面照着这个渲染滑杆，引擎照着这份表收拢数值）。
 * min/max/step 是硬边界，防止玩家把一局调成没法玩的样子。
 */
export const CUSTOM_KNOBS = [
  {
    id: 'gain',
    name: '成长速度',
    icon: '📈',
    min: 0.4,
    max: 1.8,
    step: 0.05,
    def: 1.0,
    format: 'mul',
    desc: '学一次能涨多少分：越高越轻松',
  },
  {
    id: 'forgetScale',
    name: '遗忘速度',
    icon: '📉',
    min: 0,
    max: 6,
    step: 0.25,
    def: 1,
    format: 'mul',
    desc: '学过的会忘多快：0 = 永不遗忘',
  },
  {
    id: 'startMin',
    name: '开局底子下限',
    icon: '🎚️',
    min: 0,
    max: 90,
    step: 2,
    def: 10,
    format: 'int',
    desc: '开学时各科大概在什么水平（下限）',
  },
  {
    id: 'startMax',
    name: '开局底子上限',
    icon: '🎚️',
    min: 10,
    max: 100,
    step: 2,
    def: 24,
    format: 'int',
    desc: '开学时各科大概在什么水平（上限）',
  },
  {
    id: 'money',
    name: '开局零花钱',
    icon: '💵',
    min: 0,
    max: 4000,
    step: 50,
    def: 700,
    format: 'int',
    desc: '商店、零食、请客都靠它',
  },
  {
    id: 'eventChance',
    name: '事件频率',
    icon: '🎲',
    min: 0.1,
    max: 0.95,
    step: 0.05,
    def: 0.55,
    format: 'pct',
    desc: '每周遇到随机事件的概率',
  },
  {
    id: 'examNoise',
    name: '考试波动',
    icon: '🎯',
    min: 0,
    max: 0.25,
    step: 0.005,
    def: 0.075,
    format: 'pct',
    desc: '考试时运气的成分',
  },
  {
    id: 'points',
    name: '属性点预算',
    icon: '🧬',
    min: 0,
    max: 30,
    step: 1,
    def: 12,
    format: 'int',
    desc: '开局可以自由分配多少属性点',
  },
  {
    id: 'lopsided',
    name: '开局偏科',
    icon: '🪓',
    min: 0,
    max: 1,
    step: 1,
    def: 0,
    format: 'bool',
    desc: '开：开学就明显偏科，有两科在班里倒数',
  },
];

/** 把界面传进来的旋钮收拢成一份合法的难度规则。 */
export function resolveCustomRules(input = {}) {
  const base = DIFFICULTY.custom;
  const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const knob = (id) => CUSTOM_KNOBS.find((item) => item.id === id);
  const clampKnob = (id, value) => {
    const spec = knob(id);
    return clamp(num(value, spec.def), spec.min, spec.max);
  };
  const startMin = Math.round(clampKnob('startMin', input.startMin));
  const startMax = Math.round(clampKnob('startMax', input.startMax));
  return {
    ...base,
    gain: clampKnob('gain', input.gain),
    forgetScale: clampKnob('forgetScale', input.forgetScale),
    examNoise: clampKnob('examNoise', input.examNoise),
    eventChance: clampKnob('eventChance', input.eventChance),
    money: Math.round(clampKnob('money', input.money)),
    start: {
      min: Math.min(startMin, startMax),
      max: Math.max(startMin, startMax),
      lopsided: Boolean(num(input.lopsided, 0) >= 0.5),
    },
    points: Math.round(clampKnob('points', input.points)),
  };
}

/**
 * 取这一局真正生效的难度规则。
 * 老存档没有 `difficultyRules`，就退回难度表里的定义。
 */
export function rulesOf(game) {
  return game?.difficultyRules ?? DIFFICULTY[game?.difficulty] ?? DIFFICULTY.normal;
}

/**
 * 随机一个外号（开局表单上的"🎲"按钮用）。
 * 和主角取名一样走独立随机流，不会影响主序列。
 */
export function pickNickname(seedText) {
  const stream = createStream('nickname', String(seedText ?? Date.now()));
  return NICKNAMES[Math.floor(nextFloat(stream) * NICKNAMES.length)];
}

/**
 * 开局表单需要的全部选项。
 *
 * 服务端（src/server.js）和离线模式（web/local-api.js）都从这里取，
 * 只有一份来源，就不会出现"网页版有性格选项、APK 里没有"这种事。
 */
export function creatorOptions() {
  return {
    avatars: AVATARS,
    nicknames: NICKNAMES,
    personalities: PERSONALITIES,
    flaws: FLAWS,
    pointBuy: POINT_BUY,
    pointBudget: POINT_BUDGET,
    presets: CHARACTER_PRESETS,
    customKnobs: CUSTOM_KNOBS,
    legacy: LEGACY,
    castRoles: CAST_ROLES,
    /** 九门课的图标 / 名字，前端画"单科底子"时用 */
    subjects: SUBJECT_POOL,
    maxTraits: EFF.maxTraits,
    maxFlaws: EFF.maxFlaws,
  };
}

export const EFF = {
  /** 边际递减：每点已有知识让后续收益打 0.55% 的折，最低保留 35%。 */
  knowledgeSlope: 0.55,
  minGainFactor: 0.35,
  /**
   * 全局学习收益系数——调平衡时主要动这个（两段制下 1 周有 2 次决策）。
   *
   * 这一版从 0.88 降到 0.78，配合下面状态曲线变陡，整体难度上了一个台阶：
   * 「卷王」策略平均 639（985 线 636），约一半的局能上 985，清北约 8%；
   * 「均衡」625（211 水平）；「佛系」约 425；「死磕」（只刷题不休息）约 430 并伴随心情崩盘。
   * 清北基本只能靠竞赛保送，或者把每一周都算得很准。
   */
  gainScale: 0.78,
  /**
   * 状态对效率的影响。这是"难度"的主要来源之一：
   * 熬夜刷题的收益会被疲劳吃掉，心情差也学不进去，
   * 所以"要不要花一个周末睡觉"是真取舍，而不是走过场。
   */
  fatigueSoftAt: 45, // 疲劳超过这个值才开始扣效率
  fatigueSlope: 150, // 每多 1 点疲劳扣多少（越大越温和）
  fatigueFloor: 0.55, // 效率最低保留比例
  moodBase: 0.78, // 心情 0 时的效率
  moodSlope: 0.30, // 心情 100 时额外加多少（0.78 + 0.30 = 1.08）
  /** 考试时的状态影响比平时温和一些（毕竟知识已经学过一遍了）。 */
  examMoodBase: 0.86,
  examMoodSlope: 0.20,
  examFatigueSlope: 300,
  examFatigueFloor: 0.8,
  /**
   * 「不进则退」：知识会忘。
   *
   * 每周结算时，每一科先掉一层底（baseDecay，按难度缩放），
   * 然后看这一周有没有碰过它：
   *   - 主行动学过的科目：遗忘只剩 studiedKeep（等于没白学）
   *   - 周末还安排了学习：整体再少忘一点（weekendStudyDiscount）
   *   - 周末完全没学习：额外多忘一层（idleWeekendExtra）
   *
   * 这样一来"周末要不要也学"从加分项变成了止损项——不学就是真的在掉。
   */
  forgetting: {
    base: 0.31, // 每科每周的基础遗忘（还没乘难度）
    idleWeekendExtra: 0.37, // 周末没学习时的额外遗忘
    studiedKeep: 0.15, // 本周学过这一科 → 只吃 15% 的遗忘
    weekendStudyDiscount: 0.6, // 周末学了 → 整体遗忘打折
    weakBonus: 0.55, // 知识越低忘得越慢（低于 60 分时按这个系数收拢）
    floor: 0, // 可以掉到 0
    /**
     * 一周内这一科至少涨了这么多分，才算"这周碰过它"。
     *
     * 这个门槛很关键：有些行动会附带一点点知识（"好好睡觉"就给每科 +0.2），
     * 如果不设门槛，周末天天睡觉就能把每一科都标成"碰过"，
     * 整套"不进则退"直接被绕过去。
     */
    touchThreshold: 0.8,
  },
  weeklyAllowance: 60,
  weeklyLivingCost: 35,
  weeklyFatigueRecovery: 3,
  weeklyMoodDrain: 0.3,
  disciplineDecay: 2,
  expelAt: 120,
  /** 周末安排的效果系数（比整周的主行动轻一些）。 */
  weekendScale: 0.55,
  weekendEventChance: 0.4,
  /** 可重复事件两次之间的最小间隔（周），免得同一件事连着来。 */
  repeatEventCooldown: 6,
  maxTraits: 2,
  /** 缺陷最多选 1 个（用负面换属性点）。 */
  maxFlaws: 1,
};

// EFF / DIFFICULTY 到这里才算定义完，内容包的平衡基线在这里补齐
initBalanceBaseline();

export class GameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GameError';
  }
}

export const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const round1 = (value) => Math.round(value * 10) / 10;
const roundStats = (stats) =>
  Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, key === 'money' ? Math.round(value) : round1(value)]));

/* ------------------------------------------------------------------ 建局 */

function normalizeElectives(trackId, input) {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '')
        .split(/[,，\s]+/)
        .filter(Boolean);
  if (validateSelection(trackId, raw) === null) return [...new Set(raw)];
  return subjectsFor(trackId)
    .filter((subject) => ELECTIVE_KEYS.includes(subject.key))
    .map((subject) => subject.key);
}

function normalizeTraits(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '')
        .split(/[,，\s]+/)
        .filter(Boolean);
  const picked = [];
  for (const id of raw) {
    if (TRAIT_MAP[id] && !picked.includes(id) && picked.length < EFF.maxTraits) picked.push(id);
  }
  if (picked.length < EFF.maxTraits) {
    for (const trait of TRAITS) {
      if (picked.length >= EFF.maxTraits) break;
      if (!picked.includes(trait.id)) picked.push(trait.id);
    }
  }
  return picked;
}

/** 缺陷：最多 EFF.maxFlaws 个，用负面换属性点。重复/非法 id 直接丢掉。 */
function normalizeFlaws(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '')
        .split(/[,，\s]+/)
        .filter(Boolean);
  const picked = [];
  for (const id of raw) {
    if (FLAW_MAP[id] && !picked.includes(id) && picked.length < EFF.maxFlaws) picked.push(id);
  }
  return picked;
}

/**
 * 属性点分配。
 *
 * 输入是界面里的 `{ intelligence: 3, subjects: { math: 2 } }`，
 * 输出是收拢过的方案：**不能超支**（超了就按"最后加的先生效"的顺序往回削），
 * 每一项都不能超过 POINT_BUY 里的 max，不在选科里的科目直接忽略。
 *
 * @returns {{ spend: Record<string, number>, subjects: Record<string, number>, spent: number, budget: number, total: number }}
 */
function normalizePoints(input, budget, subjectKeys, legacy = 0) {
  const raw = input && typeof input === 'object' ? input : {};
  const base = Math.max(0, Math.round(Number(budget) || 0));
  const extra = Math.max(0, Math.round(Number(legacy) || 0));
  const total = base + extra;

  // 按 POINT_BUY 的顺序记账，超出预算时从最后一项往回削，结果永远可复现
  const units = [];
  for (const item of POINT_BUY) {
    if (item.perSubject) continue;
    const want = Math.max(0, Math.min(item.max, Math.round(Number(raw[item.key]) || 0)));
    for (let index = 0; index < want; index += 1) units.push({ kind: 'attr', key: item.key });
  }
  const knowledgeItem = POINT_BUY_MAP.knowledge;
  const rawSubjects = raw.subjects && typeof raw.subjects === 'object' ? raw.subjects : {};
  for (const key of subjectKeys) {
    const want = Math.max(0, Math.min(knowledgeItem.max, Math.round(Number(rawSubjects[key]) || 0)));
    for (let index = 0; index < want; index += 1) units.push({ kind: 'subject', key });
  }

  let over = units.length - total;
  while (over > 0 && units.length > 0) {
    units.pop();
    over -= 1;
  }

  const spend = {};
  const subjects = {};
  for (const unit of units) {
    if (unit.kind === 'attr') spend[unit.key] = (spend[unit.key] ?? 0) + 1;
    else subjects[unit.key] = (subjects[unit.key] ?? 0) + 1;
  }
  return { spend, subjects, spent: units.length, budget: base, legacy: extra, total };
}

/** 把属性点方案写进 game（属性直接加，单科底子写进 knowledge）。 */
function applyPoints(game, plan) {
  const lines = [];
  for (const item of POINT_BUY) {
    if (item.perSubject) continue;
    const value = plan.spend[item.key] ?? 0;
    if (!value) continue;
    const delta = value * item.per;
    if (item.key === 'money') game.stats.money += delta;
    else game.stats[item.key] = (game.stats[item.key] ?? 0) + delta;
    lines.push(`${item.icon ?? ''}${item.name} +${delta}`.trim());
  }
  const knowledgeItem = POINT_BUY_MAP.knowledge;
  for (const [key, value] of Object.entries(plan.subjects)) {
    const delta = value * knowledgeItem.per;
    game.knowledge[key] = round1(clamp((game.knowledge[key] ?? 0) + delta, 0, 100));
    lines.push(`${SUBJECT_MAP[key]?.name ?? key} 底子 +${delta}`);
  }
  return lines;
}

/** 自定义关系人物：玩家可以给任意角色位指定名字和性别。 */
function normalizeCustomCast(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [role, value] of Object.entries(input)) {
    if (!CAST_ROLE_MAP[role]) continue;
    const entry = typeof value === 'string' ? { name: value } : value && typeof value === 'object' ? value : null;
    if (!entry) continue;
    const name = String(entry.name ?? '').trim().slice(0, 12);
    const gender = entry.gender === '女' ? '女' : entry.gender === '男' ? '男' : null;
    if (!name && !gender) continue;
    out[role] = { ...(name ? { name } : {}), ...(gender ? { gender } : {}) };
  }
  return out;
}

export function createGame(options = {}) {
  const gender = options.gender === '女' ? '女' : '男';
  // 没填名字（或者填了老版本的占位符"无名氏"）就随机一个中文常见姓名
  const rawName = String(options.name ?? '').trim();
  const name = rawName && rawName !== '无名氏' ? rawName : randomStudentName(options.seed ?? Date.now(), gender);
  const difficulty = DIFFICULTY[options.difficulty] ? options.difficulty : 'normal';
  const weeksPerSemester = clamp(Math.round(Number(options.weeksPerSemester) || DEFAULT_WEEKS_PER_SEMESTER), 3, 20);
  const seedText =
    options.seed === undefined || options.seed === null || String(options.seed).trim() === ''
      ? String(Date.now())
      : String(options.seed);

  // 自定义难度：旋钮解出来存进 game.difficultyRules，之后一律走 rulesOf(game)
  const diff = difficulty === 'custom' ? resolveCustomRules(options.custom) : DIFFICULTY[difficulty];

  const trackId = options.track === 'history' ? 'history' : 'physics';
  const electives = normalizeElectives(trackId, options.electives);
  const traits = normalizeTraits(options.traits);
  const background = BACKGROUND_MAP[options.background] ? options.background : 'worker';
  const goal = GOAL_MAP[options.goal] ? options.goal : 'yiben';
  const endless = Boolean(options.endless);
  const personality = PERSONALITY_MAP[options.personality] ? options.personality : 'plain';
  const flaws = normalizeFlaws(options.flaw ?? options.flaws);
  const avatar = AVATAR_MAP[options.avatar] ? options.avatar : 'student';
  const preset = PRESET_MAP[options.preset] ? options.preset : null;
  const customCast = normalizeCustomCast(options.customCast);

  const baseMods = sumMods(
    ...traits.map((id) => TRAIT_MAP[id]?.mods),
    BACKGROUND_MAP[background]?.mods,
    PERSONALITY_MAP[personality]?.mods,
    ...flaws.map((id) => FLAW_MAP[id]?.mods),
  );

  /*
   * 属性点预算 = 难度给的 + 缺陷换来的 + 多周目传承点。
   * "缺陷换点数"和"传承点"都走同一条通道，所以超支校验只要做一次。
   */
  const flawPoints = flaws.reduce((sum, id) => sum + (FLAW_MAP[id]?.points ?? 0), 0);
  const legacyPoints = clamp(Math.round(Number(options.legacyPoints) || 0), 0, 12);
  const subjectKeys = subjectsFor(trackId, electives).map((subject) => subject.key);
  const diffBudget = Number.isFinite(diff.points) ? diff.points : POINT_BUDGET[difficulty] ?? POINT_BUDGET.normal;
  const pointPlan = normalizePoints(options.points, diffBudget + flawPoints, subjectKeys, legacyPoints);

  // 人物阵容：名字走独立随机流，不会打乱 game.rngState 的主序列
  const cast = buildCast(seedText, {
    studentGender: gender,
    studentSurname: name.slice(0, 1),
    avoid: name,
    overrides: customCast,
  });
  // 外号也走独立随机流：填了就用自己的，没填就随机一个
  const nickname = String(options.nickname ?? '').trim().slice(0, 12) || pickNickname(seedText);

  const subjects = subjectsFor(trackId, electives);
  const game = {
    version: VERSION,
    seedText,
    rngState: hashSeed(`${seedText}|${name}|${difficulty}|${trackId}|${electives.join('')}`),
    difficulty,
    /** 自定义难度解出来的规则；其它难度为 null（读的时候走 rulesOf） */
    difficultyRules: difficulty === 'custom' ? diff : null,
    weeksPerSemester,
    endless,
    student: {
      name,
      gender,
      /** 外号：不影响数值，只是日志和关系图里叫得更顺口 */
      nickname,
      avatar,
      avatarIcon: AVATAR_MAP[avatar]?.icon ?? '🧑',
      className: String(options.className ?? '').trim() || undefined,
      track: TRACK_MAP[trackId].name,
      trackId,
      city: '马鞍山',
    },
    cast,
    selection: { track: trackId, electives },
    subjectKeys: subjects.map((subject) => subject.key),
    /**
     * 开局构筑。v2.5 起多了性格（选 1）、缺陷（选 0~1）、属性点方案、
     * 自定义关系人物和模板 id，全部会进存档。
     */
    build: {
      traits,
      background,
      goal,
      personality,
      flaws,
      preset,
      points: { spend: pointPlan.spend, subjects: pointPlan.subjects, spent: pointPlan.spent, budget: pointPlan.budget, legacy: pointPlan.legacy },
      legacyPoints,
      customCast,
    },
    baseMods,
    mods: { ...baseMods },
    items: [],
    turn: 0,
    semesterIndex: 0,
    week: 1,
    stats: {
      intelligence: 0,
      physique: 0,
      mood: 72,
      social: 40,
      teacherFavor: 50,
      comprehensive: 8,
      fatigue: 12,
      discipline: 0,
      money: Math.round(diff.money * (1 + baseMods.startMoneyMul) + baseMods.startMoney),
    },
    npc: { head: 55, math: 50, deskmate: 45, friend: 35, rival: 30, parents: 60, love: 0 },
    knowledge: {},
    flags: {},
    cooldowns: {},
    log: [],
    exams: [],
    history: [],
    /** 已经演过的剧情章节（按顺序）。 */
    story: [],
    /** 高考之后的志愿填报（没到那一步时是 null）。 */
    volunteer: null,
    /** 要不要走"填志愿"这一步（自动对局 / 老存档可以关掉）。 */
    volunteerMode: options.volunteers !== false,
    /** 因果链：几周之后要长出后果的选择。 */
    chains: [],
    pendingEvent: null,
    phase: 'main',
    status: 'playing',
    ending: null,
  };

  if (!game.student.className) game.student.className = pick(game, SCHOOL.classOptions);
  game.stats.intelligence = clamp(randInt(game, 46, 72) + baseMods.intelligence, 0, 100);
  game.stats.physique = randInt(game, 45, 70);
  game.stats.mood = clamp(game.stats.mood + baseMods.startMood, 1, 100);
  game.stats.social = clamp(game.stats.social + baseMods.startSocial, 0, 100);
  game.stats.comprehensive = clamp(game.stats.comprehensive + baseMods.startComprehensive, 0, 100);
  game.npc.parents = clamp(game.npc.parents + baseMods.parents, 0, 100);

  /*
   * 开局底子：不同难度的起点不一样。
   *
   * "真实（地狱开局）"这一档从及格线附近起步，而且**明显偏科**——
   * 有的科目能考 80 分，有的只有 30 分，逼你放弃平均用力。
   * 这些系数都来自 game.rngState，所以同一个种子拿到的偏科分布是固定的。
   */
  const start = diff.start ?? { min: 10, max: 24 };
  const weakKeys = [];
  for (const key of ALL_SUBJECT_KEYS) {
    let base = randFloat(game, start.min, start.max);
    if (start.lopsided) {
      // 偏科系数：0.55 ~ 1.45，两端更容易出现（"特别好"和"特别差"各占一些）
      const roll = nextFloat(game);
      const factor = roll < 0.25 ? randFloat(game, 0.5, 0.72) : roll > 0.75 ? randFloat(game, 1.2, 1.45) : randFloat(game, 0.85, 1.15);
      base *= factor;
    }
    const value = round1(clamp(base + baseMods.startKnowledge, 0, 100));
    game.knowledge[key] = value;
    if (start.lopsided && value < 34) weakKeys.push(key);
  }

  /*
   * 属性点最后落账——必须排在开局底子之后，
   * 否则"单科底子 +4"会被随机底子覆盖掉。
   */
  const pointLines = applyPoints(game, pointPlan);
  game.stats.physique = clamp(game.stats.physique + baseMods.startPhysique, 0, 100);
  game.stats.intelligence = clamp(game.stats.intelligence, 0, 100);
  game.stats.physique = clamp(game.stats.physique, 0, 100);
  game.stats.mood = clamp(game.stats.mood, 1, 100);
  game.stats.social = clamp(game.stats.social, 0, 100);
  game.stats.comprehensive = clamp(game.stats.comprehensive, 0, 100);

  game.startProfile = {
    lopsided: Boolean(start.lopsided),
    weakKeys,
    weakNames: weakKeys.map((key) => SUBJECT_MAP[key]?.name ?? key),
  };

  const people = cast.map;
  const avatarIcon = game.student.avatarIcon;
  pushLog(
    game,
    'system',
    '开学',
    `${avatarIcon}${game.student.name}（外号"${nickname}"），欢迎来到${SCHOOL.name}${game.student.className}。` +
      `你是${game.student.track}考生，选考${electives.map((key) => SUBJECT_MAP[key].name).join('、')}。` +
      `目标：${GOAL_MAP[goal].name}。三年之后，你会走进哪一扇校门？`,
  );
  pushLog(
    game,
    'system',
    '这个人是谁',
    `性格：${PERSONALITY_MAP[personality].name}（${PERSONALITY_MAP[personality].desc}）。` +
      (flaws.length
        ? `你还有一个说出去不太光彩的短板：${flaws.map((id) => `${FLAW_MAP[id].name}（${FLAW_MAP[id].desc.split('→')[0].trim()}）`).join('、')}。`
        : '没有什么明显的短板——至少现在看是这样。') +
      (pointLines.length ? `\n开学的家底：${pointLines.join('　')}。` : '') +
      (legacyPoints > 0 ? `\n（多周目传承：额外 ${legacyPoints} 点属性点）` : ''),
  );
  pushLog(
    game,
    'system',
    '这一届的人',
    `班主任是${people.head.teacher}，数学老师是${people.math.teacher}。` +
      `你的同桌叫${people.deskmate.name}，后排那个总拉着你说话的叫${people.friend.name}。` +
      `红榜上跟你咬得最紧的是${people.rival.name}。` +
      (customCast && Object.keys(customCast).length
        ? `\n有些名字是你自己定的——你知道这三年里谁最重要。`
        : ''),
  );
  if (game.startProfile.lopsided) {
    const weak = game.startProfile.weakNames;
    pushLog(
      game,
      'system',
      '开学摸底考',
      `摸底考的成绩条发下来，你的总分排在中游，但科目之间差得离谱。` +
        (weak.length > 0
          ? `${weak.join('、')}这几科基本是班里倒数——开学第一次家长会，${people.head.teacher}把这几个字圈了出来。`
          : `每一科都在及格线上晃，没有一科能拉分。`),
    );
  }
  return game;
}

/* ------------------------------------------------------------------ 查询 */

export function weekLabel(game) {
  const semester = SEMESTERS[game.semesterIndex];
  return semester ? `${semester.name} 第 ${game.week} 周` : '毕业';
}

export function phaseLabel(game) {
  return game.phase === 'weekend' ? '周末安排' : '本周主行动';
}

export function totalWeeks(game) {
  return SEMESTERS.length * game.weeksPerSemester;
}

export function nextExamInfo(game) {
  const plan = examPlan(game.semesterIndex, game.weeksPerSemester, { endless: game.endless });
  const due = plan.find((item) => item.week >= game.week);
  if (!due) return null;
  return { name: due.name, kind: due.kind, week: due.week, inWeeks: Math.max(0, due.week - game.week) };
}

export function subjectsOf(game) {
  return game.subjectKeys.map((key) => SUBJECT_MAP[key]).filter(Boolean);
}

function phaseAllowed(action, phase) {
  const allowed = action.phase ?? 'both';
  return allowed === 'both' || allowed === phase;
}

export function subjectOptions(game, action) {
  if (!action?.needsSubject) return [];
  if (action.subjectPool === 'electives') {
    return ELECTIVE_KEYS.filter((key) => !game.subjectKeys.includes(key));
  }
  return game.subjectKeys.slice();
}

function actionAvailability(game, action) {
  if (action.once && game.flags[`used_${action.id}`]) return '这件事一局只能做一次，已经做过了';
  const readyAt = game.cooldowns[action.id];
  if (readyAt !== undefined && game.turn < readyAt) return `冷却中（还需 ${readyAt - game.turn} 周）`;
  // 先看日历（"高二才能报艺考班"），再看数值门槛
  const schedule = scheduleFor('action', action.id);
  if (!matchesSchedule(schedule, calendarOf(game))) {
    const hint = scheduleHint(schedule);
    return hint ? `现在不是做这件事的时候（${hint}）` : '现在不是做这件事的时候';
  }
  if (action.needsSubject && subjectOptions(game, action).length === 0) return '现在没有可以选的科目';
  if (action.requirement) return action.requirement(game) ?? null;
  return null;
}

export function listActions(game, phase = game.phase) {
  return ACTIONS.filter((action) => phaseAllowed(action, phase)).map((action) => {
    const reason = actionAvailability(game, action);
    const readyAt = game.cooldowns[action.id];
    return {
      id: action.id,
      name: resolveText(action.name, game),
      icon: action.icon ?? '•',
      tag: action.tag,
      // 名称和说明也过一遍占位符：{subject} 在没有具体科目时是"这科"，
      // 而 {deskmate} 这类会变成这一局真实的人名
      desc: resolveText(action.desc, game),
      phase: action.phase ?? 'both',
      needsSubject: Boolean(action.needsSubject),
      subjectOptions: subjectOptions(game, action).map((key) => ({
        key,
        name: SUBJECT_MAP[key]?.name ?? key,
        icon: SUBJECT_MAP[key]?.icon ?? '•',
      })),
      cost: action.effect?.money && action.effect.money < 0 ? -action.effect.money : 0,
      cooldownLeft: readyAt && game.turn < readyAt ? readyAt - game.turn : 0,
      once: Boolean(action.once),
      used: Boolean(action.once && game.flags[`used_${action.id}`]),
      available: !reason,
      reason: reason ?? null,
    };
  });
}

/* ------------------------------------------------------------------ 商店 */

export function listShop(game) {
  return ITEMS.map((item) => {
    const owned = game.items.includes(item.id);
    const affordable = game.stats.money >= item.price;
    return {
      id: item.id,
      name: item.name,
      icon: item.icon,
      price: item.price,
      desc: item.desc,
      repeatable: Boolean(item.repeatable),
      owned,
      affordable,
      canBuy: affordable && (item.repeatable || !owned),
      reason: !affordable ? '零花钱不够' : owned && !item.repeatable ? '已经买过了' : null,
    };
  });
}

export function buyItem(game, itemId) {
  if (game.status !== 'playing') throw new GameError('这一局已经结束了。');
  const item = ITEM_MAP[itemId];
  if (!item) throw new GameError(`没有这个商品：${itemId}`);
  if (!item.repeatable && game.items.includes(item.id)) throw new GameError(`${item.name}已经买过了。`);
  if (game.stats.money < item.price) throw new GameError(`零花钱不够（${item.name} 需要 ${item.price} 元）。`);

  const lines = [`🛒 你在商场买下了 ${item.icon} ${item.name}（-${item.price} 元）`];
  game.stats.money -= item.price;
  if (!item.repeatable) game.items.push(item.id);
  recomputeMods(game);
  const api = createApi(game, lines, undefined, false);
  if (item.effect) applyEffects(game, item.effect, api);
  clampAndWarn(game, lines);
  pushLog(game, 'system', `购买：${item.name}`, `${item.desc}（-${item.price} 元）`);
  return { lines };
}

function recomputeMods(game) {
  const itemMods = game.items.map((id) => ITEM_MAP[id]?.mods).filter(Boolean);
  game.mods = sumMods(game.baseMods, ...itemMods);
  return game.mods;
}

/* --------------------------------------------------------------- 主循环 */

export function performAction(game, actionId, options = {}) {
  assertPlayable(game);
  const action = ACTION_MAP[actionId];
  if (!action) throw new GameError(`没有这个行动：${actionId}`);

  const phase = game.phase;
  const weekend = phase === 'weekend';
  if (!phaseAllowed(action, phase)) {
    throw new GameError(weekend ? `${action.name}要占满整天，只能作为本周的主行动。` : `${action.name}是周末才能安排的事。`);
  }

  const subject = action.needsSubject ? options.subject : undefined;
  if (action.needsSubject) {
    const pool = subjectOptions(game, action);
    if (!subject || !SUBJECT_MAP[subject]) throw new GameError(`${action.name}需要先选择一个科目。`);
    if (!pool.includes(subject)) throw new GameError(`${SUBJECT_MAP[subject].name}不在这次的可选范围内。`);
  }
  const blocked = actionAvailability(game, action);
  if (blocked) throw new GameError(blocked);

  const lines = [];
  const api = createApi(game, lines, subject, weekend);
  const before = snapshotProgress(game);

  lines.push(`【${weekLabel(game)} · ${weekend ? '周末' : '主行动'}】${action.icon ?? ''} ${action.name}`);
  applyEffects(game, action.effect, api);
  if (typeof action.special === 'function') action.special(game, api);
  // 记下这一阶段在哪几科上真的涨了分——"不进则退"靠它判断哪些科不用吃遗忘
  trackKnowledgeGain(game, before, weekend);
  lines.push(...describeDelta(before, game));
  clampAndWarn(game, lines);

  if (action.cooldown) game.cooldowns[action.id] = game.turn + action.cooldown;
  if (action.once) game.flags[`used_${action.id}`] = true;
  game.history.push({
    turn: game.turn + 1,
    week: game.week,
    phase,
    action: action.id,
    subject: subject ?? null,
  });
  pushLog(
    game,
    'action',
    `${weekLabel(game)} · ${weekend ? '周末' : '主行动'} · ${action.name}`,
    lines.slice(1).join('\n'),
  );

  const result = { lines, exams: [], pendingEvent: null, ended: false, ending: null };
  if (game.status !== 'playing') return finalizeResult(game, result);
  if (checkCollapse(game, lines)) return finalizeResult(game, result);

  advanceStory(game); // 该演的剧情先排上队，下一次 rollEvent 一定会放它出来
  const event = rollEvent(game, weekend);
  if (event) triggerEvent(game, event, lines);
  if (game.status === 'playing' && checkCollapse(game, lines)) return finalizeResult(game, result);
  if (!game.pendingEvent && game.status === 'playing') endPhase(game, result);

  return finalizeResult(game, result);
}

export function resolveEvent(game, choiceId) {
  if (game.status !== 'playing') throw new GameError('这一局已经结束了。');
  const pending = game.pendingEvent;
  if (!pending) throw new GameError('当前没有待处理的事件。');
  const event = EVENT_MAP[pending.id];
  if (!event) throw new GameError(`未知事件：${pending.id}`);
  const choice = (event.choices ?? []).find((item) => item.id === choiceId);
  if (!choice) throw new GameError(`无效的选项：${choiceId}`);

  const weekend = game.phase === 'weekend';
  const lines = [`【${weekLabel(game)} · ${weekend ? '周末' : '主行动'}】${event.icon ?? ''} ${event.name} · 你的选择`];
  const api = createApi(game, lines, undefined, weekend);
  const before = snapshotProgress(game);

  api.say(resolveText(choice.outcome, game));
  applyEffects(game, choice.effect, api);
  applyEffects(game, event.followUp, api);
  // 事件里学到的也算"这周碰过"（比如随手翻了两页书）
  trackKnowledgeGain(game, before, weekend);
  lines.push(...describeDelta(before, game));
  clampAndWarn(game, lines);
  pushLog(
    game,
    'event',
    // 事件在日志里会留两条：出现时一条、选完之后一条。
    // 两条标题必须能区分开，否则看起来像"同一件事记了两遍"。
    event.story ? `故事 · ${event.storyArcTitle} · ${event.name}` : `${weekLabel(game)} · ${event.name} · 你的选择`,
    /*
     * 日志正文要能回答"我当时选了什么、结果怎样"——
     * 只写事件原文的话，翻日志的时候完全看不出自己做了哪个决定。
     */
    event.story
      ? `${resolveText(event.text, game)}\n\n▶ ${resolveText(choice.outcome, game)}`
      : `${resolveText(event.text, game)}\n\n▶ ${resolveText(choice.label, game)}\n${resolveText(choice.outcome, game)}`,
  );

  game.pendingEvent = null;
  game.flags[`${event.id}_resolved`] = choice.id;

  const result = { lines, exams: [], pendingEvent: null, ended: false, ending: null };
  if (checkCollapse(game, lines)) return finalizeResult(game, result);
  endPhase(game, result);
  return finalizeResult(game, result);
}

/**
 * 让策略函数一次性把一个完整周（主行动 + 周末）打完。
 * strategy(game, phase) 返回 { actionId, subject, chooseEvent }
 *
 * `options.autoVolunteer`（默认 true）：如果这一周打到了高考结束、进入志愿填报阶段，
 * 就顺手按"冲稳保"常识把志愿表填了。**这是自动对局/平衡脚本能跑到结局的关键**——
 * 交互式玩家走的是 performAction + submitVolunteers，不会自己填。
 */
export function playWeek(game, strategy, options = {}) {
  const lines = [];
  if (game.status === 'volunteering') {
    if (options.autoVolunteer !== false) {
      const auto = autoFillVolunteers(game, options.volunteerStrategy);
      const submitted = submitVolunteers(game, auto.picks, { adjust: auto.adjust });
      lines.push(...submitted.lines);
    }
    return { lines, ended: game.status !== 'playing', ending: game.ending };
  }
  const startTurn = game.turn;
  let guard = 0;
  while (game.status === 'playing' && game.turn === startTurn && guard < 6) {
    guard += 1;
    const decision = strategy(game, game.phase) ?? {};
    let result = null;
    try {
      result = performAction(game, decision.actionId, { subject: decision.subject });
    } catch {
      const fallback = listActions(game).find((action) => action.available);
      if (!fallback) break;
      result = performAction(game, fallback.id, { subject: fallback.subjectOptions[0]?.key });
    }
    lines.push(...result.lines);
    while (game.pendingEvent && game.status === 'playing') {
      const pending = game.pendingEvent;
      const choiceId =
        (decision.chooseEvent ? decision.chooseEvent(pending, game) : null) ?? pending.choices[0]?.id;
      const resolved = resolveEvent(game, choiceId);
      lines.push(...resolved.lines);
    }
  }
  // 这一周正好考完高考：志愿表由自动对局自己填掉，别让脚本卡在 volunteering 上
  if (game.status === 'volunteering' && options.autoVolunteer !== false) {
    const auto = autoFillVolunteers(game, options.volunteerStrategy);
    const submitted = submitVolunteers(game, auto.picks, { adjust: auto.adjust });
    lines.push(...submitted.lines);
  }
  return { lines, ended: game.status !== 'playing', ending: game.ending };
}

function endPhase(game, result) {
  if (game.phase === 'main') {
    game.phase = 'weekend';
    return;
  }
  game.phase = 'main';
  applyWeeklyUpkeep(game, result.lines);
  clampAndWarn(game, result.lines);
  if (game.status === 'playing' && checkCollapse(game, result.lines)) return;
  if (game.status !== 'playing') return;
  advanceWeek(game, result);
}

/* --------------------------------------------------------------- 事件 */

function rollEvent(game, weekend) {
  const diff = rulesOf(game);
  if (game.flags.scriptedEvent && EVENT_MAP[game.flags.scriptedEvent]) {
    const forced = EVENT_MAP[game.flags.scriptedEvent];
    game.flags.scriptedEvent = null;
    return forced;
  }
  /*
   * 因果链优先：几周前那个选择"到点了"，这一回合一定弹出来。
   * 这条要排在概率判定之前——链是承诺过的后果，不能因为运气不出。
   */
  if (Array.isArray(game.chains) && game.chains.length > 0) {
    // 内容包被撤掉之后，指向不存在事件的链要丢掉，不能一直堵在队列里
    game.chains = game.chains.filter((entry) => EVENT_MAP[entry?.id]);
    const index = game.chains.findIndex((entry) => (entry?.atTurn ?? 0) <= game.turn);
    if (index >= 0) {
      const [entry] = game.chains.splice(index, 1);
      return EVENT_MAP[entry.id];
    }
  }
  const base = weekend ? EFF.weekendEventChance : diff.eventChance;
  const luck = game.mods.luck ?? 0;
  if (!chance(game, clamp(base + luck * 0.05, 0, 1))) return null;

  const cal = calendarOf(game);
  const eligible = ALL_EVENTS.filter((event) => {
    if (event.story) return false; // 剧情只走排队，不参与随机
    if (event.chainOnly) return false; // 因果链的后续环只能被链出来，不进随机池
    if (event.once ?? true) {
      if (game.flags[`seen_${event.id}`]) return false;
    } else {
      // 可重复事件要有间隔，否则"食堂的红烧肉"能连着四周出现
      const lastTurn = game.flags[`evtTurn_${event.id}`];
      const gap = event.cooldown ?? EFF.repeatEventCooldown;
      if (lastTurn !== undefined && game.turn - lastTurn < gap) return false;
    }
    if ((event.minTurn ?? 0) > game.turn) return false;
    // 日历约束：元旦晚会不会在五月办，高三也不会捡到高二学姐的钱包
    if (!matchesSchedule(scheduleFor('event', event.id), cal)) return false;
    if (event.cond && !safeCond(event.cond, game)) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  return pickWeighted(game, eligible);
}

function safeCond(cond, game) {
  try {
    return Boolean(cond(game));
  } catch {
    return false;
  }
}

function triggerEvent(game, event, lines) {
  game.flags[`seen_${event.id}`] = true;
  game.flags[`count_${event.id}`] = (game.flags[`count_${event.id}`] ?? 0) + 1;
  game.flags[`evtTurn_${event.id}`] = game.turn;
  const weekend = game.phase === 'weekend';
  const api = createApi(game, lines, undefined, weekend);
  const storyTag = event.story ? '📖' : (event.icon ?? '🎲');
  lines.push(`【${weekLabel(game)} · ${weekend ? '周末' : '主行动'}】${storyTag} ${event.name}`);
  const eventText = resolveText(event.text, game);
  api.say(event.text);

  if (event.story) {
    const chapter = recordStory(game, event, eventText, weekLabel(game));
    if (chapter) pushLog(game, 'story', `故事 · ${event.storyArcTitle} · ${event.name}`, eventText);
  }

  if (event.kind === 'choice') {
    applyEffects(game, event.effect, api);
    clampAndWarn(game, lines);
    game.pendingEvent = {
      id: event.id,
      name: event.name,
      icon: event.icon ?? '🎲',
      story: Boolean(event.story),
      arcTitle: event.storyArcTitle ?? null,
      text: eventText,
      choices: (event.choices ?? []).map((choice) => ({
        id: choice.id,
        label: resolveText(choice.label, game),
        hint: choice.hint ? resolveText(choice.hint, game) : null,
      })),
    };
    if (!event.story) pushLog(game, 'event', `${weekLabel(game)} · ${event.name}`, eventText);
    return;
  }

  const before = snapshotProgress(game);
  applyEffects(game, event.effect, api);
  lines.push(...describeDelta(before, game));
  clampAndWarn(game, lines);
  if (!event.story) pushLog(game, 'event', `${weekLabel(game)} · ${event.name}`, eventText);
}

/* ------------------------------------------------------------------ 考试 */

/** 心情对效率的影响（0 心情也有 78%，100 心情 108%）。 */
function moodFactor(game) {
  return EFF.moodBase + (clamp(game.stats.mood ?? 50, 0, 100) / 100) * EFF.moodSlope;
}

/** 疲劳对效率的影响：超过 fatigueSoftAt 之后线性衰减，最低 fatigueFloor。 */
function fatigueFactor(game) {
  const over = Math.max(0, (game.stats.fatigue ?? 0) - EFF.fatigueSoftAt);
  return clamp(1 - over / EFF.fatigueSlope, EFF.fatigueFloor, 1);
}

/** 考试当天的状态：同样是心情 + 疲劳，但幅度收窄。 */
function examMoodFactor(game) {
  return clamp(EFF.examMoodBase + (clamp(game.stats.mood ?? 50, 0, 100) / 100) * EFF.examMoodSlope, 0.82, 1.1);
}

function examFatigueFactor(game) {
  const over = Math.max(0, (game.stats.fatigue ?? 0) - EFF.fatigueSoftAt);
  return clamp(1 - over / EFF.examFatigueSlope, EFF.examFatigueFloor, 1.02);
}

function subjectScore(game, subject) {
  const diff = rulesOf(game);
  const knowledge = clamp((game.knowledge[subject.key] ?? 0) / 100, 0, 1);
  const moodMod = examMoodFactor(game);
  const fatigueMod = examFatigueFactor(game);
  const physiqueMod = clamp(0.96 + (game.stats.physique - 50) / 600, 0.88, 1.06);
  const noiseScale = clamp(1 - (game.mods.examNoise ?? 0), 0.3, 1);
  const noise = 1 + (nextFloat(game) - 0.5) * 2 * diff.examNoise * noiseScale;
  const pct = clamp(knowledge * moodMod * fatigueMod * physiqueMod * noise, 0, 1);
  return Math.round(subject.max * pct);
}

export function estimateExam(game) {
  const subjects = {};
  let total = 0;
  for (const subject of subjectsOf(game)) {
    const value = Math.round(clamp((game.knowledge[subject.key] ?? 0) / 100, 0, 1) * subject.max * 0.95);
    subjects[subject.key] = value;
    total += value;
  }
  return { total, subjects };
}

function runExam(game, item, result) {
  const subjects = {};
  let total = 0;
  for (const subject of subjectsOf(game)) {
    const value = subjectScore(game, subject);
    subjects[subject.key] = value;
    total += value;
  }
  const rank = rankFromScore(total);
  const record = {
    name: item.name,
    kind: item.kind,
    semesterIndex: game.semesterIndex,
    week: game.week,
    total,
    rank,
    subjects,
  };
  game.exams.push(record);
  result.exams.push(record);

  const lines = result.lines;
  lines.push(`\n📝 ${item.name}：总分 ${total} / ${TOTAL_MAX}　年级第 ${rank} 名（同级 1000 人）`);
  lines.push(subjectsOf(game).map((subject) => `${subject.name} ${subjects[subject.key]}`).join('　'));

  if (item.kind === 'gaokao') {
    lines.push('考试结束的铃声响起。你走出考场，六月的马鞍山很热，天很蓝。');
    finishGaokao(game, record, lines);
    return record;
  }

  if (rank <= 20) {
    game.stats.mood += 5;
    game.stats.teacherFavor += 4;
    game.stats.money += 120;
    lines.push('🎊 你冲进了年级前 20，年级组长在广播里念了你的名字，学校发了 120 元奖学金。');
  } else if (rank <= 200) {
    game.stats.mood += 2;
    game.stats.teacherFavor += 2;
    lines.push('🙂 名次在前 200，班主任在卷子上写了"还可以更狠一点"。');
  } else if (rank > 700) {
    game.stats.mood -= 4;
    game.stats.teacherFavor -= 2;
    lines.push('😞 名次在 700 名之后。晚自习你盯着卷子看了很久，一个字没写。');
  }

  // 老对手：你考好了他憋着劲，你考砸了他反而会来搭把手
  if (item.kind !== 'gaokao') {
    const rival = game.cast?.map?.rival;
    if (rank <= 50) {
      game.npc.rival = clamp((game.npc.rival ?? 0) + 3, 0, 100);
      if (rival) lines.push(`⚔️ ${rival.name}把成绩条翻来覆去看了三遍，最后只说了一句："下次不会了。"`);
    } else if (rank > 500) {
      game.npc.rival = clamp((game.npc.rival ?? 0) + 5, 0, 100);
      if (rival) lines.push(`⚔️ ${rival.name}把自己的错题本推过来一半："拿去看，别掉队。"`);
    }
  }
  if (item.kind === 'mock') {
    game.stats.mood -= 1.5;
    game.stats.fatigue += 3;
    lines.push('模拟考的意义不是分数，是让你知道还差多少。');
  }
  clampAndWarn(game, lines);
  pushLog(game, 'exam', `${item.name}：${total} 分`, `年级第 ${rank} 名`);
  return record;
}

function advanceWeek(game, result) {
  const plan = examPlan(game.semesterIndex, game.weeksPerSemester, { endless: game.endless });
  let endedByExam = false;
  for (const item of plan) {
    if (item.week !== game.week) continue;
    runExam(game, item, result);
    if (game.status !== 'playing') endedByExam = true;
  }

  game.week += 1;
  game.turn += 1;
  if (endedByExam) return;

  if (game.week > game.weeksPerSemester) {
    game.week = 1;
    if (game.endless && game.semesterIndex >= SEMESTERS.length - 1) {
      result.lines.push('\n📅 又一轮复习开始了。距离高考的日子由你自己决定——想考就报，不想考就再等等。');
      pushLog(game, 'system', '自由模式', '又一轮复习开始了');
      return;
    }
    game.semesterIndex += 1;
    if (game.semesterIndex >= SEMESTERS.length) {
      finish(game, 'graduated');
      return;
    }
    const semester = SEMESTERS[game.semesterIndex];
    const text =
      semester.grade === 3
        ? '开学了。你走进高三教学楼，走廊上贴着红色的倒计时牌。'
        : `新学期开始：${semester.name}。教室换到了${semester.grade === 2 ? '二楼' : '一楼'}，班主任在黑板上写了新的目标。`;
    result.lines.push(`\n📅 ${text}`);
    pushLog(game, 'system', semester.name, text);
  }
}

/* ------------------------------------------------------------- 结算与结局 */

const ENDINGS = {
  baosong: {
    id: 'baosong',
    title: '保送：竞赛之光',
    tier: '保送',
    school: '清华大学 / 北京大学',
    good: true,
    text: '国家集训队的名单公示那天，整个二中都在传你的名字。你不用参加高考了——三年里那些没人看见的深夜，最后变成了两条路任你挑。',
  },
  expelled: {
    id: 'expelled',
    title: '劝退：学籍终止',
    tier: '退学',
    school: '无',
    good: false,
    text: '违纪记录攒到最后一页时，教导主任把处分决定放在你面前。你抱着书包走出校门，健康路上的梧桐树落了满地叶子。',
  },
  depressed: {
    id: 'depressed',
    title: '休学：先照顾好自己',
    tier: '休学',
    school: '休学一年',
    good: false,
    text: '你在心理咨询室坐了很久，最后医生说："先休息吧，高考可以等。"你办了休学手续。这一年不需要成绩，只需要你慢慢好起来。',
  },
  hospital: {
    id: 'hospital',
    title: '住院：身体先垮了',
    tier: '休学',
    school: '休学一年',
    good: false,
    text: '你在跑操时晕倒在跑道上，醒来时在人民医院的病房里。医生说长期熬夜和营养不良。你盯着天花板，第一次觉得分数没那么重要。',
  },
  dropped_out: {
    id: 'dropped_out',
    title: '退学：你自己选的路',
    tier: '退学',
    school: '自己选的路',
    good: false,
    text: '你在退学申请上签了字。走出校门那天天气很好，你忽然不知道要去哪。但这是你自己做的决定——接下来要过的，是你自己的人生。',
  },
  friendship: {
    id: 'friendship',
    title: '同城：和好朋友在一起',
    tier: '友情结局',
    school: '同一座城市的大学',
    good: true,
    text: '你和{deskmate}把志愿填到了同一座城市。开学第一天你们在学校门口吃了顿烧烤，说好了以后每个周末都见。',
  },
  love: {
    id: 'love',
    title: '留在马鞍山：另一种圆满',
    tier: '爱情结局',
    school: '马鞍山师范高等专科学校',
    good: true,
    text: '分数不算好，但你们都没走远。很多年后你们在雨山湖边散步，TA 说："当年要是你考走了，我们就散了。"',
  },
  startup: {
    id: 'startup',
    title: '创业：没有学历，但有第一桶金',
    tier: '创业',
    school: '自己开的店',
    good: true,
    text: '高考成绩不理想，但你手里有三年攒下的钱和一个已经跑通的小生意。你在团结广场租下了一个门面——二中的学生都来打卡。',
  },
  vlog: {
    id: 'vlog',
    title: '自媒体：镜头里的三年',
    tier: '传媒路线',
    school: '传媒类院校',
    good: true,
    text: '你拍的二中日常积累了小十万粉丝。一位做纪录片的前辈私信你："来我们学校读传媒吧，你的镜头感很难得。"',
  },
  graduated: {
    id: 'graduated',
    title: '毕业',
    tier: '毕业',
    school: '—',
    good: true,
    text: '三年结束了。你站在操场上拍了毕业照，校服第三颗扣子被同桌要走了。',
  },

  /* --- 抽象结局：起因都很小，但身体扛不住的时候真的会直接结束 --- */
  food_poison: {
    id: 'food_poison',
    title: '路边摊：急性肠胃炎',
    tier: '意外结局',
    school: '休学半学期',
    good: false,
    text:
      '十串炸串，一个没有招牌的摊子，一把夹过生肉的夹子。\n' +
      '你在人民医院躺了三天，输液输到手背发青。出院的时候医生嘱咐"清淡饮食"，' +
      '妈妈在旁边补了一句"以后不许在外面吃"。\n' +
      '回到学校那天，你的座位被人挪到了最后一排。这一局，到这儿就结束了。',
  },
  lake_fall: {
    id: 'lake_fall',
    title: '雨山湖：掉进水里',
    tier: '意外结局',
    school: '休学一学期',
    good: false,
    text:
      '脚踏船、湖心、站起来拍照的同学，还有你抓了两把都是滑的水草。\n' +
      '再睁眼是人民医院的天花板，医生说是吸入性肺炎，加上你本来体质就差，得慢慢养。\n' +
      '那件泡过水的校服被扔了。后来每次路过雨山湖，你都绕着走。这一局，到这儿就结束了。',
  },
  late_for_gaokao: {
    id: 'late_for_gaokao',
    title: '高考：睡过了头',
    tier: '意外结局',
    school: '再来一年',
    good: false,
    text:
      '通宵把六科错题本翻了一遍，代价是第二天睡到八点半。\n' +
      '第一科语文九点开考，你到考点时已经开考四十五分钟——按规定，不能进场。\n' +
      '你在马路牙子上坐到中午，看着别人的家长把考生接走。\n' +
      '三年里你算过那么多道题，唯独没算准这一个早上。这一局，到这儿就结束了。',
  },

  /* --- 自定义人物带出来的两条新出路 --- */
  esports: {
    id: 'esports',
    title: '电竞：另一个赛场',
    tier: '电竞路线',
    school: '职业青训队',
    good: true,
    text:
      '网吧后巷那台老机器的键盘已经被磨出了油光，你在上面练了三年。\n' +
      '城市赛的决赛打到第五局，你的手在抖，但屏幕上那波团战你没有失误。\n' +
      '赛后一个穿队服的人递给你一张名片："我们青训缺人，来试试。"\n' +
      '爸妈沉默了很久，最后是爸爸先开口："你要是真想去，就去。"\n' +
      '高考还在前面等着，但从这一天起，你多了一条自己挣来的路。',
  },
  scam: {
    id: 'scam',
    title: '刷单诈骗：那一笔转出去了',
    tier: '意外结局',
    school: '休学一学期',
    good: false,
    text:
      '"垫付三百，返你三百六"——前三单真的返了，第四单让你垫三千。\n' +
      '你把攒了两年的零花钱和妈妈放在抽屉里的买菜钱一起转了过去，然后被拉黑了。\n' +
      '报警、做笔录、等消息，钱没追回来。妈妈没有骂你，只是那天晚上没有做饭。\n' +
      '你坐在房间里，第一次明白"贪"这个字有多重。这一局，到这儿就结束了。',
  },

  /* --- 志愿填报失败：分数够，但表填崩了 --- */
  slip: {
    id: 'slip',
    title: '滑档：六个志愿全空',
    tier: '落榜',
    school: '征集志愿 / 复读',
    good: false,
    text:
      '投档那天你刷了十几遍页面，六个学校全部比你高。\n' +
      '你在志愿表上把最好的学校排在了最前面，把"服从调剂"那一栏犹豫了很久，最后没有勾。\n' +
      '班主任说："你的分数，其实稳走个一本没问题。"这句话比落榜本身更难受。\n' +
      '征集志愿还有几天。你把招生计划从头翻到尾，第一次觉得"填志愿"这三个字这么重。',
  },
};

function finish(game, endingId, extra = {}) {
  // 先到先得：一件事已经把这一局结束了（比如路边摊直接吃进医院），
  // 后面紧接着的 checkCollapse 不许再改结局。
  if (game.status === 'ended' && game.ending) return game.ending;

  const base = ENDINGS[endingId] ?? ENDINGS.graduated;
  const ending = { ...base, ...extra };
  ending.text = resolveText(ending.text, game);

  const goalDef = GOAL_MAP[game.build.goal];
  if (goalDef) {
    let achieved = false;
    try {
      achieved = Boolean(goalDef.check(game, ending));
    } catch {
      achieved = false;
    }
    ending.goal = { id: goalDef.id, name: goalDef.name, icon: goalDef.icon, desc: goalDef.desc, achieved };
  }

  ending.achievements = collectAchievements(game);
  ending.stats = roundStats(game.stats);
  ending.knowledge = roundStats(game.knowledge);
  ending.npc = { ...game.npc };
  ending.build = {
    traits: game.build.traits.map((id) => TRAIT_MAP[id]).filter(Boolean).map((trait) => ({ id: trait.id, name: trait.name, icon: trait.icon, desc: trait.desc })),
    background: BACKGROUND_MAP[game.build.background]
      ? { ...BACKGROUND_MAP[game.build.background] }
      : null,
    track: game.student.track,
    electives: game.selection.electives.map((key) => SUBJECT_MAP[key]?.name ?? key),
    items: game.items.map((id) => ITEM_MAP[id]).filter(Boolean).map((item) => ({ id: item.id, name: item.name, icon: item.icon })),
  };
  ending.turns = game.turn;
  // 关系树与故事线的收尾快照，结局页要用来回顾
  ending.relations = treeStats(relationGraph(game));
  ending.cast = (game.cast?.list ?? []).map((person) => ({
    id: person.id,
    name: person.name,
    role: person.role,
    icon: person.icon,
    group: person.group,
    affinity: person.affinity,
    value: Math.round(game.npc[person.affinity] ?? 0),
  }));
  ending.story = (game.story ?? []).map((entry) => ({
    arc: entry.arc,
    arcTitle: entry.arcTitle,
    title: entry.title,
    at: entry.at,
  }));

  game.status = 'ended';
  game.ending = ending;
  pushLog(game, 'system', `结局：${ending.title}`, ending.text);
  return game.ending;
}

function specialEndingFor(game, record) {
  const english = record.subjects.english ?? 0;
  const maxKnowledge = Math.max(...game.subjectKeys.map((key) => game.knowledge[key] ?? 0));

  if ((game.flags.qiangji || game.flags.contestProv1) && maxKnowledge >= 88 && record.total >= 600 && record.total < 636) {
    return {
      id: 'qiangji',
      title: '强基计划：基础学科的路',
      tier: '强基计划',
      school: '中国科学技术大学',
      good: true,
      text: '竞赛奖项加上高考分数，让你走进了强基计划的面试间。教授问你："为什么想学基础学科？"你讲了竞赛教室里那本被翻烂的教材。',
    };
  }
  if (game.stats.physique >= 80 && game.flags.sportsTeam && record.total >= 200 && record.total < 560) {
    return {
      id: 'sports',
      title: '体育单招：球场上的另一条路',
      tier: '体育特招',
      school: '北京体育大学 / 安徽省队',
      good: true,
      text: '高考分数不算高，但你的体测成绩和市赛录像被省队教练看中了。你签下体育单招协议，从此跑道就是你的课桌。',
    };
  }
  if (game.flags.artTrack && game.stats.comprehensive >= 70 && record.total >= 340 && record.total < 600) {
    return {
      id: 'art',
      title: '艺考：画笔下的出路',
      tier: '艺术类',
      school: '南京艺术学院 / 安徽师范大学（艺术）',
      good: true,
      text: '专业课过了线，文化课也没拖后腿。画室老师把你的作品贴在墙上，说："这就是我们想教出来的样子。"',
    };
  }
  if (game.flags.zonghe && game.stats.comprehensive >= 75 && record.total < 600) {
    return {
      id: 'zonghe',
      title: '综合评价：材料替你说话',
      tier: '综合评价',
      school: '南京师范大学 / 安徽大学（综评）',
      good: true,
      text: '面试老师翻着你的材料——模联、志愿时长、校合唱团、发表的短篇小说。他抬头说："这样的学生我们想要。"',
    };
  }
  if (game.stats.money >= 2500 && english >= 112) {
    return {
      id: 'abroad',
      title: '出国：飞过太平洋',
      tier: '海外本科',
      school: '海外大学',
      good: true,
      text: '你用三年兼职攒下的钱和一份 112 分的英语答卷，换回了一封海外大学的 offer。妈妈在机场哭了，你说："我会回来的。"',
    };
  }
  if (game.flags.published && game.stats.comprehensive >= 65 && record.total < 540) {
    return {
      id: 'vlog',
      title: '自媒体：镜头里的三年',
      tier: '传媒路线',
      school: '传媒类院校',
      good: true,
      text: '你拍的二中日常积累了小十万粉丝，杂志上还登过你的小说。一位做纪录片的前辈私信你："来我们学校读传媒吧。"',
    };
  }
  if (game.npc.love >= 70 && game.flags.earlyLove && record.total < 520) {
    return {
      id: 'love',
      title: '留在马鞍山：另一种圆满',
      tier: '爱情结局',
      school: '马鞍山师范高等专科学校',
      good: true,
      text: '分数不算好，但你们都没走远。很多年后你们在雨山湖边散步，TA 说："当年要是你考走了，我们就散了。"',
    };
  }
  if (game.npc.deskmate >= 85 && record.total >= 500 && record.total < 636) {
    return {
      id: 'friendship',
      title: '同城：和好朋友在一起',
      tier: '友情结局',
      school: '同一座城市的大学',
      good: true,
      text: '你和{deskmate}把志愿填到了同一座城市。开学第一天你们在学校门口吃了顿烧烤，说好了以后每个周末都见。',
    };
  }
  if (game.stats.money >= 3500 && record.total < 436) {
    return {
      id: 'startup',
      title: '创业：没有学历，但有第一桶金',
      tier: '创业',
      school: '自己开的店',
      good: true,
      text: '高考成绩不理想，但你手里有三年攒下的钱和一个已经跑通的小生意。你在团结广场租下门面，二中的学生都来打卡。',
    };
  }
  return null;
}

/**
 * 「毕业去向」能覆盖普通录取的分数上限。
 *
 * 这些结局都是"分数不够顶尖，但你手里有别的东西"：友谊、爱情、作品、材料、生意。
 * 所以沿用引擎原本的特殊结局口径——分够高就老老实实去上大学，
 * 别让一次人际选择把"我考了 650 分"的成就感吃掉。
 */
const GRADUATION_ENDING_CAPS = {
  friendship: 636,
  love: 520,
  startup: 436,
  vlog: 540,
  zonghe: 600,
};

/**
 * 高考结束。
 *
 * 三条路：
 *   1. 走了特殊路线（保送 / 强基 / 体育 / 艺考 / 综评 / 出国 / 传媒）→ 直接结算，没有志愿这一步；
 *   2. 普通路线且开了志愿填报 → 进入 `status: 'volunteering'`，把最后这一关交给玩家；
 *   3. 关掉志愿填报（老存档 / 自动对局 / `volunteers: false`）→ 按分数直接录取。
 */
function finishGaokao(game, record, lines = []) {
  const special = specialEndingFor(game, record);
  const topScore = Math.max(...game.exams.map((exam) => exam.total));
  const base = { gaokao: true, total: record.total, rank: record.rank, subjects: record.subjects, topScore };

  /*
   * 「毕业去向」优先于普通录取：因果链最后一环埋下的那条路，到这里结算。
   * 特殊路线（保送 / 强基 / 体育 / 艺考……）仍然排在它前面——
   * 那些是国家层面的通道，不该被一次人际选择覆盖。
   */
  if (!special && game.flags.graduationEnding) {
    const chainEnding = game.flags.graduationExtra ?? ENDINGS[game.flags.graduationEnding];
    const cap = GRADUATION_ENDING_CAPS[game.flags.graduationEnding] ?? Infinity;
    if (chainEnding && record.total < cap) {
      lines.push(`\n🧭 三年里的那个选择，把你带到了这里：${chainEnding.title}`);
      finish(game, 'graduated', { ...chainEnding, ...base, chainEnding: true, school: chainEnding.school ?? '自己选的路' });
      return;
    }
  }

  if (!special && game.volunteerMode !== false) {
    openVolunteer(game, record, lines);
    return;
  }

  const tier = collegeTierFor(record.total);
  const school = pick(game, tier.schools);
  const ending =
    special ??
    {
      id: `college:${tier.id}`,
      title: tier.title,
      tier: tier.tier,
      school,
      good: record.total >= 552,
      text: tier.text,
    };
  finish(game, 'graduated', {
    ...ending,
    ...base,
    school: special ? ending.school : school,
    tier: ending.tier ?? tier.tier,
  });
}

/* ------------------------------------------------------------- 志愿填报 */

/**
 * 把一局推进"填志愿"阶段。
 *
 * 分数只决定了你能碰到哪些学校，**志愿顺序和服从与否才是最后一关**：
 * 六个格子怎么排、要不要赌一把冲的、要不要勾服从调剂，全在这里。
 */
function openVolunteer(game, record, lines = []) {
  const board = buildVolunteerBoard(record, () => nextFloat(game));
  game.status = 'volunteering';
  game.volunteer = {
    total: record.total,
    rank: record.rank,
    subjects: { ...record.subjects },
    shift: board.shift,
    rumor: board.rumor,
    options: board.options,
    picks: [],
    submitted: false,
    adjustable: true,
    lines: [],
  };
  lines.push('\n📋 分数出来了。接下来是最后一关：六个格子，怎么填。');
  lines.push(`　今年分数线风向：${board.rumor}`);
  pushLog(game, 'system', '志愿填报', `总分 ${record.total}，年级第 ${record.rank} 名。${board.rumor}六个格子，自己填。`);
}

/** 志愿填报阶段的只读状态（给界面用）。没有这个阶段时返回 null。 */
export function volunteerState(game) {
  const state = game?.volunteer;
  if (!state) return null;
  const active = game.status === 'volunteering';
  const summary = { chong: 0, wen: 0, bao: 0 };
  for (const id of state.picks) {
    const option = state.options.find((entry) => entry.id === id);
    if (!option) continue;
    if (option.level === '冲') summary.chong += 1;
    else if (option.level === '稳') summary.wen += 1;
    else if (option.level === '保') summary.bao += 1;
  }
  return {
    active,
    submitted: Boolean(state.submitted),
    total: state.total,
    rank: state.rank,
    slots: VOLUNTEER_SLOTS,
    picks: state.picks.slice(),
    adjustable: state.adjustable !== false,
    rumor: state.rumor,
    shift: state.shift,
    subjects: { ...state.subjects },
    options: state.options.map((option) => ({ ...option })),
    summary,
    lines: (state.lines ?? []).slice(),
    result: state.result ?? null,
  };
}

/**
 * 提交志愿表并投档。
 *
 * @param {object} game
 * @param {string[]} picks 志愿顺序（option id 数组，最多 6 个）
 * @param {{ adjust?: boolean }} [options] adjust = 是否服从调剂（默认 true）
 * @returns {{ lines: string[], ending: object|null }}
 */
export function submitVolunteers(game, picks, options = {}) {
  if (game.status !== 'volunteering' || !game.volunteer) {
    throw new GameError('现在不是填志愿的时候。');
  }
  const state = game.volunteer;
  const adjust = options.adjust !== false;
  const valid = [];
  for (const id of Array.isArray(picks) ? picks : []) {
    if (!state.options.some((option) => option.id === id) || valid.includes(id)) continue;
    valid.push(id);
    if (valid.length >= VOLUNTEER_SLOTS) break;
  }
  state.picks = valid;
  state.submitted = true;

  const lines = [`\n📋 志愿表交上去了：${valid.length} 个志愿，${adjust ? '服从调剂' : '不服从调剂'}。`];
  const record = { total: state.total, rank: state.rank, subjects: state.subjects };
  if (valid.length === 0) {
    lines.push('你一个志愿都没填。招生办的人看了你一眼，什么也没说。');
  }
  const outcome = resolveVolunteers(record, state.options, valid, adjust);
  lines.push(...outcome.lines);

  const topScore = Math.max(...game.exams.map((exam) => exam.total));
  const base = { gaokao: true, total: record.total, rank: record.rank, subjects: record.subjects, topScore };

  if (outcome.admitted) {
    const tier = COLLEGE_TIERS.find((entry) => entry.id === outcome.admitted.tierId) ?? collegeTierFor(record.total);
    const detail = {
      tierId: outcome.admitted.tierId,
      tierName: outcome.admitted.tierName,
      school: outcome.admitted.school,
      major: outcome.admitted.major,
      majorName: outcome.admitted.majorName,
      majorIcon: outcome.admitted.majorIcon,
      minScore: outcome.admitted.minScore,
      round: outcome.round,
      adjusted: outcome.adjusted,
      slip: false,
    };
    state.result = detail;
    state.lines = lines.slice();
    lines.push(
      outcome.adjusted
        ? `🎓 录取结果：${outcome.admitted.school} · ${outcome.admitted.majorName}（调剂录取）`
        : `🎓 录取结果：第 ${outcome.round} 志愿 · ${outcome.admitted.school} · ${outcome.admitted.majorName}`,
    );
    if (outcome.adjusted) {
      lines.push('不是你想去的那个专业，但九月的车票已经买好了。有人劝你复读，你把那张票放进了钱包。');
    }
    finish(game, 'graduated', {
      id: `college:${tier.id}`,
      title: tier.title,
      tier: tier.tier,
      school: outcome.admitted.school,
      good: record.total >= 552,
      text: outcome.adjusted
        ? `${tier.text}\n（不过专业是调剂的：${outcome.admitted.majorName}。你查了一晚上这个专业到底学什么。）`
        : tier.text,
      collegeTier: tier.id,
      volunteer: detail,
      ...base,
    });
    return { lines, ending: game.ending };
  }

  // 六个志愿全滑档
  const detail = { tierId: null, tierName: '落榜', school: '征集志愿 / 复读', major: null, majorName: null, round: 0, adjusted: false, slip: true };
  state.result = detail;
  state.lines = lines.slice();
  lines.push(`💧 六个志愿全部滑档${adjust ? '，服从调剂也没能把你捞回来' : '——你没勾服从调剂'}。`);
  finish(game, 'slip', {
    ...base,
    volunteer: detail,
    school: record.total >= 366 ? '征集志愿 / 复读' : '复读',
    total: record.total,
    rank: record.rank,
    subjects: record.subjects,
    topScore,
  });
  return { lines, ending: game.ending };
}

/** 自动对局用：按"冲稳保"的常识自动填一张志愿表。 */
export function autoFillVolunteers(game, strategy = 'balanced') {
  const state = game.volunteer;
  if (!state) return { picks: [], adjust: true };
  const sorted = state.options.slice().sort((a, b) => b.minScore - a.minScore);
  const reach = sorted.filter((option) => option.gap < 0);
  const steady = sorted.filter((option) => option.gap >= 0 && option.gap < 25);
  const safe = sorted.filter((option) => option.gap >= 25);
  const pick = (list, count) => list.slice(0, count).map((option) => option.id);
  let picks;
  if (strategy === 'gamble') picks = [...pick(reach, 3), ...pick(steady, 2), ...pick(safe, 1)];
  else if (strategy === 'safe') picks = [...pick(safe, 3), ...pick(steady, 3)];
  else picks = [...pick(reach, 1), ...pick(steady, 2), ...pick(safe, 3)];
  // 不够 6 个就按"最稳的"补齐
  for (const option of sorted) {
    if (picks.length >= VOLUNTEER_SLOTS) break;
    if (!picks.includes(option.id)) picks.push(option.id);
  }
  return { picks: picks.slice(0, VOLUNTEER_SLOTS), adjust: true };
}

function checkCollapse(game, lines) {
  if (game.stats.discipline >= EFF.expelAt) {
    lines.push('🚨 违纪累计到顶，学校下达了劝退决定。');
    finish(game, 'expelled');
    return true;
  }
  if (game.stats.mood <= 0.5) {
    lines.push('💧 你撑不住了。心理老师建议你休学一段时间。');
    finish(game, 'depressed');
    return true;
  }
  if (game.stats.physique <= 0.5) {
    lines.push('🏥 你在教室里晕倒了，被救护车送去了人民医院。');
    finish(game, 'hospital');
    return true;
  }
  return false;
}

function collectAchievements(game) {
  const actionCount = (id) => game.history.filter((item) => item.action === id).length;
  const list = [];
  const add = (icon, name, desc) => list.push({ icon, name, desc });

  if ((game.flags.contestStage ?? 0) >= 3) add('🏅', '竞赛省一', '在学科竞赛里拿到省一等奖');
  if ((game.flags.contestStage ?? 0) >= 5) add('🏆', '国家集训队', '站上了竞赛路的顶端');
  if (game.flags.qiangji) add('🧪', '强基候选人', '拿到了强基计划的敲门砖');
  if (game.flags.honorStudent) add('✉️', '市级优秀学生', '老师亲手为你写了推荐');
  if (game.flags.classLeader) add('📋', '班干部', '当上了学习委员，收发作业一整年');
  if (game.flags.basketballHero) add('🏀', '班级英雄', '在决赛里投进了关键球');
  if (game.flags.sportsTeam) add('🏃', '校队成员', '在操场上练了一整个高中');
  if (game.flags.artTrack) add('🎨', '艺考路线', '画室的松节油味，你闻了三年');
  if (game.flags.zonghe) add('📁', '综评材料王', '把三年攒成了一摞材料');
  if (game.flags.published) add('🖊️', '发表过作品', '杂志上印着你的名字');
  if (game.flags.oath) add('📣', '誓师大会', '喊哑了嗓子，也在课桌上刻下了日期');
  if (game.flags.bridgeWalk) add('🌉', '走过状元桥', '高考前的那一圈，你走了');
  if (game.flags.confessed) add('💗', '表白过', '把憋了很久的话说了出来');
  if (game.flags.rejected) add('💧', '被拒绝过', '那也是青春的一部分');
  if (game.flags.brokeUp) add('💔', '分手专注学习', '很疼，但很专注');
  if (game.flags.earlyLove) add('💌', '高中恋爱', '在雨山湖边绕过的远路');
  if (game.flags.loveExposed) add('👀', '被抓包', '班主任的办公室谈话');
  if (game.flags.tutorJob) add('💵', '家教达人', '靠自己挣来的零花钱');
  if (game.npc.deskmate >= 85) add('🤝', '一生之友', `和${game.cast.map.deskmate.name}的友谊撑过了三年`);
  if (game.npc.friend >= 85) add('🧢', '过命的交情', `和${game.cast.map.friend.name}一起把高三熬完了`);
  if (game.npc.rival >= 85) add('⚔️', '旗鼓相当', `和${game.cast.map.rival.name}从对手变成了战友`);
  if (game.npc.parents >= 85) add('🏠', '家里的骄傲', '父母始终站在你这边');
  if (game.npc.love >= 80) add('💞', '双向奔赴', 'TA 的好感度 80+');
  if (game.items.length >= 4) add('🛍️', '装备齐全', '四件以上的私人物品');
  if (game.stats.money >= 3000) add('💰', '第一桶金', '高中毕业前攒下 3000 元');
  if (game.stats.discipline >= 60) add('🚨', '违纪大户', '通报批评贴了一整栏');
  if (actionCount('game') >= 5) add('🎮', '网吧常客', '团结广场后巷的熟面孔');
  if (actionCount('work') >= 4) add('💼', '打工达人', '自己挣来的零花钱');
  if (actionCount('read') >= 4) add('📚', '卷外之人', '把《三体》藏在英语书后面');
  if (actionCount('help') >= 5) add('🧑‍🏫', '小老师', '讲题讲到自己也会了');
  if (actionCount('family_time') >= 4) add('🍲', '懂事的孩子', '高三还常回家吃饭');
  if (game.subjectKeys.every((key) => (game.knowledge[key] ?? 0) >= 85)) add('🧊', '六边形战士', '六科知识全部 85+');
  const best = game.exams.reduce((min, exam) => Math.min(min, exam.rank ?? 9999), 9999);
  if (best <= 1) add('👑', '年级第一', '红榜最上面那一行');
  else if (best <= 10) add('⭐', '年级前十', '站在了红榜的最上面几行');
  if (game.exams.some((exam) => exam.kind === 'gaokao' && exam.total >= 680)) add('🎓', '高分考生', '高考 680+');
  // 剧情收集
  const storyCount = (game.story ?? []).length;
  if (storyCount >= 8) add('📖', '故事收集者', `这一局演了 ${storyCount} 章剧情`);
  if (storyCount >= 18) add('📚', '三年如书', `把 ${storyCount} 章剧情看完了`);
  if ((game.story ?? []).some((entry) => entry.arc === 'love')) add('💗', '心动过', '走过雨山湖边那条远路');
  // 抽象路线：这些事本身不算光彩，但确实是三年里发生过的
  if (game.flags.stomachBug) add('🍢', '路边摊的代价', '在校门口那家摊子上栽过一次');
  if (game.flags.fellInLake) add('🛶', '湿身', '雨山湖的水比想的冷');
  if (game.flags.closeCallGaokao) add('⏰', '差点睡过头', '高考当天踩着点冲进考场');
  if (game.flags.missedGaokao) add('😴', '睡过了头', '这一觉代价有点大');
  // 自定义人物：开局你给自己写了什么，这一局就照着活
  const build = game.build ?? {};
  if (build.personality && build.personality !== 'plain') add('🎭', '我是这样的人', `开局选了「${PERSONALITY_MAP[build.personality]?.name ?? build.personality}」这个性格`);
  if ((build.flaws ?? []).length) add('🩹', '带着短板上场', `认下了「${FLAW_MAP[build.flaws[0]]?.name ?? build.flaws[0]}」换属性点`);
  {
    const spent = build.points?.spent ?? 0;
    if (spent >= 10) add('🧬', '精心捏出来的人', `开局手动分配了 ${spent} 点属性`);
    if ((build.legacyPoints ?? 0) > 0) add('🔁', '传承者', `带着 ${build.legacyPoints} 点多周目传承开局`);
    if (Object.keys(build.customCast ?? {}).length) add('✍️', '自己写的人', '同桌、死党、对手的名字是你自己定的');
  }
  if (game.difficulty === 'custom') add('🛠️', '自己定的规则', '用自定义难度打完了一局');
  /*
   * 志愿填报：这一套成就只跟"最后那一关"有关。
   * 它们不看分数，只看你怎么填的——分数高也可能填崩。
   */
  {
    const result = game.volunteer?.result ?? game.ending?.volunteer ?? null;
    if (result) {
      if (result.round === 1) add('🎯', '第一志愿录取', '六个格子里，你最想去的那个中了');
      if (result.round >= 5) add('🍀', '压线录取', `第 ${result.round} 志愿才接住你`);
      if (result.adjusted) add('📞', '服从调剂', '不是想去的专业，但九月的车票买好了');
      if (result.slip) add('📋', '滑档', '分数够，志愿填崩了');
      if (!result.slip && !result.adjusted) add('🧾', '志愿表没白填', '自己填的志愿，自己拿到录取');
    }
    const optionCount = (game.volunteer?.options ?? []).length;
    if (optionCount > 0 && game.status !== 'playing') add('🔍', '研究过招生计划', '认真看完了今年的院校专业组');
  }
  /*
   * 校园日常事件（events5.js）自带的成就。
   * 数据放在事件文件里，那边新增事件时顺手加一条就行，
   * 不用回来改引擎——引擎只认"这个 flag 有没有被写进 game.flags"。
   */
  for (const item of CAMPUS_ACHIEVEMENTS) {
    if (game.flags[item.flag]) add(item.icon, item.name, item.desc);
  }
  // 因果链事件自带的成就（同样由内容文件声明，引擎只按 flag 捡）
  for (const item of CHAIN_ACHIEVEMENTS) {
    if (game.flags[item.flag]) add(item.icon, item.name, item.desc);
  }
  return list;
}

/* --------------------------------------------------------------- 图鉴 */

/** 全部结局图鉴（用于跨局收集与展示）。 */
export function endingCatalog() {
  return [
    ...COLLEGE_TIERS.map((tier) => ({
      id: `college:${tier.id}`,
      tier: tier.tier,
      title: tier.title,
      icon: tier.id === 'top2' ? '👑' : tier.id === 'huawu' ? '🏛️' : tier.id === 'cudu' ? '📕' : '🎓',
      hint: `高考 ${tier.min}+ 分`,
    })),
    { id: 'baosong', tier: '保送', title: '保送：竞赛之光', icon: '🏆', hint: '竞赛线打到国家集训队' },
    { id: 'qiangji', tier: '强基计划', title: '强基计划：基础学科的路', icon: '🧪', hint: '竞赛奖项 + 单科 88 + 620 分' },
    { id: 'sports', tier: '体育特招', title: '体育单招：球场上的另一条路', icon: '🏃', hint: '体质 80 + 校队 + 总分 <560' },
    { id: 'art', tier: '艺术类', title: '艺考：画笔下的出路', icon: '🎨', hint: '艺考班 + 综合素质 70' },
    { id: 'zonghe', tier: '综合评价', title: '综合评价：材料替你说话', icon: '📁', hint: '综评报名 + 综合素质 75' },
    { id: 'abroad', tier: '海外本科', title: '出国：飞过太平洋', icon: '✈️', hint: '零花钱 2500 + 英语 112' },
    { id: 'vlog', tier: '传媒路线', title: '自媒体：镜头里的三年', icon: '🎬', hint: '发表过作品 + 综合素质 65' },
    { id: 'love', tier: '爱情结局', title: '留在马鞍山：另一种圆满', icon: '💗', hint: '恋爱线 70 + 总分 <520' },
    { id: 'friendship', tier: '友情结局', title: '同城：和好朋友在一起', icon: '🤝', hint: '同桌好感 85 + 500~636 分' },
    { id: 'startup', tier: '创业', title: '创业：没有学历，但有第一桶金', icon: '🏪', hint: '3500 元 + 总分 <436' },
    { id: 'dropped_out', tier: '退学', title: '退学：你自己选的路', icon: '🚪', hint: '主动申请退学' },
    { id: 'expelled', tier: '退学', title: '劝退：学籍终止', icon: '🚨', hint: '违纪累计到 120' },
    { id: 'depressed', tier: '休学', title: '休学：先照顾好自己', icon: '💧', hint: '心情归零' },
    { id: 'hospital', tier: '休学', title: '住院：身体先垮了', icon: '🏥', hint: '体质归零' },
    // 抽象结局：起因都很小，但身体扛不住的时候会直接结束
    { id: 'food_poison', tier: '意外结局', title: '路边摊：急性肠胃炎', icon: '🍢', hint: '体质低于 35 时吃校门口的路边摊' },
    { id: 'lake_fall', tier: '意外结局', title: '雨山湖：掉进水里', icon: '🛶', hint: '体质低于 39 时上脚踏船，船会翻' },
    { id: 'late_for_gaokao', tier: '意外结局', title: '高考：睡过了头', icon: '😴', hint: '高考前夜通宵，然后没被闹钟叫醒' },
    { id: 'esports', tier: '电竞路线', title: '电竞：另一个赛场', icon: '🎮', hint: '把网吧赛打到底，会有人递名片给你' },
    { id: 'scam', tier: '意外结局', title: '刷单诈骗：那一笔转出去了', icon: '📱', hint: '网上兼职让你"先垫付"的时候' },
    { id: 'slip', tier: '落榜', title: '滑档：六个志愿全空', icon: '📋', hint: '六个志愿全填了够不着的学校，又不服从调剂' },
  ];
}

/** 一局游戏的摘要，给元进度 / 图鉴用。 */
export function runSummary(game) {
  const view = viewState(game);
  const gaokao = game.exams.find((exam) => exam.kind === 'gaokao');
  return {
    name: game.student.name,
    seed: game.seedText,
    difficulty: game.difficulty,
    endless: game.endless,
    turns: view.turn,
    status: game.status,
    build: {
      track: game.student.track,
      electives: game.selection.electives.map((key) => SUBJECT_MAP[key]?.name ?? key),
      traits: game.build.traits.map((id) => TRAIT_MAP[id]?.name ?? id),
      background: BACKGROUND_MAP[game.build.background]?.name ?? game.build.background,
      goal: GOAL_MAP[game.build.goal]?.name ?? game.build.goal,
    },
    ending: game.ending
      ? {
          id: game.ending.id,
          galleryId: game.ending.id,
          title: game.ending.title,
          tier: game.ending.tier,
          school: game.ending.school,
          total: game.ending.total ?? null,
          rank: game.ending.rank ?? null,
          goal: game.ending.goal ?? null,
        }
      : null,
    gaokao: gaokao ? { total: gaokao.total, rank: gaokao.rank, subjects: gaokao.subjects } : null,
    exams: game.exams.map((exam) => ({ name: exam.name, total: exam.total, rank: exam.rank })),
    stats: view.stats,
    npc: { ...game.npc },
    knowledge: Object.fromEntries(view.subjects.map((subject) => [subject.key, subject.knowledge])),
    achievements: game.ending?.achievements?.map((item) => item.name) ?? [],
    items: game.items.slice(),
    cast: (game.cast?.list ?? []).map((person) => ({ id: person.id, name: person.name, role: person.role })),
    storyChapters: (game.story ?? []).map((entry) => `${entry.arcTitle} · ${entry.title}`),
  };
}

/* --------------------------------------------------------------- 存档 */

export function serialize(game, pretty = false) {
  return JSON.stringify(game, null, pretty ? 2 : 0);
}

export function deserialize(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!data || typeof data !== 'object') throw new GameError('存档格式不正确。');
  if (![1, VERSION].includes(data.version)) {
    throw new GameError(`存档版本不兼容（存档 v${data.version}，当前 v${VERSION}）。`);
  }
  if (!data.stats || !data.knowledge || !data.student) throw new GameError('存档缺少必要字段。');

  // v1 存档升级：老版本是理科固定六科、每周一个行动
  if (data.version === 1) {
    data.version = VERSION;
    data.subjectKeys = CORE_KEYS.concat(['physics', 'chemistry', 'biology']).filter((key) => key in data.knowledge);
    data.selection = { track: 'physics', electives: ['chemistry', 'biology'] };
    data.student.track = '物理类';
    data.student.trackId = 'physics';
    data.build = { traits: [], background: 'worker', goal: 'yiben' };
    data.endless = false;
    data.items = [];
  }

  data.subjectKeys ??= CORE_KEYS.concat(['physics', 'chemistry', 'biology']).filter((key) => key in data.knowledge);
  data.selection ??= { track: data.student.trackId ?? 'physics', electives: ['chemistry', 'biology'] };
  data.build ??= { traits: [], background: 'worker', goal: 'yiben' };
  data.build.traits ??= [];
  data.build.background ??= 'worker';
  data.build.goal ??= 'yiben';
  // v2.5「自定义人物」新增的字段：老存档一律补成"没自定义过"的中性值，
  // 默认性格用 plain（无加成），这样老存档的手感不会因为读档而变。
  data.build.personality ??= 'plain';
  if (!PERSONALITY_MAP[data.build.personality]) data.build.personality = 'plain';
  data.build.flaws = Array.isArray(data.build.flaws) ? data.build.flaws.filter((id) => FLAW_MAP[id]).slice(0, EFF.maxFlaws) : [];
  data.build.preset ??= null;
  data.build.points ??= { spend: {}, subjects: {}, spent: 0, budget: 0, legacy: 0 };
  data.build.points.spend ??= {};
  data.build.points.subjects ??= {};
  data.build.legacyPoints = Number(data.build.legacyPoints) || 0;
  data.build.customCast ??= {};
  data.student.avatar ??= 'student';
  data.student.avatarIcon ??= AVATAR_MAP[data.student.avatar]?.icon ?? '🧑';
  data.student.nickname ??= '';
  data.difficultyRules ??= null;
  data.items ??= [];
  data.npc = { head: 55, math: 50, deskmate: 45, friend: 35, rival: 30, parents: 60, love: 0, ...(data.npc ?? {}) };
  // 「不进则退」的周记账：老存档没有这几个字段，补成干净的初始状态
  data.weekGain = data.weekGain && typeof data.weekGain === 'object' ? data.weekGain : {};
  data.weekendGain = Number(data.weekendGain) || 0;
  data.startProfile ??= { lopsided: false, weakKeys: [], weakNames: [] };
  // 老存档里没有人物阵容：按种子重新生成同一批名字
  if (!data.cast?.list) {
    data.cast = buildCast(data.seedText ?? String(data.student?.name ?? 'seed'), {
      studentGender: data.student?.gender,
      studentSurname: String(data.student?.name ?? '你').slice(0, 1),
      avoid: data.student?.name,
      overrides: data.build.customCast,
    });
  }
  if (!Array.isArray(data.story)) data.story = [];
  // 志愿填报与因果链：老存档一律补成"没有这两样东西"
  data.volunteer = data.volunteer && typeof data.volunteer === 'object' ? data.volunteer : null;
  data.volunteerMode = data.volunteerMode !== false;
  data.chains = Array.isArray(data.chains) ? data.chains : [];
  data.flags ??= {};
  data.cooldowns ??= {};
  data.log ??= [];
  data.exams ??= [];
  data.history ??= [];
  data.pendingEvent ??= null;
  data.status ??= 'playing';
  data.phase = data.phase === 'weekend' ? 'weekend' : 'main';
  data.endless = Boolean(data.endless);
  if (!data.baseMods) {
    data.baseMods = sumMods(
      ...(data.build.traits ?? []).map((id) => TRAIT_MAP[id]?.mods),
      BACKGROUND_MAP[data.build.background]?.mods,
      PERSONALITY_MAP[data.build.personality]?.mods,
      ...(data.build.flaws ?? []).map((id) => FLAW_MAP[id]?.mods),
    );
  }
  recomputeMods(data);
  for (const key of ALL_SUBJECT_KEYS) {
    if (typeof data.knowledge[key] !== 'number') data.knowledge[key] = 0;
  }
  return data;
}

/* ------------------------------------------------------------- 视图数据 */

export function viewState(game) {
  const semester = SEMESTERS[game.semesterIndex];
  const exam = nextExamInfo(game);
  const estimate = estimateExam(game);
  const weeks = totalWeeks(game);
  const goal = GOAL_MAP[game.build.goal];
  return {
    version: VERSION,
    school: { name: SCHOOL.name, short: SCHOOL.short, motto: SCHOOL.motto, city: SCHOOL.city },
    student: { ...game.student },
    status: game.status,
    difficulty: { ...rulesOf(game), key: game.difficulty },
    /** 自定义难度是不是玩家自己调过（界面显示"自定义"标记） */
    customRules: game.difficultyRules ? { ...game.difficultyRules } : null,
    /** 开局底子（真实难度会偏科，这里把弱科列给界面看）。 */
    startProfile: game.startProfile ?? { lopsided: false, weakKeys: [], weakNames: [] },
    /** 每周每科大约会忘掉多少（没碰过的科目），界面用来说明"不进则退"。 */
    decayPerWeek: (() => {
      const d = EFF.forgetting;
      const scale = rulesOf(game)?.forgetScale ?? 1;
      const keep = clamp(1 - (game.mods.decay ?? 0), 0.1, 1.6);
      const idle = (d.base + d.idleWeekendExtra) * scale * keep;
      const diligent = d.base * scale * d.weekendStudyDiscount * d.studiedKeep * keep;
      return { idle: round1(idle), maintained: round1(diligent) };
    })(),
    endless: Boolean(game.endless),
    phase: game.phase,
    phaseLabel: phaseLabel(game),
    /** 志愿填报（高考之后才出现；没到那一步是 null）。 */
    volunteer: volunteerState(game),
    weekendScale: EFF.weekendScale,
    turn: game.turn,
    totalWeeks: weeks,
    weeksLeft: Math.max(0, weeks - game.turn),
    semesterIndex: game.semesterIndex,
    semesterName: semester?.name ?? '毕业',
    grade: semester?.grade ?? 3,
    week: game.week,
    weeksPerSemester: game.weeksPerSemester,
    calendarLabel: weekLabel(game),
    nextExam: exam,
    progress: weeks ? round1(game.turn / weeks) : 1,
    stats: roundStats(game.stats),
    statMeta: STAT_META,
    selection: {
      track: game.student.track,
      trackId: game.student.trackId,
      electives: game.selection.electives,
      label: `${game.student.track} · ${game.selection.electives.map((key) => SUBJECT_MAP[key]?.name).join('+')}`,
    },
    build: {
      traits: game.build.traits.map((id) => TRAIT_MAP[id]).filter(Boolean).map((trait) => ({ id: trait.id, name: trait.name, icon: trait.icon, desc: trait.desc })),
      background: BACKGROUND_MAP[game.build.background] ?? null,
      goal: goal ? { id: goal.id, name: goal.name, icon: goal.icon, desc: goal.desc } : null,
      personality: PERSONALITY_MAP[game.build.personality] ?? null,
      flaws: (game.build.flaws ?? []).map((id) => FLAW_MAP[id]).filter(Boolean),
      /** 属性点方案：界面拿它显示"我开局怎么加的点" */
      points: {
        spent: game.build.points?.spent ?? 0,
        budget: game.build.points?.budget ?? 0,
        legacy: game.build.points?.legacy ?? 0,
        spend: game.build.points?.spend ?? {},
        subjects: game.build.points?.subjects ?? {},
      },
      legacyPoints: game.build.legacyPoints ?? 0,
      /** 玩家自己定过名字/性别的角色位（关系图里标一下） */
      customCast: Object.keys(game.build.customCast ?? {}),
      avatar: AVATAR_MAP[game.student.avatar] ?? null,
    },
    mods: Object.fromEntries(Object.entries(game.mods).filter(([, value]) => value !== 0)),
    npc: NPCS.map((npc) => {
      const person = game.cast?.byAffinity?.[npc.key]?.[0];
      const full = person ? game.cast.map[person] : null;
      return {
        ...npc,
        // 兼容老前端：name 保持"角色 · 全名"的形状
        name: full ? `${npc.role} · ${full.name}` : npc.name,
        short: full ? full.name : npc.role,
        cast: full ? full.id : null,
        value: Math.round(game.npc[npc.key] ?? 0),
      };
    }),
    /** 这一局的人都是谁（关系树和故事线共用）。 */
    cast: (game.cast?.list ?? []).map((person) => ({
      id: person.id,
      name: person.name,
      call: person.call,
      role: person.role,
      icon: person.icon,
      group: person.group,
      gender: person.gender,
      affinity: person.affinity,
      value: Math.round(game.npc[person.affinity] ?? 0),
      blurb: person.blurb,
    })),
    relations: (() => {
      const graph = relationGraph(game);
      return { stats: treeStats(graph), people: graph.people };
    })(),
    story: storyProgress(game),
    items: game.items.map((id) => ITEM_MAP[id]).filter(Boolean).map((item) => ({ id: item.id, name: item.name, icon: item.icon, desc: item.desc })),
    shop: listShop(game),
    subjects: subjectsOf(game).map((subject) => ({
      ...subject,
      knowledge: round1(game.knowledge[subject.key] ?? 0),
      estimate: estimate.subjects[subject.key] ?? 0,
    })),
    estimateTotal: estimate.total,
    flags: Object.entries(game.flags)
      .filter(([key, value]) => value === true && !key.startsWith('seen_') && !key.startsWith('count_') && !key.startsWith('used_'))
      .map(([key]) => key),
    exams: game.exams.map((item) => ({
      name: item.name,
      kind: item.kind,
      total: item.total,
      rank: item.rank,
      subjects: item.subjects,
      semesterIndex: item.semesterIndex,
      week: item.week,
    })),
    actions: listActions(game),
    pendingEvent: game.pendingEvent
      ? {
          id: game.pendingEvent.id,
          name: game.pendingEvent.name,
          icon: game.pendingEvent.icon,
          story: Boolean(game.pendingEvent.story),
          arcTitle: game.pendingEvent.arcTitle ?? null,
          text: game.pendingEvent.text,
          choices: game.pendingEvent.choices,
        }
      : null,
    log: game.log.slice(-60),
    ending: game.ending,
  };
}

/* ------------------------------------------------------------ 内部工具 */

function assertPlayable(game) {
  // 填志愿的时候不能再做行动，但错误信息要说得清楚（不然玩家以为游戏结束了）
  if (game.status === 'volunteering') {
    throw new GameError('现在正在填志愿：请先把志愿表交上去（六个格子填完点提交），这期间不能做别的行动。');
  }
  if (game.status !== 'playing') throw new GameError('这一局已经结束了，开新的一局吧。');
  if (game.pendingEvent) throw new GameError('还有一个事件没有处理完，请先做出选择。');
}

function statModifier(game, key, delta) {
  const mods = game.mods;
  switch (key) {
    case 'physique':
      return delta > 0 ? 1 + mods.physique : 1;
    case 'social':
      return delta > 0 ? 1 + mods.social : 1;
    case 'comprehensive':
      return delta > 0 ? 1 + mods.comprehensive : 1;
    case 'mood':
      return delta < 0 ? clamp(1 - mods.moodDrain, 0.2, 2) : 1;
    case 'fatigue':
      return delta > 0 ? clamp(1 - mods.fatigueGain, 0.2, 2) : 1 + mods.rest;
    default:
      return 1;
  }
}

function createApi(game, lines, subject, weekend) {
  const scale = weekend ? EFF.weekendScale : 1;
  const api = {
    game,
    subject,
    lines,
    scale,
    subjectName: () => (subject ? SUBJECT_MAP[subject].name : ''),
    subjectNameOf: (key) => SUBJECT_MAP[key]?.name ?? key,
    mod: (key) => game.mods[key] ?? 0,
    say(text) {
      const resolved = resolveText(text, game, subject);
      if (resolved) lines.push(resolved);
    },
    addStat(key, value) {
      if (!(key in game.stats)) return;
      game.stats[key] += value * scale * statModifier(game, key, value);
    },
    addNpc(key, value) {
      if (!NPC_KEYS.includes(key)) return;
      game.npc[key] = clamp((game.npc[key] ?? 0) + value, 0, 100);
    },
    addMoney(value) {
      game.stats.money += value;
    },
    addKnowledge(spec) {
      return applyKnowledge(game, spec, subject, scale);
    },
    flag(key, value = true) {
      game.flags[key] = value;
    },
    chance(probability) {
      return chance(game, clamp(probability, 0, 1));
    },
    randInt(min, max) {
      return randInt(game, min, max);
    },
    randFloat(min, max) {
      return randFloat(game, min, max);
    },
    pick(list) {
      return pick(game, list);
    },
    endGame(endingId, extra) {
      finish(game, endingId, extra);
    },
    takeGaokao() {
      const temp = { lines: api.lines, exams: [] };
      return runExam(game, { name: '高考', kind: 'gaokao', week: game.week }, temp);
    },
  };
  return api;
}

/**
 * 文本里的 {xxx} 占位符替换。
 *
 *   {name}       主角名字
 *   {subject}    当前科目
 *   {deskmate}   人物默认称呼（老师→"王老师"，同学→"雨欣"，家人→"爸爸"）
 *   {head.full}  全名（王雨欣）　{deskmate.call} 同学叫法
 *   {rival.role} 角色名　　{deskmate.ta} 代词（他/她）
 */
function resolveText(text, game, subject) {
  if (text === undefined || text === null) return '';
  const raw = typeof text === 'function' ? text(game) : text;
  let out = String(raw)
    .replace(/\{subject\}/g, subject ? SUBJECT_MAP[subject].name : '这科')
    .replace(/\{name\}/g, game?.student?.name ?? '你');
  if (out.includes('{')) out = out.replace(CAST_PLACEHOLDER, (match, id, mode) => personLabel(game, id, mode));
  return out;
}

const CAST_PLACEHOLDER = /\{(father|mother|head|math|deskmate|friend|rival|love|parents)(?:\.(full|call|role|ta))?\}/g;

/** 取某个角色在正文里的称呼。 */
function personLabel(game, id, mode) {
  if (id === 'parents') return '爸爸妈妈';
  const person = game?.cast?.map?.[id];
  if (!person) return id;
  if (mode === 'full') return person.name;
  if (mode === 'call') return person.call ?? person.name;
  if (mode === 'role') return person.role;
  if (mode === 'ta') return person.ta ?? '他';
  if (person.group === 'school') return person.teacher ?? person.name;
  if (person.group === 'family') return person.role;
  return person.call ?? person.name;
}

function applyEffects(game, effect, api) {
  const spec = typeof effect === 'function' ? effect(game) : effect;
  if (!spec) return;
  if (spec.text) api.say(spec.text);
  const { stats = {}, npc = {}, knowledge, money = 0, flags = {}, risk, ending, endingExtra, chain, graduationEnding, graduationExtra } = spec;
  for (const [key, value] of Object.entries(stats)) api.addStat(key, value);
  for (const [key, value] of Object.entries(npc)) api.addNpc(key, value);
  if (knowledge) api.addKnowledge(knowledge);
  if (money) api.addMoney(money);
  for (const [key, value] of Object.entries(flags)) game.flags[key] = value;
  if (chain) armChain(game, chain);
  /*
   * 「毕业去向」：这次选择决定了你三年之后会走上哪条路，但**不当场结束这一局**。
   *
   * 为什么需要它：因果链的最后一环常常是"毕业时的那件事"（那顿饭、那个摊位、那封信）。
   * 如果它直接在高三上就把一局掐断，玩家连高考都考不成——三年的主线被一个随机事件吃掉。
   * 所以这类结局改成在这里记账，等高考真正结束时再结算（见 finishGaokao）。
   */
  if (graduationEnding) {
    game.flags.graduationEnding = graduationEnding;
    if (graduationExtra) game.flags.graduationExtra = graduationExtra;
  }
  if (Array.isArray(risk)) {
    for (const entry of risk) {
      const probability = clamp(entry.chance ?? 0, 0, 1);
      if (chance(game, probability)) {
        api.say(entry.text);
        applyEffects(game, entry.effect, api);
      }
    }
  }
  // 让 effect 可以直接写"这件事直接把你送进结局"，不用额外挂 special 钩子。
  // 抽象结局（路边摊吃出肠胃炎、划船落水）就是靠这个触发的。
  // 放在最后：先结算完其它效果，结局里的属性快照才完整。
  if (ending && game.status === 'playing') api.endGame(ending, endingExtra);
}

/**
 * 排一条因果链：几周之后，这件事会回来找你。
 *
 * 内容作者在 effect 里写 `chain: { id: 'chain_xxx', delay: 4 }` 或数组即可，
 * 不需要写任何逻辑。如果被链的事件在内容表里已经不存在（内容包被撤掉了），
 * 这条链会被安静地丢掉，而不是把游戏卡死。
 */
function armChain(game, spec) {
  const list = Array.isArray(spec) ? spec : [spec];
  game.chains ??= [];
  const armed = [];
  for (const entry of list) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (!id || !EVENT_MAP[id]) continue;
    const delay = clamp(Math.round(Number(entry?.delay ?? 4)) || 4, 1, 40);
    game.chains.push({ id, atTurn: game.turn + delay });
    armed.push(id);
  }
  return armed;
}

/** 到点没到点的因果链（界面上可以提示"你做过的事还没结束"）。 */
export function pendingChains(game) {
  if (!Array.isArray(game?.chains)) return [];
  return game.chains
    .filter((entry) => EVENT_MAP[entry.id])
    .map((entry) => ({
      id: entry.id,
      name: EVENT_MAP[entry.id].name,
      icon: EVENT_MAP[entry.id].icon ?? '🎲',
      inTurns: Math.max(0, (entry.atTurn ?? 0) - game.turn),
    }));
}

function knowledgeTargets(game, spec, subject) {
  const keys = game.subjectKeys.slice();
  const pairs = [];
  const fallback = () => {
    const sorted = keys.slice().sort((a, b) => (game.knowledge[a] ?? 0) - (game.knowledge[b] ?? 0));
    return sorted[0] ?? 'math';
  };

  if (spec.all !== undefined) for (const key of keys) pairs.push([key, spec.all]);
  if (spec.subject !== undefined && subject) pairs.push([subject, spec.subject]);
  if (spec.weakest !== undefined) {
    const count = Math.max(1, Math.round(spec.count ?? 2));
    const sorted = keys.slice().sort((a, b) => (game.knowledge[a] ?? 0) - (game.knowledge[b] ?? 0)).slice(0, count);
    for (const key of sorted) pairs.push([key, spec.weakest]);
  }
  if (spec.random !== undefined) {
    const count = Math.max(1, Math.round(spec.count ?? 2));
    for (const key of shuffle(game, keys).slice(0, count)) pairs.push([key, spec.random]);
  }
  for (const key of ALL_SUBJECT_KEYS) {
    if (spec[key] === undefined) continue;
    pairs.push([keys.includes(key) ? key : fallback(), spec[key]]);
  }
  return pairs;
}

function applyKnowledge(game, spec, subject, scale = 1) {
  if (!spec) return {};
  const diff = rulesOf(game);
  const intelligence = 0.7 + (game.stats.intelligence / 100) * 0.6;
  const fatigue = fatigueFactor(game);
  const mood = moodFactor(game);
  const deltas = {};

  for (const [key, amount] of knowledgeTargets(game, spec, subject)) {
    const current = game.knowledge[key] ?? 0;
    // 边际递减：越接近满分越提不动。难度可以把这个坡度调陡、把下限压低
    const slope = EFF.knowledgeSlope * (diff.slopeScale ?? 1);
    const floor = diff.gainFloor ?? EFF.minGainFactor;
    const capFactor = clamp(1 - (slope * current) / 100, floor, 1);
    const noise = randFloat(game, 0.85, 1.15);
    const delta =
      amount *
      scale *
      EFF.gainScale *
      (1 + (game.mods.study ?? 0)) *
      capFactor *
      intelligence *
      fatigue *
      mood *
      noise *
      diff.gain;
    const next = clamp(current + delta, 0, 100);
    deltas[key] = (deltas[key] ?? 0) + (next - current);
    game.knowledge[key] = next;
  }
  return deltas;
}

/**
 * 记一笔"这周在某几科上真的涨了分"。
 *
 * 记的是**可观测的分数变化**，而不是"做了某个学习行动"——
 * 所以事件、道具、特殊逻辑加的分数同样算数，而"好好睡觉"那种顺手 +0.2
 * （低于 touchThreshold）不会被当成学习。
 *
 * 周末那一项看的是**单科最大涨幅**，不是六科加起来：
 * 睡觉给每科 +0.2，加总是 1.2 会误判成"周末学了"，按单科算就只是 0.2，正确。
 */
function trackKnowledgeGain(game, before, weekend) {
  game.weekGain ??= {};
  let best = 0;
  for (const key of game.subjectKeys) {
    const delta = (game.knowledge[key] ?? 0) - (before.knowledge[key] ?? 0);
    if (delta <= 0) continue;
    game.weekGain[key] = (game.weekGain[key] ?? 0) + delta;
    best = Math.max(best, delta);
  }
  if (weekend && best > 0) game.weekendGain = Math.max(game.weekendGain ?? 0, best);
  return best;
}

/**
 * 「不进则退」：每周结算时，没碰过的科目会忘掉一部分。
 *
 * 三条规则叠在一起，逼着玩家"轮着学"而不是"死磕一科"：
 *   1. 每科每周都有基础遗忘（按难度缩放）；
 *   2. 这周涨了至少 touchThreshold 分的科目几乎不掉，没碰的就是实打实地掉；
 *   3. 周末没学进去 → 全科额外多忘一层；周末学了 → 整体少忘一点。
 *
 * @returns {{ total: number, parts: object[], weekendStudied: boolean }}
 */
function applyKnowledgeDecay(game) {
  const rule = EFF.forgetting;
  const diff = rulesOf(game);
  const scale = diff.forgetScale ?? 1;
  const weekGain = game.weekGain ?? {};
  const threshold = rule.touchThreshold;
  const weekendStudied = (game.weekendGain ?? 0) >= threshold;
  /*
   * 遗忘的"人格系数"：mods.decay 是正的 = 忘得慢（过目不忘 -40%），
   * 也可以是负的 = 忘得更快（缺陷"开窍晚" +20%）。
   * 上限 1.6 / 下限 0.1，免得叠出"忘得只剩 0"或"越忘越多"的离谱数值。
   */
  const keep = clamp(1 - (game.mods.decay ?? 0), 0.1, 1.6);
  const parts = [];
  let total = 0;

  for (const key of game.subjectKeys) {
    const current = game.knowledge[key] ?? 0;
    const touched = (weekGain[key] ?? 0) >= threshold;

    let amount = rule.base * scale;
    amount *= weekendStudied ? rule.weekendStudyDiscount : 1;
    if (!weekendStudied) amount += rule.idleWeekendExtra * scale;
    if (touched) amount *= rule.studiedKeep;
    // 本来就低分的不容易继续掉，免得直接归零（也符合"弱科反而好提"的直觉）
    if (current < 60) amount *= rule.weakBonus;
    amount *= keep;

    const next = Math.max(rule.floor, current - amount);
    const delta = next - current;
    if (delta === 0) continue;
    game.knowledge[key] = next;
    total += -delta;
    parts.push({ key, name: SUBJECT_MAP[key]?.name ?? key, delta });
  }

  // 这一周的账记完了，清空，等下一周重新记
  game.weekGain = {};
  game.weekendGain = 0;

  return { total, parts, weekendStudied };
}

function applyWeeklyUpkeep(game, lines) {
  const mods = game.mods;
  game.stats.money += EFF.weeklyAllowance + mods.allowance - EFF.weeklyLivingCost;
  game.stats.fatigue -= EFF.weeklyFatigueRecovery + mods.weeklyRecovery;
  game.stats.mood += mods.weeklyMood - EFF.weeklyMoodDrain;
  if (game.stats.discipline > 0) game.stats.discipline -= EFF.disciplineDecay;
  if (game.stats.fatigue >= 85) game.stats.mood -= 1.6;
  if (game.stats.mood <= 25) game.stats.fatigue += 1.2;
  if (game.stats.social <= 15) game.stats.mood -= 0.8;
  if (game.npc.parents >= 75) game.stats.money += 20;
  else if (game.npc.parents < 30) game.stats.mood -= 1.2;
  if (game.npc.deskmate >= 70) game.stats.mood += 0.6;
  if (game.flags.classLeader) {
    game.stats.teacherFavor += 0.8;
    game.stats.comprehensive += 0.5;
    game.stats.fatigue += 0.6;
  }
  if (game.flags.artTrack) game.stats.comprehensive += 0.6;
  if (game.flags.sportsTeam) game.stats.physique += 0.8;

  // 不进则退：没碰过的科目这周就白丢了
  const decay = applyKnowledgeDecay(game);
  if (decay.total >= 0.3) {
    const shown = decay.parts
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 4)
      .map((part) => `${part.name} ${round1(part.delta)}`)
      .join('　');
    const more = decay.parts.length > 4 ? `　等 ${decay.parts.length} 科` : '';
    const nudge = decay.weekendStudied ? '' : '（周末没学，掉得更快）';
    lines.push(`📉 不进则退：${shown}${more}${nudge}`);
  }
}

function clampAndWarn(game, lines) {
  for (const [key, meta] of Object.entries(STAT_META)) {
    game.stats[key] = clamp(game.stats[key] ?? 0, meta.min, meta.max);
  }
  for (const key of NPC_KEYS) {
    game.npc[key] = clamp(game.npc[key] ?? 0, 0, 100);
  }
  if (game.stats.money < 0) {
    game.stats.money = 0;
    lines.push('💸 零花钱见底了，这周只能靠食堂最便宜的套餐过。');
  }
}

function snapshotProgress(game) {
  return { stats: { ...game.stats }, knowledge: { ...game.knowledge }, npc: { ...game.npc } };
}

function describeDelta(before, after) {
  const out = [];
  const statParts = [];
  for (const [key, meta] of Object.entries(STAT_META)) {
    const delta = (after.stats[key] ?? 0) - (before.stats[key] ?? 0);
    if (Math.abs(delta) >= 0.5) statParts.push(`${meta.name} ${delta > 0 ? '+' : ''}${round1(delta)}`);
  }
  const money = Math.round(after.stats.money - before.stats.money);
  if (money !== 0) statParts.push(`零花钱 ${money > 0 ? '+' : ''}${money}`);
  if (statParts.length) out.push(`📊 ${statParts.join('　')}`);

  const npcParts = [];
  for (const key of NPC_KEYS) {
    const delta = (after.npc[key] ?? 0) - (before.npc[key] ?? 0);
    if (Math.abs(delta) >= 1) {
      const label = NPC_MAP[key]?.role ?? key;
      npcParts.push(`${label} ${delta > 0 ? '+' : ''}${round1(delta)}`);
    }
  }
  if (npcParts.length) out.push(`💞 ${npcParts.join('　')}`);

  const knowledgeParts = [];
  for (const key of after.subjectKeys ?? Object.keys(after.knowledge)) {
    const delta = (after.knowledge[key] ?? 0) - (before.knowledge[key] ?? 0);
    if (Math.abs(delta) >= 0.05) knowledgeParts.push(`${SUBJECT_MAP[key]?.name ?? key} ${delta > 0 ? '+' : ''}${round1(delta)}`);
  }
  if (knowledgeParts.length) out.push(`📈 ${knowledgeParts.join('　')}`);
  return out;
}

function pushLog(game, kind, title, text) {
  game.log.push({
    turn: game.turn,
    week: game.week,
    semesterIndex: game.semesterIndex,
    kind,
    title,
    text: text ?? '',
    at: `${SEMESTERS[game.semesterIndex]?.name ?? '毕业'} 第 ${game.week} 周`,
  });
  if (game.log.length > 400) game.log.splice(0, game.log.length - 400);
}

function finalizeResult(game, result) {
  result.ended = game.status !== 'playing';
  result.ending = game.ending;
  result.phase = game.phase;
  if (result.ended && game.ending) {
    result.lines.push(`\n🏁 结局：${game.ending.title}`);
    result.lines.push(game.ending.text);
  }
  return result;
}

export {
  ACTIONS,
  BACKGROUNDS,
  COLLEGE_TIERS,
  CORE_KEYS,
  ELECTIVE_KEYS,
  GOALS,
  ITEMS,
  NPCS,
  PRIMARY_KEYS,
  SEMESTERS,
  STAT_META,
  SUBJECT_MAP,
  SUBJECT_POOL,
  TOTAL_MAX,
  TRAITS,
  TRACKS,
  collegeTierFor,
  examPlan,
  advanceStory,
  rankFromScore,
  randomStudentName,
  relationGraph,
  renderTreeText,
  storyCatalog,
  storyEvents,
  storyProgress,
  subjectsFor,
  treeStats,
  validateSelection,
};
export { emptyMods, sumMods };
export { CAST_GROUPS, CAST_ROLES, affinityLevel } from './data/cast.js';
// 志愿填报（v2.6 终局玩法）与内容包（热更新）要用到的东西
export { VOLUNTEER_OPTIONS, VOLUNTEER_SLOTS, MAJORS, MAJOR_MAP, levelFor, resolveVolunteers } from './data/colleges.js';
export {
  PACK_FORMAT,
  checksumPack,
  diffPack,
  normalizePack,
  summarizePack,
  validatePack,
} from './content.js';
export { SURNAMES } from './data/names.js';
