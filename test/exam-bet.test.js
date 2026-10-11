/**
 * 考前押卷自检（v3.6）。
 *
 * 这个机制容易做坏的地方只有三个，所以测试也只盯这三件事：
 *   1. **不能是免费加分**：四档的期望系数都在 1 附近（差得太远就退化成"每场考试点一下的税"）；
 *   2. **账一定要结**：押中/押错的差别必须落在分数、知识、状态上，而不是日志里的一句旁白；
 *   3. **不许动随机流**：同种子下"押与不押"的 rngState 与未押科目的分数逐位相同——
 *      这也是它不破坏已有 400 多条测试、不破坏"同种子同结果"承诺的前提。
 *
 * 另外还有一组守门：存档兼容、白名单（前端塞字段没用）、服务端与离线接口必须同时有这条路由。
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ALL_EVENTS,
  GameError,
  createGame,
  deserialize,
  listActions,
  performAction,
  placeExamBet,
  resolveEvent,
  runSummary,
  serialize,
  viewState,
} from '../src/engine.js';
import {
  BET_ACHIEVEMENTS,
  BET_MODES,
  EXAM_BETS,
  FOCUS_BACKFIRE_MUL,
  betRoll,
  chanceFor,
  expectedFactor,
  focusChance,
  gambleChance,
  hitFactor,
  missFactor,
  normalizeBet,
} from '../src/data/exam-bets.js';
import { createGameServer } from '../src/server.js';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const newGame = (overrides = {}) =>
  createGame({ name: '押卷', seed: 'bet-1', weeksPerSemester: 2, volunteers: false, ...overrides });

/** 打一个阶段（行动 + 处理掉弹出来的事件）。 */
function playPhase(game) {
  const actions = listActions(game);
  const action = actions.find((item) => item.available && item.id === 'study') ?? actions.find((item) => item.available);
  assert.ok(action, '总该有一个能做的行动');
  performAction(game, action.id, { subject: action.subjectOptions?.[0]?.key });
  while (game.pendingEvent) resolveEvent(game, game.pendingEvent.choices[0].id);
}

/** 推进一整周（主行动 + 周末）：考试是在这一周结束时考的。 */
function playTurn(game) {
  const turn = game.turn;
  let guard = 0;
  while (game.status === 'playing' && game.turn === turn && guard < 4) {
    guard += 1;
    playPhase(game);
  }
}

/** 一直打到下一场考试考完（押卷窗口在开局就开着，两周学期里第一场考试在第 2 周末）。 */
function playUntilExam(game, maxTurns = 8) {
  const target = game.exams.length + 1;
  let guard = 0;
  while (game.status === 'playing' && game.exams.length < target && guard < maxTurns) {
    guard += 1;
    playTurn(game);
  }
  assert.ok(game.exams.length >= target, '应该能打到下一场考试');
}

const twinKey = (game) =>
  JSON.stringify({ rng: game.rngState, stats: game.stats, knowledge: game.knowledge, npc: game.npc });

test('押卷表本身是干净的：id 唯一、文案齐、不跟事件撞名', () => {
  assert.ok(EXAM_BETS.length >= 3);
  const ids = EXAM_BETS.map((bet) => bet.id);
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复');
  for (const id of ids) assert.ok(BET_MODES.includes(id), `${id} 不在 BET_MODES 里`);
  for (const bet of EXAM_BETS) {
    for (const field of ['name', 'icon', 'desc', 'risk', 'gain']) {
      assert.ok(String(bet[field] ?? '').trim().length > 0, `${bet.id} 缺 ${field}`);
    }
  }
  const eventIds = new Set(ALL_EVENTS.map((event) => event.id));
  for (const id of ids) assert.ok(!eventIds.has(id), `押卷 id ${id} 和事件 id 撞了`);
  const flags = BET_ACHIEVEMENTS.map((item) => item.flag);
  assert.equal(new Set(flags).size, flags.length, '成就 flag 不能重复');
  for (const item of BET_ACHIEVEMENTS) assert.ok(item.icon && item.name && item.desc);
});

test('四档的期望系数都在 1 附近——没有免费加分的一档', () => {
  const rows = [
    ['focus', focusChance({ comprehensive: 50 })],
    ['focus', focusChance({ comprehensive: 100, weakKeys: ['math'], subject: 'math' })],
    ['focus', focusChance({ comprehensive: 0 })],
    ['gamble', gambleChance()],
    ['rest', 1],
    ['none', 1],
  ];
  for (const [mode, p] of rows) {
    const ev = expectedFactor(mode, p);
    assert.ok(Math.abs(ev - 1) <= 0.08, `${mode}（命中率 ${p}）的期望系数是 ${ev}，偏离 1 太远`);
  }
  // 押错一定比不押差、押中一定比不押好（否则"赌"没有意义）
  assert.ok(missFactor('focus') < 1 && hitFactor('focus') > 1);
  assert.ok(missFactor('gamble') < 1 && hitFactor('gamble') > 1);
  // 综合素质越高越会看风向；押自己的弱科还有一点信息加成
  assert.ok(focusChance({ comprehensive: 90 }) > focusChance({ comprehensive: 20 }));
  assert.ok(
    focusChance({ comprehensive: 50, weakKeys: ['math'], subject: 'math' }) >
      focusChance({ comprehensive: 50, weakKeys: [], subject: 'math' }),
  );
  // 命中率必须是概率
  for (const value of [focusChance({ comprehensive: 0 }), focusChance({ comprehensive: 100 }), gambleChance()]) {
    assert.ok(value > 0 && value < 1);
  }
});

test('sanitize 白名单：未知模式、非法科目、夹带数值一律丢掉', () => {
  assert.equal(normalizeBet({ mode: 'focus' }, ['math']), null, 'focus 必须给科目');
  assert.equal(normalizeBet({ mode: 'focus', subject: 'nope' }, ['math']), null);
  assert.equal(normalizeBet({ mode: 'hack', subject: 'math' }, ['math']), null);
  assert.equal(normalizeBet(null, ['math']), null);
  assert.deepEqual(normalizeBet({ mode: 'gamble', subject: 'math', factor: 9, score: 750 }, ['math']), {
    mode: 'gamble',
    subject: null,
  });
  assert.deepEqual(normalizeBet({ mode: 'focus', subject: 'math' }, ['math']), { mode: 'focus', subject: 'math' });
});

test('betRoll 只读随机状态：同输入同结果，且不会推进它', () => {
  const state = 1234567;
  const first = betRoll(state, 'a|b|c');
  assert.equal(first, betRoll(state, 'a|b|c'));
  assert.ok(first >= 0 && first < 1);
  assert.notEqual(betRoll(state, 'a|b|c'), betRoll(state, 'a|b|d'));
  assert.notEqual(betRoll(state, 'a|b|c'), betRoll(state + 1, 'a|b|c'));
});

test('窗口：考得还早不让押，考前一星期才开；押过之后不能再改', () => {
  const far = createGame({ name: '押卷', seed: 'bet-far', weeksPerSemester: 6, volunteers: false });
  const farState = viewState(far).examBet;
  assert.equal(farState.available, false);
  assert.match(farState.reason, /周/, '不可押时必须说清楚还要等几周');
  assert.ok(farState.exam && farState.exam.inWeeks > 1);

  const game = newGame({ seed: 'bet-window' });
  const state = viewState(game).examBet;
  assert.equal(state.available, true, '考前一周应该可以押');
  assert.ok(state.inWeeks <= 1, '窗口应该已经开了');
  assert.equal(state.options.length, EXAM_BETS.length);
  assert.ok(state.subjects.length >= 3, '至少要能选到几门科目');

  placeExamBet(game, { mode: 'focus', subject: state.subjects[0].key });
  const after = viewState(game).examBet;
  assert.equal(after.available, false);
  assert.match(after.reason, /押过了/);
  assert.equal(after.placed.mode, 'focus');
  assert.equal(after.placed.subject, state.subjects[0].key);
  assert.ok(after.placed.hitChance > 0 && after.placed.hitChance < 1);
});

test('一场考试只能押一次：第二次直接抛错，而且不动任何数值', () => {
  const game = newGame({ seed: 'bet-once' });
  const key = viewState(game).examBet.subjects[0].key;
  placeExamBet(game, { mode: 'focus', subject: key });
  const before = twinKey(game);
  assert.throws(() => placeExamBet(game, { mode: 'gamble' }), GameError);
  assert.throws(() => placeExamBet(game, { mode: 'focus', subject: 'nope' }), GameError);
  assert.equal(twinKey(game), before, '被拒绝的下注不能留下任何痕迹');
});

test('押卷不消耗随机数：押与不押，rngState 与未押科目逐位相同', () => {
  const seed = 'bet-rng';
  const a = newGame({ seed });
  const b = newGame({ seed });
  assert.equal(a.rngState, b.rngState);

  const target = viewState(a).examBet.subjects[0].key;
  placeExamBet(a, { mode: 'focus', subject: target });
  assert.equal(a.rngState, b.rngState, '下注本身不能推进随机流');
  assert.equal(twinKey(a), twinKey(b), '下注本身不能改变任何数值');

  playUntilExam(a);
  playUntilExam(b);
  const examA = a.exams.at(-1);
  const examB = b.exams.at(-1);
  assert.ok(examA?.bet, '考完必须留下"这一场押了什么"');
  assert.equal(examA.bet.mode, 'focus');
  assert.equal(examA.bet.subject, target);
  assert.equal(a.rngState, b.rngState, '同一场考试跑完，随机流还是同一条');
  assert.deepEqual(a.knowledge, b.knowledge, '押卷改的是分数，不是知识');
  // 只有押的那一科允许不同，其余科目逐位相同
  for (const key of a.subjectKeys) {
    if (key === target) continue;
    assert.equal(examA.subjects[key], examB.subjects[key], `${key} 不该被押卷影响`);
  }
});

test('押中加分、押错扣分，而且分数差异跟声明的系数对得上', () => {
  // 命中判定在考试那一刻才掷，所以这里不猜：直接跑，跑到两种结果都出现为止。
  const scenarios = {};
  for (let i = 0; i < 40 && (!scenarios.hit || !scenarios.miss); i += 1) {
    const seed = `bet-branch-${i}`;
    const a = newGame({ seed });
    const b = newGame({ seed });
    const target = viewState(a).examBet.subjects[0].key;
    placeExamBet(a, { mode: 'focus', subject: target });
    playUntilExam(a);
    playUntilExam(b);
    const withBet = a.exams.at(-1);
    const without = b.exams.at(-1);
    assert.ok(withBet.bet && typeof withBet.bet.hit === 'boolean', '考完必须留下命中与否');
    const bucket = withBet.bet.hit ? 'hit' : 'miss';
    if (scenarios[bucket]) continue;
    scenarios[bucket] = { seed, target, withBet, without, game: a };
  }
  assert.ok(scenarios.hit && scenarios.miss, '40 个种子里应该两种结果都能碰到');

  for (const [bucket, info] of Object.entries(scenarios)) {
    const { withBet, without, target, game } = info;
    assert.equal(withBet.bet.subject, target);
    const ratio = withBet.subjects[target] / without.subjects[target];
    if (bucket === 'hit') {
      assert.ok(withBet.subjects[target] > without.subjects[target], '押中必须比不押高');
      assert.ok(ratio > 1.15 && ratio < 1.35, `押中的倍率应该接近 1.25，实测 ${ratio.toFixed(3)}`);
      assert.ok(game.flags.betHitFocus);
      assert.equal(game.flags.betBackfire, undefined, '押中不该留下还债');
    } else {
      assert.ok(withBet.subjects[target] < without.subjects[target], '押错必须比不押低');
      assert.ok(ratio > 0.62 && ratio < 0.82, `押错的倍率应该接近 0.72，实测 ${ratio.toFixed(3)}`);
      assert.ok(game.flags.betMissFocus);
      // 账一定要结：押掉的范围要真的在知识上还债，不是日志里一句话
      assert.ok(game.flags.betBackfire, '押错之后要有"还债"的记账');
      assert.equal(game.flags.betBackfire.key, target);
      assert.equal(game.flags.betBackfire.mul, FOCUS_BACKFIRE_MUL);
    }
    // 未押的科目逐位相同——押卷只碰它自己那一科
    for (const key of game.subjectKeys) {
      if (key === target) continue;
      assert.equal(withBet.subjects[key], without.subjects[key], `${key} 不该被押卷影响`);
    }
  }
});

test('押错的还债是真的：接下来那一科掉得比不押快，两周之后自己结束', () => {
  let scenario = null;
  for (let i = 0; i < 40 && !scenario; i += 1) {
    const seed = `bet-debt-${i}`;
    const a = newGame({ seed });
    const b = newGame({ seed });
    const target = viewState(a).examBet.subjects[0].key;
    placeExamBet(a, { mode: 'focus', subject: target });
    playUntilExam(a);
    playUntilExam(b);
    if (a.exams.at(-1).bet.hit === false) scenario = { a, b, target };
  }
  assert.ok(scenario, '应该能跑出一个押错的局面');
  const { a, b, target } = scenario;
  assert.ok(a.flags.betBackfire);

  const beforeA = a.knowledge[target];
  const beforeB = b.knowledge[target];
  playTurn(a); // 一周之后结算"不进则退"
  playTurn(b);
  const dropA = beforeA - a.knowledge[target];
  const dropB = beforeB - b.knowledge[target];
  assert.ok(dropA > dropB, `押错的那一科应该掉得更多（押错 ${dropA.toFixed(2)} vs 不押 ${dropB.toFixed(2)}）`);

  // 两周之后记账自己消失，不会跟着你一辈子
  for (let i = 0; i < 8 && a.flags.betBackfire && a.status === 'playing'; i += 1) playTurn(a);
  assert.equal(a.flags.betBackfire, undefined, '还债窗口过了就该清掉');
});

test('考前睡够不是赌：效果立刻落账，没有赌注也没有还债', () => {
  const game = newGame({ seed: 'bet-rest' });
  game.stats.fatigue = 70;
  const before = { fatigue: game.stats.fatigue, mood: game.stats.mood };
  const result = placeExamBet(game, { mode: 'rest' });
  assert.ok(result.lines.join('').includes('睡够'));
  assert.ok(game.stats.fatigue < before.fatigue, '疲劳要降下来');
  assert.ok(game.stats.mood >= before.mood, '心情不该更差');
  assert.ok(game.flags.betRest);
  playUntilExam(game);
  assert.equal(game.exams.at(-1).bet, undefined, '睡够不算赌注，成绩条上不该有押卷角标');
  assert.equal(game.flags.betBackfire, undefined);
  assert.equal(game.examBets.at(-1).mode, 'rest');
});

test('"不押"也会被记下来：考完看得见这一场没赌', () => {
  const game = newGame({ seed: 'bet-none' });
  placeExamBet(game, { mode: 'none' });
  playUntilExam(game);
  const entry = game.examBets.at(-1);
  assert.equal(entry.mode, 'none');
  assert.equal(entry.hit, null);
  assert.equal(game.exams.at(-1).bet, undefined);
});

test('存档往返不丢押卷状态；老存档（没有这两个字段）读出来是"没押过"', () => {
  const game = newGame({ seed: 'bet-save' });
  const key = viewState(game).examBet.subjects[0].key;
  placeExamBet(game, { mode: 'focus', subject: key });
  playUntilExam(game);
  const back = deserialize(serialize(game));
  assert.equal(back.examBets.length, game.examBets.length);
  assert.equal(back.examBets.at(-1).mode, 'focus');
  assert.equal(back.examBets.at(-1).kind, game.examBets.at(-1).kind);

  const old = JSON.parse(serialize(newGame({ seed: 'bet-old' })));
  delete old.examBet;
  delete old.examBets;
  const restored = deserialize(old);
  assert.equal(restored.examBet.decided, false);
  assert.equal(restored.examBet.mode, 'none');
  assert.deepEqual(restored.examBets, []);
  assert.equal(viewState(restored).examBet.available, true, '老存档读进来照样能押卷');

  // 手改过的存档：非法 mode / 非法科目一律回到干净初值
  const dirty = JSON.parse(serialize(newGame({ seed: 'bet-dirty' })));
  dirty.examBet = { mode: 'hack', subject: 'math', decided: true, factor: 10 };
  dirty.examBets = [{ mode: 'nope' }, { mode: 'gamble', hit: 'yes', factor: 'x' }];
  const clean = deserialize(dirty);
  assert.equal(clean.examBet.mode, 'none');
  assert.equal(clean.examBet.decided, false);
  assert.equal(clean.examBets.length, 1);
  assert.equal(clean.examBets[0].mode, 'gamble');
  assert.equal(clean.examBets[0].hit, null);
  assert.equal(clean.examBets[0].factor, 1);
});

test('界面要用的数据都在 view 里：选项、科目、历史、摘要', () => {
  const game = newGame({ seed: 'bet-view' });
  const state = viewState(game).examBet;
  assert.equal(state.options.length, EXAM_BETS.length);
  assert.deepEqual(
    state.subjects.map((subject) => subject.key),
    game.subjectKeys,
    '可押的科目必须和这一局真的考的科目一致',
  );
  for (const option of state.options) {
    assert.equal(typeof option.desc, 'string');
    assert.equal(typeof option.needsSubject, 'boolean');
    assert.ok(option.hitChance > 0 && option.hitChance <= 1);
  }

  const key = state.subjects[0].key;
  placeExamBet(game, { mode: 'focus', subject: key });
  playUntilExam(game);
  const after = viewState(game).examBet;
  assert.equal(after.history.length, 1);
  assert.equal(after.history[0].subjectName, state.subjects[0].name);
  assert.equal(after.summary.total, 1);
  assert.equal(after.summary.focus, 1);
  assert.equal(after.summary.hit + after.summary.miss, 1);
  assert.equal(viewState(game).exams.at(-1).bet.mode, 'focus');
  assert.equal(runSummary(game).bets.total, 1, '摘要里要能看出这一局押过几场（榜单口径）');
});

test('押卷的成就跟着 flag 走，一局打完能在结局里看到', () => {
  const game = newGame({ seed: 'bet-achieve' });
  let guard = 0;
  while (game.status === 'playing' && guard < 120) {
    guard += 1;
    if (viewState(game).examBet.available) placeExamBet(game, { mode: 'gamble' });
    playPhase(game);
  }
  assert.notEqual(game.status, 'playing', `应该在 guard 内打完（${game.status}）`);
  const names = (game.ending?.achievements ?? []).map((item) => item.name);
  const bets = game.examBets.filter((entry) => entry.mode === 'gamble');
  assert.ok(bets.length >= 6, `一场都没落下（实际 ${bets.length} 场）`);
  assert.ok(
    names.includes('赌对方向') || names.includes('白熬一周'),
    `押过就必须留下痕迹，现在只有：${names.join('、')}`,
  );
});

test('服务端与离线接口都有这条路由（别再出现"网页有、安卓没有"）', () => {
  const server = read('src/server.js');
  const local = read('web/local-api.js');
  assert.match(server, /pathname === '\/api\/exam-bet'/, '服务端缺 /api/exam-bet');
  assert.match(local, /route === '\/api\/exam-bet'/, '离线接口缺 /api/exam-bet');
  assert.match(server, /placeExamBet\(game, \{ mode: body\.mode, subject: body\.subject \}\)/);
  assert.match(local, /placeExamBet\(current, \{ mode: body\.mode, subject: body\.subject \}\)/);
  // 打包时的强制清单里要有它，否则 APK 少一个模块就是白屏
  assert.match(read('tools/build-apk.mjs'), /'src\/data\/exam-bets\.js'/, 'APK 打包清单缺 exam-bets.js');
});

test('接口真的能用：押下去能拿到新状态，重复押/非法选项/过期会话各有明确答复', async () => {
  const server = createGameServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const created = await (
      await post('/api/new', { name: '接口押卷', seed: 'bet-api', weeksPerSemester: 2, volunteers: false })
    ).json();
    const gameId = created.gameId;
    assert.equal(created.view.examBet.available, true);

    const subject = created.view.examBet.subjects[0].key;
    const bet = await post('/api/exam-bet', { gameId, mode: 'focus', subject });
    assert.equal(bet.status, 200);
    const payload = await bet.json();
    assert.ok(payload.lines.length > 0);
    assert.equal(payload.view.examBet.placed.mode, 'focus');
    assert.equal(payload.view.examBet.available, false);

    // 同一场再押一次：400，且错误信息是人话
    const again = await post('/api/exam-bet', { gameId, mode: 'gamble' });
    assert.equal(again.status, 400);
    assert.match((await again.json()).error, /押过/);

    // 非法选项也是 400（白名单）
    const illegal = await post('/api/exam-bet', { gameId, mode: 'focus', subject: 'astrology' });
    assert.equal(illegal.status, 400);

    // 会话过期：404
    const missing = await post('/api/exam-bet', { gameId: 'nope', mode: 'gamble' });
    assert.equal(missing.status, 404);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('chanceFor 与界面显示的概率保持一致（同一档不能有两个数）', () => {
  const game = newGame({ seed: 'bet-chance' });
  const state = viewState(game).examBet;
  const focus = state.options.find((option) => option.id === 'focus');
  assert.equal(focus.hitChance, focusChance({ comprehensive: game.stats.comprehensive, weakKeys: state.weakKeys }));
  assert.equal(state.options.find((option) => option.id === 'gamble').hitChance, gambleChance());
  assert.equal(chanceFor('rest', {}), 1);
  assert.equal(chanceFor('none', {}), 1);
});
