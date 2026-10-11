/**
 * 续玩钩子账本 / 上一次的你：纯函数单测。
 *
 * 这一份测试真正想钉住的是三件"以后很容易被改坏"的事：
 *   1. **预告必须逐字来自引擎**：`resumeCard()` 不许自己写一句更像钩子的文案；
 *   2. **不做催玩**：续玩卡的自有文案里不许出现天/小时/仅剩这类词，
 *      模块源码里也不许出现 `Date`（结构上就写不出倒计时）；
 *   3. **不编数据**：老档案没有 `difficulty` 时不许说出「同难度」，
 *      结局线索必须逐字来自结局目录的 `hint`。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CHARACTER_PRESETS } from '../src/data/character.js';
import { endingCatalog } from '../src/engine.js';
import {
  HOOK_FORMAT,
  HOOK_KEY,
  buildHook,
  clearHook,
  leadToDraft,
  nearestUndiscovered,
  readHook,
  resumeCard,
  selfCompare,
  writeHook,
} from '../web/recap.js';

const recapSource = readFileSync(new URL('../web/recap.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

/** 一个只活在内存里的 localStorage 替身。 */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    size: () => map.size,
  };
}

/** 一份"玩到高二上学期第 9 周"的 view 快照（只保留 recap 用得到的字段）。 */
function playingView(overrides = {}) {
  return {
    status: 'playing',
    turn: 8,
    week: 9,
    totalWeeks: 36,
    weeksLeft: 28,
    calendarLabel: '高二上学期 第 9 周',
    phaseLabel: '本周主行动',
    semesterName: '高二上学期',
    estimateTotal: 604,
    student: { name: '林知远', className: '高一(3)班' },
    difficulty: { key: 'normal', name: '正常' },
    selection: { label: '物理 · 化学+生物' },
    teaser: { icon: '📝', text: '高三第一次月考还有 1 周。这周投入多少，会直接写在卷子上。', tone: 'exam' },
    ending: null,
    // 这些是"很大但界面不念"的字段，白名单测试会盯着它们不许被搬进账本
    log: [{ at: '高二上学期 第 9 周', title: '刷题', text: '一整个晚自习。' }],
    actions: [{ id: 'study', name: '刷题' }],
    exams: [{ name: '月考', total: 588 }],
    ...overrides,
  };
}

const MID_RUN_HOOK = buildHook(playingView());

/* --------------------------------------------------- 账本：buildHook / readHook */

test('buildHook 只带白名单字段（log / actions / exams 一个字都不进来）', () => {
  const hook = buildHook(playingView({ log: [{ title: '唯一标记串-LOG' }], actions: [{ name: '唯一标记串-ACTION' }] }));
  assert.ok(hook, '正常 view 应该能构建出账本');
  assert.equal(hook.format, HOOK_FORMAT);
  assert.equal(hook.status, 'playing');
  assert.equal(hook.turn, 8);
  assert.equal(hook.week, 9);
  assert.equal(hook.weeksLeft, 28);
  assert.equal(hook.estimateTotal, 604);
  assert.deepEqual(hook.student, { name: '林知远', className: '高一(3)班' });
  assert.deepEqual(hook.teaser, {
    icon: '📝',
    text: '高三第一次月考还有 1 周。这周投入多少，会直接写在卷子上。',
    tone: 'exam',
  });

  const serialized = JSON.stringify(hook);
  assert.ok(!serialized.includes('唯一标记串'), '白名单之外的字段被搬进账本了');
  assert.ok(!('log' in hook) && !('actions' in hook) && !('exams' in hook));
  assert.ok(serialized.length < 700, `账本应该很小，实际 ${serialized.length} 字节`);
});

test('buildHook 对无关状态和垃圾输入返回 null', () => {
  assert.equal(buildHook(null), null);
  assert.equal(buildHook('nope'), null);
  assert.equal(buildHook(playingView({ status: 'idle' })), null);
  assert.equal(buildHook(playingView({ status: undefined })), null);
  assert.equal(buildHook({ status: 'playing' }).status, 'playing', '字段缺失也应该能降级构建，而不是抛');
});

test('buildHook 把「填志愿」也算作这一局还在（可以续玩）', () => {
  const hook = buildHook(playingView({ status: 'volunteering', teaser: null }));
  assert.equal(hook.status, 'playing');
  assert.equal(hook.teaser, null);
});

test('buildHook 在结局时记下结局，但预告仍然是引擎原文', () => {
  const hook = buildHook(
    playingView({
      status: 'ended',
      ending: { id: 'college:cudu', title: '年级前十', total: 636 },
    }),
  );
  assert.equal(hook.status, 'ended');
  assert.deepEqual(hook.ending, { id: 'college:cudu', title: '年级前十', total: 636 });
});

test('readHook：坏 JSON / 空串 / 认不出的格式一律 null，且不抛', () => {
  assert.equal(readHook('{坏的'), null);
  assert.equal(readHook(''), null);
  assert.equal(readHook('   '), null);
  assert.equal(readHook('null'), null);
  assert.equal(readHook('[]'), null);
  assert.equal(readHook('"字符串"'), null);
  assert.equal(readHook(undefined), null);
  assert.equal(readHook(123), null);
  assert.equal(readHook({ format: 999, status: 'playing' }), null, '格式号不认识就当没有');
  assert.equal(readHook({ format: HOOK_FORMAT, status: 'weird' }), null);
});

test('readHook：JSON 合法但字段是垃圾时逐项降级，不整条崩掉', () => {
  const hook = readHook(
    JSON.stringify({
      format: HOOK_FORMAT,
      status: 'playing',
      turn: 'abc',
      week: -5,
      totalWeeks: 36,
      weeksLeft: 9999,
      calendarLabel: 42,
      estimateTotal: '不是数',
      student: '不是对象',
      difficulty: { key: 'normal' },
      teaser: { icon: 7, text: '  有正文  ', tone: '不存在的语气' },
      ending: { id: '' },
    }),
  );
  assert.ok(hook);
  assert.equal(hook.turn, 0);
  assert.equal(hook.week, 1, '周次至少是第 1 周');
  assert.equal(hook.weeksLeft, 9999);
  assert.equal(hook.calendarLabel, '');
  assert.equal(hook.estimateTotal, null);
  assert.deepEqual(hook.student, { name: '', className: '' });
  assert.deepEqual(hook.difficulty, { key: 'normal', name: '' });
  assert.equal(hook.teaser.text, '有正文', '正文两端空白会被收掉');
  assert.equal(hook.teaser.tone, 'calm', '不认识的语气退回 calm');
  assert.equal(hook.ending, null, '没有 id 的结局不算结局');
});

test('readHook：手改过的垃圾 teaser 直接丢掉，不影响其它字段', () => {
  const hook = readHook(JSON.stringify({ format: HOOK_FORMAT, status: 'playing', teaser: { text: '' } }));
  assert.equal(hook.teaser, null);
  const hook2 = readHook(JSON.stringify({ format: HOOK_FORMAT, status: 'playing', teaser: '段落' }));
  assert.equal(hook2.teaser, null);
});

test('writeHook / clearHook：能落能读能清，存不下也不抛', () => {
  const storage = fakeStorage();
  assert.equal(writeHook(MID_RUN_HOOK, storage), true);
  const roundTrip = readHook(storage.getItem(HOOK_KEY));
  assert.equal(roundTrip.turn, 8);
  assert.equal(roundTrip.teaser.text, MID_RUN_HOOK.teaser.text);

  assert.equal(clearHook(storage), true);
  assert.equal(storage.getItem(HOOK_KEY), null);
  assert.equal(readHook(storage.getItem(HOOK_KEY)), null, '清掉之后读回来就是"没有钩子"');

  assert.equal(writeHook(null, storage), false, '空钩子不写');
  const angry = {
    setItem() {
      throw new Error('配额满了');
    },
    removeItem() {
      throw new Error('存储被禁');
    },
  };
  assert.doesNotThrow(() => writeHook(MID_RUN_HOOK, angry));
  assert.equal(writeHook(MID_RUN_HOOK, angry), false);
  assert.doesNotThrow(() => clearHook(angry));
  assert.equal(clearHook(angry), false);
});

test('app.js 与 recap.js 用的是同一个存储键', () => {
  assert.equal(HOOK_KEY, 'mas2z-hook-v1');
  assert.match(appSource, /HOOK_KEY = 'mas2z-hook-v1'/, 'app.js 里的键名必须和 recap.js 一致（CHANGELOG 也要写对）');
});

/* --------------------------------------------------- 续玩卡：resumeCard */

test('resumeCard：第一局的人看不到任何多余的卡', () => {
  const card = resumeCard({ hook: null, profile: { runs: 0, history: [] }, catalog: endingCatalog(), hasSave: false });
  assert.equal(card.mode, 'fresh');
  assert.equal(card.title, '');
  assert.deepEqual(card.lines, []);
  assert.equal(card.primary, null);
  assert.equal(card.secondary, null);
});

test('resumeCard：这一局还在 + 存档在 → mid-run（预告逐字念一遍）', () => {
  const card = resumeCard({
    hook: MID_RUN_HOOK,
    profile: { runs: 0, history: [], unlocked: {} },
    catalog: endingCatalog(),
    hasSave: true,
  });
  assert.equal(card.mode, 'mid-run');
  assert.equal(card.title, '⏳ 你的三年还剩 28 周');
  assert.equal(card.primary.kind, 'resume');
  assert.equal(card.primary.label, '▶ 接着上第 9 周');
  assert.equal(card.secondary.kind, 'fresh');

  const teaser = card.lines.find((line) => line.kind === 'teaser');
  assert.ok(teaser, '应该有预告行');
  assert.equal(teaser.text, '高三第一次月考还有 1 周。这周投入多少，会直接写在卷子上。', '预告必须是引擎原文');
  const meta = card.lines.find((line) => line.kind === 'meta');
  assert.match(meta.text, /高一\(3\)班/);
  assert.match(meta.text, /高二上学期 第 9 周/);
  assert.match(meta.text, /预估 604 \/ 750/);
});

test('resumeCard：预告文案逐字来自 view.teaser，且没有第二句自造的钩子', () => {
  const view = playingView({ teaser: { icon: '🧵', text: '唯一测试串', tone: 'story' } });
  const card = resumeCard({ hook: buildHook(view), profile: {}, catalog: [], hasSave: true });
  const serialized = JSON.stringify(card);
  assert.ok(serialized.includes('唯一测试串'), '卡片里必须逐字出现引擎给的预告');

  const teaserLines = card.lines.filter((line) => line.kind === 'teaser');
  assert.equal(teaserLines.length, 1, '只允许一行预告');
  assert.equal(teaserLines[0].text, '唯一测试串');
  assert.equal(teaserLines[0].icon, '🧵');
  assert.equal(teaserLines[0].tone, 'story');
});

test('resumeCard：没有存档 → orphan，绝不给出「接着上」', () => {
  const card = resumeCard({ hook: MID_RUN_HOOK, profile: {}, catalog: [], hasSave: false });
  assert.equal(card.mode, 'orphan');
  assert.notEqual(card.primary.kind, 'resume');
  assert.equal(card.primary.kind, 'fresh');
  assert.equal(card.secondary, null);
  assert.ok(!/接着上/.test(JSON.stringify(card)), '存档读不到时不该出现"接着上"');
  assert.ok(card.lines.some((line) => line.text.includes('存档读不到')));
});

test('resumeCard：账本说这一局走完了 → finished，且永远不会给 resume', () => {
  const finished = buildHook(playingView({ status: 'ended', ending: { id: 'college:cudu', title: '年级前十', total: 636 } }));
  const catalog = endingCatalog();
  const profile = {
    runs: 4,
    unlocked: { [catalog[0].id]: { count: 1 } },
    lastRun: { endingTitle: '年级前十', total: 636, memories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    history: [],
  };
  const card = resumeCard({ hook: finished, profile, catalog, hasSave: true });
  assert.equal(card.mode, 'finished');
  assert.equal(card.primary.kind, 'restart');
  assert.match(card.primary.label, /继承 3 条/);
  assert.equal(card.secondary.kind, 'gallery');
  assert.match(card.secondary.label, /图鉴 1 \/ \d+/);
  assert.equal(card.lines.find((line) => line.kind === 'teaser').lead, '走的时候留下的那一句是');
  assert.ok(!JSON.stringify(card).includes('resume'), '走完的局不许再出现 resume');
});

test('resumeCard：没有账本、但有上一局档案 → 也是 finished', () => {
  const card = resumeCard({
    hook: null,
    profile: { runs: 2, unlocked: {}, lastRun: { endingTitle: '留校察看', total: null, memories: [] } },
    catalog: [],
    hasSave: true,
  });
  assert.equal(card.mode, 'finished');
  assert.match(card.title, /上一局：留校察看/);
  assert.ok(!card.title.includes('/ 750'), '没参加高考就不该编一个分数');
  assert.equal(card.primary.label, '🔁 再来一局');
  assert.equal(card.secondary.label, '📖 看看图鉴');
});

test('resumeCard：反催玩红线——自有文案里不许有天 / 小时 / 最后 / 错过 / 仅剩', () => {
  const banned = ['天', '小时', '最后', '错过', '仅剩'];
  const cards = [
    resumeCard({ hook: MID_RUN_HOOK, profile: {}, catalog: [], hasSave: true }),
    resumeCard({ hook: MID_RUN_HOOK, profile: {}, catalog: [], hasSave: false }),
    resumeCard({
      hook: buildHook(playingView({ status: 'ended', ending: { id: 'x', title: '年级前十', total: 636 } })),
      profile: { lastRun: { endingTitle: '年级前十', total: 636, memories: [] }, unlocked: {}, runs: 1 },
      catalog: endingCatalog(),
      hasSave: true,
    }),
  ];

  for (const card of cards) {
    const own = [card.title, card.primary?.label, card.secondary?.label];
    for (const line of card.lines ?? []) {
      if (line.kind === 'teaser') continue; // 预告是引擎原文，逐字照念，不参与这条红线
      own.push(line.lead, line.text);
    }
    const text = own.filter(Boolean).join(' | ');
    for (const word of banned) {
      assert.ok(!text.includes(word), `续玩卡自有文案里出现了催促词「${word}」：${text}`);
    }
  }
});

test('recap.js 里没有时钟：结构上就写不出倒计时', () => {
  // 注释里可以讨论"为什么不用时间"，真正要盯的是代码本身
  const code = recapSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\bDate\b/.test(code), 'recap.js 不该出现 Date——续玩卡不允许有任何时间压力');
  assert.ok(!/倒计时|限时|每日|签到|setTimeout|setInterval/.test(code), '续玩钩子不该有定时器或限时口径');
});

/* --------------------------------------------------- 上一次的你：selfCompare */

test('selfCompare：第一局没有可比的人，也不显示 0', () => {
  const compare = selfCompare([], { total: 636, achievements: ['a', 'b'], difficulty: 'normal', runNumber: 1 });
  assert.equal(compare.prev, null);
  assert.equal(compare.isFirstRun, true);
  assert.equal(compare.deltaTotal, null);
  assert.equal(compare.deltaAchievements, null);
  assert.equal(compare.sameDifficulty, null);
  assert.deepEqual(compare.best, { total: 636, ordinal: 1, isCurrent: true });
});

test('selfCompare：同难度的上一次 vs 这一次（含成就差与本机最好）', () => {
  const history = [
    {
      title: '县城中学',
      endingId: 'college:yiben',
      total: 598,
      difficulty: 'normal',
      goalAchieved: false,
      achievements: ['a', 'b', 'c', 'd', 'e'],
    },
    { title: '滑档', endingId: 'slip', total: 480, difficulty: 'normal', goalAchieved: false, achievements: ['a'] },
  ];
  const compare = selfCompare(history, {
    total: 636,
    achievements: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    difficulty: 'normal',
    difficultyLabel: '正常',
    runNumber: 4,
  });

  assert.equal(compare.runNumber, 4);
  assert.equal(compare.isFirstRun, false);
  assert.deepEqual(compare.prev, {
    ordinal: 3,
    title: '县城中学',
    total: 598,
    goalAchieved: false,
    achievements: 5,
  });
  assert.equal(compare.deltaTotal, 38);
  assert.equal(compare.deltaAchievements, 2);
  assert.equal(compare.prevSameDifficulty, true);
  assert.equal(compare.sameDifficulty.rank, 1);
  assert.equal(compare.sameDifficulty.of, 3, '同难度一共三局（含这一局）');
  assert.equal(compare.sameDifficulty.label, '正常');
  assert.deepEqual(compare.best, { total: 636, ordinal: 4, isCurrent: true });
});

test('selfCompare：难度不同时不冒充同难度，但普通对比照旧（老档案不出现「同难度」）', () => {
  const oldArchive = [{ title: '县城中学', total: 598, achievements: ['a'] }]; // 老档案：没有 difficulty
  const compare = selfCompare(oldArchive, {
    total: 636,
    achievements: ['a', 'b'],
    difficulty: 'normal',
    difficultyLabel: '正常',
    runNumber: 2,
  });

  assert.equal(compare.prev.total, 598, '老档案仍然能给"上一次的你"');
  assert.equal(compare.prevSameDifficulty, false);
  assert.equal(compare.sameDifficulty, null, '没有 difficulty 就不能算同难度名次');
  assert.equal(compare.deltaTotal, 38);
  assert.ok(!JSON.stringify(compare).includes('同难度'), '输出里不许出现「同难度」这三个字');
});

test('selfCompare：全部是陈述句，不许出现评判词', () => {
  const compare = selfCompare(
    [{ title: '年级前十', total: 636, difficulty: 'normal', achievements: ['a', 'b', 'c'] }],
    { total: 480, achievements: ['a'], difficulty: 'normal', difficultyLabel: '正常', runNumber: 2 },
  );
  const serialized = JSON.stringify(compare);
  for (const word of ['退步', '失败', '不如', '可惜', '浪费']) {
    assert.ok(!serialized.includes(word), `自我对比里出现了评判词「${word}」`);
  }
  assert.equal(compare.deltaTotal, -156, '分数降了也只是报数字');
});

test('selfCompare：没参加高考的一局不参与分数比较，但成就差还在', () => {
  const compare = selfCompare(
    [{ title: '休学', total: 500, difficulty: 'normal', achievements: ['a'] }],
    { total: null, achievements: ['a', 'b'], difficulty: 'normal', difficultyLabel: '正常', runNumber: 2 },
  );
  assert.equal(compare.prev.total, 500);
  assert.equal(compare.deltaTotal, null);
  assert.equal(compare.deltaAchievements, 1);
  assert.equal(compare.sameDifficulty, null, '没有分数就没有名次');
  assert.deepEqual(compare.best, { total: 500, ordinal: 1, isCurrent: false });
});

test('selfCompare：坏输入不抛（history 里塞 null / 字符串）', () => {
  assert.doesNotThrow(() => selfCompare(null, null));
  assert.doesNotThrow(() => selfCompare([null, 'x', 3], 'nope'));
  const compare = selfCompare([null, 'x'], {});
  assert.equal(compare.prev, null);
  assert.equal(compare.best, null);
});

/* --------------------------------------------------- 差一点：nearestUndiscovered */

test('nearestUndiscovered：线索逐字来自结局目录，一个字都不自己编', () => {
  const catalog = endingCatalog();
  const profile = {
    unlocked: { 'college:top2': { count: 1 }, 'college:huawu': { count: 2 } },
    history: [{ endingId: 'college:huawu' }],
  };
  const near = nearestUndiscovered(catalog, profile, 2);
  assert.equal(near.length, 2);

  for (const item of near) {
    const source = catalog.find((entry) => entry.id === item.id);
    assert.ok(source, `返回了目录里没有的结局：${item.id}`);
    assert.equal(item.hint, source.hint, '线索必须逐字来自结局目录（防"编线索"）');
    assert.equal(item.title, source.title);
    assert.equal(item.tier, source.tier);
    assert.ok(!profile.unlocked[item.id], '已经解锁的不该再出现在「差一点」里');
  }
  // 目录里所有 hint 都是非空的（这条改动完全依赖目录自带线索）
  assert.ok(catalog.every((entry) => typeof entry.hint === 'string' && entry.hint.length > 0));
});

test('nearestUndiscovered：没有 history / 空目录 / limit=0 都能安全降级', () => {
  const catalog = endingCatalog();
  assert.equal(nearestUndiscovered([], {}, 2).length, 0);
  assert.equal(nearestUndiscovered(catalog, {}, 0).length, 0);
  assert.equal(nearestUndiscovered(null, null, 2).length, 0);
  const noArchive = nearestUndiscovered(catalog, {}, 2);
  assert.equal(noArchive.length, 2, '一条都没解锁时也应该能给出两条线索');
});

test('nearestUndiscovered：全解锁之后不再提示', () => {
  const catalog = endingCatalog();
  const unlocked = Object.fromEntries(catalog.map((entry) => [entry.id, { count: 1 }]));
  assert.deepEqual(nearestUndiscovered(catalog, { unlocked }, 2), []);
});

/* --------------------------------------------------- 线索 → 构筑：leadToDraft */

test('leadToDraft：映射到的模板都真实存在，认不出来的一律 null', () => {
  const presetIds = new Set(CHARACTER_PRESETS.map((preset) => preset.id));
  const ids = endingCatalog().map((entry) => entry.id);
  let mapped = 0;
  for (const id of ids) {
    const lead = leadToDraft(id);
    if (!lead) continue;
    mapped += 1;
    assert.ok(presetIds.has(lead.preset), `${id} 映射到了不存在的模板 ${lead.preset}`);
  }
  assert.ok(mapped >= 4, `至少应该有几条结局能给出构筑建议，实际 ${mapped} 条`);

  assert.equal(leadToDraft('不存在的结局'), null);
  assert.equal(leadToDraft(''), null);
  assert.equal(leadToDraft(null), null);
  assert.equal(leadToDraft(undefined), null);
  assert.deepEqual(leadToDraft('baosong'), { preset: 'olympiad' });
  assert.deepEqual(leadToDraft('sports'), { preset: 'athlete' });
});
