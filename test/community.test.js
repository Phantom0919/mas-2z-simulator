/**
 * 游戏内的「交流 / 关于我们」测试（v2.9）。
 *
 * 这一块东西是**给玩家看的门面**，也是最容易悄悄坏掉的部分：
 * 按钮画出来了但没绑事件、链接地址换了但只改了一处、点了链接在安卓 WebView 里出不来。
 * 所以这里盯四件事：
 *   1. 三个入口（顶栏 / 开局那一屏 / 结局页）都在，而且指向同一个面板；
 *   2. 频道链接只有一份真源（app.js 的 COMMUNITY_URL），HTML 里那份是"没 JS 也能点"的兜底；
 *   3. 复制功能有兜底（安卓 WebView 的 navigator.clipboard 会失败）；
 *   4. 外链在安卓端交给系统浏览器，不会把玩家关在 WebView 里。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => readFileSync(join(root, ...relative.split('/')), 'utf8');

const html = read('web/index.html');
const app = read('web/app.js');
const css = read('web/style.css');
const java = read('android/app/java/com/mas2z/simulator/MainActivity.java');

const CHANNEL_URL = 'https://pd.qq.com/s/c38ht6k4r';

test('三个入口都能打开同一个交流面板（顶栏 / 开局那一屏 / 关于我们按钮）', () => {
  assert.match(html, /id="btn-community"/, '顶栏少了「💬 交流」按钮');
  assert.match(html, /id="btn-about-start"/, '开局那一屏少了「关于我们 · 赞助商」入口');
  assert.match(html, /id="community-modal"/, '缺少交流面板本体');
  assert.match(html, /id="btn-community-close"/, '面板没有关闭按钮');

  // 开局那一屏是给新玩家看的：频道链接要能直接点
  const startScreen = html.slice(html.indexOf('id="start-screen"'), html.indexOf('id="cards-modal"'));
  assert.ok(startScreen.includes(CHANNEL_URL), '开局面板里应该直接能点到频道链接');
  assert.match(startScreen, /start-community/);

  for (const id of ['btn-community', 'btn-about-start']) {
    assert.ok(app.includes(`$('${id}').addEventListener('click', openCommunityModal)`), `${id} 没有绑到 openCommunityModal`);
  }
});

test('面板里有频道链接、频道名和「复制链接」，而且不是画着好看的假按钮', () => {
  assert.match(html, /腾讯频道/);
  assert.match(html, /【模拟器发布页】/);
  assert.ok(html.includes(CHANNEL_URL), '面板里没有频道地址');
  assert.match(html, /id="btn-community-copy"/);
  assert.match(html, /id="btn-community-share"/);
  assert.match(html, /id="community-url"/);

  assert.ok(app.includes("$('btn-community-copy').addEventListener"), '「复制频道链接」没绑事件');
  assert.ok(app.includes("$('btn-community-share').addEventListener"), '「推荐给同学」没绑事件');
  assert.ok(app.includes('copyText(COMMUNITY_URL)'), '复制按钮应该复制 COMMUNITY_URL');
  assert.ok(app.includes('copyText(communityShareText())'), '推荐按钮应该复制推荐文案');
});

test('关于我们：个人独立项目 + 赞助商「印显元（爸爸）」+ 虚构声明', () => {
  const panel = html.slice(html.indexOf('id="community-modal"'), html.indexOf('id="ending-modal"'));
  assert.match(panel, /关于我们/);
  assert.match(panel, /个人独立项目/);
  assert.match(panel, /赞助商/);
  assert.match(panel, /印显元（爸爸）/);
  assert.match(panel, /虚构/, '面板里要带虚构声明');
  assert.match(panel, /MIT/, '许可写在关于我们里');
  assert.match(panel, /id="community-version"/, '面板要显示当前版本');
});

test('频道地址只有一份真源：app.js 的 COMMUNITY_URL，HTML 里那份必须和它一致', () => {
  const constant = /const COMMUNITY_URL = '([^']+)'/.exec(app)?.[1];
  assert.equal(constant, CHANNEL_URL, 'app.js 里的 COMMUNITY_URL 变了');
  assert.ok(html.includes(CHANNEL_URL), 'index.html 里的兜底链接要跟着改');

  // HTML 里所有指向频道的地址都必须一字不差
  const links = [...html.matchAll(/href="(https:\/\/[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(links)], [CHANNEL_URL], `页面上的外链只能有频道地址：${links.join('、')}`);

  // 外链都要能被 JS 统一同步，并且必须是"新开标签页/交给系统"的写法
  assert.equal([...html.matchAll(/data-community-link/g)].length, 2, '两个静态链接都要标 data-community-link');
  for (const match of html.matchAll(/<a[^>]*href="https:\/\/[^"]+"[^>]*>/g)) {
    assert.match(match[0], /target="_blank"/, `外链要新开标签页：${match[0].slice(0, 50)}`);
    assert.match(match[0], /rel="noopener noreferrer"/, `外链要带 rel=noopener：${match[0].slice(0, 50)}`);
  }
  assert.match(app, /function syncCommunityLinks\(\)/, '缺少把链接同步成常量的函数');
  assert.match(app, /\[data-community-link\]/, 'syncCommunityLinks 应该按 data 属性批量同步');
});

test('复制有兜底：安卓 WebView 里 navigator.clipboard 会失败，得退回 execCommand', () => {
  assert.match(app, /navigator\.clipboard\?\.writeText/, '先走剪贴板 API');
  assert.match(app, /execCommand\('copy'\)/, '需要 textarea + execCommand 的兜底');
  assert.match(app, /async function copyText\(/, 'copyText 应该是异步函数（clipboard 返回 Promise）');
  // 复制失败也要告诉玩家地址，而不是静默什么都不发生
  assert.match(app, /复制失败，链接是/, '复制失败时应该把地址打出来');
});

test('版本号不是手写的：面板上的版本来自 GAME_VERSION', () => {
  assert.match(app, /import \{ GAME_VERSION \} from '\.\.\/src\/engine\.js'/, '应该从引擎拿版本号');
  assert.match(app, /version\.textContent = `v\$\{GAME_VERSION\}`/, '面板版本号应该由 GAME_VERSION 填');
  assert.match(app, /syncCommunityLinks\(\);\n?\s*const mode = await detectApiMode\(\)/, '启动时要同步一次');
});

test('结局页：有分享按钮，分享文案里带这一局的成绩', () => {
  assert.match(html, /id="btn-ending-share"/, '结局页少了「分享这一局」');
  assert.ok(app.includes("$('btn-ending-share').addEventListener"), '分享按钮没绑事件');
  assert.match(app, /function endingShareText\(\)/, '缺少结局分享文案');
  for (const field of ['ending.total', 'ending.rank', 'ending.achievements']) {
    assert.ok(app.includes(field), `分享文案里应该带上 ${field}`);
  }
  assert.match(app, /class="ending-community"/, '结局正文里也应该有交流入口');
  assert.match(css, /\.ending-community/, 'ending-community 缺样式');
});

test('交流面板的样式都在（不然它就是个没排版的裸面板）', () => {
  for (const className of ['.start-community', '.ghost-link', '.community-block', '.about-facts', '.sponsor-box', '.sponsor-name']) {
    assert.ok(css.includes(className), `style.css 缺少 ${className}`);
  }
  // 「加入腾讯频道」是 <a>，样式要和旁边的按钮一致
  assert.match(css, /a\.primary,\s*a\.ghost/, '<a> 当按钮用的样式缺了');
});

test('安卓端把外链交给系统浏览器 / QQ，不会把玩家关在 WebView 里', () => {
  assert.match(java, /shouldOverrideUrlLoading\(WebView view, WebResourceRequest request\)/, 'API 24+ 的重载没实现');
  assert.match(java, /shouldOverrideUrlLoading\(WebView view, String url\)/, '老机型的重载没实现');
  assert.match(java, /Intent\.ACTION_VIEW/);
  assert.match(java, /Uri\.parse\(url\)/);
  assert.match(java, /setSupportMultipleWindows\(false\)/, 'target=_blank 的点击要靠这个才会回调 shouldOverrideUrlLoading');
  assert.match(java, /url\.startsWith\(ORIGIN\)/, '自己的页面不该被丢出去');
  assert.match(java, /ActivityNotFoundException/, '一个能开链接的应用都没有时也不能崩');
  assert.match(java, /Toast/, '打不开的时候要告诉玩家');
});

test('打包守门：check-apk-content.py 里登记了 v2.9 的交流 / 关于检查项', () => {
  const checker = read('tools/check-apk-content.py');
  for (const needle of ['id="community-modal"', '印显元（爸爸）', CHANNEL_URL, 'COMMUNITY_URL']) {
    assert.ok(checker.includes(needle), `APK 内容检查里少了 ${needle}`);
  }
});
