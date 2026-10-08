/**
 * 中二野人实验室 · 排行榜后端（Cloudflare Worker + D1）
 *
 * 和 Supabase 版**对外形状完全一样**：`GET/POST /rest/v1/<表名>`、`apikey` 头、snake_case 列名。
 * 所以前端只改 web/content/leaderboard.json 里的 url（外加把 anonKey 换成一个你自己定的口令），
 * src/leaderboard.js 一行都不用动。
 *
 * 为什么要有这个版本：
 *   1. 少一个第三方（数据在自己的 Cloudflare 账号里）；
 *   2. `*.supabase.co` 在部分国内网络会被按 SNI 阻断，而 Worker 可以直接绑自己的域名；
 *   3. 免费额度够用：每天 10 万次请求、D1 5GB。
 *
 * 和 Supabase 版的区别（重要）：
 *   Supabase 那边是 RLS 帮我们兜住"只能读和插"；这里**所有的约束都在这个文件里**，
 *   所以下面做了三件事，缺一不可：
 *     · 只允许 GET / POST / OPTIONS（没有 UPDATE / DELETE 分支 = 改不了也删不掉）；
 *     · 入参逐个字段校验（范围 / 长度 / 枚举），脏数据根本进不了库；
 *     · 同一个昵称 60 秒内只收一条 —— 不是防作弊（前端提交本来就防不了），是防刷屏。
 *
 * 部署见同目录 README.md。
 */

const ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'];

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey,authorization,content-type,prefer,x-client-info',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-max-age': '86400',
};

const COLUMNS = [
  'nickname',
  'score',
  'rank',
  'ending_id',
  'ending_title',
  'tier',
  'endings',
  'achievements',
  'runs',
  'difficulty',
  'mode',
  'rival_level',
  'versus_winner',
  'seed',
  'build',
];

const DIFFICULTIES = ['easy', 'normal', 'hard', 'realistic', 'custom'];
const MODES = ['solo', 'versus'];
const RIVAL_LEVELS = ['easy', 'normal', 'hard', 'real'];
const VERSUS_WINNERS = ['you', 'rival', 'tie'];

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
  });

const text = (value, max) => {
  const clean = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, max) : null;
};

const int = (value, min, max, fallback = null) => {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

/**
 * 数值字段：**越界就报错，不做静默夹取**。
 *
 * 一开始写的是"夹到范围内"，结果 rank=0 会被悄悄改成 1——这等于替作弊者擦屁股，
 * 也让"到底收没收到脏数据"变得看不见。公开写入端点宁可 400 让客户端自己改。
 */
function checkNumber(value, min, max, { defaultValue = null } = {}) {
  if (value === null || value === undefined || value === '') return { ok: true, value: defaultValue };
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return { ok: false };
  return { ok: true, value: Math.round(number) };
}

/**
 * 服务端校验：这里没有 RLS，所以这层必须严。
 * @returns {{ ok: true, row: object } | { ok: false, error: string }}
 */
export function validatePayload(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: '请求体必须是一个 JSON 对象' };

  const nickname = text(input.nickname, 16);
  if (!nickname) return { ok: false, error: '昵称不能为空' };
  // 昵称长度按"字符"算（中文一个字算一个），不是 UTF-16 码元
  if ([...String(input.nickname ?? '').trim()].length > 16) return { ok: false, error: '昵称最多 16 个字' };

  const endingTitle = text(input.ending_title, 60);
  if (!endingTitle) return { ok: false, error: 'ending_title 不能为空' };

  const score = checkNumber(input.score, 0, 750);
  if (!score.ok) return { ok: false, error: 'score 必须在 0~750 之间' };
  const rank = checkNumber(input.rank, 1, 1000);
  if (!rank.ok) return { ok: false, error: 'rank 必须在 1~1000 之间' };
  const endings = checkNumber(input.endings, 0, 500, { defaultValue: 0 });
  if (!endings.ok) return { ok: false, error: 'endings 必须在 0~500 之间' };
  const achievements = checkNumber(input.achievements, 0, 500, { defaultValue: 0 });
  if (!achievements.ok) return { ok: false, error: 'achievements 必须在 0~500 之间' };
  const runs = checkNumber(input.runs, 0, 9999, { defaultValue: 0 });
  if (!runs.ok) return { ok: false, error: 'runs 必须在 0~9999 之间' };

  const mode = MODES.includes(input.mode) ? input.mode : 'solo';
  const difficulty = DIFFICULTIES.includes(input.difficulty) ? input.difficulty : 'normal';
  const rivalLevel = RIVAL_LEVELS.includes(input.rival_level) ? input.rival_level : null;
  const versusWinner = VERSUS_WINNERS.includes(input.versus_winner) ? input.versus_winner : null;

  return {
    ok: true,
    row: {
      nickname,
      score: score.value,
      rank: rank.value,
      ending_id: text(input.ending_id, 40),
      ending_title: endingTitle,
      tier: text(input.tier, 20),
      endings: endings.value,
      achievements: achievements.value,
      runs: runs.value,
      difficulty,
      mode,
      rival_level: mode === 'versus' ? rivalLevel : null,
      versus_winner: mode === 'versus' ? versusWinner : null,
      seed: text(input.seed, 40),
      build: text(input.build, 80),
    },
  };
}

/** 把客户端的 order 参数翻译成安全的 SQL 片段（白名单，绝不拼接原始字符串）。 */
export function orderClause(orderParam) {
  const allowed = {
    'score.desc': 'score IS NULL, score DESC, rank ASC, achievements DESC',
    'endings.desc': 'endings DESC, achievements DESC, score IS NULL, score DESC',
  };
  const key = allowed[String(orderParam ?? '').split(',')[0].trim()];
  return key ?? 'score IS NULL, score DESC, rank ASC';
}

export default {
  async fetch(request, env = {}) {
    const table = /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(env.TABLE ?? 'leaderboard')) ? String(env.TABLE ?? 'leaderboard') : 'leaderboard';
    const prefix = `/rest/v1/${table}`;
    const url = new URL(request.url);

    if (!ALLOWED_METHODS.includes(request.method)) {
      // 没有 UPDATE / DELETE 分支：这个后端从设计上就不提供"改"和"删"
      return json({ message: `这个后端只支持 ${ALLOWED_METHODS.join(' / ')}` }, 405);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return json({ message: `只允许 ${prefix}` }, 403);
    }
    if (!env.DB) return json({ message: 'Worker 没绑定 D1（变量名 DB）' }, 500);

    // 共享口令：不是安全边界（它就写在网页里），只是为了挡掉随手扫端点的人
    const expected = String(env.API_KEY ?? '');
    if (expected) {
      const provided = request.headers.get('apikey') ?? (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (provided !== expected) return json({ message: 'apikey 不对' }, 401);
    }

    if (request.method === 'GET') {
      const limit = Math.min(Math.max(int(url.searchParams.get('limit'), 1, 500, 200), 1), 500);
      const order = orderClause(url.searchParams.get('order'));
      // 只 select *：列名是写死的，没有任何拼接进来的东西
      const { results } = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order} LIMIT ?1`).bind(limit).all();
      return json(results ?? []);
    }

    // POST = 上榜
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ message: '请求体不是合法 JSON' }, 400);
    }
    const checked = validatePayload(payload);
    if (!checked.ok) return json({ message: checked.error }, 400);

    // 同一个昵称 60 秒内只收一条（防刷屏；不是防作弊——前端提交本来就防不了作弊）
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ${table} WHERE nickname = ?1 AND created_at > datetime('now', '-60 seconds')`,
    )
      .bind(checked.row.nickname)
      .first();
    if (Number(recent?.n ?? 0) > 0) return json({ message: '同一昵称 60 秒内只能提交一条' }, 429);

    const placeholders = COLUMNS.map((_, index) => `?${index + 1}`).join(', ');
    await env.DB.prepare(`INSERT INTO ${table} (${COLUMNS.join(', ')}) VALUES (${placeholders})`)
      .bind(...COLUMNS.map((column) => checked.row[column]))
      .run();

    const prefer = request.headers.get('prefer') ?? 'return=minimal';
    if (prefer.includes('return=representation')) {
      const inserted = await env.DB.prepare(`SELECT * FROM ${table} WHERE nickname = ?1 ORDER BY id DESC LIMIT 1`)
        .bind(checked.row.nickname)
        .first();
      return json(inserted ?? checked.row, 201);
    }
    return new Response(null, { status: 201, headers: CORS_HEADERS });
  },
};
