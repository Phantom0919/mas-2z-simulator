/**
 * 桌面版内嵌服务：复用网页版那一套 HTTP 接口，只监听 127.0.0.1 的随机端口。
 * 这样渲染进程里的前端代码（web/app.js）一行都不用改就能跑在 Electron 里。
 */

import { createGameServer } from '../src/server.js';

/**
 * 启动内嵌服务。
 * @param {{ host?: string, port?: number, webRoot?: string, srcRoot?: string }} [options]
 *   webRoot 默认是仓库里的 web/；srcRoot 默认是它的上一级（也就是能取到 src/ 的那一层）。
 *   两者都要给，否则页面里的 `../src/engine.js` 会 404，整页白屏。
 * @returns {Promise<{server: import('node:http').Server, url: string, port: number, host: string}>}
 */
export function startEmbeddedServer({ host = '127.0.0.1', port = 0, webRoot, srcRoot } = {}) {
  return new Promise((resolve, reject) => {
    const options = {};
    if (webRoot) options.webRoot = webRoot;
    if (srcRoot) options.srcRoot = srcRoot;
    const server = createGameServer(Object.keys(options).length > 0 ? options : undefined);
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({ server, url: `http://${host}:${actualPort}`, port: actualPort, host });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** 关闭内嵌服务。 */
export function stopEmbeddedServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
