/**
 * 内容包（热更新）测试。
 *
 * 覆盖四层：
 *   1. src/content.js 的纯数据层：normalizePack 的宽容性、validatePack 的报错定位、
 *      planPack 的合并规则（同 id 覆盖 / 新 id 追加 / actions 只能改文案 / balance 只覆盖已知键）；
 *   2. 稳定性：checksumPack 与字段书写顺序无关、循环引用 / 函数 / NaN 不炸；
 *   3. web/content/ 里两个真实内容包：能校验通过、确实是"全新"内容、diff 能看出改了什么；
 *   4. tools/build-content-pack.mjs 命令行：无 BOM、两次字节一致、只跳过 JSON 装不下的条目、
 *      以及"不覆盖手工维护的包"这条安全护栏。
 *
 * 刻意**不 import src/engine.js**：这一层要能脱离引擎单测（引擎的接入由 Lead 的测试盯着），
 * 基线 id 直接从 src/data/* 读。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BALANCE_DIFFICULTY_KEYS,
  BALANCE_EFF_KEYS,
  MAX_TEXT_LENGTH,
  PACK_FORMAT,
  PACK_SECTIONS,
  checksumPack,
  diffPack,
  emptyPack,
  mergeById,
  normalizePack,
  parsePackText,
  planPack,
  satisfies,
  stableStringify,
  summarizePack,
  validatePack,
} from '../src/content.js';

const TOOL = fileURLToPath(new URL('../tools/build-content-pack.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const officialPack = readJson(new URL('../web/content/official-pack.json', import.meta.url));
const demoPack = readJson(new URL('../web/content/demo-update.json', import.meta.url));

/* ------------------------------------------------------------ 真实基线数据 */

const [events1, events2, events3, events4, events5, itemsModule, actionsModule] = await Promise.all([
  import('../src/data/events.js'),
  import('../src/data/events2.js'),
  import('../src/data/events3.js'),
  import('../src/data/events4.js'),
  import('../src/data/events5.js'),
  import('../src/data/items.js'),
  import('../src/data/actions.js'),
]);

// events6 是另一个任务的产物：读不到也不该让这个文件红
let chainEvents = [];
try {
  chainEvents = (await import('../src/data/events6.js')).CHAIN_EVENTS ?? [];
} catch {
  chainEvents = [];
}

// 引擎版本同样"能读就读，读不到就用当前版本号兜底"：跟着发版走，别把版本号写死两处
let gameVersion = '2.6.0';
try {
  gameVersion = (await import('../src/engine.js')).GAME_VERSION ?? gameVersion;
} catch {
  gameVersion = '2.6.0';
}

const baselineEvents = [
  ...events1.EVENTS,
  ...events2.EXTRA_EVENTS,
  ...events3.SEASONAL_EVENTS,
  ...events4.ABSTRACT_EVENTS,
  ...events5.CAMPUS_EVENTS,
  ...chainEvents,
];
const baselineContext = {
  appVersion: gameVersion,
  eventIds: baselineEvents.map((event) => event.id),
  itemIds: itemsModule.ITEMS.map((item) => item.id),
  actionIds: actionsModule.ACTIONS.map((action) => action.id),
  difficultyKeys: ['easy', 'normal', 'hard', 'realistic', 'custom'],
};

/** 一个"最小但合法"的包，各测试按需改其中一块。 */
function validPack(overrides = {}) {
  return {
    format: 1,
    meta: { name: '测试包', version: '1.0.0', author: '测试', note: '单测用' },
    requires: { app: '>=2.0.0' },
    events: [
      {
        id: 'test_event',
        name: '测试事件',
        icon: '🧪',
        kind: 'choice',
        weight: 5,
        text: '这是一条测试事件。',
        choices: [
          { id: 'a', label: '选 A', hint: '提示 A', outcome: '你选了 A。', effect: { stats: { mood: 1 } } },
          { id: 'b', label: '选 B', hint: '提示 B', outcome: '你选了 B。', effect: { stats: { fatigue: -1 } } },
          { id: 'c', label: '选 C', hint: '提示 C', outcome: '你选了 C。', effect: { money: -3 } },
        ],
      },
    ],
    items: [{ id: 'test_item', name: '测试道具', icon: '🧰', price: 100, desc: '测试用', mods: { study: 0.01 } }],
    traits: [],
    personalities: [],
    flaws: [],
    actions: [{ id: 'drill', name: '刷题（内容包改过的名字）', desc: '换过的说明' }],
    balance: { eff: { gainScale: 0.9 }, difficulty: { normal: { forgetScale: 1.1 } } },
    ...overrides,
  };
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'mas2z-content-'));
let tmpSeq = 0;
const tmpFile = (name) => join(tmpRoot, `${(tmpSeq += 1)}-${name}`);
const runTool = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

/* ================================================================ 导出签名 */

test('导出签名齐全（engine.js 和前端按这些名字调用，不能少）', () => {
  assert.equal(PACK_FORMAT, 1);
  assert.deepEqual(PACK_SECTIONS, ['events', 'items', 'traits', 'personalities', 'flaws', 'actions', 'balance']);
  for (const name of ['emptyPack', 'normalizePack', 'satisfies', 'validatePack', 'mergeById', 'planPack', 'summarizePack', 'checksumPack', 'diffPack']) {
    assert.equal(typeof { emptyPack, normalizePack, satisfies, validatePack, mergeById, planPack, summarizePack, checksumPack, diffPack }[name], 'function', `${name} 必须是函数`);
  }
  assert.ok(BALANCE_EFF_KEYS.includes('gainScale'));
  assert.ok(BALANCE_EFF_KEYS.includes('expelAt'));
  assert.deepEqual(BALANCE_DIFFICULTY_KEYS.slice(0, 3), ['gain', 'forgetScale', 'slopeScale']);
});

test('emptyPack 每次都是独立的新对象', () => {
  const a = emptyPack();
  const b = emptyPack();
  assert.equal(a.format, PACK_FORMAT);
  for (const section of PACK_SECTIONS) assert.ok(section in a, `空包要有 ${section}`);
  a.events.push({ id: 'x' });
  a.balance.eff.gainScale = 1;
  assert.deepEqual(b.events, []);
  assert.deepEqual(b.balance, { eff: {}, difficulty: {} });
  assert.notEqual(a.meta, b.meta);
});

/* ============================================================= normalizePack */

test('normalizePack 对任何垃圾输入都不炸，并且总是给出正确形状', () => {
  for (const input of [null, undefined, '字符串', 42, true, [], () => {}, Symbol('x')]) {
    const pack = normalizePack(input);
    assert.equal(pack.format, PACK_FORMAT, `${String(input)} 应该收拢成默认 format`);
    assert.deepEqual(pack.meta, { name: '', version: '', author: '', note: '' });
    assert.deepEqual(pack.requires, {});
    for (const section of ['events', 'items', 'traits', 'personalities', 'flaws', 'actions']) assert.deepEqual(pack[section], []);
    assert.deepEqual(pack.balance, { eff: {}, difficulty: {} });
  }
});

test('normalizePack 丢掉非对象条目、非数字平衡值，并接受字符串 requires', () => {
  const pack = normalizePack({
    requires: '>=2.6.0',
    events: [null, '垃圾', ['数组'], 7, { id: 'ok', name: '留下', kind: 'auto' }],
    items: [{ id: 'i1', name: '道具', price: '260' }],
    balance: { eff: { gainScale: '0.8', bad: 'abc', nan: Number.NaN }, difficulty: { normal: { forgetScale: '2', x: {} }, 乱写: '不是对象' } },
  });
  assert.deepEqual(pack.requires, { app: '>=2.6.0' });
  assert.deepEqual(pack.events.map((event) => event.id), ['ok']);
  assert.equal(pack.items[0].price, '260', 'normalize 不做字段级类型转换');
  assert.deepEqual(pack.balance.eff, { gainScale: 0.8 });
  assert.deepEqual(pack.balance.difficulty, { normal: { forgetScale: 2 } });
});

test('normalizePack 截断 meta 超长字段（40 / 20 / 30 / 200）', () => {
  const pack = normalizePack({
    meta: { name: '名'.repeat(100), version: '1'.repeat(50), author: '作'.repeat(80), note: '注'.repeat(500) },
  });
  assert.equal(pack.meta.name.length, 40);
  assert.equal(pack.meta.version.length, 20);
  assert.equal(pack.meta.author.length, 30);
  assert.equal(pack.meta.note.length, 200);
});

test('normalizePack 把空的 format 当默认版本，显式写错的版本留给 validatePack 报', () => {
  assert.equal(normalizePack({ format: null }).format, PACK_FORMAT);
  assert.equal(normalizePack({ format: '' }).format, PACK_FORMAT);
  assert.equal(normalizePack({ format: '   ' }).format, PACK_FORMAT);
  assert.equal(normalizePack({ format: '2' }).format, 2);
  assert.equal(normalizePack({ format: 0 }).format, 0);
});

test('normalizePack 支持顶层 name / version 别名，且返回的是新数组', () => {
  const input = { name: '别名包', version: '9.9.9', events: [{ id: 'e', name: 'n', kind: 'auto' }] };
  const pack = normalizePack(input);
  assert.equal(pack.meta.name, '别名包');
  assert.equal(pack.meta.version, '9.9.9');
  assert.notEqual(pack.events, input.events);
  assert.equal(pack.events[0], input.events[0], '条目本身还是引用，字段级深拷贝交给合并层');
});

/* ============================================================== validatePack */

test('一个正常的内容包能通过校验', () => {
  const result = validatePack(validPack(), baselineContext);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, [], '这个包每一段都是合法的，不该有警告');
  assert.equal(result.ok, true);
});

test('没有名字只 warn；空包 warn"什么都没改"；有内容就不再 warn', () => {
  const bare = validatePack({ format: 1 });
  assert.equal(bare.ok, true);
  assert.ok(bare.warnings.includes('内容包没有名字，界面上会显示成"未命名内容包"'));
  assert.ok(bare.warnings.some((warning) => warning.includes('这个包什么都没改')));

  const withItem = validatePack({ format: 1, items: [{ id: 'x', name: 'y' }] });
  assert.ok(!withItem.warnings.some((warning) => warning.includes('什么都没改')));
});

test('格式版本不匹配会报错，并说清"这个版本只认识哪个"', () => {
  const result = validatePack({ format: 99, meta: { name: '未来的包' } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes(`内容包格式是 v99，这个版本只认识 v${PACK_FORMAT}`)), result.errors.join('|'));
});

test('requires.app 不满足时报错，并带上当前版本', () => {
  const result = validatePack({ format: 1, meta: { name: 'x' }, requires: { app: '>=3.0.0' } }, { appVersion: '2.6.0' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('要求游戏版本 >=3.0.0') && error.includes('当前是 2.6.0')), result.errors.join('|'));
});

test('事件缺字段的报错能定位到具体事件和字段', () => {
  const result = validatePack({ format: 1, meta: { name: 'x' }, events: [{ id: 'broken_event' }, { name: '没有 id 的事件', kind: 'auto' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error === '事件 broken_event 缺少字段 name（包里第 1 条事件）'), result.errors.join('|'));
  assert.ok(result.errors.some((error) => error.includes('事件 (没有 id) 缺少字段 id')), result.errors.join('|'));
  assert.ok(result.errors.some((error) => error.includes('包里第 2 条事件')), result.errors.join('|'));
});

test('事件 id / 选项 id 重复、choice 没有 choices 都会报错', () => {
  const duplicate = validatePack({
    format: 1,
    meta: { name: 'x' },
    events: [
      { id: 'same', name: 'a', kind: 'auto' },
      { id: 'same', name: 'b', kind: 'auto' },
    ],
  });
  assert.ok(duplicate.errors.some((error) => error.includes('事件 same 在包里出现了两次')), duplicate.errors.join('|'));

  const noChoices = validatePack({ format: 1, meta: { name: 'x' }, events: [{ id: 'c', name: 'c', kind: 'choice' }] });
  assert.ok(noChoices.errors.some((error) => error.includes('事件 c 是 choice 事件，必须带 choices')), noChoices.errors.join('|'));

  const badChoices = validatePack({
    format: 1,
    meta: { name: 'x' },
    events: [
      {
        id: 'c2',
        name: 'c2',
        kind: 'choice',
        choices: [{ id: 'dup', label: '1', outcome: 'o' }, { id: 'dup', label: '2' }, '不是对象'],
      },
    ],
  });
  assert.ok(badChoices.errors.some((error) => error.includes('事件 c2 的选项缺少 outcome（第 2 个选项）')), badChoices.errors.join('|'));
  assert.ok(badChoices.errors.some((error) => error.includes('事件 c2 的选项 dup 重复了')), badChoices.errors.join('|'));
  assert.ok(badChoices.errors.some((error) => error.includes('事件 c2 的第 3 个选项必须是一个对象')), badChoices.errors.join('|'));
});

test('事件 text 类型错、name 空、text 超长都会报错并说清在哪', () => {
  const result = validatePack({
    format: 1,
    meta: { name: 'x' },
    events: [
      { id: 'weird_text', name: 'w', kind: 'auto', text: { 不是: '字符串' } },
      { id: 'empty_name', name: '   ', kind: 'auto' },
      { id: 'long_text', name: 'l', kind: 'auto', text: '字'.repeat(MAX_TEXT_LENGTH + 1) },
    ],
  });
  assert.ok(result.errors.some((error) => error === '事件 weird_text 的 text 必须是字符串'), result.errors.join('|'));
  assert.ok(result.errors.some((error) => error.includes('事件 empty_name 的 name 不能是空字符串')), result.errors.join('|'));
  assert.ok(result.errors.some((error) => error.includes('事件 long_text 的 text 太长') && error.includes(`上限 ${MAX_TEXT_LENGTH}`)), result.errors.join('|'));
});

test('weight 不是正数报错；不认识的 kind / auto 事件带 choices 只 warn', () => {
  const result = validatePack({
    format: 1,
    meta: { name: 'x' },
    events: [
      { id: 'bad_weight', name: 'w', kind: 'auto', weight: 0 },
      { id: 'future_kind', name: 'f', kind: 'story-ish' },
      { id: 'auto_with_choices', name: 'a', kind: 'auto', choices: [{ id: 'c', label: 'l', outcome: 'o' }] },
    ],
  });
  assert.ok(result.errors.some((error) => error.includes('事件 bad_weight 的 weight 必须是大于 0 的数字')), result.errors.join('|'));
  assert.ok(result.warnings.some((warning) => warning.includes('事件 future_kind 的 kind "story-ish" 引擎不认识')), result.warnings.join('|'));
  assert.ok(result.warnings.some((warning) => warning.includes('事件 auto_with_choices 的 kind 是 auto，choices 会被忽略')), result.warnings.join('|'));
});

test('道具的报错能定位到具体道具（缺字段 / price 非数字 / 负数 / 重复）', () => {
  const result = validatePack({
    format: 1,
    meta: { name: 'x' },
    items: [
      { id: 'no_name' },
      { id: 'bad_price', name: '坏价格', price: '不要钱' },
      { id: 'negative', name: '负价格', price: -5 },
      { id: 'dup', name: '第一次' },
      { id: 'dup', name: '第二次' },
    ],
  });
  assert.ok(result.errors.some((error) => error.includes('道具必须带 id 和 name') && error.includes('id=no_name')), result.errors.join('|'));
  assert.ok(result.errors.some((error) => error === '道具 bad_price 的 price 不是数字："不要钱"'), result.errors.join('|'));
  assert.ok(result.errors.some((error) => error.includes('道具 negative 的 price 不能是负数')), result.errors.join('|'));
  assert.ok(result.errors.some((error) => error.includes('道具 dup 在包里出现了两次')), result.errors.join('|'));
});

test('actions 只能改文案：未知行动报错，带额外字段只 warn', () => {
  const result = validatePack(
    {
      format: 1,
      meta: { name: 'x' },
      actions: [
        { id: 'drill', desc: '改过的说明' },
        { id: 'made_up_action', desc: '凭空造一个行动' },
        { id: 'listen', desc: '还夹带了 effect', effect: { stats: { mood: 99 } } },
      ],
    },
    { actionIds: ['drill', 'listen'] },
  );
  assert.ok(result.errors.some((error) => error.includes('actions 里没有这个行动：made_up_action') && error.includes('不能新增行动')), result.errors.join('|'));
  assert.ok(result.warnings.some((warning) => warning.includes('actions 里的 listen 带了 effect')), result.warnings.join('|'));
});

test('balance 非数字值是错误，未知的键 / 难度只 warn', () => {
  const result = validatePack(
    {
      format: 1,
      meta: { name: 'x' },
      balance: {
        eff: { gainScale: '很平衡', unknownKey: 1 },
        difficulty: { normal: { forgetScale: 2, unknownField: 1 }, 不存在: { gain: 1 }, 乱写: '不是对象' },
      },
    },
    { difficultyKeys: ['normal'] },
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error === 'balance.eff.gainScale 必须是数字："很平衡"'), result.errors.join('|'));
  assert.ok(result.errors.some((error) => error.includes('balance.difficulty.乱写 必须是一个对象')), result.errors.join('|'));
  assert.ok(result.warnings.some((warning) => warning.includes('balance.eff.unknownKey 引擎不认')), result.warnings.join('|'));
  assert.ok(result.warnings.some((warning) => warning.includes('balance.difficulty.normal.unknownField 引擎不认')), result.warnings.join('|'));
});

test('不认识的段落会 warn（回归：原来的判断写在收拢结果上，永远不会触发）', () => {
  const result = validatePack({ format: 1, meta: { name: 'x' }, achievements: [{ id: 'a' }], stories: [] });
  assert.ok(result.warnings.some((warning) => warning.includes('包里有一段 "achievements"')), result.warnings.join('|'));
  assert.ok(result.warnings.some((warning) => warning.includes('包里有一段 "stories"')), result.warnings.join('|'));
});

test('顶层的 name / version 别名不算"不认识的段落"', () => {
  const result = validatePack({ format: 1, name: '别名包', version: '1.0.0' });
  assert.ok(!result.warnings.some((warning) => warning.includes('"name"') || warning.includes('"version"')), result.warnings.join('|'));
});

test('垃圾条目（不是对象）会被点名丢掉，而不是静默消失', () => {
  const result = validatePack({ format: 1, meta: { name: 'x' }, events: ['字符串', 123], items: [['数组']] });
  assert.ok(result.warnings.some((warning) => warning.includes('events 的第 1 条不是对象（是 string）')), result.warnings.join('|'));
  assert.ok(result.warnings.some((warning) => warning.includes('items 的第 1 条不是对象（是 array）')), result.warnings.join('|'));
});

test('循环引用 / 函数 / NaN 不会把 validatePack 或 checksumPack 炸掉', () => {
  const circular = { format: 1, meta: { name: '循环包' } };
  const event = { id: 'loop_event', name: '自引用', kind: 'auto' };
  event.self = event;
  circular.events = [event];
  circular.loop = circular;
  circular.balance = { eff: { gainScale: Number.NaN, expelAt: Number.POSITIVE_INFINITY } };

  const result = validatePack(circular);
  assert.equal(typeof result.ok, 'boolean');
  assert.ok(Array.isArray(result.errors));
  const first = checksumPack(circular);
  assert.match(first, /^[0-9a-f]{8}$/);
  assert.equal(checksumPack(circular), first, '同一个循环包要算出同一个校验和');
  assert.equal(stableStringify(circular).includes('"[circular]"'), true);
  assert.doesNotThrow(() => diffPack({ format: 1 }, circular));
});

test('validatePack 不传 context 也能跑（不判重名，也不误判版本）', () => {
  const result = validatePack(validPack());
  assert.equal(result.ok, true, `缺上下文时不该因为版本判断拦下来：${result.errors.join('|')}`);
  assert.equal(result.warnings.some((warning) => warning.includes('会覆盖')), false);
  assert.equal(result.errors.some((error) => error.includes('要求游戏版本')), false);
  assert.equal(validatePack(validPack(), {}).ok, true);
});

/* ================================================================ satisfies */

test('版本约束支持 >= > <= < = != 与空值，看不懂的一律放行', () => {
  assert.equal(satisfies('2.6.0', '>=2.6.0'), true);
  assert.equal(satisfies('2.6.1', '>=2.6.0'), true);
  assert.equal(satisfies('2.5.9', '>=2.6.0'), false);
  assert.equal(satisfies('2.6.0', '>2.6.0'), false);
  assert.equal(satisfies('2.6.1', '>2.6.0'), true);
  assert.equal(satisfies('2.6.0', '<=2.6.0'), true);
  assert.equal(satisfies('2.6.0', '<2.6.0'), false);
  assert.equal(satisfies('2.6.0', '==2.6.0'), true);
  assert.equal(satisfies('2.6.0', '=2.6'), true, '两段版本号等于补零');
  assert.equal(satisfies('2.6.0', '!=2.6.0'), false);
  assert.equal(satisfies('2.6.0', ''), true);
  assert.equal(satisfies('2.6.0', undefined), true);
  assert.equal(satisfies('2.6.0', '乱写的约束'), true);
  assert.equal(satisfies('', '>=0.0.1'), false, '空版本当 0.0.0');
});

test('版本比较按段进行，不会因为"段宽"撞车（2.100.0 < 3.0.0）', () => {
  assert.equal(satisfies('2.100.0', '<3.0.0'), true);
  assert.equal(satisfies('2.100.0', '>2.99.0'), true);
  assert.equal(satisfies('2.6.0', '>= 2.6.0'), true, '操作符后面可以有空格');
});

/* =============================================================== mergeById */

test('mergeById 同 id 覆盖、新 id 追加、顺序保持，且不改动入参', () => {
  const base = [
    { id: 'a', name: 'A', price: 1 },
    { id: 'b', name: 'B', price: 2 },
  ];
  const patch = [
    { id: 'b', price: 20 },
    { id: 'c', name: 'C' },
  ];
  const result = mergeById(base, patch);
  assert.deepEqual(result.added, ['c']);
  assert.deepEqual(result.replaced, ['b']);
  assert.deepEqual(result.merged.map((entry) => entry.id), ['a', 'b', 'c']);
  assert.deepEqual(result.merged[1], { id: 'b', name: 'B', price: 20 }, '一层浅合并：没写的字段保留');
  assert.deepEqual(base[1], { id: 'b', name: 'B', price: 2 }, '原数组不能被改写');
  assert.notEqual(result.merged[1], patch[0], '覆盖产生新对象，不把包里的对象塞进引擎');
  assert.notEqual(result.merged[2], patch[1], '新增也是副本');
});

test('mergeById 跳过没有 id 的条目并报告数量', () => {
  const result = mergeById([], [{ name: '没有 id' }, '字符串', null, { id: 'ok', name: '有 id' }]);
  assert.deepEqual(result.added, ['ok']);
  assert.equal(result.skipped.length, 3);
  assert.equal(result.merged.length, 1);
});

test('mergeById 对垃圾输入也返回可用结构', () => {
  assert.deepEqual(mergeById(null, undefined), { merged: [], added: [], replaced: [], skipped: [] });
  assert.deepEqual(mergeById('不是数组', { id: 'x' }).merged, []);
  assert.equal(mergeById([{ id: 'a' }], [{ id: 'a', name: 'x' }]).merged[0].name, 'x');
});

/* ================================================================ planPack */

test('planPack 同 id 覆盖、新 id 追加，基线保持原样', () => {
  const baseline = {
    events: [{ id: 'e1', name: '旧名字', kind: 'auto' }],
    items: [{ id: 'i1', name: '旧道具', price: 10 }],
    actions: [{ id: 'drill', name: '刷题', desc: '旧说明', icon: '✍️', effect: { knowledge: { subject: 1 } } }],
    eff: { gainScale: 1 },
    difficulty: { normal: { forgetScale: 1, gain: 1 } },
  };
  const pack = {
    format: 1,
    meta: { name: '包' },
    events: [
      { id: 'e1', name: '新名字' },
      { id: 'e2', name: '全新事件', kind: 'choice', choices: [{ id: 'c', label: 'l', outcome: 'o' }] },
    ],
    items: [{ id: 'i1', price: 20 }],
    actions: [{ id: 'drill', name: '新名字', desc: '新说明', icon: '💥', effect: { knowledge: { subject: 99 } } }],
    balance: { eff: { gainScale: 0.5 }, difficulty: { normal: { forgetScale: 2 } } },
  };
  const plan = planPack(baseline, pack);

  assert.deepEqual(plan.events.map((event) => event.id), ['e1', 'e2']);
  assert.equal(plan.events[0].name, '新名字');
  assert.equal(plan.events[0].kind, 'auto', '没写的字段保留基线值');
  assert.deepEqual(plan.applied.events.added, ['e2']);
  assert.deepEqual(plan.applied.events.replaced, ['e1']);

  assert.equal(plan.items[0].name, '旧道具');
  assert.equal(plan.items[0].price, 20);

  assert.equal(plan.actions[0].name, '新名字');
  assert.equal(plan.actions[0].desc, '新说明');
  assert.equal(plan.actions[0].icon, '✍️', 'actions 只能改文案，结构字段必须保持');
  assert.deepEqual(plan.actions[0].effect, { knowledge: { subject: 1 } }, 'actions 的 effect 不能被内容包改');

  assert.deepEqual(plan.eff, { gainScale: 0.5 });
  assert.deepEqual(plan.difficulty, { normal: { forgetScale: 2, gain: 1 } });

  assert.deepEqual(baseline.events, [{ id: 'e1', name: '旧名字', kind: 'auto' }], '基线不能被改');
  assert.deepEqual(baseline.actions[0], { id: 'drill', name: '刷题', desc: '旧说明', icon: '✍️', effect: { knowledge: { subject: 1 } } });
  assert.deepEqual(baseline.eff, { gainScale: 1 });
});

test('planPack：actions 里 id 对不上的直接丢掉；只接受字符串文案', () => {
  const baseline = { actions: [{ id: 'drill', name: '刷题', desc: '旧说明' }] };
  const plan = planPack(baseline, {
    format: 1,
    actions: [
      { id: 'made_up', name: '凭空来的行动' },
      { id: 'drill', name: { 不是: '字符串' }, desc: 42 },
    ],
  });
  assert.deepEqual(plan.actions.map((action) => action.id), ['drill']);
  assert.equal(plan.actions[0].name, '刷题', '不是字符串的 name 被忽略，界面不会被写坏');
  assert.equal(plan.actions[0].desc, '旧说明');
  assert.deepEqual(plan.applied.actions, { replaced: ['drill'], dropped: ['made_up'] });
});

test('planPack：balance 只覆盖已知键，未知键原样丢掉并记录下来', () => {
  const baseline = { eff: { gainScale: 1, expelAt: 120 }, difficulty: { normal: { forgetScale: 1, gain: 1 }, hard: { gain: 0.85 } } };
  const plan = planPack(baseline, {
    format: 1,
    balance: {
      eff: { gainScale: 0.7, madeUpKey: 5 },
      difficulty: { normal: { forgetScale: 3, madeUpField: 9 }, 不存在难度: { gain: 2 }, hard: { gain: 0.5 } },
    },
  });
  assert.deepEqual(plan.eff, { gainScale: 0.7, expelAt: 120 });
  assert.deepEqual(plan.applied.eff, ['gainScale']);
  assert.deepEqual(plan.applied.effIgnored, ['madeUpKey']);
  assert.deepEqual(plan.difficulty, { normal: { forgetScale: 3, gain: 1 }, hard: { gain: 0.5 } });
  assert.deepEqual(plan.applied.difficulty, ['normal', 'hard']);
  assert.deepEqual(plan.applied.difficultyIgnored, ['不存在难度']);
});

test('planPack 是纯函数：不改包、不改基线，空包等于基线的一份拷贝', () => {
  const baseline = {
    events: [{ id: 'e1', name: '旧', kind: 'auto' }],
    items: [{ id: 'i1', name: '道具' }],
    traits: [],
    personalities: [],
    flaws: [],
    actions: [{ id: 'drill', name: '刷题', desc: '旧' }],
    eff: { gainScale: 1 },
    difficulty: { normal: { forgetScale: 1 } },
  };
  const baselineCopy = JSON.parse(JSON.stringify(baseline));
  const pack = validPack();
  const packCopy = JSON.parse(JSON.stringify(pack));
  const plan = planPack(baseline, pack);
  assert.deepEqual(baseline, baselineCopy);
  assert.deepEqual(pack, packCopy);
  assert.notEqual(plan.eff, baseline.eff);
  assert.notEqual(plan.difficulty, baseline.difficulty);
  assert.notEqual(plan.events, baseline.events);

  const empty = planPack(baseline, {});
  assert.deepEqual(empty.events, baseline.events);
  assert.deepEqual(empty.actions, baseline.actions);
  assert.deepEqual(empty.eff, baseline.eff);
  assert.deepEqual(empty.applied.events, { added: [], replaced: [], skipped: 0 });
});

test('planPack 对垃圾基线（null / 字符串段）也不炸', () => {
  const plan = planPack({ events: '不是数组', actions: null, eff: 5, difficulty: 'x' }, validPack());
  assert.ok(Array.isArray(plan.events));
  assert.ok(Array.isArray(plan.actions));
  assert.deepEqual(plan.eff, {});
  assert.deepEqual(plan.difficulty, {});
});

/* =================================================== checksumPack / diffPack */

test('checksumPack 与字段书写顺序无关（同一份内容必须算出同一个值）', () => {
  const a = validPack();
  const b = {
    balance: { difficulty: { normal: { forgetScale: 1.1 } }, eff: { gainScale: 0.9 } },
    actions: [{ desc: '换过的说明', name: '刷题（内容包改过的名字）', id: 'drill' }],
    flaws: [],
    personalities: [],
    traits: [],
    items: [{ mods: { study: 0.01 }, desc: '测试用', price: 100, icon: '🧰', name: '测试道具', id: 'test_item' }],
    events: [
      {
        choices: [
          { effect: { stats: { mood: 1 } }, outcome: '你选了 A。', hint: '提示 A', label: '选 A', id: 'a' },
          { effect: { stats: { fatigue: -1 } }, outcome: '你选了 B。', hint: '提示 B', label: '选 B', id: 'b' },
          { effect: { money: -3 }, outcome: '你选了 C。', hint: '提示 C', label: '选 C', id: 'c' },
        ],
        text: '这是一条测试事件。',
        weight: 5,
        kind: 'choice',
        icon: '🧪',
        name: '测试事件',
        id: 'test_event',
      },
    ],
    requires: { app: '>=2.0.0' },
    meta: { note: '单测用', author: '测试', version: '1.0.0', name: '测试包' },
    format: 1,
  };
  assert.equal(checksumPack(a), checksumPack(b));
  assert.equal(checksumPack(a), checksumPack(JSON.parse(JSON.stringify(a))));
});

test('checksumPack：内容变了值就变；空包稳定；函数 / undefined 也能算', () => {
  const base = checksumPack(validPack());
  assert.match(base, /^[0-9a-f]{8}$/);
  const changed = validPack({ balance: { eff: { gainScale: 0.91 }, difficulty: {} } });
  assert.notEqual(checksumPack(changed), base);
  assert.equal(checksumPack({}), checksumPack(emptyPack()));
  assert.equal(checksumPack({ format: 1, meta: { name: 'x' }, events: [{ id: 'e', name: 'n', kind: 'auto', cond: () => true }] }), checksumPack({ format: 1, meta: { name: 'x' }, events: [{ id: 'e', name: 'n', kind: 'auto', cond: () => false }] }), '函数没法哈希，只标记存在');
});

test('diffPack 报出新增 / 修改 / 删除、actions 与平衡变化，meta 变化也带上', () => {
  const base = { format: 1, meta: { name: '旧包', version: '1.0.0' }, events: [{ id: 'e1', name: 'a', kind: 'auto' }, { id: 'e2', name: 'b', kind: 'auto' }], actions: [{ id: 'drill', desc: '旧' }], balance: { eff: { gainScale: 1 }, difficulty: { normal: { forgetScale: 1 } } } };
  const next = {
    format: 1,
    meta: { name: '新包', version: '1.1.0' },
    events: [{ id: 'e1', name: 'a 改过了', kind: 'auto' }, { id: 'e3', name: 'c', kind: 'auto' }],
    actions: [{ id: 'drill', desc: '新' }],
    balance: { eff: { gainScale: 0.8 }, difficulty: { normal: { forgetScale: 2 } } },
  };
  const diff = diffPack(base, next);
  assert.deepEqual(diff.events.added, ['e3']);
  assert.deepEqual(diff.events.replaced, ['e1']);
  assert.deepEqual(diff.events.removed, ['e2']);
  assert.deepEqual(diff.actions.replaced, ['drill']);
  assert.deepEqual(diff.balance.effChanged, [{ key: 'gainScale', before: 1, after: 0.8 }]);
  assert.deepEqual(diff.balance.difficultyChanged, [{ difficulty: 'normal', field: 'forgetScale', before: 1, after: 2 }]);
  assert.deepEqual(diff.meta.changed, ['name', 'version']);
  assert.deepEqual(diffPack(base, base).events, { added: [], replaced: [], removed: [] });
});

test('diffPack 不把"字段顺序不同"当成改过（用稳定比较）', () => {
  const base = { format: 1, events: [{ id: 'e', name: 'n', kind: 'auto', text: 't' }] };
  const reordered = { format: 1, events: [{ text: 't', kind: 'auto', name: 'n', id: 'e' }] };
  assert.deepEqual(diffPack(base, reordered).events.replaced, []);
 });

/* ============================================================ summarizePack */

test('summarizePack 给出计数、校验和口径与 active 标记', () => {
  const summary = summarizePack(validPack());
  assert.equal(summary.name, '测试包');
  assert.equal(summary.version, '1.0.0');
  assert.equal(summary.format, 1);
  assert.equal(summary.requires, '>=2.0.0');
  assert.deepEqual(summary.counts, { events: 1, items: 1, traits: 0, personalities: 0, flaws: 0, actions: 1, balance: 2 });
  assert.equal(summary.total, 5);
  assert.equal(summary.active, true);
  assert.equal(summarizePack({}).active, false);
  assert.equal(summarizePack({ meta: { name: '只有名字' } }).active, true);
});

/* ================================================ 真实内容包（web/content/） */

test('official-pack.json：校验通过，并且是"全新"内容（不覆盖任何内置事件/道具）', () => {
  const result = validatePack(officialPack, baselineContext);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, [], `官方包不该有警告：${result.warnings.join('|')}`);
  assert.equal(officialPack.meta.version, '2.6.1');
  assert.equal(officialPack.requires.app, '>=2.6.0');
});

test('official-pack.json：2 个全新 choice 事件，每个 3 个选项，字段齐全且 id 不存在于内置内容', () => {
  const knownEvents = new Set(baselineContext.eventIds);
  assert.equal(officialPack.events.length, 2);
  for (const event of officialPack.events) {
    assert.equal(knownEvents.has(event.id), false, `${event.id} 必须是全新事件`);
    assert.equal(typeof event.name, 'string');
    assert.equal(typeof event.icon, 'string');
    assert.equal(event.kind, 'choice');
    assert.ok(event.weight > 0);
    assert.ok(event.text.length > 10);
    assert.equal(event.choices.length, 3, `${event.id} 要有 3 个选项`);
    for (const choice of event.choices) {
      for (const field of ['id', 'label', 'hint', 'outcome', 'effect']) assert.ok(choice[field] !== undefined, `${event.id}.${choice.id} 缺少 ${field}`);
    }
  }
});

test('official-pack.json：1 个新道具（mods 键引擎认识）+ 1 处平衡调整只动已知键', () => {
  const knownItems = new Set(baselineContext.itemIds);
  assert.equal(officialPack.items.length, 1);
  const item = officialPack.items[0];
  assert.equal(knownItems.has(item.id), false, '必须是新道具');
  assert.equal(typeof item.price, 'number');
  assert.ok(item.mods && typeof item.mods === 'object');
  for (const key of Object.keys(item.mods)) {
    assert.ok(['study', 'moodDrain', 'physique', 'social', 'weeklyRecovery', 'weeklyMood', 'fatigueGain', 'comprehensive', 'rest', 'luck', 'examNoise'].includes(key), `${key} 不在引擎认识的 mods 里`);
  }
  assert.deepEqual(Object.keys(officialPack.balance.eff), ['gainScale']);
  assert.ok(BALANCE_EFF_KEYS.includes('gainScale'));
  assert.deepEqual(Object.keys(officialPack.balance.difficulty), ['normal']);
  assert.deepEqual(Object.keys(officialPack.balance.difficulty.normal), ['forgetScale']);
});

test('official-pack.json：能被 planPack 真的应用（事件追加、道具追加、平衡覆盖）', () => {
  const baseline = {
    events: [{ id: 'yushanhu_run', name: '雨山湖晨跑', kind: 'choice' }],
    items: [{ id: 'coffee', name: '咖啡周卡', price: 120 }],
    actions: [],
    eff: { gainScale: 0.78, expelAt: 120 },
    difficulty: { normal: { forgetScale: 1 } },
  };
  const plan = planPack(baseline, officialPack);
  assert.equal(plan.events.length, 3);
  assert.deepEqual(plan.applied.events.added, ['pack_rain_library', 'pack_winter_relay']);
  assert.deepEqual(plan.items.map((item) => item.id), ['coffee', 'thermos']);
  assert.equal(plan.eff.gainScale, 0.82);
  assert.equal(plan.eff.expelAt, 120, '没在包里写的平衡值保持原样');
  assert.deepEqual(plan.difficulty.normal, { forgetScale: 0.95 });
});

test('demo-update.json：校验通过，diff 显示"加一条、改一条、调一次平衡"', () => {
  const result = validatePack(demoPack, baselineContext);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(demoPack.meta.version, '2.6.2');
  assert.notEqual(checksumPack(demoPack), checksumPack(officialPack));

  const diff = diffPack(officialPack, demoPack);
  assert.deepEqual(diff.events.added, ['pack_radio_dedication']);
  assert.deepEqual(diff.events.replaced, ['pack_rain_library']);
  assert.deepEqual(diff.events.removed, []);
  assert.deepEqual(diff.items.replaced, ['thermos']);
  assert.deepEqual(diff.balance.effChanged, [{ key: 'gainScale', before: 0.82, after: 0.88 }]);
  assert.deepEqual(diff.meta.changed, ['version', 'note']);
});

test('两个示例包都不含未定义字段 / 空字符串正文（手写 JSON 的低级错误）', () => {
  for (const pack of [officialPack, demoPack]) {
    const roundTrip = JSON.parse(JSON.stringify(pack));
    assert.deepEqual(roundTrip, pack, '示例包不能有 undefined / 函数这类进不了 JSON 的东西');
    for (const event of pack.events) {
      assert.ok(event.text.trim().length > 0);
      for (const choice of event.choices) {
        assert.ok(choice.label.trim().length > 0);
        assert.ok(choice.outcome.trim().length > 0);
      }
    }
  }
});

/* =============================================== parsePackText（玩家手写的包） */

test('parsePackText：剥掉 UTF-8 BOM 与零宽字符（记事本 / PowerShell 存的文件）', () => {
  const pack = { format: 1, meta: { name: '带 BOM 的包' }, items: [] };
  assert.deepEqual(parsePackText(`\uFEFF${JSON.stringify(pack)}`), pack);
  // 从网页 / 聊天软件复制来的文本常常混进零宽字符和 NBSP
  assert.deepEqual(parsePackText(`\u200B\u00A0  ${JSON.stringify(pack)}`), pack);
});

test('parsePackText：收下对象、忽略首尾空白，内部代码可以统一走这个入口', () => {
  const pack = { format: 1 };
  assert.equal(parsePackText(pack), pack);
  assert.deepEqual(parsePackText('\n\t {"format":1}  \n'), { format: 1 });
});

test('parsePackText：报错要点名真正的原因，而不是 JSON.parse 的天书', () => {
  assert.throws(() => parsePackText(''), /内容包是空的/);
  assert.throws(() => parsePackText('   \uFEFF  '), /内容包是空的/);
  assert.throws(() => parsePackText('[]'), /必须以 \{ 开头/);
  assert.throws(() => parsePackText('[{"id":"a"}]'), /数组放进 events/);
  assert.throws(() => parsePackText('{"meta":{"name":"中文引号“}}'), /中文标点/);
  assert.throws(() => parsePackText('{"items":[],}'), /末尾多了一个逗号/);
  assert.throws(() => parsePackText('{ // 注释\n "format":1}'), /不支持/);
  assert.throws(() => parsePackText(42), /JSON 文本或一个 JSON 对象/);
});

test('parsePackText：顶层不是对象时直接说清楚，不把噪音丢给 validatePack', () => {
  assert.throws(() => parsePackText('"just a string"'), /必须以 \{ 开头/);
  assert.throws(() => parsePackText('null'), /必须以 \{ 开头/);
});

test('CLI：--pack 能读带 BOM 的包，并且 --content 报的是"加载之后"的状态', () => {
  /*
   * 两个回归：
   *   1. 玩家用记事本存的内容包带 BOM，以前会报 `Unexpected token ''` 直接装不上；
   *   2. `--content` 原来排在 `--pack` 加载之前 return，`--pack x --content`
   *      永远显示"官方内置内容"——玩家自查热更新的第一条命令就是它。
   */
  const file = tmpFile('bom-pack.json');
  writeFileSync(file, `\uFEFF${JSON.stringify(officialPack)}`, 'utf8');
  const run = spawnSync(process.execPath, [CLI, '--pack', file, '--content'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /已加载内容包：官方焕新内容包/, run.stdout);
  assert.doesNotMatch(run.stdout, /当前：官方内置内容/, '加载后的状态不能被"内置内容"盖住');
  const counts = /随机事件：(\d+) 个（内置 (\d+) 个）/.exec(run.stdout);
  assert.ok(counts, `状态里要有事件计数：${run.stdout}`);
  assert.ok(Number(counts[1]) > Number(counts[2]), '内容包的事件要真的进了随机池');
  assert.equal(run.stdout.includes('读内容包失败'), false);
});

test('CLI：--pack 指向坏包时只说人话，而且不静默算成功', () => {
  const file = tmpFile('broken-pack.json');
  writeFileSync(file, '{"items":[],}', 'utf8');
  const run = spawnSync(process.execPath, [CLI, '--pack', file, '--content'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /末尾多了一个逗号/);
  assert.match(run.stdout, /当前：官方内置内容/, '坏包不该让状态变成"已加载"');
});

test('引擎：applyContentPack 也接受原始 JSON 文本（CLI / 服务端 / 离线三条入口共用一条解析路径）', async () => {
  const engine = await import('../src/engine.js');
  const before = engine.contentStatus().eventCount;
  const result = engine.applyContentPack(`\uFEFF${JSON.stringify(officialPack)}`);
  assert.equal(result.ok, true, result.errors.join('；'));
  assert.ok(engine.contentStatus().eventCount > before, '事件要真的追加进引擎');
  engine.resetContent();
  assert.equal(engine.contentStatus().active, false);

  const bad = engine.applyContentPack('{"items":[],}');
  assert.equal(bad.ok, false, '读不懂的文本不能算成功');
  assert.match(bad.errors[0], /末尾多了一个逗号/);
  assert.equal(engine.contentStatus().active, false, '坏包不能把引擎留在半应用状态');
});

/* ============================================ tools/build-content-pack.mjs */

test('CLI：从 src/data 生成的包无 BOM、校验通过，两次运行字节完全一致', () => {
  /*
   * 这个测试在共享工作区里跑：别的队友可能正好在改 src/data/*.js，
   * 那两次生成之间源码就变了，字节当然不一样——这不算工具不稳定。
   * 所以"对不上就再跑一对"，连续两对都对不上才判失败。
   */
  const generate = () => {
    const first = tmpFile('snapshot-a.json');
    const second = tmpFile('snapshot-b.json');
    const args = ['--name', 'CLI Test Pack', '--version', '2.6.1'];
    const runA = runTool('--out', first, ...args);
    const runB = runTool('--out', second, ...args);
    return { runA, runB, bytesA: readFileSync(first), bytesB: readFileSync(second), first, second };
  };
  let pair = generate();
  if (!pair.bytesA.equals(pair.bytesB)) pair = generate();
  const { runA, runB, bytesA, bytesB } = pair;
  assert.equal(runA.status, 0, runA.stderr);
  assert.equal(runB.status, 0, runB.stderr);
  assert.deepEqual(bytesA, bytesB, '同一份源码跑两次必须字节一致');

  assert.notEqual(bytesA[0], 0xef, '不能有 UTF-8 BOM');
  assert.equal(bytesA.subarray(0, 1).toString('utf8'), '{');
  assert.ok(bytesA.toString('utf8').endsWith('\n'));

  const pack = JSON.parse(bytesA.toString('utf8'));
  assert.equal(pack.meta.name, 'CLI Test Pack');
  assert.equal(pack.meta.version, '2.6.1');
  assert.equal(pack.requires.app, `>=${gameVersion}`, '默认按游戏版本生成兼容约束，而不是包自己的版本');
  assert.ok(pack.events.length > 0);
  assert.ok(pack.meta.note.includes('build-content-pack.mjs'), '生成的包里要有生成器标记（防误覆盖靠它）');
  const sha = /sha1 ([0-9a-f]{40})/.exec(runA.stdout);
  const shaB = /sha1 ([0-9a-f]{40})/.exec(runB.stdout);
  assert.ok(sha && shaB, `摘要里要有 sha1 自证：${runA.stdout}`);
  assert.equal(sha[1], shaB[1], '两次运行的 sha1 必须相同');
  const result = validatePack(pack, baselineContext);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('CLI：生成时会跳过 JSON 装不下的条目（带函数的 cond / effect），并点名', () => {
  const out = tmpFile('snapshot-events.json');
  const run = runTool('--out', out, '--only', 'events');
  assert.equal(run.status, 0, run.stderr);
  const pack = JSON.parse(readFileSync(out, 'utf8'));
  const ids = new Set(pack.events.map((event) => event.id));
  assert.ok(ids.has('yushanhu_run'), '纯数据事件应该进包');
  assert.equal(ids.has('monthly_rank'), false, 'cond 是函数的条目必须跳过，否则"只在高二触发"会变成随时触发');
  assert.match(run.stdout, /跳过\s+\d+ 条/);
  assert.match(run.stdout, /cond 是函数/);
  assert.deepEqual(validatePack(pack, baselineContext).errors, []);
});

test('CLI：--only 只带指定段落，未知段落直接退出码 2', () => {
  const out = tmpFile('only.json');
  const run = runTool('--out', out, '--only', 'events,balance', '--quiet');
  assert.equal(run.status, 0, run.stderr);
  const pack = JSON.parse(readFileSync(out, 'utf8'));
  assert.ok(pack.events.length > 0);
  assert.ok(pack.balance.eff.gainScale > 0, '平衡表要带进来');
  assert.deepEqual(pack.items, []);
  assert.deepEqual(pack.actions, []);

  const bad = runTool('--only', 'events,achievements');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /不认识的段落：achievements/);
});

test('CLI：默认不覆盖手工维护的内容包（防误覆盖护栏），原文件一个字节都不动', () => {
  const handWritten = tmpFile('hand-pack.json');
  const original = '{\n  "format": 1,\n  "meta": { "name": "手工维护的包", "version": "1.0.0" },\n  "events": []\n}\n';
  writeFileSync(handWritten, original, 'utf8');
  const run = runTool('--out', handWritten);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(handWritten, 'utf8'), original, '手工包不能被覆盖');
  assert.match(run.stderr, /手工维护的内容包/);
  assert.match(run.stderr, /--force/);

  const forced = runTool('--out', handWritten, '--force', '--only', 'items', '--quiet');
  assert.equal(forced.status, 0, forced.stderr);
  const overwritten = JSON.parse(readFileSync(handWritten, 'utf8'));
  assert.equal(overwritten.items.length > 0, true);
  assert.ok(overwritten.meta.note.includes('build-content-pack.mjs'));
});

test('CLI：--pack 原地规范化是幂等的（第二次一个字节都不变）', () => {
  const copy = tmpFile('official-copy.json');
  copyFileSync(fileURLToPath(new URL('../web/content/official-pack.json', import.meta.url)), copy);
  const first = runTool('--pack', copy, '--out', copy, '--quiet');
  assert.equal(first.status, 0, first.stderr);
  const afterFirst = readFileSync(copy);
  const second = runTool('--pack', copy, '--out', copy, '--quiet');
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(readFileSync(copy), afterFirst);
  const pack = JSON.parse(afterFirst.toString('utf8'));
  assert.equal(pack.events.length, 2);
  assert.deepEqual(validatePack(pack, baselineContext).errors, []);
});

test('CLI：--diff 打印"改了什么"，并且不再把整包 JSON 打到 stdout', () => {
  const run = runTool('--pack', fileURLToPath(new URL('../web/content/demo-update.json', import.meta.url)), '--diff', fileURLToPath(new URL('../web/content/official-pack.json', import.meta.url)));
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /内容包差异（旧 → 新）/);
  assert.match(run.stdout, /新增 1 · 修改 1 · 删除 0/);
  assert.match(run.stdout, /＋ pack_radio_dedication/);
  assert.match(run.stdout, /～ pack_rain_library/);
  assert.match(run.stdout, /weight/);
  assert.match(run.stdout, /balance\.eff\.gainScale 0\.82 → 0\.88/);
  assert.ok(!run.stdout.includes('"events": ['), '--diff 模式下 stdout 只放差异报告');
});

test('CLI：--json 输出机器可读的摘要，--help 自解释，读不到文件时退出码 2', () => {
  const out = tmpFile('json.json');
  const run = runTool('--out', out, '--only', 'items', '--json', '--name', 'JSON Summary');
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.mode, 'build');
  assert.equal(payload.summary.name, 'JSON Summary');
  assert.equal(payload.validation.ok, true);
  assert.ok(payload.summary.counts.items > 0);
  assert.match(payload.sha1, /^[0-9a-f]{40}$/);
  assert.equal(payload.file.endsWith('json.json'), true);

  const help = runTool('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--out/);
  assert.match(help.stdout, /--diff/);

  const missing = runTool('--pack', tmpFile('not-there.json'));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /不存在/);
});

test('CLI：不带 --out 时把内容包 JSON 打到 stdout，摘要走 stderr（管道干净）', () => {
  const run = runTool('--only', 'items', '--name', 'Pipe Test');
  assert.equal(run.status, 0, run.stderr);
  const pack = JSON.parse(run.stdout);
  assert.equal(pack.meta.name, 'Pipe Test');
  assert.ok(pack.items.length > 0);
  assert.deepEqual(pack.events, []);
  assert.match(run.stderr, /内容包：Pipe Test/);
});
