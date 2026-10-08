# 用 Cloudflare 给排行榜套一层自己的域名

## 为什么需要这一步

排行榜后端是 Supabase（`*.supabase.co`，挂在 Cloudflare 上）。**部分国内网络会按 SNI 阻断它**：
TCP 443 能连上，但 TLS 握手被重置——本项目的开发机实测就是这种情况
（`curl: (35) Recv failure: Connection was reset`）。

把请求从**你自己的域名**转发到 Supabase，浏览器看到的 SNI 就是你的域名，这个坑就绕开了。
顺带的好处：以后想换后端（D1 / 国内服务器）只改 Worker，前端一个字都不用动。

> 前提：**你得有一个域名。** Cloudflare 免费版要求把域名的 NS 指到 Cloudflare；
> 用 Cloudflare 送的 `*.workers.dev` 子域在国内同样经常打不开，等于没解决问题。
> 没有域名的话，这条路走不通——那要么买一个（几十块一年），要么换国内后端。

## 步骤（大约 10 分钟，全在网页上点）

### 1. 域名接进 Cloudflare

1. https://dash.cloudflare.com 注册 / 登录 → **Add a site** → 填你的域名 → 选 **Free** 计划
2. Cloudflare 会给你两条 NS（比如 `ada.ns.cloudflare.com`）→ 去你的域名注册商那里把 NS 改成这两条
3. 等生效（几分钟到几小时），Cloudflare 里那个域名变成 **Active**

### 2. 建 Worker

1. 左侧 **Workers & Pages → Create → Workers → Create Worker**，名字随便（例如 `mas2z-leaderboard`）
2. 点 **Edit code**，把 [`worker-supabase-proxy.js`](./worker-supabase-proxy.js) **整个文件**贴进去 → **Deploy**
3. 回到这个 Worker → **Settings → Variables and Secrets**，加两个普通变量：

   | 变量 | 值 | 说明 |
   | --- | --- | --- |
   | `UPSTREAM` | `https://unlqwtambyxhzjbmtjgw.supabase.co` | 你的 Supabase 项目地址（别带结尾斜杠） |
   | `TABLE` | `leaderboard` | 表名 |

   （可选）再加 `ANON_KEY` = 你的 anon key：前端要是没带 key，Worker 就用这个。
   anon key 本来就是公开的，加不加都行——**真正的门禁始终是 Supabase 的 RLS**。

   加完再点一次 **Deploy**（改环境变量后必须重新部署才生效）。

### 3. 绑一个自己的域名

1. 在这个 Worker 的 **Settings → Domains & Routes → Add → Custom Domain**
2. 填一个子域，例如 `api.你的域名.com`（Cloudflare 会自己加 DNS 记录，不用手动配）
3. 等状态变成 **Active**（一般 1～2 分钟）

> 也可以用 **Route**（`api.你的域名.com/*`）——效果一样，Custom Domain 更省事。

### 4. 前端改一行配置

把 [`web/content/leaderboard.json`](../../web/content/leaderboard.json) 的 `url` 换成你的域名，`anonKey` 保留原样：

```json
{
  "format": 1,
  "supabase": {
    "url": "https://api.你的域名.com",
    "anonKey": "eyJhbGciOiJIUzI1NiIs...(原样保留)",
    "table": "leaderboard"
  }
}
```

然后：

```bash
npm run pages && npm run apk     # 重新生成发布页与 APK
git add -A && git commit -m "排行榜走后端代理域名" && git push
```

**为什么不用改别的**：Worker 模仿的就是 Supabase 的 REST 形状（`/rest/v1/leaderboard`，
`apikey` 头、snake_case 列名），前端的 `src/leaderboard.js` 完全不知道中间多了一跳。

### 5. 验证

```bash
node tools/check-leaderboard.mjs      # 会把配置里的 url 换成代理域名后再跑
```

期望：读 OK → 写 OK → **改失败** → **删失败** → 再读能看到「自检员」。
如果读就失败，先用浏览器直接打开 `https://api.你的域名.com/rest/v1/leaderboard?select=*&limit=1`
看看返回什么：`403 只允许 ...` 说明 `TABLE` 配错了；`500 没配 UPSTREAM` 说明变量没加或忘了重新 Deploy。

## 这个代理的安全边界

- 只转发 `GET / POST / OPTIONS`；
- 只允许 `/rest/v1/<你的表名>` 这一个前缀，其他路径一律 403（**它不是开放中继**）；
- 透传前端的 `apikey` / `authorization`，自己不放大任何权限；
- 上游挂了回 502，前端据此降级成本机榜（离线优先）。

这些边界都有测试盯着（`test/cloudflare.test.js`，9 条，用假上游跑，不需要联网、不需要 wrangler）。

## 另一个选择：干脆不用 Supabase

Cloudflare **Workers + D1**（免费额度：每天 10 万次请求、5GB 存储）可以直接当排行榜后端，
连 Supabase 账号都不用。做法是另写一个 Worker，用 D1 存同样的列、对外暴露同样的
`/rest/v1/leaderboard` 形状——前端配置同样只改 `url`。
好处是少一个第三方、数据在自己的 Cloudflare 账号里；代价是那个 Worker 要自己实现
"只能读和插，不能改和删"（Supabase 那边是 RLS 帮你兜着）。
需要的话说一声，我把那个 Worker + 建表 SQL 也写出来。

## 国内可用性的一点实话

Cloudflare 免费版在国内属于"**时通时慢**"：能打开的占多数，但延迟高（150～400ms 很常见），
偶尔抽风。自定义域名能解决"被精确阻断"的问题，但不能保证"任何时候都快"。
如果排行榜对你是核心功能，最稳的仍然是**国内后端**（腾讯云开发 / 一台国内小服务器 + 备案域名）——
接口已经抽象在 `src/leaderboard.js` 的 `fetchBoard` / `submitEntry` 两个函数里，换后端只改这一处。
