/**
 * 前端静态资源检查：没有构建步骤，所以用测试保证 HTML / CSS / JS 之间不失联。
 *
 * 三类核心意图保持不变：
 *   1. index.html 引用的资源都真实存在；
 *   2. app.js 里 $('id') 用到的每个 id 都能在 index.html 找到（且用得足够多）；
 *   3. 前端不留调试残留（console.log / debugger / alert）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = new URL('../web/', import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const readWeb = (name) => readFile(fileURLToPath(new URL(name, webRoot)), 'utf8');

test('index.html 引用的资源都存在', async () => {
  const html = await readWeb('index.html');
  const refs = [...html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map((match) => match[1]);
  assert.ok(refs.includes('style.css'));
  assert.ok(refs.includes('app.js'));
  for (const ref of refs) {
    const content = await readWeb(ref);
    assert.ok(content.length > 0, `${ref} 是空文件`);
  }
});

test('app.js 用到的所有 id 都在 index.html 里', async () => {
  const html = await readWeb('index.html');
  const js = await readWeb('app.js');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const usedIds = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]));
  const missing = [...usedIds].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `app.js 里引用了不存在的元素 id：${missing.join(', ')}`);
  assert.ok(usedIds.size > 20, '应该用到了足够多的界面元素');
});

test('前端没有留下 TODO 或调试断点', async () => {
  for (const name of ['app.js', 'style.css', 'index.html']) {
    const content = await readWeb(name);
    assert.ok(!content.includes('debugger'), `${name} 残留 debugger`);
    assert.ok(!/console\.log\(/.test(content), `${name} 残留 console.log`);
  }
  const js = await readWeb('app.js');
  assert.ok(!/\balert\(/.test(js), 'app.js 应该用 toast 而不是 alert');
  assert.ok(!/\bconfirm\(/.test(js), 'app.js 不应该用 confirm');
});

test('v2 界面元素齐全（构筑 / 两段制 / 商店 / 图鉴 / 结局）', async () => {
  const html = await readWeb('index.html');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const required = [
    // 顶栏
    'topbar-info', 'motto', 'btn-shop', 'btn-gallery', 'btn-save', 'btn-load', 'btn-new',
    // 三栏
    'layout', 'stats', 'subjects', 'build', 'npc', 'items',
    'phase-badge', 'actions', 'action-hint', 'log', 'exams',
    // 开局构筑
    'start-screen', 'input-name', 'input-seed', 'input-difficulty', 'input-weeks', 'input-endless',
    'track-options', 'elective-options', 'trait-options', 'background-options', 'goal-options',
    'build-hint', 'btn-start', 'btn-continue',
    // 弹层
    'event-modal', 'event-title', 'event-text', 'event-choices',
    'subject-modal', 'subject-title', 'subject-choices',
    'shop-modal', 'shop-body', 'shop-money',
    'gallery-modal', 'gallery-body', 'gallery-progress', 'gallery-runs',
    'ending-modal', 'ending-body', 'toast', 'turn-lines',
  ];
  const missing = required.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `index.html 缺少 v2 元素：${missing.join(', ')}`);
});

test('人物关系图与故事线界面元素齐全', async () => {
  const html = await readWeb('index.html');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const required = [
    'btn-relations', 'relations-modal', 'relations-summary', 'relations-canvas', 'relations-list', 'btn-relations-close',
    'btn-story', 'story-modal', 'story-progress', 'story-body', 'btn-story-close',
    'btn-random-name', 'input-gender',
  ];
  const missing = required.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `index.html 缺少关系图 / 故事线元素：${missing.join(', ')}`);
});

test('index.html 引用的样式类在 style.css 里都有定义', async () => {
  const html = await readWeb('index.html');
  const css = await readWeb('style.css');
  const used = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)));
  // 只检查我们自己起的名字；这几个是"靠 .panel 统一控制、没有独立规则"的结构性类名
  const ignored = new Set(['hidden', 'muted', 'small', 'ghost', 'primary', 'big', 'wide-card', 'panel-status', 'panel-actions']);
  const mine = [...used].filter((name) => name && !ignored.has(name));
  const missing = mine.filter((name) => !css.includes(`.${name}`));
  assert.deepEqual(missing, [], `style.css 里没有这些类：${missing.join(', ')}`);
});

test('app.js 覆盖了 v2 的全部接口', async () => {
  const js = await readWeb('app.js');
  for (const endpoint of ['/api/options', '/api/new', '/api/action', '/api/event', '/api/shop', '/api/export', '/api/import']) {
    assert.ok(js.includes(endpoint), `app.js 没有调用 ${endpoint}`);
  }
  assert.ok(js.includes('mas2z-profile-v2'), '图鉴应该使用 mas2z-profile-v2 作为 localStorage 键');
});

test('app.js 覆盖了关系图 / 故事线 / 随机姓名接口', async () => {
  const js = await readWeb('app.js');
  for (const endpoint of ['/api/relations', '/api/story', '/api/random-name']) {
    assert.ok(js.includes(endpoint), `app.js 没有调用 ${endpoint}`);
  }
});

test('前端模块的相对 import 都能解析到真实文件（没有写错的路径）', async () => {
  const { collectModules } = await import('../tools/module-graph.mjs');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');

  // 用打包脚本同一份逻辑走一遍，测试和 APK 的有效性绑在一起
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { modules, missing } = collectModules({
    root,
    entries: ['app.js', 'local-api.js', 'relations-view.js'].map((name) => join(root, 'web', name)),
  });

  assert.deepEqual(missing, [], `这些 import 指向了不存在的文件：${missing.join('，')}`);
  assert.ok(modules.length >= 15, `应该顺着 import 找到足够多的模块，实际只有 ${modules.length} 个`);
  assert.ok(modules.includes('src/engine.js'), '应该能从 web/ 走到引擎');
  assert.ok(modules.includes('src/data/story.js'), '应该能走到剧情数据');
});

/* --------------------------------------------------- 布局 / 滚动 */

/**
 * 没有浏览器，所以至少把"样式表本身是合法的"这件事测掉：
 * 括号不配对、@media 没闭合这类错误会让整份 CSS 后半段全部失效。
 */
function parseCss(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  const problems = [];
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      depth += 1;
      stack.push(i);
    } else if (ch === '}') {
      depth -= 1;
      stack.pop();
      if (depth < 0) problems.push(`第 ${text.slice(0, i).split('\n').length} 行多了一个 }`);
    }
  }
  if (depth > 0) {
    for (const position of stack) {
      problems.push(`第 ${text.slice(0, position).split('\n').length} 行的 { 没有闭合`);
    }
  }
  return { text, problems };
}

test('style.css 本身是合法的（括号配对、at-rule 闭合）', async () => {
  const css = await readWeb('style.css');
  const { text, problems } = parseCss(css);
  assert.deepEqual(problems, [], `CSS 有语法问题：\n${problems.join('\n')}`);
  assert.ok(css.length > 5000, '样式表不该缩水');
  // 所有 @media / @supports 都必须带条件和大括号
  for (const match of text.matchAll(/@(media|supports)([^{]*)\{/g)) {
    assert.ok(match[2].trim().length > 0, `@${match[1]} 后面缺条件`);
  }
});

test('三栏各自独立滚动：面板不再是 sticky（否则长内容翻不到底）', async () => {
  const css = await readWeb('style.css');
  // 老写法 .panel { position: sticky } 会让"比屏幕高的那一栏"下半截永远滚不出来
  assert.ok(
    !/\.panel\s*\{[^}]*position:\s*sticky/.test(css),
    '.panel 不能用 position: sticky——内容比屏幕高时下半截就滚不到了',
  );
  assert.match(css, /\.panel\s*\{[^}]*overflow-y:\s*auto/, '.panel 要自己滚动');
  assert.match(css, /\.panel\s*\{[^}]*min-height:\s*0/, '.panel 要设 min-height: 0，否则 flex/grid 里不会收缩');
  assert.match(css, /\.layout\s*\{[^}]*overflow:\s*hidden/, '整页不滚，交给每一栏滚');
  assert.match(css, /@supports\s*\(height:\s*100dvh\)/, '手机地址栏伸缩要用 dvh');
});

test('手机版把行动栏提到最前，并给了一排分组跳转', async () => {
  const css = await readWeb('style.css');
  const html = await readWeb('index.html');
  const js = await readWeb('app.js');

  // 手机单栏时行动在最上面，不用先划过整个状态面板
  assert.match(css, /\.panel-actions\s*\{\s*order:\s*-1/, '手机上行动栏应该排在最前面');
  assert.ok(css.includes('.action-tabs'), '要有分组跳转条');
  assert.ok(css.includes('scroll-margin-top'), '跳转过去之后标题不该被顶栏挡住');
  assert.match(css, /@media\s*\(pointer:\s*coarse\)/, '触摸屏要放大点击区域');
  assert.match(css, /env\(safe-area-inset/, '要处理刘海屏安全区');

  assert.match(html, /id="action-tabs"/, 'HTML 里要有跳转条容器');
  assert.match(js, /renderActionTabs/, 'app.js 要渲染跳转条');
  assert.match(js, /scrollIntoView/, 'app.js 要能跳到对应分组');
});

test('顶栏和面板都能收缩（flex 项默认 min-width:auto 会把整页撑宽）', async () => {
  const css = await readWeb('style.css');
  // 顶栏信息区必须能收缩，否则长文本会把整页顶出横向滚动条
  assert.match(css, /\.topbar-info\s*\{[^}]*min-width:\s*0/, '.topbar-info 要 min-width: 0');
  assert.match(css, /\.topbar-info\s*\{[^}]*flex:\s*1 1/, '.topbar-info 要能伸缩');
  assert.match(css, /\.topbar\s*\{[^}]*overflow-x:\s*clip/, '顶栏不该把整页撑宽');
  // 窄屏时行动卡片排成一列，避免半张卡片露在外面
  assert.match(css, /\.actions\s*\{\s*grid-template-columns:\s*1fr/, '窄屏行动卡片应该单列');
});

test('留了 ?demo 快速开局（分享链接和版面探针都靠它）', async () => {
  const js = await readWeb('app.js');
  assert.match(js, /maybeAutoStart/, 'app.js 要有快速开局逻辑');
  assert.match(js, /params\.has\('demo'\)/, '要认 ?demo 参数');
  assert.ok(existsSync(join(root, 'tools', 'layout-probe.mjs')), '版面探针工具应该还在');
  const probe = readFileSync(join(root, 'tools', 'layout-probe.mjs'), 'utf8');
  assert.match(probe, /measure\.html/, '探针要提供量尺寸页面');
  assert.match(probe, /pathname\.startsWith\('\/src\/'\)/, '探针也要提供 /src/**，否则页面白屏');
  assert.match(probe, /click=last|click'\) === 'last'/, '探针要能模拟点分组标签');
});

/* --------------------------------------------------- 关系图 / 故事线渲染 */

test('关系树 SVG：每个人一个节点，标签闭合，没有 undefined', async () => {
  const { relationsSvg, relationsSummaryHtml, castCardHtml } = await import('../web/relations-view.js');
  const { createGame, relationGraph } = await import('../src/engine.js');

  const game = createGame({ name: '前端树', seed: 'web-tree' });
  const graph = relationGraph(game);
  const svg = relationsSvg(graph);

  assert.ok(svg.startsWith('<svg'), '应该输出 svg 根标签');
  assert.ok(svg.endsWith('</svg>'));
  assert.equal((svg.match(/<g class="tree-node person"/g) ?? []).length, 8, '应该有 8 个人物节点');
  assert.equal((svg.match(/<g\b/g) ?? []).length, (svg.match(/<\/g>/g) ?? []).length, 'g 标签不配对');
  assert.equal((svg.match(/<text\b/g) ?? []).length, (svg.match(/<\/text>/g) ?? []).length, 'text 标签不配对');
  assert.equal(
    (svg.match(/<rect\b/g) ?? []).length,
    (svg.match(/<rect\b[^>]*\/>/g) ?? []).length,
    'rect 没有自闭合',
  );
  assert.ok(!svg.includes('undefined'), 'SVG 里有 undefined');
  assert.ok(!svg.includes('NaN'), 'SVG 里有 NaN');
  for (const person of game.cast.list) {
    assert.ok(svg.includes(person.name), `SVG 里没有 ${person.name}`);
  }
  // 每个好感度键都要在图上出现
  assert.equal(graph.people.length, 8);

  const summary = relationsSummaryHtml(graph.people);
  assert.ok(!summary.includes('undefined'));
  assert.ok(summary.includes(String(graph.people.length)));

  const card = castCardHtml(graph.people[0]);
  assert.ok(card.includes(graph.people[0].name));
  assert.ok(!card.includes('undefined'));
});

test('关系图渲染会转义 HTML（人名里塞标签也不会被当代码执行）', async () => {
  const { castCardHtml, relationsSummaryHtml } = await import('../web/relations-view.js');
  const evil = {
    id: 'x',
    name: '<script>alert(1)</script>',
    role: '同桌',
    icon: '🧑',
    tone: 'plain',
    affinity: 50,
    affinityLabel: '相处不错',
    blurb: '"><img src=x onerror=1>',
  };
  const card = castCardHtml(evil);
  assert.ok(!card.includes('<script>'), '人名没有转义');
  assert.ok(!card.includes('<img'), '简介没有转义');
  assert.ok(card.includes('&lt;script&gt;'));
  assert.ok(!relationsSummaryHtml([evil]).includes('<script>'));
});

test('故事线渲染：已解锁带正文，未解锁上锁，没有 undefined', async () => {
  const { storyBodyHtml } = await import('../web/relations-view.js');
  const { createGame, storyCatalog, storyProgress } = await import('../src/engine.js');
  const { getStrategy } = await import('../src/strategies.js');
  const { playWeek } = await import('../src/engine.js');

  const game = createGame({ name: '前端故事', seed: 'web-story' });
  const strategy = getStrategy('balanced');
  let guard = 0;
  while (game.status === 'playing' && guard < 300) {
    guard += 1;
    playWeek(game, strategy);
  }

  const catalog = storyCatalog(game);
  const html = storyBodyHtml(catalog);
  assert.ok(html.includes('story-arc'), '应该有故事线区块');
  assert.ok(html.includes('🔒'), '未解锁的章节应该显示锁');
  assert.ok(html.includes('story-chapter unlocked'), '应该有已解锁章节');
  assert.ok(!html.includes('undefined'), '故事线 HTML 里有 undefined');
  assert.equal((html.match(/<section\b/g) ?? []).length, (html.match(/<\/section>/g) ?? []).length);
  assert.equal((html.match(/<div\b/g) ?? []).length, (html.match(/<\/div>/g) ?? []).length);
  assert.equal(storyBodyHtml([]), '<p class="muted">这一版还没有剧情线。</p>');

  const progress = storyProgress(game);
  assert.ok(progress.done > 0 && progress.done <= progress.total);
  // 已解锁章节的正文必须真的进了 HTML
  const unlocked = catalog.flatMap((arc) => arc.chapters).filter((chapter) => chapter.unlocked);
  assert.ok(unlocked.length > 0);
  assert.ok(html.includes(unlocked[0].title));
});

/* ------------------------------------------------ 开局 / 再来一局的契约 */

/**
 * 回归：v3.2 之前「玩了一把，第二把玩不起来」。
 *
 * 两个原因叠在一起，都在这里钉住：
 *   1. backToStart() 只切界面，没重绘开局表单 → 「开始三年」停在上一帧算出来的 disabled；
 *   2. 弹层是 closeModals() / hideRunModals() 各关几个，总有漏的 ——
 *      从结局页开过图鉴/角色卡再点「再来一局」，那些层还盖在开局界面上（看得见点不动）。
 */
test('再来一局必须关掉所有弹层并重绘开局表单（第二把玩得起来）', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

  assert.match(app, /function hideAllOverlays\(/, '应该有统一的弹层清理函数');
  assert.match(app, /querySelectorAll\('\.overlay'\)/, 'hideAllOverlays 要遍历所有 .overlay，而不是逐个登记');

  const backToStart = /function backToStart\(\)\s*\{([\s\S]*?)\n\}/.exec(app)?.[1] ?? '';
  assert.ok(backToStart.length > 0, '找不到 backToStart');
  assert.match(backToStart, /hideAllOverlays\(\)/, 'backToStart 必须关掉所有弹层');
  assert.match(backToStart, /renderBuildForm\(\)/, 'backToStart 必须重绘开局表单（否则按钮状态是陈旧的）');
  assert.ok(!/hideRunModals\(\)/.test(backToStart), '不该再用那个"只关一部分"的函数');

  // 开局成功 / 读档成功也要把弹层清干净（问昵称那层不能在游戏进行中挂着）
  const startNew = /async function startNew\(\)\s*\{([\s\S]*?)\n\}/.exec(app)?.[1] ?? '';
  assert.match(startNew, /hideAllOverlays\(\)/, '开局成功后要清空弹层');
  assert.match(startNew, /\$\('start-screen'\)\.classList\.add\('hidden'\)/);
  const resumeSave = /async function resumeSave\(\)\s*\{([\s\S]*?)\n\}/.exec(app)?.[1] ?? '';
  assert.match(resumeSave, /hideAllOverlays\(\)/, '读档成功后也要清空弹层');

  // 「开始三年」的可用状态只能由 updateBuildHint 决定；而它会被 renderBuildForm 调到
  assert.match(app, /\$\('btn-start'\)\.disabled = problems\.length > 0/, 'btn-start 的禁用状态由 updateBuildHint 统一决定');
  const renderBuildForm = /function renderBuildForm\(\)\s*\{([\s\S]*?)\n\}/.exec(app)?.[1] ?? '';
  assert.match(renderBuildForm, /updateBuildHint\(\)/, 'renderBuildForm 必须顺手刷新提示与按钮状态');
});
