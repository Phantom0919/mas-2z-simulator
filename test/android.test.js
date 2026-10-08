/**
 * Android 打包链路测试：不需要 Android SDK 也能跑的那部分全部覆盖。
 *
 *   - web/local-api.js 与 HTTP 接口的行为一致性（离线模式的核心）
 *   - Android 工程文件与打包脚本的配置契约
 *   - PWA 清单与图标
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createLocalApi, shouldUseLocalApi } from '../web/local-api.js';
import { TRAITS } from '../src/data/character.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => readFileSync(join(root, relative), 'utf8');

/** 回合里可能弹出需要选择的事件，界面会先让玩家选完再进下一阶段。 */
async function settleEvents(api, view) {
  let current = view;
  let guard = 0;
  while (current.pendingEvent && current.status === 'playing' && guard < 8) {
    guard += 1;
    const resolved = await api.request('/api/event', {
      method: 'POST',
      body: { choiceId: current.pendingEvent.choices[0].id },
    });
    current = resolved.view;
  }
  return current;
}

/* --------------------------------------------------- 离线（页面内）引擎 */

test('离线接口：开局 → 两段制 → 商店 → 导出，与 HTTP 版行为一致', async () => {
  const api = createLocalApi();
  assert.equal(api.mode, 'local');

  const health = await api.request('/api/health');
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'local');

  const options = await api.request('/api/options');
  // 用数据本身当基准：以后加天赋不用再来改测试里的魔法数字
  assert.equal(options.traits.length, TRAITS.length);
  assert.ok(options.traits.length >= 10);
  assert.equal(options.tracks.length, 2);
  assert.equal(options.electivePick, 2);
  assert.ok(options.catalog.length >= 20);
  assert.equal(options.defaultWeeks, 6);

  const created = await api.request('/api/new', {
    method: 'POST',
    body: {
      name: '离线测试',
      seed: 'local-1',
      track: 'history',
      electives: ['politics', 'geography'],
      traits: ['memory', 'nightowl'],
      background: 'town',
      goal: 'yiben',
    },
  });
  assert.equal(created.gameId, 'local');
  assert.equal(created.view.phase, 'main');
  assert.equal(created.view.selection.label, '历史类 · 政治+地理');
  assert.equal(created.view.subjects.length, 6);

  const main = await api.request('/api/action', { method: 'POST', body: { gameId: 'local', actionId: 'drill', subject: 'history' } });
  assert.ok(main.lines.length > 0);
  const afterMain = await settleEvents(api, main.view);
  assert.equal(afterMain.phase, 'weekend');
  const before = afterMain.subjects.find((subject) => subject.key === 'history').knowledge;
  assert.ok(before > 0);

  const weekend = await api.request('/api/action', { method: 'POST', body: { gameId: 'local', actionId: 'sport' } });
  const afterWeekend = await settleEvents(api, weekend.view);
  assert.equal(afterWeekend.phase, 'main');
  assert.equal(afterWeekend.turn, 1);

  const moneyBefore = afterWeekend.stats.money;
  const shop = await api.request('/api/shop', { method: 'POST', body: { gameId: 'local', itemId: 'workbook' } });
  assert.equal(shop.view.stats.money, moneyBefore - 320);
  assert.equal(shop.view.turn, 1, '买东西不消耗时间');

  const exported = await api.request('/api/export?gameId=local');
  assert.match(exported.save, /"version":2/);

  const imported = await api.request('/api/import', { method: 'POST', body: { save: exported.save } });
  assert.equal(imported.view.turn, 1);
  const view = await api.request('/api/view?gameId=local');
  assert.equal(view.view.turn, 1);
});

test('离线接口：错误信息与 HTTP 版一致（中文、可直接弹 toast）', async () => {
  const api = createLocalApi();
  await assert.rejects(() => api.request('/api/action', { method: 'POST', body: { actionId: 'listen' } }), /过期/);
  await api.request('/api/new', { method: 'POST', body: { seed: 'local-2' } });
  await assert.rejects(() => api.request('/api/action', { method: 'POST', body: { actionId: 'drill' } }), /科目/);
  await assert.rejects(() => api.request('/api/action', { method: 'POST', body: { actionId: 'drill', subject: 'politics' } }), /可选范围/);
  await assert.rejects(() => api.request('/api/shop', { method: 'POST', body: { itemId: 'nope' } }), /没有这个商品/);
  await assert.rejects(() => api.request('/api/nothing'), /没有这个接口/);
});

test('离线接口：可以一路打到结局（含高考后的志愿填报）', async () => {
  const api = createLocalApi();
  await api.request('/api/new', { method: 'POST', body: { name: '离线通关', seed: 'local-full', weeksPerSemester: 4, difficulty: 'easy' } });
  let guard = 0;
  let view = (await api.request('/api/view?gameId=local')).view;
  while ((view.status === 'playing' || view.status === 'volunteering') && guard < 300) {
    guard += 1;
    // 高考之后进入志愿填报：离线接口也必须能提交志愿（手机上没有服务端，全靠它）
    if (view.status === 'volunteering') {
      const options = view.volunteer?.options ?? [];
      assert.ok(options.length > 0, '志愿表不该是空的');
      const picks = options
        .slice()
        .sort((a, b) => a.minScore - b.minScore)
        .slice(0, view.volunteer.slots)
        .map((option) => option.id);
      const submitted = await api.request('/api/volunteer', { method: 'POST', body: { picks, adjust: true } });
      view = submitted.view;
      assert.ok(submitted.lines?.length > 0, '提交志愿应该有结算文字');
      continue;
    }
    const decision =
      view.phase === 'main' ? { actionId: 'listen' } : { actionId: 'sport' };
    const result = await api.request('/api/action', { method: 'POST', body: decision });
    view = result.view;
    let inner = 0;
    while (view.pendingEvent && view.status === 'playing' && inner < 6) {
      inner += 1;
      const choiceId = view.pendingEvent.choices[0].id;
      const resolved = await api.request('/api/event', { method: 'POST', body: { choiceId } });
      view = resolved.view;
    }
  }
  assert.equal(view.status, 'ended');
  assert.ok(view.ending?.title);
  assert.ok(view.ending?.achievements);
  // 走完志愿填报的局，结局里要带上录取详情
  assert.ok(view.ending?.volunteer, '结局应该带录取结果（学校 / 专业 / 第几志愿）');
});

test('shouldUseLocalApi 在 Node 环境下不会误判', () => {
  assert.equal(shouldUseLocalApi(), false, '没有 window 时返回 false');
});

/* ------------------------------------------------------- Android 工程 */

test('Android 工程文件齐全，Manifest 指向正确入口', () => {
  const manifest = read('android/app/AndroidManifest.xml');
  assert.match(manifest, /package="com\.mas2z\.simulator"/);
  assert.match(manifest, /android:name="\.MainActivity"/);
  assert.match(manifest, /android\.intent\.category\.LAUNCHER/);
  assert.match(manifest, /android:minSdkVersion="21"/);
  assert.match(manifest, /@mipmap\/ic_launcher/);

  // 适配所有机型：不锁竖屏（平板 / 横屏都能用），并声明支持各种屏幕
  assert.match(manifest, /android:screenOrientation="fullUser"/);
  assert.ok(!/screenOrientation="portrait"/.test(manifest), '不该把屏幕锁死在竖屏');
  assert.match(manifest, /android:anyDensity="true"/);
  assert.match(manifest, /android:xlargeScreens="true"/);
  assert.match(manifest, /android:resizeableActivity="true"/);
  // 旋转 / 分屏 / 改字体都不要重建 Activity（重建会丢掉当前界面的状态）
  for (const change of ['orientation', 'screenSize', 'smallestScreenSize', 'density', 'fontScale']) {
    assert.ok(manifest.includes(change), `configChanges 应该包含 ${change}`);
  }

  for (const file of [
    'android/app/java/com/mas2z/simulator/MainActivity.java',
    'android/app/res/values/strings.xml',
    'android/app/res/values/styles.xml',
  ]) {
    assert.ok(existsSync(join(root, file)), `缺少 ${file}`);
  }

  const strings = read('android/app/res/values/strings.xml');
  assert.match(strings, /中二野人实验室/);
});

test('适配全面屏：刘海 / 安全区 / 自适应缩放都配好了', () => {
  const styles = read('android/app/res/values/styles.xml');
  assert.match(styles, /windowLayoutInDisplayCutoutMode/, '刘海屏要允许内容画进挖孔区');
  assert.match(styles, /shortEdges/);
  assert.match(styles, /enforceNavigationBarContrast/, '导航栏不要对比度蒙层');

  const java = read('android/app/java/com/mas2z/simulator/MainActivity.java');
  assert.match(java, /setUseWideViewPort\(true\)/, '要按网页自己的 viewport 排版');
  assert.match(java, /setTextZoom\(100\)/, '系统字体大小不该把版式撑坏');
  assert.match(java, /setFitsSystemWindows\(false\)/, '要能画到状态栏后面');

  const html = read('web/index.html');
  assert.match(html, /viewport-fit=cover/, '网页要声明铺满刘海屏');
});

test('MainActivity 用虚拟域名拦截 assets，并开了 DOM 存储', () => {
  const java = read('android/app/java/com/mas2z/simulator/MainActivity.java');
  assert.match(java, /https:\/\/mas2z\.local\//, '应该用虚拟 https 域名，否则 file:// 下 ES 模块会被 CORS 拦掉');
  assert.match(java, /shouldInterceptRequest/);
  assert.match(java, /setDomStorageEnabled\(true\)/, 'localStorage 需要 DOM 存储');
  assert.match(java, /setJavaScriptEnabled\(true\)/);
  assert.match(java, /setAllowFileAccess\(false\)/);
  assert.match(java, /www\/index\.html/, '入口应该是 assets/www/index.html');
  assert.match(java, /text\/javascript/, '必须给 .js 正确的 MIME，否则模块加载失败');
});

test('打包脚本不需要 Gradle，且包含完整链路', () => {
  const script = read('tools/build-apk.mjs');
  for (const tool of ['aapt2', 'zipalign', 'd8.jar', 'apksigner.jar']) {
    assert.ok(script.includes(tool), `打包脚本应该用到 ${tool}`);
  }
  assert.ok(!/gradlew|gradle\.bat|gradle assemble|android\.gradle/i.test(script), '不应该调用 Gradle 命令');
  assert.match(script, /com\.android\.tools\.r8\.D8/, '用 java 直接跑 d8 主类（Windows 上不能 spawn .bat）');
  assert.match(script, /assets', 'www'/, '网页要放进 assets/www');
  assert.match(script, /assets', \.\.\.module\.split/, '引擎模块要按 import 图放进 assets/src');
  assert.match(script, /collectModulesChecked/, '模块清单应该由 import 图推导，不能手写');
  assert.match(script, /debug\.keystore/);
});

test('发版时 package.json 和 AndroidManifest 的版本号必须一致', () => {
  const pkg = JSON.parse(read('package.json'));
  const manifest = read('android/app/AndroidManifest.xml');
  const name = /android:versionName="([^"]+)"/.exec(manifest)?.[1];
  const code = /android:versionCode="(\d+)"/.exec(manifest)?.[1];
  assert.equal(name, pkg.version, 'AndroidManifest 的 versionName 要和 package.json 一致（改版本时两个都改）');
  // versionCode 用 major*10000 + minor*100 + patch，方便安卓按大小升级
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  assert.equal(code, String(major * 10000 + minor * 100 + patch), 'versionCode 应该由版本号推出来');
});

test('浏览器模块图能收全新模块，且不含 Node 专用文件', async () => {
  const { collectModulesChecked } = await import('../tools/module-graph.mjs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');

  const root = fileURLToPath(new URL('..', import.meta.url));
  const { modules, problems } = collectModulesChecked({
    root,
    entries: ['local-api.js', 'relations-view.js'].map((name) => path.join(root, 'web', name)),
    required: [
      'src/engine.js',
      'src/rng.js',
      'src/story.js',
      'src/tree.js',
      'src/data/school.js',
      'src/data/character.js',
      'src/data/items.js',
      'src/data/actions.js',
      'src/data/events.js',
      'src/data/events2.js',
      'src/data/names.js',
      'src/data/cast.js',
      'src/data/story.js',
    ],
    forbidden: ['src/server.js', 'src/cli.js', 'src/profile.js', 'src/prompt.js', 'src/strategies.js'],
  });

  assert.deepEqual(problems, [], problems.join('；'));
  // 这些是 Node 专用的，浏览器版本一旦间接引用到就会白屏
  for (const unwanted of ['src/server.js', 'src/cli.js', 'src/profile.js', 'src/prompt.js']) {
    assert.ok(!modules.includes(unwanted), `模块图里混进了 ${unwanted}`);
  }
  assert.ok(modules.every((name) => name.startsWith('web/') || name.startsWith('src/')), '模块图里不该有仓库外的路径');
});

test('模块图能发现写错的 import 路径', async () => {
  const { collectModules } = await import('../tools/module-graph.mjs');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');

  const dir = mkdtempSync(path.join(tmpdir(), 'mas2z-module-'));
  writeFileSync(path.join(dir, 'entry.js'), "import './exists.js';\nimport './missing.js';\n", 'utf8');
  writeFileSync(path.join(dir, 'exists.js'), "export const ok = true;\n", 'utf8');

  const { modules, missing } = collectModules({ root: dir, entries: [path.join(dir, 'entry.js')] });
  assert.deepEqual(modules.sort(), ['entry.js', 'exists.js']);
  assert.deepEqual(missing, ['missing.js']);
});

test('SDK 安装脚本不依赖 Android Studio 与 Gradle', () => {
  const script = read('tools/android-sdk.mjs');
  assert.match(script, /dl\.google\.com\/android\/repository\/commandlinetools/);
  assert.match(script, /platforms;android-34/);
  assert.match(script, /build-tools;34\.0\.0/);
  assert.match(script, /sdkmanager-classpath\.jar/, '直接调 Java 主类，绕开 .bat');
  assert.ok(!/gradlew|gradle\.bat|gradle assemble/i.test(script));
});

/* --------------------------------------------------------------- PWA */

test('PWA 清单与图标齐备，可"添加到主屏幕"', () => {
  const manifest = JSON.parse(read('web/manifest.webmanifest'));
  assert.equal(manifest.name, '中二野人实验室');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './index.html');
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const file = icon.src.replace('./', 'web/');
    assert.ok(existsSync(join(root, file)), `缺少图标 ${file}`);
  }

  const html = read('web/index.html');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /theme-color/);
});

test('前端会自动在"服务端模式"和"离线模式"之间切换', () => {
  const app = read('web/app.js');
  assert.match(app, /import \{ createLocalApi \} from '\.\/local-api\.js'/);
  assert.match(app, /async function detectApiMode\(\)/);
  assert.match(app, /location\.protocol === 'file:'/, 'file:// 下应该直接用本地引擎');
  assert.match(app, /localApi\.request\(path/);
  assert.match(app, /mode-badge/);
});

/* ------------------------------------------------------------ 成品 APK */

/** 读 zip 中央目录，拿到条目名（不依赖任何 zip 库）。 */
function zipEntryNames(file) {
  const buffer = readFileSync(file);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, '不是合法的 zip/apk');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

test('打好的 APK 资源布局正确（存在 dist/*.apk 时才检查）', (t) => {
  const distDir = join(root, 'dist');
  // 取最新的那个 apk：dist 里可能同时留着几个历史版本
  const apk = existsSync(distDir)
    ? readdirSync(distDir)
        .filter((name) => name.endsWith('.apk'))
        .map((name) => ({ name, at: statSync(join(distDir, name)).mtimeMs }))
        .sort((a, b) => b.at - a.at)[0]?.name
    : null;
  if (!apk) {
    t.skip('还没有打过 APK（node tools/build-apk.mjs）');
    return;
  }

  const names = zipEntryNames(join(distDir, apk));
  for (const required of ['AndroidManifest.xml', 'classes.dex', 'resources.arsc']) {
    assert.ok(names.includes(required), `APK 里缺少 ${required}`);
  }

  // WebView 按 assets/www/... 取文件，且 ../src/engine.js 必须能解析到
  for (const required of [
    'assets/www/index.html',
    'assets/www/app.js',
    'assets/www/local-api.js',
    'assets/www/relations-view.js',
    'assets/www/style.css',
    'assets/src/engine.js',
    'assets/src/rng.js',
    'assets/src/story.js',
    'assets/src/tree.js',
    'assets/src/data/school.js',
    'assets/src/data/names.js',
    'assets/src/data/cast.js',
    'assets/src/data/story.js',
    // v2.5：自定义人物与校园日常事件的数据也要一起进包
    'assets/src/data/character.js',
    'assets/src/data/events5.js',
    'assets/src/data/calendar.js',
  ]) {
    assert.ok(names.includes(required), `APK 里缺少 ${required}`);
  }

  // aapt2 在 Windows 上会把资产名写成反斜杠，Android 的 AssetManager 找不到，必须为 0
  assert.deepEqual(
    names.filter((name) => name.includes('\\')),
    [],
    'APK 条目名里不能有反斜杠',
  );

  // 不能混进 Node 专用的源码
  for (const unwanted of ['assets/src/server.js', 'assets/src/cli.js', 'assets/src/profile.js']) {
    assert.ok(!names.includes(unwanted), `APK 不应该打包 ${unwanted}`);
  }

  assert.ok(statSync(join(distDir, apk)).size > 100 * 1024, 'APK 体积异常');
});

/**
 * 把 APK 里的 assets 解出来，直接 import 里面那份 local-api.js 打一局。
 *
 * 这是"手机装上去到底能不能玩"最接近的验证：只要 APK 少打包了任何一个模块，
 * 这里的 import 就会直接失败，而不是等到用户装到手机上看到白屏。
 */
test('APK 里的资源是完整可运行的（解包后真的能打一局）', async (t) => {
  const distDir = join(root, 'dist');
  const apk = existsSync(distDir)
    ? readdirSync(distDir)
        .filter((name) => name.endsWith('.apk'))
        .map((name) => ({ name, at: statSync(join(distDir, name)).mtimeMs }))
        .sort((a, b) => b.at - a.at)[0]?.name
    : null;
  if (!apk) {
    t.skip('还没有打过 APK（node tools/build-apk.mjs）');
    return;
  }

  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { dirname, sep } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { inflateRawSync } = await import('node:zlib');

  const buffer = readFileSync(join(distDir, apk));
  const workDir = mkdtempSync(join(tmpdir(), 'mas2z-apk-'));

  // 走中央目录取每个条目的信息，再用它的"本地头偏移"定位数据。
  // 直接顺着头扫不行：jar 写出来的条目可能把长度放在数据后面的 data descriptor 里。
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, 'APK 不是合法的 zip');

  const total = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  let extracted = 0;

  for (let i = 0; i < total; i += 1) {
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (!name.startsWith('assets/')) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    const target = join(workDir, ...name.replace(/^assets\//, '').split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, method === 8 ? inflateRawSync(raw) : raw);
    extracted += 1;
  }
  assert.ok(extracted >= 20, `从 APK 里解出来的资源太少（${extracted} 个）`);

  // 解出来的目录没有 package.json，Node 会把这些 .js 当成 CommonJS；补一个 type: module
  // （手机上的 WebView 是按 <script type="module"> 加载的，不存在这个问题）
  writeFileSync(join(workDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');

  // 解出来的这份代码必须能真的跑起来
  const extractedApi = await import(pathToFileURL(join(workDir, 'www', 'local-api.js')).href);
  const api = extractedApi.createLocalApi();
  const options = await api.request('/api/options');
  assert.equal(options.tracks.length, 2);
  assert.ok(options.catalog.length >= 20);

  const created = await api.request('/api/new', {
    method: 'POST',
    body: {
      name: '安卓测试',
      seed: 'apk-run',
      track: 'physics',
      electives: ['chemistry', 'biology'],
      traits: ['memory', 'easygoing'],
      background: 'worker',
      goal: 'c985',
    },
  });
  assert.equal(created.view.cast.length, 8, 'APK 里应该带上随机人物');
  assert.equal(created.view.story.arcs.length, 7, 'APK 里应该带上七条剧情线');

  // 真的推进几周，顺带把关系图和故事线接口走一遍
  let view = created.view;
  for (const actionId of ['listen', 'sport', 'drill', 'sleep']) {
    const done = await api.request('/api/action', { method: 'POST', body: { actionId, subject: 'math' } });
    view = await settleEvents(api, done.view);
  }
  assert.ok(view.turn >= 2, `APK 里的引擎没能推进回合（turn=${view.turn}）`);

  const relations = await api.request('/api/relations');
  assert.equal(relations.graph.people.length, 8);
  assert.ok(relations.text.includes('家里'));

  const story = await api.request('/api/story');
  assert.equal(story.catalog.length, 7);

  const name = await api.request('/api/random-name?gender=%E5%A5%B3');
  assert.match(name.name, /^[\u4e00-\u9fa5]{2,4}$/);
});

