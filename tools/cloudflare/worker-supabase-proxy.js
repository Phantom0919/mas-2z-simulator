/**
 * 中二野人实验室 · 排行榜代理（Cloudflare Worker）
 *
 * 为什么需要它：
 *   `*.supabase.co` 挂在 Cloudflare 上，部分国内网络会**按 SNI 阻断**（TCP 通、TLS 握手被重置）。
 *   把请求从"你自己的域名"转发到 Supabase，浏览器看到的 SNI 就是你自己的域名，这个坑就绕开了。
 *
 * 部署（详见同目录 README.md）：
 *   Cloudflare Dashboard → Workers & Pages → Create Worker → 贴这份代码 →
 *   Settings → Variables 里配 UPSTREAM / TABLE（ANON_KEY 可选）→ 绑定自定义域名。
 *
 * 安全边界（这是个公开端点，必须白名单化）：
 *   - 只允许 GET / POST / OPTIONS；
 *   - 只允许转发到 `/rest/v1/<table>` 这一个前缀，别的路径一律 403；
 *   - 前端的 apikey / authorization 原样透传；没带就用环境变量里的（Worker 自己也不放大权限，
 *     它能做的只是"转发"，真正的门禁仍然是 Supabase 的 RLS）。
 */

const ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'];

/** 前端和 Supabase 都认这几个头；`*` 是因为发布页/游戏/APK 三个来源都可能来。 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey,authorization,content-type,prefer,x-client-info',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });

export default {
  async fetch(request, env = {}) {
    const table = String(env.TABLE ?? 'leaderboard');
    const prefix = `/rest/v1/${table}`;
    const url = new URL(request.url);

    if (!ALLOWED_METHODS.includes(request.method)) {
      return json({ message: `这个代理只转发 ${ALLOWED_METHODS.join(' / ')}` }, 405);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      // 白名单：代理不是开放中继，只认榜单这一个前缀。
      // 注意必须是"路径段"匹配而不是 startsWith——否则 /rest/v1/leaderboard_evil 也会被放过去。
      return json({ message: `只允许 ${prefix}` }, 403);
    }
    if (!env.UPSTREAM) {
      return json({ message: 'Worker 没配 UPSTREAM（Supabase 项目地址）' }, 500);
    }

    const target = new URL(url.pathname + url.search, String(env.UPSTREAM).replace(/\/+$/, ''));

    // 透传客户端的 key；没带就退回环境变量里的（anon key 本来就是公开的，两边都行）
    const apikey = request.headers.get('apikey') ?? env.ANON_KEY ?? '';
    const headers = new Headers({ 'content-type': 'application/json' });
    if (apikey) {
      headers.set('apikey', apikey);
      headers.set('authorization', request.headers.get('authorization') ?? `Bearer ${apikey}`);
    }
    headers.set('prefer', request.headers.get('prefer') ?? 'return=minimal');

    try {
      const upstream = await fetch(target.toString(), {
        method: request.method,
        headers,
        body: request.method === 'POST' ? await request.text() : undefined,
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
          ...CORS_HEADERS,
        },
      });
    } catch (error) {
      // 上游连不上时给一个明确的 502，前端会当成"读不到"降级成本机榜
      return json({ message: `转发失败：${String(error?.message ?? error)}` }, 502);
    }
  },
};
