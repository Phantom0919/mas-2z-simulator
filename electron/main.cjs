/**
 * 马鞍山二中模拟器 · Electron 桌面客户端
 *
 *   npm run desktop            正常启动
 *   npm run desktop -- --dev   带开发者工具、允许打开存档目录
 *   npm run desktop -- --selftest   自检模式：跑一遍界面与接口，输出 JSON 后退出
 *
 * 架构：主进程里启动一个只监听 127.0.0.1 随机端口的内嵌 HTTP 服务（复用 src/server.js），
 * 渲染进程加载这个地址，于是网页版那份前端代码一行不改就能用，
 * 同时通过 preload 暴露的 window.mas2z 拿到原生"另存为 / 打开文件"对话框和菜单命令。
 */

'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const APP_ROOT = path.join(__dirname, '..');
const APP_NAME = '马鞍山二中模拟器';
const ICON = path.join(__dirname, 'assets', 'icon.png');

const argv = process.argv.slice(1);
const isDev = argv.includes('--dev');
const isSelfTest = argv.includes('--selftest');
const portArg = (() => {
  const index = argv.indexOf('--port');
  return index >= 0 ? Number(argv[index + 1]) || 0 : 0;
})();

let mainWindow = null;
let embedded = null;
let esm = null;

/* -------------------------------------------------------------- 生命周期 */

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('com.mas2z.simulator');
// 必须在 app ready 之前设置才生效
if (isDev && !app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', '9333');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => focusMainWindow());
  app.whenReady().then(bootstrap).catch(fatal);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap().catch(fatal);
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    if (embedded?.server) embedded.server.close();
  });
}

function fatal(error) {
  console.error(error);
  dialog.showErrorBox(`${APP_NAME} 启动失败`, String(error?.stack ?? error));
  app.exit(1);
}

async function bootstrap() {
  esm = {
    boot: await import('./boot.js'),
    menu: await import('./menu.js'),
    windowState: await import('./window-state.js'),
  };
  embedded = await esm.boot.startEmbeddedServer({ port: portArg });
  createWindow();
  installMenu();
  registerIpc();

  if (isSelfTest) {
    // 自检要有兜底，别在 CI 里挂死
    const watchdog = setTimeout(() => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: '自检超时（30 秒）' }, null, 2)}\n`);
      app.exit(1);
    }, 30000);
    try {
      const result = await runSelfTest();
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      clearTimeout(watchdog);
      embedded.server.close();
      app.exit(result.ok ? 0 : 1);
    } catch (error) {
      clearTimeout(watchdog);
      process.stdout.write(`${JSON.stringify({ ok: false, error: String(error?.message ?? error) }, null, 2)}\n`);
      app.exit(1);
    }
  }
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/* ------------------------------------------------------------------ 窗口 */

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function createWindow() {
  const saved = esm.windowState.loadWindowState(stateFile());
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const bounds = esm.windowState.normalizeState(saved, workAreas);

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: esm.windowState.MIN_WIDTH,
    minHeight: esm.windowState.MIN_HEIGHT,
    show: false,
    backgroundColor: '#0d1117',
    title: APP_NAME,
    icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (bounds.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());

  let saveTimer = null;
  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const isMaximized = mainWindow.isMaximized();
    const normal = mainWindow.getNormalBounds();
    esm.windowState.saveWindowState(stateFile(), {
      ...normal,
      maximized: isMaximized,
    });
  };
  const schedulePersist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistBounds, 400);
  };
  mainWindow.on('resize', schedulePersist);
  mainWindow.on('move', schedulePersist);
  mainWindow.on('close', persistBounds);

  // 只允许在本应用自己的地址里跳转，其他链接一律丢给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(embedded.url)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  mainWindow.loadURL(`${embedded.url}/?desktop=1`);
  return mainWindow;
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

/* ------------------------------------------------------------------ 菜单 */

function installMenu() {
  const template = esm.menu.buildMenuTemplate({
    appName: APP_NAME,
    isDev: isDev && !app.isPackaged,
    onCommand(command) {
      if (command === 'open-user-data') {
        shell.openPath(app.getPath('userData'));
        return;
      }
      mainWindow?.webContents.send('mas2z:command', command);
    },
    openReadme() {
      const readme = path.join(APP_ROOT, 'README.md');
      if (fs.existsSync(readme)) shell.openPath(readme);
      else dialog.showMessageBox({ message: '没有找到 README.md', type: 'info' });
    },
    showAbout() {
      dialog.showMessageBox(mainWindow ?? undefined, {
        type: 'info',
        title: `关于 ${APP_NAME}`,
        message: APP_NAME,
        detail: [
          `版本 ${app.getVersion()}`,
          `Electron ${process.versions.electron}　Chromium ${process.versions.chrome}　Node ${process.versions.node}`,
          '',
          '一个零依赖的 Node.js 高中生活模拟器：3+1+2 选科、天赋构筑、每周两段决策、23 个结局。',
          '游戏内容纯属虚构，与任何真实学校无关。',
          '',
          `存档目录：${app.getPath('userData')}`,
        ].join('\n'),
        buttons: ['好'],
      });
    },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('mas2z:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    url: embedded?.url ?? null,
    userData: app.getPath('userData'),
    packaged: app.isPackaged,
  }));

  ipcMain.handle('mas2z:save-file', async (_event, payload = {}) => {
    const suggested = String(payload.suggestedName || '马鞍山二中-存档.json');
    const options = {
      title: '导出存档',
      defaultPath: suggested,
      filters: [
        { name: 'JSON 存档', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const { canceled, filePath } = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return { canceled: true };
    try {
      await fsp.writeFile(filePath, String(payload.contents ?? ''), 'utf8');
      return { ok: true, path: filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('mas2z:open-file', async () => {
    const options = {
      title: '导入存档',
      properties: ['openFile'],
      filters: [
        { name: 'JSON 存档', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const { canceled, filePaths } = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (canceled || !filePaths?.length) return { canceled: true };
    try {
      const contents = await fsp.readFile(filePaths[0], 'utf8');
      return { ok: true, contents, path: filePaths[0] };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

/* ----------------------------------------------------------------- 自检 */

async function runSelfTest() {
  const checks = [];
  const add = (name, pass, detail = null) => checks.push({ name, pass: Boolean(pass), detail });
  const finish = () => ({
    ok: checks.every((check) => check.pass),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      packaged: app.isPackaged,
    },
    server: embedded?.url ?? null,
    checks,
  });

  add('内嵌服务已监听 127.0.0.1', Boolean(embedded?.url?.startsWith('http://127.0.0.1:')));

  try {
    if (!mainWindow.webContents.isLoading()) {
      // 已经加载完了
    } else {
      await new Promise((resolve) => mainWindow.webContents.once('did-finish-load', resolve));
    }
    add('页面加载完成', true, mainWindow.webContents.getURL());

    const renderer = await mainWindow.webContents.executeJavaScript(SELF_TEST_SCRIPT, true);
    for (const check of renderer.checks ?? []) checks.push(check);
    add('渲染进程脚本执行完毕', true);
  } catch (error) {
    add('渲染进程脚本执行失败', false, String(error?.message ?? error));
  }

  const result = finish();
  return result;
}

/** 在渲染进程里跑的一段自检脚本（字符串形式传给 executeJavaScript）。 */
const SELF_TEST_SCRIPT = `(async () => {
  const checks = [];
  const add = (name, pass, detail = null) => checks.push({ name, pass: Boolean(pass), detail: detail === null ? null : String(detail) });
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  add('preload 暴露 window.mas2z', Boolean(window.mas2z) && window.mas2z.isDesktop === true, window.mas2z ? window.mas2z.platform : 'missing');
  add('页面标题正确', document.title.includes('马鞍山二中'), document.title);

  const ids = ['start-screen', 'btn-start', 'input-name', 'actions', 'stats', 'subjects', 'log', 'shop-modal', 'gallery-modal', 'ending-modal', 'btn-save', 'btn-load', 'btn-shop', 'btn-gallery'];
  const missing = ids.filter((id) => !document.getElementById(id));
  add('关键界面元素齐全', missing.length === 0, missing.join(','));

  try {
    const health = await fetch('/api/health').then((r) => r.json());
    add('内嵌服务 API 可用', health.ok === true, 'sessions=' + health.sessions);
    const options = await fetch('/api/options').then((r) => r.json());
    // 只做"至少有这么些选项"的兜底检查，别写死数量（加天赋不该让自检失败）
    add('构筑选项接口', options.traits.length >= 10 && options.catalog.length >= 20, '天赋=' + options.traits.length + ' 图鉴=' + options.catalog.length);
    const created = await post('/api/new', { name: '桌面自检', seed: 'electron-selftest', track: 'physics', electives: ['chemistry', 'biology'], traits: ['memory', 'easygoing'], background: 'worker', goal: 'c985' });
    add('新建游戏', Boolean(created.gameId) && created.view.phase === 'main', created.view ? created.view.selection.label : '');
    const main = await post('/api/action', { gameId: created.gameId, actionId: 'listen' });
    add('主行动 → 周末', main.view.phase === 'weekend', main.view.phaseLabel);
    await post('/api/action', { gameId: created.gameId, actionId: 'sport' });
    const view = await fetch('/api/view?gameId=' + encodeURIComponent(created.gameId)).then((r) => r.json());
    add('周末 → 下一周', view.view.turn === 1, 'turn=' + view.view.turn);
    const shop = await post('/api/shop', { gameId: created.gameId, itemId: 'coffee' });
    add('商店接口', shop.view.items !== undefined && shop.view.turn === 1, '零花钱=' + shop.view.stats.money);
    const save = await fetch('/api/export?gameId=' + encodeURIComponent(created.gameId)).then((r) => r.json());
    add('导出存档', typeof save.save === 'string' && save.save.includes('"version":2'));
  } catch (error) {
    add('接口自检', false, error && error.message);
  }

  add('localStorage 可用', (() => { try { localStorage.setItem('__mas2z_test', '1'); localStorage.removeItem('__mas2z_test'); return true; } catch (error) { return false; } })());
  return { checks };
})()`;

module.exports = { APP_NAME };
