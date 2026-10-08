/**
 * 周目继承自检（v3.5）。
 *
 * 这个系统的两条底线：
 *   1. **继承来自选择，不是结局**：同一批 flag 决定继承物；结局只在"一条选择都没有"时兜底。
 *      所以内容文件里真写了那个 flag，才轮得到它；反过来，表里写了却没人写的 flag
 *      = 玩家永远拿不到的假货，测试要直接指出来（这是最容易手滑的地方）。
 *   2. **不能变成注入后门**：客户端只能传记忆 id，白名单外的一律丢掉；
 *      继承只碰 stats / knowledge / npc，不碰难度、周数、种子。
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CHOICE_MEMORIES,
  ENDING_MEMORIES,
  MEMORY_LIMIT,
  MEMORY_MAP,
  THRESHOLD_MEMORIES,
  applyInheritance,
  deriveInheritance,
  memoryIdsForFlags,
  normalizeInherit,
} from '../src/legacy.js';
import { createGame, viewState } from '../src/engine.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => readFileSync(join(root, relative), 'utf8');

test('每个选择记忆的 flag 都必须真的会被某个内容文件写出来（防写错名字的假记忆）', () => {
  const dataDir = join(root, 'src', 'data');
  const sources = readdirSync(dataDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => [name, readFileSync(join(dataDir, name), 'utf8')]);

  const missing = [];
  for (const memory of CHOICE_MEMORIES) {
    // flag 一般写成 `flags: { graderTrusted: true }` 或 `flags: { relayAnchor: true }`
    const written = sources.some(([, source]) => new RegExp(`\\b${memory.flag}\\s*:`).test(source));
    if (!written) missing.push(`${memory.id}(${memory.flag})`);
  }
  assert.deepEqual(
    missing,
    [],
    `这些记忆挂的 flag 没有任何内容文件会写出来，玩家永远拿不到：${missing.join('、')}`,
  );
  assert.ok(CHOICE_MEMORIES.length >= 12, '选择记忆至少要十几条，否则"选择决定继承"就是句空话');
});

test('选择记忆优先，结局只在一条选择都没有时兜底', () => {
  // 有两条选择：继承这两条（外加积累类达标的那条）
  const withChoices = deriveInheritance({
    runs: 1,
    achievementCount: 0,
    unlocked: {},
    lastRun: { memories: ['grader_trusted', 'phone_seized'], endingId: 'esports' },
  });
  const ids = withChoices.memories.map((memory) => memory.id);
  assert.deepEqual(ids, ['grader_trusted', 'phone_seized']);
  assert.ok(!ids.includes('from_games'), '有选择时不该按结局给');

  // 一条选择都没有：按上一局结局兜底
  const fallback = deriveInheritance({ runs: 1, lastRun: { memories: [], endingId: 'esports' } });
  assert.deepEqual(
    fallback.memories.map((memory) => memory.id),
    ['from_games'],
  );

  // 兜底也认不出结局时，给"手里有活"这一条最泛的，而不是空手
  const unknown = deriveInheritance({ runs: 1, lastRun: { memories: [], endingId: '谁知道这是什么' } });
  assert.equal(unknown.memories.length, 1);
  assert.equal(unknown.memories[0].id, 'from_trade');
});

test('积累类记忆按阈值给：成就 / 图鉴 / 周目', () => {
  const rich = deriveInheritance({
    runs: 3,
    achievementCount: 25,
    unlocked: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`e${index}`, {}])),
    lastRun: { memories: [], endingId: 'chengji' },
  });
  const ids = rich.memories.map((memory) => memory.id);
  assert.ok(ids.includes('legend'), '成就 20+ 应该给传说');
  assert.ok(ids.includes('veteran'), '图鉴 10+ 应该给过来人');
  assert.ok(ids.includes('repeat'), '第 2 周目以后应该给又来了');

  // 有选择时也要占名额，但总数不超过上限
  const mixed = deriveInheritance({
    runs: 2,
    achievementCount: 30,
    unlocked: {},
    lastRun: { memories: ['relay_anchor', 'class_album', 'window_swap', 'phone_seized'], endingId: 'x' },
  });
  assert.equal(mixed.memories.length, MEMORY_LIMIT, `最多继承 ${MEMORY_LIMIT} 条`);
  assert.equal(mixed.memories[0].id, 'relay_anchor', '上一局的选择排在前面');

  // 档案坏掉也不能炸
  assert.doesNotThrow(() => deriveInheritance(undefined));
  assert.doesNotThrow(() => deriveInheritance({ lastRun: null, unlocked: null }));
  assert.deepEqual(deriveInheritance({ runs: 0, unlocked: {} }).memories.length, 1, '新档第一局之后给一条兜底');
});

test('memoryIdsForFlags：只认表里的 flag，别的选择一概不算', () => {
  assert.deepEqual(memoryIdsForFlags({ graderTrusted: true }), ['grader_trusted']);
  assert.deepEqual(memoryIdsForFlags({ graderTrusted: true, seen_exam_cheat: true, evtTurn_x: 3 }), ['grader_trusted']);
  assert.deepEqual(memoryIdsForFlags({}), []);
  assert.deepEqual(memoryIdsForFlags(), []);
  // 顺序跟着表走，不跟着对象键顺序走（免得同一批 flag 生成两套结果）
  assert.deepEqual(memoryIdsForFlags({ relayAnchor: true, graderTrusted: true }), ['grader_trusted', 'relay_anchor']);
});

test('白名单：客户端只能传 id，别的字段和未知 id 一律丢掉', () => {
  assert.deepEqual(normalizeInherit({ memoryIds: ['grader_trusted'] }).memoryIds, ['grader_trusted']);
  assert.deepEqual(normalizeInherit({ memoryIds: ['grader_trusted', 'grader_trusted'] }).memoryIds, ['grader_trusted']);
  assert.deepEqual(normalizeInherit({ memoryIds: ['not_a_memory'] }).memoryIds, []);
  assert.deepEqual(normalizeInherit({ enabled: false, memoryIds: ['grader_trusted'] }).memoryIds, [], '关掉就不继承');
  assert.deepEqual(normalizeInherit(null).memoryIds, []);
  // 想夹带数值？没门
  assert.deepEqual(
    normalizeInherit({ memoryIds: ['grader_trusted', { id: 'legend', effects: { stats: { mood: 9999 } } }] }).memoryIds,
    ['grader_trusted'],
  );
  // 上限
  assert.equal(normalizeInherit({ memoryIds: CHOICE_MEMORIES.map((memory) => memory.id) }).memoryIds.length, MEMORY_LIMIT);
});

test('应用到开局：只动 stats / knowledge / npc，不动难度 / 周数 / 种子', () => {
  const options = { name: '继承', seed: 'legacy-1', weeksPerSemester: 6, difficulty: 'hard' };
  const plain = createGame(options);
  const withInherit = createGame({ ...options, inherit: { memoryIds: ['grader_trusted', 'relay_anchor'] } });

  assert.ok(withInherit.knowledge.math > plain.knowledge.math, '老师的小助手应该多带一点数学');
  assert.ok(withInherit.stats.physique > plain.stats.physique, '跑过第四棒应该体质更好');

  // 规则性的东西一点都不能变
  assert.equal(withInherit.difficulty, plain.difficulty);
  assert.equal(withInherit.weeksPerSemester, plain.weeksPerSemester);
  assert.equal(withInherit.rngState, plain.rngState, '随机流不能被继承改掉（同种子必须同世界）');
  assert.equal(withInherit.turn, 0);
  assert.deepEqual(withInherit.inherit.memoryIds, ['grader_trusted', 'relay_anchor']);
  assert.ok(withInherit.flags.inherit_grader_trusted, '继承要留下 flag，方便以后查证');

  // 不传 / 传空 / 传垃圾都一样
  for (const inherit of [undefined, {}, { memoryIds: [] }, { memoryIds: ['nope'] }, { enabled: false, memoryIds: ['legend'] }]) {
    const game = createGame({ ...options, inherit });
    assert.equal(game.inherit, undefined, `inherit=${JSON.stringify(inherit)} 不该产生继承`);
    assert.equal(game.stats.physique, plain.stats.physique);
  }

  // 数值被夹在合法区间里（不会把心情顶到 120）
  const capped = createGame({ ...options, inherit: { memoryIds: ['class_album', 'legend', 'repeat'] } });
  for (const [key, value] of Object.entries(capped.stats)) {
    if (key === 'money') continue; // 零花钱不在 0~100 之间
    assert.ok(value >= 0 && value <= 100, `${key} 被继承顶到了 ${value}`);
  }
});

test('引擎把"这一局拿到了哪些选择记忆"报给前端，前端的档案才有东西可存', () => {
  const game = createGame({ name: '记忆', seed: 'legacy-earned', weeksPerSemester: 6 });
  assert.deepEqual(viewState(game).earnedMemories, []);
  assert.deepEqual(viewState(game).inherited, []);

  // 内容文件写下的 flag 会让它出现在 earnedMemories 里
  game.flags.graderTrusted = true;
  game.flags.windowSwap = true;
  assert.deepEqual(viewState(game).earnedMemories, ['grader_trusted', 'window_swap']);

  const inherited = createGame({ name: '记忆', seed: 'legacy-earned', inherit: { memoryIds: ['phone_seized'] } });
  assert.deepEqual(viewState(inherited).inherited, ['phone_seized']);
});

test('界面与两端接口都接上了：卡片 / 开关 / 提交 / 服务端转发', () => {
  const html = read('web/index.html');
  assert.match(html, /id="inherit-card"/, '开局界面缺继承卡片');
  assert.match(html, /class="inherit-card hidden"/, '默认应该是隐藏的（没有继承物时不占地方）');

  const app = read('web/app.js');
  assert.match(app, /import \{ deriveInheritance \} from '\.\.\/src\/legacy\.js'/, '前端要复用同一份推导逻辑');
  assert.match(app, /function renderInheritanceCard\(\)/);
  assert.match(app, /renderInheritanceCard\(\);/, 'renderBuildForm 里要调用它，否则卡片永远是空的');
  assert.match(app, /\$\('inherit-on'\)\.checked = state\.inheritOn !== false/, '开关默认打开');
  assert.match(app, /inherit: state\.inheritOn === false \? \{ enabled: false \}/, 'startNew 要带上继承（关掉时明确传 enabled:false）');
  assert.match(app, /memories: Array\.isArray\(view\.earnedMemories\)/, '结算时要存下这一局的记忆');
  assert.match(app, /\$\('inherit-on'\)\.addEventListener\('change'/, '开关要绑事件（绑在 index.html 的静态元素上）');

  for (const file of ['src/server.js', 'web/local-api.js']) {
    assert.match(read(file), /inherit: body\.inherit/, `${file} 没转发 inherit（开局时继承会静默失效）`);
  }

  const css = read('web/style.css');
  for (const name of ['.inherit-card', '.inherit-toggle', '.inherit-list']) {
    assert.ok(css.includes(name), `style.css 缺 ${name}`);
  }
});

test('表里每一类记忆都有完整文案，且没有重复 id', () => {
  const all = [...CHOICE_MEMORIES, ...THRESHOLD_MEMORIES, ...ENDING_MEMORIES];
  const ids = new Set();
  for (const memory of all) {
    assert.ok(memory.id && !ids.has(memory.id), `id 缺失或重复：${memory.id}`);
    ids.add(memory.id);
    assert.ok(memory.icon && memory.name && memory.desc, `${memory.id} 缺文案`);
    assert.ok(memory.effects, `${memory.id} 没有效果`);
    assert.equal(MEMORY_MAP[memory.id], memory);
  }
  assert.equal(CHOICE_MEMORIES.length + THRESHOLD_MEMORIES.length + ENDING_MEMORIES.length, all.length);
});
