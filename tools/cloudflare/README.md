# Cloudflare 排行榜后端：两条路，选一条

排行榜需要一个"能写的地方"。GitHub Pages 是纯静态的，所以后端要么是第三方，要么是自己搭。
这里给两种都在 **Cloudflare 免费额度**内的做法，**对外形状完全一样**
（`GET/POST /rest/v1/<表名>`、`apikey` 头、snake_case 列名），所以前端只改
[`web/content/leaderboard.json`](../../web/content/leaderboard.json) 里的一处 `url`，
`src/leaderboard.js` 一个字都不用动。

| | A. Worker + D1（**推荐**） | B. Worker 反向代理 Supabase |
| --- | --- | --- |
| 数据存哪 | 你自己的 Cloudflare D1（SQLite） | 原来的 Supabase Postgres |
| 额外账号 | 只用 Cloudflare | Cloudflare + Supabase |
| "只能读和插"靠谁 | **Worker 里手写校验**（这文件里就是） | Supabase 的 RLS |
| 代码 | [`worker-d1-leaderboard.js`](./worker-d1-leaderboard.js) + [`d1-schema.sql`](./d1-schema.sql) | [`worker-supabase-proxy.js`](./worker-supabase-proxy.js) |
| 适合 | 想少一个第三方、数据自己拿着 | 已经有一堆数据在 Supabase 里 |

两条路都要**一个自己的域名**才能解决国内访问（原因见最后一节）；用 Cloudflare 的
`*.workers.dev` 能跑起来，但在国内经常打不开。

---

## 路线 A：Worker + D1（推荐）

### 1. 建库

网页版：**Workers & Pages → D1 SQL Database → Create** → 名字填 `mas2z-leaderboard` → 创建。
建好之后 → **Console** → 把 [`d1-schema.sql`](./d1-schema.sql) 整个粘进去 → Run。

命令行版（如果本机装了 Node）：

```bash
npm i -g wrangler
wrangler login
wrangler d1 create mas2z-leaderboard
# 把返回的 database_id 填进 wrangler.toml，然后：
wrangler d1 execute mas2z-leaderboard --remote --file tools/cloudflare/d1-schema.sql
```

### 2. 建 Worker

**Workers & Pages → Create → Workers → Create Worker** → 名字 `mas2z-leaderboard` →
**Edit code** → 把 [`worker-d1-leaderboard.js`](./worker-d1-leaderboard.js) 整个贴进去 → **Deploy**。

### 3. 绑 D1 + 配口令

在 Worker 的 **Settings** 里：

1. **Bindings → Add → D1 database**：变量名 **`DB`**（必须叫这个），选刚建的 `mas2z-leaderboard`；
2. **Variables and Secrets** 加两个：

   | 变量 | 值 | 说明 |
   | --- | --- | --- |
   | `TABLE` | `leaderboard` | 表名（要和 SQL 里一致） |
   | `API_KEY` | 随便定一串，例如 `mas2z-2026` | 共享口令，前端配置里要填一样的 |

   加完**必须重新 Deploy** 才生效。

> `API_KEY` 不是安全边界（它就写在网页里），它的作用只是把"随手扫端点的人"挡在外面。
> 真正的约束在 Worker 代码里：只允许 GET/POST、字段范围校验、同一昵称 60 秒一条。

### 4. 绑自己的域名（解决国内访问）

Worker → **Settings → Domains & Routes → Add → Custom Domain** → 填 `api.你的域名.com`
（需要先把域名接进 Cloudflare：Add a site → 改成 Cloudflare 给的 NS → 等 Active）→ 等状态变 Active。

### 5. 改前端配置

[`web/content/leaderboard.json`](../../web/content/leaderboard.json) 换成新形状：

```json
{
  "format": 1,
  "backend": {
    "type": "d1",
    "url": "https://api.你的域名.com",
    "apiKey": "mas2z-2026",
    "table": "leaderboard"
  },
  "note": "排行榜后端（Cloudflare Worker + D1）。留空 = 只有本机榜。"
}
```

（旧的 `supabase: { url, anonKey }` 形状继续认，不用急着改。）

然后重出产物并推送：

```bash
npm run pages && npm run apk
git add -A && git commit -m "排行榜切到 Cloudflare D1" && git push
node tools/check-leaderboard.mjs      # 自检：读 OK / 写 OK / 改必须失败 / 删必须失败
```

---

## 路线 B：Worker 反向代理 Supabase

适合"数据已经在 Supabase 里"的情况。步骤和 A 类似，差别只在 Worker 内容与变量：

1. **Workers & Pages → Create Worker** → 贴 [`worker-supabase-proxy.js`](./worker-supabase-proxy.js) → Deploy；
2. **Variables**：

   | 变量 | 值 |
   | --- | --- |
   | `UPSTREAM` | `https://<你的项目ref>.supabase.co`（别带结尾斜杠） |
   | `TABLE` | `leaderboard` |
   | `ANON_KEY`（可选） | 你的 anon key：前端没带 key 时用它 |

3. 绑自定义域名 → 把 `leaderboard.json` 的 `url` 换成你的域名（`anonKey` 原样保留）；
4. `npm run pages && npm run apk` → 提交推送。

为什么需要它：`*.supabase.co` 挂在 Cloudflare 上，部分国内网络会**按 SNI 阻断**
（TCP 443 能连上、TLS 握手被重置）——本项目的开发机实测就是这样。
把请求从自己的域名转发过去，浏览器看到的 SNI 就是你的域名，这个坑就绕开了。

代理是**白名单化**的：只转发 `GET/POST/OPTIONS`、只认 `/rest/v1/<你的表名>` 这一个路径段、
上游挂了回 502（前端据此降级成本机榜）。它以 Supabase 的 RLS 为准，自己不放大任何权限。

---

## 两种后端的边界都有测试

```bash
node --test test/cloudflare.test.js    # 21 条，用假上游 / 假 D1 跑，不需要联网、不需要 wrangler
```

覆盖：方法白名单（改和删从设计上就不提供）、路径白名单（`/rest/v1/leaderboard_evil` 也被挡）、
预检不碰上游、apikey 校验、字段范围校验（越界 400，不静默夹取）、枚举归一、
同一昵称 60 秒限流、`order` 参数注入只落回默认排序、上游挂了的 502/500、
以及"客户端 `src/leaderboard.js` 直接对着 D1 后端读写排序"的端到端一条。

写这些测试时抓到两个真问题，都改了：`startsWith` 会把 `/rest/v1/leaderboard_evil` 放过去；
`rank=0` 之前被悄悄夹成 1 而不是拒绝。

---

## 国内可用性的一点实话

Cloudflare 免费版在国内属于"**时通时慢**"：多数时候能打开，延迟高（150～400ms 常见），偶尔抽风。
自定义域名能解决"被精确阻断"，但不能保证"任何时候都快"。
如果排行榜是核心功能，最稳的仍然是国内后端（腾讯云开发 / 一台国内小服务器 + 备案域名）——
接口已经抽象在 `src/leaderboard.js` 的 `fetchBoard` / `submitEntry` 里，换后端只改这一处。
