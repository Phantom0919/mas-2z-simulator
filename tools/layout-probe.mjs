#!/usr/bin/env node
/**
 * 版面探针：在没有交互、甚至没有浏览器窗口的环境里，量一量真实页面的排版。
 *
 *   node tools/layout-probe.mjs                   起服务，等你去浏览器里看
 *   node tools/layout-probe.mjs --port 4100
 *
 * 它比普通静态服务多做了两件事：
 *   1. 和正式服务一样把 /src/** 一起提供（否则页面里的 ../src/engine.js 会 404，整页白屏）；
 *   2. 提供 /measure.html —— 就是真实的 index.html，只是额外挂了一个 measure.js，
 *      把「视口宽、有没有横向溢出、行动栏能不能滚到最后一组」这些数字直接画在页面上。
 *
 * 配合无头浏览器截图，就能把数字读出来（本机 Chrome 的窗口最小约 500px，
 * 想看更窄的屏幕请用真机或 DevTools 的设备模拟）：
 *
 *   chrome --headless=new --window-size=500,900 --virtual-time-budget=30000 \
 *          --screenshot=out.png "http://127.0.0.1:4100/measure.html?demo=4&click=last"
 *
 * 参数：
 *   ?demo=N    开局后自动走 N 步（N=0 就只开局）
 *   ?click=last  模拟点一下最后一个分组标签，报告有没有滚到位
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg >= 0 ? process.argv[portArg + 1] : 4100) || 4100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** 注入到页面里的量尺寸脚本（必须走外链文件：网页 CSP 是 script-src 'self'）。 */
const MEASURE_SCRIPT = `
const report = (lines) => {
  document.body.innerHTML =
    '<pre style="font:20px/1.45 monospace;color:#0f0;background:#000;padding:14px;white-space:pre-wrap">' +
    lines.join('\\n') + '</pre>';
};

setTimeout(() => {
  const panel = document.querySelector('.panel-actions');
  const banner = document.querySelector('.phase-banner');
  const groups = [...document.querySelectorAll('#actions .action-group')];
  const tabs = [...document.querySelectorAll('#action-tabs button')];
  const rect = (n) => (n ? n.getBoundingClientRect() : null);

  // 谁把页面撑宽了：所有右边界超出视口的元素
  const overs = [...document.querySelectorAll('body *')]
    .map((n) => [n, n.getBoundingClientRect().right])
    .filter(([, right]) => right > window.innerWidth + 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([n, right]) => (n.className || n.tagName) + ' -> ' + Math.round(right));

  const lines = [
    'innerW=' + window.innerWidth + '  innerH=' + window.innerHeight,
    'docScrollW=' + document.documentElement.scrollWidth +
      '  bodyW=' + Math.round(document.body.getBoundingClientRect().width),
    'layoutW=' + Math.round(rect(document.getElementById('layout')).width),
    'panelActions W=' + Math.round(rect(panel).width) + ' right=' + Math.round(rect(panel).right),
    'bannerRight=' + Math.round(rect(banner).right),
    'tabs=' + tabs.length + '  groups=' + groups.map((g) => g.textContent.trim()).join(','),
    'OVERFLOW: ' + (overs.length ? overs.join(' | ') : 'none'),
  ];

  const params = new URLSearchParams(location.search);
  if (params.get('click') === 'last' && tabs.length) {
    const panelScrollable = panel.scrollHeight > panel.clientHeight + 2;
    const last = groups[groups.length - 1];
    const before = Math.round(last.getBoundingClientRect().top);
    tabs[tabs.length - 1].click();

    let waited = 0;
    const poll = () => {
      waited += 200;
      const top = Math.round(last.getBoundingClientRect().top);
      const viewportTop = panelScrollable ? panel.getBoundingClientRect().top : 0;
      const settled = Math.abs(top - viewportTop) < 90;
      if (!settled && waited < 4000) {
        setTimeout(poll, 200);
        return;
      }
      lines.push('--- 点了最后一个标签（' + tabs[tabs.length - 1].textContent.trim() + '）---');
      lines.push('滚动容器=' + (panelScrollable ? '行动栏自己滚' : '整页滚') + '  等待=' + waited + 'ms');
      lines.push('最后一组 点击前 top=' + before + '  点击后 top=' + top);
      lines.push('落位判定=' + settled);
      lines.push('高亮标签=' + ((document.querySelector('#action-tabs button.on') || {}).textContent || '无'));
      report(lines);
    };
    setTimeout(poll, 200);
    return;
  }
  report(lines);
}, 4500);
`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  const send = (body, type) => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  try {
    if (pathname === '/measure.html') {
      const base = await readFile(join(ROOT, 'web', 'index.html'), 'utf8');
      send(base.replace('</body>', '<script src="./measure.js"></script>\n  </body>'), MIME['.html']);
      return;
    }
    if (pathname === '/measure.js') {
      send(MEASURE_SCRIPT, MIME['.js']);
      return;
    }
    if (pathname === '/') pathname = '/index.html';

    // 和正式服务保持一致：/src/** 从项目根目录取，其余从 web/ 取
    const file = pathname.startsWith('/src/') ? join(ROOT, pathname) : join(ROOT, 'web', pathname);
    send(await readFile(file), MIME[extname(file)] ?? 'application/octet-stream');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`not found: ${pathname}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`版面探针已启动：http://127.0.0.1:${PORT}/`);
  console.log(`量尺寸页面：      http://127.0.0.1:${PORT}/measure.html?demo=4&click=last`);
});
