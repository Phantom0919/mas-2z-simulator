/**
 * 下回预告自检（v3.4）。
 *
 * 这个模块的价值全在"说得准"：预告必须能兑现，否则就是骗玩家点下一周。
 * 所以测试盯的是四件事：
 *   1. 优先级对不对（临近考试 > 排队中的链 > 状态危险 > 关系 > 氛围）；
 *   2. 只预报**真的会发生**的事（考试周数来自 view.nextExam，链的周数来自 atTurn）；
 *   3. 退出/结束时不该再勾人（返回 null）；
 *   4. 氛围句会换，不是永远同一句。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createGame, nextExamInfo, performAction, resolveEvent, viewState } from '../src/engine.js';
import { nextWeekTeaser } from '../src/data/teasers.js';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const base = (overrides = {}) => ({
  status: 'playing',
  turn: 10,
  phase: 'main',
  stats: { mood: 70, fatigue: 30, physique: 60, discipline: 5 },
  npc: { love: 10, deskmate: 40, head: 55 },
  flags: {},
  chains: [],
  nextExam: null,
  weeksLeft: 30,
  grade: 1,
  ...overrides,
});

test('临近的考试排在第一位，而且周数是真的（不是编的）', () => {
  const teaser = nextWeekTeaser(
    base({ nextExam: { name: '月考', inWeeks: 0, kind: 'monthly' }, chains: [{ id: 'x', atTurn: 12 }] }),
  );
  assert.equal(teaser.tone, 'exam');
  assert.match(teaser.text, /月考/);
  assert.match(teaser.text, /这一周/);

  const next = nextWeekTeaser(base({ nextExam: { name: '期中', inWeeks: 1 } }));
  assert.match(next.text, /还有 1 周/);

  // 还早的考试不该被预告（那是噪音）
  const far = nextWeekTeaser(base({ nextExam: { name: '期末', inWeeks: 4 } }));
  assert.doesNotMatch(far.text, /期末/);
});

test('排队中的因果链会报"还有几周"，且这个周数来自 atTurn', () => {
  const teaser = nextWeekTeaser(base({ turn: 10, chains: [{ id: 'chain_a', atTurn: 13 }] }));
  assert.equal(teaser.tone, 'story');
  assert.match(teaser.text, /还有 3 周/);

  // 已经到点的链不会说"还有 0 周"
  const due = nextWeekTeaser(base({ turn: 13, chains: [{ id: 'chain_a', atTurn: 13 }] }));
  assert.match(due.text, /还有 1 周/);

  // 多条链时报最近的那条
  const multi = nextWeekTeaser(base({ turn: 10, chains: [{ atTurn: 20 }, { atTurn: 12 }] }));
  assert.match(multi.text, /还有 2 周/);
});

test('状态进了危险区就直说，而不是等玩家自己发现', () => {
  assert.equal(nextWeekTeaser(base({ stats: { ...base().stats, fatigue: 80 } })).tone, 'danger');
  assert.match(nextWeekTeaser(base({ stats: { ...base().stats, mood: 18 } })).text, /压垮|出事/);
  assert.match(nextWeekTeaser(base({ stats: { ...base().stats, physique: 20 } })).text, /医务室/);
  assert.match(nextWeekTeaser(base({ stats: { ...base().stats, discipline: 85 } })).text, /德育处/);

  // 危险状态优先于关系，但让位给"马上要考试"
  const examWins = nextWeekTeaser(base({ stats: { ...base().stats, mood: 10 }, nextExam: { name: '月考', inWeeks: 0 } }));
  assert.equal(examWins.tone, 'exam');
});

test('关系线有动静时给一句，且不重复说已经表白过的', () => {
  const love = nextWeekTeaser(base({ npc: { ...base().npc, love: 70 } }));
  assert.equal(love.tone, 'story');
  assert.match(love.text, /眼神/);
  assert.equal(nextWeekTeaser(base({ npc: { ...base().npc, love: 70 }, flags: { loveConfessed: true } })).tone, 'calm');

  const head = nextWeekTeaser(base({ npc: { ...base().npc, head: 12 } }));
  assert.equal(head.tone, 'danger');
});

test('高三报倒计时；游戏结束或没数据时不再勾人', () => {
  const senior = nextWeekTeaser(base({ grade: 3, weeksLeft: 5 }));
  assert.equal(senior.tone, 'exam');
  assert.match(senior.text, /只剩 5 周/);

  assert.equal(nextWeekTeaser(null), null);
  assert.equal(nextWeekTeaser(base({ status: 'ended' })), null);
  assert.equal(nextWeekTeaser(base({ status: 'volunteering' })), null);
});

test('没什么特别的事时给氛围句，而且会换（不是永远同一句）', () => {
  const texts = new Set();
  for (let turn = 0; turn < 12; turn += 1) texts.add(nextWeekTeaser(base({ turn })).text);
  assert.ok(texts.size >= 6, `氛围句应该轮换，现在只有 ${texts.size} 种`);
  assert.equal(nextWeekTeaser(base()).tone, 'calm');
});

test('引擎真的把它算进 view 里，而且内容随局面变化', () => {
  const game = createGame({ name: '预告', seed: 'teaser-view', weeksPerSemester: 6 });
  const view = viewState(game);
  assert.ok(view.teaser, 'view 里应该有 teaser');
  assert.ok(view.teaser.icon && view.teaser.text, 'teaser 要有图标和文案');
  assert.equal(view.teaser.text.includes('undefined'), false);

  // 把自己弄到快撑不住，预告应该跟着变成危险
  game.stats.fatigue = 90;
  assert.equal(viewState(game).teaser.tone, 'danger');

  // 考试信息是引擎自己算的：预告里的周数必须和 view.nextExam 对得上
  const soon = createGame({ name: '预告', seed: 'teaser-exam', weeksPerSemester: 6 });
  let guard = 0;
  while (guard < 40) {
    guard += 1;
    const current = viewState(soon);
    const info = current.nextExam;
    if (info && info.inWeeks === 0) {
      assert.match(current.teaser.text, new RegExp(info.name), '考前那一周应该预告这场考试');
      break;
    }
    const action = current.actions.find((item) => item.available);
    if (!action) break;
    performAction(soon, action.id, { subject: action.subjectOptions?.[0]?.key });
    while (soon.pendingEvent) resolveEvent(soon, soon.pendingEvent.choices[0].id);
  }
  assert.ok(guard < 40, '应该能在 40 步内跑到考试周');
  assert.equal(typeof nextExamInfo(soon).inWeeks, 'number');
});

test('界面真的把它画出来了：元素、绑定、样式都在（别只算不显示）', () => {
  const html = read('web/index.html');
  assert.match(html, /id="next-teaser"/, '缺 #next-teaser 这个容器');

  const app = read('web/app.js');
  assert.match(app, /function renderTeaser\(view\)/, '缺 renderTeaser');
  assert.match(app, /renderTeaser\(view\);/, 'renderPanels 里没调用 renderTeaser，等于白算');
  assert.match(app, /box\.className = `teaser teaser-\$\{teaser\.tone/, '语气没有体现到 class 上，四档配色就失效了');

  const css = read('web/style.css');
  for (const name of ['.teaser', '.teaser-exam', '.teaser-danger', '.teaser-story']) {
    assert.ok(css.includes(name), `style.css 缺 ${name}`);
  }

  // 打包时会按 import 图收集 src/，teasers.js 是被 engine 引的，必须进包
  const buildApk = read('tools/build-apk.mjs');
  assert.match(buildApk, /WEB_ENTRIES = \['app\.js'/, '打包入口清单里要有 app.js（否则 leaderboard / teaser 都不会进包）');
});
