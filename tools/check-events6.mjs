#!/usr/bin/env node
/**
 * events6.js（因果链）自检脚本（零依赖）。
 *
 *   node tools/check-events6.mjs
 *
 * 查六件事：
 *   1. 结构：18~22 个事件、id 唯一且是 snake_case、kind 合法、每个 choice 事件 2~4 个选项
 *      （选项 id 不重复）、name 6~14 字、weight 6~14 的整数、text 60~200 字、hint ≤12 字；
 *   2. 链：effect 里的 `chain` 只能是 `{id,delay}` 或它的数组，delay 是 3~8 的整数，
 *      目标必须是 events6 里真实存在的 `chain_` 前缀事件，而且那个事件必须标了 chainOnly；
 *      反过来，每个 `chain_` 事件都必须 chainOnly、必须被至少一条链指到、不许出现在随机池外没人管；
 *      第一环（非 chain_ 前缀）不许写 chainOnly；
 *   3. 结局：所有 ending id 都在引擎 endingCatalog() 里；至少 4 条链的最后一环引用了真实结局；
 *      带 endingExtra 的必须把 id 写对（zonghe 这种"现场拼"的结局靠它兜底）；
 *   4. 日历：21 个事件全部登记在 EVENT_SCHEDULE，窗口在"6 学期 × 第 1~6 周"里至少命中一次；
 *   5. 撞名 + 成就：id 不能跟 events1~5 / story.js 撞；成就 6~8 条、flag 不重复、
 *      而且每条成就的 flag 都真的会被某个 effect（含 risk 分支）写出来；
 *   6. 真的跑一遍：用真实引擎 createGame + resolveEvent 把每个事件每个选项走一遍（引擎还没接上
 *      events6 时退化成直接调用 effect），再把 effect 逐字段审一遍（未知字段、非法 stats/npc 键、
 *      chain 结构、risk 结构、占位符拼写），并且每个分支都在 5 种状态各跑一次。
 *
 * 失败时逐条打印，process.exitCode 置 1。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CHAIN_ACHIEVEMENTS, CHAIN_EVENTS } from '../src/data/events6.js';
import { EVENT_SCHEDULE, calendarOf, matchesSchedule, scheduleFor } from '../src/data/calendar.js';
import { ALL_SUBJECT_KEYS, SEMESTERS } from '../src/data/school.js';
import { ALL_EVENTS, EVENT_MAP, createGame, endingCatalog, resolveEvent } from '../src/engine.js';

const MIN_EVENTS = 18;
const MAX_EVENTS = 22;
const MIN_TEXT = 60;
const MAX_TEXT = 200;
const MIN_DELAY = 3;
const MAX_DELAY = 8;
const INDEX_FILES = [
  '../src/data/events.js',
  '../src/data/events2.js',
  '../src/data/events3.js',
  '../src/data/events4.js',
  '../src/data/events5.js',
  '../src/story.js',
  '../src/data/story.js',
];

const EFFECT_KEYS = new Set([
  'text',
  'stats',
  'npc',
  'knowledge',
  'money',
  'flags',
  'risk',
  'ending',
  'endingExtra',
  'chain',
  // 「毕业去向」：不当场结束这一局，等高考结束时再结算（见 engine 的 finishGaokao）。
  // 因果链的最后一环是"毕业时的那件事"，用 ending 会把高考直接掐掉，所以改用这两个字段。
  'graduationEnding',
  'graduationExtra',
]);
const STAT_KEYS = new Set([
  'intelligence',
  'physique',
  'mood',
  'social',
  'teacherFavor',
  'comprehensive',
  'fatigue',
  'discipline',
  'money',
]);
const NPC_KEYS = new Set(['head', 'math', 'deskmate', 'friend', 'rival', 'parents', 'love']);
const KNOWLEDGE_SPECIAL = new Set(['all', 'subject', 'weakest', 'random', 'count']);
const PLACEHOLDER_IDS = new Set([
  'name',
  'subject',
  'father',
  'mother',
  'head',
  'math',
  'deskmate',
  'friend',
  'rival',
  'love',
  'parents',
]);
const PLACEHOLDER_MODES = new Set(['full', 'call', 'role', 'ta']);

const problems = [];
const fail = (message) => problems.push(message);
const load = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const chars = (value) => [...String(value)].length;

/** 所有分支产出过的文案（用来证明"状态差才会出事"那些分支真的走得到）。 */
const corpus = [];
const note = (value) => {
  if (typeof value === 'string' && value.trim()) corpus.push(value);
};

const byId = new Map(CHAIN_EVENTS.map((event) => [event?.id, event]));
const endingsUsed = new Map(); // ending id -> [where...]
const flagsSeen = new Set(); // 所有 effect（含 risk 分支）写过的 flag
const edges = []; // { from, to, delay, via }
const edgeKeys = new Set();
let currentEventId = null;
let engineRuns = 0;
let directRuns = 0;

/* ------------------------------------------------------------------ 一、结构 */

const seenIds = new Set();
let choiceCount = 0;
let autoCount = 0;

for (const [index, event] of CHAIN_EVENTS.entries()) {
  const where = `CHAIN_EVENTS[${index}]${event?.id ? ` (${event.id})` : ''}`;
  if (typeof event?.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(event.id)) {
    fail(`${where}: id 必须是 snake_case 字符串`);
    continue;
  }
  if (seenIds.has(event.id)) fail(`${where}: id 重复`);
  seenIds.add(event.id);

  if (chars(event.name) < 6 || chars(event.name) > 14) {
    fail(`${event.id}: name 要在 6~14 字之间（现在 ${chars(event.name)} 字）`);
  }
  if (typeof event.icon !== 'string' || chars(event.icon) === 0) fail(`${event.id}: icon 缺失`);
  if (!['choice', 'auto'].includes(event.kind)) fail(`${event.id}: kind 只能是 choice / auto`);
  if (!Number.isInteger(event.weight) || event.weight < 6 || event.weight > 14) {
    fail(`${event.id}: weight 必须是 6~14 的整数（现在 ${event.weight}）`);
  }
  if (typeof event.text !== 'string' && typeof event.text !== 'function') {
    fail(`${event.id}: text 必须是字符串或函数`);
  }
  if (event.chainOnly !== undefined && event.chainOnly !== true) {
    fail(`${event.id}: chainOnly 只能是 true 或干脆不写`);
  }
  if (event.id.startsWith('chain_')) {
    if (event.chainOnly !== true) fail(`${event.id}: chain_ 前缀的后续环必须写 chainOnly: true`);
  } else if (event.chainOnly === true) {
    fail(`${event.id}: 第一环（会进随机池）不该写 chainOnly`);
  }

  if (event.kind === 'auto') {
    autoCount += 1;
    if (event.choices !== undefined) fail(`${event.id}: auto 事件不许有 choices`);
    if (event.effect === undefined) fail(`${event.id}: auto 事件必须有 effect`);
    continue;
  }

  choiceCount += 1;
  if (!Array.isArray(event.choices) || event.choices.length < 2 || event.choices.length > 4) {
    fail(`${event.id}: choice 事件要有 2~4 个选项（现在 ${event.choices?.length ?? 0}）`);
    continue;
  }
  const choiceIds = new Set();
  for (const choice of event.choices) {
    if (typeof choice?.id !== 'string' || !choice.id) {
      fail(`${event.id}: 选项缺少 id`);
      continue;
    }
    if (choiceIds.has(choice.id)) fail(`${event.id}: 选项 id 重复（${choice.id}）`);
    choiceIds.add(choice.id);
    if (typeof choice.label !== 'string' || !choice.label.trim()) fail(`${event.id}/${choice.id}: label 为空`);
    if (typeof choice.hint !== 'string' || !choice.hint.trim()) fail(`${event.id}/${choice.id}: hint 为空`);
    if (typeof choice.hint === 'string' && chars(choice.hint) > 12) {
      fail(`${event.id}/${choice.id}: hint 超过 12 字（${chars(choice.hint)} 字）`);
    }
    if (typeof choice.outcome !== 'string' && typeof choice.outcome !== 'function') {
      fail(`${event.id}/${choice.id}: outcome 必须是字符串或函数`);
    }
    if (choice.effect === undefined) fail(`${event.id}/${choice.id}: 缺少 effect`);
  }
}

if (CHAIN_EVENTS.length < MIN_EVENTS || CHAIN_EVENTS.length > MAX_EVENTS) {
  fail(`事件数量应该在 ${MIN_EVENTS}~${MAX_EVENTS} 个之间，现在是 ${CHAIN_EVENTS.length} 个`);
}
if (!Array.isArray(CHAIN_ACHIEVEMENTS) || CHAIN_ACHIEVEMENTS.length < 6 || CHAIN_ACHIEVEMENTS.length > 8) {
  fail(`CHAIN_ACHIEVEMENTS 要有 6~8 条（现在 ${CHAIN_ACHIEVEMENTS?.length ?? 0} 条）`);
}

const roots = CHAIN_EVENTS.filter((event) => !event.id.startsWith('chain_')).map((event) => event.id);
if (roots.length !== 8) fail(`应该有 8 条链的第一环（现在 ${roots.length} 个：${roots.join('、')}）`);

/* ------------------------------------------------------------------ 二、日历 */

const WEEKS = 6;
const semesters = SEMESTERS.length || 6;
for (const event of CHAIN_EVENTS) {
  const schedule = EVENT_SCHEDULE[event.id];
  if (!schedule) {
    fail(`${event.id}: 没有在 EVENT_SCHEDULE 里登记`);
    continue;
  }
  let reachable = false;
  for (let semesterIndex = 0; semesterIndex < semesters && !reachable; semesterIndex += 1) {
    for (let week = 1; week <= WEEKS; week += 1) {
      if (matchesSchedule(scheduleFor('event', event.id), calendarOf({ semesterIndex, week, weeksPerSemester: WEEKS }))) {
        reachable = true;
        break;
      }
    }
  }
  if (!reachable) fail(`${event.id}: 时间表写死了，任何学期任何周都触发不了`);
}

/* ------------------------------------------------------------------ 三、撞名 */

const foreign = new Map();
for (const relative of INDEX_FILES) {
  for (const match of load(relative).matchAll(/id:\s*['"]([A-Za-z0-9_]+)['"]/g)) {
    if (!foreign.has(match[1])) foreign.set(match[1], relative);
  }
}
for (const event of CHAIN_EVENTS) {
  const owner = foreign.get(event.id);
  if (owner) fail(`${event.id}: id 跟 ${owner.replace('../', '')} 里已有的 id 撞了`);
}

/* ------------------------------------------------- 四、effect 逐字段审 + 跑一遍 */

/** 五种状态：让 text 的两支、risk 的轻重两支、四类结局分支都走到。 */
const games = {
  // 状态极差：心情 / 体质 / 老师好感 / 家里人缘全线走低
  worn: () => {
    const game = createGame({ seed: 'check-events6-worn', name: '自检', weeksPerSemester: 6 });
    Object.assign(game.stats, {
      intelligence: 26,
      physique: 22,
      mood: 18,
      social: 12,
      teacherFavor: 18,
      comprehensive: 6,
      fatigue: 88,
      discipline: 3,
      money: 8,
    });
    Object.assign(game.npc, { head: 22, math: 25, deskmate: 18, friend: 16, rival: 15, parents: 22, love: 4 });
    return game;
  },
  // 状态很好：走 risk 的"没事"分支
  healthy: () => {
    const game = createGame({ seed: 'check-events6-healthy', name: '自检', weeksPerSemester: 6 });
    Object.assign(game.stats, {
      intelligence: 92,
      physique: 95,
      mood: 95,
      social: 82,
      teacherFavor: 88,
      comprehensive: 84,
      fatigue: 4,
      discipline: 0,
      money: 900,
    });
    Object.assign(game.npc, { head: 90, math: 90, deskmate: 92, friend: 90, rival: 88, parents: 92, love: 88 });
    return game;
  },
  // 分数塌了的一局：走 startup 分支（接摊子）
  struggling: () => {
    const game = createGame({ seed: 'check-events6-struggling', name: '自检', weeksPerSemester: 6 });
    Object.assign(game.stats, { comprehensive: 30, mood: 52, money: 300 });
    for (const key of game.subjectKeys) game.knowledge[key] = 22;
    return game;
  },
  // 归档 A：第一环走"前一支"的 flag（叮嘱过 / 推过车 / 白天练 / 顶过嘴 / 交了表 …）
  archA: () => {
    const game = games.healthy();
    Object.assign(game.flags, {
      lentItem: true,
      lentNagged: true,
      lendAskedFix: true,
      forgedSignature: true,
      helpedStranger: true,
      strangerOrange: true,
      secretSkill: true,
      secretSkillOpen: true,
      harshWords: true,
      momCried: true,
      clubJoined: true,
      clubPoster: true,
      peekedExam: true,
      peekNoticed: true,
      lakePromiseVague: true,
      promiseMaybe: true,
    });
    return game;
  },
  // 归档 B：走"后一支" flag（大方借出 / 认识老爷子 / 偷偷练 / 摔门 / 拖过期 …）
  archB: () => {
    const game = games.healthy();
    Object.assign(game.flags, {
      lentItem: true,
      lentFriendly: true,
      lendLetGo: true,
      signatureDeferred: true,
      helpedStranger: true,
      strangerBond: true,
      secretSkill: true,
      slammedDoor: true,
      brokeIce: true,
      clubFormForgotten: true,
      clubErrand: true,
      peekedExam: true,
      lakePromise: true,
      promiseKept: true,
    });
    return game;
  },
};

function checkPlaceholders(text, where) {
  for (const match of String(text).matchAll(/\{([^{}]*)\}/g)) {
    const [raw, body] = match;
    const [id, mode] = body.split('.');
    if (!PLACEHOLDER_IDS.has(id) || (mode !== undefined && !PLACEHOLDER_MODES.has(mode))) {
      fail(`${where}: 占位符 ${raw} 不是引擎认识的写法`);
    }
  }
}

function auditChain(value, game, where) {
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) fail(`${where}: chain 不能是空数组`);
  for (const [i, entry] of list.entries()) {
    const spot = `${where}.chain[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${spot}: chain 每一项都要是 { id, delay }`);
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!['id', 'delay'].includes(key)) fail(`${spot}: chain 里不认识的字段 ${key}`);
    }
    if (typeof entry.id !== 'string' || !entry.id) {
      fail(`${spot}: chain.id 必须是字符串`);
      continue;
    }
    if (!Number.isInteger(entry.delay) || entry.delay < MIN_DELAY || entry.delay > MAX_DELAY) {
      fail(`${spot}: delay 必须是 ${MIN_DELAY}~${MAX_DELAY} 的整数（现在 ${entry.delay}）`);
    }
    const target = byId.get(entry.id);
    if (!target) {
      fail(`${spot}: 链到了一个不存在的事件 id：${entry.id}`);
      continue;
    }
    if (!entry.id.startsWith('chain_')) fail(`${spot}: 链式后续环的 id 要用 chain_ 前缀（${entry.id}）`);
    if (target.chainOnly !== true) fail(`${spot}: ${entry.id} 被链到，但它没有写 chainOnly: true`);
    const key = `${currentEventId}->${entry.id}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ from: currentEventId, to: entry.id, delay: entry.delay, via: where });
    }
  }
}

function auditSpec(spec, game, where) {
  if (spec === undefined || spec === null) return;
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    fail(`${where}: effect 必须返回对象或 undefined`);
    return;
  }
  for (const key of Object.keys(spec)) {
    if (!EFFECT_KEYS.has(key)) fail(`${where}: 不认识的 effect 字段 ${key}`);
  }
  if (spec.text !== undefined) {
    if (typeof spec.text !== 'string' && typeof spec.text !== 'function') fail(`${where}: text 必须是字符串或函数`);
    if (typeof spec.text === 'string') {
      note(spec.text);
      checkPlaceholders(spec.text, where);
    }
    if (typeof spec.text === 'function') {
      try {
        note(spec.text(game));
        checkPlaceholders(spec.text(game), where);
      } catch (error) {
        fail(`${where}: text 函数抛异常（${error.message}）`);
      }
    }
  }
  for (const [key, value] of Object.entries(spec.stats ?? {})) {
    if (!STAT_KEYS.has(key)) fail(`${where}: stats 里没有这个键：${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where}: stats.${key} 必须是有限数字`);
  }
  for (const [key, value] of Object.entries(spec.npc ?? {})) {
    if (!NPC_KEYS.has(key)) fail(`${where}: npc 里没有这个键：${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where}: npc.${key} 必须是有限数字`);
  }
  if (spec.knowledge !== undefined) {
    if (typeof spec.knowledge !== 'object' || spec.knowledge === null || Array.isArray(spec.knowledge)) {
      fail(`${where}: knowledge 必须是对象`);
    } else {
      for (const [key, value] of Object.entries(spec.knowledge)) {
        if (!KNOWLEDGE_SPECIAL.has(key) && !ALL_SUBJECT_KEYS.includes(key)) {
          fail(`${where}: knowledge 里没有这个键：${key}`);
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where}: knowledge.${key} 必须是有限数字`);
      }
    }
  }
  if (spec.money !== undefined && (typeof spec.money !== 'number' || !Number.isFinite(spec.money))) {
    fail(`${where}: money 必须是有限数字`);
  }
  if (spec.flags !== undefined) {
    if (typeof spec.flags !== 'object' || spec.flags === null || Array.isArray(spec.flags)) {
      fail(`${where}: flags 必须是对象`);
    } else {
      for (const key of Object.keys(spec.flags)) flagsSeen.add(key);
    }
  }
  if (spec.chain !== undefined) auditChain(spec.chain, game, where);
  if (spec.ending !== undefined) {
    if (typeof spec.ending !== 'string') {
      fail(`${where}: ending 必须是字符串`);
    } else {
      if (!endingsUsed.has(spec.ending)) endingsUsed.set(spec.ending, []);
      endingsUsed.get(spec.ending).push(where);
    }
  }
  if (spec.endingExtra !== undefined) {
    if (typeof spec.endingExtra !== 'object' || spec.endingExtra === null || Array.isArray(spec.endingExtra)) {
      fail(`${where}: endingExtra 必须是对象`);
    } else if (spec.ending !== undefined && spec.endingExtra.id !== spec.ending) {
      fail(`${where}: endingExtra.id（${spec.endingExtra.id}）必须和 ending（${spec.ending}）一致`);
    }
  }
  if (spec.risk !== undefined) {
    if (!Array.isArray(spec.risk)) {
      fail(`${where}: risk 必须是数组`);
    } else {
      spec.risk.forEach((entry, i) => {
        const spot = `${where}.risk[${i}]`;
        if (typeof entry !== 'object' || entry === null) {
          fail(`${spot}: risk 每一项都要是对象`);
          return;
        }
        if (typeof entry.chance !== 'number' || !(entry.chance >= 0 && entry.chance <= 1)) {
          fail(`${spot}: chance 必须是 0~1 的数字`);
        }
        if (entry.text !== undefined) {
          if (typeof entry.text !== 'string' && typeof entry.text !== 'function') fail(`${spot}: text 必须是字符串`);
          if (typeof entry.text === 'string') {
            note(entry.text);
            checkPlaceholders(entry.text, spot);
          }
        }
        if (entry.effect === undefined) fail(`${spot}: 缺少 effect`);
        auditEffect(entry.effect, game, `${spot}.effect`);
      });
    }
  }
}

function auditEffect(effect, game, where) {
  if (effect === undefined) return;
  if (typeof effect === 'function') {
    let spec;
    try {
      spec = effect(game);
    } catch (error) {
      fail(`${where}: effect 函数抛异常（${error.message}）`);
      return;
    }
    if (spec !== undefined && spec !== null && (typeof spec !== 'object' || Array.isArray(spec))) {
      fail(`${where}: effect 函数必须返回对象或 undefined，实际返回 ${Array.isArray(spec) ? 'array' : typeof spec}`);
      return;
    }
    auditSpec(spec, game, where);
    return;
  }
  auditSpec(effect, game, where);
}

/** 按引擎期望的形状造一个 pendingEvent。 */
function makePending(event, game) {
  return {
    id: event.id,
    name: event.name,
    icon: event.icon ?? '🎲',
    story: false,
    arcTitle: null,
    text: typeof event.text === 'function' ? event.text(game) : event.text,
    choices: (event.choices ?? []).map((choice) => ({
      id: choice.id,
      label: typeof choice.label === 'function' ? choice.label(game) : choice.label,
      hint: choice.hint ?? null,
    })),
  };
}

const engineReady = CHAIN_EVENTS.every((event) => Boolean(EVENT_MAP[event.id]));
/*
 * 引擎还没把 events6 并进 BASELINE 的时候（Lead 接线的空档），这里**就地**把
 * CHAIN_EVENTS 塞进 ALL_EVENTS / EVENT_MAP——按引擎自己的注释，这两个是设计上
 * 允许原地改写的引用。这样即使还没接线，走的也是真正的 resolveEvent →
 * applyEffects → finish 这条路（含 clamp、risk、endingExtra），而不是"直接调用
 * effect"的降级路径。自检进程跑完就退出，不会污染别的测试。
 */
let injected = false;
if (!engineReady) {
  for (const event of CHAIN_EVENTS) {
    if (!EVENT_MAP[event.id]) {
      EVENT_MAP[event.id] = event;
      injected = true;
    }
    if (!ALL_EVENTS.includes(event)) ALL_EVENTS.push(event);
  }
}

for (const event of CHAIN_EVENTS) {
  currentEventId = event.id;
  // text：每个状态都算一遍长度（两支都要像话）
  for (const [mode, build] of Object.entries(games)) {
    const game = build();
    let text;
    try {
      text = typeof event.text === 'function' ? event.text(game) : event.text;
    } catch (error) {
      fail(`${event.id}: text 函数在 ${mode} 状态抛异常（${error.message}）`);
      continue;
    }
    if (typeof text !== 'string') {
      fail(`${event.id}: text 在 ${mode} 状态解析出来不是字符串`);
      continue;
    }
    checkPlaceholders(text, `${event.id}.text`);
    note(text);
    if (chars(text) < MIN_TEXT || chars(text) > MAX_TEXT) {
      fail(`${event.id}: text 要在 ${MIN_TEXT}~${MAX_TEXT} 字之间（${mode} 状态 ${chars(text)} 字）`);
    }
  }

  if (event.kind === 'auto') {
    for (const [mode, build] of Object.entries(games)) {
      auditEffect(event.effect, build(), `${event.id}.effect (${mode})`);
    }
    continue;
  }

  for (const choice of event.choices ?? []) {
    const label = `${event.id}/${choice.id}`;

    // outcome / label / hint 的占位符
    if (typeof choice.outcome === 'string') checkPlaceholders(choice.outcome, `${label}.outcome`);
    if (typeof choice.label === 'string') checkPlaceholders(choice.label, `${label}.label`);
    if (typeof choice.hint === 'string') checkPlaceholders(choice.hint, `${label}.hint`);

    for (const [mode, build] of Object.entries(games)) {
      const game = build();
      if (typeof choice.outcome === 'function') {
        try {
          const text = choice.outcome(game);
          note(text);
          if (typeof text !== 'string') fail(`${label}: outcome 函数在 ${mode} 状态返回的不是字符串`);
          else checkPlaceholders(text, `${label}.outcome`);
        } catch (error) {
          fail(`${label}: outcome 函数在 ${mode} 状态抛异常（${error.message}）`);
        }
      } else {
        note(choice.outcome);
      }
      // 真正跑一遍：引擎接上了就走 resolveEvent，没接上就退化成直接调用 effect
      game.pendingEvent = makePending(event, game);
      try {
        resolveEvent(game, choice.id);
        engineRuns += 1;
      } catch (error) {
        if (/未知事件/.test(error.message)) {
          directRuns += 1;
          try {
            const spec = typeof choice.effect === 'function' ? choice.effect(game) : choice.effect;
            auditSpec(spec, game, `${label} (直接调用)`);
          } catch (inner) {
            fail(`${label}: 直接调用 effect 抛异常（${inner.message}）`);
          }
        } else {
          fail(`${label}: resolveEvent 抛异常（${error.message}）`);
        }
      }
      auditEffect(choice.effect, game, `${label}.effect (${mode})`);
    }
  }
}

/* ------------------------------------------------------------------ 五、链 / 结局 */

// 每条链的可达性：每个 chain_ 事件至少被一条链指到
const incoming = new Map();
for (const edge of edges) {
  if (!incoming.has(edge.to)) incoming.set(edge.to, []);
  incoming.get(edge.to).push(edge);
}
for (const event of CHAIN_EVENTS) {
  if (!event.id.startsWith('chain_')) continue;
  if (!incoming.has(event.id)) fail(`${event.id}: 标了 chainOnly，却没有任何 chain 指向它（永远出不来）`);
}

// 从每个第一环出发，看这条链有没有走到一个真实结局
const forward = new Map();
for (const edge of edges) {
  if (!forward.has(edge.from)) forward.set(edge.from, new Set());
  forward.get(edge.from).add(edge.to);
}
const catalog = new Set(endingCatalog().map((entry) => entry.id));
const chainHasEnding = [];
const chainRings = [];
for (const root of roots) {
  const ring = [root];
  let frontier = [root];
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      for (const to of forward.get(id) ?? []) {
        if (ring.includes(to)) continue;
        ring.push(to);
        next.push(to);
      }
    }
    frontier = next;
  }
  chainRings.push({ root, ring });
  const hit = ring.filter((id) => {
    const event = byId.get(id);
    return (event?.choices ?? []).some((choice) => {
      const specs = [];
      try {
        specs.push(typeof choice.effect === 'function' ? choice.effect(games.healthy()) : choice.effect);
      } catch {
        /* 上面已经报过了 */
      }
      try {
        specs.push(typeof choice.effect === 'function' ? choice.effect(games.worn()) : choice.effect);
      } catch {
        /* 同上 */
      }
      return specs.some((spec) => Boolean(spec?.ending) || Boolean(spec?.graduationEnding));
    });
  });
  if (hit.length) chainHasEnding.push({ root, endings: [...new Set(hit.flatMap((id) => collectEndingsOf(byId.get(id))))] });
}
if (chainRings.length !== 8) fail(`应该有 8 条链，现在解析出 ${chainRings.length} 条`);
const badRing = chainRings.filter((item) => item.ring.length < 2 || item.ring.length > 3);
for (const item of badRing) fail(`${item.root}: 这条链有 ${item.ring.length} 环（要求 2~3 环）`);
if (chainHasEnding.length < 4) {
  fail(`至少要有 4 条链的最后一环能触发结局，现在只有 ${chainHasEnding.length} 条：${chainHasEnding.map((i) => i.root).join('、')}`);
}
for (const [id, wheres] of endingsUsed) {
  if (!catalog.has(id)) fail(`ending id ${id} 不在引擎的结局图鉴里（${wheres[0]}）`);
}

function collectEndingsOf(event) {
  const out = [];
  for (const choice of event?.choices ?? []) {
    for (const mode of ['healthy', 'worn', 'struggling']) {
      let spec;
      try {
        spec = typeof choice.effect === 'function' ? choice.effect(games[mode]()) : choice.effect;
      } catch {
        continue;
      }
      if (spec?.ending) out.push(spec.ending);
      if (spec?.graduationEnding) out.push(spec.graduationEnding);
      for (const entry of spec?.risk ?? []) {
        try {
          const inner = typeof entry.effect === 'function' ? entry.effect(games[mode]()) : entry.effect;
          if (inner?.ending) out.push(inner.ending);
          if (inner?.graduationEnding) out.push(inner.graduationEnding);
        } catch {
          /* 上面已经报过了 */
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ 六、成就 */

const achievementFlags = new Set();
for (const item of CHAIN_ACHIEVEMENTS ?? []) {
  if (typeof item?.flag !== 'string' || !item.flag) fail('CHAIN_ACHIEVEMENTS: 缺少 flag');
  if (achievementFlags.has(item?.flag)) fail(`CHAIN_ACHIEVEMENTS: flag 重复（${item.flag}）`);
  achievementFlags.add(item?.flag);
  if (!item?.icon || !item?.name || !item?.desc) fail(`CHAIN_ACHIEVEMENTS/${item?.flag}: icon/name/desc 不能为空`);
  if (chars(item?.name ?? '') > 12) fail(`CHAIN_ACHIEVEMENTS/${item?.flag}: name 超过 12 字`);
}
for (const flag of achievementFlags) {
  if (!flagsSeen.has(flag)) fail(`成就 flag “${flag}” 没有任何 effect 会写出来（永远拿不到）`);
}

/* ------------------------------------------------- 七、分支覆盖（防退化） */

/**
 * 每条链的重头戏都得在某个自检状态下真的被走到：
 * 状态差才会出事的重罚分支、状态好才拿得到的好结局，都列在这里。
 * 以后谁把门槛调歪了（比如把 mood <= 34 改成 <= 5），这里会立刻红。
 */
const MUST_REACH = [
  ['你妈在家长群里看到了卷子的照片', '链②撒谎被戳穿（重罚，心情差才会走到）'],
  ['你答得磕磕绊绊', '链②撒谎勉强蒙过去（状态好时的轻结果）'],
  ['店里的第二个月就开始排队', '链③接摊子 → startup（分数塌了才走得到）'],
  ['你镜头里的走廊让我想起自己高中', '链④作品被看见 → vlog（综合素质够才走得到）'],
  ['面试老师翻到推荐信那一页', '链⑥推荐信 → zonghe（综合素质 ≥70 才走得到）'],
  ['你们把志愿表摊在烧烤摊上', '链①同城 → friendship（同桌好感够才走得到）'],
  ['骑完一整圈天已经黑透了', '链⑧绕湖一整圈 → love（恋爱线够才走得到）'],
  ['你在雨山湖边的长椅上坐到凌晨三点', '链⑤半夜出门病倒（体质差才会走到）'],
  ['桌上的饭菜用碗扣着', '链⑤半夜出门没事（状态好时的轻结果）'],
  ['月考座位是按上次名次排的', '链⑦作弊被翻出来（重罚）'],
  ['她没再追问，但从那以后每次考试', '链⑦只是被怀疑（轻结果）'],
  ['签字栏上的字比别的家长年轻', '链②家长会翻出签名（first-ring 第一支 flag）'],
  ['他推着那辆三轮车，车斗里放着一筐橘子', '链③老爷子第二次上门（第一支 flag）'],
  ['你妈说她当年想当护士', '链⑤-③把爸妈当人看（大奖励）'],
];
const haystack = corpus.join('\n');
for (const [phrase, label] of MUST_REACH) {
  if (!haystack.includes(phrase)) fail(`分支覆盖：${label} 在任何自检状态下都走不到（找不到“${phrase}”）`);
}

/* ------------------------------------------------------------------ 报告 */

const noEndingChain = chainRings
  .filter((item) => !chainHasEnding.some((hit) => hit.root === item.root))
  .map((item) => item.root);

console.log('events6.js 自检（因果链）');
console.log(`  事件：${CHAIN_EVENTS.length} 个（choice ${choiceCount} / auto ${autoCount}），链 ${chainRings.length} 条`);
console.log(`  成就：${CHAIN_ACHIEVEMENTS.length} 条`);
console.log(`  日历：${CHAIN_EVENTS.length} 个事件都已在 EVENT_SCHEDULE 登记，窗口在 6 学期 × 1~6 周内可达`);
console.log(`  撞名：与 events1~5 及 story.js 比对完毕`);
console.log(
  `  实跑：resolveEvent ${engineRuns} 次、直接调用 effect ${directRuns} 次` +
    (injected ? '（引擎还没接线，自检就地注入 EVENT_MAP，走的仍是真引擎）' : ''),
);
console.log('\n  因果链图：');
for (const [i, item] of chainRings.entries()) {
  const route = item.ring
    .map((id, index) => {
      const edge = edges.find((e) => e.from === item.ring[index - 1] && e.to === id);
      return index === 0 ? id : `──${edge?.delay ?? '?'}──▶ ${id}`;
    })
    .join(' ');
  const endings = chainHasEnding.find((hit) => hit.root === item.root)?.endings ?? [];
  console.log(`   ${i + 1}. ${route}${endings.length ? `  ★${[...new Set(endings)].join('/')}` : ''}`);
}
console.log(`\n  引用结局：${[...endingsUsed.keys()].join('、') || '无'}（都在引擎图鉴里）`);
console.log(`  带结局的链：${chainHasEnding.length}/8（${chainHasEnding.map((i) => i.root).join('、')}）`);
console.log(`  只有大奖励/大惩罚的链：${noEndingChain.join('、') || '无'}`);
console.log(`  id 列表（${CHAIN_EVENTS.length}）：${CHAIN_EVENTS.map((event) => event.id).join('、')}`);

if (problems.length > 0) {
  console.error(`\n✗ 有 ${problems.length} 处不合格：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nOK：21 个链式事件、8 条链、每个选项、每条 risk 分支都过了。');
}
