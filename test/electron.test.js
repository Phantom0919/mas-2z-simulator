/**
 * Electron 客户端测试：不需要 Electron 运行时，能测的部分全部覆盖。
 *
 *   - electron/boot.js     内嵌 HTTP 服务（真的起服务、真的打接口）
 *   - electron/menu.js     菜单模板与命令派发
 *   - electron/window-state.js  窗口状态校验与持久化
 *   - electron/main.cjs / preload.cjs  语法检查 + 与前端的能力契约
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { startEmbeddedServer, stopEmbeddedServer } from '../electron/boot.js';
import { TRAITS } from '../src/data/character.js';
import { buildMenuTemplate, collectMenuCommands } from '../electron/menu.js';
import { DEFAULT_BOUNDS, MIN_HEIGHT, MIN_WIDTH, loadWindowState, normalizeState, saveWindowState } from '../electron/window-state.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => readFileSync(join(root, relative), 'utf8');

/* ------------------------------------------------------------ 内嵌服务 */

test('内嵌服务监听随机端口并能响应接口', async () => {
  const embedded = await startEmbeddedServer();
  try {
    assert.match(embedded.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(embedded.port > 0);

    const health = await fetch(`${embedded.url}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const page = await fetch(`${embedded.url}/`).then((response) => response.text());
    assert.match(page, /马鞍山二中模拟器/);

    const options = await fetch(`${embedded.url}/api/options`).then((response) => response.json());
    assert.equal(options.traits.length, TRAITS.length);
    assert.ok(options.catalog.length >= 20);
  } finally {
    await stopEmbeddedServer(embedded.server);
  }
});

test('内嵌服务可以指定端口，也能干净关闭', async () => {
  const embedded = await startEmbeddedServer({ port: 0 });
  const { port } = embedded;
  await stopEmbeddedServer(embedded.server);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
});

test('两次启动拿到不同端口（不会互相抢占）', async () => {
  const a = await startEmbeddedServer();
  const b = await startEmbeddedServer();
  try {
    assert.notEqual(a.port, b.port);
  } finally {
    await stopEmbeddedServer(a.server);
    await stopEmbeddedServer(b.server);
  }
});

/* ---------------------------------------------------------------- 菜单 */

test('菜单包含桌面版该有的命令与快捷键', () => {
  const dispatched = [];
  const template = buildMenuTemplate({ appName: '测试应用', onCommand: (command) => dispatched.push(command) });

  const labels = template.map((menu) => menu.label);
  assert.deepEqual(labels, ['游戏', '编辑', '视图', '帮助']);

  const game = template.find((menu) => menu.label === '游戏');
  const gameLabels = game.submenu.map((item) => item.label).filter(Boolean);
  assert.ok(gameLabels.includes('新的一局'));
  assert.ok(gameLabels.includes('导出存档…'));
  assert.ok(gameLabels.includes('导入存档…'));
  assert.ok(gameLabels.includes('结局图鉴'));
  assert.ok(gameLabels.includes('商店'));

  const accelerators = Object.fromEntries(
    game.submenu.filter((item) => item.accelerator).map((item) => [item.label, item.accelerator]),
  );
  assert.equal(accelerators['新的一局'], 'CmdOrCtrl+N');
  assert.equal(accelerators['导出存档…'], 'CmdOrCtrl+S');
  assert.equal(accelerators['导入存档…'], 'CmdOrCtrl+O');

  // 点击菜单项会派发对应的命令
  for (const item of game.submenu) {
    if (typeof item.click === 'function' && item.label !== '退出') item.click();
  }
  assert.deepEqual(dispatched, ['new-game', 'export', 'import', 'gallery', 'shop']);
});

test('菜单里的 role 是合法的 Electron 角色，帮助项走原生回调', () => {
  let readmeOpened = false;
  let aboutShown = false;
  const template = buildMenuTemplate({
    openReadme: () => {
      readmeOpened = true;
    },
    showAbout: () => {
      aboutShown = true;
    },
  });
  const roles = [];
  for (const menu of template) {
    for (const item of menu.submenu ?? []) {
      if (item.role) roles.push(item.role);
    }
  }
  const allowed = new Set([
    'quit',
    'undo',
    'redo',
    'cut',
    'copy',
    'paste',
    'selectAll',
    'reload',
    'forceReload',
    'toggleDevTools',
    'resetZoom',
    'zoomIn',
    'zoomOut',
    'togglefullscreen',
  ]);
  for (const role of roles) assert.ok(allowed.has(role), `未知的 role：${role}`);

  const help = template.find((menu) => menu.label === '帮助');
  help.submenu[0].click();
  help.submenu[1].click();
  assert.equal(readmeOpened, true);
  assert.equal(aboutShown, true);
});

test('collectMenuCommands 能列出所有可点击项', () => {
  const commands = collectMenuCommands(buildMenuTemplate({}));
  assert.ok(commands.length >= 7);
  assert.ok(commands.includes('新的一局'));
});

/* ------------------------------------------------------------ 窗口状态 */

test('窗口状态：默认值、最小尺寸、离屏回退', () => {
  const fallback = normalizeState(null, []);
  assert.equal(fallback.width, DEFAULT_BOUNDS.width);
  assert.equal(fallback.height, DEFAULT_BOUNDS.height);
  assert.equal(fallback.maximized, false);

  const tooSmall = normalizeState({ width: 100, height: 100, x: 10, y: 10 }, [{ x: 0, y: 0, width: 1920, height: 1080 }]);
  assert.equal(tooSmall.width, MIN_WIDTH);
  assert.equal(tooSmall.height, MIN_HEIGHT);

  const onScreen = normalizeState({ width: 1400, height: 900, x: 120, y: 80 }, [{ x: 0, y: 0, width: 1920, height: 1080 }]);
  assert.deepEqual(onScreen, { width: 1400, height: 900, x: 120, y: 80, maximized: false });

  // 上次在第二块屏幕上，这次拔掉了 → 交给系统居中
  const offScreen = normalizeState({ width: 1400, height: 900, x: 3000, y: 200 }, [{ x: 0, y: 0, width: 1920, height: 1080 }]);
  assert.equal(offScreen.x, undefined);
  assert.equal(offScreen.y, undefined);
  assert.equal(offScreen.width, 1400);

  const maximized = normalizeState({ width: 1400, height: 900, x: 10, y: 10, maximized: true }, [{ x: 0, y: 0, width: 1920, height: 1080 }]);
  assert.equal(maximized.maximized, true);

  // 非法输入不应该抛错
  assert.doesNotThrow(() => normalizeState({ width: 'abc', height: null, x: Number.NaN, y: '5' }, []));
});

test('窗口状态可以落盘再读回', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas2z-win-'));
  const file = join(dir, 'nested', 'window-state.json');
  try {
    assert.equal(loadWindowState(file), null, '文件不存在时返回 null');
    assert.equal(saveWindowState(file, { width: 1400, height: 900, x: 10, y: 20, maximized: false }), true);
    assert.ok(existsSync(file), '应该自动创建父目录');
    const loaded = loadWindowState(file);
    assert.equal(loaded.width, 1400);
    assert.equal(loaded.x, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------- Electron 入口 */

test('Electron 入口与 preload 语法正确', () => {
  for (const file of ['electron/main.cjs', 'electron/preload.cjs']) {
    const result = spawnSync(process.execPath, ['--check', join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file} 语法错误：${result.stderr}`);
  }
});

test('主进程做了基本的安全加固', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /preload:\s*path\.join\(__dirname, 'preload\.cjs'\)/);
  assert.match(main, /requestSingleInstanceLock/, '应该只允许开一个实例');
  assert.match(main, /will-navigate/, '应该拦截外部跳转');
  assert.match(main, /setWindowOpenHandler/, '应该拦截新窗口');
  assert.match(main, /127\.0\.0\.1/, '内嵌服务应该只监听本机');
});

test('preload 只暴露约定的最小 API', () => {
  const preload = read('electron/preload.cjs');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('mas2z'/);
  for (const method of ['saveFile', 'openFile', 'info', 'onCommand']) {
    assert.match(preload, new RegExp(`${method}:`), `preload 应该暴露 ${method}`);
  }
  assert.ok(!/require\('node:fs'\)/.test(preload), 'preload 不应该直接碰文件系统');
  assert.ok(!/nodeIntegration/.test(preload));
});

test('前端与桌面版的能力契约对得上', () => {
  const app = read('web/app.js');
  assert.match(app, /window\.mas2z\?\.saveFile/, '导出应该优先走原生对话框');
  assert.match(app, /window\.mas2z\?\.openFile/, '导入应该优先走原生对话框');
  assert.match(app, /window\.mas2z\?\.onCommand/, '应该接住原生菜单命令');
  for (const command of ['new-game', 'export', 'import', 'gallery', 'shop']) {
    assert.match(app, new RegExp(`['"]${command}['"]`), `前端应该处理 ${command} 命令`);
  }

  const html = read('web/index.html');
  assert.match(html, /Content-Security-Policy/, '页面应该有 CSP');
  assert.match(html, /default-src 'self'/);
  assert.ok(!/unsafe-eval/.test(html), 'CSP 不应该放开 eval');
});

test('打包配置指向正确的入口与图标', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'electron/main.cjs');
  assert.equal(pkg.scripts.desktop, 'electron .');
  assert.ok(pkg.devDependencies.electron, '应该声明 electron 依赖');
  assert.equal(pkg.build.appId, 'com.mas2z.simulator');
  assert.ok(pkg.build.files.includes('electron/**/*'));
  assert.ok(pkg.build.files.includes('src/**/*'));
  assert.equal(pkg.build.win.icon, 'electron/assets/icon.ico');
  assert.ok(existsSync(join(root, 'electron/assets/icon.png')), '图标应该已经生成');
  assert.ok(existsSync(join(root, 'electron/assets/icon.ico')), 'ico 图标应该已经生成');
});

/* ------------------------------------------------------------ 自检脚本 */

test('桌面版自检脚本能在真实服务上全部通过（不需要 Electron）', async () => {
  const main = read('electron/main.cjs');
  const match = main.match(/const SELF_TEST_SCRIPT = `([\s\S]*?)`;/);
  assert.ok(match, 'main.cjs 里应该有内嵌的自检脚本');

  const script = match[1];
  assert.ok(!script.includes('${'), '自检脚本里不应该有模板字符串插值（会被外层模板吃掉）');
  assert.doesNotThrow(() => new Function(`return ${script}`), '自检脚本语法应该正确');

  const html = read('web/index.html');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((item) => item[1]));

  const embedded = await startEmbeddedServer();
  try {
    const storage = new Map();
    const fakeWindow = { mas2z: { isDesktop: true, platform: 'test' } };
    const fakeDocument = {
      title: '马鞍山二中模拟器',
      getElementById: (id) => (ids.has(id) ? { id } : null),
    };
    const fakeLocalStorage = {
      setItem: (key, value) => storage.set(key, value),
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => storage.delete(key),
    };
    const scopedFetch = (url, options) => fetch(new URL(url, embedded.url).toString(), options);

    const run = new Function('window', 'document', 'fetch', 'localStorage', `return ${script}`);
    const result = await run(fakeWindow, fakeDocument, scopedFetch, fakeLocalStorage);

    assert.ok(Array.isArray(result?.checks));
    const failed = result.checks.filter((check) => !check.pass);
    assert.deepEqual(
      failed.map((check) => `${check.name}: ${check.detail}`),
      [],
      '自检脚本不应该有失败项',
    );
    assert.ok(result.checks.length >= 10, `自检项应该够多，实际 ${result.checks.length}`);
  } finally {
    await stopEmbeddedServer(embedded.server);
  }
});

/* ------------------------------------------------------------ 便携版打包 */

test('便携版打包脚本不依赖 electron-builder，且是重命名而不是复制 exe', () => {
  const script = read('tools/build-desktop.mjs');
  // 注释里可以提到 electron-builder，但不能真的调用它
  assert.ok(!/npx\s+electron-builder|execFileSync\(\s*['"]electron-builder/.test(script), '便携版打包不应该调用 electron-builder');
  assert.match(script, /node_modules', 'electron', 'dist'/, '应该复用已安装的 Electron 运行时');
  assert.match(script, /renameSync\(original, target\)/, '必须重命名 exe，复制会让包体多出 180MB');
  assert.match(script, /resources', 'app'/, '游戏文件要放进 resources/app');
  assert.match(script, /type: 'module'/, '运行时 package.json 必须保留 type: module');
  assert.match(script, /main: 'electron\/main\.cjs'/);

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['desktop:portable'], 'node tools/build-desktop.mjs');
});

/** 只读 zip 尾部的中央目录，避免把 110MB 全读进内存。 */
function zipEntryNamesPartial(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const tailSize = Math.min(size, 256 * 1024);
    const tail = Buffer.alloc(tailSize);
    readSync(fd, tail, 0, tailSize, size - tailSize);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    assert.ok(eocd >= 0, '找不到 zip 的 EOCD');
    const count = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    const central = Buffer.alloc(centralSize);
    readSync(fd, central, 0, centralSize, centralOffset);
    const names = [];
    let offset = 0;
    for (let i = 0; i < count; i += 1) {
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      names.push(central.toString('utf8', offset + 46, offset + 46 + nameLength));
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return names;
  } finally {
    closeSync(fd);
  }
}

test('便携版压缩包结构正确（存在 dist/desktop/*.zip 时才检查）', (t) => {
  const dir = join(root, 'dist', 'desktop');
  const zip = existsSync(dir) ? readdirSync(dir).find((name) => name.endsWith('.zip')) : null;
  if (!zip) {
    t.skip('还没有打便携版（node tools/build-desktop.mjs）');
    return;
  }

  const names = zipEntryNamesPartial(join(dir, zip));
  const exes = names.filter((name) => name.endsWith('.exe'));
  assert.equal(exes.length, 1, `应该只有一个 exe，实际 ${exes.length} 个：${exes.join(', ')}`);
  assert.ok(exes[0].includes('马鞍山二中模拟器'), 'exe 应该已经改名');
  assert.ok(!names.some((name) => name.endsWith('electron.exe')), '改名后不应该再留 electron.exe');

  for (const required of [
    'resources/app/package.json',
    'resources/app/electron/main.cjs',
    'resources/app/electron/preload.cjs',
    'resources/app/electron/boot.js',
    'resources/app/electron/assets/icon.png',
    'resources/app/src/server.js',
    'resources/app/src/engine.js',
    'resources/app/web/index.html',
    'resources/app/web/app.js',
    'resources/app/web/local-api.js',
  ]) {
    assert.ok(
      names.some((name) => name.endsWith(required)),
      `便携版里缺少 ${required}`,
    );
  }
});

/* ---------------------------------------------------------- NSIS 安装包 */

test('NSIS 安装脚本包含发布需要的全部要素', () => {
  const nsi = read('desktop/installer.nsi');
  // 模板占位符
  for (const placeholder of ['@@APP_NAME@@', '@@APP_EXE@@', '@@APP_VERSION@@', '@@APP_SOURCE@@', '@@OUT_FILE@@', '@@ICON_FILE@@']) {
    assert.ok(nsi.includes(placeholder), `模板里缺少占位符 ${placeholder}`);
  }
  assert.match(nsi, /Unicode true/, '必须用 Unicode，否则中文路径/界面会乱码');
  assert.match(nsi, /MUI_PAGE_DIRECTORY/, '应该让用户选安装目录');
  assert.match(nsi, /MUI_PAGE_INSTFILES/);
  assert.match(nsi, /MUI_PAGE_FINISH/);
  assert.match(nsi, /MUI_FINISHPAGE_RUN/, '完成页应该能直接启动游戏');
  assert.match(nsi, /MUI_LANGUAGE "SimpChinese"/);
  assert.match(nsi, /RequestExecutionLevel user/, '按用户安装，不要管理员权限');
  assert.match(nsi, /Section "Uninstall"/, '必须有卸载段');
  assert.match(nsi, /WriteUninstaller/, '必须生成卸载程序');
  assert.match(nsi, /CreateShortCut "\$SMPROGRAMS/, '应该有开始菜单快捷方式');
  assert.match(nsi, /CreateShortCut "\$DESKTOP/, '应该有桌面快捷方式');
  assert.match(nsi, /CurrentVersion\\Uninstall/, '应该登记到"应用和功能"');
  assert.match(nsi, /UninstallString/);
  assert.match(nsi, /InstallDir "\$LOCALAPPDATA/, '默认装到用户目录');
});

test('安装包编译脚本不依赖 electron-builder，且会替换占位符', () => {
  const script = read('tools/build-installer.mjs');
  assert.match(script, /desktop', 'installer\.nsi'/, '应该编译 desktop/installer.nsi');
  assert.match(script, /MAS2Z_MAKENSIS/, '应该支持指定 makensis');
  assert.match(script, /electron-builder', 'Cache'/, '应该能复用 electron-builder 缓存里的 NSIS');
  assert.match(script, /replaceAll\('@@APP_SOURCE@@'/, '应该替换打包源路径');
  assert.match(script, /\\ufeff/, '写临时脚本时要带 BOM（NSIS 靠它识别 UTF-8）');
  assert.ok(!/execFileSync\(\s*['"]npx|spawnSync\(\s*['"]npx/.test(script), '不应该调用 npx/electron-builder');

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.installer, 'node tools/build-installer.mjs');
});

test('打好的安装包是合法的 Windows 可执行文件（存在时才检查）', (t) => {
  const dir = join(root, 'dist', 'desktop');
  const installer = existsSync(dir) ? readdirSync(dir).find((name) => name.includes('安装版') && name.endsWith('.exe')) : null;
  if (!installer) {
    t.skip('还没有打安装包（npm run installer）');
    return;
  }

  const file = join(dir, installer);
  const buffer = Buffer.alloc(64 * 1024);
  const fd = openSync(file, 'r');
  let read = 0;
  try {
    read = readSync(fd, buffer, 0, buffer.length, 0);
  } finally {
    closeSync(fd);
  }
  assert.ok(read > 1024);
  assert.equal(buffer.toString('ascii', 0, 2), 'MZ', '不是合法的 PE 文件');
  const peOffset = buffer.readUInt32LE(0x3c);
  assert.ok(peOffset > 0 && peOffset < read, 'PE 头偏移异常');
  assert.equal(buffer.toString('ascii', peOffset, peOffset + 4), 'PE\u0000\u0000', '缺少 PE 签名');

  const stat = statSync(file);
  assert.ok(stat.size > 20 * 1024 * 1024, `安装包太小：${stat.size} 字节`);
});
