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
