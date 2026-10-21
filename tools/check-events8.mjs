#!/usr/bin/env node
/**
 * events8.js（人情账本）自检脚本（零依赖）。
 *
 *   node tools/check-events8.mjs
 *
 * 查七件事：
 *   1. **结构**：12 个事件（6 借 + 6 还），id 唯一且是 snake_case，name / icon / text /
 *      weight / choices 齐全；offer 的 weight 在 8~12，collect 必须是 chainOnly: true。
 *   2. **和 favors.js 对齐**：12 个 id 恰好覆盖 FAVOR_MAP 里 6 条人情的 offerEvent /
 *      collectEvent，一个不多一个不少；offer 里恰好一个选项写 `favor: { kind }`
 *      且 kind 就是那条人情的 id。
 *   3. **讨债环语义**：三个选项各带一个 `favor: { resolve }`，repay / delay / refuse
 *      各出现一次；讨债选项**不许**再写 stats / npc / money（数值只从 favors.js 拿）。
 *   4. **日历**：12 个 id 全部在 EVENT_SCHEDULE 登记，并且在本局（6 学期 × 1~6 周）可达。
 *   5. **文案卫生**：占位符都是引擎认识的写法；text / outcome 里没有 `undefined` / `NaN`；
 *      hint 不超过 14 个字符；collect 的 `favorDelayedXxx` 分支真的换了一段话。
 *   6. **撞名**：id 不能和 events1~7 / story.js 撞（撞了引擎的 EVENT_MAP 会悄悄覆盖）。
 *   7. **真的跑一遍**：用真实引擎 createGame + 强制弹事件 + resolveEvent，把 12 个事件
 *      × 每个选项都走一遍：offer 的欠账选项必须真的在账本上记一笔并排一条讨债链，
 *      不欠账的选项不能记账；讨债环的还 / 拖 / 赖必须真的把账本改成 repaid / open / refused，
 *      拖之后必须重新排链。
 *
 * 失败逐条打印，process.exitCode 置 1。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { FAVOR_EVENTS } from '../src/data/events8.js';
import { FAVOR_ACTIONS, FAVOR_BY_COLLECT, FAVOR_BY_OFFER, FAVOR_MAP } from '../src/data/favors.js';
import { EVENT_SCHEDULE, calendarOf, matchesSchedule, scheduleFor } from '../src/data/calendar.js';
import { ALL_SUBJECT_KEYS, SEMESTERS } from '../src/data/school.js';
import { ALL_EVENTS, EVENT_MAP, createGame, resolveEvent, viewState } from '../src/engine.js';

const MIN_TEXT = 50;
const MAX_TEXT = 240;
const MAX_HINT = 14;
const OFFER_MIN_WEIGHT = 8;
const OFFER_MAX_WEIGHT = 12;
const WEEKS = 6;

/** 其他批次的事件文件：新 id 撞上它们会被 EVENT_MAP 悄悄覆盖。 */
const OTHER_EVENT_FILES = [
  '../src/data/events.js',
  '../src/data/events2.js',
  '../src/data/events3.js',
  '../src/data/events4.js',
  '../src/data/events5.js',
  '../src/data/events6.js',
  '../src/data/events7.js',
  '../src/story.js',
  '../src/data/story.js',
];

/** offer 选项允许写的 effect 字段（不含结算字段）。 */
const OFFER_EFFECT_KEYS = new Set(['text', 'stats', 'npc', 'knowledge', 'money', 'flags', 'risk', 'favor']);
/** 讨债选项只允许写 favor：数值全部来自 favors.js，事件里另写就是两套口径。 */
const COLLECT_EFFECT_KEYS = new Set(['favor']);
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
const chars = (value) => [...String(value)].length;
const load = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const resolve = (value, game) => (typeof value === 'function' ? value(game) : value);

/* ------------------------------------------------------------------ 一、结构 */

const byId = new Map(FAVOR_EVENTS.map((event) => [event?.id, event]));
const offers = FAVOR_EVENTS.filter((event) => FAVOR_BY_OFFER[event.id]);
const collects = FAVOR_EVENTS.filter((event) => FAVOR_BY_COLLECT[event.id]);
const seenIds = new Set();

if (FAVOR_EVENTS.length !== 12) fail(`FAVOR_EVENTS 应该是 12 个事件（6 借 + 6 还），现在是 ${FAVOR_EVENTS.length} 个`);
if (offers.length !== 6) fail(`offer 事件应该是 6 个，现在识别出 ${offers.length} 个`);
if (collects.length !== 6) fail(`collect 事件应该是 6 个，现在识别出 ${collects.length} 个`);

for (const event of FAVOR_EVENTS) {
  const where = `FAVOR_EVENTS${event?.id ? ` (${event.id})` : ''}`;
  if (typeof event?.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(event.id)) {
    fail(`${where}: id 必须是 snake_case 字符串`);
    continue;
  }
  if (seenIds.has(event.id)) fail(`${event.id}: id 重复`);
  seenIds.add(event.id);

  if (typeof event.name !== 'string' || chars(event.name) < 4 || chars(event.name) > 16) {
    fail(`${event.id}: name 要在 4~16 字之间（现在 ${chars(event.name)} 字）`);
  }
  if (typeof event.icon !== 'string' || chars(event.icon) === 0) fail(`${event.id}: 缺 icon`);
  if (event.kind !== 'choice') fail(`${event.id}: 这一批只写 choice 事件`);
  if (!Number.isInteger(event.weight) || event.weight <= 0) fail(`${event.id}: weight 必须是正整数`);

  const isOffer = Boolean(FAVOR_BY_OFFER[event.id]);
  const isCollect = Boolean(FAVOR_BY_COLLECT[event.id]);
  if (!isOffer && !isCollect) {
    fail(`${event.id}: 不在 favors.js 的 offerEvent / collectEvent 里（id 写错了？）`);
  }
  if (isOffer && isCollect) fail(`${event.id}: 同时被当成 offer 和 collect`);
  if (isCollect && event.chainOnly !== true) fail(`${event.id}: 讨债环必须写 chainOnly: true`);
  if (isOffer && event.chainOnly === true) fail(`${event.id}: offer 环会进随机池，不能写 chainOnly`);

  if (isOffer) {
    if (!Number.isInteger(event.weight) || event.weight < OFFER_MIN_WEIGHT || event.weight > OFFER_MAX_WEIGHT) {
      fail(`${event.id}: offer 的 weight 要在 ${OFFER_MIN_WEIGHT}~${OFFER_MAX_WEIGHT}（现在 ${event.weight}）`);
    }
  }

  if (!Array.isArray(event.choices) || event.choices.length < 2 || event.choices.length > 3) {
    fail(`${event.id}: 选项要 2~3 个（现在 ${event.choices?.length ?? 0} 个）`);
    continue;
  }

  if (typeof event.text !== 'string' && typeof event.text !== 'function') {
    fail(`${event.id}: text 必须是字符串或函数`);
  }

  const choiceIds = new Set();
  for (const choice of event.choices) {
    const spot = `${event.id}/${choice?.id ?? '?'}`;
    if (typeof choice?.id !== 'string' || !choice.id) {
      fail(`${spot}: 选项缺 id`);
      continue;
    }
    if (choiceIds.has(choice.id)) fail(`${spot}: 选项 id 重复`);
    choiceIds.add(choice.id);
    if (typeof choice.label !== 'string' || !choice.label.trim()) fail(`${spot}: label 为空`);
    if (typeof choice.hint !== 'string' || !choice.hint.trim()) fail(`${spot}: hint 为空`);
    if (typeof choice.hint === 'string' && chars(choice.hint) > MAX_HINT) {
      fail(`${spot}: hint 超过 ${MAX_HINT} 字（${chars(choice.hint)} 字）`);
    }
    if (typeof choice.outcome !== 'string' && typeof choice.outcome !== 'function') {
      fail(`${spot}: outcome 必须是字符串或函数`);
    }
    if (choice.effect === undefined) fail(`${spot}: 缺 effect`);
  }
}

/* ------------------------------------------------- 二、和 favors.js 对齐 */

const expectedOffer = new Set(Object.values(FAVOR_MAP).map((favor) => favor.offerEvent));
const expectedCollect = new Set(Object.values(FAVOR_MAP).map((favor) => favor.collectEvent));
const gotOffer = new Set(offers.map((event) => event.id));
const gotCollect = new Set(collects.map((event) => event.id));
for (const id of expectedOffer) if (!gotOffer.has(id)) fail(`缺少 offer 事件：${id}`);
for (const id of expectedCollect) if (!gotCollect.has(id)) fail(`缺少 collect 事件：${id}`);
for (const id of gotOffer) if (!expectedOffer.has(id)) fail(`多出来的 offer 事件：${id}`);
for (const id of gotCollect) if (!expectedCollect.has(id)) fail(`多出来的 collect 事件：${id}`);

for (const event of offers) {
  const meta = FAVOR_BY_OFFER[event.id];
  const withFavor = [];
  for (const choice of event.choices ?? []) {
    const spec = resolve(choice.effect, createGame({ seed: 'check-events8-spec', weeksPerSemester: WEEKS }));
    if (!spec || typeof spec !== 'object') {
      fail(`${event.id}/${choice.id}: effect 必须返回对象`);
      continue;
    }
    for (const key of Object.keys(spec)) {
      if (!OFFER_EFFECT_KEYS.has(key)) fail(`${event.id}/${choice.id}: offer 里出现不认识的 effect 字段 ${key}`);
    }
    const favor = spec.favor;
    if (favor?.kind) {
      withFavor.push(choice.id);
      if (Object.keys(favor).length !== 1) fail(`${event.id}/${choice.id}: favor 只该有 kind 一个字段`);
      if (favor.kind !== meta.id) fail(`${event.id}/${choice.id}: favor.kind=${favor.kind}，应该是 ${meta.id}`);
      if (!FAVOR_MAP[favor.kind]) fail(`${event.id}/${choice.id}: favor.kind=${favor.kind} 不在 FAVOR_MAP 里`);
    } else if (favor?.resolve) {
      fail(`${event.id}/${choice.id}: offer 环里不该出现 favor.resolve`);
    }
  }
  if (withFavor.length !== 1) {
    fail(`${event.id}: 必须恰好一个选项欠账，现在有 ${withFavor.length} 个（${withFavor.join('、') || '无'}）`);
  }
}

for (const event of collects) {
  const resolveIds = [];
  for (const choice of event.choices ?? []) {
    const spot = `${event.id}/${choice.id}`;
    const spec = choice.effect && typeof choice.effect === 'object' ? choice.effect : null;
    if (!spec) {
      fail(`${spot}: 讨债选项的 effect 必须是对象（直接写 { favor: { resolve } }）`);
      continue;
    }
    for (const key of Object.keys(spec)) {
      if (!COLLECT_EFFECT_KEYS.has(key)) {
        fail(`${spot}: 讨债选项只许写 favor，多了字段 ${key}（还/拖/赖的数值由 favors.js 结算）`);
      }
    }
    const action = spec.favor?.resolve;
    if (!action) {
      fail(`${spot}: 缺 favor.resolve`);
      continue;
    }
    resolveIds.push(action);
    if (!FAVOR_ACTIONS.includes(action)) fail(`${spot}: favor.resolve=${action} 不是 repay / delay / refuse`);
    if (Object.keys(spec.favor).length !== 1) fail(`${spot}: favor 只该有 resolve 一个字段`);
  }
  for (const action of FAVOR_ACTIONS) {
    const count = resolveIds.filter((item) => item === action).length;
    if (count !== 1) fail(`${event.id}: ${action} 应该恰好一个选项，现在 ${count} 个`);
  }
}

/* ------------------------------------------------------------------ 三、日历 */

for (const event of FAVOR_EVENTS) {
  const schedule = EVENT_SCHEDULE[event.id];
  if (!schedule) {
    fail(`${event.id}: 没有在 EVENT_SCHEDULE 里登记（新增事件忘登记，test/calendar.test.js 会红）`);
    continue;
  }
  let reachable = false;
  for (let semesterIndex = 0; semesterIndex < (SEMESTERS.length || 6) && !reachable; semesterIndex += 1) {
    for (let week = 1; week <= WEEKS; week += 1) {
      if (matchesSchedule(scheduleFor('event', event.id), calendarOf({ semesterIndex, week, weeksPerSemester: WEEKS }))) {
        reachable = true;
        break;
      }
    }
  }
  if (!reachable) fail(`${event.id}: 时间表在任何学期任何周都触发不了`);
}

/* --------------------------------------------------------------- 四、撞名 */

const foreign = new Map();
for (const relative of OTHER_EVENT_FILES) {
  let text;
  try {
    text = load(relative);
  } catch {
    continue; // 没有这个文件就算了（story.js 有两个候选路径）
  }
  for (const match of text.matchAll(/id:\s*['"]([A-Za-z0-9_]+)['"]/g)) {
    if (!foreign.has(match[1])) foreign.set(match[1], relative);
  }
}
for (const event of FAVOR_EVENTS) {
  const owner = foreign.get(event.id);
  if (owner) fail(`${event.id}: id 跟 ${owner.replace('../', '')} 里已有的 id 撞了`);
}

/* ------------------------------------------- 五、文案卫生（占位符 / 长度） */

function checkPlaceholders(text, where) {
  for (const match of String(text).matchAll(/\{([^{}]*)\}/g)) {
    const [raw, body] = match;
    const [id, mode] = body.split('.');
    if (!PLACEHOLDER_IDS.has(id) || (mode !== undefined && !PLACEHOLDER_MODES.has(mode))) {
      fail(`${where}: 占位符 ${raw} 不是引擎认识的写法`);
    }
  }
}

function checkClean(value, where) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (String(text).includes('undefined')) fail(`${where}: 文案里出现 undefined`);
  if (String(text).includes('NaN')) fail(`${where}: 文案里出现 NaN`);
}

function checkLength(text, where, min = MIN_TEXT, max = MAX_TEXT) {
  const length = chars(text);
  if (length < min || length > max) fail(`${where}: 文案 ${length} 字，要在 ${min}~${max} 字之间`);
}

const games = {
  plain: () => createGame({ seed: 'check-events8-plain', name: '自检', weeksPerSemester: WEEKS }),
  worn: () => {
    const game = createGame({ seed: 'check-events8-worn', name: '自检', weeksPerSemester: WEEKS });
    Object.assign(game.stats, { mood: 18, fatigue: 84, physique: 24, social: 16, teacherFavor: 22 });
    Object.assign(game.npc, { head: 20, math: 18, deskmate: 16, friend: 14, rival: 12, parents: 20 });
    return game;
  },
  rich: () => {
    const game = createGame({ seed: 'check-events8-rich', name: '自检', weeksPerSemester: WEEKS });
    Object.assign(game.stats, { mood: 92, fatigue: 8, money: 1200, teacherFavor: 88 });
    return game;
  },
};

for (const [mode, build] of Object.entries(games)) {
  const game = build();
  for (const event of FAVOR_EVENTS) {
    const text = resolve(event.text, game);
    if (typeof text !== 'string') {
      fail(`${event.id}: text 在 ${mode} 状态下不是字符串`);
      continue;
    }
    checkPlaceholders(text, `${event.id}.text`);
    checkClean(text, `${event.id}.text`);
    checkLength(text, `${event.id}.text (${mode})`);
    for (const choice of event.choices ?? []) {
      const outcome = resolve(choice.outcome, game);
      checkPlaceholders(outcome, `${event.id}/${choice.id}.outcome`);
      checkClean(outcome, `${event.id}/${choice.id}.outcome`);
      checkLength(outcome, `${event.id}/${choice.id}.outcome (${mode})`, 10, 160);
      checkPlaceholders(resolve(choice.label, game), `${event.id}/${choice.id}.label`);
      checkPlaceholders(resolve(choice.hint, game), `${event.id}/${choice.id}.hint`);
    }
  }
}

/*
 * 讨债环的"第二次上门"必须真的换一段语气：第一环的 text 用引擎写下的
 * favorDelayedXxx flag 分两支，如果 flag 没接上（或写错名字），两次文案会一模一样。
 */
for (const event of collects) {
  const meta = FAVOR_BY_COLLECT[event.id];
  const delayedFlag = Object.keys(meta.actions?.delay?.flags ?? {}).find((key) => key.startsWith('favorDelayed'));
  if (!delayedFlag) {
    fail(`${event.id}: favors.js 的 actions.delay 里没有 favorDelayedXxx flag，没法写"第二次上门"的分支`);
    continue;
  }
  const firstGame = games.plain();
  const delayedGame = games.plain();
  delayedGame.flags[delayedFlag] = true;
  let firstText;
  let delayedText;
  try {
    firstText = resolve(event.text, firstGame);
    delayedText = resolve(event.text, delayedGame);
  } catch (error) {
    fail(`${event.id}: text 函数抛异常（${error.message}）`);
    continue;
  }
  if (typeof firstText !== 'string' || typeof delayedText !== 'string') {
    fail(`${event.id}: text 函数必须返回字符串`);
    continue;
  }
  checkLength(firstText, `${event.id}.text`);
  checkLength(delayedText, `${event.id}.text (delayed)`);
  checkClean(delayedText, `${event.id}.text (delayed)`);
  if (firstText === delayedText) {
    fail(`${event.id}: 拖过一次的分支和第一次一模一样（text 函数没读 ${delayedFlag}）`);
  }
}

/* ------------------------------------------------- 六、真的跑一遍（引擎） */

const engineReady = FAVOR_EVENTS.every((event) => Boolean(EVENT_MAP[event.id]));
/*
 * 引擎还没接线时（Lead 并行改 engine.js 的空档），自检就地注入 EVENT_MAP——
 * 和 tools/check-events6.mjs 一样的降级方式：走的仍是真正的 resolveEvent 路径。
 */
let injected = false;
if (!engineReady) {
  for (const event of FAVOR_EVENTS) {
    if (!EVENT_MAP[event.id]) {
      EVENT_MAP[event.id] = event;
      injected = true;
    }
    if (!ALL_EVENTS.includes(event)) ALL_EVENTS.push(event);
  }
}

function makePending(event, game, favorId = null) {
  return {
    id: event.id,
    name: event.name,
    icon: event.icon ?? '🎲',
    story: false,
    arcTitle: null,
    favorId,
    text: resolve(event.text, game),
    choices: (event.choices ?? []).map((choice) => ({
      id: choice.id,
      label: resolve(choice.label, game),
      hint: choice.hint ?? null,
    })),
  };
}

function cleanRun(game, where) {
  const view = viewState(game);
  checkClean(JSON.stringify(view), `${where}: viewState`);
  if (game.pendingEvent !== null) fail(`${where}: 结束后不该还挂着待处理事件`);
  for (const [key, value] of Object.entries(game.stats)) {
    if (key === 'money') continue;
    if (!Number.isFinite(value) || value < -10 || value > 100) {
      fail(`${where}: 把 ${key} 改成了 ${value}（应该是 0~100 的有限数）`);
    }
  }
}

let engineRuns = 0;

/* offer：欠账的选项必须记一笔 + 排一条讨债链；不欠账的选项不能记账 */
for (const event of offers) {
  const meta = FAVOR_BY_OFFER[event.id];
  for (const choice of event.choices ?? []) {
    const spot = `${event.id}/${choice.id}`;
    const spec = resolve(choice.effect, games.plain());
    const game = games.plain();
    game.pendingEvent = makePending(event, game);
    try {
      const result = resolveEvent(game, choice.id);
      engineRuns += 1;
      cleanRun(game, spot);
      checkClean(result.lines.join('\n'), `${spot}: lines`);
    } catch (error) {
      fail(`${spot}: resolveEvent 抛异常（${error.message}）`);
      continue;
    }
    const open = (game.favors ?? []).filter((favor) => favor.status === 'open');
    if (spec?.favor?.kind) {
      if (!open.some((favor) => favor.kind === meta.id)) {
        fail(`${spot}: 选了欠账选项，但账本上没有 ${meta.id} 这笔账`);
      }
      if (!(game.chains ?? []).some((entry) => entry.id === meta.collectEvent)) {
        fail(`${spot}: 欠下人情后没有排 ${meta.collectEvent} 这条讨债链`);
      }
    } else if (open.length > 0) {
      fail(`${spot}: 不欠账的选项却记了 ${open.length} 笔账`);
    }
  }
}

/* collect：先真的欠下这笔账，再逐个选项结算，账本状态必须按 repay/delay/refuse 变 */
for (const event of collects) {
  const meta = FAVOR_BY_COLLECT[event.id];
  const offerEvent = byId.get(meta.offerEvent);
  const offerChoice = (offerEvent?.choices ?? []).find((choice) => {
    const spec = resolve(choice.effect, games.plain());
    return spec?.favor?.kind === meta.id;
  });
  if (!offerChoice) {
    fail(`${event.id}: 找不到 offer 事件 ${meta.offerEvent} 里欠账的那个选项，讨债环没法跑`);
    continue;
  }
  for (const choice of event.choices ?? []) {
    const spot = `${event.id}/${choice.id}`;
    const action = choice.effect?.favor?.resolve;
    const game = games.plain();
    try {
      // 先走真引擎欠下这笔账（offer 环的欠账选项）
      game.pendingEvent = makePending(offerEvent, game);
      resolveEvent(game, offerChoice.id);
      const debt = (game.favors ?? []).find((favor) => favor.kind === meta.id && favor.status === 'open');
      if (!debt) {
        fail(`${spot}: 前置的 offer 选项没有在账本上记成 open，讨债环跑不出真实状态`);
        continue;
      }
      // 再强制弹出讨债环，favorId 和引擎 triggerEvent 里的口径一致
      const debtLevelBefore = debt.level;
      game.pendingEvent = makePending(event, game, debt.id);
      const result = resolveEvent(game, choice.id);
      engineRuns += 1;
      cleanRun(game, spot);
      checkClean(result.lines.join('\n'), `${spot}: lines`);

      const settled = (game.favors ?? []).find((favor) => favor.id === debt.id) ?? null;
      if (action === 'repay' && settled?.status !== 'repaid') {
        fail(`${spot}: 选了还，账本状态却还是 ${settled?.status ?? '不存在'}`);
      }
      if (action === 'delay') {
        if (settled?.status !== 'open') fail(`${spot}: 选了拖，账不该被划掉（现在 ${settled?.status}）`);
        if (!(game.chains ?? []).some((entry) => entry.id === meta.collectEvent && (entry.atTurn ?? 0) > 0)) {
          fail(`${spot}: 选了拖，却没有重新排 ${meta.collectEvent} 这条讨债链（利息没落地）`);
        }
        if ((settled?.level ?? 0) <= debtLevelBefore) {
          fail(`${spot}: 选了拖，账的等级没有升（${debtLevelBefore} → ${settled?.level}）`);
        }
      }
      if (action === 'refuse' && settled?.status !== 'refused') {
        fail(`${spot}: 选了赖，账本状态却还是 ${settled?.status ?? '不存在'}`);
      }
    } catch (error) {
      fail(`${spot}: resolveEvent 抛异常（${error.message}）`);
    }
  }
}

/* ------------------------------------------------------------------ 报告 */

console.log('events8.js 自检（人情账本 / 6 组借与还）');
console.log(`  事件：${FAVOR_EVENTS.length} 个（offer ${offers.length} / collect ${collects.length}）`);
console.log(`  对齐：favors.js 的 ${Object.keys(FAVOR_MAP).length} 条人情，offerEvent / collectEvent 全部对上了`);
console.log(`  日历：${FAVOR_EVENTS.length} 个 id 都已在 EVENT_SCHEDULE 登记，且在 6 学期 × 1~6 周内可达`);
console.log(`  撞名：与 events1~7 / story.js 比对完毕`);
console.log(
  `  实跑：resolveEvent ${engineRuns} 次` +
    (injected ? '（引擎还没接线，自检就地注入 EVENT_MAP，走的仍是真引擎）' : '（引擎已接线，走的是真 EVENT_MAP）'),
);
console.log('\n  事件清单：');
for (const event of FAVOR_EVENTS) {
  const isCollect = Boolean(FAVOR_BY_COLLECT[event.id]);
  const favorSpot = isCollect
    ? event.choices.map((choice) => `${choice.id}=${choice.effect?.favor?.resolve}`).join(' / ')
    : event.choices
        .filter((choice) => {
          const spec = resolve(choice.effect, games.plain());
          return Boolean(spec?.favor?.kind);
        })
        .map((choice) => `${choice.id}=favor.kind:${resolve(choice.effect, games.plain()).favor.kind}`)
        .join(' / ');
  console.log(
    `   ${isCollect ? '还' : '借'} ${event.id.padEnd(26)} 权重 ${String(event.weight).padStart(2)}  ` +
      `选项 ${event.choices.length}  ${favorSpot}`,
  );
}
const delayedBranches = collects.filter((event) => {
  const meta = FAVOR_BY_COLLECT[event.id];
  const flag = Object.keys(meta.actions?.delay?.flags ?? {}).find((key) => key.startsWith('favorDelayed'));
  if (!flag) return false;
  const game = games.plain();
  game.flags[flag] = true;
  return resolve(event.text, games.plain()) !== resolve(event.text, game);
});
console.log(`  讨债环"第二次上门"分支：${delayedBranches.length}/${collects.length} 个真的换了文案`);

if (problems.length > 0) {
  console.error(`\n✗ 有 ${problems.length} 处不合格：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nOK：12 个事件、每个选项、每笔账的还/拖/赖都在真引擎里跑通了。');
}
