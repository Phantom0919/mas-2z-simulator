#!/usr/bin/env node
/**
 * 马鞍山二中模拟器 · 网页版服务端（零依赖，只用 node:http）
 *
 *   node src/server.js                 默认 http://127.0.0.1:3210
 *   node src/server.js --port 8080
 *
 * 所有游戏逻辑都在内存会话里，页面刷新后可以用"导出/导入存档"接上。
 */

import { createServer } from 'node:http';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

import {
  ALL_EVENTS,
  GAME_VERSION,
  GameError,
  applyContentPack,
  buyItem,
  contentStatus,
  createGame,
  creatorOptions,
  deserialize,
  endingCatalog,
  performAction,
  pickNickname,
  randomStudentName,
  relationGraph,
  renderTreeText,
  resetContent,
  resolveEvent,
  serialize,
  storyCatalog,
  storyProgress,
  submitVolunteers,
  viewState,
} from './engine.js';
import { BACKGROUNDS, GOALS, TRAITS, TRACKS } from './data/character.js';
import { DIFFICULTY } from './engine.js';
import { DEFAULT_WEEKS_PER_SEMESTER, ELECTIVE_KEYS, ELECTIVE_PICK, SUBJECT_MAP } from './data/school.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_WEB_ROOT = join(__dirname, '..', 'web');
/** 热更新的内容包落盘位置：服务端/Electron 重启之后照样生效。 */
const PACK_FILE = join(__dirname, '..', 'saves', 'content-pack.json');

/** 把生效的内容包写进 saves/，下次启动自动恢复。 */
async function saveActivePack(pack) {
  await mkdir(join(__dirname, '..', 'saves'), { recursive: true });
  await writeFile(PACK_FILE, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
}

/** 删掉落盘的内容包（恢复官方内容时用）。 */
async function clearActivePack() {
  await rm(PACK_FILE, { force: true });
}

/** 读取落盘的内容包（启动时用）。 */
export async function loadSavedPack() {
  try {
    return JSON.parse(await readFile(PACK_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** 启动时应用 content-pack.json（或命令行指定的包）。 */
export async function applyPackAtBoot(file = null) {
  let pack = null;
  if (file) {
    pack = JSON.parse(await readFile(file, 'utf8'));
  } else {
    pack = await loadSavedPack();
  }
  if (!pack) return null;
  const result = applyContentPack(pack);
  if (!result.ok) {
    console.error(`内容包没有生效：${result.errors.join('；')}`);
    return result;
  }
  return result;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const MAX_BODY = 256 * 1024;

/** 简单的内存会话表，带 TTL 和数量上限。 */
export function createSessionStore({ max = 500, ttlMs = 6 * 60 * 60 * 1000 } = {}) {
  const sessions = new Map();
  let counter = 0;
  return {
    create(game) {
      counter += 1;
      const id = `g${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      sessions.set(id, { game, at: Date.now() });
      this.prune();
      return id;
    },
    get(id) {
      const entry = sessions.get(id);
      if (!entry) return null;
      entry.at = Date.now();
      return entry.game;
    },
    delete(id) {
      sessions.delete(id);
    },
    prune() {
      const now = Date.now();
      for (const [id, entry] of sessions) {
        if (now - entry.at > ttlMs) sessions.delete(id);
      }
      while (sessions.size > max) {
        let oldestId = null;
        let oldest = Infinity;
        for (const [id, entry] of sessions) {
          if (entry.at < oldest) {
            oldest = entry.at;
            oldestId = id;
          }
        }
        if (oldestId === null) break;
        sessions.delete(oldestId);
      }
    },
    get size() {
      return sessions.size;
    },
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new GameError('请求体过大。');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GameError('请求体不是合法的 JSON。');
  }
}

async function serveStatic(res, webRoot, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = normalize(join(webRoot, relative));
  if (!target.startsWith(normalize(webRoot) + sep) && target !== normalize(webRoot)) {
    sendJson(res, 403, { error: '路径不合法。' });
    return;
  }
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      await serveStatic(res, webRoot, `${pathname.replace(/\/$/, '')}/index.html`);
      return;
    }
    const data = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'content-length': data.length,
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: `找不到 ${pathname}` });
  }
}

export function createGameServer({
  webRoot = DEFAULT_WEB_ROOT,
  srcRoot = join(DEFAULT_WEB_ROOT, '..'),
  store = createSessionStore(),
} = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: '只支持 GET。' });
        return;
      }
      // 页面里的 `../src/engine.js`（离线模式的 local-api.js 会用到）要能取到引擎源码。
      // APK 的资源根目录同时含 www/ 和 src/，HTTP 版与 Electron 版必须一致，
      // 否则整页会因为模块 404 而白屏——只提供 web/ 是不够的。
      if (pathname === '/src' || pathname.startsWith('/src/')) {
        await serveStatic(res, srcRoot, pathname);
        return;
      }
      await serveStatic(res, webRoot, pathname);
      return;
    }

    try {
      if (pathname === '/api/health') {
        sendJson(res, 200, { ok: true, sessions: store.size });
        return;
      }

      if (pathname === '/api/new' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = createGame({
          name: body.name,
          gender: body.gender,
          nickname: body.nickname,
          avatar: body.avatar,
          seed: body.seed,
          difficulty: body.difficulty,
          custom: body.custom,
          weeksPerSemester: body.weeksPerSemester,
          track: body.track,
          electives: body.electives,
          traits: body.traits,
          background: body.background,
          goal: body.goal,
          personality: body.personality,
          flaw: body.flaw,
          points: body.points,
          legacyPoints: body.legacyPoints,
          preset: body.preset,
          customCast: body.customCast,
          endless: body.endless,
        });
        const gameId = store.create(game);
        sendJson(res, 200, { gameId, lines: [], view: viewState(game) });
        return;
      }

      if (pathname === '/api/options' && req.method === 'GET') {
        sendJson(res, 200, {
          ...creatorOptions(),
          eventCount: ALL_EVENTS.length,
          difficulties: Object.values(DIFFICULTY).map((item) => ({
            key: item.key,
            name: item.name,
            icon: item.icon,
            desc: item.desc,
          })),
          tracks: TRACKS,
          electives: ELECTIVE_KEYS.map((key) => ({ key, ...SUBJECT_MAP[key] })),
          electivePick: ELECTIVE_PICK,
          traits: TRAITS,
          backgrounds: BACKGROUNDS,
          goals: GOALS.map((goal) => ({ id: goal.id, name: goal.name, icon: goal.icon, desc: goal.desc })),
          defaultWeeks: DEFAULT_WEEKS_PER_SEMESTER,
          catalog: endingCatalog(),
        });
        return;
      }

      if (pathname === '/api/shop' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = store.get(body.gameId);
        if (!game) {
          sendJson(res, 404, { error: '这局游戏已经过期了，请重新开始。' });
          return;
        }
        const result = buyItem(game, body.itemId);
        sendJson(res, 200, { lines: result.lines, view: viewState(game) });
        return;
      }

      if (pathname === '/api/import' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = deserialize(body.save ?? body);
        const gameId = store.create(game);
        sendJson(res, 200, { gameId, lines: [], view: viewState(game) });
        return;
      }

      if (pathname === '/api/export' && req.method === 'GET') {
        const game = store.get(url.searchParams.get('gameId'));
        if (!game) {
          sendJson(res, 404, { error: '这局游戏已经过期了，请重新开始。' });
          return;
        }
        sendJson(res, 200, { save: serialize(game) });
        return;
      }

      if (pathname === '/api/view' && req.method === 'GET') {
        const game = store.get(url.searchParams.get('gameId'));
        if (!game) {
          sendJson(res, 404, { error: '这局游戏已经过期了，请重新开始。' });
          return;
        }
        sendJson(res, 200, { view: viewState(game) });
        return;
      }

      // 人物关系树状图（含每个节点的坐标，前端直接画 SVG）
      if (pathname === '/api/relations' && req.method === 'GET') {
        const game = store.get(url.searchParams.get('gameId'));
        if (!game) {
          sendJson(res, 404, { error: '这局游戏已经过期了，请重新开始。' });
          return;
        }
        const graph = relationGraph(game);
        sendJson(res, 200, { graph, text: renderTreeText(graph), cast: game.cast?.list ?? [] });
        return;
      }

      // 故事线：每条线列出全部章节，已解锁的带正文
      if (pathname === '/api/story' && req.method === 'GET') {
        const game = store.get(url.searchParams.get('gameId'));
        if (!game) {
          sendJson(res, 404, { error: '这局游戏已经过期了，请重新开始。' });
          return;
        }
        sendJson(res, 200, { catalog: storyCatalog(game), progress: storyProgress(game) });
        return;
      }

      // 开局表单的"随机姓名"按钮
      if (pathname === '/api/random-name' && req.method === 'GET') {
        const gender = url.searchParams.get('gender') === '女' ? '女' : '男';
        const seed = url.searchParams.get('seed') || String(Math.random());
        sendJson(res, 200, { name: randomStudentName(seed, gender) });
        return;
      }

      // 开局表单的"随机外号"按钮
      if (pathname === '/api/nickname' && req.method === 'GET') {
        const seed = url.searchParams.get('seed') || String(Math.random());
        sendJson(res, 200, { nickname: pickNickname(seed) });
        return;
      }

      /* ---------------------------------------------------- 热更新：内容包 */

      // 当前生效的内容包
      if (pathname === '/api/content' && req.method === 'GET') {
        const status = contentStatus();
        sendJson(res, 200, {
          pack: status.payload ?? null,
          summary: status.summary,
          checksum: status.checksum,
          source: status.source,
          active: status.active,
          format: status.format ?? null,
          appVersion: GAME_VERSION,
          baselineEventCount: status.baselineEventCount,
          eventCount: status.eventCount,
        });
        return;
      }

      // 应用内容包：body 可以是 { pack }、{ text }（粘贴的 JSON）、{ url }（从地址拉）
      if (pathname === '/api/content/apply' && req.method === 'POST') {
        const body = await readJsonBody(req);
        let pack = body.pack;
        let source = 'imported';
        let text = body.text;
        if (!pack && body.url) {
          source = 'url';
          try {
            const response = await fetch(String(body.url), { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            text = await response.text();
          } catch (error) {
            sendJson(res, 400, { error: `拉取内容包失败：${error.message}` });
            return;
          }
        }
        if (!pack && text) {
          try {
            pack = JSON.parse(String(text));
          } catch (error) {
            sendJson(res, 400, { error: `内容包不是合法的 JSON：${error.message}` });
            return;
          }
        }
        if (!pack) {
          sendJson(res, 400, { error: '没有收到内容包（需要 pack / text / url 其中之一）。' });
          return;
        }
        const result = applyContentPack(pack);
        if (!result.ok) {
          sendJson(res, 400, { error: `内容包没通过校验：${result.errors[0] ?? '未知问题'}`, errors: result.errors, warnings: result.warnings });
          return;
        }
        await saveActivePack(pack).catch(() => {});
        const status = contentStatus();
        sendJson(res, 200, {
          ok: true,
          summary: result.summary,
          checksum: result.checksum,
          warnings: result.warnings,
          source,
          active: true,
          baselineEventCount: status.baselineEventCount,
          eventCount: status.eventCount,
        });
        return;
      }

      // 恢复官方内容
      if (pathname === '/api/content/reset' && req.method === 'POST') {
        resetContent();
        await clearActivePack().catch(() => {});
        sendJson(res, 200, { ok: true, summary: null, checksum: null, source: 'official', active: false, eventCount: ALL_EVENTS.filter((event) => !event.story).length });
        return;
      }

      /* ---------------------------------------------------- 志愿填报 */

      if (pathname === '/api/volunteer' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = store.get(body.gameId);
        if (!game) {
          sendJson(res, 404, { error: '这局游戏已经过期了，请重新开始。' });
          return;
        }
        const result = submitVolunteers(game, body.picks ?? [], { adjust: body.adjust !== false });
        sendJson(res, 200, { lines: result.lines, ending: result.ending, view: viewState(game) });
        return;
      }

      if (pathname === '/api/action' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = store.get(body.gameId);
        if (!game) {
          sendJson(res, 404, { error: '这局游戏已经过期了，请重新开始。' });
          return;
        }
        const result = performAction(game, body.actionId, { subject: body.subject });
        sendJson(res, 200, {
          lines: result.lines,
          exams: result.exams,
          pendingEvent: result.pendingEvent,
          ended: result.ended,
          view: viewState(game),
        });
        return;
      }

      if (pathname === '/api/event' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const game = store.get(body.gameId);
        if (!game) {
          sendJson(res, 404, { error: '这局游戏已经过期了，请重新开始。' });
          return;
        }
        const result = resolveEvent(game, body.choiceId);
        sendJson(res, 200, {
          lines: result.lines,
          exams: result.exams,
          pendingEvent: result.pendingEvent,
          ended: result.ended,
          view: viewState(game),
        });
        return;
      }

      sendJson(res, 404, { error: `没有这个接口：${pathname}` });
    } catch (error) {
      if (error instanceof GameError) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      sendJson(res, 500, { error: `服务器内部错误：${error?.message ?? error}` });
    }
  });

  server.store = store;
  return server;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [rawKey, inline] = token.slice(2).split('=');
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const next = argv[i + 1];
    if (inline !== undefined) out[key] = inline;
    else if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else out[key] = true;
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port ?? process.env.PORT ?? 3210);
  const host = String(args.host ?? '127.0.0.1');
  // 启动时先把内容包打上：热更新过的东西重启之后还在
  const packed = await applyPackAtBoot(args.pack ? String(args.pack) : null);
  if (packed?.ok) console.log(`🔄 已加载内容包：${packed.summary.name}${packed.summary.version ? ` v${packed.summary.version}` : ''}（${packed.summary.total} 项）`);
  const server = createGameServer();
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`马鞍山二中模拟器 · 网页版已启动： http://${host}:${address.port}`);
    console.log('按 Ctrl+C 结束。');
  });
  const shutdown = () => {
    console.log('\n正在关闭……');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export { DEFAULT_WEB_ROOT };
