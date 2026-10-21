/**
 * 人情账本自检（v3.7）。
 *
 * 这个机制的承诺是三句话，测试也就盯这三句：
 *   1. **借得到、当场有用**：接受人情真的给你东西（时间/心情/知识/钱），否则没人会欠；
 *   2. **账一定到期**：到点必弹（因果链，概率挤不掉），还 / 拖 / 赖三条路都有可观测后果；
 *   3. **拖会滚利息、赖会没信用**：拖一次账升一级，赖两条就 `favorBadName`——
 *      而且"账已经清了"的讨债链必须作废，不能出现"来讨一笔已经还掉的人情"。
 *
 * 另外一组是内容守门：12 个事件必须真的在事件表里、在校历里、被引擎跑得通。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_EVENTS,
  EVENT_MAP,
  NPCS,
  STAT_META,
  collectAchievements,
  createGame,
  deserialize,
  listActions,
  performAction,
  resolveEvent,
  runSummary,
  serialize,
  viewState,
} from '../src/engine.js';
import {
  FAVOR_ACHIEVEMENTS,
  FAVOR_ACTIONS,
  FAVOR_BAD_NAME_AT,
  FAVOR_BY_COLLECT,
  FAVOR_BY_OFFER,
  FAVOR_MAP,
  FAVORS,
  FAVOR_PRESSURE_LIMIT,
  delayFavor,
  favorPressure,
  weeksLeftOf,
} from '../src/data/favors.js';
import { EVENT_SCHEDULE, scheduleFor } from '../src/data/calendar.js';

const NPC_KEYS = NPCS.map((npc) => npc.key);

const newGame = (overrides = {}) =>
  createGame({ name: '人情', seed: 'favor-1', weeksPerSemester: 3, volunteers: false, ...overrides });

/** 打一个阶段（不做事件选择，留给调用方）。 */
function step(game) {
  const actions = listActions(game);
  const action = actions.find((item) => item.available && item.id === 'study') ?? actions.find((item) => item.available);
  assert.ok(action, '总该有能做的行动');
  performAction(game, action.id, { subject: action.subjectOptions?.[0]?.key });
}

/**
 * 强制弹出某个事件（走引擎自己的 scriptedEvent 通道，不钻后门）。
 * 剧情章节会抢在这个通道前面（`advanceStory` 会先排队），所以这里允许重试几次。
 */
function forceEvent(game, id) {
  assert.ok(EVENT_MAP[id], `事件 ${id} 不存在`);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    game.flags.scriptedEvent = id;
    step(game);
    if (game.pendingEvent?.id === id) return game.pendingEvent;
    // 被剧情抢了：把它处理掉再试
    if (game.pendingEvent) resolveEvent(game, game.pendingEvent.choices[0].id);
    if (game.status !== 'playing') break;
  }
  assert.fail(`应该弹出 ${id}，实际是 ${game.pendingEvent?.id ?? '（无）'}`);
}

/** 借一笔人情：弹 offer → 选"接受"那个选项。 */
function borrow(game, kind, choiceId = null) {
  const meta = FAVOR_MAP[kind];
  const event = EVENT_MAP[meta.offerEvent];
  const accept = event.choices.find((choice) => choice.effect?.favor?.kind);
  assert.ok(accept, `${meta.offerEvent} 必须有一个选项带 favor.kind`);
  const pending = forceEvent(game, meta.offerEvent);
  const id = choiceId ?? accept.id;
  assert.ok(pending.choices.some((choice) => choice.id === id));
  resolveEvent(game, id);
  return (game.favors ?? []).find((entry) => entry.kind === kind);
}

/** 弹出某一笔人情的讨债环（走同一个强制通道；链本身的兑现另有专门用例）。 */
function forceCollect(game, kind) {
  const meta = FAVOR_MAP[kind];
  // 模拟"这条链已经到点弹出来了"：真实流程里 rollEvent 会把它从队列里取走
  game.chains = (game.chains ?? []).filter((item) => item.id !== meta.collectEvent);
  const pending = forceEvent(game, meta.collectEvent);
  assert.ok(pending.favorId, '讨债环必须认出是哪一笔账');
  return pending;
}

test('账一定到期：排上的讨债链会真的弹出来，而且不会提前', () => {
  const game = newGame({ seed: 'favor-due' });
  const favor = borrow(game, 'meal'); // 账期最短的一条（4 回合）
  assert.ok(favor);
  assert.equal(game.pendingEvent, null);

  let seen = null;
  for (let i = 0; i < 80 && game.status === 'playing'; i += 1) {
    if (game.pendingEvent?.id === 'favor_collect_meal') {
      seen = game.pendingEvent;
      break;
    }
    if (game.pendingEvent) {
      resolveEvent(game, game.pendingEvent.choices[0].id);
      continue;
    }
    step(game);
  }
  assert.ok(seen, '到点了讨债环必须自己弹出来（因果链的承诺）');
  assert.ok(game.turn >= favor.dueTurn, `不能提前弹（打到的回合 ${game.turn}，到期 ${favor.dueTurn}）`);
  assert.equal(seen.favorId, favor.id, '弹出的必须是这一笔账，不能是别的');
});

test('人情表本身是干净的：6 条、事件都在、数量都合法', () => {
  assert.ok(FAVORS.length >= 6);
  const ids = FAVORS.map((favor) => favor.id);
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复');
  for (const favor of FAVORS) {
    assert.ok(EVENT_MAP[favor.offerEvent], `${favor.id} 的 offerEvent 不在事件表里`);
    assert.ok(EVENT_MAP[favor.collectEvent], `${favor.id} 的 collectEvent 不在事件表里`);
    assert.ok(NPC_KEYS.includes(favor.npc), `${favor.id} 的人情对象 ${favor.npc} 不是已知人物`);
    assert.ok(favor.delay >= 2 && favor.delay <= 12, `${favor.id} 的账期应该是 2~12 回合`);
    for (const action of FAVOR_ACTIONS) {
      const rule = favor.actions[action];
      assert.ok(rule, `${favor.id} 缺 ${action}`);
      assert.ok(String(rule.label ?? '').trim(), `${favor.id}.${action} 缺 label`);
      for (const [key, value] of Object.entries(rule.stats ?? {})) {
        assert.ok(STAT_META[key], `${favor.id}.${action} 写了不存在的属性 ${key}`);
        assert.ok(Number.isFinite(value));
      }
      for (const [key, value] of Object.entries(rule.npc ?? {})) {
        assert.ok(NPC_KEYS.includes(key), `${favor.id}.${action} 写了不存在的人物 ${key}`);
        assert.ok(Number.isFinite(value));
      }
      assert.ok(!rule.chain, '人情结算不该自己排链，引擎会排');
    }
    // 还债必须是"有成本"的：要么花时间/疲劳/钱，要么真的掉心情
    const repay = favor.actions.repay;
    const cost = (repay.stats?.fatigue ?? 0) + Math.abs(repay.money ?? 0) / 100;
    assert.ok(cost > 0, `${favor.id} 的"还"没有成本，就变成白拿好处了`);
    // 赖账必须比拖延更伤（不然没人会选拖延）
    const refuseNpc = Math.abs(Object.values(favor.actions.refuse.npc ?? {})[0] ?? 0);
    const delayNpc = Math.abs(Object.values(favor.actions.delay.npc ?? {})[0] ?? 0);
    assert.ok(refuseNpc > delayNpc, `${favor.id}：赖账应该比拖延更伤关系`);
  }
});

test('12 个事件都在事件表与校历里，且各自只有一个 favor 落点', () => {
  const expected = FAVORS.flatMap((favor) => [favor.offerEvent, favor.collectEvent]);
  for (const id of expected) {
    assert.ok(id in EVENT_SCHEDULE, `${id} 没有在校历里登记`);
    assert.ok(matchesAnytime(id), `${id} 应该是 anytime 事件`);
  }
  for (const favor of FAVORS) {
    const offer = EVENT_MAP[favor.offerEvent];
    assert.equal(offer.kind, 'choice');
    assert.ok(!offer.chainOnly, 'offer 环要进随机池，不能 chainOnly');
    const accepts = offer.choices.filter((choice) => choice.effect?.favor?.kind);
    assert.equal(accepts.length, 1, `${favor.offerEvent} 应该恰好一个选项借下人情`);
    assert.equal(accepts[0].effect.favor.kind, favor.id);

    const collect = EVENT_MAP[favor.collectEvent];
    assert.equal(collect.kind, 'choice');
    assert.equal(collect.chainOnly, true, '讨债环只能被链出来');
    const resolves = collect.choices.map((choice) => choice.effect?.favor?.resolve).filter(Boolean);
    assert.deepEqual(resolves.slice().sort(), ['delay', 'refuse', 'repay'], `${favor.collectEvent} 三个选项要齐`);
    assert.ok(collect.choices.length >= 3);
    // 文案不能有没替换掉的占位符（{unknown} 这种）
    for (const text of [offer.text, collect.text, ...collect.choices.map((choice) => choice.outcome)]) {
      assert.ok(!/\{(?!deskmate|friend|math|rival|parents|father|mother|head|love|subject|name)/.test(String(text)), `占位符写错了：${text}`);
    }
  }
  // 反查表也要对得上
  for (const favor of FAVORS) {
    assert.equal(FAVOR_BY_OFFER[favor.offerEvent]?.id, favor.id);
    assert.equal(FAVOR_BY_COLLECT[favor.collectEvent]?.id, favor.id);
  }
});

function matchesAnytime(id) {
  const schedule = scheduleFor('event', id);
  return Boolean(schedule && (schedule.anytime || Array.isArray(schedule.anytime)));
}

test('借到人情：账本记上、好处当场落、讨债链已经排好', () => {
  const a = newGame({ seed: 'favor-borrow-a' });
  const b = newGame({ seed: 'favor-borrow-a' });
  const before = { mood: a.stats.mood, fatigue: a.stats.fatigue };

  const favor = borrow(a, 'notes');
  assert.ok(favor, '借笔记应该记进账本');
  assert.equal(favor.status, 'open');
  assert.equal(favor.person, 'deskmate');
  assert.equal(favor.level, 1);
  assert.equal(favor.dueTurn, a.turn + FAVOR_MAP.notes.delay);
  assert.ok(a.chains.some((entry) => entry.id === 'favor_collect_notes'), '到点必弹的链要排上');

  // 同种子对照局：选"婉拒"的那一支，不该有账
  const pendingB = forceEvent(b, 'favor_offer_notes');
  const decline = EVENT_MAP.favor_offer_notes.choices.find((choice) => !choice.effect?.favor);
  resolveEvent(b, decline.id);
  assert.equal((b.favors ?? []).length, 0, '婉拒不该欠账');
  // 接受的那一支真的多拿了心情（同种子的行动效果一致，差的只有人情那一笔）
  assert.ok(a.stats.mood - before.mood > b.stats.mood - before.mood, '借笔记应该比婉拒多拿一点心情');
});

test('六条人情都能走完整条链：借 → 到期 → 还清', () => {
  for (const meta of FAVORS) {
    const game = newGame({ seed: `favor-roundtrip-${meta.id}` });
    const favor = borrow(game, meta.id);
    assert.ok(favor, `${meta.id} 应该借得到`);
    forceCollect(game, meta.id);
    resolveEvent(game, EVENT_MAP[meta.collectEvent].choices.find((choice) => choice.effect.favor.resolve === 'repay').id);
    const after = game.favors.find((entry) => entry.id === favor.id);
    assert.equal(after.status, 'repaid', `${meta.id} 还完之后账要清`);
    assert.ok(game.flags.favorRepaidOnce, '第一次还清要解锁成就 flag');
    assert.equal(game.pendingEvent, null);
  }
});

test('还清的账不会再来讨：作废的讨债链会被丢掉，而不是弹一个"记错"的事件', () => {
  const game = newGame({ seed: 'favor-stale-chain' });
  const favor = borrow(game, 'notes');
  forceCollect(game, 'notes');
  resolveEvent(game, EVENT_MAP.favor_collect_notes.choices.find((choice) => choice.effect.favor.resolve === 'repay').id);
  assert.equal(game.favors.find((entry) => entry.id === favor.id).status, 'repaid');

  // 手工塞一条"指向已还清人情"的链：之后几拍里它必须被丢掉，绝不能被弹出来
  game.chains.push({ id: 'favor_collect_notes', atTurn: game.turn });
  let firedStale = false;
  for (let i = 0; i < 8 && game.status === 'playing'; i += 1) {
    if (game.pendingEvent?.id === 'favor_collect_notes') firedStale = true;
    if (game.pendingEvent) {
      resolveEvent(game, game.pendingEvent.choices[0].id);
      continue;
    }
    step(game);
  }
  assert.equal(firedStale, false, '已经还清的账不能再弹讨债');
  assert.equal(game.chains.some((entry) => entry.id === 'favor_collect_notes'), false, '该死链要被清掉');
});

test('拖延会滚利息：账升一级、期限缩短、而且重新排链', () => {
  const game = newGame({ seed: 'favor-delay' });
  const favor = borrow(game, 'notes');
  const chainsBefore = (game.chains ?? []).filter((item) => item.id === 'favor_collect_notes').length;
  forceCollect(game, 'notes');
  const dueBefore = favor.dueTurn;
  resolveEvent(game, EVENT_MAP.favor_collect_notes.choices.find((choice) => choice.effect.favor.resolve === 'delay').id);

  const after = game.favors.find((entry) => entry.id === favor.id);
  assert.equal(after.status, 'open', '拖延之后账还在');
  assert.equal(after.level, 2, '拖一次要升一级');
  assert.ok(after.dueTurn < dueBefore, '期限要缩短');
  assert.equal(after.delayed, 1);
  // 拖完必须重新排链，而且新链的到期回合 = 账本上新的 dueTurn
  const armed = (game.chains ?? []).filter((item) => item.id === 'favor_collect_notes');
  assert.equal(armed.length, 1, '拖完必须重新排一条链（下一次还会来）');
  assert.equal(armed[0].atTurn, after.dueTurn, '链的到期回合要和账本一致');
  assert.ok(game.flags.favorDelayedNotes, '拖延要留 flag');
  // 原链已经被"弹出"过一次，所以排完仍然只有一条待弹的链
  assert.equal(chainsBefore, 1);
  // delayFavor 是纯函数，单独验一下契约
  assert.deepEqual(delayFavor({ kind: 'notes', level: 3 }), { level: 3, delay: Math.max(2, FAVOR_MAP.notes.delay - 2) });
});

test('赖账：关系大幅下降，赖够两条就"在班里没信用了"', () => {
  const game = newGame({ seed: 'favor-refuse' });
  const before = game.npc.deskmate;
  const favor = borrow(game, 'notes');
  forceCollect(game, 'notes');
  resolveEvent(game, EVENT_MAP.favor_collect_notes.choices.find((choice) => choice.effect.favor.resolve === 'refuse').id);

  const after = game.favors.find((entry) => entry.id === favor.id);
  assert.equal(after.status, 'refused');
  assert.ok(game.npc.deskmate < before, '赖账要掉关系');
  assert.ok(game.flags.favorRefusedOnce);
  assert.equal(game.flags.favorBadName, undefined, '只赖一笔还不算没信用');

  // 再来一笔：赖够两条
  const second = borrow(game, 'homework', EVENT_MAP.favor_offer_homework.choices.find((choice) => choice.effect?.favor?.kind).id);
  assert.ok(second);
  forceCollect(game, 'homework');
  resolveEvent(game, EVENT_MAP.favor_collect_homework.choices.find((choice) => choice.effect.favor.resolve === 'refuse').id);
  assert.equal(game.flags.favorBadName, true, `赖满 ${FAVOR_BAD_NAME_AT} 条要有"没信用"标记`);
});

test('欠太多会压着心情：每周扣心情，而且结算里说得出来', () => {
  // 同种子对照：A 欠 3 笔（超过阈值 2 条），B 不欠。同样的行动序列，差别只该是账本压力。
  const a = newGame({ seed: 'favor-pressure' });
  const b = newGame({ seed: 'favor-pressure' });
  for (let i = 0; i < 3; i += 1) {
    a.favors.push({ id: `manual_${i}`, kind: 'notes', person: 'deskmate', level: 1, fromTurn: 0, dueTurn: 99, status: 'open' });
  }
  assert.equal(favorPressure(3).moodPerWeek, 0.6 * (3 - FAVOR_PRESSURE_LIMIT));
  assert.equal(favorPressure(FAVOR_PRESSURE_LIMIT).moodPerWeek, 0, '没超过阈值就不该扣');

  // 两局走同一拍（同样的行动、同样的选择），走到第一周结算
  const playOneWeek = (game, onLines) => {
    const turn = game.turn;
    let guard = 0;
    while (game.status === 'playing' && game.turn === turn && guard < 20) {
      guard += 1;
      if (game.pendingEvent) {
        const choice = game.pendingEvent.choices[0];
        // 注意：resolveEvent 必须**无条件**调用。写成 `onLines?.(resolveEvent(...))`
        // 会在 onLines 为 undefined 时把整个实参短路掉（可选调用不求解实参），
        // 结果就是"事件永远处理不完"——这个坑值得留一行注释。
        const resolved = resolveEvent(game, choice.id);
        onLines?.(resolved.lines);
        continue;
      }
      const actions = listActions(game);
      const action = actions.find((item) => item.available && item.id === 'study') ?? actions.find((item) => item.available);
      const result = performAction(game, action.id, { subject: action.subjectOptions?.[0]?.key });
      onLines?.(result.lines);
    }
  };
  const lines = [];
  playOneWeek(a, (batch) => lines.push(...batch));
  playOneWeek(b);

  assert.ok(a.turn >= 1 && b.turn >= 1, `两局都应该走到第一周（${a.turn}/${b.turn}）`);
  assert.ok(lines.some((line) => line.includes('人情')), `结算里应该提到账本压力：${lines.join('｜')}`);
  assert.ok(b.stats.mood - a.stats.mood > 0.3, `欠三笔每周该多掉心情（差 ${(b.stats.mood - a.stats.mood).toFixed(2)}）`);
});

test('账本在 view / 摘要里都拿得到，周数是真算出来的', () => {
  const game = newGame({ seed: 'favor-view' });
  const favor = borrow(game, 'tutoring');
  const view = viewState(game).favors;
  assert.equal(view.open.length, 1);
  const row = view.open[0];
  assert.equal(row.kind, 'tutoring');
  assert.equal(row.person, 'math');
  assert.ok(row.personName && row.personName !== 'math', '人物名要翻译成人话');
  assert.ok(row.title && row.what);
  assert.equal(row.weeksLeft, weeksLeftOf(favor, game.turn));
  assert.ok(row.repayLabel && row.levelLabel);
  assert.equal(view.summary.open, 1);
  assert.deepEqual(view.pressure, { count: 1, limit: FAVOR_PRESSURE_LIMIT, over: 0, moodPerWeek: 0, active: false });
  assert.equal(runSummary(game).favors.open, 1, '摘要里要能看出这一局欠了几笔（榜单/图鉴口径）');

  forceCollect(game, 'tutoring');
  resolveEvent(game, EVENT_MAP.favor_collect_tutoring.choices.find((choice) => choice.effect.favor.resolve === 'repay').id);
  const after = viewState(game).favors;
  assert.equal(after.open.length, 0);
  assert.equal(after.summary.repaid, 1);
  assert.equal(after.history.at(-1).action, 'repay');
});

test('人情自带的成就能被捡到；一局不欠账拿"万事不求人"', () => {
  // 1) 还一笔 → 有借有还
  const repaid = newGame({ seed: 'favor-ach-1' });
  borrow(repaid, 'notes');
  forceCollect(repaid, 'notes');
  resolveEvent(repaid, EVENT_MAP.favor_collect_notes.choices.find((choice) => choice.effect.favor.resolve === 'repay').id);
  const names = collectAchievements(repaid).map((item) => item.name);
  assert.ok(names.includes('有借有还'), `还清应该解锁成就，现在只有：${names.join('、')}`);

  // 2) 一局打到结局且一条人情都没欠 → 万事不求人
  const clean = newGame({ seed: 'favor-ach-clean', weeksPerSemester: 2 });
  let guard = 0;
  while (clean.status === 'playing' && guard < 200) {
    guard += 1;
    if (clean.pendingEvent) {
      const pending = clean.pendingEvent;
      const event = EVENT_MAP[pending.id];
      const safe = event.choices.find((choice) => !choice.effect?.favor?.kind) ?? event.choices[0];
      resolveEvent(clean, safe.id);
      continue;
    }
    step(clean);
  }
  assert.notEqual(clean.status, 'playing', `应该能打完（${clean.status}）`);
  assert.equal((clean.favors ?? []).length, 0, '这一局不该欠人情');
  assert.ok(clean.flags.favorClean);
  const endingNames = (clean.ending?.achievements ?? []).map((item) => item.name);
  assert.ok(endingNames.includes('万事不求人'), `结局里应该有这个成就：${endingNames.join('、')}`);
});

test('存档往返不丢账本；老存档/手改存档都安全降级', () => {
  const game = newGame({ seed: 'favor-save' });
  const favor = borrow(game, 'parents_cover');
  const back = deserialize(serialize(game));
  assert.equal(back.favors.length, 1);
  assert.equal(back.favors[0].kind, 'parents_cover');
  assert.equal(back.favors[0].id, favor.id);
  assert.equal(back.favorLog.length, 0);

  const old = JSON.parse(serialize(newGame({ seed: 'favor-old' })));
  delete old.favors;
  delete old.favorLog;
  const restored = deserialize(old);
  assert.deepEqual(restored.favors, []);
  assert.deepEqual(restored.favorLog, []);
  assert.equal(viewState(restored).favors.open.length, 0);

  const dirty = JSON.parse(serialize(newGame({ seed: 'favor-dirty' })));
  dirty.favors = [
    { kind: 'hack', status: 'open' },
    { kind: 'notes', status: 'weird', level: 99 },
    { kind: 'meal', status: 'repaid' },
  ];
  dirty.favorLog = [{ kind: 'nope' }, { kind: 'notes', action: 'nonsense', personName: 42 }];
  const clean = deserialize(dirty);
  assert.equal(clean.favors.length, 2, '未知 kind 要丢掉');
  assert.equal(clean.favors[0].level, 3, 'level 要夹到 1~3');
  assert.equal(clean.favors[0].status, 'open', '非法状态回落到 open');
  assert.equal(clean.favors[1].status, 'repaid');
  assert.equal(clean.favorLog.length, 1);
  assert.equal(clean.favorLog[0].action, 'repay', '非法动作回落到 repay');
});

test('人情成就表本身是干净的：flag 唯一、文案齐、不与既有成就撞 flag', () => {
  const flags = FAVOR_ACHIEVEMENTS.map((item) => item.flag);
  assert.equal(new Set(flags).size, flags.length);
  for (const item of FAVOR_ACHIEVEMENTS) assert.ok(item.icon && item.name && item.desc);
  // 事件表里的事件 id 不能和人情的 id 撞
  const eventIds = new Set(ALL_EVENTS.map((event) => event.id));
  for (const favor of FAVORS) assert.ok(!eventIds.has(favor.id), `${favor.id} 和事件 id 撞了`);
});
