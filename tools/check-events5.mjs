#!/usr/bin/env node
/**
 * events5.js 自检脚本（零依赖）。
 *
 *   node tools/check-events5.mjs
 *
 * 查四件事：
 *   1. 结构：18 个事件、id 唯一、kind 合法、choice 事件正好 3 个选项（选项 id 不重复）、
 *      auto 事件不许有 choices、文案非空、weight 是 6~14 的整数；
 *   2. 日历：每个事件都在 EVENT_SCHEDULE 里登记，而且窗口在"6 个学期 × 第 1~6 周"里
 *      至少能命中一次（写死不的窗口会被抓出来）；
 *   3. 撞名：id 不能跟 events.js / events2.js / events3.js / events4.js / story.js 里已有的 id 重复；
 *   4. 真的跑一遍：用真实引擎 createGame + resolveEvent 把 **每个事件每个选项** 走一遍，
 *      不抛异常；引擎还没接上 events5 的时候（EVENT_MAP 里查不到）退化成直接调用 effect，
 *      但 effect 的返回值仍然会逐字段审（未知字段、非法的 stats/npc 键、risk 结构、
 *      占位符拼写都会被点出来）。
 *
 * 失败时打印每一条不合格的地方，并把 process.exitCode 置为 1。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CAMPUS_ACHIEVEMENTS, CAMPUS_EVENTS } from '../src/data/events5.js';
import { EVENT_SCHEDULE, calendarOf, matchesSchedule, scheduleFor } from '../src/data/calendar.js';
import { ALL_SUBJECT_KEYS, SEMESTERS } from '../src/data/school.js';
import { EVENT_MAP, createGame, endingCatalog, resolveEvent } from '../src/engine.js';

const EXPECTED_COUNT = 18;
const EXPECTED_CHOICES = 3;
const INDEX_FILES = [
  '../src/data/events.js',
  '../src/data/events2.js',
  '../src/data/events3.js',
  '../src/data/events4.js',
  '../src/story.js',
  '../src/data/story.js',
];

const EFFECT_KEYS = new Set(['text', 'stats', 'npc', 'knowledge', 'money', 'flags', 'risk', 'ending', 'endingExtra']);
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
const KNOWLEDGE_SPECAIL = new Set(['all', 'subject', 'weakest', 'random', 'count']);
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

/* ------------------------------------------------------------------ 一、结构 */

const seenIds = new Set();
let choiceCount = 0;
let autoCount = 0;
let stableHints = 0;

for (const [index, event] of CAMPUS_EVENTS.entries()) {
  const where = `CAMPUS_EVENTS[${index}]${event?.id ? ` (${event.id})` : ''}`;

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
  if (typeof event.text !== 'string' || chars(event.text) < 60 || chars(event.text) > 200) {
    fail(`${event.id}: text 要在 60~200 字之间（现在 ${typeof event.text === 'string' ? chars(event.text) : '不是字符串'}）`);
  }

  if (event.kind === 'auto') {
    autoCount += 1;
    if (event.choices !== undefined) fail(`${event.id}: auto 事件不许有 choices`);
    if (event.effect === undefined) fail(`${event.id}: auto 事件必须有 effect`);
    continue;
  }

  choiceCount += 1;
  if (!Array.isArray(event.choices) || event.choices.length !== EXPECTED_CHOICES) {
    fail(`${event.id}: choice 事件必须正好 ${EXPECTED_CHOICES} 个选项（现在 ${event.choices?.length ?? 0}）`);
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
    if (choice.hint === '稳') stableHints += 1;
  }
}

if (CAMPUS_EVENTS.length !== EXPECTED_COUNT) {
  fail(`事件数量应该是 ${EXPECTED_COUNT} 个，现在是 ${CAMPUS_EVENTS.length} 个`);
}
if (!Array.isArray(CAMPUS_ACHIEVEMENTS) || CAMPUS_ACHIEVEMENTS.length === 0) {
  fail('CAMPUS_ACHIEVEMENTS 必须是非空数组');
} else {
  const achievementFlags = new Set();
  for (const item of CAMPUS_ACHIEVEMENTS) {
    if (typeof item?.flag !== 'string' || !item.flag) fail('CAMPUS_ACHIEVEMENTS: 缺少 flag');
    if (achievementFlags.has(item?.flag)) fail(`CAMPUS_ACHIEVEMENTS: flag 重复（${item.flag}）`);
    achievementFlags.add(item?.flag);
    if (!item?.icon || !item?.name || !item?.desc) fail(`CAMPUS_ACHIEVEMENTS/${item?.flag}: icon/name/desc 不能为空`);
  }
}

/* ------------------------------------------------------------------ 二、日历 */

const WEEKS = 6;
const semesters = SEMESTERS.length || 6;
for (const event of CAMPUS_EVENTS) {
  const schedule = EVENT_SCHEDULE[event.id];
  if (!schedule) {
    fail(`${event.id}: 没有在 EVENT_SCHEDULE 里登记`);
    continue;
  }
  let reachable = false;
  for (let semesterIndex = 0; semesterIndex < semesters && !reachable; semesterIndex += 1) {
    for (let week = 1; week <= WEEKS; week += 1) {
      const cal = calendarOf({ semesterIndex, week, weeksPerSemester: WEEKS });
      if (matchesSchedule(scheduleFor('event', event.id), cal)) {
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
  const text = load(relative);
  for (const match of text.matchAll(/id:\s*['"]([A-Za-z0-9_]+)['"]/g)) {
    if (!foreign.has(match[1])) foreign.set(match[1], relative);
  }
}
for (const event of CAMPUS_EVENTS) {
  const owner = foreign.get(event.id);
  if (owner) fail(`${event.id}: id 跟 ${owner.replace('../', '')} 里已有的 id 撞了`);
}

/* ------------------------------------------------- 四、effect 逐字段审 + 跑一遍 */

const games = {
  // 状态极差的一局：让"体质/心情低才会出事"的 risk 分支尽量走到
  worn: () => {
    const game = createGame({ seed: 'check-events5-worn', name: '自检', weeksPerSemester: 6 });
    Object.assign(game.stats, {
      intelligence: 28,
      physique: 22,
      mood: 18,
      social: 12,
      teacherFavor: 20,
      comprehensive: 4,
      fatigue: 88,
      discipline: 2,
      money: 8,
    });
    Object.assign(game.npc, { head: 30, math: 30, deskmate: 20, friend: 18, rival: 15, parents: 40, love: 0 });
    return game;
  },
  // 状态很好的一局：走 risk 的"没事"分支
  healthy: () => {
    const game = createGame({ seed: 'check-events5-healthy', name: '自检', weeksPerSemester: 6 });
    Object.assign(game.stats, {
      intelligence: 92,
      physique: 95,
      mood: 95,
      social: 80,
      teacherFavor: 85,
      comprehensive: 80,
      fatigue: 4,
      discipline: 20,
      money: 900,
    });
    Object.assign(game.npc, { head: 90, math: 90, deskmate: 92, friend: 90, rival: 88, parents: 92, love: 40 });
    return game;
  },
  // 常去网咖的一局：走 esports 分支
  // （引擎里的门槛是"去网吧这个行动刷够 3 次 + 六科平均分掉到 42 以下"，
  //   所以这里必须把两件事都造出来，否则这条结局分支根本走不到）
  netbar: () => {
    const game = games.healthy();
    game.flags.netbarNights = 4;
    for (let i = 0; i < 4; i += 1) {
      game.history.push({ turn: i + 1, week: i + 1, phase: 'weekend', action: 'game', subject: null });
    }
    for (const key of game.subjectKeys) game.knowledge[key] = 22;
    return game;
  },
};

const endingsUsed = new Set();
function checkPlaceholders(text, where) {
  for (const match of String(text).matchAll(/\{([^{}]*)\}/g)) {
    const [raw, body] = match;
    const [id, mode] = body.split('.');
    if (!PLACEHOLDER_IDS.has(id) || (mode !== undefined && !PLACEHOLDER_MODES.has(mode))) {
      fail(`${where}: 占位符 ${raw} 不是引擎认识的写法`);
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
    if (typeof spec.text === 'string') checkPlaceholders(spec.text, where);
    if (typeof spec.text === 'function') {
      try {
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
        if (!KNOWLEDGE_SPECAIL.has(key) && !ALL_SUBJECT_KEYS.includes(key)) {
          fail(`${where}: knowledge 里没有这个键：${key}`);
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where}: knowledge.${key} 必须是有限数字`);
      }
    }
  }
  if (spec.money !== undefined && (typeof spec.money !== 'number' || !Number.isFinite(spec.money))) {
    fail(`${where}: money 必须是有限数字`);
  }
  if (spec.flags !== undefined && (typeof spec.flags !== 'object' || spec.flags === null || Array.isArray(spec.flags))) {
    fail(`${where}: flags 必须是对象`);
  }
  if (spec.ending !== undefined) {
    if (typeof spec.ending !== 'string') fail(`${where}: ending 必须是字符串`);
    else endingsUsed.add(spec.ending);
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
          if (typeof entry.text === 'string') checkPlaceholders(entry.text, spot);
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

const engineReady = CAMPUS_EVENTS.every((event) => Boolean(EVENT_MAP[event.id]));
let engineRuns = 0;
let directRuns = 0;
const endingHits = new Map();

function smokeChoice(event, choice) {
  const label = `${event.id}/${choice.id}`;
  for (const [mode, build] of Object.entries(games)) {
    const game = build();
    game.flags.netbarNights = game.flags.netbarNights ?? 0;
    if (mode !== 'netbar') game.flags.netbarNights = 0;
    game.pendingEvent = makePending(event, game);
    try {
      resolveEvent(game, choice.id);
      engineRuns += 1;
    } catch (error) {
      if (/未知事件/.test(error.message)) {
        // 引擎还没把 events5 接进 EVENT_MAP：退化成直接调用 effect，照样要过
        directRuns += 1;
        try {
          if (typeof choice.outcome === 'function') choice.outcome(game);
          const spec = typeof choice.effect === 'function' ? choice.effect(game) : choice.effect;
          auditSpec(spec, game, `${label} (直接调用)`);
        } catch (inner) {
          fail(`${label}: 直接调用 effect 抛异常（${inner.message}）`);
        }
      } else {
        fail(`${label}: resolveEvent 抛异常（${error.message}）`);
      }
    }
    if (game.ending?.id) {
      endingHits.set(game.ending.id, (endingHits.get(game.ending.id) ?? 0) + 1);
    }
  }

  // 文案里的占位符也顺手查一遍
  if (typeof choice.outcome === 'string') checkPlaceholders(choice.outcome, `${label}.outcome`);
  if (typeof choice.label === 'string') checkPlaceholders(choice.label, `${label}.label`);
  if (typeof choice.hint === 'string') checkPlaceholders(choice.hint, `${label}.hint`);
}

for (const event of CAMPUS_EVENTS) {
  if (typeof event.text === 'string') checkPlaceholders(event.text, `${event.id}.text`);

  if (event.kind === 'auto') {
    for (const [mode, build] of Object.entries(games)) {
      const game = build();
      if (mode !== 'netbar') game.flags.netbarNights = 0;
      auditEffect(event.effect, game, `${event.id}.effect`);
    }
    continue;
  }

  for (const choice of event.choices ?? []) {
    smokeChoice(event, choice);
    // 分支覆盖：状态差 / 状态好 / 常去网咖 各审一遍 effect
    for (const [mode, build] of Object.entries(games)) {
      const game = build();
      if (mode !== 'netbar') game.flags.netbarNights = 0;
      auditEffect(choice.effect, game, `${event.id}/${choice.id}.effect`);
    }
  }
}

/* ------------------------------------------------------------------ 结果 */

const catalog = new Set(endingCatalog().map((entry) => entry.id));
for (const id of ['esports', 'scam']) {
  if (!endingsUsed.has(id)) fail(`没有任何 effect 真的引用了结局 id：${id}`);
}
for (const id of endingsUsed) {
  if (!catalog.has(id)) fail(`ending id ${id} 不在引擎的结局图鉴里（拼错了？还是引擎还没登记？）`);
}

const registered = CAMPUS_EVENTS.filter((event) => EVENT_SCHEDULE[event.id]).length;

console.log('events5.js 自检');
console.log(`  事件：${CAMPUS_EVENTS.length} 个（choice ${choiceCount} / auto ${autoCount}）`);
console.log(`  成就：${CAMPUS_ACHIEVEMENTS.length} 条`);
console.log(`  日历：${registered}/${CAMPUS_EVENTS.length} 个事件已登记，窗口在 6 学期 × 1~6 周内都可达`);
console.log(`  撞名：与 events1~4 及 story.js 比对完毕`);
console.log(
  `  实跑：resolveEvent ${engineRuns} 次、直接调用 effect ${directRuns} 次` +
    (engineReady ? '' : '（引擎尚未接入 events5，已退化为直接调用）'),
);
const hitText = [...endingHits.entries()].map(([id, times]) => `${id}×${times}`).join('、') || '无';
console.log(`  结局命中：${hitText}`);
console.log(`  结局：引用了 ${[...endingsUsed].join('、') || '无'}（都在引擎图鉴里）`);

if (problems.length > 0) {
  console.error(`\n✗ 有 ${problems.length} 处不合格：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nOK：events5 的 18 个事件、每个选项、每条 risk 分支都过了。');
}
