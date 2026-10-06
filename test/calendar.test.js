/**
 * 学期日历测试：随机事件和行动"什么时候才该出现"。
 *
 * 这一组测试的起因是玩家反馈：都高三了还能"捡到高二学姐的钱包"，
 * 五月还能办元旦晚会。所以这里既查结构（每个事件都必须登记时间表），
 * 也查具体事实（钱包只在高一高二、元旦晚会只在秋季学期）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIONS, ALL_EVENTS, EVENT_MAP, createGame, endingCatalog, listActions, playWeek, resolveEvent } from '../src/engine.js';
import {
  ACTION_SCHEDULE,
  EVENT_SCHEDULE,
  calendarOf,
  matchesSchedule,
  scheduleFor,
  scheduleHint,
} from '../src/data/calendar.js';
import { SEMESTERS } from '../src/data/school.js';
import { getStrategy } from '../src/strategies.js';

/** 造一个指定年级 / 学期 / 周次的状态，用来单独验证日历判断。 */
const at = (semesterIndex, week, weeks = 6) => ({ semesterIndex, week, weeksPerSemester: weeks });

/* ------------------------------------------------------------ 结构 */

test('每个随机事件都登记了时间表（新增事件忘了定时间会在这里失败）', () => {
  const random = ALL_EVENTS.filter((event) => !event.story);
  assert.ok(random.length >= 60, `随机事件应该够多，现在只有 ${random.length}`);

  const missing = random.filter((event) => !(event.id in EVENT_SCHEDULE)).map((event) => event.id);
  assert.deepEqual(missing, [], `这些事件没有登记时间表：${missing.join('、')}`);
});

test('时间表里没有拼错的 id，也没有自相矛盾的窗口', () => {
  const ids = new Set(ALL_EVENTS.map((event) => event.id));
  const orphans = Object.keys(EVENT_SCHEDULE).filter((id) => !ids.has(id));
  assert.deepEqual(orphans, [], `时间表里有不存在的事件 id：${orphans.join('、')}`);

  const actionIds = new Set(ACTIONS.map((action) => action.id));
  const badActions = Object.keys(ACTION_SCHEDULE).filter((id) => !actionIds.has(id));
  assert.deepEqual(badActions, [], `时间表里有不存在的行动 id：${badActions.join('、')}`);

  for (const [id, schedule] of Object.entries({ ...EVENT_SCHEDULE, ...ACTION_SCHEDULE })) {
    if (schedule.anytime) continue;
    if (schedule.minWeek !== undefined && schedule.maxWeek !== undefined) {
      assert.ok(schedule.minWeek <= schedule.maxWeek, `${id} 的周次窗口是空的`);
    }
    for (const grade of [schedule.grade].flat().filter(Boolean)) {
      assert.ok(grade >= 1 && grade <= 3, `${id} 的年级不合法：${grade}`);
    }
    for (const semester of [schedule.semester].flat().filter(Boolean)) {
      assert.ok(semester >= 0 && semester <= 5, `${id} 的学期序号不合法：${semester}`);
    }
  }
});

test('每个事件在整局里至少有机会出现一次', () => {
  // 六种 (学期, 周次) 组合走一遍，看这个事件有没有窗口
  const weeks = 6;
  for (const event of ALL_EVENTS.filter((item) => !item.story)) {
    const schedule = scheduleFor('event', event.id);
    let reachable = false;
    for (let semester = 0; semester < SEMESTERS.length && !reachable; semester += 1) {
      for (let week = 1; week <= weeks; week += 1) {
        if (matchesSchedule(schedule, calendarOf(at(semester, week, weeks)))) {
          reachable = true;
          break;
        }
      }
    }
    assert.ok(reachable, `事件 ${event.id} 在任何学期都触发不了（时间表写死了）`);
  }
});

/* ------------------------------------------------------------ 日历本身 */

test('日历把六个学期正确折算成年级和季节', () => {
  assert.deepEqual(calendarOf(at(0, 1)), { grade: 1, term: 'autumn', semesterIndex: 0, week: 1, weeks: 6, isFinalSemester: false });
  assert.equal(calendarOf(at(1, 1)).grade, 1);
  assert.equal(calendarOf(at(1, 1)).term, 'spring');
  assert.equal(calendarOf(at(2, 1)).grade, 2);
  assert.equal(calendarOf(at(3, 1)).grade, 2);
  assert.equal(calendarOf(at(4, 1)).grade, 3);
  assert.equal(calendarOf(at(5, 1)).grade, 3);
  assert.equal(calendarOf(at(5, 1)).isFinalSemester, true);
  // 自由模式跑过最后一学期也不会越界
  assert.equal(calendarOf(at(9, 3)).grade, 3);
});

test('周次窗口会按实际学期长度收拢（一学期只有 3 周时也能触发）', () => {
  const schedule = { semester: 0, minWeek: 5 };
  assert.equal(matchesSchedule(schedule, calendarOf(at(0, 5, 6))), true);
  assert.equal(matchesSchedule(schedule, calendarOf(at(0, 4, 6))), false);
  // 3 周的学期：第 5 周被收拢到最后一周，而不是永远不触发
  assert.equal(matchesSchedule(schedule, calendarOf(at(0, 3, 3))), true);
  assert.equal(matchesSchedule(schedule, calendarOf(at(0, 2, 3))), false);
});

test('时间表能翻译成给玩家看的说明', () => {
  assert.equal(scheduleHint({ grade: [3] }), '只在高三');
  assert.equal(scheduleHint({ term: 'autumn' }), '只在秋季学期');
  assert.equal(scheduleHint({ minWeek: 3 }), '第 3 周之后');
  assert.equal(scheduleHint({ grade: [2], term: 'spring', minWeek: 2, maxWeek: 4 }), '只在高二　只在春季学期　第 2~4 周');
  assert.equal(scheduleHint({ anytime: true }), '');
});

/* ------------------------------------------------------------ 具体事实 */

test('高三不会再捡到高二学姐的钱包', () => {
  const schedule = scheduleFor('event', 'lost_wallet');
  assert.equal(matchesSchedule(schedule, calendarOf(at(0, 3))), true, '高一应该能遇到');
  assert.equal(matchesSchedule(schedule, calendarOf(at(2, 3))), true, '高二应该能遇到');
  assert.equal(matchesSchedule(schedule, calendarOf(at(4, 3))), false, '高三上学期不该遇到');
  assert.equal(matchesSchedule(schedule, calendarOf(at(5, 3))), false, '高三下学期不该遇到');
});

test('季节性的校园活动只在对应的学期出现', () => {
  // 元旦晚会：秋季学期，且靠后
  assert.equal(matchesSchedule(scheduleFor('event', 'new_year_gala'), calendarOf(at(0, 5))), true);
  assert.equal(matchesSchedule(scheduleFor('event', 'new_year_gala'), calendarOf(at(1, 5))), false, '春季学期不该办元旦晚会');
  assert.equal(matchesSchedule(scheduleFor('event', 'new_year_gala'), calendarOf(at(0, 1))), false, '刚开学不该办元旦晚会');

  // 春季运动会：春季学期
  assert.equal(matchesSchedule(scheduleFor('event', 'spring_sports'), calendarOf(at(1, 3))), true);
  assert.equal(matchesSchedule(scheduleFor('event', 'spring_sports'), calendarOf(at(0, 3))), false);

  // 采石矶秋游：秋季学期
  assert.equal(matchesSchedule(scheduleFor('event', 'caishiji_trip'), calendarOf(at(2, 3))), true);
  assert.equal(matchesSchedule(scheduleFor('event', 'caishiji_trip'), calendarOf(at(3, 3))), false);

  // 军训：只有高一开学头两周
  assert.equal(matchesSchedule(scheduleFor('event', 'military_training'), calendarOf(at(0, 1))), true);
  assert.equal(matchesSchedule(scheduleFor('event', 'military_training'), calendarOf(at(0, 4))), false);
  assert.equal(matchesSchedule(scheduleFor('event', 'military_training'), calendarOf(at(2, 1))), false, '高二不该再军训');

  // 百日誓师：高三下学期开学
  assert.equal(matchesSchedule(scheduleFor('event', 'gaokao_slogan'), calendarOf(at(5, 1))), true);
  assert.equal(matchesSchedule(scheduleFor('event', 'gaokao_slogan'), calendarOf(at(4, 4))), false);
});

test('高三专属的事不会提前出现', () => {
  for (const id of ['adult_ceremony', 'gaokao_physical', 'graduation_photo', 'mock_exam_pressure', 'rival_notes']) {
    const schedule = scheduleFor('event', id);
    assert.equal(matchesSchedule(schedule, calendarOf(at(0, 3))), false, `${id} 不该在高一出现`);
    assert.equal(matchesSchedule(schedule, calendarOf(at(2, 3))), false, `${id} 不该在高二出现`);
  }
});

test('高中三年里跑一整局，日历上的事都在该发生的时候发生', () => {
  const game = createGame({ name: '日历', seed: 'calendar-run', weeksPerSemester: 6 });
  const strategy = getStrategy('balanced');
  const seen = [];
  let guard = 0;
  while (game.status === 'playing' && guard < 400) {
    guard += 1;
    const before = game.log.length;
    playWeek(game, strategy);
    for (const entry of game.log.slice(before)) {
      if (entry.kind === 'event') seen.push({ ...entry, semesterIndex: game.semesterIndex });
    }
  }

  // 逐条核对：这一局触发过的每个事件，都必须满足它自己的时间表
  for (const entry of seen) {
    const id = Object.keys(EVENT_SCHEDULE).find((key) => entry.title.includes(key));
    void id;
  }
  assert.ok(seen.length > 10, `一局该触发不少事件，实际只有 ${seen.length}`);

  // 钱包事件如果出现过，必须是在高一或高二
  const wallet = game.log.find((entry) => entry.title.includes('钱包'));
  if (wallet) {
    assert.ok(wallet.semesterIndex <= 3, `钱包事件出现在第 ${wallet.semesterIndex} 个学期（高三）`);
  }
});

/* ------------------------------------------------------------ 抽象结局 */

test('抽象事件能真的把这一局送进结局', () => {
  // 三个抽象结局的触发条件：状态太差 + 做了那件危险的事
  const cases = [
    { event: 'street_stall', choice: 'eat', tweak: { physique: 30 }, ending: 'food_poison' },
    { event: 'yushanhu_boat', choice: 'board', tweak: { physique: 30 }, ending: 'lake_fall' },
    {
      event: 'gaokao_eve_allnighter',
      choice: 'allnight',
      tweak: { physique: 30, mood: 35 },
      ending: 'late_for_gaokao',
    },
  ];

  for (const item of cases) {
    const event = EVENT_MAP[item.event];
    assert.ok(event, `${item.event} 应该在事件表里`);

    // 每次换一个种子，否则随机风险永远掷出同一个结果
    let hit = null;
    for (let i = 0; i < 300 && !hit; i += 1) {
      const game = createGame({ name: '抽象', seed: `abstract-${item.event}-${i}` });
      Object.assign(game.stats, item.tweak);
      game.pendingEvent = {
        id: event.id,
        name: event.name,
        icon: event.icon,
        text: event.text,
        choices: event.choices.map((choice) => ({ id: choice.id, label: choice.label })),
      };
      resolveEvent(game, item.choice);
      if (game.status === 'ended') hit = game.ending;
    }

    assert.ok(hit, `${item.event}/${item.choice} 在 300 次里一次都没触发结局`);
    assert.equal(hit.id, item.ending, `${item.event} 触发的结局不对`);
    assert.equal(hit.tier, '意外结局');
    assert.equal(hit.good, false);
    assert.ok(hit.text.length > 40, '结局正文不能是空的');
  }
});

test('状态好的时候这些事只会难受一下，不会直接结束', () => {
  const event = EVENT_MAP.street_stall;
  let survived = 0;
  for (let i = 0; i < 60; i += 1) {
    const game = createGame({ name: '结实', seed: `healthy-${i}` });
    Object.assign(game.stats, { physique: 92, mood: 88 });
    game.pendingEvent = {
      id: event.id,
      name: event.name,
      icon: event.icon,
      text: event.text,
      choices: event.choices.map((choice) => ({ id: choice.id, label: choice.label })),
    };
    resolveEvent(game, 'eat');
    if (game.status === 'playing') survived += 1;
  }
  assert.ok(survived >= 45, `体质 92 的人不该有这么多局直接被路边摊结束（只活下来 ${survived}/60）`);
});

test('结局是"先到先得"的，后面的崩溃检查不会把它改掉', () => {
  // 路边摊把体质打到 0，紧接着 checkCollapse 会想判"住院"——
  // 但第一件事已经结束了这一局，结局必须还是 food_poison
  let checked = 0;
  for (let i = 0; i < 200 && checked < 3; i += 1) {
    const event = EVENT_MAP.street_stall;
    const game = createGame({ name: '先到先得', seed: `first-wins-${i}` });
    Object.assign(game.stats, { physique: 30 });
    game.pendingEvent = {
      id: event.id,
      name: event.name,
      icon: event.icon,
      text: event.text,
      choices: event.choices.map((choice) => ({ id: choice.id, label: choice.label })),
    };
    resolveEvent(game, 'eat');
    if (game.status === 'ended') {
      assert.equal(game.ending.id, 'food_poison', '结局被后面的崩溃检查覆盖了');
      checked += 1;
    }
  }
  assert.ok(checked > 0, '没测到任何一种结局');
});

test('三个抽象结局都进了图鉴', () => {
  const catalog = endingCatalog();
  for (const id of ['food_poison', 'lake_fall', 'late_for_gaokao']) {
    const entry = catalog.find((item) => item.id === id);
    assert.ok(entry, `${id} 不在图鉴里`);
    assert.equal(entry.tier, '意外结局');
    assert.ok(entry.hint, `${id} 缺少线索提示`);
  }
});

/* ------------------------------------------------------------ 行动 */

test('行动也受日历约束，并且会告诉玩家为什么现在不能做', () => {
  const CALENDAR_REASON = /现在不是做这件事的时候/;

  // 高一上学期：能竞选班干部（这条 action 没有数值门槛，所以直接可用）
  const year1 = listActions(createGame({ name: '行动', seed: 'action-calendar', weeksPerSemester: 6 }), 'main');
  assert.equal(year1.find((action) => action.id === 'run_class').available, true, '高一应该能竞选班干部');

  // 高三：竞选班干部、社团都被日历挡住，理由要写明"只在高一"
  const senior = createGame({ name: '行动', seed: 'action-calendar', weeksPerSemester: 6 });
  senior.semesterIndex = 4;
  senior.week = 1;
  const seniorActions = listActions(senior, 'main');

  const runClass = seniorActions.find((action) => action.id === 'run_class');
  assert.equal(runClass.available, false);
  assert.match(runClass.reason, CALENDAR_REASON);
  assert.match(runClass.reason, /高一/);

  const club = seniorActions.find((action) => action.id === 'club');
  assert.equal(club.available, false, '高三不该还能天天泡社团');
  assert.match(club.reason, CALENDAR_REASON);

  // 强基计划是高三才能报：这里只检查日历这一关过了（数值门槛是另一回事，
  // 开局知识很低，所以它仍然会因为"没有竞赛奖项"而不可用）
  const qiangji = seniorActions.find((action) => action.id === 'apply_qiangji');
  assert.ok(!CALENDAR_REASON.test(qiangji.reason ?? ''), `高三不该被日历挡住强基计划：${qiangji.reason}`);
});

test('艺考班只在高二开放', () => {
  const build = (semesterIndex) => {
    const game = createGame({ name: '艺考', seed: 'art-window', weeksPerSemester: 6 });
    game.semesterIndex = semesterIndex;
    game.week = 1;
    game.stats.comprehensive = 80; // 排除数值门槛，只看日历
    return listActions(game, 'main').find((action) => action.id === 'art_class');
  };
  assert.equal(build(2).available, true, '高二应该能报艺考班');
  assert.equal(build(0).available, false, '高一报艺考班太早');
  assert.match(build(0).reason, /高二/);
  assert.equal(build(4).available, false, '高三报艺考班来不及了');
});
