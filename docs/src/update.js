/**
 * 「给玩家推送更新」的判定层：更新清单（update manifest）+ 要不要告诉玩家的决策。
 *
 * 内容包热更新只解决了**拉**——玩家得自己找到包再导入。这个模块补的是**推**：
 * 一个固定地址上的清单，客户端启动时问一句"有没有新的"，有就提示（或按清单静默）更新。
 *
 * 几条设计约束，都是踩过坑才写下来的：
 *   1. **纯函数、不联网、不碰 DOM**：服务端 / 手机离线模式 / CLI 共用同一套判定，
 *      网络那一步各自只有二十行，测试也不用起服务器。
 *   2. **清单读不懂 = 什么都不做**。坏清单绝不能把游戏卡在启动页。
 *   3. **checksum 是唯一权威**：版本号只用来显示和排序。判断"变了没有"一律比校验和，
 *      这样"版本号没动但内容改过"也能推下去（这正是热更新最常见的场景）。
 *   4. **绝不自动降级**：清单版本低于本地时只提示。玩家手里的包可能比线上新
 *      （比如他自己写的），静默覆盖是删档级别的冒犯。
 *   5. `url` 既可以是绝对地址，也可以是相对清单的路径——后者让"游戏服务端自己托管内容"
 *      这种部署不用写死域名。
 */

import { satisfies } from './content.js';

/** 清单格式版本（结构变了才动它）。 */
export const UPDATE_FORMAT = 1;

/** 支持的发布通道。装 beta 的玩家不会被 stable 的清单"降级"回去。 */
export const UPDATE_CHANNELS = ['stable', 'beta'];

/** 清单大小上限：清单是"索引"，正常只有几百字节，超过这个数一定是搞错了（或者被投毒了）。 */
export const MAX_MANIFEST_BYTES = 64 * 1024;

/** 文案长度上限（同 content.js 的口径）。 */
export const MAX_UPDATE_TEXT = { version: 20, notes: 200, releasedAt: 40 };

/** 决策结果。`actionable` 决定界面给不给"立即更新"按钮。 */
export const UPDATE_STATUS = {
  /** 清单已是最新（校验和相同）。 */
  UP_TO_DATE: 'up-to-date',
  /** 有新内容，可以更新。 */
  UPDATE: 'update',
  /** 玩家点过"忽略这个版本"，而且新版还是那一个。 */
  IGNORED: 'ignored',
  /** 清单版本比本地低：只提示，不自动应用。 */
  DOWNGRADE: 'downgrade',
  /** 清单是别的通道发的（stable 客户端看到 beta 清单之类）。 */
  CHANNEL: 'channel-mismatch',
  /** 新版内容包要求更高的游戏本体版本：得先升级 APK / 客户端。 */
  INCOMPATIBLE: 'incompatible',
  /** 清单缺失 / 读不懂 / 不合规。 */
  INVALID: 'invalid',
  /** 清单拉不到（断网、服务器挂了、地址写错）——和"清单有问题"分开，界面提示完全不同。 */
  UNREACHABLE: 'unreachable',
  /** 没配置清单地址：这次不发更新检查（默认状态，离线优先）。 */
  DISABLED: 'disabled',
};

/* ------------------------------------------------------------------ 小工具 */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textField(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function boolField(value) {
  return value === true;
}

/** 版本号 → [major, minor, patch]，看不懂的一律当 0（不影响主流程）。 */
export function parseVersion(text) {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(text ?? '').trim());
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** 版本号比较：a > b 返回 1，a < b 返回 -1，相等 0。 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

/* ------------------------------------------------------------- 地址与护栏 */

/** 主机名分类：服务端代拉清单时的 SSRF 护栏靠它。 */
export function hostKind(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return 'invalid';
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0') return 'loopback';
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return 'invalid';
    const [a, b] = parts;
    if (a === 127) return 'loopback';
    // 169.254.0.0/16 是云厂商的元数据端点（169.254.169.254），最经典的 SSRF 靶子，永远不许
    if (a === 169 && b === 254) return 'link';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
    return 'public';
  }
  return 'public';
}

/**
 * 清单地址准入（服务端 / 离线端拉清单前先问它）。
 *
 * 允许：https（任意主机，域名/IP 都行——自己搭的对象存储、内网 https 服务器都算正常部署）；
 *       http 仅限回环与内网地址（局域网联机、本机调试）；
 * 禁止：`file:` / `data:` 这类协议，以及 link-local（云元数据端点）。
 *
 * 注意这是"够用就好"的护栏，不是完整的 SSRF 防护：真正的强隔离要靠部署时把
 * 清单地址写死在配置里（`--update-url`），别让陌生人往 `?url=` 里随便填。
 */
export function isAllowedManifestUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    return false;
  }
  const kind = hostKind(parsed.hostname);
  if (kind === 'invalid' || kind === 'link') return false;
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:') return kind === 'loopback' || kind === 'private';
  return false;
}

/** 把清单里的 `url` 解析成绝对地址（相对路径按清单自己的地址算）。 */
export function resolvePackUrl(manifestUrl, packUrl) {
  const text = String(packUrl ?? '').trim();
  if (!text) return '';
  try {
    return new URL(text, String(manifestUrl ?? '').trim() || undefined).href;
  } catch {
    return text;
  }
}

/* ------------------------------------------------------------------ 清单 */

/** 一个空清单（形状正确，`latest` 为 null）。 */
export function emptyManifest() {
  return { format: UPDATE_FORMAT, channel: 'stable', latest: null };
}

/**
 * 收拢任意输入成一个形状正确的清单（**不抛异常、不校验内容**，同 content.js 的口径）。
 *
 * @param {unknown} input
 * @returns {{ format: number, channel: string, latest: object|null }}
 */
export function normalizeManifest(input) {
  const raw = isPlainObject(input) ? input : {};
  const format = Number.isInteger(raw.format) && raw.format > 0 ? raw.format : UPDATE_FORMAT;
  const channel = textField(raw.channel, 20) || 'stable';

  // latest 也容忍"清单就是一条更新记录"这种偷懒写法（顶层直接写 version / url）
  const source = isPlainObject(raw.latest) ? raw.latest : isPlainObject(raw.pack) ? raw.pack : raw.latest === undefined && raw.url ? raw : null;
  if (!source) return { format, channel, latest: null };

  const requires = isPlainObject(source.requires)
    ? textField(source.requires.app, MAX_UPDATE_TEXT.version)
    : textField(source.requires, MAX_UPDATE_TEXT.version);

  return {
    format,
    channel,
    latest: {
      version: textField(source.version, MAX_UPDATE_TEXT.version),
      url: textField(source.url ?? source.pack ?? source.packUrl, 500),
      checksum: textField(source.checksum, 64).toLowerCase(),
      notes: textField(source.notes ?? source.note, MAX_UPDATE_TEXT.notes),
      releasedAt: textField(source.releasedAt ?? source.date, MAX_UPDATE_TEXT.releasedAt),
      name: textField(source.name, 40),
      requires: requires ? { app: requires } : {},
      auto: boolField(source.auto),
      mandatory: boolField(source.mandatory),
    },
  };
}

/** 清单 / 更新条目的合规检查，错误定位到字段。 */
export function validateManifest(manifest) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(manifest)) {
    return { ok: false, errors: ['更新清单必须是一个 JSON 对象。'], warnings };
  }
  if (manifest.format !== UPDATE_FORMAT) {
    errors.push(`更新清单格式版本是 ${manifest.format ?? '（缺失）'}，这个版本只认识 format ${UPDATE_FORMAT}。`);
  }
  if (!UPDATE_CHANNELS.includes(manifest.channel)) {
    errors.push(`不认识的发布通道「${manifest.channel}」，只支持 ${UPDATE_CHANNELS.join(' / ')}。`);
  }
  const latest = manifest.latest;
  if (!latest) {
    errors.push('清单里没有 latest：不知道要推什么。');
    return { ok: errors.length === 0, errors, warnings };
  }
  if (!latest.version) errors.push('latest.version 不能为空（版本号是给玩家看的，也用来判断降级）。');
  if (!latest.url) errors.push('latest.url 不能为空（内容包的地址，绝对地址或相对清单的路径都行）。');
  if (!latest.checksum) {
    // 没有校验和就没法判断"装的是不是这一版"，会变成每次启动都提示更新
    errors.push('latest.checksum 不能为空（用它判断"变了没有"，见内容包工具的输出）。');
  } else if (!/^[0-9a-f]{6,64}$/.test(latest.checksum)) {
    warnings.push(`latest.checksum「${latest.checksum}」看起来不像内容包校验和（一般是 8 位十六进制）。`);
  }
  if (latest.requires.app && !/^[<>=!]/.test(latest.requires.app)) {
    warnings.push(`latest.requires.app「${latest.requires.app}」不是 >=x.y.z 这种约束，会被当成"不限制"。`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/* ------------------------------------------------------------------ 决策 */

/**
 * 该不该给玩家推这次更新？
 *
 * 判定顺序（每条都在返回值里说明理由，界面和 CLI 共用）：
 *   invalid → channel-mismatch → incompatible → up-to-date → ignored → downgrade → update
 *
 * @param {object} params
 * @param {unknown} params.manifest       清单（原始对象即可，内部会收拢）
 * @param {string} [params.manifestUrl]   清单自己的地址（解析相对 url 用）
 * @param {object|null} [params.installed] 本地已装的内容包 `{ checksum, version, name }`
 * @param {string} [params.appVersion]    游戏本体版本（判断 requires.app）
 * @param {string} [params.channel]       客户端所在通道，默认 stable
 * @param {string} [params.ignoredChecksum] 玩家点过"忽略"的那个校验和
 * @returns {object}
 */
export function decideUpdate({
  manifest,
  manifestUrl = '',
  installed = null,
  appVersion = '',
  channel = 'stable',
  ignoredChecksum = '',
} = {}) {
  const data = normalizeManifest(manifest);
  const check = validateManifest(data);
  const base = {
    channel,
    appVersion,
    installed: isPlainObject(installed) ? installed : null,
    latest: data.latest,
    packUrl: data.latest ? resolvePackUrl(manifestUrl, data.latest.url) : '',
    actionable: false,
    auto: false,
    mandatory: false,
    reasons: [],
  };

  if (!check.ok) {
    return { ...base, status: UPDATE_STATUS.INVALID, reasons: check.errors, errors: check.errors, warnings: check.warnings };
  }
  const { latest } = data;
  const installedChecksum = String(base.installed?.checksum ?? '').toLowerCase();

  if (data.channel !== channel) {
    return {
      ...base,
      status: UPDATE_STATUS.CHANNEL,
      reasons: [`这个清单是 ${data.channel} 通道的，你装的是 ${channel} 通道，跳过。`],
      warnings: check.warnings,
    };
  }
  if (latest.requires.app && appVersion && !satisfies(appVersion, latest.requires.app)) {
    return {
      ...base,
      status: UPDATE_STATUS.INCOMPATIBLE,
      reasons: [`新内容要求游戏本体 ${latest.requires.app}，当前是 ${appVersion}——得先更新客户端/APK。`],
      warnings: check.warnings,
    };
  }
  if (installedChecksum && installedChecksum === latest.checksum) {
    return {
      ...base,
      status: UPDATE_STATUS.UP_TO_DATE,
      reasons: [`校验和 ${latest.checksum} 一致。`],
      warnings: check.warnings,
    };
  }
  if (ignoredChecksum && String(ignoredChecksum).toLowerCase() === latest.checksum) {
    return {
      ...base,
      status: UPDATE_STATUS.IGNORED,
      reasons: [`玩家忽略过这一版（校验和 ${latest.checksum}），不再提示。`],
      warnings: check.warnings,
    };
  }
  if (base.installed?.version && compareVersions(latest.version, base.installed.version) < 0) {
    return {
      ...base,
      status: UPDATE_STATUS.DOWNGRADE,
      actionable: true,
      reasons: [`本地装的是 ${base.installed.version}，比线上这个还新——不会自动覆盖，真要降级得玩家自己点。`],
      warnings: check.warnings,
    };
  }

  return {
    ...base,
    status: UPDATE_STATUS.UPDATE,
    actionable: true,
    auto: latest.auto,
    mandatory: latest.mandatory,
    // 说明文字优先用清单里的 notes（运营写的那句人话），没有才退回版本号
    reasons: [latest.notes || `内容包更新到 v${latest.version}`],
    warnings: check.warnings,
  };
}

/** 没配置清单地址时的统一结果（离线优先的默认状态）。 */
export function disabledUpdate(reason = '没有配置更新清单地址，跳过更新检查。') {
  return {
    status: UPDATE_STATUS.DISABLED,
    channel: '',
    appVersion: '',
    installed: null,
    latest: null,
    packUrl: '',
    actionable: false,
    auto: false,
    mandatory: false,
    reasons: [reason],
    warnings: [],
  };
}

/** 一句话描述决策（CLI 直接打印，界面顶部横幅也用它的短版本）。 */
export function describeUpdate(decision) {
  if (!decision) return '没有更新信息。';
  const { status, latest } = decision;
  const head = {
    [UPDATE_STATUS.UP_TO_DATE]: '✅ 已是最新内容',
    [UPDATE_STATUS.UPDATE]: '🔄 有新内容',
    [UPDATE_STATUS.IGNORED]: '🙈 这一版已被忽略',
    [UPDATE_STATUS.DOWNGRADE]: '⬇️ 线上版本比本地旧',
    [UPDATE_STATUS.CHANNEL]: '↔️ 通道不匹配',
    [UPDATE_STATUS.INCOMPATIBLE]: '⛔ 需要先更新游戏本体',
    [UPDATE_STATUS.INVALID]: '⚠️ 更新清单有问题',
    [UPDATE_STATUS.UNREACHABLE]: '📡 连不上更新服务器',
    [UPDATE_STATUS.DISABLED]: '💤 更新检查未启用',
  }[status] ?? '更新状态未知';
  const version = latest?.version ? ` v${latest.version}` : '';
  const first = decision.reasons?.[0] ?? '';
  return `${head}${version}${first ? `　${first}` : ''}`.trim();
}

/**
 * 给界面用的"人话摘要"：只回答玩家关心的三件事——有没有新的、要不要现在装、能不能装。
 */
export function summarizeUpdate(decision) {
  if (!decision) return { title: '更新状态未知', detail: '', canApply: false, canIgnore: false };
  switch (decision.status) {
    case UPDATE_STATUS.UPDATE:
      return {
        title: decision.latest?.notes || `有新内容 v${decision.latest?.version ?? ''}`,
        detail: `新内容包 v${decision.latest?.version ?? '?'}${decision.latest?.releasedAt ? ` · ${decision.latest.releasedAt}` : ''}`,
        canApply: true,
        canIgnore: !decision.mandatory,
      };
    case UPDATE_STATUS.DOWNGRADE:
      return { title: '线上内容比本地旧', detail: decision.reasons[0] ?? '', canApply: true, canIgnore: true };
    case UPDATE_STATUS.INCOMPATIBLE:
      return { title: '有新内容，但需要新版客户端', detail: decision.reasons[0] ?? '', canApply: false, canIgnore: false };
    case UPDATE_STATUS.UP_TO_DATE:
      return { title: '已经是最新内容', detail: decision.latest?.checksum ? `校验和 ${decision.latest.checksum}` : '', canApply: false, canIgnore: false };
    default:
      return { title: describeUpdate(decision), detail: '', canApply: Boolean(decision.actionable), canIgnore: false };
  }
}
