/**
 * 应用菜单模板。
 * 只返回普通对象（role 交给 Electron 解释），所以不依赖 Electron，可以直接单测。
 */

/**
 * @param {{ appName: string, onCommand: (command: string) => void, isDev?: boolean, openReadme?: () => void, showAbout?: () => void }} options
 */
export function buildMenuTemplate({ appName = '马鞍山二中模拟器', onCommand = () => {}, isDev = false, openReadme, showAbout } = {}) {
  return [
    {
      label: '游戏',
      submenu: [
        { label: '新的一局', accelerator: 'CmdOrCtrl+N', click: () => onCommand('new-game') },
        { type: 'separator' },
        { label: '导出存档…', accelerator: 'CmdOrCtrl+S', click: () => onCommand('export') },
        { label: '导入存档…', accelerator: 'CmdOrCtrl+O', click: () => onCommand('import') },
        { type: 'separator' },
        { label: '结局图鉴', accelerator: 'CmdOrCtrl+G', click: () => onCommand('gallery') },
        { label: '商店', accelerator: 'CmdOrCtrl+B', click: () => onCommand('shop') },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { label: '开发者工具', role: 'toggleDevTools', visible: true },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '玩法说明（README）', click: () => (openReadme ? openReadme() : onCommand('help')) },
        { label: `关于 ${appName}`, click: () => (showAbout ? showAbout() : onCommand('about')) },
        ...(isDev ? [{ type: 'separator' }, { label: '打开存档目录', click: () => onCommand('open-user-data') }] : []),
      ],
    },
  ];
}

/** 收集模板里所有可点击项的命令，方便自检。 */
export function collectMenuCommands(template) {
  const commands = [];
  for (const menu of template) {
    for (const item of menu.submenu ?? []) {
      if (typeof item.click === 'function') commands.push(item.label);
    }
  }
  return commands;
}
