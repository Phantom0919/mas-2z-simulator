/**
 * 发布页（docs/）测试：这是玩家第一眼看到的东西，链接死一个就掉一个人。
 *
 * 覆盖四件事：
 *   1. 页面结构：本地链接都真实存在、没有外链依赖、交流入口和赞助商信息在位、SEO 标签齐全；
 *   2. 发布页和仓库其余部分不许漂移：在线试玩副本要跟 web/ 逐字节一样、
 *      页面上的版本号 / APK 必须和 package.json、dist 产物对得上；
 *   3. 在线试玩那份代码真的能打一局（和 android.test.js 里的 APK 检查同一个思路）；
 *   4. 预览服务器和页面脚本的行为：MIME 对不对、点截图会不会放大、复制链接有没有复制到。
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checksumPack } from '../src/content.js';
import { normalizeManifest, validateManifest } from '../src/update.js';
import { createPagesServer } from '../tools/serve-pages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const docsDir = join(root, 'docs');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const read = (relative) => readFileSync(join(root, relative), 'utf8');
const readDocs = (relative) => readFileSync(join(docsDir, relative), 'utf8');
const exists = (relative) => existsSync(join(docsDir, ...relative.split('/')));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const CHANNEL_URL = 'https://pd.qq.com/s/c38ht6k4r';

/* ------------------------------------------------------------ 页面结构 */

test('发布页引用的本地资源都存在（不会有点开就 404 的链接）', () => {
  const html = readDocs('index.html');
  const refs = [...html.matchAll(/(?:href|src)="\.\/([^"#?]+)"/g)].map((match) => match[1]);
  assert.ok(refs.length >= 8, `本地引用太少（${refs.length}），页面大概没写完`);
  const missing = refs.filter((ref) => !exists(ref));
  assert.deepEqual(missing, [], `这些本地资源不存在：${missing.join('、')}`);
  // 游戏入口和下载入口必须在
  assert.ok(refs.includes('play/index.html'), '缺少在线试玩入口');
  assert.ok(refs.some((ref) => ref.endsWith('.apk')), '缺少 APK 下载入口');
});

test('发布页一个外部资源都不拉（断网 / 墙内也能打开）', () => {
  const html = readDocs('index.html');
  const external = [...html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(external.length > 0, '交流频道的链接应该是一个真的外链');
  const unexpected = external.filter((url) => !url.startsWith('https://pd.qq.com/'));
  assert.deepEqual(unexpected, [], `这些外链不该出现（发布页要能离线打开）：${unexpected.join('、')}`);
  assert.ok(!/<script[^>]*src="https?:/i.test(html), '不能引用外部脚本');
  assert.ok(!/<link[^>]*href="https?:/i.test(html), '不能引用外部样式 / 字体');

  const css = readDocs('assets/style.css');
  assert.ok(!/url\(\s*['"]?https?:/i.test(css), 'CSS 里不能引用外部图片 / 字体');
  assert.ok(!/@import/i.test(css), 'CSS 里不能 @import');
});

test('交流入口：首屏、正文、页脚都能点到腾讯频道，频道名一致', () => {
  const html = readDocs('index.html');
  const count = html.split(CHANNEL_URL).length - 1;
  assert.ok(count >= 4, `腾讯频道链接出现 ${count} 次，首屏 / 交流区 / 复制按钮 / 页脚都该有`);
  assert.match(html, /腾讯频道/);
  assert.match(html, /模拟器发布页/, '频道名要写对：模拟器发布页');
  assert.ok(html.includes(`data-copy-link="${CHANNEL_URL}"`), '复制按钮的链接要和真实链接一致');

  // 外链都要带上 target=_blank + rel=noopener
  for (const match of html.matchAll(/<a[^>]*href="https:\/\/[^"]+"[^>]*>/g)) {
    assert.match(match[0], /rel="noopener noreferrer"/, `外链缺少 rel=noopener：${match[0].slice(0, 60)}`);
  }
});

test('关于我们：讲清项目性质，并挂上赞助商', () => {
  const html = readDocs('index.html');
  const about = html.slice(html.indexOf('id="about"'));
  assert.ok(about.length > 0, '缺少「关于我们」区块');
  assert.match(about, /个人独立项目/);
  assert.match(about, /赞助商/);
  assert.match(about, /印显元（爸爸）/);
  assert.match(about, /虚构/, '关于我们里要带虚构声明');
  assert.match(about, /MIT/, '许可写在关于我们里');
});

test('首屏有搜索与分享需要的标签（吸引用户点的门面）', () => {
  const html = readDocs('index.html');
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>马鞍山二中模拟器 · 官方网站<\/title>/);
  assert.match(html, /name="description"\s+content="[^"]{40,}"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /property="og:image" content="\.\/assets\/og\.jpg"/);
  assert.match(html, /name="viewport"[^>]*width=device-width/);
  assert.match(html, /rel="icon"/);
  assert.match(html, /name="theme-color"/);
  assert.ok(exists('assets/og.jpg'), 'OG 分享图不存在（跑 python tools/build-pages-shots.py）');
});

test('几个卖点必须在首屏上方就能看到（不用滚到底才知道这游戏玩什么）', () => {
  const html = readDocs('index.html');
  const hero = html.slice(html.indexOf('<h1'), html.indexOf('id="features"'));
  assert.match(hero, /72 次抉择/);
  assert.match(hero, /立即试玩/);
  assert.match(hero, /下载安卓版/);
  assert.match(hero, /加入腾讯频道/);
  for (const number of ['37', '95', '36', '29', '79']) {
    assert.ok(hero.includes(number), `首屏的数字里少了 ${number}`);
  }
});

/* --------------------------------------------------------- 一致性守门 */

test('页面版本号、下载链接、latest.json、package.json 四者一致', () => {
  const html = readDocs('index.html');
  assert.ok(html.includes(`>v${pkg.version}<`), '静态兜底的版本号要跟着 package.json 一起改');

  const info = JSON.parse(readDocs('download/latest.json'));
  assert.equal(info.version, pkg.version);
  assert.ok(html.includes(`./download/${info.file}`), '下载按钮要指向 latest.json 里的那个文件');
  assert.ok(exists(`download/${info.file}`));
});

test('发布页上的 APK 与 dist 产物字节一致（存在 dist 产物时才比对）', (t) => {
  const info = JSON.parse(readDocs('download/latest.json'));
  const packed = readFileSync(join(docsDir, 'download', info.file));
  assert.equal(packed.length, info.bytes, 'latest.json 的体积和真实文件对不上');
  assert.equal(sha256(packed), info.sha256, 'latest.json 的 sha256 和真实文件对不上');

  const dist = join(root, 'dist', `马鞍山二中模拟器-${pkg.version}-debug.apk`);
  if (!existsSync(dist)) {
    t.skip('dist 里还没有这一版的 APK，跳过与产物的比对');
    return;
  }
  assert.equal(sha256(readFileSync(dist)), info.sha256, 'docs 里的 APK 不是 dist 里那一份，跑 node tools/build-pages.mjs');
});

test('在线试玩副本与 web/ 逐字节一致（玩家不该玩到旧版本）', () => {
  const files = [
    'index.html',
    'app.js',
    'local-api.js',
    'relations-view.js',
    'style.css',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'content/official-pack.json',
    'content/update-endpoint.json',
    'content/update-manifest.json',
  ];
  for (const file of files) {
    const source = join(root, 'web', ...file.split('/'));
    const copy = join(docsDir, 'play', ...file.split('/'));
    assert.ok(existsSync(source), `web/${file} 不存在`);
    assert.ok(existsSync(copy), `docs/play/${file} 不存在（跑 node tools/build-pages.mjs）`);
    assert.equal(sha256(readFileSync(copy)), sha256(readFileSync(source)), `docs/play/${file} 和 web/${file} 不一致`);
  }
  // 副本里不能混进 Node 专用模块
  for (const unwanted of ['cli.js', 'server.js']) {
    assert.ok(!existsSync(join(docsDir, 'src', unwanted)), `docs/src/${unwanted} 不该出现在发布页里`);
  }
});

test('在线试玩的引擎模块图完整（少一个模块就是白屏）', async () => {
  const { collectModulesChecked } = await import('../tools/module-graph.mjs');
  const { modules, problems } = collectModulesChecked({
    root,
    entries: ['local-api.js', 'relations-view.js'].map((name) => join(docsDir, 'play', name)),
    required: [
      'docs/src/engine.js',
      'docs/src/rng.js',
      'docs/src/story.js',
      'docs/src/tree.js',
      'docs/src/data/school.js',
      'docs/src/data/character.js',
      'docs/src/data/items.js',
      'docs/src/data/actions.js',
      'docs/src/data/events.js',
      'docs/src/data/events2.js',
      'docs/src/data/names.js',
      'docs/src/data/cast.js',
      'docs/src/data/story.js',
      'docs/src/content.js',
      'docs/src/update.js',
    ],
    forbidden: ['docs/src/server.js', 'docs/src/cli.js', 'docs/src/profile.js', 'docs/src/prompt.js', 'docs/src/strategies.js'],
  });
  assert.deepEqual(problems, [], problems.join('；'));
  assert.ok(
    modules.every((name) => name.startsWith('docs/play/') || name.startsWith('docs/src/')),
    `模块图里混进了不该有的路径：${modules.filter((name) => !name.startsWith('docs/')).join('、')}`,
  );
});

test('在线试玩副本真的能开一局并推进回合', async () => {
  const { createLocalApi } = await import(pathToFileURL(join(docsDir, 'play', 'local-api.js')).href);
  const api = createLocalApi();

  const options = await api.request('/api/options');
  assert.equal(options.tracks.length, 2);
  assert.ok(options.catalog.length >= 20);

  const created = await api.request('/api/new', {
    method: 'POST',
    body: {
      name: '发布页测试',
      seed: 'pages-1',
      track: 'physics',
      electives: ['chemistry', 'biology'],
      traits: ['memory', 'easygoing'],
      background: 'worker',
      goal: 'c985',
    },
  });
  assert.equal(created.view.cast.length, 8, '在线试玩应该带上随机人物');
  assert.equal(created.view.story.arcs.length, 7, '在线试玩应该带上七条剧情线');

  let view = created.view;
  for (const actionId of ['listen', 'sport', 'drill', 'sleep']) {
    const done = await api.request('/api/action', { method: 'POST', body: { actionId, subject: 'math' } });
    view = done.view;
    let guard = 0;
    while (view.pendingEvent && view.status === 'playing' && guard < 8) {
      guard += 1;
      const resolved = await api.request('/api/event', {
        method: 'POST',
        body: { choiceId: view.pendingEvent.choices[0].id },
      });
      view = resolved.view;
    }
  }
  assert.ok(view.turn >= 2, `发布页那份引擎没能推进回合（turn=${view.turn}）`);
});

test('发布页顺带托管的更新清单与内容包不漂移', () => {
  const manifest = normalizeManifest(JSON.parse(readDocs('content/update-manifest.json')));
  const checked = validateManifest(manifest);
  assert.equal(checked.ok, true, `清单不合法：${JSON.stringify(checked)}`);

  const pack = JSON.parse(readDocs('content/official-pack.json'));
  assert.equal(manifest.latest.checksum, checksumPack(pack), '清单里的校验和和包对不上，玩家会一直提示更新');
  assert.equal(manifest.latest.url, 'official-pack.json', '包地址用相对路径，换域名就不用改清单');
  assert.ok(!/^https?:/i.test(manifest.latest.url));
  // 同一份包在仓库里的规范位置也要一致，避免两处各改一半
  const official = JSON.parse(read('web/content/official-pack.json'));
  assert.equal(checksumPack(official), manifest.latest.checksum);
});

test('docs/ 里有 .nojekyll，Pages 才不会拿 Jekyll 去处理这些文件', () => {
  assert.ok(exists('.nojekyll'), '缺少 docs/.nojekyll');
  assert.ok(exists('download/latest.json'));
  assert.ok(exists('play/index.html'));
  assert.ok(exists('src/update.js'));
});

test('页面素材体积在预算内（手机流量党友好）', () => {
  const html = readDocs('index.html');
  const shots = [...new Set([...html.matchAll(/src="\.\/(assets\/shots\/[^"]+)"/g)].map((match) => match[1]))];
  assert.equal(shots.length, 7, `截图应该有 7 张，实际 ${shots.length} 张`);

  let total = 0;
  for (const shot of shots) {
    const size = statSync(join(docsDir, ...shot.split('/'))).size;
    total += size;
    assert.ok(size <= 260 * 1024, `${shot} 单张 ${Math.round(size / 1024)} KB，超过 260 KB`);
  }
  assert.ok(total <= 700 * 1024, `截图合计 ${Math.round(total / 1024)} KB，超过 700 KB`);
  assert.ok(statSync(join(docsDir, 'assets', 'og.jpg')).size <= 150 * 1024, 'OG 分享图太大');

  const own = statSync(join(docsDir, 'assets', 'site.js')).size + statSync(join(docsDir, 'assets', 'style.css')).size;
  assert.ok(own <= 120 * 1024, `发布页自己的 JS+CSS 有 ${Math.round(own / 1024)} KB，太胖了`);
});

test('发布页脚本没有调试残留，也没有内联脚本（CSP 会挡住）', () => {
  const js = readDocs('assets/site.js');
  for (const bad of ['console.log', 'debugger', 'alert(', 'TODO']) {
    assert.ok(!js.includes(bad), `site.js 里残留了 ${bad}`);
  }

  const html = readDocs('index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(html), '不能有内联脚本');
  assert.match(html, /script-src 'self'/, '应该声明 CSP');
  assert.match(html, /defer/, '脚本要 defer，别挡住首屏渲染');
});

test('发布页的文本文件都是无 BOM 的 UTF-8', () => {
  const files = ['index.html', 'assets/style.css', 'assets/site.js', 'download/latest.json', 'content/update-manifest.json'];
  for (const file of files) {
    const buffer = readFileSync(join(docsDir, ...file.split('/')));
    assert.notEqual(buffer[0], 0xef, `docs/${file} 带了 BOM`);
    const text = buffer.toString('utf8');
    assert.ok(!text.includes('\uFFFD'), `docs/${file} 不是合法的 UTF-8`);
  }
});

/* --------------------------------------------------- 预览服务器 / 脚本 */

test('本地预览服务器按 Pages 的方式发文件（MIME / 下载 / 404）', async () => {
  const server = createPagesServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const info = JSON.parse(readDocs('download/latest.json'));

  const get = async (pathname, method = 'GET') => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
    const body = await response.arrayBuffer();
    return {
      status: response.status,
      type: response.headers.get('content-type') ?? '',
      length: body.byteLength,
      allowOrigin: response.headers.get('access-control-allow-origin'),
    };
  };

  try {
    const index = await get('/');
    assert.equal(index.status, 200);
    assert.match(index.type, /text\/html; charset=utf-8/);
    assert.equal(index.allowOrigin, '*', '预览服务器要带上 CORS 头，方便验证手机端拉清单');

    for (const pathname of ['/assets/site.js', '/play/app.js', '/play/local-api.js', '/src/engine.js']) {
      const asset = await get(pathname);
      assert.equal(asset.status, 200, `${pathname} 打不开`);
      assert.match(asset.type, /text\/javascript; charset=utf-8/, `${pathname} 的 MIME 不对，ES 模块会被浏览器拒绝`);
    }

    const image = await get('/assets/shots/setup.jpg');
    assert.match(image.type, /image\/jpeg/);

    const apk = await get(`/download/${encodeURIComponent(info.file)}`);
    assert.equal(apk.status, 200);
    assert.match(apk.type, /application\/vnd\.android\.package-archive/);
    assert.equal(apk.length, info.bytes, '下载下来的 APK 和文件大小对不上');

    assert.equal((await get('/nope.js')).status, 404);
    assert.equal((await get('/../package.json')).status, 404, '不能读到 docs/ 以外的文件');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

/* ----------------------------------------------------- 页面脚本的行为 */

/**
 * 一个刚好够 site.js 用的假 DOM：元素属性、事件、querySelector 都按真实
 * index.html 里的 id / class / data-* 建出来——所以这些选择器一旦改了名，
 * 测试就会红，而不是等到线上点不动。
 */
function createFakeBrowser(html, buildInfo) {
  const makeElement = (attributes = {}) => {
    const listeners = new Map();
    const element = {
      hidden: false,
      textContent: '',
      src: '',
      alt: '',
      style: {},
      value: '',
      image: null,
      focused: false,
      removed: false,
      getAttribute: (name) => (name in attributes ? attributes[name] : null),
      setAttribute: (name, value) => {
        attributes[name] = String(value);
      },
      removeAttribute: (name) => {
        delete attributes[name];
      },
      addEventListener: (type, handler) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
      },
      dispatch: (type, event = {}) => {
        for (const handler of listeners.get(type) ?? []) handler(event);
      },
      focus: () => {
        element.focused = true;
      },
      select: () => {},
      appendChild: (child) => child,
      remove: () => {
        element.removed = true;
      },
      querySelector: (selector) => (selector === 'img' ? element.image : null),
    };
    return element;
  };

  const byId = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], makeElement()]));
  const lightbox = byId.get('lightbox');
  if (lightbox) lightbox.hidden = /id="lightbox"[^>]*hidden|hidden[^>]*id="lightbox"/.test(html);

  const shotButtons = [...html.matchAll(/class="shot-btn" data-full="([^"]+)" data-title="([^"]+)"[\s\S]*?<img[^>]*alt="([^"]*)"/g)].map(
    (match) => {
      const button = makeElement({ 'data-full': match[1], 'data-title': match[2] });
      const image = makeElement({ alt: match[3] });
      button.image = image;
      return button;
    },
  );

  const copyButtons = [...html.matchAll(/data-copy-link="([^"]+)"/g)].map((match) =>
    makeElement({ 'data-copy-link': match[1] }),
  );

  const selectors = {
    '.shot-btn': shotButtons,
    '[data-copy-link]': copyButtons,
    '[data-version-badge]': [...html.matchAll(/data-version-badge/g)].map(() => makeElement()),
    '[data-apk-size]': [...html.matchAll(/data-apk-size/g)].map(() => makeElement()),
    '[data-apk-version]': [...html.matchAll(/data-apk-version/g)].map(() => makeElement()),
    '[data-apk-sha]': [...html.matchAll(/data-apk-sha/g)].map(() => makeElement()),
    '[data-year]': [...html.matchAll(/data-year/g)].map(() => makeElement()),
  };

  const documentListeners = [];
  const clipboard = [];

  const fakeDocument = {
    getElementById: (id) => byId.get(id) ?? null,
    querySelectorAll: (selector) => selectors[selector] ?? [],
    createElement: () => makeElement(),
    body: { appendChild: () => {} },
    addEventListener: (type, handler) => documentListeners.push({ type, handler }),
    execCommand: () => true,
  };

  const fakeNavigator = { clipboard: { writeText: (text) => (clipboard.push(text), Promise.resolve()) } };
  const fakeFetch = async () => ({ ok: true, json: async () => buildInfo });

  return {
    byId,
    shotButtons,
    copyButtons,
    selectors,
    clipboard,
    documentListeners,
    document: fakeDocument,
    navigator: fakeNavigator,
    fetch: fakeFetch,
    keydown: (key) => {
      for (const entry of documentListeners) if (entry.type === 'keydown') entry.handler({ key });
    },
  };
}

test('点截图会放大、Esc 会关掉、复制按钮复制的是频道链接', async () => {
  const html = readDocs('index.html');
  const browser = createFakeBrowser(html, JSON.parse(readDocs('download/latest.json')));
  const source = readDocs('assets/site.js');

  // site.js 是没有 import 的普通脚本，用 new Function 在假 DOM 里跑一遍
  const run = new Function('document', 'navigator', 'fetch', 'setTimeout', 'clearTimeout', source);
  run(browser.document, browser.navigator, browser.fetch, setTimeout, clearTimeout);

  assert.equal(browser.shotButtons.length, 7, 'index.html 里的截图数量变了');
  const lightbox = browser.byId.get('lightbox');
  assert.equal(lightbox.hidden, true, '放大层初始应该是隐藏的');

  browser.shotButtons[0].dispatch('click');
  assert.equal(lightbox.hidden, false, '点了截图应该弹出放大层');
  assert.equal(browser.byId.get('lightbox-img').src, './assets/shots/setup.jpg');
  assert.equal(browser.byId.get('lightbox-title').textContent, '开局构筑：角色模板 + 捏人');

  browser.keydown('Escape');
  assert.equal(lightbox.hidden, true, 'Esc 应该关掉放大层');

  browser.copyButtons[0].dispatch('click');
  await tick();
  await tick();
  assert.deepEqual(browser.clipboard, [CHANNEL_URL]);
  assert.match(browser.byId.get('toast').textContent, /复制/);

  // latest.json 里的版本号 / 体积 / 校验和会自动填进页面
  await tick();
  const info = JSON.parse(readDocs('download/latest.json'));
  assert.equal(browser.selectors['[data-version-badge]'][0].textContent, `v${info.version}`);
  assert.equal(browser.selectors['[data-apk-size]'][0].textContent, `${Math.round(info.bytes / 1024)} KB`);
  assert.equal(browser.selectors['[data-apk-sha]'][0].textContent, `${info.sha256.slice(0, 24)}…`);
  assert.ok(Number(browser.selectors['[data-year]'][0].textContent) >= 2026);
});

test('打包脚本把「在线试玩副本 + APK + 清单 + zip」一次同步好', () => {
  const script = read('tools/build-pages.mjs');
  assert.match(script, /collectModulesChecked/, '模块清单要由 import 图推导，不能手写');
  assert.match(script, /\.nojekyll/);
  assert.match(script, /deflateRawSync/, 'zip 用 zlib 直接写，不引依赖');
  assert.match(script, /sha256/, 'latest.json 要带真实校验和');
  assert.match(script, /checkShotAssets/, '打包前要检查截图是否齐全');
  assert.ok(!/cpSync\([^)]*index\.html/.test(script), '不能覆盖手写的 docs/index.html');
  assert.ok(existsSync(join(root, 'tools', 'build-pages-shots.py')), '压截图的脚本丢了');
});
