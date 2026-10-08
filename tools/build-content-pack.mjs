#!/usr/bin/env node
/**
 * tools/build-content-pack.mjs —— 从 src/data/* 生成一个真实可用的内容包 JSON。
 *
 * 零依赖（只用 Node 内置模块）。它做四件事：
 *   1. 读真实数据：src/data/*.js 里的事件 / 道具 / 天赋 / 性格 / 缺陷 / 行动 + src/engine.js 的平衡表；
 *   2. 只挑 **JSON 能装下** 的条目：带函数（cond / effect / outcome 是函数）或循环引用的条目
 *      会被跳过并在摘要里点名——内容包是 JSON，装不下的东西宁可跳过，也不能悄悄丢掉逻辑
 *      （丢一条 cond 会让"只在高二触发"的事件变成随时触发，这是最危险的静默损坏）；
 *   3. 稳定输出：UTF-8 无 BOM、字段顺序固定、不含时间戳 —— 同一份源码跑两次字节完全一致；
 *   4. 用 src/content.js 的 validatePack 自检，不通过就不写出文件（退出码 3）。
 *
 * 用法：
 *   node tools/build-content-pack.mjs --out web/content/baseline-snapshot.json
 *   node tools/build-content-pack.mjs --only events,items --name "只带事件和道具"
 *   node tools/build-content-pack.mjs --pack web/content/demo-update.json --diff web/content/official-pack.json
 *   node tools/build-content-pack.mjs --help
 *
 * 参数：
 *   --out <路径>     写出文件（不给就打到 stdout）
 *   --name <名字>    包名（默认"内置内容快照"）
 *   --version <版本> 包版本（默认取引擎 GAME_VERSION，退到 package.json）
 *   --author <作者>  作者（默认"中二野人实验室"）
 *   --note <说明>    备注（会自动带上前缀 "build-content-pack.mjs 生成："）
 *   --requires <约束> 兼容约束（默认 ">=<游戏版本>"）
 *   --only <段落>    只带这些段落：events,items,traits,personalities,flaws,actions,balance
 *                    （逗号/空格分隔；默认全部）
 *   --pack <路径>    不重新生成，改用一个已存在的内容包作为"新包"（会做规范化重写）
 *   --diff <路径>    与这个旧包对比，打印"改了什么"
 *   --force          允许覆盖不是本工具生成的文件
 *   --print          即使给了 --out，也把 JSON 打到 stdout（此时摘要走 stderr）
 *   --json           摘要 / 差异以 JSON 打印（方便脚本消费）
 *   --quiet          不打印摘要
 *
 * 输出约定：
 *   - 没有 --out（或加了 --print）：内容包 JSON → stdout，人类摘要 → stderr；
 *   - 有 --out：摘要 → stdout（除非 --quiet / --json）；
 *   - 有 --diff：差异报告 → stdout，内容包 JSON 不再打到 stdout（要存就用 --out）。
 *
 * 退出码：0 成功（含"为防误覆盖而跳过写出"）；2 用法 / 读文件出错；3 生成的内容包没通过校验。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BALANCE_DIFFICULTY_KEYS,
  BALANCE_EFF_KEYS,
  PACK_FORMAT,
  PACK_SECTIONS,
  checksumPack,
  diffPack,
  normalizePack,
  stableStringify,
  summarizePack,
  validatePack,
} from '../src/content.js';

const TOOL = 'tools/build-content-pack.mjs';
const GENERATOR = 'build-content-pack.mjs';
const SECTION_LABELS = {
  events: '事件',
  items: '道具',
  traits: '天赋',
  personalities: '性格',
  flaws: '缺陷',
  actions: '行动文案',
  balance: '平衡',
};
const EXIT = { OK: 0, USAGE: 2, INVALID: 3 };

/* ------------------------------------------------------------------ 参数 */

function parseArgs(argv) {
  const args = { only: null, force: false, print: false, json: false, quiet: false, help: false };
  const valueFlags = ['--out', '--name', '--version', '--author', '--note', '--requires', '--only', '--pack', '--diff'];
  const boolFlags = ['--force', '--print', '--json', '--quiet', '--help', '-h'];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (boolFlags.includes(token)) {
      if (token === '--help' || token === '-h') args.help = true;
      else args[token.slice(2)] = true;
      continue;
    }
    const [flag, inline] = token.includes('=') ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)] : [token, null];
    if (!valueFlags.includes(flag)) throw new UsageError(`不认识的参数：${token}`);
    const value = inline ?? argv[index + 1];
    if (value === undefined || (inline === null && value.startsWith('--'))) throw new UsageError(`${flag} 后面要跟一个值`);
    if (inline === null) index += 1;
    args[flag.slice(2)] = value;
  }
  if (args.only !== null) {
    const wanted = args.only
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const unknown = wanted.filter((section) => !PACK_SECTIONS.includes(section));
    if (unknown.length) throw new UsageError(`--only 里有不认识的段落：${unknown.join('、')}（可选：${PACK_SECTIONS.join(',')}）`);
    args.only = wanted.length ? wanted : [...PACK_SECTIONS];
  } else {
    args.only = [...PACK_SECTIONS];
  }
  return args;
}

class UsageError extends Error {}

/* -------------------------------------------------------------- 读真实数据 */

/** 判断一个值能不能无损地装进 JSON；装不下就返回原因（用于点名跳过）。 */
function jsonProblem(value, seen = new Set(), path = '') {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return null;
  if (type === 'number') return Number.isFinite(value) ? null : `${path || '值'} 是 ${String(value)}（JSON 存不下）`;
  if (type === 'undefined') return `${path || '值'} 是 undefined`;
  if (type === 'function') return `${path || '值'} 是函数`;
  if (type !== 'object') return `${path || '值'} 是 ${type}`;
  if (seen.has(value)) return `${path || '值'} 是循环引用`;
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    return `${path || '值'} 不是普通对象（${proto?.constructor?.name ?? '未知类型'}）`;
  }
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    const problem = jsonProblem(item, seen, path ? `${path}.${key}` : key);
    if (problem) {
      seen.delete(value);
      return problem;
    }
  }
  seen.delete(value);
  return null;
}

/** 只保留能无损进 JSON 的条目，并记录被跳过的 id 与原因。 */
function jsonSafeEntries(list, section, map = (entry) => entry) {
  const kept = [];
  const skipped = [];
  for (const entry of list) {
    const payload = map(entry);
    const problem = jsonProblem(payload);
    if (problem) skipped.push({ section, id: entry?.id ?? '(没有 id)', reason: problem });
    else kept.push(payload);
  }
  return { kept, skipped };
}

function pickNumbers(source, keys) {
  const out = {};
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** 读 src/data/* 与 src/engine.js（引擎读不到就降级，不整体失败）。 */
async function loadSource() {
  const notes = [];
  const load = (relative) => import(new URL(relative, import.meta.url).href);
  const [events1, events2, events3, events4, events5, itemsModule, actionsModule, characterModule] = await Promise.all([
    load('../src/data/events.js'),
    load('../src/data/events2.js'),
    load('../src/data/events3.js'),
    load('../src/data/events4.js'),
    load('../src/data/events5.js'),
    load('../src/data/items.js'),
    load('../src/data/actions.js'),
    load('../src/data/character.js'),
  ]);

  const events = [
    ...(events1.EVENTS ?? []),
    ...(events2.EXTRA_EVENTS ?? []),
    ...(events3.SEASONAL_EVENTS ?? []),
    ...(events4.ABSTRACT_EVENTS ?? []),
    ...(events5.CAMPUS_EVENTS ?? []),
  ];

  // events6（因果链）由另一个任务产出：文件还没到位不是错误，说明一下就够了
  try {
    const chainModule = await load('../src/data/events6.js');
    const chainEvents = chainModule.CHAIN_EVENTS ?? [];
    events.push(...chainEvents);
    notes.push(`已读入 src/data/events6.js 的 ${chainEvents.length} 条因果链事件`);
  } catch (error) {
    notes.push(`读不到 src/data/events6.js（${error.code ?? error.message}），快照暂不含因果链事件`);
  }

  let engine = null;
  try {
    engine = await load('../src/engine.js');
  } catch (error) {
    notes.push(`读不到 src/engine.js（${error.code ?? error.message}），balance 段落留空；引擎能加载后重跑即可补齐`);
  }

  let version = typeof engine?.GAME_VERSION === 'string' ? engine.GAME_VERSION : '';
  if (!version) {
    try {
      version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '';
    } catch {
      version = '';
    }
  }

  const difficulty = {};
  if (engine?.DIFFICULTY) {
    for (const [key, rules] of Object.entries(engine.DIFFICULTY)) difficulty[key] = pickNumbers(rules, BALANCE_DIFFICULTY_KEYS);
  }

  return {
    events,
    items: itemsModule.ITEMS ?? [],
    traits: characterModule.TRAITS ?? [],
    personalities: characterModule.PERSONALITIES ?? [],
    flaws: characterModule.FLAWS ?? [],
    actions: actionsModule.ACTIONS ?? [],
    eff: pickNumbers(engine?.EFF, BALANCE_EFF_KEYS),
    difficulty,
    version: version || '0.0.0',
    baselineEventIds: (engine?.ALL_EVENTS ?? events).map((event) => event.id),
    notes,
  };
}

/* ------------------------------------------------------------- 生成内容包 */

function buildPack(source, args) {
  const wanted = new Set(args.only);
  const version = args.version ?? source.version;
  const skipped = [];
  const pack = {
    format: PACK_FORMAT,
    meta: {
      name: args.name ?? '内置内容快照',
      version,
      author: args.author ?? '中二野人实验室',
      // 前缀放在最前面：note 超长会被截断，标记必须先活下来
      note: `${GENERATOR} 生成：${args.note ?? '从 src/data/* 取内置内容（含函数逻辑的条目已跳过）'}`,
    },
    requires: {},
    events: [],
    items: [],
    traits: [],
    personalities: [],
    flaws: [],
    actions: [],
    balance: { eff: {}, difficulty: {} },
  };
  // 兼容约束说的是"这个包要求游戏至少是什么版本"，所以默认取**游戏版本**，
  // 不是包自己的版本（内容包 v2.6.1 装进游戏 2.6.0 是完全正常的事）。
  const requires = args.requires ?? (source.version && source.version !== '0.0.0' ? `>=${source.version}` : '');
  if (requires) pack.requires = { app: requires };

  if (wanted.has('events')) {
    // 17 条 events5 的事件没写 kind，引擎按 auto 处理；补齐后 validatePack 才认
    const result = jsonSafeEntries(source.events, 'events', (event) => (event.kind === undefined ? { ...event, kind: 'auto' } : { ...event }));
    pack.events = result.kept;
    skipped.push(...result.skipped);
  }
  if (wanted.has('items')) {
    const result = jsonSafeEntries(source.items, 'items');
    pack.items = result.kept;
    skipped.push(...result.skipped);
  }
  if (wanted.has('traits')) {
    const result = jsonSafeEntries(source.traits, 'traits');
    pack.traits = result.kept;
    skipped.push(...result.skipped);
  }
  if (wanted.has('personalities')) {
    const result = jsonSafeEntries(source.personalities, 'personalities');
    pack.personalities = result.kept;
    skipped.push(...result.skipped);
  }
  if (wanted.has('flaws')) {
    const result = jsonSafeEntries(source.flaws, 'flaws');
    pack.flaws = result.kept;
    skipped.push(...result.skipped);
  }
  if (wanted.has('actions')) {
    // 行动在内容包里只能改文案，所以快照也只带 id / name / desc
    const result = jsonSafeEntries(source.actions, 'actions', (action) => ({ id: action.id, name: action.name, desc: action.desc }));
    pack.actions = result.kept;
    skipped.push(...result.skipped);
  }
  if (wanted.has('balance')) {
    pack.balance = { eff: { ...source.eff }, difficulty: Object.fromEntries(Object.entries(source.difficulty).map(([key, value]) => [key, { ...value }])) };
  }
  return { pack, skipped };
}

/* ------------------------------------------------- 稳定字节序（字段顺序固定） */

const KEY_ORDER = {
  root: ['format', 'meta', 'requires', 'events', 'items', 'traits', 'personalities', 'flaws', 'actions', 'balance'],
  meta: ['name', 'version', 'author', 'note'],
  requires: ['app'],
  event: ['id', 'name', 'icon', 'kind', 'weight', 'minTurn', 'once', 'cooldown', 'chainOnly', 'story', 'text', 'cond', 'effect', 'followUp', 'choices'],
  choice: ['id', 'label', 'hint', 'outcome', 'effect'],
  item: ['id', 'name', 'icon', 'price', 'desc', 'repeatable', 'mods', 'effect'],
  character: ['id', 'name', 'icon', 'desc', 'mods', 'points'],
  action: ['id', 'name', 'desc'],
  balance: ['eff', 'difficulty'],
};
const CHILD_KIND = {
  root: {
    meta: 'meta',
    requires: 'requires',
    events: 'events',
    items: 'items',
    traits: 'characters',
    personalities: 'characters',
    flaws: 'characters',
    actions: 'actions',
    balance: 'balance',
  },
  event: { choices: 'choices' },
  balance: { eff: 'numbers', difficulty: 'difficultyMap' },
  difficultyMap: {},
  numbers: {},
};
const ARRAY_ITEM_KIND = { events: 'event', items: 'item', characters: 'character', actions: 'action', choices: 'choice' };

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 已知字段按固定顺序在前，其余按字典序排在后面——保证字节稳定。 */
function orderKeys(object, preferred) {
  const keys = Object.keys(object);
  const known = preferred.filter((key) => keys.includes(key));
  const rest = keys.filter((key) => !known.includes(key)).sort();
  return [...known, ...rest];
}

function canonicalize(value, kind) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, ARRAY_ITEM_KIND[kind] ?? 'plain'));
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  const children = CHILD_KIND[kind] ?? {};
  for (const key of orderKeys(value, KEY_ORDER[kind] ?? [])) out[key] = canonicalize(value[key], children[key] ?? 'plain');
  return out;
}

/** 渲染成"人写的 JSON"：UTF-8、无 BOM、字段顺序固定、结尾一个换行。 */
function renderPack(pack) {
  return `${JSON.stringify(canonicalize(normalizePack(pack), 'root'), null, 2)}\n`;
}

/* ----------------------------------------------------------------- 差异 */

function changedPaths(before, after, prefix = '') {
  const paths = [];
  const keys = new Set([...Object.keys(isObject(before) ? before : {}), ...Object.keys(isObject(after) ? after : {})]);
  for (const key of [...keys].sort()) {
    const left = isObject(before) ? before[key] : undefined;
    const right = isObject(after) ? after[key] : undefined;
    const at = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(left) || Array.isArray(right)) {
      const length = Math.max(left?.length ?? 0, right?.length ?? 0);
      for (let index = 0; index < length; index += 1) paths.push(...changedPaths(left?.[index], right?.[index], `${at}[${index}]`));
    } else if (isObject(left) && isObject(right)) {
      paths.push(...changedPaths(left, right, at));
    } else if (stableStringify(left) !== stableStringify(right)) {
      paths.push(at);
    }
  }
  return paths;
}

function sectionName(pack, section, id) {
  const entry = (normalizePack(pack)[section] ?? []).find((item) => item.id === id);
  return entry?.name ? ` ${entry.name}` : '';
}

/** 摘要里显示一小段文本（避免把整条 note 打出来）。 */
function clip(value, limit = 24) {
  const text = String(value ?? '');
  if (!text) return '(空)';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function renderDiff(oldPack, newPack, oldLabel, newLabel) {
  const diff = diffPack(oldPack, newPack);
  const lines = ['内容包差异（旧 → 新）'];
  const oldSummary = summarizePack(oldPack);
  const newSummary = summarizePack(newPack);
  lines.push(`  旧  ${oldLabel}  ${oldSummary.name} ${oldSummary.version}  校验和 ${checksumPack(oldPack)}`);
  lines.push(`  新  ${newLabel}  ${newSummary.name} ${newSummary.version}  校验和 ${checksumPack(newPack)}`);
  if (diff.meta.changed.length) {
    const values = {
      name: [diff.meta.nameBefore, diff.meta.nameAfter],
      version: [diff.meta.versionBefore, diff.meta.versionAfter],
      requires: [diff.meta.requiresBefore, diff.meta.requiresAfter],
      note: [oldSummary.note, newSummary.note],
      author: [oldSummary.author, newSummary.author],
    };
    const detail = diff.meta.changed.map((field) => {
      const [before, after] = values[field] ?? ['', ''];
      const label = field === 'note' ? 'note ' : `${field} `;
      return field === 'note' ? `note 改了` : `${label}${clip(before)} → ${clip(after)}`;
    });
    lines.push(`  meta      ${detail.join('；')}`);
  }
  for (const section of ['events', 'items', 'traits', 'personalities', 'flaws', 'actions']) {
    const item = diff[section];
    lines.push(`  ${SECTION_LABELS[section].padEnd(4, '　')}    新增 ${item.added.length} · 修改 ${item.replaced.length} · 删除 ${item.removed.length}`);
    for (const id of item.added) lines.push(`    ＋ ${id}${sectionName(newPack, section, id)}`);
    for (const id of item.replaced) {
      const before = (normalizePack(oldPack)[section] ?? []).find((entry) => entry.id === id);
      const after = (normalizePack(newPack)[section] ?? []).find((entry) => entry.id === id);
      const fields = changedPaths(before, after).slice(0, 6);
      lines.push(`    ～ ${id}${sectionName(newPack, section, id)}　改了 ${fields.join(', ')}`);
    }
    for (const id of item.removed) lines.push(`    － ${id}${sectionName(oldPack, section, id)}`);
  }
  for (const change of diff.balance.effChanged) lines.push(`  平衡      balance.eff.${change.key} ${change.before ?? '(无)'} → ${change.after ?? '(无)'}`);
  for (const change of diff.balance.difficultyChanged) {
    lines.push(`  平衡      balance.difficulty.${change.difficulty}.${change.field} ${change.before ?? '(无)'} → ${change.after ?? '(无)'}`);
  }
  const untouched = ['events', 'items', 'traits', 'personalities', 'flaws', 'actions'].every((section) => {
    const item = diff[section];
    return !item.added.length && !item.replaced.length && !item.removed.length;
  });
  if (untouched && !diff.balance.effChanged.length && !diff.balance.difficultyChanged.length && !diff.meta.changed.length) {
    lines.push('  （两个包的内容完全一样，校验和也相同）');
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------ 摘要 / 输出 */

function renderSummary({ pack, skipped, validation, file, stdout, sha1, bytes, notes }) {
  const summary = summarizePack(pack);
  // 快照本来就是要覆盖同名内容，那几十条"会覆盖"的提示只会淹没有用信息，单独归并掉
  const overwriteWarnings = validation.warnings.filter((warning) => warning.includes('会覆盖游戏里的同名'));
  const otherWarnings = validation.warnings.filter((warning) => !warning.includes('会覆盖游戏里的同名'));
  const lines = [];
  lines.push(`内容包：${summary.name} v${summary.version || '(无版本)'}（format v${summary.format}）`);
  lines.push(`  作者      ${summary.author || '(未署名)'}`);
  lines.push(`  兼容      ${summary.requires || '(不限版本)'}`);
  lines.push(`  校验和    ${checksumPack(pack)}`);
  const counts = PACK_SECTIONS.map((section) => `${SECTION_LABELS[section]} ${summary.counts[section]}`).join(' · ');
  lines.push(`  条目      ${counts}`);
  lines.push(`  校验      ${validation.ok ? '通过' : '不通过'}（${validation.errors.length} 个错误 / ${validation.warnings.length} 个警告）`);
  for (const warning of otherWarnings.slice(0, 5)) lines.push(`    ⚠ ${warning}`);
  if (otherWarnings.length > 5) lines.push(`    … 还有 ${otherWarnings.length - 5} 条警告`);
  if (overwriteWarnings.length) lines.push(`    （另有 ${overwriteWarnings.length} 条"覆盖同名内容"的提示已归并：快照本来就是要覆盖）`);
  if (skipped.length) {
    lines.push(`  跳过      ${skipped.length} 条不能进 JSON 的内容：`);
    for (const item of skipped.slice(0, 8)) lines.push(`    - ${SECTION_LABELS[item.section] ?? item.section} ${item.id}：${item.reason}`);
    if (skipped.length > 8) lines.push(`    … 还有 ${skipped.length - 8} 条`);
  }
  if (notes?.length) for (const note of notes) lines.push(`  说明      ${note}`);
  if (file) lines.push(`  文件      ${file}（${bytes} 字节，sha1 ${sha1}）`);
  else if (stdout) lines.push(`  （内容包 JSON 已打到 stdout，${bytes} 字节，sha1 ${sha1}）`);
  else lines.push('  （没有写出文件）');
  return lines.join('\n');
}

function writeStdout(text) {
  process.stdout.write(`${text}\n`);
}

function writeStderr(text) {
  process.stderr.write(`${text}\n`);
}

/** 文件看起来是不是本工具生成的（只有工具生成的文件才允许被默认覆盖）。 */
function isGeneratedFile(path) {
  try {
    const pack = JSON.parse(readFileSync(path, 'utf8'));
    return typeof pack?.meta?.note === 'string' && pack.meta.note.includes(GENERATOR);
  } catch {
    return false;
  }
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`读不了内容包 ${path}：${error.message}`);
  }
}

function relativePath(path) {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '..');
  return resolve(path).startsWith(root) ? resolve(path).slice(root.length + 1).replace(/\\/g, '/') : path;
}

const HELP = `从 src/data/* 生成内容包 JSON（零依赖、输出字节稳定）。

用法：
  node ${TOOL} [--out 路径] [选项]

常用：
  node ${TOOL} --out web/content/baseline-snapshot.json
  node ${TOOL} --only events,items --name "只带事件和道具"
  node ${TOOL} --pack web/content/demo-update.json --diff web/content/official-pack.json

选项：
  --out <路径>      写出文件（不给就打到 stdout）
  --name <名字>     包名（默认"内置内容快照"）
  --version <版本>  包版本（默认取引擎 GAME_VERSION，退到 package.json）
  --author <作者>   作者
  --note <说明>     备注（会自动加前缀 "${GENERATOR} 生成："）
  --requires <约束> 兼容约束（默认 ">=<游戏版本>"）
  --only <段落>     只带这些段落：${PACK_SECTIONS.join(',')}
  --pack <路径>     用一个已存在的内容包作为"新包"（做规范化重写）
  --diff <路径>     与这个旧包对比，打印改了什么
  --force           允许覆盖不是本工具生成的文件
  --print           给了 --out 也把 JSON 打到 stdout（摘要改走 stderr）
  --json            摘要 / 差异以 JSON 打印
  --quiet           不打印摘要
  --help            看这个

注意：
  * 内容包是 JSON，带函数逻辑的条目（cond / effect / outcome 是函数）会被跳过并点名，
    不会悄悄降级成"永远触发"。
  * 默认不会覆盖手工维护的内容包（比如 web/content/official-pack.json）：
    那种情况下只会提示你加 --force 或换一个 --out 路径，不会动你的文件。
`;

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      writeStderr(`✗ ${error.message}\n\n${HELP}`);
      return EXIT.USAGE;
    }
    throw error;
  }
  if (args.help) {
    writeStdout(HELP.trimEnd());
    return EXIT.OK;
  }

  const source = await loadSource();
  let pack;
  let skipped = [];
  let packPath = null;
  if (args.pack) {
    packPath = resolve(args.pack);
    if (!existsSync(packPath)) throw new UsageError(`--pack 指向的文件不存在：${args.pack}`);
    pack = readJsonFile(packPath);
    pack = normalizePack(pack);
  } else {
    const built = buildPack(source, args);
    pack = built.pack;
    skipped = built.skipped;
  }

  // 用真实数据当上下文校验：包覆盖了哪些 id、行动 id 对不对、难度键存不存在
  const validation = validatePack(pack, {
    appVersion: source.version,
    eventIds: source.baselineEventIds,
    itemIds: source.items.map((item) => item.id),
    actionIds: source.actions.map((action) => action.id),
    difficultyKeys: Object.keys(source.difficulty),
  });

  const text = renderPack(pack);
  const sha1 = createHash('sha1').update(text, 'utf8').digest('hex');
  const bytes = Buffer.byteLength(text, 'utf8');
  const summary = summarizePack(pack);

  // 差异报告在最前面算好：它只读文件，不写文件
  let diffOld = null;
  let diffText = null;
  if (args.diff) {
    const diffPath = resolve(args.diff);
    if (!existsSync(diffPath)) throw new UsageError(`--diff 指向的文件不存在：${args.diff}`);
    diffOld = readJsonFile(diffPath);
    diffText = renderDiff(diffOld, pack, relativePath(diffPath), args.pack ? relativePath(packPath) : '（本次生成）');
  }

  let written = null;
  let skipReason = null;
  if (args.out) {
    const outPath = resolve(args.out);
    const sameFile = packPath !== null && outPath === packPath;
    const generated = existsSync(outPath) ? isGeneratedFile(outPath) : true;
    if (existsSync(outPath) && !args.force && !sameFile && !generated) {
      skipReason = `${relativePath(outPath)} 看起来是手工维护的内容包（不是 ${GENERATOR} 生成的），为防误覆盖没有写出`;
    } else {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, text, 'utf8');
      written = { path: outPath, relative: relativePath(outPath), sha1, bytes };
    }
  }

  const dumpPack = (!args.out || args.print) && !diffText && !(args.json && !args.print && !args.out);
  const stdoutSummary = Boolean(args.out) && !args.print && !diffText;

  if (skipReason) {
    writeStderr(`⚠ ${skipReason}。\n  要覆盖请加 --force；或者换一个输出路径，例如 --out web/content/baseline-snapshot.json。`);
  }
  if (diffText) {
    if (args.json) writeStdout(JSON.stringify({ mode: 'diff', old: relativePath(resolve(args.diff)), new: args.pack ? relativePath(packPath) : null, diff: diffReportJson(diffOld, pack) }, null, 2));
    else writeStdout(diffText);
  } else if (args.json) {
    writeStdout(
      JSON.stringify(
        {
          mode: args.pack ? 'pack' : 'build',
          summary,
          validation,
          skipped,
          file: written ? written.relative : null,
          skippedWrite: skipReason,
          bytes,
          sha1,
          checksum: checksumPack(pack),
          notes: source.notes,
        },
        null,
        2,
      ),
    );
    if (!args.out && !args.print) writeStderr('提示：--json 输出了摘要；要取内容包 JSON 请加 --out，或加 --print。');
  } else if (!args.quiet) {
    const report = renderSummary({
      pack,
      skipped,
      validation,
      file: written ? written.relative : null,
      stdout: dumpPack,
      sha1,
      bytes,
      notes: source.notes,
    });
    if (stdoutSummary) writeStdout(report);
    else writeStderr(report);
  }

  if (dumpPack) {
    if (!args.quiet || args.print) writeStderr(`内容包 JSON（${bytes} 字节，sha1 ${sha1}）：`);
    process.stdout.write(text);
  }

  if (!validation.ok) {
    writeStderr('✗ 内容包没有通过 validatePack，已停止（没有写出文件）：');
    for (const error of validation.errors.slice(0, 20)) writeStderr(`  - ${error}`);
    return EXIT.INVALID;
  }
  return EXIT.OK;
}

/** --json 模式的差异结构（给脚本用）。 */
function diffReportJson(diff) {
  return {
    meta: diff.meta,
    sections: Object.fromEntries(
      ['events', 'items', 'traits', 'personalities', 'flaws', 'actions'].map((section) => [section, diff[section]]),
    ),
    balance: { effChanged: diff.balance.effChanged, difficultyChanged: diff.balance.difficultyChanged },
  };
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof UsageError) {
      writeStderr(`✗ ${error.message}`);
      process.exitCode = EXIT.USAGE;
      return;
    }
    writeStderr(`✗ ${TOOL} 失败：${error?.stack ?? error}`);
    process.exitCode = EXIT.USAGE;
  });
