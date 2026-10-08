/**
 * AI 对战模式测试（v3.0）。
 *
 * 这个玩法最容易出的问题不是"算错分"，而是**两条时间线错位**：
 * 玩家打了 5 拍、AI 才打了 4 拍；或者 AI 的动作把玩家的随机数吃掉了，
 * 于是同一个种子的单人局和对战局结果不一样。所以下面一半的测试都在盯这两件事。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_RIVAL_LEVEL,
  MODES,
  RIVAL_LEVELS,
  autoFillVolunteers,
  createGame,
  creatorOptions,
  deserialize,
  performAction,
  playWeek,
  resolveEvent,
  runSummary,
  serialize,
  submitVolunteers,
  viewState,
} from '../src/engine.js';
import { createGameServer } from '../src/server.js';
import { createLocalApi } from '../web/local-api.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => readFileSync(join(root, ...relative.split('/')), 'utf8');
const node = process.execPath;

/** 一套固定的开局参数（同一个种子跑出来的东西必须一模一样）。 */
const BASE = {
  name: '我',
  seed: 'versus-test',
  difficulty: 'normal',
  weeksPerSemester: 4,
  track: 'physics',
  electives: ['chemistry', 'biology'],
  traits: ['memory', 'easygoing'],
};

/** 事件当场选完，返回选的是哪个。 */
function settleEvents(game, limit = 6) {
  let guard = 0;
  while (game.pendingEvent && game.status === 'playing' && guard < limit) {
    guard += 1;
    resolveEvent(game, game.pendingEvent.choices[0].id);
  }
}

/** 手动打 n 拍（主行动 / 周末交替）。 */
function playPhases(game, count) {
  for (let i = 0; i < count && game.status === 'playing'; i += 1) {
    performAction(game, game.phase === 'main' ? 'listen' : 'sport');
    settleEvents(game);
  }
}

function playToEnd(game, strategy) {
  let guard = 0;
  while (game.status !== 'ended' && guard < 400) {
    guard += 1;
    if (game.status === 'volunteering') {
      const auto = autoFillVolunteers(game, 'balanced');
      submitVolunteers(game, auto.picks, { adjust: auto.adjust });
      continue;
    }
    playWeek(game, strategy);
  }
  return game;
}

const MEDIOCRE = (game, phase) => ({
  actionId: phase === 'main' ? 'listen' : 'sport',
  chooseEvent: (pending) => pending.choices[0].id,
});

/* ------------------------------------------------------------- 选项 */

test('开局选项里有玩法与 AI 强度，且默认是单人模式', () => {
  const options = creatorOptions();
  assert.equal(options.modes.length, 2);
  assert.deepEqual(options.modes.map((item) => item.key), MODES.map((item) => item.key));
  assert.deepEqual(options.modes.map((item) => item.key), ['solo', 'versus']);
  assert.equal(options.rivalLevels.length, 4);
  assert.deepEqual(options.rivalLevels.map((item) => item.key), ['easy', 'normal', 'hard', 'real']);
  for (const level of options.rivalLevels) {
    assert.ok(level.name && level.icon && level.desc && level.style, `强度档 ${level.key} 缺文案`);
  }
  assert.ok(RIVAL_LEVELS[DEFAULT_RIVAL_LEVEL], '默认强度档必须存在');
});

/* --------------------------------------------------------- 基本行为 */

test('单人模式：没有对手，视图里 versus 是未激活', () => {
  const game = createGame({ ...BASE });
  assert.equal(game.mode, 'solo');
  assert.equal(game.versus, null);
  assert.equal(viewState(game).mode, 'solo');
  assert.equal(viewState(game).versus.active, false);
  assert.equal(runSummary(game).versus, null);
});

test('AI 对战：对手是一个真的第二局（同规则、独立、不套娃）', () => {
  const game = createGame({ ...BASE, mode: 'versus', rivalLevel: 'hard' });
  assert.equal(game.mode, 'versus');
  const rival = game.versus.rival;
  assert.ok(rival, '应该创建了对手');
  assert.equal(rival.mode, 'solo', '对手那一局必须是单人局（否则会无限套娃）');
  assert.equal(rival.versus, null);
  assert.notEqual(rival.student.name, game.student.name, '两个人不该同名');
  assert.ok(rival.student.className, '对手应该有班级');
  assert.equal(rival.student.track, game.student.track, '同一批人，选科跟着玩家');
  assert.equal(rival.weeksPerSemester, game.weeksPerSemester);
  assert.equal(game.versus.level, 'hard');

  const view = viewState(game);
  assert.equal(view.versus.active, true);
  assert.equal(view.versus.level.key, 'hard');
  assert.equal(view.versus.level.style, '卷王型');
  assert.equal(view.versus.rival.name, rival.student.name);
  assert.ok(Number.isFinite(view.versus.rival.estimateTotal));
  assert.deepEqual(view.versus.records, [], '还没考试，不该有交手记录');
  assert.equal(view.versus.ahead, 'none');
});

test('未知的强度档会退回默认值，不会把局带崩', () => {
  const game = createGame({ ...BASE, mode: 'versus', rivalLevel: 'nightmare' });
  assert.equal(game.versus.level, DEFAULT_RIVAL_LEVEL);
  assert.ok(RIVAL_LEVELS[game.versus.level]);
});

/* ------------------------------------------------------- 时间线对齐 */

test('节奏对齐：玩家消耗一个阶段，AI 也正好打一个阶段', () => {
  const game = createGame({ ...BASE, mode: 'versus', rivalLevel: 'normal' });
  const rival = game.versus.rival;

  for (let i = 0; i < 14; i += 1) {
    performAction(game, game.phase === 'main' ? 'listen' : 'sport');
    // 玩家这一拍可能弹事件：这时 AI 也在等——阶段要在事件解决之后才推进
    settleEvents(game);
    assert.equal(rival.turn, game.turn, `第 ${i + 1} 拍之后回合数应该一致`);
    assert.equal(rival.phase, game.phase, `第 ${i + 1} 拍之后阶段应该一致`);
    assert.ok(rival.pendingEvent === null, 'AI 的事件应该当场选完，不留待处理');
  }
  assert.ok(game.turn >= 6, '应该真的推进了好几周');
});

test('AI 的动作不会吃掉玩家的随机数：同种子的单人局和对战局，玩家轨迹一模一样', () => {
  const solo = createGame({ ...BASE });
  const versus = createGame({ ...BASE, mode: 'versus', rivalLevel: 'real' });
  assert.equal(versus.rngState, solo.rngState, '开局随机流必须一致');
  assert.deepEqual(versus.knowledge, solo.knowledge, '开局底子必须一致');
  assert.deepEqual(versus.stats, solo.stats);

  playPhases(solo, 12);
  playPhases(versus, 12);
  assert.deepEqual(versus.stats, solo.stats, '玩家的属性不能被 AI 影响');
  assert.deepEqual(versus.knowledge, solo.knowledge, '玩家的知识不能被 AI 影响');
  assert.equal(versus.turn, solo.turn);
  // 但对手自己确实动过了
  assert.notDeepEqual(versus.versus.rival.stats, solo.stats);
  assert.ok(versus.versus.rival.history.length > 0, 'AI 应该真的做了事');
});

test('同一个种子跑两遍，对战结果完全一致（可复现）', () => {
  const first = playToEnd(createGame({ ...BASE, seed: 'repeat', mode: 'versus', rivalLevel: 'hard' }), MEDIOCRE);
  const second = playToEnd(createGame({ ...BASE, seed: 'repeat', mode: 'versus', rivalLevel: 'hard' }), MEDIOCRE);
  assert.equal(first.versus.rival.student.name, second.versus.rival.student.name);
  assert.equal(first.ending.versus.rival.total, second.ending.versus.rival.total);
  assert.equal(first.ending.versus.winner, second.ending.versus.winner);
  assert.deepEqual(first.ending.versus.wins, second.ending.versus.wins);
});

/* ----------------------------------------------------------- 考试对比 */

test('每次考试都会记一条交手记录，两边同榜可比', () => {
  const game = createGame({ ...BASE, seed: 'exams', mode: 'versus', rivalLevel: 'normal' });
  playPhases(game, 30);
  const view = viewState(game);
  assert.ok(view.versus.records.length > 0, '应该已经考过试了');
  assert.equal(view.versus.records.length, Math.min(game.exams.length, game.versus.rival.exams.length));

  for (const record of view.versus.records) {
    assert.ok(record.name);
    assert.ok(record.you.total > 0 && record.you.total <= 750, `你的分数异常：${record.you.total}`);
    assert.ok(record.ai.total > 0 && record.ai.total <= 750, `AI 的分数异常：${record.ai.total}`);
    // 同一张榜：分高的名次一定更靠前
    assert.ok(record.you.rank >= 1 && record.you.rank <= 1000);
    assert.ok(record.ai.rank >= 1 && record.ai.rank <= 1000);
    assert.equal(record.diff, record.you.total - record.ai.total);
    assert.equal(record.winner, record.diff === 0 ? 'tie' : record.diff > 0 ? 'you' : 'rival');
    assert.equal(record.you.total > record.ai.total, record.you.rank < record.ai.rank, '分数和名次必须同向');
  }

  const wins = view.versus.wins;
  assert.equal(wins.you + wins.rival + wins.tie, view.versus.records.length);
  assert.equal(view.versus.ahead, view.versus.records.at(-1).winner);
});

test('不同强度档真的分强弱：轻松打不过困难（同一批种子）', () => {
  const average = (level) => {
    const totals = [];
    for (let index = 0; index < 4; index += 1) {
      const game = createGame({ ...BASE, seed: `ladder-${index}`, mode: 'versus', rivalLevel: level });
      playToEnd(game, MEDIOCRE);
      totals.push(game.versus.rival.ending?.total ?? 700); // 没参加高考的按等效分算
    }
    return totals.reduce((sum, value) => sum + value, 0) / totals.length;
  };
  const easy = average('easy');
  const hard = average('hard');
  assert.ok(hard > easy + 60, `困难档平均 ${Math.round(hard)} 应该明显高于轻松档 ${Math.round(easy)}`);
});

/* --------------------------------------------------------- 结局与存档 */

test('结局里带对战总结：双方结局、交手记录、谁赢了', () => {
  const game = playToEnd(createGame({ ...BASE, seed: 'ending', mode: 'versus', rivalLevel: 'easy' }), MEDIOCRE);
  assert.equal(game.status, 'ended');
  const versus = game.ending.versus;
  assert.ok(versus, '结局应该带对战总结');
  assert.equal(versus.level.key, 'easy');
  assert.ok(versus.you.endingTitle && versus.rival.endingTitle);
  assert.ok(versus.you.name && versus.rival.name);
  assert.ok(['you', 'rival', 'tie'].includes(versus.winner));
  assert.equal(versus.wins.you + versus.wins.rival + versus.wins.tie, versus.records.length);
  assert.equal(game.versus.rival.status, 'ended', '玩家结束后，AI 的三年也要走完');

  // 日志里应该能看到对战结算
  const log = game.log.map((entry) => entry.title).join('|');
  assert.match(log, /对战/, '日志里应该有对战记录');
  assert.match(log, /对战结果/, '日志里应该有最终胜负');
});

test('保送这类没有高考分的结局按档次等效判定，不会被当成 0 分', () => {
  // 竞赛型 AI 有几个种子会走到保送（没有高考总分）；保送需要完整的 6 周学期才有戏
  let found = null;
  for (let index = 0; index < 14 && !found; index += 1) {
    const game = playToEnd(
      createGame({ ...BASE, weeksPerSemester: 6, seed: `bench-real-${index}`, mode: 'versus', rivalLevel: 'real' }),
      MEDIOCRE,
    );
    if (!Number.isFinite(game.ending.versus.rival.total)) found = game.ending.versus;
  }
  assert.ok(found, '这些种子里应该至少有一局是"没参加高考"的结局（不然这条测试没意义）');
  assert.equal(found.rival.total, null);
  assert.equal(found.rival.equivalent, true);
  assert.equal(found.rival.score, 700, '好结局的等效分');
  assert.ok(Number.isFinite(found.you.score));
  assert.equal(found.winner, found.you.score === found.rival.score ? 'tie' : found.you.score > found.rival.score ? 'you' : 'rival');
});

test('存档往返：AI 那一局要跟着一起存，读回来还能继续对齐', () => {
  const game = createGame({ ...BASE, seed: 'save', mode: 'versus', rivalLevel: 'hard' });
  playPhases(game, 8);
  const before = { name: game.versus.rival.student.name, turn: game.versus.rival.turn, total: viewState(game).versus.rival.estimateTotal };

  const restored = deserialize(serialize(game));
  assert.equal(restored.mode, 'versus');
  assert.equal(restored.versus.level, 'hard');
  assert.equal(restored.versus.rival.student.name, before.name);
  assert.equal(restored.versus.rival.turn, before.turn);
  assert.equal(viewState(restored).versus.rival.estimateTotal, before.total, '读档后 AI 的分数不该变');

  // 继续打，两条线还得对齐
  playPhases(restored, 6);
  assert.equal(restored.versus.rival.turn, restored.turn);
  assert.equal(restored.versus.rival.phase, restored.phase);
});

test('老存档（v2.x 没有 versus 字段）读进来是单人模式', () => {
  const game = createGame({ ...BASE, mode: 'versus', rivalLevel: 'hard' });
  const raw = JSON.parse(serialize(game));
  delete raw.mode;
  delete raw.versus;
  const restored = deserialize(raw);
  assert.equal(restored.mode, 'solo');
  assert.equal(restored.versus, null);
  assert.equal(viewState(restored).versus.active, false);
  // 也不该因为缺字段而丢掉别的东西
  assert.equal(restored.student.name, game.student.name);
  assert.ok(restored.subjectKeys.length >= 6);
});

test('手改坏的存档：versus 里没有对手时退回单人模式，不会崩', () => {
  const game = createGame({ ...BASE, mode: 'versus', rivalLevel: 'hard' });
  const raw = JSON.parse(serialize(game));
  raw.versus = { level: 'hard' };
  const restored = deserialize(raw);
  assert.equal(restored.mode, 'solo');
  assert.equal(restored.versus, null);
});

/* --------------------------------------------------- 四端接口一致性 */

test('服务端与离线接口都认 mode / rivalLevel（两边行为一致）', async () => {
  const payload = { ...BASE, seed: 'api-versus', mode: 'versus', rivalLevel: 'hard' };

  const server = createGameServer({ port: 0, host: '127.0.0.1' });
  await server.listen();
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/new`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const remote = await response.json();
    assert.equal(remote.view.mode, 'versus');
    assert.equal(remote.view.versus.active, true);
    assert.equal(remote.view.versus.level.key, 'hard');

    const local = createLocalApi();
    const offline = await local.request('/api/new', { method: 'POST', body: payload });
    assert.equal(offline.view.mode, 'versus');
    assert.equal(offline.view.versus.level.key, 'hard');
    assert.equal(offline.view.versus.rival.name, remote.view.versus.rival.name, '同一个种子两端应该安排同一个人');
  } finally {
    await server.close();
  }
});

test('CLI：--mode versus --rival 能打完整局并输出对战结果（JSON）', () => {
  const result = spawnSync(
    node,
    [
      join(root, 'src', 'cli.js'),
      '--auto',
      '--json',
      '--quiet',
      '--yes',
      '--mode',
      'versus',
      '--rival',
      'hard',
      '--seed',
      'cli-versus',
      '--weeks',
      '3',
      '--name',
      '我',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr?.slice(0, 400));
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.mode, 'versus');
  assert.ok(summary.versus, 'JSON 摘要里应该有对战信息');
  assert.equal(summary.versus.level.key, 'hard');
  assert.ok(['you', 'rival', 'tie'].includes(summary.versus.ending.winner));
  assert.ok(summary.versus.ending.rival.endingTitle);
});

/* -------------------------------------------------------------- 界面 */

test('前端：开局有玩法区块、局内有对战面板、结局有对战卡片', () => {
  const html = read('web/index.html');
  for (const id of ['mode-options', 'rival-levels', 'rival-options', 'versus-title', 'versus-body']) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html 缺少 #${id}`);
  }
  assert.match(html, /玩法（单人 \/ AI 对战）/, '开局的玩法区块应该有标题');
  assert.match(html, /AI 强度/, '选了 AI 对战才出现的强度选择');

  const app = read('web/app.js');
  for (const name of ['renderModes', 'renderRivalLevels', 'renderVersus', 'versusEndingHtml', 'versusScoreText']) {
    assert.match(app, new RegExp(`function ${name}\\(`), `app.js 缺少 ${name}()`);
  }
  assert.match(app, /mode: draft\.mode \?\? 'solo'/, '开始游戏时要把玩法传下去');
  assert.match(app, /rivalLevel: draft\.mode === 'versus' \? draft\.rivalLevel : undefined/);
  assert.match(app, /renderVersus\(view\);/, '每帧都要刷新对战面板');
  assert.match(app, /versusEndingHtml\(ending\.versus\)/, '结局要画对战卡片');

  const css = read('web/style.css');
  for (const className of ['.versus-row', '.versus-card', '.versus-line', '.versus-note']) {
    assert.ok(css.includes(className), `style.css 缺少 ${className}`);
  }

  for (const file of ['src/server.js', 'web/local-api.js']) {
    assert.match(read(file), /mode: body\.mode/, `${file} 应该把 mode 透传给引擎`);
    assert.match(read(file), /rivalLevel: body\.rivalLevel/, `${file} 应该把 rivalLevel 透传给引擎`);
  }
});

test('打包守门：APK 内容检查里登记了对战与改名的检查项', () => {
  const checker = read('tools/check-apk-content.py');
  for (const needle of ['RIVAL_LEVELS', 'advanceRivalPhase', 'versusView', 'id="versus-body"', "name: '二中'", '中二野人实验室']) {
    assert.ok(checker.includes(needle), `APK 内容检查里少了 ${needle}`);
  }
});
