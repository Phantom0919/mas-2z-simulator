/**
 * 桌面版渲染进程桥接：只暴露必要的几个能力，渲染进程拿不到 Node。
 */

const { contextBridge, ipcRenderer } = require('electron');

// 沙箱化的 preload 里 process 是精简版，取不到就退化，别让整个 preload 崩掉
const platform = (() => {
  try {
    return process.platform;
  } catch {
    return 'unknown';
  }
})();

const listeners = new Set();

ipcRenderer.on('mas2z:command', (_event, command) => {
  for (const fn of listeners) {
    try {
      fn(command);
    } catch {
      /* 渲染进程自己的异常不该影响菜单，忽略 */
    }
  }
});

contextBridge.exposeInMainWorld('mas2z', {
  isDesktop: true,
  platform,
  /** 弹出"另存为"对话框并写文件 */
  saveFile: (payload) => ipcRenderer.invoke('mas2z:save-file', payload),
  /** 弹出"打开"对话框并读文件 */
  openFile: () => ipcRenderer.invoke('mas2z:open-file'),
  /** 运行时信息（版本号等） */
  info: () => ipcRenderer.invoke('mas2z:info'),
  /** 订阅原生菜单命令，返回取消订阅函数 */
  onCommand: (fn) => {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
});
