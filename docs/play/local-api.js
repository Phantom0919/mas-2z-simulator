/**
 * 纯浏览器版接口：把网页版依赖的 HTTP 接口在**页面内**直接实现一遍。
 *
 * 用途：file://、手机 WebView、静态托管（GitHub Pages 之类）等没有 Node 服务的场景。
 * 接口形状与 src/server.js 完全一致，所以 web/app.js 不需要知道自己在跟谁说话。
 *
 * 注意：这里只能 import 引擎与数据（纯 JS，无 Node 内置模块）；
 * src/profile.js 用了 node:fs，所以浏览器端不使用它，图鉴走 localStorage。
 */

import * as engineApi from '../src/engine.js';
import {
  ALL_EVENTS,
  DIFFICULTY,
  GameError,
  buyItem,
  createGame,
  creatorOptions,
  deserialize,
  endingCatalog,
  performAction,
  pickNickname,
  randomStudentName,
  relationGraph,
  renderTreeText,
  resolveEvent,
  serialize,
  storyCatalog,
  storyProgress,
  viewState,
} from '../src/engine.js';
import { BACKGROUNDS, GOALS, TRAITS, TRACKS } from '../src/data/character.js';
import { parseJsonObjectText, parsePackText } from '../src/content.js';
import {
  MAX_MANIFEST_BYTES,
  UPDATE_STATUS,
  decideUpdate,
  disabledUpdate,
  isAllowedManifestUrl,
} from '../src/update.js';
import { DEFAULT_WEEKS_PER_SEMESTER, ELECTIVE_KEYS, ELECTIVE_PICK, SUBJECT_MAP } from '../src/data/school.js';

/**
 * 导入的内容包存在这里（和 mas2z-save-v2 / mas2z-profile-v2 / mas2z-cards-v1 一个风格）。
 * 存的是信封 { source: 'imported'|'url', pack, at }——光存 pack 会丢掉"从哪来的"，
 * 而 /api/content 要把 source 报给界面。
 */
const CONTENT_KEY = 'mas2z-content-v1';

/** 引擎模块的额外接口单独走 namespace 引入： */
/* engineApi：内容包与志愿填报是新增能力，用 namespace 调用可以在旧引擎上优雅降级，
 * 而不是在 import 阶段就报 "does not provide an export named" 让整页白屏。 */

function readStoredContent() {
  try {
    const raw = localStorage.getItem(CONTENT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (!data.pack || typeof data.pack !== 'object') return null;
    return { source: data.source === 'url' ? 'url' : 'imported', pack: data.pack, at: data.at ?? null };
  } catch {
    return null;
  }
}

function writeStoredContent(entry) {
  try {
    if (entry) localStorage.setItem(CONTENT_KEY, JSON.stringify(entry));
    else localStorage.removeItem(CONTENT_KEY);
  } catch {
    /* 存不下也不影响这一次的热更新，只是重开页面会丢 */
  }
}

/** 当前生效的内容包摘要（引擎侧算，界面只负责显示）。 */
function contentPayload() {
  const status = typeof engineApi.contentStatus === 'function' ? engineApi.contentStatus() : {};
  const stored = readStoredContent();
  return {
    pack: stored?.pack ?? null,
    summary: status.summary ?? null,
    checksum: status.checksum ?? null,
    source: stored?.source ?? 'official',
    baselineEventCount: status.baselineEventCount ?? 0,
    eventCount: status.eventCount ?? ALL_EVENTS.length,
    format: status.packFormat ?? status.format ?? 1,
  };
}

/**
 * 离线模式下由**浏览器自己**去拉内容包，所以这里要按 CSP 的 connect-src 'self' https: 来判：
 * https 随便拉，http 只放行回环地址（本地起服务写包时用得上）。
 */
export function isAllowedPackUrl(value) {
  let parsed;
  try {
    parsed = new URL(value, 'https://local.mas2z/');
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname);
  return parsed.protocol === 'http:' && loopback;
}

function contentError(pack, fallback) {
  const detail = (pack?.errors ?? []).join('；');
  return detail ? `内容包有问题：${detail}` : fallback;
}

/* ------------------------------------------------------- 更新检查（推送） */

/** 清单拉取超时（老 WebView 没有 AbortSignal.timeout，就自己搭一个）。 */
function manifestSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** 页面里读一份 JSON：宽容 BOM / 中文标点（和服务端共用同一个解析器）。 */
async function fetchJsonObject(target, label) {
  const response = await fetch(target, { cache: 'no-store', signal: manifestSignal(5000) });
  if (!response.ok) throw new GameError(`HTTP ${response.status}`);
  const text = await response.text();
  const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length;
  if (bytes > MAX_MANIFEST_BYTES) throw new GameError(`内容太大（${bytes} 字节，上限 ${MAX_MANIFEST_BYTES}）`);
  return parseJsonObjectText(text, label);
}

function isSameOrigin(value) {
  try {
    return new URL(value).origin === location.origin;
  } catch {
    return false;
  }
}

/** 读 `content/update-endpoint.json`（和网页版 / 服务端同一份配置）。读不到 = 不检查更新。 */
async function readUpdateEndpointInPage() {
  try {
    const data = await fetchJsonObject('content/update-endpoint.json', '更新配置');
    return {
      manifest: typeof data?.manifest === 'string' ? data.manifest.trim() : '',
      channel: typeof data?.channel === 'string' && data.channel.trim() ? data.channel.trim() : 'stable',
    };
  } catch {
    return { manifest: '', channel: 'stable' };
  }
}

/**
 * 离线 / 手机端的更新检查：没有 Node 服务端代拉，只能页面自己拉。
 *
 * 准入规则和服务端略有不同：**同源地址一律放行**（那是游戏自己的文件，不存在 SSRF 问题），
 * 跨域才走 `isAllowedManifestUrl`（https，或回环 / 内网的 http）。
 * 跨域拉清单要求对方给了 CORS 头——对象存储和 GitHub Pages 一般都有；
 * 拉不到就是"什么都不做"，绝不能影响游戏本身。
 */
async function runUpdateCheckInPage(url, channel, ignored) {
  const endpoint = await readUpdateEndpointInPage();
  const target = String(url ?? '').trim() || endpoint.manifest;
  const activeChannel = String(channel ?? '').trim() || endpoint.channel;
  if (!target) return { ok: true, ...disabledUpdate(), manifestUrl: '' };

  let manifestUrl = '';
  try {
    manifestUrl = new URL(target, location.href).href;
  } catch {
    return { ok: true, ...disabledUpdate(`更新清单地址看不懂：${target}`), manifestUrl: target, status: UPDATE_STATUS.INVALID };
  }
  if (!isSameOrigin(manifestUrl) && !isAllowedManifestUrl(manifestUrl)) {
    return {
      ok: true,
      ...disabledUpdate(`更新清单地址不允许（只支持 https，或回环 / 内网的 http）：${manifestUrl}`),
      manifestUrl,
      status: UPDATE_STATUS.INVALID,
    };
  }

  let manifest;
  try {
    manifest = await fetchJsonObject(manifestUrl, '更新清单');
  } catch (error) {
    return {
      ok: true,
      ...disabledUpdate(`拉取更新清单失败：${error?.message ?? '网络不可用'}`),
      manifestUrl,
      status: UPDATE_STATUS.UNREACHABLE,
    };
  }

  const status = engineApi.contentStatus?.() ?? null;
  const installed = status?.active
    ? { checksum: status.checksum, version: status.summary?.version ?? '', name: status.summary?.name ?? '' }
    : null;
  const decision = decideUpdate({
    manifest,
    manifestUrl,
    installed,
    appVersion: engineApi.GAME_VERSION ?? '',
    channel: activeChannel,
    ignoredChecksum: String(ignored ?? ''),
  });
  return { ok: true, ...decision, manifestUrl };
}

function optionsPayload() {
  return {
    // 离线模式没有服务端，这里顺手告诉前端一声（前端会用 view/log 而不是接口探活）
    mode: 'local',
    // 自定义人物的全部选项（头像 / 性格 / 缺陷 / 属性点 / 模板 / 自定义难度旋钮）
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
  };
}

/**
 * 创建一个"本地服务"，接口与 HTTP 版一一对应。
 * @returns {{ mode: 'local', request: (path: string, init?: {method?: string, body?: any}) => Promise<any> }}
 */
export function createLocalApi() {
  let game = null;

  // 上次导入的内容包在这里补上：引擎里的内容数组是模块级变量，
  // 不重放一次的话，刷新页面就"退回官方内容"了（存档还在，内容没了）。
  const storedContent = readStoredContent();
  if (storedContent && typeof engineApi.applyContentPack === 'function') {
    const restored = engineApi.applyContentPack(storedContent.pack);
    if (!restored?.ok) writeStoredContent(null);
  }

  const requireGame = () => {
    if (!game) throw new GameError('这局游戏已经过期了，请重新开始。');
    return game;
  };

  return {
    mode: 'local',

    async request(path, { method = 'GET', body = {} } = {}) {
      const url = new URL(path, 'https://local.mas2z/');
      const route = url.pathname;
      const query = url.searchParams;

      if (route === '/api/health') {
        return { ok: true, sessions: game ? 1 : 0, mode: 'local' };
      }

      if (route === '/api/options') {
        return optionsPayload();
      }

      /* ------------------------------------------------- 更新清单（推送） */

      if (route === '/api/update') {
        return runUpdateCheckInPage(query.get('url'), query.get('channel'), query.get('ignored'));
      }

      /* -------------------------------------------------- 内容包（热更新） */

      if (route === '/api/content') {
        return contentPayload();
      }

      if (route === '/api/content/apply') {
        let pack = null;
        let source = 'imported';
        if (body.pack && typeof body.pack === 'object') {
          pack = body.pack;
        } else if (typeof body.text === 'string') {
          try {
            pack = parsePackText(body.text);
          } catch (error) {
            throw new GameError(error?.message ?? '这段内容不是合法的 JSON，检查一下是不是漏了引号或逗号。');
          }
        } else if (typeof body.url === 'string') {
          const target = body.url.trim();
          if (!isAllowedPackUrl(target)) throw new GameError('只支持 https 地址（回环地址上的 http 可以）。');
          let text = '';
          try {
            const response = await fetch(target, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            text = await response.text();
          } catch (error) {
            throw new GameError(`拉取失败：${error?.message ?? '网络不可用'}`);
          }
          try {
            pack = parsePackText(text);
          } catch (error) {
            throw new GameError(`这个地址返回的内容包读不懂：${error?.message ?? '不是 JSON'}`);
          }
          source = 'url';
        } else {
          throw new GameError('要给我 pack / text / url 其中一个。');
        }

        const applied = engineApi.applyContentPack(pack);
        if (!applied?.ok) throw new GameError(contentError(applied, '内容包没能生效。'));
        // 存引擎收拢过的包（字段顺序、默认值都规整过），刷新页面重放时才算得出一致的校验和
        const normalized = engineApi.contentStatus?.().payload ?? pack;
        writeStoredContent({ source, pack: normalized, at: new Date().toISOString() });
        return {
          ok: true,
          summary: applied.summary ?? null,
          checksum: applied.checksum ?? null,
          source,
          warnings: applied.warnings ?? [],
          view: game ? viewState(game) : null,
        };
      }

      if (route === '/api/content/reset') {
        engineApi.resetContent();
        writeStoredContent(null);
        return { ok: true, summary: null, checksum: null, source: 'official', view: game ? viewState(game) : null };
      }

      /* -------------------------------------------------- 高考志愿填报 */

      if (route === '/api/volunteer') {
        const current = requireGame();
        if (typeof engineApi.submitVolunteers !== 'function') {
          throw new GameError('这一版离线引擎还没有志愿填报，请更新到最新版。');
        }
        const result = engineApi.submitVolunteers(current, Array.isArray(body.picks) ? body.picks : [], {
          adjust: body.adjust !== false,
        });
        return { lines: result.lines ?? [], ending: result.ending ?? null, view: viewState(current) };
      }

      if (route === '/api/new') {
        game = createGame({
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
        return { gameId: 'local', lines: [], view: viewState(game) };
      }

      if (route === '/api/random-name') {
        const gender = query.get('gender') === '女' ? '女' : '男';
        const seed = query.get('seed') || String(Math.random());
        return { name: randomStudentName(seed, gender) };
      }

      if (route === '/api/nickname') {
        // 外号也走引擎里的同一套随机流，界面上的"🎲"按钮用它
        return { nickname: pickNickname(query.get('seed') || String(Math.random())) };
      }

      if (route === '/api/import') {
        game = deserialize(body.save ?? body);
        return { gameId: 'local', lines: [], view: viewState(game) };
      }

      if (route === '/api/export') {
        return { save: serialize(requireGame()) };
      }

      if (route === '/api/view') {
        return { view: viewState(requireGame()) };
      }

      if (route === '/api/action') {
        const current = requireGame();
        const result = performAction(current, body.actionId, { subject: body.subject });
        return {
          lines: result.lines,
          exams: result.exams,
          pendingEvent: result.pendingEvent,
          ended: result.ended,
          view: viewState(current),
        };
      }

      if (route === '/api/event') {
        const current = requireGame();
        const result = resolveEvent(current, body.choiceId);
        return {
          lines: result.lines,
          exams: result.exams,
          pendingEvent: result.pendingEvent,
          ended: result.ended,
          view: viewState(current),
        };
      }

      if (route === '/api/shop') {
        const current = requireGame();
        const result = buyItem(current, body.itemId);
        return { lines: result.lines, view: viewState(current) };
      }

      if (route === '/api/relations') {
        const current = requireGame();
        const graph = relationGraph(current);
        return { graph, text: renderTreeText(graph), cast: current.cast?.list ?? [] };
      }

      if (route === '/api/story') {
        const current = requireGame();
        return { catalog: storyCatalog(current), progress: storyProgress(current) };
      }

      throw new GameError(`没有这个接口：${route}`);
    },
  };
}

/** 当前环境是不是该用本地引擎。 */
export function shouldUseLocalApi() {
  if (typeof window === 'undefined') return false;
  if (window.location?.protocol === 'file:') return true;
  if (new URLSearchParams(window.location?.search ?? '').has('local')) return true;
  return false;
}
