/**
 * 排行榜 —— 纯数据层（v3.1）。
 *
 * 这份文件不碰 DOM、不碰 localStorage，只做四件事：
 *   1. 把一局的结果整理成一条**榜单条目**，并校验它（分数范围、昵称长度、枚举值）；
 *   2. 排序与并列名次（两个榜：总分榜 / 收集榜）；
 *   3. 生成"可复核"的分享文案（带种子，别人能用同一套参数复现同一局）；
 *   4. 跟 Supabase 的 REST 接口说话（fetch 是参数传进来的，所以能用假服务器测）。
 *
 * 为什么用 Supabase：GitHub Pages 是纯静态的，没有数据库。前端只放 **anon key**
 * （这是 Supabase 设计上就公开的"publishable"密钥），真正的门禁在数据库的 RLS 策略里：
 * 匿名只能 select + insert，不能 update / delete（见 tools/leaderboard-schema.sql）。
 *
 * 一句实话：客户端提交的成绩**防不了作弊**。这里能做的是"可复核"——
 * 条目里带 seed 和构筑摘要，同种子同构筑必然跑出同一局，假数据一眼就露。
 */

export const LEADERBOARD_FORMAT = 1;
/** 昵称长度：太短没法认人，太长会把榜单撑爆 */
export const NICKNAME_MIN = 1;
export const NICKNAME_MAX = 16;
/** 一次最多拉多少条（拉回来再按昵称去重） */
export const MAX_FETCH_ENTRIES = 200;
/** 本机榜保留多少条 */
export const MAX_LOCAL_ENTRIES = 50;
/** 没起名字时的占位昵称 */
export const DEFAULT_NICKNAME = '无名同学';

export const LEADERBOARD_METRICS = [
  {
    key: 'score',
    name: '总分榜',
    icon: '🎯',
    desc: '按高考总分排；同分看年级名次，再同就看成就数。难度不同分数本来就不可比，所以每行都带难度徽章。',
  },
  {
    key: 'collection',
    name: '收集榜',
    icon: '📖',
    desc: '按结局图鉴解锁数排；一样多就比成就收录数，再比总分。多周目玩家的主场。',
  },
];

export const METRIC_KEYS = LEADERBOARD_METRICS.map((item) => item.key);

const MODES = ['solo', 'versus'];
const DIFFICULTIES = ['easy', 'normal', 'hard', 'realistic', 'custom'];
const RIVAL_LEVELS = ['easy', 'normal', 'hard', 'real'];

/** 去掉控制字符、压掉多余空白——昵称会直接显示给别人看。 */
export function normalizeNickname(value, fallback = DEFAULT_NICKNAME) {
  const text = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  return text.slice(0, NICKNAME_MAX);
}

function clampInt(value, min, max, fallback = null) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function shortText(value, max) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : '';
}

/**
 * 把一局的结果整理成榜单条目。
 *
 * @param {object} input
 * @param {string} input.nickname  榜单昵称
 * @param {object} input.view      对局视图（结局、难度、模式都在里面）
 * @param {object} input.profile   跨局档案（结局图鉴 / 成就收录数）
 * @param {string} [input.at]      时间戳
 */
export function entryFromRun({ nickname, view, profile, at }) {
  const ending = view?.ending ?? {};
  const unlockedEndings = Object.keys(profile?.unlocked ?? {}).length;
  const collectedAchievements =
    profile?.achievements && typeof profile.achievements === 'object'
      ? Object.keys(profile.achievements).length
      : new Set((profile?.history ?? []).flatMap((run) => run.achievements ?? [])).size;

  const versus = view?.versus?.active ? view.versus : null;
  const rivalLevel = versus?.level?.key ?? null;
  const build = view?.build ?? {};
  const buildSummary = [
    view?.selection?.label ?? view?.student?.track ?? '',
    (build.traits ?? []).map((trait) => trait.name).join('/'),
    build.goal?.name ? `目标${build.goal.name}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 80);

  return normalizeEntry({
    format: LEADERBOARD_FORMAT,
    nickname,
    score: ending.total ?? null,
    rank: ending.rank ?? null,
    endingId: ending.id ?? null,
    endingTitle: ending.title ?? '——',
    tier: ending.tier ?? null,
    endings: unlockedEndings,
    achievements: collectedAchievements,
    runs: Number(profile?.runs) || 0,
    difficulty: view?.difficulty?.key ?? 'normal',
    mode: view?.mode ?? 'solo',
    rivalLevel,
    versusWinner: versus?.winner ?? null,
    seed: view?.seed ?? null,
    build: buildSummary,
    at: at ?? new Date().toISOString(),
  });
}

/** 补默认值 + 砍掉超长字段。不合法的地方留给 validateEntry 去报。 */
export function normalizeEntry(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const score = source.score === null || source.score === undefined ? null : clampInt(source.score, 0, 750, null);
  return {
    format: LEADERBOARD_FORMAT,
    nickname: normalizeNickname(source.nickname),
    score,
    rank: source.rank === null || source.rank === undefined ? null : clampInt(source.rank, 1, 1000, null),
    endingId: shortText(source.endingId, 40) || null,
    endingTitle: shortText(source.endingTitle, 60) || '——',
    tier: shortText(source.tier, 20) || null,
    endings: clampInt(source.endings, 0, 500, 0),
    achievements: clampInt(source.achievements, 0, 500, 0),
    runs: clampInt(source.runs, 0, 9999, 0),
    difficulty: DIFFICULTIES.includes(source.difficulty) ? source.difficulty : 'normal',
    mode: MODES.includes(source.mode) ? source.mode : 'solo',
    rivalLevel: RIVAL_LEVELS.includes(source.rivalLevel) ? source.rivalLevel : null,
    versusWinner: ['you', 'rival', 'tie'].includes(source.versusWinner) ? source.versusWinner : null,
    seed: shortText(source.seed, 40) || null,
    build: shortText(source.build, 80) || null,
    at: shortText(source.at, 40) || new Date().toISOString(),
  };
}

/**
 * 校验一条榜单条目。
 * 只当成"防手滑"：能挡住离谱的分数、空昵称、超长标题，挡不住有心作弊。
 */
export function validateEntry(entry) {
  const errors = [];
  const value = normalizeEntry(entry);
  const nickname = String(entry?.nickname ?? '').trim();
  if (nickname.length < NICKNAME_MIN) errors.push('昵称不能是空的');
  if (nickname.length > NICKNAME_MAX) errors.push(`昵称最多 ${NICKNAME_MAX} 个字`);

  const rawScore = entry?.score;
  if (rawScore !== null && rawScore !== undefined) {
    const score = Number(rawScore);
    if (!Number.isFinite(score) || score < 0 || score > 750) errors.push('高考总分必须在 0~750 之间');
  } else if (!entry?.endingTitle || entry.endingTitle === '——') {
    // 没有高考分的特殊结局（保送 / 退学）至少要有结局名
    errors.push('既没有总分也没有结局名，上传没有意义');
  }
  if (Number(entry?.endings) < 0) errors.push('收集数不能是负数');
  return { ok: errors.length === 0, errors, entry: value };
}

function compareNumbers(a, b, direction = 'desc') {
  const left = a ?? (direction === 'desc' ? -Infinity : Infinity);
  const right = b ?? (direction === 'desc' ? -Infinity : Infinity);
  if (left === right) return 0;
  return (left < right ? -1 : 1) * (direction === 'desc' ? -1 : 1);
}

/** 总分榜：总分 → 年级名次（越小越好）→ 成就数 → 时间（早的在前）。 */
function compareScore(a, b) {
  return (
    compareNumbers(a.score, b.score, 'desc') ||
    compareNumbers(a.rank, b.rank, 'asc') ||
    compareNumbers(a.achievements, b.achievements, 'desc') ||
    String(a.at).localeCompare(String(b.at))
  );
}

/** 收集榜：结局收集数 → 成就收录数 → 总分 → 时间。 */
function compareCollection(a, b) {
  return (
    compareNumbers(a.endings, b.endings, 'desc') ||
    compareNumbers(a.achievements, b.achievements, 'desc') ||
    compareNumbers(a.score, b.score, 'desc') ||
    String(a.at).localeCompare(String(b.at))
  );
}

export function comparatorFor(metricKey) {
  return metricKey === 'collection' ? compareCollection : compareScore;
}

/** 同一个昵称只留最好的一条——不然一个人打十局就把榜单刷满了。 */
export function bestPerNickname(entries, metricKey = 'score') {
  const compare = comparatorFor(metricKey);
  const best = new Map();
  for (const raw of entries ?? []) {
    const entry = normalizeEntry(raw);
    const key = entry.nickname.toLowerCase();
    const current = best.get(key);
    if (!current || compare(entry, current) < 0) best.set(key, entry);
  }
  return [...best.values()];
}

/**
 * 并列判定用的"成绩指纹"：只看这个榜关心的那几项，**不含提交时间**。
 *
 * 两个人总分、名次、成就都一样，就该并列——不能因为一条是 10:00:01、另一条是 10:00:02
 * 就分出先后（那样同一份成绩在不同毫秒提交会得到不同名次，测试也会跟着时好时坏）。
 * 时间只用来在完全同档时给排序一个稳定次序。
 */
function tieKey(entry, metricKey) {
  return metricKey === 'collection'
    ? `${entry.endings}|${entry.achievements}|${entry.score ?? ''}`
    : `${entry.score ?? ''}|${entry.rank ?? ''}|${entry.achievements}`;
}

/**
 * 排序 + 并列名次。
 * 名次规则：成绩指纹相同就是并列（同名次），下一位按真实条数继续（1,1,3）。
 */
export function rankEntries(entries, metricKey = 'score', { dedupe = true, limit = MAX_FETCH_ENTRIES } = {}) {
  const compare = comparatorFor(metricKey);
  const list = (dedupe ? bestPerNickname(entries, metricKey) : (entries ?? []).map(normalizeEntry)).sort(compare);
  const ranked = [];
  let lastPosition = 0;
  for (let index = 0; index < list.length && index < limit; index += 1) {
    const entry = list[index];
    const previous = list[index - 1];
    const next = list[index + 1];
    const key = tieKey(entry, metricKey);
    // 并列 = 和上一条或下一条成绩指纹相同（榜首那一条没有上一条，但它同样该标"并列"）
    const tied = Boolean((previous && tieKey(previous, metricKey) === key) || (next && tieKey(next, metricKey) === key));
    const position = previous && tieKey(previous, metricKey) === key ? lastPosition : index + 1;
    lastPosition = position;
    ranked.push({ ...entry, position, tied });
  }
  return ranked;
}

/** 榜单概览：总人数、并列榜首、我的最好成绩排第几。 */
export function summarizeBoard(entries, metricKey = 'score', nickname = '') {
  const ranked = rankEntries(entries, metricKey);
  const mine = nickname
    ? ranked.find((entry) => entry.nickname.toLowerCase() === normalizeNickname(nickname).toLowerCase()) ?? null
    : null;
  return { total: ranked.length, top: ranked.slice(0, 3), mine, metric: metricKey };
}

/**
 * 可复核文案：把种子和构筑写进去，别人照着能跑出同一局。
 * 这是这个项目能给的最高等级"公信力"，比任何客户端算出来的校验和都实在。
 */
export function reproduceText(entry) {
  const value = normalizeEntry(entry);
  const bits = [`《中二野人实验室》${value.nickname}：${value.endingTitle}`];
  if (value.score) bits.push(`高考 ${value.score} 分${value.rank ? `（年级第 ${value.rank} 名）` : ''}`);
  if (value.mode === 'versus') bits.push(`AI 对战${value.rivalLevel ? `（${value.rivalLevel}）` : ''}`);
  if (value.seed) bits.push(`种子 ${value.seed}`);
  if (value.build) bits.push(value.build);
  return bits.join('　·　');
}

/* ------------------------------------------------------------- 后端 */

/**
 * 数据库列名用 snake_case（Postgres 不加引号就折叠成小写，camelCase 会逼着到处写双引号），
 * 前端用 camelCase，两边在这两个函数里对上。
 */
export function toRow(entry) {
  const value = normalizeEntry(entry);
  return {
    nickname: value.nickname,
    score: value.score,
    rank: value.rank,
    ending_id: value.endingId,
    ending_title: value.endingTitle,
    tier: value.tier,
    endings: value.endings,
    achievements: value.achievements,
    runs: value.runs,
    difficulty: value.difficulty,
    mode: value.mode,
    rival_level: value.rivalLevel,
    versus_winner: value.versusWinner,
    seed: value.seed,
    build: value.build,
  };
}

export function fromRow(row = {}) {
  return normalizeEntry({
    nickname: row.nickname,
    score: row.score,
    rank: row.rank,
    endingId: row.ending_id,
    endingTitle: row.ending_title,
    tier: row.tier,
    endings: row.endings,
    achievements: row.achievements,
    runs: row.runs,
    difficulty: row.difficulty,
    mode: row.mode,
    rivalLevel: row.rival_level,
    versusWinner: row.versus_winner,
    seed: row.seed,
    build: row.build,
    at: row.created_at ?? row.at,
  });
}

/**
 * 后端配置解析。
 *
 * v3.2 起配置是**后端中立**的：`backend: { type, url, apiKey, table }`。
 * 旧的 `supabase: { url, anonKey, table }` 继续认（老配置、老存档页不用改）。
 *
 * 为什么要有 type：两种后端对外都暴露同一套 REST 形状（`/rest/v1/<表>`、`apikey` 头、snake_case 列名），
 * 所以前端代码完全一样；type 只是给人和日志看的（Supabase = 有 RLS 兜底，d1 = 约束在 Worker 里）。
 */
export function resolveBackend(config) {
  const raw = config?.backend ?? config?.supabase ?? {};
  const table = String(raw.table ?? 'leaderboard').trim();
  return {
    type: raw.type === 'd1' ? 'd1' : 'supabase',
    url: String(raw.url ?? '').trim(),
    // anonKey 是 Supabase 的叫法；apiKey 是中立叫法（D1 版就是一个你自己定的口令）
    apiKey: String(raw.apiKey ?? raw.anonKey ?? '').trim(),
    table: /^[A-Za-z_][A-Za-z0-9_]*$/.test(table) ? table : 'leaderboard',
  };
}

/** 没配置后端时，一切都要能降级（离线优先） */
export function isConfigured(config) {
  const backend = resolveBackend(config);
  return Boolean(backend.url && backend.apiKey);
}

export function emptyConfig() {
  return { format: LEADERBOARD_FORMAT, backend: { type: 'supabase', url: '', apiKey: '', table: 'leaderboard' } };
}

function endpoint(config, query = '') {
  const backend = resolveBackend(config);
  const base = backend.url.replace(/\/+$/, '');
  return `${base}/rest/v1/${encodeURIComponent(backend.table)}${query}`;
}

function headers(config, extra = {}) {
  const backend = resolveBackend(config);
  return {
    // 两种后端都认这两个头：Supabase 用它们做 RLS 鉴权，D1 版用它当一个"共享口令"
    apikey: backend.apiKey,
    authorization: `Bearer ${backend.apiKey}`,
    'content-type': 'application/json',
    ...extra,
  };
}

/**
 * 读榜单。
 *
 * 只 select 需要的列，按"分高的先来"排，拉回来再按昵称去重——
 * 去重放在客户端是因为"同一个人只留最好的一条"这条规则要跟着榜单指标变
 * （总分榜留最高分，收集榜留最多图鉴），放 SQL 里得写两个视图。
 */
export async function fetchBoard(config, { metric = 'score', limit = MAX_FETCH_ENTRIES, fetchImpl = globalThis.fetch, signal } = {}) {
  if (!isConfigured(config)) return { ok: false, reason: 'unconfigured', entries: [] };
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no-fetch', entries: [] };

  const order = metric === 'collection' ? 'endings.desc,achievements.desc,score.desc' : 'score.desc,rank.asc,achievements.desc';
  const query = `?select=*&order=${order},created_at.asc&limit=${Math.min(limit, MAX_FETCH_ENTRIES)}`;
  try {
    const response = await fetchImpl(endpoint(config, query), { headers: headers(config), signal });
    if (!response.ok) return { ok: false, reason: `http-${response.status}`, entries: [] };
    const rows = await response.json();
    const entries = (Array.isArray(rows) ? rows : []).map(fromRow);
    return { ok: true, entries: rankEntries(entries, metric) };
  } catch (error) {
    return { ok: false, reason: 'unreachable', error, entries: [] };
  }
}

/** 提交一条成绩。成功后回执就是 Supabase 的 201。 */
export async function submitEntry(config, entry, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (!isConfigured(config)) return { ok: false, reason: 'unconfigured' };
  const checked = validateEntry(entry);
  if (!checked.ok) return { ok: false, reason: 'invalid', errors: checked.errors };
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no-fetch' };

  try {
    const response = await fetchImpl(endpoint(config), {
      method: 'POST',
      headers: headers(config, { prefer: 'return=minimal' }),
      body: JSON.stringify(toRow(checked.entry)),
      signal,
    });
    if (!response.ok) {
      let detail = '';
      try {
        detail = JSON.stringify(await response.json());
      } catch {
        detail = '';
      }
      return { ok: false, reason: `http-${response.status}`, detail };
    }
    return { ok: true, entry: checked.entry };
  } catch (error) {
    return { ok: false, reason: 'unreachable', error };
  }
}
