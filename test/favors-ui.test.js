/**
 * 人情账本（v3.7）界面守门 + 只读契约。
 *
 * 这个文件只盯三件事：
 *   1. **静态守门**：`index.html` 里的六个骨架 id 必须是静态的（仓库有"app.js 用到的
 *      id 都必须在 index.html 里"那条测试，动态 innerHTML 造 id 会红），而且这张卡
 *      **只读**——不绑按钮、不开新接口（还 / 拖 / 赖走已有的讨债事件弹层）；
 *   2. **口径来源**：界面上的"还有几周 / 等级 / 压力"必须直接用引擎给的
 *      `weeksLeft` / `levelLabel` / `pressure`，不在前端自己算一遍；
 *   3. **字段契约**：用真实引擎造 1~3 笔 open 账，断言 `viewState().favors` 里
 *      renderFavors 读到的字段全部存在（离线版和 HTTP 版共用同一份引擎，所以
 *      这一条同时守着"网页有、安卓没有"这个坑）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createGame, listActions, performAction, resolveEvent, viewState } from '../src/engine.js';

const read = (name) => readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8');

const html = read('index.html');
const app = read('app.js');
const css = read('style.css');

const FAVOR_IDS = ['favor-card', 'favor-head', 'favor-pressure', 'favor-list', 'favor-empty', 'favor-history'];

/** 开局后往前走到第 `turn` 回合（每半周一回合；遇到事件选第一个，和 ?demo 的走法一致）。 */
function gameAtTurn(turn, seed = 'favor-ui') {
  const game = createGame({ name: '账本界面', seed, weeksPerSemester: 3, volunteers: false });
  let guard = 0;
  while (game.turn < turn && game.status === 'playing' && guard < 120) {
    guard += 1;
    if (game.pendingEvent) {
      resolveEvent(game, game.pendingEvent.choices[0].id);
      continue;
    }
    const action = listActions(game).find((item) => item.available);
    if (!action) break;
    performAction(game, action.id, { subject: action.subjectOptions?.[0]?.key });
  }
  if (game.pendingEvent) resolveEvent(game, game.pendingEvent.choices[0].id);
  return game;
}

/**
 * 往真实引擎的游戏里塞 open 账（只塞 `sanitizeFavors` 认的字段，和读档清洗同形），
 * 再让 viewState 走一遍引擎的 favorState——界面看到的与玩家真实看到的是同一条路。
 */
function viewWithFavors(game, count = 3) {
  game.favors = [
    { id: 'notes_2_0', kind: 'notes', person: 'deskmate', level: 1, fromTurn: 2, dueTurn: game.turn + 4, status: 'open' },
    { id: 'homework_3_1', kind: 'homework', person: 'friend', level: 2, fromTurn: 3, dueTurn: game.turn + 2, status: 'open', delayed: 1 },
    { id: 'meal_4_2', kind: 'meal', person: 'friend', level: 1, fromTurn: 4, dueTurn: game.turn, status: 'open' },
  ].slice(0, count);
  game.favorLog =
    count > 0
      ? [
          { kind: 'notes', icon: '📓', title: '借来的笔记', personName: '同桌', action: 'repay', atTurn: game.turn - 2 },
          { kind: 'homework', icon: '📝', title: '抄来的作业', personName: '死党', action: 'delay', atTurn: game.turn - 1 },
          { kind: 'meal', icon: '🍜', title: '垫上的饭钱', personName: '死党', action: 'refuse', atTurn: game.turn },
        ]
      : [];
  return viewState(game);
}

/* ------------------------------------------------------- 静态守门 */

test('index.html 里六个账本骨架 id 都是静态的', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const missing = FAVOR_IDS.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `index.html 缺少账本元素：${missing.join(', ')}`);
});

test('账本卡片是只读的：骨架里没有按钮，app.js 没有新增人情写接口', () => {
  const start = html.indexOf('id="favor-card"');
  assert.ok(start > 0, 'index.html 里没有 #favor-card');
  const end = html.indexOf('</section>', start);
  const cardHtml = html.slice(start, end);
  assert.ok(cardHtml.includes('id="favor-card"'));
  assert.ok(!/<button/i.test(cardHtml), '账本面板是只读的，不该有按钮（还/拖/赖在讨债事件弹层里选）');
  assert.ok(!/\/api\/favor/.test(app), '人情账本不该开新接口：还/拖/赖走已有的 /api/event');

  // 界面读的就是 view.favors，不能再发明一份本地账
  assert.match(app, /view\?\.favors/, 'renderFavors 的数据源必须是 view.favors');
});

test('app.js 把账本接进了主渲染，且文案/口径都在', () => {
  assert.match(app, /function renderFavors\(view\)/, '缺少 renderFavors');
  const panels = /function renderPanels\(view\)\s*\{([\s\S]*?)\n\}/.exec(app)?.[1] ?? '';
  assert.match(panels, /renderFavors\(view\)/, 'renderPanels 里要调用 renderFavors（和 renderItems 同一层）');

  // 一行 open 账要有的东西：图标 + 标题 + 谁 + 还有几周 + 等级 + 拖过几次
  assert.match(app, /favor\.icon/, '要显示这笔人情的图标');
  assert.match(app, /favor\.title/, '要显示这笔人情是什么');
  assert.match(app, /favor\.personName/, '要显示欠谁');
  assert.match(app, /favor\.weeksLeft/, '还有几周要用引擎算好的 weeksLeft');
  assert.match(app, /favor\.levelLabel/, '等级要用引擎给的 levelLabel（轻/重/更重）');
  assert.match(app, /favor\.delayed/, '拖过几次要显示');
  assert.match(app, /拖过 \$\{favor\.delayed\} 次/, '「拖过 N 次」的文案');
  assert.match(app, /favor\.what/, '要显示欠了什么（what）');

  // 压力警告：数字全部来自 pressure，不在前端重算
  assert.match(app, /pressure\.active/, '压力只在 active 时出现');
  assert.match(app, /pressure\.moodPerWeek/, '每周心情要用引擎给的 moodPerWeek');
  assert.match(app, /压力|账本压着/, '压力警告文案');

  // 空账本
  assert.ok(app.includes('还没人帮过你，你也没欠过谁。'), '空账本要有一句陈述');

  // 历史三种动作各一句话
  for (const text of ['✅ 还了', '⏳ 拖了', '❌ 赖了']) {
    assert.ok(app.includes(text), `历史缺少「${text}」这个说法`);
  }
  assert.match(app, /history\.slice\(-3\)/, '历史只显示最近 3 条');
});

test('style.css 里账本样式齐全，且全文件没有 :has() / blob:', () => {
  for (const selector of ['.favor-card', '.favor-row', '.favor-chip', '.favor-empty', '.favor-pressure', '.favor-history', '.favor-row.due-now']) {
    assert.ok(css.includes(selector), `style.css 缺少 ${selector}`);
  }
  // 这周就到的那笔要醒目（用 --bad 说话）
  assert.match(css, /\.favor-row\.due-now\s*\{[^}]*border-color:\s*rgba\(248,\s*81,\s*73/, '.due-now 要用 --bad 的描边');
  // 注释里可以讨论"为什么不用 :has()"，真正要盯的是选择器
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!rules.includes(':has('), '老 WebView（minSdk 21）不支持 :has()');
  assert.ok(!rules.includes('blob:'), 'CSP 只允许 self 与 data:');
});

test('前端没有留下调试残留（app.js）', () => {
  assert.ok(!/console\.log\(/.test(app), 'app.js 残留 console.log');
  assert.ok(!/console\.debug\(/.test(app), 'app.js 残留 console.debug');
  assert.ok(!/\balert\(/.test(app), 'app.js 应该用 toast 而不是 alert');
  assert.ok(!/\bconfirm\(/.test(app), 'app.js 不应该用 confirm');
  assert.ok(!app.includes('debugger'), 'app.js 残留 debugger');
});

/* --------------------------------------------------- 只读字段契约 */

test('接口契约：1~3 笔 open 账的字段与界面读到的一致', () => {
  const view = viewWithFavors(gameAtTurn(8));
  const favors = view.favors;

  for (const key of ['open', 'summary', 'pressure', 'history']) {
    assert.ok(key in favors, `view.favors 缺少字段 ${key}`);
  }
  assert.equal(favors.open.length, 3);

  // 每一行用到的字段都必须在：id/kind/icon/title/person/personName/what/dueTurn/
  // weeksLeft/level/levelLabel/delayed/repayLabel/repayHint/delayHint/refuseHint
  for (const row of favors.open) {
    for (const key of [
      'id',
      'kind',
      'icon',
      'title',
      'person',
      'personName',
      'what',
      'dueTurn',
      'weeksLeft',
      'level',
      'levelLabel',
      'delayed',
      'repayLabel',
      'repayHint',
      'delayHint',
      'refuseHint',
    ]) {
      assert.ok(key in row, `账本条目缺少字段 ${key}`);
    }
    assert.ok(['轻', '重', '更重'].includes(row.levelLabel), `levelLabel 应该是轻/重/更重，实际 ${row.levelLabel}`);
    assert.ok(Number.isInteger(row.weeksLeft) && row.weeksLeft >= 0, 'weeksLeft 必须是非负整数');
  }

  // 账期口径：还有几周由引擎算（dueTurn 差 ÷2 向上取整）
  const notes = favors.open.find((row) => row.kind === 'notes');
  assert.equal(notes.weeksLeft, 2, 'dueTurn 差 4 回合 → 还有 2 周');
  const homework = favors.open.find((row) => row.kind === 'homework');
  assert.equal(homework.weeksLeft, 1, 'dueTurn 差 2 回合 → 还有 1 周');
  assert.equal(homework.levelLabel, '重', '拖过一次升到 2 级 = 重');
  assert.equal(homework.delayed, 1, '拖过次数要原样传到界面');

  // 0 ＝ 这周就到（界面标红的那一笔）
  const meal = favors.open.find((row) => row.kind === 'meal');
  assert.equal(meal.weeksLeft, 0, 'dueTurn 等于当前回合时应该显示「这周就到」');

  // 欠太多会压心情：3 笔 → 超 1 笔 × 0.6 = 0.6/周；warning 文案里的数字来自这里
  assert.deepEqual(favors.pressure, { count: 3, limit: 2, over: 1, moodPerWeek: 0.6, active: true });
  assert.equal(`⚠️ 账本压着 ${favors.pressure.count} 笔人情，每周心情 -${favors.pressure.moodPerWeek}`, '⚠️ 账本压着 3 笔人情，每周心情 -0.6');

  // 汇总与历史
  assert.deepEqual(favors.summary, { open: 3, repaid: 0, refused: 0, total: 3 });
  assert.deepEqual(
    favors.history.map((entry) => entry.action),
    ['repay', 'delay', 'refuse'],
    '历史按发生顺序（界面取最后 3 条倒序显示）',
  );
  for (const entry of favors.history) {
    for (const key of ['kind', 'icon', 'title', 'personName', 'action', 'atTurn']) {
      assert.ok(key in entry, `历史条目缺少字段 ${key}`);
    }
    assert.ok(['repay', 'delay', 'refuse'].includes(entry.action));
  }
});

test('接口契约：欠没超过上限时压力是关掉的（界面不显示警告）', () => {
  const view = viewWithFavors(gameAtTurn(6), 2);
  assert.equal(view.favors.open.length, 2);
  assert.deepEqual(view.favors.pressure, { count: 2, limit: 2, over: 0, moodPerWeek: 0, active: false });
});

test('接口契约：空账本（开局大多如此）open 为空、total 为 0、压力关掉', () => {
  const view = viewWithFavors(gameAtTurn(4), 0);
  assert.deepEqual(view.favors.open, []);
  assert.deepEqual(view.favors.pressure, { count: 0, limit: 2, over: 0, moodPerWeek: 0, active: false });
  assert.deepEqual(view.favors.summary, { open: 0, repaid: 0, refused: 0, total: 0 });
  assert.deepEqual(view.favors.history, []);
});
