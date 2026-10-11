/**
 * 考前押卷（v3.6）界面守门 + 接口契约。
 *
 * 这个文件只做两件事：
 *   1. **静态守门**：`index.html` 里的骨架 id 必须是静态的（仓库有"app.js 用到的 id
 *      都必须在 index.html 里"那条测试，动态 innerHTML 造 id 会红），文案来源必须是
 *      引擎给的 `reason`（不能自己拼一句，拼的迟早跟规则对不上）；
 *   2. **接口契约**：界面读的字段（`view.examBet.*` / `view.exams[i].bet`）真的出现在
 *      `POST /api/exam-bet` 的返回里——离线版和 HTTP 版共用同一份 local-api，
 *      所以这一条同时守着"网页有、安卓没有"这个坑。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createLocalApi } from '../web/local-api.js';

const read = (name) => readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8');

const html = read('index.html');
const app = read('app.js');
const css = read('style.css');

const BET_IDS = [
  'exam-bet-card',
  'exam-bet-title',
  'exam-bet-when',
  'exam-bet-desc',
  'exam-bet-options',
  'exam-bet-subject-wrap',
  'exam-bet-subject-hint',
  'exam-bet-subject',
  'exam-bet-placed',
  'exam-bet-history',
];

/** 起一局并推进到"可以押卷"的那一拍（和 ?demo 的走法一致：每步挑第一个可用行动）。 */
async function reachBetWindow(seed = 'ui-contract') {
  const local = createLocalApi();
  const options = await local.request('/api/options');
  const created = await local.request('/api/new', {
    method: 'POST',
    body: {
      seed,
      difficulty: 'normal',
      weeksPerSemester: 3,
      track: options.tracks[0].id,
      electives: options.electives.slice(0, options.electivePick ?? 2).map((item) => item.key),
      traits: options.traits.slice(0, options.maxTraits ?? 2).map((item) => item.id),
      background: options.backgrounds[0].id,
      goal: 'yiben',
      avatar: options.avatars[0].id,
      personality: options.personalities[0].id,
      volunteers: false,
      mode: 'solo',
    },
  });

  let view = created.view;
  for (let i = 0; i < 40 && view.status === 'playing' && !view.examBet?.available; i += 1) {
    const action = view.actions.find((item) => item.available);
    if (!action) break;
    const result = await local.request('/api/action', {
      method: 'POST',
      body: { gameId: created.gameId, actionId: action.id, subject: action.subjectOptions?.[0]?.key },
    });
    view = result.view;
    if (view.pendingEvent) {
      const resolved = await local.request('/api/event', {
        method: 'POST',
        body: { gameId: created.gameId, choiceId: view.pendingEvent.choices[0].id },
      });
      view = resolved.view;
    }
  }
  return { local, gameId: created.gameId, view };
}

test('index.html 里十个押卷骨架 id 都是静态的', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const missing = BET_IDS.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `index.html 缺少押卷元素：${missing.join(', ')}`);
});

test('app.js 把押卷接进了主渲染，且要点都在', () => {
  assert.match(app, /function renderExamBet\(view\)/, '缺少 renderExamBet');
  const panels = /function renderPanels\(view\)\s*\{([\s\S]*?)\n\}/.exec(app)?.[1] ?? '';
  assert.match(panels, /renderExamBet\(view\)/, 'renderPanels 里要调用 renderExamBet（和 renderTeaser 同一层）');
  assert.match(app, /api\('\/api\/exam-bet'/, '缺少押卷写接口');
  assert.match(app, /body: \{ gameId: state\.gameId, mode, subject: subject \?\? undefined \}/, '提交体必须是 { gameId, mode, subject }');
  assert.match(app, /data-bet="\$\{escapeHtml\(option\.id\)\}"/, '四个档位要渲染成 data-bet 按钮');
  assert.match(app, /option\?\.needsSubject/, '「押重点」要先展开科目选择');
  assert.match(app, /querySelectorAll\('button\[data-subject\]'\)/, '科目要能点着选');
  assert.match(app, /examBetBadge\(exam\)/, '成绩条上要有押卷角标');
  // 不能自己拼"不能押"的理由：引擎给的 reason 是整句话，原样显示
  assert.match(app, /\$\('exam-bet-desc'\)\.textContent = bet\.reason/, '不能押时的说明必须直接用引擎的 reason');
});

test('style.css 里押卷样式齐全、按钮够大，且全文件没有 :has()', () => {
  for (const selector of ['.exam-bet-card', '.exam-bet-option', '.exam-bet-chip', '.exam-bet-subject', '.exam-bet-placed']) {
    assert.ok(css.includes(selector), `style.css 缺少 ${selector}`);
  }
  assert.match(css, /\.exam-bet-option\s*\{[^}]*min-height:\s*44px/, '.exam-bet-option 至少 44px（拇指够得到）');
  // 注释里可以讨论"为什么不用 :has()"，真正要盯的是选择器
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!rules.includes(':has('), '老 WebView（minSdk 21）不支持 :has()');
  assert.ok(!rules.includes('blob:'), 'CSP 只允许 self 与 data:');
});

test('接口契约：view.examBet / view.exams[i].bet 的字段与界面读到的一致', async () => {
  const first = await reachBetWindow();
  const bet = first.view.examBet;
  assert.equal(bet.available, true, '推进到窗口后应该可以押');

  for (const key of ['available', 'reason', 'windowWeeks', 'exam', 'inWeeks', 'weakKeys', 'subjects', 'options', 'placed', 'history', 'summary']) {
    assert.ok(key in bet, `view.examBet 缺少字段 ${key}`);
  }
  assert.equal(bet.options.length, 4, '四个档位');
  assert.deepEqual(
    bet.options.map((option) => option.id),
    ['focus', 'gamble', 'rest', 'none'],
  );
  for (const option of bet.options) {
    for (const key of ['id', 'name', 'icon', 'desc', 'risk', 'gain', 'needsSubject', 'hitChance']) {
      assert.ok(key in option, `押卷档位缺少字段 ${key}`);
    }
  }
  for (const subject of bet.subjects) {
    for (const key of ['key', 'name', 'weak', 'chance']) assert.ok(key in subject, `科目缺少字段 ${key}`);
  }
  assert.equal(bet.placed, null, '还没押');

  // 押一次「押重点」：科目必须是 subjects 里真实存在的 key
  const focusTarget = bet.subjects.find((subject) => subject.weak) ?? bet.subjects[0];
  const placed = await first.local.request('/api/exam-bet', {
    method: 'POST',
    body: { gameId: first.gameId, mode: 'focus', subject: focusTarget.key },
  });
  assert.ok(placed.lines.length > 0, '押完要有旁白');
  assert.equal(placed.view.examBet.available, false, '押完这一场就不能再押');
  assert.ok(placed.view.examBet.reason.length > 0, '不能押时 reason 必须是现成的整句话');
  assert.equal(placed.view.examBet.placed.mode, 'focus');
  assert.equal(placed.view.examBet.placed.subjectName, focusTarget.name);
  assert.ok(placed.view.examBet.placed.hitChance > 0 && placed.view.examBet.placed.hitChance <= 1);

  // 再押一次要被拒（界面靠 guard 的 toast 把这句话显示给玩家）
  await assert.rejects(
    () => first.local.request('/api/exam-bet', { method: 'POST', body: { gameId: first.gameId, mode: 'gamble' } }),
    /押过/,
    '同一场不能押两次',
  );

  // 押完之后继续走，直到这场考试出分：成绩条上要能拿到角标数据
  let view = placed.view;
  let exam = null;
  for (let i = 0; i < 12 && view.status === 'playing' && !exam; i += 1) {
    const action = view.actions.find((item) => item.available);
    if (!action) break;
    const result = await first.local.request('/api/action', {
      method: 'POST',
      body: { gameId: first.gameId, actionId: action.id, subject: action.subjectOptions?.[0]?.key },
    });
    view = result.view;
    if (view.pendingEvent) {
      const resolved = await first.local.request('/api/event', {
        method: 'POST',
        body: { gameId: first.gameId, choiceId: view.pendingEvent.choices[0].id },
      });
      view = resolved.view;
    }
    exam = view.exams.find((item) => item.bet) ?? null;
  }

  assert.ok(exam, '押完之后应该有一场考试带上结果');
  for (const key of ['mode', 'modeName', 'subject', 'subjectName', 'hit', 'chance', 'factor']) {
    assert.ok(key in exam.bet, `view.exams[i].bet 缺少字段 ${key}`);
  }
  assert.equal(typeof exam.bet.hit, 'boolean');
  assert.ok(view.examBet.history.some((entry) => entry.mode === 'focus'), '历史里要记着这一场押了什么');
  for (const key of ['name', 'kind', 'mode', 'modeName', 'subject', 'subjectName', 'hit', 'factor', 'note']) {
    assert.ok(key in view.examBet.history.find((entry) => entry.mode === 'focus'), `历史条目缺少字段 ${key}`);
  }
});

test('接口契约：不可押时 reason 是给玩家看的整句话，界面不需要自己拼', async () => {
  const { local, gameId, view } = await reachBetWindow('ui-contract-2');
  assert.equal(view.examBet.available, true);
  await local.request('/api/exam-bet', { method: 'POST', body: { gameId, mode: 'rest' } });
  const after = await local.request('/api/view');
  assert.equal(after.view.examBet.available, false);
  assert.match(after.view.examBet.reason, /已经押过了|还有 \d+ 周|没有下一场考试|结束了/, 'reason 必须是一句完整中文');
  assert.equal(after.view.examBet.placed.mode, 'rest');
  assert.equal(after.view.examBet.placed.hitChance, 1, '睡够不是赌，命中率恒为 1（界面不显示百分比）');
});
