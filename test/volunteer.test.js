/**
 * v2.6 新玩法的测试：高考志愿填报（终局）+ 因果链事件 + 内容包热更新。
 *
 * 这三件事的共同点是"跨阶段"：志愿发生在高考之后、链要等几周、内容包会动全局数组。
 * 所以这里刻意按"整局跑一遍"的方式测，而不是只调单个函数。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ALL_EVENTS,
  DIFFICULTY,
  EFF,
  EVENT_MAP,
  GAME_VERSION,
  ITEMS,
  TRAITS,
  VOLUNTEER_SLOTS,
  applyContentPack,
  autoFillVolunteers,
  contentStatus,
  createGame,
  deserialize,
  endingCatalog,
  listActions,
  nextExamInfo,
  pendingChains,
  performAction,
  playWeek,
  resetContent,
  serialize,
  submitVolunteers,
  viewState,
  volunteerState,
} from '../src/engine.js';
import { MAJORS, MAJOR_MAP, levelFor, resolveVolunteers } from '../src/data/colleges.js';
import { COLLEGE_TIERS } from '../src/data/school.js';
import { getStrategy } from '../src/strategies.js';

/**
 * 一直打到"分数出来了"（志愿填报阶段），自动对局不要替我们填。
 *
 * 走这一路的局要避开**特殊路线**（保送 / 强基 / 体育 / 艺考 / 综评 / 传媒 / 出国 /
 * 恋爱 / 友情 / 创业）——那些结局不经过志愿填报。所以每周把它们的触发条件按下去，
 * 让这一局老老实实走"普通高考 → 填志愿"这条主线。
 */
function playToVolunteer(options = {}) {
  const game = createGame({ seed: 'vol-test', difficulty: 'easy', weeksPerSemester: 3, ...options });
  const strategy = getStrategy(options.strategy ?? 'diligent');
  let guard = 0;
  while (game.status === 'playing' && guard < 400) {
    guard += 1;
    suppressSpecialRoutes(game);
    playWeek(game, strategy, { autoVolunteer: false });
  }
  return game;
}

/** 把"特殊结局"的触发条件按下去（只用于测试里走主线）。 */
function suppressSpecialRoutes(game) {
  for (const flag of ['published', 'zonghe', 'artTrack', 'sportsTeam', 'qiangji', 'contestProv1', 'earlyLove', 'scamAvoided']) {
    delete game.flags[flag];
  }
  // 因果链的"后续环"里写着结局，走主线测试时先把排着的链清掉
  game.chains = [];
  game.stats.money = 400;
  game.stats.comprehensive = 8;
  game.stats.physique = 50;
  game.stats.mood = 80;
  game.stats.discipline = 0; // 别让"摆烂"这种策略把违纪刷到 120 提前劝退
  game.stats.fatigue = 20;
  game.npc.deskmate = 40;
  game.npc.love = 0;
}

/* ------------------------------------------------------------ 志愿填报 */

test('高考之后进入志愿填报，而不是直接散场', () => {
  const game = playToVolunteer();
  assert.equal(game.status, 'volunteering');
  const state = volunteerState(game);
  assert.ok(state, '应该有志愿表');
  assert.equal(state.active, true);
  assert.equal(state.submitted, false);
  assert.equal(state.slots, VOLUNTEER_SLOTS);
  assert.ok(state.total > 0, '应该有高考总分');
  assert.ok(state.rank > 0);
  assert.ok(state.rumor.length > 5, '应该有今年的分数线风声');
  assert.ok(state.options.length >= 8, `志愿表太小了：${state.options.length}`);
  for (const option of state.options) {
    assert.ok(['冲', '稳', '保'].includes(option.level), `档次不对：${option.level}`);
    assert.ok(option.school && option.majorName);
    assert.ok(Number.isFinite(option.minScore));
    assert.ok(MAJOR_MAP[option.major], `专业 id 不在池子里：${option.major}`);
  }
  // 界面靠这个字段画灰掉的卡片
  assert.ok(state.options.some((option) => option.require), '至少要有一个带单科要求的专业组');
});

test('志愿填报阶段不能再做别的事，只能填志愿', () => {
  const game = playToVolunteer();
  assert.throws(() => performAction(game, 'listen'), /填志愿|playing/);
});

test('平行志愿：按顺序检索，够线即投，后面的志愿不再看', () => {
  const game = playToVolunteer();
  const state = volunteerState(game);
  // 把最有把握的放第一志愿，它应该中
  const easiest = state.options.slice().sort((a, b) => a.minScore - b.minScore)[0];
  const others = state.options.filter((option) => option.id !== easiest.id).slice(0, 5);
  const result = submitVolunteers(game, [easiest.id, ...others.map((option) => option.id)], { adjust: false });
  assert.equal(game.status, 'ended');
  assert.equal(game.ending.volunteer.round, 1, '第一志愿就该中');
  assert.equal(game.ending.volunteer.slip, false);
  assert.ok(result.lines.length > 0);
});

test('单科不达标的志愿会作废（偏科在终局要还的债）', () => {
  const game = playToVolunteer();
  const state = volunteerState(game);
  const gated = state.options.find((option) => option.require);
  assert.ok(gated);
  // 直接把那一科按到要求以下，然后只填这一个志愿
  game.volunteer.subjects[gated.require.subject] = gated.require.min - 1;
  submitVolunteers(game, [gated.id], { adjust: false });
  const lines = game.volunteer.lines.join('\n');
  assert.match(lines, /不符合报考条件/, '应该明确说这个志愿作废');
  assert.notEqual(game.ending.volunteer.school, gated.school);
});

test('六个志愿全滑档：不服从调剂就是落榜', () => {
  const game = playToVolunteer();
  const state = volunteerState(game);
  const hardest = state.options.slice().sort((a, b) => b.minScore - a.minScore).slice(0, 6);
  // 确保这六个都够不着
  for (const option of hardest) option.minScore = state.total + 50;
  const result = submitVolunteers(game, hardest.map((option) => option.id), { adjust: false });
  assert.equal(game.status, 'ended');
  assert.equal(game.ending.id, 'slip');
  assert.equal(game.ending.volunteer.slip, true);
  assert.match(result.lines.join('\n'), /滑档/);
  // 分数照旧记在结局里：分数够、志愿填崩了，这种结局才有戏剧性
  assert.equal(game.ending.total, state.total);
});

test('服从调剂：全滑档时还能被捞进一个没填过的专业', () => {
  const game = playToVolunteer();
  const state = volunteerState(game);
  const picks = state.options
    .slice()
    .sort((a, b) => b.minScore - a.minScore)
    .slice(0, 6)
    .map((option) => option.id);
  for (const option of state.options) if (picks.includes(option.id)) option.minScore = state.total + 40;
  submitVolunteers(game, picks, { adjust: true });
  assert.equal(game.status, 'ended');
  const detail = game.ending.volunteer;
  if (!detail.slip) {
    assert.equal(detail.adjusted, true);
    assert.equal(detail.round, 0, '调剂不算第几志愿');
    assert.match(game.ending.text, /调剂/);
  }
});

test('志愿表可以存档，读回来接着填', () => {
  const game = playToVolunteer();
  const back = deserialize(serialize(game));
  assert.equal(back.status, 'volunteering');
  const state = volunteerState(back);
  assert.ok(state.options.length > 0);
  const picks = autoFillVolunteers(back, 'safe').picks;
  assert.equal(picks.length, VOLUNTEER_SLOTS);
  submitVolunteers(back, picks, { adjust: true });
  assert.equal(back.status, 'ended');
  assert.ok(back.ending.volunteer);
});

test('关掉志愿填报就退回"按分数直接录取"的老路径', () => {
  const game = playToVolunteer({ volunteers: false });
  assert.equal(game.status, 'ended');
  assert.equal(game.volunteer, null);
  assert.match(game.ending.id, /^college:/);
  assert.equal(game.ending.volunteer, undefined);
});

test('自动对局会自己把志愿填掉（脚本不会卡在 volunteering）', () => {
  const game = createGame({ seed: 'vol-auto', difficulty: 'easy', weeksPerSemester: 3 });
  let guard = 0;
  while (game.status === 'playing' && guard < 400) {
    guard += 1;
    playWeek(game, getStrategy('balanced'));
  }
  assert.equal(game.status, 'ended');
  assert.ok(game.ending.volunteer, '自动填的志愿也应该有录取结果');
  assert.equal(game.volunteer.submitted, true);
});

test('三种自动填法各有倾向：梭哈 / 稳妥 / 均衡', () => {
  const game = playToVolunteer();
  const gamble = autoFillVolunteers(game, 'gamble');
  const safe = autoFillVolunteers(game, 'safe');
  assert.equal(gamble.picks.length, VOLUNTEER_SLOTS);
  assert.equal(safe.picks.length, VOLUNTEER_SLOTS);
  const state = volunteerState(game);
  const levelOf = (id) => state.options.find((option) => option.id === id)?.level;
  const countLevel = (picks, level) => picks.filter((id) => levelOf(id) === level).length;
  assert.ok(countLevel(safe.picks, '保') >= countLevel(gamble.picks, '保'), '稳妥填法应该更多"保"');
  assert.ok(gamble.adjust !== safe.adjust || countLevel(gamble.picks, '冲') >= countLevel(safe.picks, '冲'));
});

test('档次的划分符合直觉（压线 = 冲）', () => {
  assert.equal(levelFor(30), '保');
  assert.equal(levelFor(10), '稳');
  assert.equal(levelFor(0), '冲', '正好压在线上也算赌：分数线一涨就滑档');
  assert.equal(levelFor(-1), '冲');
});

test('投档是纯函数：同一张表同一组志愿，结果可复现', () => {
  const record = { total: 560, rank: 300, subjects: { chinese: 100, math: 110, english: 100, physics: 80, chemistry: 85, biology: 85 } };
  const options = [
    { id: 'a', school: 'A', majorName: '计算机类', major: 'jisuanji', minScore: 600, level: '冲', require: null },
    { id: 'b', school: 'B', majorName: '机械类', major: 'jixie', minScore: 540, level: '稳', require: null },
    { id: 'c', school: 'C', majorName: '英语', major: 'yingyu', minScore: 500, level: '保', require: { subject: 'english', min: 110, label: '英语 ≥ 110' } },
  ];
  const first = resolveVolunteers(record, options, ['a', 'b', 'c'], false);
  const second = resolveVolunteers(record, options, ['a', 'b', 'c'], false);
  assert.deepEqual(first.admitted.id, second.admitted.id);
  assert.equal(first.admitted.id, 'b', 'a 够不着，b 够');
  assert.equal(first.round, 2);
  // c 单科不达标，但排在 b 后面，所以根本没轮到它
  assert.equal(first.rejected.length, 1);
});

test('不存在的高考分数也有一条兜底的路（滑档 + 征集志愿）', () => {
  const record = { total: 200, rank: 990, subjects: { chinese: 40, math: 30, english: 30, physics: 20, chemistry: 20, biology: 20 } };
  const options = [{ id: 'x', school: 'X', majorName: '计算机类', major: 'jisuanji', minScore: 380, level: '冲', require: null }];
  const result = resolveVolunteers(record, options, ['x'], true);
  assert.equal(result.slip, true);
  assert.equal(result.admitted, null);
});

test('志愿填报会留下成就（第一志愿 / 压线 / 调剂 / 滑档）', () => {
  const game = playToVolunteer();
  const state = volunteerState(game);
  const easiest = state.options.slice().sort((a, b) => a.minScore - b.minScore)[0];
  submitVolunteers(game, [easiest.id], { adjust: false });
  const names = (game.ending.achievements ?? []).map((item) => item.name);
  assert.ok(names.includes('第一志愿录取'), `缺少成就（实际：${names.join('、')}）`);
  assert.ok(names.includes('志愿表没白填'));
  assert.ok(names.includes('研究过招生计划'));
});

test('志愿阶段结束后不能再提交一次', () => {
  const game = playToVolunteer();
  const picks = autoFillVolunteers(game, 'balanced').picks;
  submitVolunteers(game, picks, { adjust: true });
  assert.throws(() => submitVolunteers(game, picks, { adjust: true }), /不是填志愿的时候/);
});

test('没有志愿阶段时 volunteerState 返回 null', () => {
  const game = createGame({ seed: 'vol-none', volunteers: false });
  assert.equal(volunteerState(game), null);
  assert.equal(viewState(game).volunteer, null);
});

test('特殊路线（体育单招）不经过志愿填报', () => {
  // 一学期 6 周：摆烂策略的分数会落在体育单招要求的 200~560 区间里
  const game = createGame({ seed: 'vol-special', difficulty: 'normal', weeksPerSemester: 6, volunteers: true });
  const strategy = getStrategy('slacker');
  let guard = 0;
  while (game.status === 'playing' && guard < 400) {
    guard += 1;
    suppressSpecialRoutes(game);
    // 高考那一周把"校队 + 体质"两个条件补上，确保走特殊路线（它排在志愿填报前面）
    const info = nextExamInfo(game);
    if (info?.kind === 'gaokao' && info.inWeeks === 0) {
      game.flags.sportsTeam = true;
      game.stats.physique = 100;
    }
    // skipEvents：这条测试只测"特殊路线的判定与志愿流程"，随机事件不参与——
    // 否则每加一批新内容，随机流一变（比如弹了"网咖赛"这种带结局的事件）就会把它打红
    playWeek(game, strategy, { autoVolunteer: false, skipEvents: true });
  }
  assert.equal(game.status, 'ended');
  assert.equal(game.ending.id, 'sports', `应该走体育单招，实际是 ${game.ending.id}`);
  assert.equal(game.volunteer, null, '特殊路线不需要填志愿');
  assert.equal(game.ending.volunteer, undefined);
});

test('分数线有年度波动：同一个分数在不同年份命运不同', () => {
  const shifts = [];
  for (let i = 0; i < 8; i += 1) {
    const game = playToVolunteer({ seed: `vol-shift-${i}` });
    shifts.push(volunteerState(game).shift);
  }
  assert.ok(new Set(shifts).size > 1, '每年的分数线应该不一样（不然冲稳保就是看图做题）');
  assert.ok(shifts.some((shift) => shift > 0) || shifts.some((shift) => shift < 0), '应该有涨有跌');
});

test('志愿表里的专业池自洽', () => {
  const ids = new Set();
  for (const major of MAJORS) {
    assert.ok(major.id && major.name && major.icon, `专业字段不全：${JSON.stringify(major)}`);
    assert.ok(!ids.has(major.id), `专业 id 重复：${major.id}`);
    ids.add(major.id);
    assert.ok(Number.isFinite(major.heat));
    if (major.require) {
      assert.ok(major.require.subject && Number.isFinite(major.require.min), `单科要求不合法：${major.id}`);
    }
  }
  // 结局图鉴里要有滑档
  assert.ok(endingCatalog().some((entry) => entry.id === 'slip'));
  assert.ok(COLLEGE_TIERS.length >= 8);
});

/* ------------------------------------------------------------ 毕业去向 */

test('因果链的"毕业去向"：不当场结束这一局，而是在高考之后结算', () => {
  // 如果它在高三上就把一局掐断，玩家连高考都考不成——三年的主线被一个随机事件吃掉
  const game = createGame({ seed: 'grad-ending', difficulty: 'normal', weeksPerSemester: 6, volunteers: true });
  const strategy = getStrategy('balanced');
  let guard = 0;
  let sawGaokao = false;
  while (game.status === 'playing' && guard < 400) {
    guard += 1;
    suppressSpecialRoutes(game);
    // 把知识按住，让这一局的高考成绩落在"创业结局"的口径里（436 分以下）
    for (const key of game.subjectKeys) game.knowledge[key] = 8;
    game.flags.graduationEnding = 'startup';
    playWeek(game, strategy, { autoVolunteer: false });
    if (game.exams.some((exam) => exam.kind === 'gaokao')) sawGaokao = true;
  }
  assert.equal(sawGaokao, true, '埋了毕业去向也得先把高考考完');
  assert.equal(game.status, 'ended');
  assert.equal(game.ending.id, 'startup');
  assert.equal(game.ending.chainEnding, true);
  assert.ok(game.ending.total > 0, '结局里仍然要带上高考分数');
  assert.equal(game.volunteer, null, '去向已经定了，就不用再填志愿');
});

test('分数够高时，毕业去向不会把"考上好大学"顶掉', () => {
  const game = createGame({ seed: 'grad-cap', difficulty: 'easy', weeksPerSemester: 6, volunteers: true });
  const strategy = getStrategy('diligent');
  let guard = 0;
  while (game.status === 'playing' && guard < 400) {
    guard += 1;
    suppressSpecialRoutes(game);
    // startup 的口径是 436 分以下；这一局是高分，所以它应该让位给志愿填报
    game.flags.graduationEnding = 'startup';
    playWeek(game, strategy, { autoVolunteer: false });
  }
  assert.equal(game.status, 'volunteering', '分数高就该去填志愿，而不是被"创业"截胡');
  assert.notEqual(game.ending?.id, 'startup');
});

/* ------------------------------------------------------------ 因果链 */

test('因果链：一次选择会在几周后回来找你', () => {
  const pack = {
    format: 1,
    meta: { name: '链式测试包' },
    events: [
      {
        id: 'pack_chain_first',
        name: '内容包第一环',
        icon: '🧪',
        kind: 'auto',
        weight: 9,
        text: '第一环',
        effect: { stats: { mood: 1 }, chain: { id: 'pack_chain_second', delay: 2 } },
      },
      { id: 'pack_chain_second', name: '内容包第二环', icon: '🧪', kind: 'auto', weight: 9, chainOnly: true, text: '第二环' },
    ],
  };
  const applied = applyContentPack(pack);
  assert.equal(applied.ok, true);
  try {
    const game = createGame({ seed: 'chain-test' });
    game.flags.scriptedEvent = 'pack_chain_first';
    performAction(game, 'listen');
    assert.equal(game.chains.length, 1, '第一环应该排上一条链');
    const pending = pendingChains(game);
    assert.equal(pending[0].id, 'pack_chain_second');
    assert.equal(pending[0].name, '内容包第二环');
    assert.ok(pending[0].inTurns <= 2);

    // 走几周，第二环一定会弹出来（不受概率影响）
    let fired = false;
    for (let i = 0; i < 12 && !fired; i += 1) {
      playWeek(game, () => ({ actionId: 'listen' }), { autoVolunteer: false });
      fired = game.log.some((entry) => entry.title?.includes('内容包第二环'));
    }
    assert.ok(fired, '链式事件没有按约定弹出来');
    assert.equal(
      game.chains.filter((entry) => entry.id === 'pack_chain_second').length,
      0,
      '弹过之后要从队列里移除',
    );
  } finally {
    resetContent();
  }
});

test('链式事件不进随机池（chainOnly）', () => {
  const pack = {
    format: 1,
    meta: { name: '链式过滤包' },
    events: [{ id: 'pack_chain_only', name: '只该被链出来', icon: '🧪', kind: 'auto', weight: 99, chainOnly: true, text: 'x' }],
  };
  assert.equal(applyContentPack(pack).ok, true);
  try {
    assert.ok(EVENT_MAP.pack_chain_only, '链式事件要在事件表里（不然找不到）');
    const game = createGame({ seed: 'chain-filter' });
    let seen = false;
    for (let i = 0; i < 200 && game.status === 'playing'; i += 1) {
      playWeek(game, () => ({ actionId: 'listen' }), { autoVolunteer: false });
      if (game.log.some((entry) => entry.title?.includes('只该被链出来'))) seen = true;
    }
    assert.equal(seen, false, 'chainOnly 的事件不该被随机抽到');
  } finally {
    resetContent();
  }
});

test('内容被撤掉之后，排着的链会被安静丢掉，不会把游戏卡死', () => {
  const pack = {
    format: 1,
    meta: { name: '孤儿链包' },
    events: [
      { id: 'pack_orphan_a', name: 'A', icon: '🧪', kind: 'auto', weight: 9, text: 'a', effect: { chain: { id: 'pack_orphan_b', delay: 1 } } },
      { id: 'pack_orphan_b', name: 'B', icon: '🧪', kind: 'auto', weight: 9, chainOnly: true, text: 'b' },
    ],
  };
  applyContentPack(pack);
  const game = createGame({ seed: 'chain-orphan' });
  game.flags.scriptedEvent = 'pack_orphan_a';
  performAction(game, 'listen');
  assert.equal(game.chains.length, 1);
  // 内容包被撤掉（模拟玩家点了"恢复官方内容"）
  resetContent();
  for (let i = 0; i < 6; i += 1) playWeek(game, () => ({ actionId: 'listen' }), { autoVolunteer: false });
  assert.equal(
    game.chains.filter((entry) => entry.id === 'pack_orphan_b').length,
    0,
    '找不到的事件应该被丢掉',
  );
});

/* ------------------------------------------------------------ 内容包（引擎侧） */

test('内容包：同 id 覆盖、新 id 追加，而且引用不变（原地改写）', () => {
  const before = ALL_EVENTS.length;
  const sameRef = ALL_EVENTS;
  const newTrait = { id: 'pack_trait_test', name: '内容包天赋', icon: '🧪', desc: '测试用', mods: { startMood: 4 } };
  const newItem = { id: 'pack_item_test', name: '内容包道具', icon: '🧪', price: 100, desc: '测试用', effect: { stats: { mood: 1 } } };
  const result = applyContentPack({
    format: 1,
    meta: { name: '引擎侧内容包' },
    events: [{ id: 'pack_evt_test', name: '内容包事件', icon: '🧪', kind: 'auto', weight: 9, text: '来自内容包', effect: { stats: { mood: 2 } } }],
    items: [newItem],
    traits: [newTrait],
    balance: { eff: { gainScale: 0.9 }, difficulty: { normal: { forgetScale: 0.5 } } },
  });
  assert.equal(result.ok, true);
  try {
    assert.equal(ALL_EVENTS.length, before + 1);
    assert.equal(ALL_EVENTS, sameRef, '数组引用必须保持不变（别处已经 import 了它）');
    assert.ok(EVENT_MAP.pack_evt_test);
    assert.ok(ITEMS.some((item) => item.id === 'pack_item_test'));
    assert.ok(TRAITS.some((trait) => trait.id === 'pack_trait_test'));
    assert.equal(EFF.gainScale, 0.9);
    assert.equal(DIFFICULTY.normal.forgetScale, 0.5);

    // 覆盖已有事件：id 不变、内容换掉
    const target = ALL_EVENTS.find((event) => !event.story && !event.chainOnly);
    applyContentPack({ format: 1, meta: { name: '覆盖包' }, events: [{ id: target.id, name: '被改过的名字', icon: '🧪', kind: 'auto', weight: 9, text: '换过的正文' }] });
    assert.equal(EVENT_MAP[target.id].name, '被改过的名字');
    /*
     * 重要语义：**同一时间只生效一个内容包**。
     * 新包是基于"内置基线"合并的，所以上一个包加进来的事件会消失——
     * 这样才不会出现"连打三个包之后没人知道现在是什么状态"。
     */
    assert.equal(ALL_EVENTS.length, before, '换包之后应该回到"基线 + 新包"的内容量');
    assert.equal(EVENT_MAP.pack_evt_test, undefined, '上一个包加的事件应该已经撤掉');
  } finally {
    resetContent();
  }
  assert.equal(ALL_EVENTS.length, before);
  assert.equal(EFF.gainScale, 0.78);
  assert.equal(DIFFICULTY.normal.forgetScale, 1);
  assert.equal(contentStatus().active, false);
});

test('内容包：格式不对 / 事件缺字段 / 版本不满足 会被拒掉', () => {
  assert.equal(applyContentPack({ format: 99, meta: { name: 'x' } }).ok, false);
  const bad = applyContentPack({ format: 1, meta: { name: 'x' }, events: [{ id: 'bad_evt', kind: 'choice', choices: [] }] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((text) => /缺少字段 name/.test(text)), bad.errors.join('；'));
  assert.ok(bad.errors.some((text) => /必须带 choices/.test(text)));
  const future = applyContentPack({ format: 1, meta: { name: 'x' }, requires: { app: '>=99.0.0' }, events: [] });
  assert.equal(future.ok, false);
  assert.ok(future.errors.some((text) => /游戏版本/.test(text)));
  assert.equal(contentStatus().active, false, '校验失败不该留下半个包');
});

test('内容包可以改行动文案，但不能新增行动', () => {
  const patch = applyContentPack({ format: 1, meta: { name: '文案包' }, actions: [{ id: 'listen', desc: '换过的说明' }] });
  assert.equal(patch.ok, true);
  try {
    const game = createGame({ seed: 'action-text' });
    const listen = listActions(game, 'main').find((action) => action.id === 'listen');
    assert.equal(listen.desc, '换过的说明');
    const rejected = applyContentPack({ format: 1, meta: { name: '坏包' }, actions: [{ id: '不存在的行动', desc: 'x' }] });
    assert.equal(rejected.ok, false);
    assert.ok(rejected.errors.some((text) => /只能改文案/.test(text)));
  } finally {
    resetContent();
  }
});

test('版本号只有一份真源：GAME_VERSION 与 package.json 必须一致', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(GAME_VERSION, pkg.version, 'engine 的 GAME_VERSION 和 package.json 对不上（内容包的版本约束会失效）');
});
