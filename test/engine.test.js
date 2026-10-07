/**
 * 引擎单元测试（v2）：npm test
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_EVENTS,
  EFF,
  EVENT_MAP,
  GameError,
  SUBJECT_MAP,
  TOTAL_MAX,
  VOLUNTEER_SLOTS,
  buyItem,
  createGame,
  deserialize,
  endingCatalog,
  listActions,
  listShop,
  performAction,
  playWeek,
  resolveEvent,
  serialize,
  submitVolunteers,
  subjectsFor,
  validateSelection,
  viewState,
  volunteerState,
} from '../src/engine.js';
import { BACKGROUND_MAP, GOAL_MAP, TRAIT_MAP } from '../src/data/character.js';
import { ITEM_MAP } from '../src/data/items.js';
import { ELECTIVE_KEYS, rankFromScore } from '../src/data/school.js';
import { getStrategy } from '../src/strategies.js';

/** 把当前这一周剩下的阶段（含事件）走完。 */
function settle(game, decision = {}) {
  let guard = 0;
  while (game.pendingEvent && game.status === 'playing' && guard < 10) {
    guard += 1;
    const choiceId = (decision.chooseEvent ? decision.chooseEvent(game.pendingEvent, game) : null) ?? game.pendingEvent.choices[0].id;
    resolveEvent(game, choiceId);
  }
}

/** 让出一个周末阶段（用睡眠这类安全行动），把阶段推到 weekend。 */
function toWeekend(game) {
  performAction(game, 'listen');
  settle(game);
}

/** 自动打完整局。 */
function playFull(seed, strategyName = 'diligent', options = {}) {
  const game = createGame({ name: '测试', seed, ...options });
  const strategy = getStrategy(strategyName);
  let guard = 0;
  while (game.status === 'playing' && guard < 400) {
    guard += 1;
    playWeek(game, strategy);
  }
  return game;
}

/* ------------------------------------------------------------ 开局与选科 */

test('同一个种子生成完全相同的开局', () => {
  const a = createGame({ name: '测试', seed: 'seed-1' });
  const b = createGame({ name: '测试', seed: 'seed-1' });
  assert.deepEqual(a.stats, b.stats);
  assert.deepEqual(a.knowledge, b.knowledge);
  assert.deepEqual(a.subjectKeys, b.subjectKeys);
  assert.equal(a.rngState, b.rngState);

  const c = createGame({ name: '测试', seed: 'seed-2' });
  assert.notEqual(a.rngState, c.rngState);
});

test('3+1+2 选科：正好六科，满分 750', () => {
  const physics = createGame({ name: '测试', seed: 'sel-1', track: 'physics', electives: ['chemistry', 'biology'] });
  assert.deepEqual(physics.subjectKeys, ['chinese', 'math', 'english', 'physics', 'chemistry', 'biology']);
  assert.equal(physics.subjectKeys.length, 6);
  assert.equal(physics.subjectKeys.reduce((sum, key) => sum + SUBJECT_MAP[key].max, 0), TOTAL_MAX);

  const history = createGame({ name: '测试', seed: 'sel-2', track: 'history', electives: ['politics', 'geography'] });
  assert.deepEqual(history.subjectKeys, ['chinese', 'math', 'english', 'history', 'politics', 'geography']);
  assert.equal(history.student.track, '历史类');
});

test('非法选科会被纠正或拒绝', () => {
  assert.equal(validateSelection('physics', ['chemistry', 'biology']), null);
  assert.match(validateSelection('physics', ['chemistry']), /正好/);
  assert.match(validateSelection('physics', ['chemistry', 'chemistry']), /正好/);
  assert.match(validateSelection('physics', ['chemistry', 'physics']), /再选/);
  assert.match(validateSelection('art', ['chemistry', 'biology']), /物理或历史/);

  // 非法组合会退化成合法组合，而不是崩溃
  const game = createGame({ name: '测试', seed: 'sel-3', track: 'history', electives: ['history', 'history'] });
  assert.equal(game.subjectKeys.length, 6);
  assert.ok(game.subjectKeys.includes('history'));
});

test('subjectsFor 会自动补足缺的再选科目', () => {
  const subjects = subjectsFor('physics', []);
  assert.equal(subjects.length, 6);
  const electives = subjects.filter((subject) => ELECTIVE_KEYS.includes(subject.key));
  assert.equal(electives.length, 2);
});

/* ------------------------------------------------------------ 两段制 */

test('每周分两段：主行动后进入周末，周末后进入下一周', () => {
  const game = createGame({ name: '测试', seed: 'phase' });
  assert.equal(game.phase, 'main');
  assert.equal(game.week, 1);

  performAction(game, 'listen');
  settle(game);
  assert.equal(game.phase, 'weekend', '主行动后应该进入周末阶段');
  assert.equal(game.week, 1, '还没到下一周');
  assert.equal(game.turn, 0);

  performAction(game, 'sport');
  settle(game);
  assert.equal(game.phase, 'main');
  assert.equal(game.week, 2);
  assert.equal(game.turn, 1);
});

test('阶段限制：听课只能在主行动，补习班只能在周末', () => {
  const game = createGame({ name: '测试', seed: 'phase-limit' });
  game.phase = 'weekend';
  assert.throws(() => performAction(game, 'listen'), /主行动/);
  game.phase = 'main';
  assert.throws(() => performAction(game, 'tutor'), /周末/);
  assert.equal(game.turn, 0, '失败的尝试不应该消耗回合');
});

test('周末做同一件事的收益明显低于主行动', () => {
  const mainDeltas = [];
  const weekendDeltas = [];
  for (let i = 0; i < 12; i += 1) {
    const a = createGame({ name: '测试', seed: `scale-${i}` });
    const beforeA = a.knowledge.math;
    performAction(a, 'drill', { subject: 'math' });
    mainDeltas.push(a.knowledge.math - beforeA);

    const b = createGame({ name: '测试', seed: `scale-${i}` });
    toWeekend(b);
    const beforeB = b.knowledge.math;
    performAction(b, 'drill', { subject: 'math' });
    weekendDeltas.push(b.knowledge.math - beforeB);
  }
  const average = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  assert.ok(
    average(weekendDeltas) < average(mainDeltas) * 0.8,
    `周末收益应该明显更低（主 ${average(mainDeltas).toFixed(2)} vs 周末 ${average(weekendDeltas).toFixed(2)}）`,
  );
});

test('需要选科的行动：科目必须在可选范围内', () => {
  const game = createGame({ name: '测试', seed: 'subject' });
  assert.throws(() => performAction(game, 'drill'), /科目/);
  assert.throws(() => performAction(game, 'drill', { subject: 'politics' }), /可选范围/);
  assert.equal(game.turn, 0);
});

test('改选科只能在高一上学期，且会换掉最弱的一门', () => {
  const game = createGame({ name: '测试', seed: 'reselect', track: 'physics', electives: ['chemistry', 'biology'] });
  game.knowledge.chemistry = 70;
  game.knowledge.biology = 20;
  const action = listActions(game).find((item) => item.id === 'reselect');
  assert.ok(action.available);
  assert.deepEqual(
    action.subjectOptions.map((option) => option.key).sort(),
    ['geography', 'politics'],
  );
  performAction(game, 'reselect', { subject: 'politics' });
  settle(game);
  assert.ok(game.subjectKeys.includes('politics'));
  assert.ok(!game.subjectKeys.includes('biology'), '应该换掉最弱的生物');
  assert.ok(game.knowledge.politics > 0);

  game.phase = 'main';
  game.semesterIndex = 1;
  const later = listActions(game).find((item) => item.id === 'reselect');
  assert.equal(later.available, false);
});

test('一次性行动做过就消失', () => {
  const game = createGame({ name: '测试', seed: 'once', track: 'physics', electives: ['chemistry', 'biology'] });
  game.stats.social = 90;
  performAction(game, 'run_class');
  settle(game);
  const after = listActions(game, 'main').find((item) => item.id === 'run_class');
  assert.equal(after.available, false);
  assert.match(after.reason, /只能做一次/);
  game.phase = 'main';
  assert.throws(() => performAction(game, 'run_class'), /只能做一次/);
});

/* ------------------------------------------------------------ 构筑效果 */

test('天赋会影响收益：过目不忘学得更多', () => {
  const smart = createGame({ name: '测试', seed: 'trait', traits: ['memory', 'easygoing'] });
  const normal = createGame({ name: '测试', seed: 'trait', traits: ['nightowl', 'easygoing'] });
  const beforeSmart = smart.knowledge.math;
  const beforeNormal = normal.knowledge.math;
  performAction(smart, 'drill', { subject: 'math' });
  performAction(normal, 'drill', { subject: 'math' });
  assert.ok(
    smart.knowledge.math - beforeSmart > normal.knowledge.math - beforeNormal,
    '过目不忘的学习收益应该更高',
  );
  assert.equal(smart.rngState, normal.rngState, '天赋不参与随机种子，同一局可以精确对比');
});

test('家庭背景影响开局零花钱与父母关系', () => {
  const rich = createGame({ name: '测试', seed: 'bg-1', background: 'business' });
  const plain = createGame({ name: '测试', seed: 'bg-1', background: 'worker' });
  assert.ok(rich.stats.money > plain.stats.money);
  assert.ok(rich.npc.parents < plain.npc.parents);
  assert.equal(BACKGROUND_MAP.business.mods.startMoney, 600);
});

test('天赋最多两个，非法 id 会被忽略', () => {
  const game = createGame({ name: '测试', seed: 'trait-2', traits: ['memory', 'nightowl', 'athletic', 'nope'] });
  assert.equal(game.build.traits.length, 2);
  assert.ok(game.build.traits.every((id) => TRAIT_MAP[id]));
});

/* ------------------------------------------------------------ 人物与商店 */

test('NPC 好感度会被行动改变并限制在 0-100', () => {
  const game = createGame({ name: '测试', seed: 'npc' });
  const before = game.npc.parents;
  game.phase = 'weekend';
  performAction(game, 'family_time');
  settle(game);
  assert.ok(game.npc.parents > before, '陪家人应该提升父母好感');

  game.npc.parents = 99;
  game.phase = 'weekend';
  performAction(game, 'family_time');
  settle(game);
  assert.ok(game.npc.parents <= 100);
});

test('商店：买道具扣钱、加物品、修饰器生效', () => {
  const game = createGame({ name: '测试', seed: 'shop', background: 'business' });
  const moneyBefore = game.stats.money;
  const { lines } = buyItem(game, 'workbook');
  assert.ok(lines.length > 0);
  assert.equal(game.stats.money, moneyBefore - ITEM_MAP.workbook.price);
  assert.ok(game.items.includes('workbook'));
  assert.ok(Math.abs(game.mods.study - (game.baseMods.study + ITEM_MAP.workbook.mods.study)) < 1e-9);

  assert.throws(() => buyItem(game, 'workbook'), /已经买过/);
  assert.throws(() => buyItem(game, 'nope'), /没有这个商品/);

  const coffee = listShop(game).find((item) => item.id === 'coffee');
  assert.equal(coffee.canBuy, true);
  const fatigueBefore = game.stats.fatigue;
  buyItem(game, 'coffee');
  assert.ok(game.stats.fatigue < fatigueBefore);
});

test('钱不够就买不了', () => {
  const game = createGame({ name: '测试', seed: 'shop-2' });
  game.stats.money = 10;
  assert.throws(() => buyItem(game, 'phone'), /零花钱不够/);
});

/* ------------------------------------------------------------ 考试与结局 */

test('期中和期末考试会自动进行（每学期 6 周）', () => {
  const game = createGame({ name: '测试', seed: 'exam', weeksPerSemester: 6 });
  for (let i = 0; i < 3; i += 1) {
    playWeek(game, () => ({ actionId: 'listen' }));
  }
  assert.equal(game.exams.length, 1, '第 3 周应该有一次期中考试');
  assert.equal(game.exams[0].name, '期中考试');
  assert.ok(game.exams[0].total >= 0 && game.exams[0].total <= TOTAL_MAX);

  for (let i = 0; i < 3; i += 1) {
    playWeek(game, () => ({ actionId: 'listen' }));
  }
  assert.equal(game.exams.length, 2);
  assert.equal(game.semesterIndex, 1, '一学期结束后应该进入下一学期');
  assert.equal(game.week, 1);
});

test('普通模式：读完高三会迎来高考并给出结局', () => {
  const game = playFull('full-normal', 'diligent', { weeksPerSemester: 6 });
  assert.equal(game.status, 'ended');
  const gaokao = game.exams.find((exam) => exam.kind === 'gaokao');
  assert.ok(gaokao, '应该有高考成绩');
  assert.ok(gaokao.total > 0 && gaokao.total <= TOTAL_MAX);
  assert.ok(game.ending.title);
  assert.equal(game.turn, 36, '一局 36 周');
});

test('自由模式：不会自动高考，报名高考的行动会结束游戏', () => {
  const game = createGame({ name: '测试', seed: 'endless', endless: true, weeksPerSemester: 3 });
  // 固定策略（只听课）证明自由模式不会自己安排高考
  for (let i = 0; i < 20; i += 1) playWeek(game, () => ({ actionId: 'listen' }));
  assert.equal(game.status, 'playing');
  assert.ok(game.turn >= 18, '自由模式会一直循环下去');
  assert.equal(game.semesterIndex, 5, '自由模式停在高三下学期');
  assert.equal(game.exams.some((exam) => exam.kind === 'gaokao'), false);

  const action = listActions(game, 'main').find((item) => item.id === 'take_gaokao');
  assert.ok(action?.available, '自由模式下应该可以自己报名高考');
  game.phase = 'main';
  performAction(game, 'take_gaokao');
  // 高考完不是直接散场：先填志愿（v2.6 的新终局玩法）
  assert.equal(game.status, 'volunteering', '高考之后应该进入志愿填报阶段');
  assert.ok(volunteerState(game)?.options.length > 0, '应该给出一张志愿表');
  const picks = volunteerState(game)
    .options.slice()
    .sort((a, b) => a.minScore - b.minScore)
    .slice(0, VOLUNTEER_SLOTS)
    .map((option) => option.id);
  submitVolunteers(game, picks, { adjust: true });
  assert.equal(game.status, 'ended');
  assert.ok(game.exams.some((exam) => exam.kind === 'gaokao'));
  assert.ok(game.ending?.volunteer, '结局里应该带录取结果');
});

test('自由模式 + 自动策略会自己报名高考，不会无限循环', () => {
  const game = createGame({ name: '测试', seed: 'endless-auto', endless: true, weeksPerSemester: 3 });
  const strategy = getStrategy('diligent');
  let guard = 0;
  while (game.status === 'playing' && guard < 200) {
    guard += 1;
    playWeek(game, strategy);
  }
  assert.equal(game.status, 'ended', '自动策略应该在高三下学期末报名高考');
  assert.ok(game.turn <= 60, `回合数应该合理，实际 ${game.turn}`);
  assert.ok(game.exams.some((exam) => exam.kind === 'gaokao'));
});

test('违纪过线会被劝退，心情归零会休学', () => {
  const expelled = createGame({ name: '测试', seed: 'expel' });
  expelled.stats.discipline = EFF.expelAt - 0.5;
  performAction(expelled, 'phone');
  assert.equal(expelled.ending.id, 'expelled');

  const depressed = createGame({ name: '测试', seed: 'mood' });
  depressed.stats.mood = 0.2;
  performAction(depressed, 'listen');
  assert.equal(depressed.ending.id, 'depressed');
});

test('主动退学也能结束这一局', () => {
  const game = createGame({ name: '测试', seed: 'quit' });
  performAction(game, 'quit_school');
  assert.equal(game.status, 'ended');
  assert.equal(game.ending.id, 'dropped_out');
});

test('目标会在结局里判定达成情况', () => {
  const rich = createGame({ name: '测试', seed: 'goal-1', goal: 'money' });
  rich.stats.money = 5000;
  performAction(rich, 'quit_school');
  assert.equal(rich.ending.goal.id, 'money');
  assert.equal(rich.ending.goal.achieved, true);

  const poor = createGame({ name: '测试', seed: 'goal-2', goal: 'money' });
  poor.stats.money = 10;
  performAction(poor, 'quit_school');
  assert.equal(poor.ending.goal.achieved, false);
  assert.equal(GOAL_MAP.money.id, 'money');
});

test('结局图鉴覆盖所有可出现的结局 id', () => {
  const catalog = endingCatalog();
  const ids = new Set(catalog.map((item) => item.id));
  assert.ok(ids.size >= 20);
  for (const id of ['college:top2', 'college:fudu', 'baosong', 'expelled', 'depressed', 'hospital', 'dropped_out', 'love', 'friendship', 'startup']) {
    assert.ok(ids.has(id), `图鉴里应该有 ${id}`);
  }
  assert.ok(catalog.every((item) => item.title && item.hint && item.tier));
});

/* ------------------------------------------------------------ 存档与视图 */

test('存档可以完整往返并继续同样的随机序列（v2）', () => {
  const game = createGame({ name: '存档测试', seed: 'save', traits: ['memory', 'lucky'], background: 'business' });
  buyItem(game, 'workbook');
  for (let i = 0; i < 5; i += 1) playWeek(game, () => ({ actionId: 'listen' }));

  const restored = deserialize(serialize(game));
  assert.equal(restored.rngState, game.rngState);
  assert.deepEqual(restored.stats, game.stats);
  assert.deepEqual(restored.npc, game.npc);
  assert.deepEqual(restored.items, game.items);
  assert.deepEqual(restored.subjectKeys, game.subjectKeys);
  assert.equal(restored.phase, game.phase);
  assert.equal(restored.mods.study, game.mods.study, '道具修饰器要能恢复');

  const a = performAction(game, 'drill', { subject: game.subjectKeys[3] });
  const b = performAction(restored, 'drill', { subject: restored.subjectKeys[3] });
  assert.deepEqual(a.exams.map((exam) => exam.total), b.exams.map((exam) => exam.total));
  assert.deepEqual(game.knowledge, restored.knowledge);
});

test('v1 存档会自动升级到 v2', () => {
  const legacy = {
    version: 1,
    seedText: 'old',
    rngState: 123,
    difficulty: 'normal',
    weeksPerSemester: 8,
    student: { name: '老存档', gender: '男', className: '高一(3)班', track: '理科', city: '马鞍山' },
    turn: 3,
    semesterIndex: 0,
    week: 4,
    stats: { intelligence: 60, physique: 60, mood: 60, social: 40, teacherFavor: 50, comprehensive: 10, fatigue: 20, discipline: 0, money: 500 },
    knowledge: { chinese: 30, math: 40, english: 35, physics: 30, chemistry: 25, biology: 20 },
    flags: {},
    cooldowns: {},
    log: [],
    exams: [],
    history: [],
    pendingEvent: null,
    status: 'playing',
    ending: null,
  };
  const game = deserialize(legacy);
  assert.equal(game.version, 2);
  assert.deepEqual(game.subjectKeys, ['chinese', 'math', 'english', 'physics', 'chemistry', 'biology']);
  assert.equal(game.phase, 'main');
  assert.equal(game.npc.parents, 60);
  assert.ok(game.build.traits.length === 0 || Array.isArray(game.build.traits));
  assert.doesNotThrow(() => performAction(game, 'listen'));
});

test('版本完全对不上时拒绝读档', () => {
  assert.throws(() => deserialize({ version: 99, stats: {}, knowledge: {}, student: {} }), /版本不兼容/);
});

test('viewState 输出可以安全序列化，且已经按阶段过滤行动', () => {
  const game = createGame({ name: '视图', seed: 'view' });
  const main = viewState(game);
  assert.equal(main.phase, 'main');
  assert.equal(main.subjects.length, 6);
  assert.equal(main.npc.length, 7);
  // 每个好感度键都要有具体的人：班主任得是"王老师"这种称呼
  assert.ok(main.npc.every((npc) => npc.short && npc.role));
  assert.equal(main.cast.length, 8);
  assert.ok(main.cast.every((person) => person.name.length >= 2 && person.name.length <= 4));
  assert.equal(main.shop.length > 5, true);
  assert.ok(main.actions.every((action) => action.phase !== 'weekend'));
  assert.ok(main.build.goal?.name);
  assert.doesNotThrow(() => JSON.stringify(main));

  game.phase = 'weekend';
  const weekend = viewState(game);
  assert.ok(weekend.actions.every((action) => action.phase !== 'main'));
  assert.equal(weekend.weekendScale, EFF.weekendScale);
});

test('事件池包含扩展事件包', () => {
  assert.ok(ALL_EVENTS.length >= 50, `事件数量应该够多，实际 ${ALL_EVENTS.length}`);
  const ids = ALL_EVENTS.map((event) => event.id);
  assert.equal(new Set(ids).size, ids.length, '事件 id 不能重复');
});

/* ------------------------------------------------------------ 平衡 */

test('排名映射单调且落在 1..1000', () => {
  let previous = 0;
  for (let score = 750; score >= 0; score -= 10) {
    const rank = rankFromScore(score);
    assert.ok(rank >= 1 && rank <= 1000);
    assert.ok(rank >= previous);
    previous = rank;
  }
});

test('数值平衡：认真玩能上 985，摆烂会翻车', () => {
  const totals = [];
  for (let i = 0; i < 10; i += 1) {
    const game = playFull(`balance-d-${i}`, 'diligent');
    const gaokao = game.exams.find((exam) => exam.kind === 'gaokao');
    if (gaokao) totals.push(gaokao.total);
  }
  const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  assert.ok(average > 500, `卷王平均分应该明显高于一本线，实际 ${average.toFixed(1)}`);
  assert.ok(average < 720, `不应该人人满分，实际 ${average.toFixed(1)}`);

  let collapsed = 0;
  for (let i = 0; i < 6; i += 1) {
    const game = playFull(`balance-s-${i}`, 'slacker');
    if (['expelled', 'depressed', 'hospital'].includes(game.ending?.id)) collapsed += 1;
    const gaokao = game.exams.find((exam) => exam.kind === 'gaokao');
    if (gaokao) assert.ok(gaokao.total < 520, `摆烂不应该考出高分：${gaokao.total}`);
  }
  assert.ok(collapsed > 0, '摆烂至少要有几局翻车');
});

test('playWeek 在一次性行动与冷却下也不会卡死', () => {
  const game = createGame({ name: '测试', seed: 'playweek' });
  const strategy = () => ({ actionId: 'listen' });
  const before = game.turn;
  const result = playWeek(game, strategy);
  assert.equal(game.turn, before + 1);
  assert.ok(result.lines.length > 0);

  // 策略给出非法行动时会兜底，不应该抛错
  const game2 = createGame({ name: '测试', seed: 'playweek-2' });
  const bad = () => ({ actionId: 'confess' });
  assert.doesNotThrow(() => playWeek(game2, bad));
  assert.equal(game2.turn, 1);
});

test('GameError 有一致的类型', () => {
  const game = createGame({ name: '测试', seed: 'err' });
  try {
    performAction(game, 'drill');
    assert.fail('应该抛错');
  } catch (error) {
    assert.ok(error instanceof GameError);
    assert.equal(error.name, 'GameError');
  }
});

/**
 * 违纪（discipline）的符号约定。
 *
 * school.js 里 discipline 是"违纪分"：**越低越好，累计到 120 劝退**。
 * 事件数据里很容易写反——"卸载短视频"写成 +4、"干完值日"写成 +4，
 * 结果就是做好事反而被劝退。这条测试把约定钉住。
 */
test('违纪符号约定：做好事记负、违纪记正', () => {
  const disciplineOf = (eventId, choiceId) => {
    const event = EVENT_MAP[eventId];
    assert.ok(event, `没有这个事件：${eventId}`);
    const choice = (event.choices ?? []).find((item) => item.id === choiceId);
    assert.ok(choice, `${eventId} 没有选项 ${choiceId}`);
    const spec = typeof choice.effect === 'function' ? choice.effect(createGame({ seed: 'discipline-sign' })) : choice.effect;
    return spec?.stats?.discipline ?? 0;
  };

  for (const [eventId, choiceId, label] of [
    ['short_video_loop', 'delete_app', '卸载短视频'],
    ['part_time_rebate_scam', 'report_it', '举报诈骗'],
    ['netbar_amateur_cup', 'go_home_study', '收书包回家做卷子'],
    ['broadcast_station_shift', 'read_list', '照单子念完'],
  ]) {
    assert.ok(disciplineOf(eventId, choiceId) <= 0, `${label}是守规矩的事，不该加违纪`);
  }

  // 被抓到刻桌子：这是违纪，必须加分
  const carve = EVENT_MAP.desk_carving_words.choices.find((item) => item.id === 'carve_mine');
  const busted = carve.effect(createGame({ seed: 'discipline-sign' })).risk[0].effect;
  assert.ok(busted.stats.discipline > 0, '被查出来刻桌子应该加违纪');
});
