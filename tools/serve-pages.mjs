#!/usr/bin/env node
/**
 * 本地预览发布页：把 docs/ 像 GitHub Pages 那样用一个静态服务器发出来。
 *
 *   node tools/serve-pages.mjs            # http://127.0.0.1:8080/
 *   node tools/serve-pages.mjs --port 8081
 *
 * 两个用途：
 *   1. 上传之前先在电脑上看一遍（顺便能扫二维码 → 手机打开「在线试玩」）；
 *   2. test/pages.test.js 直接调 createPagesServer() 起一个内存里的服务，
 *      验证 MIME、下载头、404 —— 不需要子进程、不需要额外依赖。
 *
 * 为什么不用 `python -m http.server`：ES 模块要求 .js 必须是 text/javascript，
 * APK 要能直接下载，而且默认监听 0.0.0.0 才能让手机连过来看。
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ROOT = path.resolve(import.meta.dirname, '..', 'docs');

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip',
};

/**
 * 建一个只服务 docs/ 的静态服务器（端口由调用方 listen）。
 * @param {{ root?: string }} options
 */
export function createPagesServer({ root = DEFAULT_ROOT } = {}) {
  const send = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(body);
  };

  const server = createServer((request, response) => {
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      send(response, 400, '请求地址不对');
      return;
    }

    let target = path.join(root, ...pathname.split('/').filter(Boolean));
    // 防目录穿越：解析后的路径必须还在 docs/ 里
    if (target !== root && !target.startsWith(root + path.sep)) {
      send(response, 403, '越界了');
      return;
    }
    if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!existsSync(target) || !statSync(target).isFile()) {
      send(response, 404, `没有这个文件：${pathname}`);
      return;
    }

    const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
    response.writeHead(200, {
      'content-type': type,
      'content-length': statSync(target).size,
      'cache-control': 'no-cache',
      // 和 GitHub Pages 一样带上 CORS 头，方便顺手验证「手机离线版能不能直接拉更新清单」
      'access-control-allow-origin': '*',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(target).pipe(response);
  });

  return server;
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function main() {
  const port = Number(argValue('--port', '8080'));
  const host = argValue('--host', '0.0.0.0');
  const server = createPagesServer();

  server.listen(port, host, () => {
    const address = server.address();
    const shown = typeof address === 'object' && address ? address.port : port;
    console.log(`发布页预览：http://127.0.0.1:${shown}/`);
    console.log(`在线试玩：  http://127.0.0.1:${shown}/play/index.html`);
    for (const list of Object.values(networkInterfaces())) {
      for (const item of list ?? []) {
        if (item.family === 'IPv4' && !item.internal) {
          console.log(`局域网（手机可访问）：http://${item.address}:${shown}/`);
        }
      }
    }
    console.log('Ctrl+C 结束');
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
