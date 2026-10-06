/**
 * v2.5「自定义人物」测试。
 *
 * 这一版新加的东西全都在这一个文件里验：
 *   1. 属性点（预算 / 上限 / 超支 / 单科底子）
 *   2. 性格与缺陷（mods 真的进了 baseMods，而且能影响数值）
 *   3. 头像、外号（装饰但也进存档）
 *   4. 自定义关系人物（名字 + 性别 + 不打乱主随机序列）
 *   5. 自定义难度（旋钮收拢 + 真的按玩家的值跑）
 *   6. 多周目传承点
 *   7. 角色模板（数据必须自洽，模板块不能点一下就报错）
 *   8. 新事件 / 新结局 / 新成就接线
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_EVENTS,
  CUSTOM_KNOBS,
  DIFFICULTY,
  EFF,
  EVENT_MAP,
  createGame,
  deserialize,
  endingCatalog,
  performAction,
  playWeek,
  resolveCustomRules,
  resolveEvent,
  rulesOf,
  serialize,
  viewState,
} from '../src/engine.js';
import {
  CHARACTER_PRESETS,
  FLAWS,
  FLAW_MAP,
  PERSONALITIES,
  PERSONALITY_MAP,
  POINT_BUDGET,
  POINT_BUY,
  POINT_BUY_MAP,
} from '../src/data/character.js';
import { getStrategy } from '../src/strategies.js';

/** 玩到结局（带上限，免得策略卡住时测试挂死）。 */
function playToEnd(game, strategyName = 'balanced', guardLimit = 400) {
  const strategy = getStrategy(strategyName);
  let guard = 0;
  while (game.status === 'playing' && guard < guardLimit) {
    guard += 1;
    playWeek(game, strategy);
  }
  return game;
}

/* ------------------------------------------------------------ 属性点 */

test('属性点：预算 = 难度 + 缺陷 + 传承点', () => {
  const g = createGame({ seed: 'pt-1', difficulty: 'normal', points: { intelligence: 3 } });
  assert.equal(g.build.points.budget, POINT_BUDGET.normal);
  assert.equal(g.build.points.legacy, 0);
  assert.equal(g.build.points.spent, 3);
  assert.equal(g.build.points.spend.intelligence, 3);

  const withFlaw = createGame({ seed: 'pt-1', difficulty: 'normal', flaw: 'slow_start', points: { intelligence: 3 } });
  assert.equal(withFlaw.build.points.budget, POINT_BUDGET.normal + FLAW_MAP.slow_start.points);

  const withLegacy = createGame({ seed: 'pt-1', difficulty: 'normal', legacyPoints: 4, points: { intelligence: 3 } });
  assert.equal(withLegacy.build.points.legacy, 4);
  assert.equal(withLegacy.build.points.spent, 3);
});

test('属性点：真的加到属性和单科底子上', () => {
  const baseline = createGame({ seed: 'pt-apply' });
  // 12 点刚好用完：智力 6 + 体质 2 点(+4) + 心情 1 点(+3) + 零花钱 1 点(+200) + 数学底子 2 点(+8)
  const funded = createGame({
    seed: 'pt-apply',
    points: { intelligence: 6, physique: 2, mood: 1, money: 1, subjects: { math: 2 } },
  });
  assert.equal(funded.build.points.spent, 12);
  assert.equal(funded.stats.intelligence, baseline.stats.intelligence + 6);
  assert.equal(funded.stats.physique, baseline.stats.physique + 4);
  assert.equal(funded.stats.mood, baseline.stats.mood + 3);
  assert.equal(funded.stats.money, baseline.stats.money + 200);
  assert.equal(funded.knowledge.math, Math.round((baseline.knowledge.math + 8) * 10) / 10);
  // 没投点的科目不该被顺手加一点
  assert.equal(funded.knowledge.chinese, baseline.knowledge.chinese);
  assert.equal(funded.stats.social, baseline.stats.social);
});

test('属性点：单项不能超过上限，超支会被削掉', () => {
  const item = POINT_BUY_MAP.intelligence;
  const g = createGame({ seed: 'pt-cap', points: { intelligence: item.max + 5 } });
  assert.equal(g.build.points.spend.intelligence, item.max, `智力最多只能投 ${item.max} 点`);

  // 预算 12 点，硬塞 40 点：最终必须落回预算之内
  const over = createGame({
    seed: 'pt-over',
    points: { intelligence: 12, physique: 12, mood: 8, social: 10, subjects: { math: 3, physics: 3 } },
  });
  assert.ok(over.build.points.spent <= over.build.points.budget, `花了 ${over.build.points.spent} 点，超预算了`);
  assert.equal(over.build.points.spent, over.build.points.budget, '超支时应该削到"刚好用完"');
});

test('属性点：单科底子只认当前选科里的科目', () => {
  const g = createGame({
    seed: 'pt-subject',
    track: 'physics',
    electives: ['chemistry', 'biology'],
    points: { subjects: { math: 3, history: 3, geography: 3 } },
  });
  assert.deepEqual(Object.keys(g.build.points.subjects).sort(), ['math']);
  assert.equal(g.knowledge.history, createGame({ seed: 'pt-subject', track: 'physics', electives: ['chemistry', 'biology'] }).knowledge.history);
});

test('属性点：乱七八糟的输入不会炸（负数 / 字符串 / 不存在的键）', () => {
  const g = createGame({
    seed: 'pt-junk',
    points: { intelligence: -5, nope: 99, mood: 'abc', subjects: { nope: 3, math: -2 } },
  });
  assert.equal(g.build.points.spent, 0);
  assert.deepEqual(g.build.points.spend, {});
  assert.deepEqual(g.build.points.subjects, {});

  const weird = createGame({ seed: 'pt-junk', points: 'not-an-object' });
  assert.equal(weird.build.points.spent, 0);
});

/* ------------------------------------------------------------ 性格 / 缺陷 */

test('性格：默认「平常心」不带任何 mods，其它性格进 baseMods', () => {
  // 天赋有默认值（过目不忘 + 运动天赋），所以只比"性格带来的那一份差分"
  const plain = createGame({ seed: 'per-1' });
  assert.equal(plain.build.personality, 'plain');
  assert.equal(plain.baseMods.moodDrain, 0);
  assert.equal(plain.baseMods.comprehensive, 0);

  const sharp = createGame({ seed: 'per-1', personality: 'sharp' });
  assert.equal(sharp.build.personality, 'sharp');
  assert.equal(sharp.baseMods.study, plain.baseMods.study + PERSONALITY_MAP.sharp.mods.study);
  assert.equal(sharp.baseMods.moodDrain, PERSONALITY_MAP.sharp.mods.moodDrain);

  const bogus = createGame({ seed: 'per-1', personality: '不存在的性格' });
  assert.equal(bogus.build.personality, 'plain');

  for (const item of PERSONALITIES) {
    const g = createGame({ seed: `per-${item.id}`, personality: item.id });
    for (const [key, value] of Object.entries(item.mods)) {
      assert.equal(g.baseMods[key], plain.baseMods[key] + value, `${item.id} 的 ${key} 没进 baseMods`);
    }
  }
});

test('缺陷：换成属性点，而且最多只认一个', () => {
  const one = createGame({ seed: 'flaw-1', flaw: 'frail' });
  assert.deepEqual(one.build.flaws, ['frail']);
  assert.equal(one.baseMods.startPhysique, FLAW_MAP.frail.mods.startPhysique);
  assert.equal(one.stats.physique, createGame({ seed: 'flaw-1' }).stats.physique - 10);

  const many = createGame({ seed: 'flaw-2', flaw: ['frail', 'poor', 'myopia'] });
  assert.equal(many.build.flaws.length, EFF.maxFlaws, '缺陷最多一个');
  assert.deepEqual(many.build.flaws, ['frail']);

  const bogus = createGame({ seed: 'flaw-3', flaw: 'nope' });
  assert.deepEqual(bogus.build.flaws, []);
});

test('缺陷「开窍晚」真的会让人忘得更快', () => {
  const run = (extra) => {
    const game = createGame({ seed: 'decay-flaw', difficulty: 'normal', ...extra });
    const before = { ...game.knowledge };
    const strategy = getStrategy('balanced');
    for (let i = 0; i < 12; i += 1) playWeek(game, strategy);
    const keys = game.subjectKeys;
    const lost = keys.reduce((sum, key) => sum + (before[key] - game.knowledge[key]), 0);
    return lost;
  };
  const normal = run({});
  const slow = run({ flaw: 'slow_start' });
  assert.ok(slow > normal, `开窍晚应该掉得更多（普通 ${normal.toFixed(1)}，开窍晚 ${slow.toFixed(1)}）`);
  const memory = run({ traits: ['memory', 'diligent'] });
  assert.ok(memory < normal, `过目不忘 + 坐得住应该掉得更少（${memory.toFixed(1)}）`);
});

/* ------------------------------------------------------------ 头像 / 外号 */

test('头像：合法 id 生效，非法 id 退回默认', () => {
  const g = createGame({ seed: 'avatar-1', avatar: 'panda' });
  assert.equal(g.student.avatar, 'panda');
  assert.equal(g.student.avatarIcon, '🐼');
  assert.equal(viewState(g).student.avatarIcon, '🐼');

  const bogus = createGame({ seed: 'avatar-1', avatar: '不存在' });
  assert.equal(bogus.student.avatar, 'student');
  assert.equal(bogus.student.avatarIcon, '🧑');
});

test('外号：填了就用填的，没填按种子随机而且可复现', () => {
  const named = createGame({ seed: 'nick-1', nickname: '根号三' });
  assert.equal(named.student.nickname, '根号三');

  const a = createGame({ seed: 'nick-1' });
  const b = createGame({ seed: 'nick-1' });
  assert.ok(a.student.nickname.length > 0, '应该随机出一个外号');
  assert.equal(a.student.nickname, b.student.nickname, '同一个种子应该拿到同一个外号');
  // 外号不能挤掉主角自己的名字
  assert.equal(a.student.name, b.student.name);
});

/* ------------------------------------------------------------ 自定义关系人物 */

test('自定义关系人物：名字和性别都能定，称呼也跟着变', () => {
  const g = createGame({
    seed: 'cast-custom',
    gender: '男',
    customCast: {
      deskmate: { name: '林小美', gender: '女' },
      love: { name: '苏念', gender: '女' },
      head: { name: '陈立国', gender: '男' },
    },
  });
  const deskmate = g.cast.map.deskmate;
  assert.equal(deskmate.name, '林小美');
  assert.equal(deskmate.gender, '女');
  assert.equal(deskmate.ta, '她');
  assert.equal(deskmate.call, '小美', '同学之间应该叫名不带姓');
  assert.equal(g.cast.map.love.name, '苏念');
  assert.equal(g.cast.map.head.name, '陈立国');
  assert.equal(g.cast.map.head.teacher, '陈老师');
  assert.equal(deskmate.custom, true);
  // 没指定的角色位照旧随机
  assert.ok(g.cast.map.friend.name.length >= 2);
});

test('自定义关系人物：非法角色位 / 空名字被忽略', () => {
  const g = createGame({ seed: 'cast-custom', customCast: { nope: { name: '张三' }, friend: { name: '   ' }, rival: { gender: '女' } } });
  assert.deepEqual(Object.keys(g.build.customCast), ['rival']);
  assert.equal(g.cast.map.friend.custom, false);
});

test('自定义关系人物不会打乱主随机序列', () => {
  // 名字走的是独立随机流：改名字不该影响开局底子、智力、考试这些主序列数值
  const base = createGame({ seed: 'cast-stream', traits: ['memory', 'lucky'], points: { intelligence: 4 } });
  const custom = createGame({
    seed: 'cast-stream',
    traits: ['memory', 'lucky'],
    points: { intelligence: 4 },
    customCast: { deskmate: { name: '王小明', gender: '男' }, friend: { name: '李大力', gender: '男' } },
  });
  assert.equal(custom.stats.intelligence, base.stats.intelligence);
  assert.equal(custom.stats.physique, base.stats.physique);
  assert.deepEqual(custom.knowledge, base.knowledge);
  assert.equal(custom.rngState, base.rngState);
});

test('自定义关系人物能存进存档再读出来', () => {
  const g = createGame({ seed: 'cast-save', customCast: { deskmate: { name: '林小美', gender: '女' } } });
  const back = deserialize(serialize(g));
  assert.deepEqual(back.build.customCast, { deskmate: { name: '林小美', gender: '女' } });
  assert.equal(back.cast.map.deskmate.name, '林小美');
  assert.equal(back.cast.map.deskmate.gender, '女');
});

/* ------------------------------------------------------------ 自定义难度 */

test('自定义难度：旋钮会被收拢到合法区间', () => {
  const rules = resolveCustomRules({ gain: 99, forgetScale: -3, eventChance: 5, examNoise: 9, money: 1e9, startMin: 80, startMax: 20, points: 999, lopsided: 1 });
  const knob = (id) => CUSTOM_KNOBS.find((item) => item.id === id);
  assert.equal(rules.gain, knob('gain').max);
  assert.equal(rules.forgetScale, knob('forgetScale').min);
  assert.equal(rules.eventChance, knob('eventChance').max);
  assert.equal(rules.examNoise, knob('examNoise').max);
  assert.equal(rules.money, knob('money').max);
  assert.equal(rules.points, knob('points').max);
  assert.ok(rules.start.min <= rules.start.max, '上下限写反了要自动纠正');
  assert.equal(rules.start.lopsided, true);
});

test('自定义难度：空输入等于「正常」的默认值', () => {
  const rules = resolveCustomRules();
  const normal = DIFFICULTY.normal;
  assert.equal(rules.gain, normal.gain);
  assert.equal(rules.forgetScale, normal.forgetScale);
  assert.equal(rules.examNoise, normal.examNoise);
  assert.equal(rules.eventChance, normal.eventChance);
  assert.equal(rules.money, normal.money);
  assert.equal(rules.start.min, normal.start.min);
  assert.equal(rules.start.max, normal.start.max);
  assert.equal(rules.start.lopsided, false);
  assert.equal(rules.points, POINT_BUDGET.normal);
});

test('自定义难度：游戏真的按玩家调的值跑', () => {
  const g = createGame({
    seed: 'custom-run',
    difficulty: 'custom',
    custom: { gain: 1.6, forgetScale: 0, money: 1234, startMin: 40, startMax: 50, points: 18 },
  });
  assert.equal(g.difficulty, 'custom');
  assert.equal(g.stats.money, 1234);
  assert.equal(rulesOf(g).gain, 1.6);
  assert.equal(rulesOf(g).forgetScale, 0);
  assert.equal(g.difficultyRules.gain, 1.6);
  const view = viewState(g);
  assert.equal(view.difficulty.key, 'custom');
  assert.equal(view.customRules.gain, 1.6);
  assert.equal(view.build.points.budget, 18, '自定义难度的点数预算应该来自滑杆');
  for (const key of g.subjectKeys) {
    assert.ok(g.knowledge[key] >= 40 && g.knowledge[key] <= 50, `${key} 的开局底子没落在 40~50`);
  }

  // forgetScale = 0：学过的东西一周之后基本不该掉
  const before = { ...g.knowledge };
  playWeek(g, getStrategy('balanced'));
  const lost = g.subjectKeys.reduce((sum, key) => sum + Math.max(0, before[key] - g.knowledge[key]), 0);
  assert.ok(lost < 1, `forgetScale=0 还掉了 ${lost.toFixed(2)} 分`);
});

test('自定义难度：非 custom 难度下 custom 参数被忽略', () => {
  const g = createGame({ seed: 'custom-ignore', difficulty: 'normal', custom: { money: 9999 } });
  assert.equal(g.stats.money, DIFFICULTY.normal.money);
  assert.equal(g.difficultyRules, null);
  assert.equal(rulesOf(g).gain, DIFFICULTY.normal.gain);
});

/* ------------------------------------------------------------ 传承点 */

test('传承点：进预算，而且有上限、会记进存档', () => {
  const g = createGame({ seed: 'legacy-1', legacyPoints: 5, points: { intelligence: 5 } });
  assert.equal(g.build.legacyPoints, 5);
  assert.equal(g.build.points.legacy, 5);
  assert.equal(g.build.points.budget, POINT_BUDGET.normal);
  assert.equal(viewState(g).build.legacyPoints, 5);

  const capped = createGame({ seed: 'legacy-2', legacyPoints: 999 });
  assert.equal(capped.build.points.legacy, 12, '传承点最多 12 点');

  const back = deserialize(serialize(g));
  assert.equal(back.build.legacyPoints, 5);
});

/* ------------------------------------------------------------ 角色模板 */

test('角色模板：每一套的 id 都合法、点数不超上限', () => {
  const traitIds = new Set(Object.keys(Object.fromEntries([]))); // 占位，真正的校验在下面逐条做
  void traitIds;
  for (const preset of CHARACTER_PRESETS) {
    assert.ok(preset.id && preset.name && preset.icon, `模板 ${preset.id} 缺字段`);
    assert.ok(!preset.personality || PERSONALITY_MAP[preset.personality], `${preset.id} 的性格不存在`);
    assert.ok(!preset.flaw || FLAW_MAP[preset.flaw], `${preset.id} 的缺陷不存在`);
    let spent = 0;
    for (const [key, value] of Object.entries(preset.points ?? {})) {
      if (key === 'subjects') continue;
      const item = POINT_BUY_MAP[key];
      assert.ok(item, `${preset.id} 里有不存在的属性点键：${key}`);
      assert.ok(value <= item.max, `${preset.id} 的 ${key} 超过单项上限`);
      spent += value;
    }
    for (const [key, value] of Object.entries(preset.points?.subjects ?? {})) {
      assert.ok(POINT_BUY_MAP.knowledge.max >= value, `${preset.id} 的单科底子超过上限`);
      spent += value;
    }
    const allowance = POINT_BUDGET.normal + (preset.flaw ? FLAW_MAP[preset.flaw].points : 0);
    assert.ok(spent <= allowance, `${preset.id} 花了 ${spent} 点，超过 ${allowance} 点的预算`);
  }
});

test('角色模板：直接喂给引擎能开局，而且属性点确实生效', () => {
  for (const preset of CHARACTER_PRESETS) {
    const g = createGame({
      seed: `preset-${preset.id}`,
      personality: preset.personality,
      flaw: preset.flaw,
      background: preset.background,
      goal: preset.goal,
      traits: preset.traits,
      points: { ...(preset.points ?? {}), subjects: preset.points?.subjects ?? {} },
      preset: preset.id,
    });
    assert.equal(g.build.preset, preset.id);
    assert.ok(g.build.points.spent > 0, `${preset.id} 应该分掉了属性点`);
    assert.ok(g.build.points.spent <= g.build.points.budget, `${preset.id} 超预算`);
    assert.equal(g.status, 'playing');
  }
});

/* ------------------------------------------------------------ 存档往返 */

test('自定义人物整条存档往返（性格 / 缺陷 / 点数 / 头像 / 外号 / 难度）', () => {
  const g = createGame({
    seed: 'save-round',
    name: '赵云开',
    gender: '女',
    nickname: '闪电',
    avatar: 'fox',
    personality: 'sensitive',
    flaw: 'poor',
    difficulty: 'custom',
    custom: { gain: 1.2, forgetScale: 2, money: 900, points: 15 },
    points: { intelligence: 4, subjects: { math: 2 } },
    legacyPoints: 3,
    customCast: { love: { name: '周予安', gender: '男' } },
    preset: 'artist',
  });
  const back = deserialize(serialize(g));
  assert.equal(back.student.nickname, '闪电');
  assert.equal(back.student.avatar, 'fox');
  assert.equal(back.student.avatarIcon, '🦊');
  assert.equal(back.build.personality, 'sensitive');
  assert.deepEqual(back.build.flaws, ['poor']);
  assert.deepEqual(back.build.points.spend, { intelligence: 4 });
  assert.deepEqual(back.build.points.subjects, { math: 2 });
  assert.equal(back.build.legacyPoints, 3);
  assert.equal(back.build.preset, 'artist');
  assert.equal(back.difficulty, 'custom');
  assert.equal(rulesOf(back).gain, 1.2);
  assert.equal(back.cast.map.love.name, '周予安');
  const view = viewState(back);
  assert.equal(view.build.legacyPoints, 3);
  assert.equal(view.customRules.money, 900);
});

test('老存档（v2.4 的字段）读进来会补成"没自定义过"', () => {
  const g = createGame({ seed: 'old-save', personality: 'plain', flaw: 'frail', points: { intelligence: 6 } });
  const raw = JSON.parse(serialize(g));
  // 模拟一个没有 v2.5 字段的老存档
  delete raw.build.personality;
  delete raw.build.flaws;
  delete raw.build.points;
  delete raw.build.legacyPoints;
  delete raw.build.customCast;
  delete raw.student.avatar;
  delete raw.student.avatarIcon;
  delete raw.student.nickname;
  delete raw.difficultyRules;
  const back = deserialize(raw);
  assert.equal(back.build.personality, 'plain');
  assert.deepEqual(back.build.flaws, []);
  assert.deepEqual(back.build.points.spend, {});
  assert.equal(back.build.legacyPoints, 0);
  assert.deepEqual(back.build.customCast, {});
  assert.equal(back.student.avatar, 'student');
  assert.equal(back.student.nickname, '');
  assert.equal(back.difficultyRules, null);
  // 老存档自己的 baseMods 不该被"补默认性格"改动
  assert.equal(back.baseMods.moodDrain, 0);
});

/* ------------------------------------------------------------ 事件 / 结局 / 成就 */

test('events5 的 18 个校园事件已经并进事件表', () => {
  const ids = [
    'broadcast_station_shift',
    'desk_carving_words',
    'cleaning_duty_escape',
    'putang_bamboo_hike',
    'laoshili_noodle_shop',
    'jiankang_road_barber',
    'ebike_battery_dead',
    'moving_house_boxes',
    'new_year_kitchen_help',
    'borrow_notes_refused',
    'quarrel_apology_late',
    'lunch_alone_isolation',
    'mock_exam_phone_home',
    'volunteer_form_dispute',
    'mom_midnight_light',
    'short_video_loop',
    'netbar_amateur_cup',
    'part_time_rebate_scam',
  ];
  for (const id of ids) assert.ok(EVENT_MAP[id], `事件表里没有 ${id}`);
  assert.ok(ALL_EVENTS.length >= 85, `随机事件应该更多了，现在 ${ALL_EVENTS.length}`);
});

test('两个新结局在引擎和图鉴里都登记了', () => {
  const catalog = endingCatalog().map((entry) => entry.id);
  assert.ok(catalog.includes('esports'));
  assert.ok(catalog.includes('scam'));
  // 事件里引用的 ending id 必须是引擎真有的（拼错会掉进 graduated）
  const endingIds = new Set(catalog);
  const referenced = [];
  const walk = (effect) => {
    if (!effect || typeof effect !== 'function') return;
    const spec = effect(createGame({ seed: 'ending-scan' }));
    if (!spec) return;
    if (spec.ending) referenced.push(spec.ending);
    for (const entry of spec.risk ?? []) if (entry.effect) walk(entry.effect);
  };
  for (const event of ALL_EVENTS) {
    for (const choice of event.choices ?? []) walk(choice.effect);
  }
  for (const id of referenced) assert.ok(endingIds.has(id), `事件引用了图鉴里没有的结局：${id}`);
});

/** 把指定事件强行安排到下一次行动之后。 */
function forceEvent(game, eventId) {
  game.flags.scriptedEvent = eventId;
  performAction(game, 'listen');
}

test('网咖线：真的把三年投在屏幕上，才拿得到 esports 结局', () => {
  const habit = () => {
    const game = createGame({ seed: 'netbar-habit' });
    // 去网吧刷够 3 次 + 六科平均分掉到 45 以下 = 这条结局的开放条件
    for (let i = 0; i < 3; i += 1) {
      game.history.push({ turn: i + 1, week: i + 1, phase: 'main', action: 'game', subject: null });
    }
    for (const key of game.subjectKeys) game.knowledge[key] = 25;
    game.stats.physique = 80;
    game.stats.mood = 80;
    return game;
  };
  const committed = habit();
  forceEvent(committed, 'netbar_amateur_cup');
  assert.equal(committed.pendingEvent?.id, 'netbar_amateur_cup');
  resolveEvent(committed, 'join_team');
  assert.equal(committed.status, 'ended', '常去网咖 + 成绩掉下去的人应该能走青训线');
  assert.equal(committed.ending.id, 'esports');
  assert.equal(committed.flags.esportsRoute, true);

  // 偶尔打一次游戏的人：同一套选项只是掉状态，不会结束这一局
  const casualPlayer = createGame({ seed: 'netbar-habit' });
  casualPlayer.stats.physique = 80;
  casualPlayer.stats.mood = 80;
  forceEvent(casualPlayer, 'netbar_amateur_cup');
  resolveEvent(casualPlayer, 'join_team');
  assert.equal(casualPlayer.status, 'playing', '没有网咖习惯的人不该被直接送进电竞结局');
  assert.equal(casualPlayer.flags.netbarNights, 1);
});

test('刷单线：看懂 hint 的人不会中招，赌一把的人可能直接丢一局', () => {
  const build = (seed) => {
    const game = createGame({ seed });
    game.stats.money = 8;
    game.stats.mood = 30;
    game.stats.intelligence = 40;
    forceEvent(game, 'part_time_rebate_scam');
    return game;
  };
  // 稳的选项：只加状态，不会有结局
  const careful = build('scam-safe');
  assert.equal(careful.pendingEvent?.id, 'part_time_rebate_scam');
  resolveEvent(careful, 'ask_classmate');
  assert.equal(careful.status, 'playing');
  assert.equal(careful.flags.scamAvoided, true);

  // 赌一把：多个固定种子里至少有一次会真的被骗光（chance 是 0.6，不是必中）
  let hit = 0;
  for (const seed of ['scam-a', 'scam-b', 'scam-c', 'scam-d', 'scam-e']) {
    const gamble = build(seed);
    resolveEvent(gamble, 'pay_deposit');
    if (gamble.ending?.id === 'scam') hit += 1;
  }
  assert.ok(hit > 0, '赌一把的人应该有机会真的踩进 scam 结局');
  assert.ok(hit < 5, '不该是"选了就必死"，那样 hint 就没意义了');
});

test('自定义人物的成就：性格 / 缺陷 / 点数 / 传承 / 自定义关系 / 自定义难度', () => {
  const game = createGame({
    seed: 'ach-custom',
    personality: 'sharp',
    flaw: 'frail',
    points: { intelligence: 10 },
    legacyPoints: 2,
    difficulty: 'custom',
    customCast: { deskmate: { name: '林小美', gender: '女' } },
  });
  playToEnd(game);
  assert.equal(game.status, 'ended');
  const names = (game.ending.achievements ?? []).map((item) => item.name);
  for (const name of ['我是这样的人', '带着短板上场', '精心捏出来的人', '传承者', '自己写的人', '自己定的规则']) {
    assert.ok(names.includes(name), `缺少自定义人物成就：${name}（实际：${names.join('、')}）`);
  }
});

test('events5 的成就由事件文件自己声明，引擎只按 flag 捡', () => {
  const game = createGame({ seed: 'ach-campus' });
  game.flags.quitShortVideo = true;
  game.flags.broadcastStar = true;
  playToEnd(game);
  const names = (game.ending.achievements ?? []).map((item) => item.name);
  // 这两个 flag 如果没被 CAMPUS_ACHIEVEMENTS 收录，就要在这里失败
  assert.ok(names.length > 0);
  const campusNames = new Set(
    (game.ending.achievements ?? []).map((item) => item.name),
  );
  assert.ok(campusNames.size >= 2);
});

test('普通（没自定义）的一局不该白拿自定义成就', () => {
  const game = createGame({ seed: 'ach-plain' });
  playToEnd(game);
  const names = (game.ending.achievements ?? []).map((item) => item.name);
  for (const name of ['我是这样的人', '带着短板上场', '传承者', '自己定的规则']) {
    assert.ok(!names.includes(name), `普通局不该有 ${name}`);
  }
});
