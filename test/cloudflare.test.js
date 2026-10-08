/**
 * Cloudflare 代理测试（v3.1）。
 *
 * 这是个**公开端点**：全世界都能打它，所以边界必须钉死——
 * 只转发 GET/POST、只认 `/rest/v1/<table>` 前缀、OPTIONS 要能预检、
 * 前端的 apikey 要透传、上游挂了要回 502（前端会据此降级成本机榜）。
 *
 * 测法：直接 import 这份 Worker 模块，把 globalThis.fetch 换成假的"Supabase"，
 * 然后像 Cloudflare 那样调 worker.fetch(request, env)——不需要 wrangler、不需要联网。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import worker from '../tools/cloudflare/worker-supabase-proxy.js';
import d1worker from '../tools/cloudflare/worker-d1-leaderboard.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const ENV = { UPSTREAM: 'https://demo.supabase.co', TABLE: 'leaderboard', ANON_KEY: 'env-key' };

/** 把上游换成一个记录调用的假 fetch */
function withUpstream(handler, run) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  try {
    return run(calls);
  } finally {
    globalThis.fetch = saved;
  }
}

const upstreamOk = (body = '[]', status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });

test('只转发 GET / POST / OPTIONS，别的直接 405', async () => {
  for (const method of ['PUT', 'PATCH', 'DELETE', 'HEAD']) {
    const response = await worker.fetch(new Request('https://api.example.com/rest/v1/leaderboard', { method }), ENV);
    assert.equal(response.status, 405, `${method} 应该被拒`);
  }
});

test('预检请求（OPTIONS）要回 CORS 头，而且不碰上游', async () => {
  await withUpstream(
    () => upstreamOk(),
    async (calls) => {
      const response = await worker.fetch(
        new Request('https://api.example.com/rest/v1/leaderboard', { method: 'OPTIONS' }),
        ENV,
      );
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      assert.match(response.headers.get('access-control-allow-methods'), /GET,POST/);
      assert.equal(calls.length, 0, '预检不该打到 Supabase');
    },
  );
});

test('白名单：只有 /rest/v1/<table> 前缀能过，别的路径 403', async () => {
  await withUpstream(
    () => upstreamOk(),
    async (calls) => {
      for (const path of ['/', '/rest/v1/other_table', '/rest/v1/leaderboard_evil', '/auth/v1/token', '/storage/v1/object']) {
        const response = await worker.fetch(new Request(`https://api.example.com${path}`), ENV);
        assert.equal(response.status, 403, `${path} 不该被转发`);
      }
      assert.equal(calls.length, 0, '代理不是开放中继：一次都不该打上游');
    },
  );
});

test('转发：URL / 查询串 / apikey / prefer 都要原样带过去', async () => {
  await withUpstream(
    () => upstreamOk('[{"nickname":"甲"}]'),
    async (calls) => {
      const response = await worker.fetch(
        new Request('https://api.example.com/rest/v1/leaderboard?select=*&limit=5', {
          headers: { apikey: 'client-key', prefer: 'return=representation' },
        }),
        ENV,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), [{ nickname: '甲' }]);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://demo.supabase.co/rest/v1/leaderboard?select=*&limit=5');
      assert.equal(calls[0].init.headers.get('apikey'), 'client-key', '客户端带的 key 要透传');
      assert.equal(calls[0].init.headers.get('authorization'), 'Bearer client-key');
      assert.equal(calls[0].init.headers.get('prefer'), 'return=representation');
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
    },
  );
});

test('客户端没带 key 时用环境变量里的', async () => {
  await withUpstream(
    () => upstreamOk(),
    async (calls) => {
      await worker.fetch(new Request('https://api.example.com/rest/v1/leaderboard'), ENV);
      assert.equal(calls[0].init.headers.get('apikey'), 'env-key');
      assert.equal(calls[0].init.headers.get('authorization'), 'Bearer env-key');
    },
  );
});

test('POST 的 body 原样转发（上榜就是这条路）', async () => {
  await withUpstream(
    () => upstreamOk('', 201),
    async (calls) => {
      const payload = JSON.stringify({ nickname: '甲', score: 600 });
      const response = await worker.fetch(
        new Request('https://api.example.com/rest/v1/leaderboard', { method: 'POST', body: payload }),
        ENV,
      );
      assert.equal(response.status, 201);
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, payload);
    },
  );
});

test('上游的状态码要透传（RLS 挡住就是 401/403，前端据此提示）', async () => {
  await withUpstream(
    () => upstreamOk('{"message":"permission denied"}', 403),
    async () => {
      const response = await worker.fetch(new Request('https://api.example.com/rest/v1/leaderboard'), ENV);
      assert.equal(response.status, 403);
      assert.match(await response.text(), /permission denied/);
    },
  );
});

test('上游挂了回 502，前端会降级成本机榜（不能把游戏卡住）', async () => {
  await withUpstream(
    () => {
      throw new Error('connect ECONNREFUSED');
    },
    async () => {
      const response = await worker.fetch(new Request('https://api.example.com/rest/v1/leaderboard'), ENV);
      assert.equal(response.status, 502);
      assert.match(await response.text(), /转发失败/);
    },
  );
});

test('没配 UPSTREAM 时明确报错，而不是把请求发到莫名其妙的地方', async () => {
  await withUpstream(
    () => upstreamOk(),
    async (calls) => {
      const response = await worker.fetch(new Request('https://api.example.com/rest/v1/leaderboard'), { TABLE: 'leaderboard' });
      assert.equal(response.status, 500);
      assert.match(await response.text(), /UPSTREAM/);
      assert.equal(calls.length, 0);
    },
  );
});

test('仓库里附了部署说明（别只有代码没有步骤）', () => {
  const readme = readFileSync(join(root, 'tools', 'cloudflare', 'README.md'), 'utf8');
  assert.match(readme, /Workers & Pages/);
  assert.match(readme, /UPSTREAM/);
  assert.match(readme, /自定义域名|Custom Domain/);
  assert.match(readme, /leaderboard\.json/, '要说清前端配置改哪里');
  assert.match(readme, /SNI/);
});

/* --------------------------------------------------- D1 版后端（v3.2） */

/**
 * 一个刚好够用的假 D1：认识 Worker 会发的那四条 SQL 形状。
 *
 * 为什么不用真的 D1：这里要测的是"Worker 有没有把该挡的挡住"，
 * 不是 SQLite 会不会排序——所以假件只实现形状识别 + 内存表，测试就能离线跑。
 */
function fakeD1() {
  const rows = [];
  let nextId = 1;

  const prepare = (sql) => {
    const state = { sql, args: [] };
    const like = (pattern) => pattern.test(state.sql);
    const api = {
      bind(...args) {
        state.args = args;
        return api;
      },
      async all() {
        if (like(/COUNT\(\*\)/i)) {
          const nickname = state.args[0];
          const recent = rows.filter((row) => row.nickname === nickname && Date.now() - row._at < 60_000);
          return { results: [{ n: recent.length }] };
        }
        if (like(/SELECT \* FROM/i)) {
          const limit = Number(state.args[0] ?? 200);
          const sorted = [...rows].sort((a, b) => {
            if (like(/endings DESC/)) return (b.endings ?? 0) - (a.endings ?? 0) || (b.achievements ?? 0) - (a.achievements ?? 0);
            return (b.score ?? -1) - (a.score ?? -1) || (a.rank ?? 9999) - (b.rank ?? 9999);
          });
          return { results: sorted.slice(0, limit) };
        }
        throw new Error(`假 D1 不认识这条 SQL：${state.sql}`);
      },
      async first() {
        if (like(/COUNT\(\*\)/i)) {
          const nickname = state.args[0];
          const recent = rows.filter((row) => row.nickname === nickname && Date.now() - row._at < 60_000);
          return { n: recent.length };
        }
        const nickname = state.args[0];
        return [...rows].reverse().find((row) => row.nickname === nickname) ?? null;
      },
      async run() {
        if (!like(/INSERT INTO/i)) throw new Error(`假 D1 不认识这条写操作：${state.sql}`);
        const columns = state.sql.slice(state.sql.indexOf('(') + 1, state.sql.indexOf(')')).split(',').map((item) => item.trim());
        const row = { id: nextId++, created_at: new Date().toISOString(), _at: Date.now() };
        columns.forEach((column, index) => {
          row[column] = state.args[index] ?? null;
        });
        rows.push(row);
        return { success: true };
      },
    };
    return api;
  };

  return { rows, prepare };
}

const D1_ENV = { DB: null, TABLE: 'leaderboard', API_KEY: 'board-key' };

async function callWorker(workerModule, path, { method = 'GET', body, headers = {}, env } = {}) {
  const request = new Request(`https://api.example.com${path}`, {
    method,
    headers: { apikey: 'board-key', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return workerModule.fetch(request, { ...D1_ENV, ...env });
}

test('D1 后端：只支持 GET / POST / OPTIONS——改和删从设计上就不提供', async () => {
  const db = fakeD1();
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const response = await callWorker(d1worker, '/rest/v1/leaderboard', { method, env: { DB: db } });
    assert.equal(response.status, 405, `${method} 不该被支持`);
  }
  assert.equal(db.rows.length, 0);
});

test('D1 后端：预检请求回 CORS 且不碰数据库', async () => {
  const db = fakeD1();
  let prepared = 0;
  const spy = { ...db, prepare: (...args) => (prepared++, db.prepare(...args)) };
  const response = await callWorker(d1worker, '/rest/v1/leaderboard', { method: 'OPTIONS', env: { DB: spy } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(prepared, 0);
});

test('D1 后端：路径白名单（按路径段，不是 startsWith）', async () => {
  const db = fakeD1();
  for (const path of ['/', '/rest/v1/other', '/rest/v1/leaderboard_evil', '/auth/v1/token']) {
    const response = await callWorker(d1worker, path, { env: { DB: db } });
    assert.equal(response.status, 403, `${path} 不该被处理`);
  }
});

test('D1 后端：没绑 DB 或 apikey 不对都要明确报错', async () => {
  const noDb = await callWorker(d1worker, '/rest/v1/leaderboard', { env: { DB: null } });
  assert.equal(noDb.status, 500);
  assert.match(await noDb.text(), /D1/);

  const db = fakeD1();
  const wrongKey = await callWorker(d1worker, '/rest/v1/leaderboard', { env: { DB: db }, headers: { apikey: 'nope' } });
  assert.equal(wrongKey.status, 401);
  const rightKey = await callWorker(d1worker, '/rest/v1/leaderboard', { env: { DB: db } });
  assert.equal(rightKey.status, 200);
});

test('D1 后端：POST 上榜 → 真的进库，字段完整且是 snake_case', async () => {
  const db = fakeD1();
  const response = await callWorker(d1worker, '/rest/v1/leaderboard', {
    method: 'POST',
    env: { DB: db },
    body: {
      nickname: '小明',
      score: 612,
      rank: 147,
      ending_id: 'tier211',
      ending_title: '211 也很好',
      endings: 7,
      achievements: 21,
      difficulty: 'hard',
      mode: 'versus',
      rival_level: 'hard',
      versus_winner: 'you',
      seed: 'abc',
      build: '物理类',
    },
  });
  assert.equal(response.status, 201);
  assert.equal(db.rows.length, 1);
  const row = db.rows[0];
  assert.equal(row.nickname, '小明');
  assert.equal(row.score, 612);
  assert.equal(row.rank, 147);
  assert.equal(row.rival_level, 'hard');
  assert.equal(row.versus_winner, 'you');
  assert.ok(row.created_at, '要自己带上创建时间');
});

test('D1 后端：服务端校验拦住脏数据（这里没有 RLS，全靠这层）', async () => {
  const db = fakeD1();
  const bad = [
    [{}, /昵称/],
    [{ nickname: '  ', ending_title: 'x' }, /昵称/],
    [{ nickname: '一'.repeat(17), ending_title: 'x' }, /16/],
    [{ nickname: '甲', ending_title: '' }, /ending_title/],
    [{ nickname: '甲', ending_title: 'x', score: 9999 }, /score/],
    [{ nickname: '甲', ending_title: 'x', score: -1 }, /score/],
    [{ nickname: '甲', ending_title: 'x', rank: 0 }, /rank/],
    [{ nickname: '甲', ending_title: 'x', rank: 1001 }, /rank/],
    [{ nickname: '甲', ending_title: 'x', endings: -1 }, /endings/],
    [{ nickname: '甲', ending_title: 'x', achievements: 501 }, /achievements/],
    [{ nickname: '甲', ending_title: 'x', runs: 1e9 }, /runs/],
  ];
  for (const [body, pattern] of bad) {
    const response = await callWorker(d1worker, '/rest/v1/leaderboard', { method: 'POST', env: { DB: db }, body });
    assert.equal(response.status, 400, `${JSON.stringify(body)} 应该被拒`);
    assert.match((await response.json()).message, pattern);
  }
  assert.equal(db.rows.length, 0, '一条脏数据都不该进库');

  const notJson = await callWorker(d1worker, '/rest/v1/leaderboard', { method: 'POST', env: { DB: db }, body: '不是 json' });
  assert.equal(notJson.status, 400);
});

test('D1 后端：枚举值一律归一到白名单内，solo 不允许带对战字段', async () => {
  const db = fakeD1();
  await callWorker(d1worker, '/rest/v1/leaderboard', {
    method: 'POST',
    env: { DB: db },
    body: { nickname: '甲', ending_title: '甲结局', mode: 'chaos', difficulty: 'nightmare', rival_level: 'real', versus_winner: 'you' },
  });
  const row = db.rows[0];
  assert.equal(row.mode, 'solo');
  assert.equal(row.difficulty, 'normal');
  assert.equal(row.rival_level, null, '单人局不该留对手字段');
  assert.equal(row.versus_winner, null);
});

test('D1 后端：同一昵称 60 秒内只能提交一条（防刷屏）', async () => {
  const db = fakeD1();
  const payload = { nickname: '刷屏怪', ending_title: '结局', score: 500 };
  const first = await callWorker(d1worker, '/rest/v1/leaderboard', { method: 'POST', env: { DB: db }, body: payload });
  assert.equal(first.status, 201);
  const second = await callWorker(d1worker, '/rest/v1/leaderboard', { method: 'POST', env: { DB: db }, body: payload });
  assert.equal(second.status, 429);
  assert.equal(db.rows.length, 1);

  // 换个昵称不受影响
  const other = await callWorker(d1worker, '/rest/v1/leaderboard', {
    method: 'POST',
    env: { DB: db },
    body: { ...payload, nickname: '别人' },
  });
  assert.equal(other.status, 201);
});

test('D1 后端：GET 支持 limit，order 参数走白名单（注入也只落回默认排序）', async () => {
  const db = fakeD1();
  for (const [nickname, score, endings] of [
    ['甲', 700, 3],
    ['乙', 500, 19],
    ['丙', 600, 8],
  ]) {
    await callWorker(d1worker, '/rest/v1/leaderboard', {
      method: 'POST',
      env: { DB: db },
      body: { nickname, ending_title: `${nickname}的结局`, score, endings },
    });
  }

  const all = await (await callWorker(d1worker, '/rest/v1/leaderboard?select=*&limit=2', { env: { DB: db } })).json();
  assert.equal(all.length, 2, 'limit 要生效');
  assert.equal(all[0].nickname, '甲', '默认按分数降序');

  const byCollection = await (
    await callWorker(d1worker, '/rest/v1/leaderboard?order=endings.desc,achievements.desc&limit=1', { env: { DB: db } })
  ).json();
  assert.equal(byCollection[0].nickname, '乙', '收集榜要按图鉴数排');

  // 注入尝试：order 里塞 SQL 也不会被拼进去
  const injected = await callWorker(d1worker, '/rest/v1/leaderboard?order=score.desc;DROP%20TABLE%20leaderboard', { env: { DB: db } });
  assert.equal(injected.status, 200);
  const rows = await injected.json();
  assert.equal(rows[0].nickname, '甲', '非法 order 落回默认排序');
  assert.equal(db.rows.length, 3, '表还在');
});

test('D1 后端：prefer=return=representation 时把刚插入的行回给客户端', async () => {
  const db = fakeD1();
  const response = await callWorker(d1worker, '/rest/v1/leaderboard', {
    method: 'POST',
    env: { DB: db },
    headers: { prefer: 'return=representation' },
    body: { nickname: '甲', ending_title: '甲结局', score: 601 },
  });
  assert.equal(response.status, 201);
  const row = await response.json();
  assert.equal(row.nickname, '甲');
  assert.equal(row.score, 601);
});

test('D1 后端：客户端（src/leaderboard.js）读它、写它、排序都对', async () => {
  const db = fakeD1();
  const { fetchBoard, submitEntry, entryFromRun, isConfigured } = await import('../src/leaderboard.js');
  const config = { format: 2, backend: { type: 'd1', url: 'https://api.example.com', apiKey: 'board-key', table: 'leaderboard' } };
  assert.equal(isConfigured(config), true);

  const view = {
    mode: 'versus',
    seed: 'd1-seed',
    difficulty: { key: 'hard' },
    selection: { label: '物理类' },
    build: { traits: [{ name: '过目不忘' }], goal: { name: '稳上一本' } },
    ending: { id: 'tier211', title: '211 也很好', total: 620, rank: 130, tier: '211', achievements: [] },
    versus: { active: true, level: { key: 'hard' }, winner: 'you' },
  };
  const entry = entryFromRun({ nickname: 'D1 测试', view, profile: { runs: 2, unlocked: { a: {} }, achievements: {} } });

  // 把假 D1 当成上游：拦一层 fetch，把 Worker 的响应喂回客户端
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname + new URL(String(url)).search;
    return d1worker.fetch(new Request(`https://api.example.com${path}`, { method: init.method ?? 'GET', headers: init.headers, body: init.body }), {
      ...D1_ENV,
      DB: db,
    });
  };
  try {
    const written = await submitEntry(config, entry);
    assert.equal(written.ok, true, `写入失败：${written.reason}`);
    const board = await fetchBoard(config, { metric: 'score' });
    assert.equal(board.ok, true);
    assert.equal(board.entries.length, 1);
    assert.equal(board.entries[0].nickname, 'D1 测试');
    assert.equal(board.entries[0].score, 620);
    assert.equal(board.entries[0].mode, 'versus');
    assert.equal(board.entries[0].rivalLevel, 'hard');
  } finally {
    globalThis.fetch = savedFetch;
  }
});

