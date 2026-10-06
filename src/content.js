/**
 * 内容包（content pack）：让"热更新"变成一件纯数据的事。
 *
 * 为什么单独一个文件：
 *   引擎（engine.js）里的 `ALL_EVENTS` / `ITEMS` / `TRAITS` 都是模块加载时算好的常量，
 *   想让玩家**不重装 APK、不重新发版**就拿到新事件 / 新道具 / 调过的平衡，
 *   就必须把"内容"从"规则"里拆出来。
 *
 * 这个文件只做**纯数据**的事：收拢、校验、合并、做摘要、算校验和。
 * 真正的"原地改写引擎里的数组"由 engine.js 的 applyContentPack() 负责——
 * 这样这一层完全可以脱离引擎单测（见 test/content.test.js），
 * `planPack()` 也永远是纯函数：不改基线、不改包、不读外部状态。
 *
 * 一个内容包长这样：
 * ```json
 * {
 *   "format": 1,
 *   "meta": { "name": "秋季内容包", "version": "2.6.1", "author": "官方", "note": "加了两个事件" },
 *   "requires": { "app": ">=2.6.0" },
 *   "events": [ { "id": "...", "name": "...", "kind": "choice", "text": "...", "choices": [] } ],
 *   "items":  [ { "id": "...", "name": "...", "price": 120 } ],
 *   "traits": [ ... ], "personalities": [ ... ], "flaws": [ ... ],
 *   "actions": [ { "id": "drill", "desc": "换过的说明文字" } ],
 *   "balance": {
 *     "eff": { "gainScale": 0.8 },
 *     "difficulty": { "normal": { "forgetScale": 0.9 } }
 *   }
 * }
 * ```
 *
 * 合并规则：**同 id 覆盖、新 id 追加**（actions 只允许改文案，不允许加新行动）。
 *
 * 三层职责分得很清楚，别搞混：
 *   normalizePack  宽容收拢：形状永远正确，绝不抛异常（用户可能在界面上粘错东西）
 *   validatePack   逐条校验：把"哪里错了"说清楚，errors 决定能不能装
 *   planPack       算出结果：纯函数，返回"打完包之后长什么样"，不改任何东西
 *
 * 两条容易被踩的稳定性约定（热更新靠它判断"要不要更新"）：
 *   1. checksumPack 与字段书写顺序无关：`{a:1,b:2}` 和 `{b:2,a:1}` 算出同一个值；
 *   2. 包里出现循环引用、函数、NaN 也不能把 checksumPack / diffPack 炸掉。
 */

/** 当前支持的内容包格式版本。 */
export const PACK_FORMAT = 1;

/** 允许出现在包里的段落（不认识的段落只 warn，不报错，方便前向兼容）。 */
export const PACK_SECTIONS = ['events', 'items', 'traits', 'personalities', 'flaws', 'actions', 'balance'];

/** 按 id 覆盖 / 追加的段落（actions 和 balance 有自己的规则，不在这里）。 */
const ID_SECTIONS = ['events', 'items', 'traits', 'personalities', 'flaws'];

/** 事件必须有的字段 / choice 必须有的字段。 */
const EVENT_REQUIRED = ['id', 'name', 'kind'];
const CHOICE_REQUIRED = ['id', 'label', 'outcome'];

/** 引擎认得的 kind：非 choice 一律按 auto 处理。 */
export const EVENT_KINDS = ['auto', 'choice'];

/**
 * 单个文案字段的长度上限（字符数）。
 *
 * 内容包是玩家在手机上导入的：一条 200KB 的 outcome 能把日志和存档撑爆，
 * 所以超长文本直接报错而不是静默截断——作者需要知道自己的文案没进去。
 */
export const MAX_TEXT_LENGTH = 4000;

/** meta 各字段的长度上限（超出的部分在 normalizePack 里被截掉，不报错）。 */
export const MAX_META_LENGTH = { name: 40, version: 20, author: 30, note: 200 };

/** balance.eff 里允许覆盖的字段（都能在引擎的 EFF 里找到）。 */
export const BALANCE_EFF_KEYS = [
  'knowledgeSlope',
  'minGainFactor',
  'gainScale',
  'fatigueSoftAt',
  'fatigueSlope',
  'fatigueFloor',
  'moodBase',
  'moodSlope',
  'examMoodBase',
  'examMoodSlope',
  'examFatigueSlope',
  'examFatigueFloor',
  'weeklyAllowance',
  'weeklyLivingCost',
  'weeklyFatigueRecovery',
  'weeklyMoodDrain',
  'disciplineDecay',
  'expelAt',
  'weekendScale',
  'weekendEventChance',
  'repeatEventCooldown',
  'maxTraits',
  'maxFlaws',
];

/** balance.difficulty.<id> 里允许覆盖的字段。 */
export const BALANCE_DIFFICULTY_KEYS = ['gain', 'forgetScale', 'slopeScale', 'gainFloor', 'examNoise', 'eventChance', 'money'];

/* ------------------------------------------------------------------ 小工具 */

/** 只认"真对象"：数组、null、函数、Date 之类都不算。 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 把一个字段收拢成字符串并截断；对象 / 数组不会变成 "[object Object]"。 */
function textField(value, limit) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
  return text.trim().slice(0, limit);
}

/** 数字字段收拢：不是有限数字就返回 null。 */
function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 只保留"键 → 有限数字"的字段。 */
function numberMap(object) {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    const parsed = finiteNumber(value);
    if (parsed !== null) out[key] = parsed;
  }
  return out;
}

/**
 * format 字段：缺省 / 空串算 PACK_FORMAT，能解析成数字就用那个数字。
 *
 * 注意 `Number(null)` / `Number('')` 都是 0——如果直接 Number() 会把
 * "没写 format" 误判成"format v0"，这里必须先挡掉空值。
 */
function normalizeFormat(value) {
  if (value === undefined || value === null) return PACK_FORMAT;
  if (typeof value === 'string' && value.trim() === '') return PACK_FORMAT;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : PACK_FORMAT;
}

/** 版本号 → [major, minor, patch]（解析不出来就当 0.0.0）。 */
function parseVersion(value) {
  const match = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(value ?? ''));
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** 版本号比较：a>b 返回 1，a<b 返回 -1，相等返回 0（逐段比较，不受段宽影响）。 */
function compareVersion(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

/** 校验和 / 差异比较用的稳定序列化：键排序、循环引用打标记、绝不抛异常。 */
export function stableStringify(value) {
  return stringifyValue(value, new Set());
}

function stringifyValue(value, seen) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string') return JSON.stringify(value);
  // NaN / Infinity 不能走 JSON.stringify（会变 null，和真的 null 撞车）
  if (type === 'number') return Number.isFinite(value) ? String(value) : `"${String(value)}"`;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'undefined') return '"[undefined]"';
  if (type === 'function') return '"[function]"';
  if (type === 'symbol' || type === 'bigint') return `"[${type}]"`;
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = `[${value.map((item) => stringifyValue(item, seen)).join(',')}]`;
  } else {
    const keys = Object.keys(value).sort();
    out = `{${keys.map((key) => `${JSON.stringify(key)}:${stringifyValue(value[key], seen)}`).join(',')}}`;
  }
  seen.delete(value);
  return out;
}

/* ------------------------------------------------------------------ 空包 */

/** 一个空包（每次都是新对象，改一个不会串到另一个）。 */
export function emptyPack() {
  return { format: PACK_FORMAT, meta: { name: '', version: '', author: '', note: '' }, requires: {}, ...sections() };
}

function sections() {
  return {
    events: [],
    items: [],
    traits: [],
    personalities: [],
    flaws: [],
    actions: [],
    balance: { eff: {}, difficulty: {} },
  };
}

/* -------------------------------------------------------------- normalize */

/**
 * 把任意输入收拢成一个形状正确的包（**不抛异常、不校验内容**）。
 * 界面上用户可能粘错东西，所以这一步必须宽容，错了交给 validatePack 说清楚。
 *
 * 保证：返回的对象一定只有 `format / meta / requires / <PACK_SECTIONS>` 这些键，
 * 数组段落一定是数组，balance 一定是 `{ eff, difficulty }`，数字字段一定是数字。
 * 但**不保证**条目本身合法（缺 id、text 是对象之类都原样留着，让 validatePack 报）。
 *
 * @param {unknown} input
 * @returns {object}
 */
export function normalizePack(input) {
  const raw = isPlainObject(input) ? input : {};
  const pack = emptyPack();
  pack.format = normalizeFormat(raw.format);

  const meta = isPlainObject(raw.meta) ? raw.meta : {};
  pack.meta = {
    name: textField(meta.name ?? raw.name, MAX_META_LENGTH.name),
    version: textField(meta.version ?? raw.version, MAX_META_LENGTH.version),
    author: textField(meta.author, MAX_META_LENGTH.author),
    note: textField(meta.note, MAX_META_LENGTH.note),
  };

  // requires 既接受 `{ app: ">=2.6.0" }`，也接受直接写 `">=2.6.0"`。
  // 空值统一收拢成 `{}`（不是 `{ app: '' }`）——否则 `{}` 和 `emptyPack()` 这种
  // 逻辑上完全一样的包会算出两个不同的校验和。
  const app = isPlainObject(raw.requires)
    ? textField(raw.requires.app, MAX_META_LENGTH.version)
    : typeof raw.requires === 'string'
      ? textField(raw.requires, MAX_META_LENGTH.version)
      : '';
  pack.requires = app ? { app } : {};

  for (const key of [...ID_SECTIONS, 'actions']) {
    // 只留"真对象"条目：字符串 / 数组 / null 这类垃圾直接丢掉（validatePack 会报告）
    pack[key] = Array.isArray(raw[key]) ? raw[key].filter(isPlainObject) : [];
  }

  if (isPlainObject(raw.balance)) {
    const eff = isPlainObject(raw.balance.eff) ? raw.balance.eff : {};
    pack.balance.eff = numberMap(eff);
    const difficulty = isPlainObject(raw.balance.difficulty) ? raw.balance.difficulty : {};
    pack.balance.difficulty = Object.fromEntries(
      Object.entries(difficulty)
        .filter(([, value]) => isPlainObject(value))
        .map(([key, value]) => [key, numberMap(value)]),
    );
  }
  return pack;
}

/* -------------------------------------------------------------- satisfies */

/**
 * `">=2.6.0"` 这种简单约束。
 *
 * 支持 `>= > <= < == = !=`，版本号可以写 1~3 段（`2.6` 等于 `2.6.0`）。
 * 看不懂的约束一律放行——宁可让玩家装上，也不要把人卡在门外。
 */
export function satisfies(appVersion, constraint) {
  const text = String(constraint ?? '').trim();
  if (!text) return true;
  const match = /^(>=|<=|==|!=|>|<|=)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text);
  if (!match) return true;
  const [, op = '>=', a, b, c] = match;
  const want = [Number(a), Number(b ?? 0), Number(c ?? 0)];
  const cmp = compareVersion(parseVersion(appVersion), want);
  if (op === '>=') return cmp >= 0;
  if (op === '>') return cmp > 0;
  if (op === '<=') return cmp <= 0;
  if (op === '<') return cmp < 0;
  if (op === '!=') return cmp !== 0;
  return cmp === 0;
}

/* --------------------------------------------------------------- validate */

/**
 * 校验内容包。`pack` 可以是原始输入，也可以是 normalizePack() 之后的结果。
 *
 * 错误文案的约定（测试盯着，界面也直接显示给玩家）：
 *   - 每条错误都要能定位到"哪一段 / 哪个 id / 哪个字段"；
 *   - 能装但会丢东西的情况放 warnings，不拦；
 *   - 只有 errors 非空时 `ok` 才是 false。
 *
 * @param {object} pack
 * @param {{ appVersion?: string, eventIds?: Iterable<string>, itemIds?: Iterable<string>, actionIds?: Iterable<string>, difficultyKeys?: Iterable<string> }} context
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validatePack(pack, context = {}) {
  const errors = [];
  const warnings = [];
  const raw = isPlainObject(pack) ? pack : {};
  const data = normalizePack(raw);
  const ctx = isPlainObject(context) ? context : {};

  if (data.format !== PACK_FORMAT) {
    errors.push(`内容包格式是 v${data.format}，这个版本只认识 v${PACK_FORMAT}`);
  }
  if (!data.meta.name) warnings.push('内容包没有名字，界面上会显示成"未命名内容包"');
  // 版本约束只在"知道当前是什么版本"时才拦：前端预览、离线工具可能拿不到 appVersion，
  // 那时候宁可放行（和 satisfies 看不懂约束就放行是同一个态度）。
  const appVersion = typeof ctx.appVersion === 'string' && ctx.appVersion.trim() ? ctx.appVersion : null;
  if (data.requires.app && appVersion && !satisfies(appVersion, data.requires.app)) {
    errors.push(`这个内容包要求游戏版本 ${data.requires.app}，当前是 ${appVersion}`);
  }

  /* ------------------------------------------------------------ 事件 */
  const seen = new Set();
  data.events.forEach((event, index) => {
    const label = event.id === undefined || event.id === null || event.id === '' ? '(没有 id)' : String(event.id);
    const where = `事件 ${label}`;
    for (const field of EVENT_REQUIRED) if (event[field] === undefined) errors.push(`${where} 缺少字段 ${field}（包里第 ${index + 1} 条事件）`);

    if (event.id !== undefined && (typeof event.id !== 'string' || !event.id.trim())) {
      errors.push(`${where} 的 id 必须是非空字符串（第 ${index + 1} 条）`);
    } else if (event.id !== undefined) {
      if (seen.has(event.id)) errors.push(`${where} 在包里出现了两次（第 ${index + 1} 条）`);
      seen.add(event.id);
    }
    if (event.name !== undefined && typeof event.name !== 'string') errors.push(`${where} 的 name 必须是字符串`);
    else if (typeof event.name === 'string' && !event.name.trim()) errors.push(`${where} 的 name 不能是空字符串`);
    if (event.text !== undefined && typeof event.text !== 'string' && typeof event.text !== 'function') {
      errors.push(`${where} 的 text 必须是字符串`);
    }
    checkText(errors, where, 'text', event.text);
    if (event.kind !== undefined && !EVENT_KINDS.includes(event.kind)) {
      warnings.push(`${where} 的 kind "${event.kind}" 引擎不认识，会按 auto 处理`);
    }
    if (event.weight !== undefined && !(finiteNumber(event.weight) > 0)) {
      errors.push(`${where} 的 weight 必须是大于 0 的数字（现在是 ${stringifyValue(event.weight, new Set())}）`);
    }

    if (event.kind === 'choice') {
      if (!Array.isArray(event.choices) || event.choices.length === 0) {
        errors.push(`${where} 是 choice 事件，必须带 choices`);
      } else {
        const choiceIds = new Set();
        event.choices.forEach((choice, choiceIndex) => {
          const at = `第 ${choiceIndex + 1} 个选项`;
          if (!isPlainObject(choice)) {
            errors.push(`${where} 的${at}必须是一个对象`);
            return;
          }
          for (const field of CHOICE_REQUIRED) if (choice[field] === undefined) errors.push(`${where} 的选项缺少 ${field}（${at}）`);
          if (choice.id !== undefined && (typeof choice.id !== 'string' || !choice.id.trim())) {
            errors.push(`${where} 的${at}的 id 必须是非空字符串`);
          } else if (choice.id !== undefined) {
            if (choiceIds.has(choice.id)) errors.push(`${where} 的选项 ${choice.id} 重复了`);
            choiceIds.add(choice.id);
          }
          for (const field of ['label', 'outcome']) {
            if (choice[field] !== undefined && typeof choice[field] !== 'string' && typeof choice[field] !== 'function') {
              errors.push(`${where} 的选项 ${choice.id ?? at} 的 ${field} 必须是字符串`);
            } else {
              checkText(errors, `${where} 的选项 ${choice.id ?? at}`, field, choice[field]);
            }
          }
          if (choice.hint !== undefined && typeof choice.hint !== 'string' && typeof choice.hint !== 'function') {
            errors.push(`${where} 的选项 ${choice.id ?? at} 的 hint 必须是字符串`);
          } else {
            checkText(errors, `${where} 的选项 ${choice.id ?? at}`, 'hint', choice.hint);
          }
          if (choice.effect !== undefined && typeof choice.effect !== 'function' && !isPlainObject(choice.effect)) {
            errors.push(`${where} 的选项 ${choice.id ?? at} 的 effect 必须是对象或函数`);
          }
        });
      }
    } else if (Array.isArray(event.choices) && event.choices.length > 0) {
      warnings.push(`${where} 的 kind 是 ${event.kind ?? 'auto'}，choices 会被忽略`);
    }
  });

  // 允许包覆盖已有的 id（那就是"改内容"），只提示不报错
  const knownEvents = new Set(ctx.eventIds ?? []);
  for (const event of data.events) {
    if (event.id && knownEvents.size && knownEvents.has(event.id)) warnings.push(`事件 ${event.id} 会覆盖游戏里的同名事件`);
  }

  /* ------------------------------------------------------------ 道具 */
  const knownItems = new Set(ctx.itemIds ?? []);
  const seenItems = new Set();
  data.items.forEach((item, index) => {
    if (!item.id || !item.name) {
      errors.push(`道具必须带 id 和 name（第 ${index + 1} 条：id=${item.id ?? '缺失'}，name=${item.name ?? '缺失'}）`);
    }
    if (item.id !== undefined && !seenItems.has(item.id)) seenItems.add(item.id);
    else if (item.id !== undefined) errors.push(`道具 ${item.id} 在包里出现了两次`);
    if (item.price !== undefined) {
      const price = finiteNumber(item.price);
      if (price === null) errors.push(`道具 ${item.id ?? `第 ${index + 1} 条`} 的 price 不是数字：${stringifyValue(item.price, new Set())}`);
      else if (price < 0) errors.push(`道具 ${item.id ?? `第 ${index + 1} 条`} 的 price 不能是负数`);
    }
    if (item.mods !== undefined && !isPlainObject(item.mods)) errors.push(`道具 ${item.id ?? `第 ${index + 1} 条`} 的 mods 必须是对象`);
    if (item.effect !== undefined && typeof item.effect !== 'function' && !isPlainObject(item.effect)) {
      errors.push(`道具 ${item.id ?? `第 ${index + 1} 条`} 的 effect 必须是对象或函数`);
    }
    checkText(errors, `道具 ${item.id ?? `第 ${index + 1} 条`}`, 'name', item.name);
    checkText(errors, `道具 ${item.id ?? `第 ${index + 1} 条`}`, 'desc', item.desc);
    if (item.id && knownItems.size && knownItems.has(item.id)) warnings.push(`道具 ${item.id} 会覆盖游戏里的同名道具`);
  });

  /* -------------------------------------------------- 天赋 / 性格 / 缺陷 */
  for (const key of ['traits', 'personalities', 'flaws']) {
    data[key].forEach((entry, index) => {
      if (!entry.id || !entry.name) {
        errors.push(`${key} 里的条目必须带 id 和 name（第 ${index + 1} 条：id=${entry.id ?? '缺失'}，name=${entry.name ?? '缺失'}）`);
      }
    });
  }

  /* ------------------------------------------------------------ 行动 */
  const knownActions = new Set(ctx.actionIds ?? []);
  data.actions.forEach((action, index) => {
    if (!action.id) errors.push(`actions 里的条目必须带 id（第 ${index + 1} 条）`);
    else if (knownActions.size && !knownActions.has(action.id)) errors.push(`actions 里没有这个行动：${action.id}（内容包只能改文案，不能新增行动）`);
    checkText(errors, `行动 ${action.id ?? `第 ${index + 1} 条`}`, 'name', action.name);
    checkText(errors, `行动 ${action.id ?? `第 ${index + 1} 条`}`, 'desc', action.desc);
    const extra = Object.keys(action).filter((field) => !['id', 'name', 'desc'].includes(field));
    if (extra.length) {
      warnings.push(`actions 里的 ${action.id ?? `第 ${index + 1} 条`} 带了 ${extra.join('、')}，内容包只能改文案，这些字段会被忽略`);
    }
  });

  /* ------------------------------------------------------------ 平衡 */
  // 非数字 / 非对象的写法会被 normalizePack 静默丢掉，所以这里回头看原始输入，
  // 把"你写了一个引擎看不懂的值"明确报出来（否则作者以为调了平衡，其实没生效）。
  const rawBalance = isPlainObject(raw.balance) ? raw.balance : null;
  if (isPlainObject(rawBalance?.eff)) {
    for (const [key, value] of Object.entries(rawBalance.eff)) {
      if (finiteNumber(value) === null) errors.push(`balance.eff.${key} 必须是数字：${stringifyValue(value, new Set())}`);
    }
  }
  for (const key of Object.keys(data.balance.eff)) {
    if (!BALANCE_EFF_KEYS.includes(key)) warnings.push(`balance.eff.${key} 引擎不认，会被忽略`);
  }
  if (isPlainObject(rawBalance?.difficulty)) {
    for (const [key, value] of Object.entries(rawBalance.difficulty)) {
      if (!isPlainObject(value)) errors.push(`balance.difficulty.${key} 必须是一个对象（现在是 ${stringifyValue(value, new Set())}）`);
    }
  }
  const difficultyKeys = new Set(ctx.difficultyKeys ?? []);
  for (const [key, value] of Object.entries(data.balance.difficulty)) {
    if (difficultyKeys.size && !difficultyKeys.has(key)) warnings.push(`balance.difficulty.${key} 不存在，会被忽略`);
    for (const field of Object.keys(value)) {
      if (!BALANCE_DIFFICULTY_KEYS.includes(field)) warnings.push(`balance.difficulty.${key}.${field} 引擎不认，会被忽略`);
    }
  }

  /* ------------------------------------------------- 结构 / 不认识的段 */
  // 注意：这一层必须看**原始输入**——normalizePack 已经把不认识的段落丢掉了，
  // 在收拢结果上找未知键永远找不到。
  for (const key of Object.keys(raw)) {
    if (key === 'format' || key === 'meta' || key === 'requires' || key === 'name' || key === 'version') continue;
    if (PACK_SECTIONS.includes(key)) continue;
    warnings.push(`包里有一段 "${key}" 这个版本不认识，会被忽略`);
  }
  // 被 normalizePack 丢掉的垃圾条目同样要说出来，否则用户以为自己写进去了
  for (const key of [...ID_SECTIONS, 'actions']) {
    if (!Array.isArray(raw[key])) continue;
    raw[key].forEach((entry, index) => {
      if (isPlainObject(entry)) return;
      warnings.push(`${key} 的第 ${index + 1} 条不是对象（是 ${Array.isArray(entry) ? 'array' : typeof entry}），已经被丢掉`);
    });
  }

  const summary = summarizePack(data);
  if (summary.total === 0) warnings.push('这个包什么都没改（没有事件、道具、天赋，也没有平衡调整）');

  return { ok: errors.length === 0, errors, warnings };
}

/** 文案字段的长度检查（超长直接报错，不静默截断）。 */
function checkText(errors, where, field, value) {
  if (typeof value !== 'string') return;
  if (value.length > MAX_TEXT_LENGTH) {
    errors.push(`${where} 的 ${field} 太长（${value.length} 字，上限 ${MAX_TEXT_LENGTH}）`);
  }
}

/* -------------------------------------------------------------- mergeById */

/**
 * 合并某一类"按 id 覆盖"的数组：同 id 覆盖，新 id 追加（保持原顺序）。
 *
 * - 覆盖是**一层浅合并**：包里只写想改的字段，没写的保留原值；
 * - 覆盖后是一个新对象，原数组里的对象不会被改写；
 * - 没有 id（或 id 为空）的条目没法参与"按 id 合并"，会被丢进 `skipped` 里报告，
 *   而不是变成一条 id 为 undefined 的幽灵内容。
 *
 * @returns {{ merged: object[], added: string[], replaced: string[], skipped: unknown[] }}
 */
export function mergeById(baseList, patchList) {
  const merged = Array.isArray(baseList) ? baseList.slice() : [];
  const index = new Map();
  merged.forEach((entry, at) => {
    if (isPlainObject(entry) && entry.id !== undefined && entry.id !== null && entry.id !== '') index.set(entry.id, at);
  });
  const added = [];
  const replaced = [];
  const skipped = [];
  const list = Array.isArray(patchList) ? patchList : [];
  for (const entry of list) {
    if (!isPlainObject(entry) || entry.id === undefined || entry.id === null || entry.id === '') {
      skipped.push(entry);
      continue;
    }
    const at = index.get(entry.id);
    if (at === undefined) {
      index.set(entry.id, merged.length);
      merged.push({ ...entry });
      added.push(entry.id);
    } else {
      // 深合并一层：包里只写想改的字段，没写的保留原值
      merged[at] = { ...merged[at], ...entry };
      replaced.push(entry.id);
    }
  }
  return { merged, added, replaced, skipped };
}

/* --------------------------------------------------------------- planPack */

/**
 * 算出"打完这个包之后，各类内容长什么样"（纯函数，不动任何外部状态）。
 *
 * 规则：
 *   - events / items / traits / personalities / flaws：同 id 覆盖、新 id 追加；
 *   - actions：**只能改文案**（name / desc），id 对不上直接丢掉，结构永远来自代码；
 *   - balance.eff：只覆盖 baseline 里已经存在的键；
 *   - balance.difficulty：只覆盖 baseline 里已存在的难度与字段。
 *
 * @param {{ events?, items?, traits?, personalities?, flaws?, actions?, eff?, difficulty? }} baseline
 * @param {object} pack
 * @returns {{ events, items, traits, personalities, flaws, actions, eff, difficulty, applied }}
 */
export function planPack(baseline = {}, pack = {}) {
  const base = isPlainObject(baseline) ? baseline : {};
  const data = normalizePack(pack);
  const applied = {};
  const out = {};

  for (const key of ID_SECTIONS) {
    const result = mergeById(base[key], data[key]);
    out[key] = result.merged;
    applied[key] = { added: result.added, replaced: result.replaced, skipped: result.skipped.length };
  }

  // 行动只能改文案：id 对得上就覆盖名字 / 说明，对不上直接丢掉
  const baselineActions = Array.isArray(base.actions) ? base.actions : [];
  const replacedActions = [];
  const actions = baselineActions.map((action) => {
    const patch = data.actions.find((entry) => entry.id === action?.id);
    if (!patch) return action;
    replacedActions.push(action.id);
    const next = { ...action };
    // 只接受字符串：数字 / 对象写进来只会把界面搞崩，validatePack 也会报错
    if (typeof patch.name === 'string') next.name = patch.name;
    if (typeof patch.desc === 'string') next.desc = patch.desc;
    return next;
  });
  out.actions = actions;
  applied.actions = {
    replaced: replacedActions,
    dropped: data.actions.filter((entry) => !baselineActions.some((action) => action?.id === entry.id)).map((entry) => entry.id),
  };

  // 平衡：只覆盖已知的键，其余原样
  const baseEff = isPlainObject(base.eff) ? base.eff : {};
  const eff = { ...baseEff };
  const appliedEff = [];
  const ignoredEff = [];
  for (const [key, value] of Object.entries(data.balance.eff)) {
    if (key in baseEff) {
      eff[key] = value;
      appliedEff.push(key);
    } else {
      ignoredEff.push(key);
    }
  }
  out.eff = eff;
  applied.eff = appliedEff;
  applied.effIgnored = ignoredEff;

  const baseDifficulty = isPlainObject(base.difficulty) ? base.difficulty : {};
  const difficulty = {};
  const appliedDifficulty = [];
  const ignoredDifficulty = [];
  for (const [key, value] of Object.entries(baseDifficulty)) {
    const patch = data.balance.difficulty[key];
    if (!isPlainObject(patch)) {
      difficulty[key] = value;
      continue;
    }
    const next = isPlainObject(value) ? { ...value } : {};
    let touched = false;
    for (const [field, raw] of Object.entries(patch)) {
      if (field in next) {
        next[field] = raw;
        touched = true;
      }
    }
    difficulty[key] = next;
    if (touched) appliedDifficulty.push(key);
  }
  for (const key of Object.keys(data.balance.difficulty)) if (!(key in baseDifficulty)) ignoredDifficulty.push(key);
  out.difficulty = difficulty;
  applied.difficulty = appliedDifficulty;
  applied.difficultyIgnored = ignoredDifficulty;

  return { ...out, applied };
}

/* ---------------------------------------------------------- summarizePack */

/** 给界面看的一句话摘要。 */
export function summarizePack(pack) {
  const data = normalizePack(pack);
  const counts = {
    events: data.events.length,
    items: data.items.length,
    traits: data.traits.length,
    personalities: data.personalities.length,
    flaws: data.flaws.length,
    actions: data.actions.length,
    balance: Object.keys(data.balance.eff).length + Object.values(data.balance.difficulty).reduce((sum, entry) => sum + Object.keys(entry).length, 0),
  };
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    name: data.meta.name || '未命名内容包',
    version: data.meta.version,
    author: data.meta.author,
    note: data.meta.note,
    format: data.format,
    requires: data.requires.app ?? '',
    counts,
    total,
    active: Boolean(total > 0 || data.meta.name),
  };
}

/* ----------------------------------------------------------- checksumPack */

/**
 * 稳定的校验和：同一个包永远算出同一个值（用来判断"要不要更新"）。
 *
 * "同一个包"指的是**内容相同**——字段书写顺序不同（`{a:1,b:2}` vs `{b:2,a:1}`）
 * 必须算出同一个值，所以这里走 stableStringify（键排序）而不是 JSON.stringify。
 * 循环引用 / 函数 / NaN 也不会抛异常，只会被标记后参与计算。
 */
export function checksumPack(pack) {
  const data = normalizePack(pack);
  const text = stableStringify({
    format: data.format,
    meta: data.meta,
    requires: data.requires,
    events: data.events,
    items: data.items,
    traits: data.traits,
    personalities: data.personalities,
    flaws: data.flaws,
    actions: data.actions,
    balance: data.balance,
  });
  // djb2：够用、够快、不依赖 crypto（浏览器和 Node 都能跑）
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

/* --------------------------------------------------------------- diffPack */

/**
 * 对比两个包，给"这次更新改了什么"用。
 *
 * 返回的每一段都是 `{ added, replaced, removed }`（id 数组）。
 * `replaced` 的判断是**内容比较**（stableStringify），字段顺序不同不算改过。
 *
 * @returns {{ events, items, traits, personalities, flaws, actions, balance, meta }}
 */
export function diffPack(basePack, pack) {
  const base = normalizePack(basePack);
  const next = normalizePack(pack);
  const compare = (key) => {
    const before = new Map(base[key].map((entry) => [entry.id, entry]));
    const after = new Map(next[key].map((entry) => [entry.id, entry]));
    const added = [...after.keys()].filter((id) => id !== undefined && !before.has(id));
    const replaced = [...after.keys()].filter(
      (id) => id !== undefined && before.has(id) && stableStringify(before.get(id)) !== stableStringify(after.get(id)),
    );
    const removed = [...before.keys()].filter((id) => id !== undefined && !after.has(id));
    return { added, replaced, removed };
  };

  const effChanged = [];
  const effKeys = new Set([...Object.keys(base.balance.eff), ...Object.keys(next.balance.eff)]);
  for (const key of [...effKeys].sort()) {
    if (base.balance.eff[key] !== next.balance.eff[key]) {
      effChanged.push({ key, before: base.balance.eff[key] ?? null, after: next.balance.eff[key] ?? null });
    }
  }
  const difficultyChanged = [];
  const difficultyKeys = new Set([...Object.keys(base.balance.difficulty), ...Object.keys(next.balance.difficulty)]);
  for (const key of [...difficultyKeys].sort()) {
    const before = base.balance.difficulty[key] ?? {};
    const after = next.balance.difficulty[key] ?? {};
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[field] !== after[field]) difficultyChanged.push({ difficulty: key, field, before: before[field] ?? null, after: after[field] ?? null });
    }
  }

  const metaFields = ['name', 'version', 'author', 'note', 'requires'];
  const metaChanged = metaFields.filter((field) => {
    const before = field === 'requires' ? base.requires.app : base.meta[field];
    const after = field === 'requires' ? next.requires.app : next.meta[field];
    return before !== after;
  });

  return {
    events: compare('events'),
    items: compare('items'),
    traits: compare('traits'),
    personalities: compare('personalities'),
    flaws: compare('flaws'),
    actions: compare('actions'),
    balance: {
      effBefore: base.balance.eff,
      effAfter: next.balance.eff,
      difficultyBefore: base.balance.difficulty,
      difficultyAfter: next.balance.difficulty,
      effChanged,
      difficultyChanged,
    },
    meta: {
      nameBefore: base.meta.name,
      nameAfter: next.meta.name,
      versionBefore: base.meta.version,
      versionAfter: next.meta.version,
      requiresBefore: base.requires.app,
      requiresAfter: next.requires.app,
      changed: metaChanged,
    },
  };
}
