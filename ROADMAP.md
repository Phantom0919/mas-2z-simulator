# 发展建议 · ROADMAP

> 对象：中二野人实验室（`package.json` 3.1.0 / `engine.js` `GAME_VERSION` 3.1.0；v3.0 起由「马鞍山二中模拟器」改名）
> 这份文档写于 v2.6 三件事（内容包热更新 / 高考志愿填报 / 因果链事件）正在同时落地的过程中。
> 所有数字都是**当场实测**出来的，不是从 README 抄的。

> ### ✅ 落地后的状态更新（写给先看到这里的人）
> 这份文档的"现状盘点"和"缺口"拍的是**写作当时**的快照。三件事随后全部接线完成，下面的缺口已经消掉：
>
> | 当时记的缺口 | 现在 |
> | --- | --- |
> | `events6` 未接线、校历红灯 | ✅ 已接线（`ALL_EVENTS` 144、随机事件 95、链式后续环 13 不进随机池），8 条链的链图由 `tools/check-events6.mjs` 守着 |
> | 服务端缺 `/api/content*` 与 `/api/volunteer` | ✅ 4 条路由已实现并有接口测试（`test/server.test.js`） |
> | `local-api.js` 缺同样 4 条路由（安卓离线打不完一局） | ✅ 已实现，`android.test.js` 的"离线接口"用例现在会一路打到志愿填报结束 |
> | CLI 遇 `volunteering` 静默退出 | ✅ 交互式志愿填报界面 + `--volunteers` / `--no-volunteers` |
> | `test/content.test.js` 不存在 | ✅ 已交付 52 个测试 |
> | 版本号五处漂移 | ✅ 有了单一真源：`GAME_VERSION === package.json.version` 有测试盯着 |
> | 测试 180 条 / 1 条红 | ✅ **263 条全绿**（新增 `content.test.js` 52 + `volunteer.test.js` 28 + 接口 2） |
>
> **仍然成立的**：R1（内容越多越难平衡）、R2（热更新=作弊与版本碎片）、R3（无签名分发）、
> R4（**项目仍然不是 git 仓库**——这是最值得先做的一条）、R5（四端验证成本）、R7（志愿填报让"分数=结局"失效）。
> 换句话说：**短期建议 S1/S2/S3 已经被这一版顺带做掉了，请从 S4 往下看。**

> ### ✅ v2.7 / v2.8 追加（同上，写给先看到这里的人）
> - **v2.7 落地**：推送（更新清单）——`src/update.js` 纯判定层 + 服务端代拉 + 玩家三选一 + 地址护栏。
> - **v2.8 落地**：官方发布页 `docs/`（GitHub Pages 直接托管）：在线试玩（`play/` + 按 import 图收集的
>   `src/`）、一键下载 APK、腾讯频道入口、关于我们（赞助商）、打包 / 预览 / 素材三个工具，
>   以及 19 条发布页守门测试。发布页**零外链**，所以墙内、断网都能打开。
> - **v2.9 落地**：游戏内的交流入口——顶栏 / 开局那一屏 / 结局页三处打开同一个面板
>   （一键进频道、复制频道链接、分享这一局、关于我们 + 赞助商）；安卓端补上
>   `shouldOverrideUrlLoading`，外链交给系统浏览器而不是把玩家关在 WebView 里。
> - **v3.0 落地**：改名「中二野人实验室」（游戏内校名只写「二中」，产品名不再指向真实学校）+
>   **AI 对战模式**：开局选单人 / AI 对战 + 四档强度，AI 是引擎里真的第二局（同一套规则），
>   每次考试同榜比名次、结局并排比一次。守门测试专门盯"两条时间线必须逐拍对齐"和
>   "AI 不许吃掉玩家的随机数"（同种子的单人局与对战局，玩家轨迹必须完全一致）。
> - **v3.1 落地**：排行榜（总分榜 + 收集榜）。第一次进游戏问昵称（只存本机），结局页一键上榜；
>   后端是 Supabase 免费版，前端只放 anon key，门禁在 RLS（匿名只能读和插）；
>   没配后端就一个请求都不发、断网降级成本机榜——**"离线优先"这条原则没有为了排行榜破例**。
>   顺带补掉一个会白屏的打包漏洞：`app.js` 作为页面入口以前不在模块图里，v3.1 起它 import 了
>   排行榜模块，不把入口补上就会少打包一个文件。
> - **测试**：263 → **360 条全绿**（`npm test`）。
> - **R4 已经不再是问题**：仓库有完整提交历史与 `v2.6.0` / `v2.7.0` / `v2.8.0` / `v2.9.0` 标签。
> - **R2（热更新=作弊与版本碎片）多了一条新注脚**：对战模式下"AI 用的是同一套规则"是卖点，
>   所以内容包改平衡时，玩家和 AI 会同时被改——想拿内容包给自己开后门，AI 也一起受益。
> - **R3 有了缓解办法**：发布页把 SHA-256 打在下载按钮下面，装之前可以自己核一遍。

> 每条建议都带 **P 级**（P0 立刻 / P1 本季 / P2 以后）、**工作量**（S ≤1 天 / M 2~5 天 / L >1 周）、
> **影响面**、**一句话验收标准**。没有"提升代码质量""增加测试覆盖率"这类无法验收的条目。

---

## 1. 现状盘点（实测）

### 1.1 内容量

| 项目 | 实测值 | 怎么量的 |
| --- | --- | --- |
| 非剧情随机事件 | **87** | `import` 后 `ALL_EVENTS.filter(e => !e.story).length`（events 39 + events2 16 + events3 11 + events4 3 + events5 18） |
| 需要做选择的事件 | **61** | 同上过滤 `kind === 'choice'` |
| 选项总数 | **162** | 61 个选择事件的 `choices` 求和 |
| 剧情章节事件 | 36（7 条线） | `storyEvents().length`；`STORY_ARCS` 7 条，章数 5/4/5/5/5/5/7 |
| `ALL_EVENTS` 合计 | **123** | 87 非剧情 + 36 剧情章节 |
| 行动 | **37**（+7 个标签） | `ACTIONS.length` / `ACTION_TAGS.length` |
| 结局 | **29** | `endingCatalog().length`（这一项在一次会话里从 28 涨到 29，志愿填报的"滑档"结局正在加） |
| 成就 | **71** = 54 手写 + 17 校园 | `collectAchievements()` 里 `add()` 调用 54 次 + `events5.js` 的 `CAMPUS_ACHIEVEMENTS` 17 条 |
| 因果链事件（**已落盘、未接线**） | 21 个事件 / 63 个选项 / 8 个成就 / 27 处 `chain:` 声明 | `import('./src/data/events6.js')` → `CHAIN_EVENTS` 21、`CHAIN_ACHIEVEMENTS` 8；`engine.js` 第 69–70、119 行**仍是注释** |
| 学科 / 录取档次 | 9 门（3+1+2）/ 9 档 | `school.js` `SUBJECT_POOL`、`COLLEGE_TIERS` |
| 志愿填报 | 6 格 / 16 个候选专业组 / 24 个专业 | `colleges.js` `VOLUNTEER_SLOTS` 6、`VOLUNTEER_OPTIONS` 16、`MAJORS` 24 |
| 内容包格式 | `PACK_FORMAT = 1`，7 个段落，23 个 `EFF` 键 + 7 个难度键可覆写 | `src/content.js` |

**接线 events6 之后会变成**：非剧情事件 108、选择事件 82、选项 225、`ALL_EVENTS` 144、成就 79。
`calendar.js` 已经有一条红灯（`时间表里没有拼错的 id，也没有自相矛盾的窗口`）——21 个链事件还没有登记校历。

### 1.2 技术栈与四端产物

零运行时依赖的纯 ESM Node.js；引擎 1 份，界面 4 份。`node -v` = **v20.18.0**。

| 端 | 入口 | 规模 | 产物 / 现状 |
| --- | --- | --- | --- |
| CLI | `src/cli.js` | 898 行 | `bin: mas2z`；`--auto` 9 策略、`--gallery`、`--json`、`--endless` |
| 网页 | `src/server.js` 403 行 + `web/` 4,478 行 | `app.js` 1,841 / `style.css` 2,134 / `index.html` 314 | `npm run web`，静态文件 + JSON API + 内存会话 |
| Electron | `electron/main.cjs` 350 行 + preload/menu/window-state | 内嵌 `src/server.js` 随机端口 | 便携 zip 110 MB、NSIS 安装版 78 MB（`dist/desktop` 共 457 MB） |
| 安卓 | `android/.../MainActivity.java` 134 行 + `web/local-api.js` 189 行 | APK 367 KB | `android-sdk` **394 MB 在项目目录里**（已 gitignore）；`dist/` 里躺着 2.4.0 与 2.5.0 两个 APK |

引擎 `src/engine.js` 现在 **2,941 行**（本会话内从 2,361 涨上来），导出 70 个符号，同时装着回合、考试、NPC、商店、结局、内容包、志愿填报、因果链——单文件是当前最大的结构性风险（见 4.5）。

### 1.3 测试规模

`node --test test/` 实测：**`# tests 180`，用时约 8 秒**；写这份文档的最后一个快照是 **179 通过 / 1 失败**（失败项是上面的校历红灯）。
静态数 `test()` 调用共 **202 个**、分布在 8 个文件里：

| 文件 | 测试数 | 文件 | 测试数 |
| --- | --- | --- | --- |
| `engine.test.js` | 33 | `electron.test.js` | 24 |
| `cast.test.js` | 43 | `web.test.js` | 21 |
| `calendar.test.js` | 17 | `android.test.js` | 19 |
| `custom.test.js` | 30 | `server.test.js` | 15 |

`test/content.test.js`（`src/content.js` 注释里点名的那份）**还不存在**。

### 1.4 本次三件事落在哪了

| 三件事 | 引擎 | 网页前端 | 服务端 API | 安卓离线 | CLI | 工具链 |
| --- | --- | --- | --- | --- | --- | --- |
| 内容包热更新（`content.js` 361 行 + `applyContentPack`） | ✅ | ✅ 面板/粘贴/文件/URL | ❌ 4 条路由都没实现 | ❌ `local-api.js` 无 `/api/content*` | ❌ 无任何支持 | ❌ `check-events5.mjs` 只认 events5 |
| 志愿填报（`colleges.js` 245 行 + `status: 'volunteering'`） | ✅ | ✅ 6 格/冲稳保/服从调剂 | ❌ 无 `/api/volunteer` | ❌ 无 `/api/volunteer` | ❌ 交互循环遇 `volunteering` 直接退出 | — |
| 因果链（`armChain` / `pendingChains` / `chainOnly`） | ✅ 机制就绪 | — | — | — | — | ❌ 21 事件未接线、未登记校历、无链图工具 |

### 1.5 六个已经量出来的缺口（后面建议的输入）

1. **服务端 14 条路由，缺 5 条**：`/api/content`、`/api/content/apply`、`/api/content/reset`、`/api/volunteer`，而 `web/app.js` 已经在调它们——网页版这两个面板现在是"点了没反应"。
2. **安卓是第二套接口实现**：`local-api.js` 只有 13 条路由，和服务端**已经分叉**；快照期红灯 `离线接口：可以一路打到结局` 就是这个分叉的直接后果。
3. **CLI 走不到新结局**：`runInteractive` 是 `while (game.status === 'playing')`，末尾只 `if (game.status === 'ended') renderEnding(game)`；交互模式打到高考出分后会**静默停在 `volunteering`**，既不提示也不能填志愿。
4. **版本号五处漂移**：`package.json` 2.5.0、`engine.js` `GAME_VERSION` 2.6.0、README 标题 v2.5、CHANGELOG 最新条 v2.5.0、`dist/` 里 APK 是 2.4.0 与 2.5.0。`engine.js` 第 101 行写着"和 package.json 必须一致（有测试盯着）"——**`test/` 里没有任何测试引用 `GAME_VERSION`**，这句承诺是空的。
5. **内容包只活在内存里**：`applyContentPack` 改的是 `activePack` 变量，进程一退就回到官方内容；网页刷新、APK 重启、桌面重开都会丢。
6. **项目不是 git 仓库**：`git status` → `not a git repository`，而工作区里有 394 MB SDK + 457 MB 产物 + 正在被多人同时改的引擎，一次误改没有回滚点。

---

## 2. 短期（1~2 周，高性价比）

**如果只看三条**：**S1**（不修，前面三件事只在"网页 + 有服务端"这一种情况下可见）、**S3**（半天成本，消掉五个互相矛盾的版本号）、**S2**（决定"内容包生态"到底成不成立）。

| # | 做什么（为什么值得） | P | 工作量 | 影响面 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| **S1** | **四端收口**：补 `server.js` 缺的 4 条 `/api/content*` 与 `/api/volunteer`；在 `local-api.js` 补同样 5 条；把 CLI 交互循环从 `while (playing)` 改成能处理 `volunteering`（出分后打印成绩、让玩家用数字选 6 个志愿、提交后进结局）。**不修的话，本次三件事只在一种部署形态下成立** | **P0** | **M** | `src/server.js`、`web/local-api.js`、`src/cli.js`、`test/{server,web,android,engine}.test.js` | `node --test test/` 全绿（含"离线接口能一路打到结局"）；`curl -s localhost:3210/api/content` 返回 `source: "official"`；CLI 手打一局能在终端填 6 个志愿并打印"第 N 志愿录取" |
| **S2** | **内容包持久化 + 一键回滚**：把生效的包存进 localStorage（网页/安卓）、`saves/content-pack.json`（CLI/Electron），启动时自动重放；`contentStatus()` 补 `appliedAt`；"恢复官方内容"接上已有的 `resetContent()` | **P1** | **M** | `src/content.js`、`src/engine.js`、`web/app.js`、`web/local-api.js`、`src/server.js` | 网页导入一个包→刷新页面→面板仍显示同一个校验和与 `eventCount`；点重置后 `eventCount` 回到 87（接线后 108） |
| **S3** | **版本号单一真源 + 发版守门**：`package.json` 定为唯一真源，`engine.js` 从它读或加断言；新增 `test/version.test.js` 同时盯 `GAME_VERSION`、README 首行、CHANGELOG 首条、`AndroidManifest.versionName`（后者已有测试）、`dist/` 产物名 | **P0** | **S** | `package.json`、`src/engine.js`、`test/version.test.js`、`README.md`、`CHANGELOG.md` | 故意把 `package.json` 改成 `9.9.9`，`node --test test/` 至少 3 条红；改回后全绿 |
| **S4** | **接线 events6 + 登记校历 + 泛化自检工具**：把 `engine.js` 第 69–70、119 行三处注释换成真实 import；给 21 个链事件补 `calendar.js` 条目；`tools/check-events5.mjs` 泛化成 `check-content.mjs`，接受任意事件文件或 `content pack` | **P0** | **M** | `src/engine.js`、`src/data/calendar.js`、`src/data/events6.js`、`tools/check-content.mjs`、`test/calendar.test.js` | 那条校历红灯转绿；`ALL_EVENTS` 从 123 变 144；`node tools/check-content.mjs src/data/events6.js` 把每个选项丢进真实引擎跑通、0 报错 |
| **S5** | **内容包拉取的安全边界**：`app.js` 已有"从地址拉取内容包"；服务端若照做就是 SSRF（本机端口/LAN 设备）+ 无大小上限。做法：只允许 `https:`、拒私网与回环、body ≤1 MB、`JSON.parse` 后深度与数组长度上限 | **P0** | **S** | `src/server.js`、`web/app.js` | 一条测试对 `/api/content/apply` 传 `{"url":"http://127.0.0.1:22/"}` 得到 400，且不发生任何外连 |
| **S6** | **跨端档案（元进度）统一导出/导入**：CLI 用 `saves/profile.json`、网页与安卓用 localStorage，是两套互不相通的图鉴/成就/传承点。定义 `mas2z-profile.json`（档案 + 当前局，取并集合并），四端都能读 | **P1** | **M** | `src/profile.js`、`src/cli.js`、`web/app.js`、`web/local-api.js` | 从网页导出档案，CLI `--import-profile` 读入后 `--gallery` 显示的解锁结局数与网页一致（差值 0） |
| **S7** | **可访问性最小集**：日志与状态区加 `aria-live="polite"`，事件弹层加 `role="dialog"` + `aria-modal` + 关闭后焦点回填，开局表单支持纯键盘走完（选项 1–9 已有 CLI 传统），"冲/稳/保"除颜色外补文字 | **P1** | **S** | `web/index.html`、`web/app.js`、`web/style.css` | 只用键盘能完成"开局 → 一周 → 出分 → 提交志愿"；DevTools 可访问性树里日志区是 live region；375 px 宽下冲/稳/保仍有文字标签 |
| **S8** | **CLI 内容包工作流**：`--pack <file>` 启动即套包、`--export-pack` 把当前事件导成包骨架、`--content` 打印当前内容状态。内容作者才有闭环，否则只能靠网页点 | **P1** | **M** | `src/cli.js`、`src/content.js` | `node src/cli.js --auto --pack mypack.json` 的日志里出现包里新加的事件名；`--export-pack out.json` 重新导入后 `checksumPack` 与导出时相同 |
| **S9** | **性能与包体基线**：现在没有性能测试。加 `tools/bench.mjs` 量 `viewState()`、`playWeek()`、`applyContentPack()` 的 p95，并设预算阈值；把 `build/apk-check.txt` 的"条目数 36"纳入测试，防止打包漏模块 | **P2** | **S** | `tools/bench.mjs`、`package.json`、`test/android.test.js` | `npm run bench` 打印三项 p95 并与预算比较，超预算时退出码非 0；APK 条目数变化会让测试变红 |
| **S10** | **战报导出（可分享的一局）**：`--log-export out.md` 按周输出行动/事件/选择/成绩曲线 + 结局与成就，网页加"导出战报"按钮。现在只有 JSON 存档，玩家想发帖只能截图 | **P2** | **S** | `src/cli.js`、`web/app.js` | 生成的 Markdown 含 36 周条目、总分、结局、成就清单；同一局导出两次内容字节级一致（除时间戳） |
| **S11** | **CLI 与网页手感对齐**：列出并消掉已知差异——网页没有"回车重复上次动作"，CLI 出分后没有汇总表；两端统一"冲/稳/保"计数与志愿顺序调整键位（`↑↓` / `u,d`） | **P2** | **M** | `src/cli.js`、`web/app.js` | 两端都能在出分后 60 秒内提交志愿，且显示相同的冲/稳/保计数与相同录取结果（同种子同构筑） |

---

## 3. 中期（1~2 个月，系统级）

| # | 做什么（为什么值得） | P | 工作量 | 影响面 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| **M1** | **因果链进内容包 + 链图调试工具**：引擎已有 `armChain`/`pendingChains`/`chainOnly`，但 `PACK_SECTIONS` 里没有 `chain`，第三方包长不出链。把 `chain: { id, delay }` 变成包的一等字段（含环与延时的校验），加 `tools/chains.mjs` 打印链图与每条环的 delay/触发条件 | **P1** | **M** | `src/content.js`、`src/engine.js`、`tools/chains.mjs`、`test/content.test.js`（新建） | 一个包声明 3 条链，工具能画出链图；一条测试断言"后续环 `chainOnly` 绝不进随机池"；包里的链在真实引擎里能长出来 |
| **M2** | **志愿填报从"最后一关"长成"三年的连续决策"**：现在只有高考后一次性 6 格。加：高二起的专业兴趣档案、选科与专业组的匹配度、家长压力（`events5` 已有 `followedParents` 分支）会改变可报范围、征集志愿作为第二次机会 | **P1** | **L** | `src/data/colleges.js`、`src/engine.js`、`src/data/events5.js`、`web/app.js` | 玩家在**高二**做的至少 3 类选择会改变高考后志愿表上的可选专业组；新增"征集志愿录取"结局并进入 `endingCatalog()` |
| **M3** | **多周目传承深化**：现在传承点只有"每 2 局 1 点、上限 6"一个用途。做成传承商店：解锁开局要素（特殊背景/初始 NPC 关系/专属事件），`profile.history` 的 20 局构成"校友录" | **P1** | **M** | `src/data/character.js`、`src/profile.js`、`web/app.js`、`test/custom.test.js` | 传承点可换 ≥3 类开局要素并写进存档；`profile.games → 传承点`换算有测试；读档后已购要素不回退 |
| **M4** | **NPC 关系网事件驱动**：关系目前基本是单向的（阈值触发成就/结局/每周回心情）。加一个像 `story.js` 那样的"关系事件调度器"，让 NPC 主动找你（老对手考砸后来搭把手已经存在，把它系统化） | **P1** | **L** | `src/engine.js`、`src/data/events*.js`、`test/cast.test.js` | 新增 8 条**只由关系数值触发**的 NPC 事件；`tools/sim.js` 跑 100 局能证明每条至少触发 1 次 |
| **M5** | **MOD 工作坊（玩家自制内容分发）**：包已经能装事件/道具/天赋/平衡。补：多包叠加的启用顺序与停用、冲突报告（`validatePack` 已能报覆盖）、一键导出"我的包"、包列表带作者与校验和。**不做服务器**，定位"论坛贴 JSON"级分发 | **P2** | **L** | `src/content.js`、`web/app.js`、`web/local-api.js`、`tools/check-content.mjs` | 同时启用 3 个互相覆盖的包时，冲突面板逐条列出被覆盖的 id；导出→导入往返 `checksumPack` 相同 |
| **M6** | **平衡工具升级：README 那张表改成脚本生成**：`tools/sim.js` 已有 9 策略 × 24 局，但 README 的平衡表是手抄的（"985+ 从 25% 降到 4%"这类数字没有来源，事实上有版本漂移）。输出机器可读 JSON + 难度×策略矩阵 + 置信区间，直接生成文档表格 | **P1** | **M** | `tools/sim.js`、`README.md`、`package.json` | `npm run sim -- --json` 的产物与 README 平衡表逐格一致（改为脚本写入）；数值偏离阈值即非零退出，可进发版门 |
| **M7** | **成绩曲线与自适应难度**：难度目前开局就静止。做"帮扶而非放水"——连续低效或濒临崩溃时给提示/微调遗忘，**绝不悄悄改玩家分数**，且开关默认关闭 | **P2** | **M** | `src/engine.js`（`EFF`/`DIFFICULTY`）、`tools/sim.js` | 开/关两组的 sim 报告显示崩溃率从 38% 降到 <25%，且平均分变化 <5 分 |
| **M8** | **校园地图（视觉化第一步）**：现在只有 emoji + 文字 + 关系树 SVG。把 37 个行动和主要事件挂到地点（教学楼/操场/雨山湖/团结广场后巷），用现有 CSS 变量实现，**不引框架** | **P2** | **L** | `web/app.js`、`web/style.css`、`web/index.html` | 地图上 37 个行动全部可点；375 px 宽无横向溢出（`tools/layout-probe.mjs` 实测 `docScrollW == innerW`） |

---

## 4. 长期（3 个月以上，野心）

| # | 做什么（为什么值得） | P | 工作量 | 影响面 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| **L1** | **同种子对跑 / 异步"同学会"**：不引服务器，用"种子 + 构筑"作为交换单元，两人各跑三年后对比知识/关系/心情曲线；`rng.js` 的 splitmix32 可序列化，这是现成的地基 | **P2** | **L** | `src/rng.js`、`src/engine.js`、`src/cli.js`、`web/app.js` | 两端加载同种子同构筑，36 周后 `game.knowledge` 逐科完全相等；对跑报告能并排显示两人曲线 |
| **L2** | **跨平台同步（无账号版）**：零依赖是卖点，别做账号体系。把存档文件当同步单元——桌面 `saves/` 指到 OneDrive/坚果云目录，安卓经 SAF 读写同一份；元进度合并取并集 | **P2** | **L** | `src/profile.js`、`android/.../MainActivity.java`、`electron/main.cjs` | 桌面端把存档目录指到共享目录后，安卓导入同一存档能续玩到同一周；两端图鉴合并后解锁数 = 并集 |
| **L3** | **模板化 / 本地小模型事件生成 + 人工过审流水线**：关键不是生成而是**过审流水线**——候选事件必须过 `validatePack`、必须登记 `calendar.js`、必须能被真实引擎跑完每个选项，工具自动淘汰不合格的，人只审剩下的 | **P2** | **L** | `tools/`、`src/content.js`、`src/data/calendar.js` | 生成 50 个候选：未登记校历/占位符缺失的 100% 被工具淘汰；人工审完可一键导出成 `content pack` 并成功导入 |
| **L4** | **UGC 分发（静态索引版）**：用 GitHub Release / 静态 JSON 索引做"内容包市场"，客户端内置索引地址 + 校验和校验（`checksumPack` 已有） | **P2** | **M** | `src/content.js`、`web/app.js`、`tools/` | 客户端从索引安装一个包，安装后本地校验和与索引一致；把包内容改一个字节后拒绝安装 |
| **L5** | **引擎拆分（架构）**：`engine.js` 已 2,941 行、70 个导出，装着所有规则与目录。按 回合/考试/NPC/结局/内容包 拆成 `src/engine/*.js`，`exports` 入口与导出符号集合保持不变 | **P2** | **L** | `src/engine.js` → `src/engine/`、`package.json`、全部测试 | 拆分后 `node --test test/` 全绿，且一条新测试断言"引擎入口的 70 个导出名不变"（防止对外契约走形） |

---

## 5. 风险与取舍

| # | 风险 | 具体表现（实测） | 缓解 / 取舍（对应建议） | P / 工作量 | 验收标准（风险已被挡住的样子） |
| --- | --- | --- | --- | --- | --- |
| **R1** | **内容越多越难平衡** | 非剧情事件 69 → 87 → 108（+21 链事件）；README 自己记着"卷王 985+ 从 25% 掉到 4%"。事件池变大是**摊薄**，不是加法 | 把 `tools/sim.js` 报告纳入发版门（M6）；任何人加内容必须同时交前后对比，禁止"只加内容不跑 sim" | **P1 / M** | 一次"只加 10 个事件、不动平衡"的提交会因 sim 报告偏离阈值而变红，作者必须显式调旋钮才能过 |
| **R2** | **热更新 = 作弊 + 版本碎片** | 包可覆写 23 个 `EFF` 键，把 `gainScale` 拉到 10 倍就是作弊；玩家 A 装包、B 不装，"同种子同结果"（README 明确承诺过）被打破 | 取舍是**不禁止**：图鉴/成就标注"本局装了非官方包"，存档记录包的 checksum（`contentStatus()` 已有），排行榜类功能只认官方校验和 | **P1 / S** | 装了非官方包的一局，其 `runSummary()` 与图鉴条目都带包名 + checksum 标记 |
| **R3** | **APK / EXE 无签名分发** | `dist/` 里是 debug 签名（`android/debug.keystore`，口令 `android`）；Windows 首启 SmartScreen 警告 | 发版必须附 SHA-256 校验和；把 keystore 换成不与仓库同口令的本地密钥；正式上架才考虑买证书（个人项目可以不买，但要在下载页写明） | **P1 / S** | 每个产物旁边有 `.sha256`，且 `dist/` 里的 APK 不再用口令为 `android` 的密钥签名 |
| **R4** | **单人开发的时间预算 + 无回滚点** | `git status` → `not a git repository`；工作区 394 MB SDK + 457 MB 产物；同时有 5 个角色在改同一个引擎 | **先 `git init` 再写下一行代码**：`.gitignore` 已经写好（含 `.android-sdk/`、`dist/`、`build/`、`android/debug.keystore`），每版打 tag。这条是所有其它建议的前提 | **P0 / S** | `git log` 能看到 v2.5.0 tag，`git status` 干净，SDK 与产物不在索引里 |
| **R5** | **端数越多验证越贵，且接口已经分叉** | 服务端 14 条路由 vs `local-api.js` 13 条；"网页有、安卓没有"已实际发生两次（内容包、志愿），红灯 `离线接口：可以一路打到结局` 就是证据 | 路由表抽成共享清单，加一条测试断言"服务端有的路由，`local-api.js` 必须也有"（S1 的验收就是它）；发版前必须真机或解包验证，不能只看网页 | **P0 / S** | 故意只在服务端加一条路由，`node --test test/` 立刻红并指出缺哪条 |
| **R6** | **长文本内容的质量与一致性** | 36 章剧情 + 108 事件靠人写，占位符漏一个就串戏（现在只有 `cast.test.js` 防漏） | `tools/check-content.mjs`（S4）作为提交前钩子：占位符、日历登记、每个选项真实引擎跑通，三关不过不许提 | **P1 / S** | 故意在事件文案里写一个不存在的 `{teacher}` 占位符，自检工具非零退出并指出文件与事件 id |
| **R7** | **志愿填报让"分数 = 结局"失效，把平衡数据搅浑** | `--auto` 用 `autoVolunteer` 兜底自动填表，所以 sim 分数不再等于玩家实际体验；滑档/调剂让同一分数有多种结局 | sim 报告分三档：自动填 / 完美填 / 最差填；README 平衡表必须标清用的是哪一档 | **P2 / S** | `npm run sim` 输出的每一行都标注填表口径，README 平衡表首行写明"以下为自动填表" |

---

## 6. 团队分工（本次实际分工 + 给下一个接手的人）

### 6.1 本次实际怎么分的

| 角色 | 归属 | 写入范围 | 交付物 |
| --- | --- | --- | --- |
| 内容包工具链 | 队友 `pack-tools` | `src/content.js`、`test/content.test.js` | 内容包格式、校验、合并、摘要、校验和 |
| 前端 | 队友 `web-ui` | `web/app.js`、`web/index.html`、`web/style.css` | 内容包面板（粘贴/文件/URL/重置）+ 志愿填报界面（6 格、冲稳保、服从调剂） |
| 链式内容 | 队友 `chain-content` | `src/data/events6.js` | 21 个因果链事件 / 63 选项 / 8 成就（**已落盘，等接线**） |
| 引擎与发版 | **Lead 自己** | `src/engine.js`、`src/server.js`、`src/data/colleges.js`、`package.json` | `applyContentPack`、`volunteering` 状态机、`armChain`、API、四端打包 |
| 独立核验 | 不写实现的人 | 只读 + 跑命令 | `npm test`、CLI 真打一局、网页实测、解包 APK import 其 `local-api.js` |
| 文档与建议 | 队友 `planner` | `ROADMAP.md` | 本文档 |

**这次分得好的地方**：三件事的文件边界天然正交（`content.js` / `web/` / `events6.js`），谁都不用改别人的文件，所以能真的并行。
**这次暴露的问题**：`engine.js` 是所有人的交汇点，三件事都要往里加东西；接线（`events6` 的 3 处 import、5 条 API 路由）**只有 Lead 能做**，于是它成了串行瓶颈——一条红灯卡在"内容已交付、引擎还没接"。

### 6.2 什么适合拆给队友

- **单文件、契约已冻结的内容生产**：`events6.js` 只依赖 `effect` / `chain` 语法，格式冻结后可以整块外包（本次就是这个模式，效果最好）。
- **纯渲染层**：`relations-view.js` 是"无 DOM、可单测"的纯函数，前端逻辑和它分开写不会打架。
- **只在 `src/data/*` 里加数据**：行动、事件、道具、天赋、文案——改动局部且测试能兜住。
- **新增独立测试文件**：`test/*.test.js` 一个文件一个人，天然不冲突。
- **可量化验收的界面工作**：`tools/layout-probe.mjs` 能把"有没有横向溢出"变成数字，这类任务可以放心交出去。

### 6.3 什么必须 Lead 自己扛

- **跨文件接口的冻结**：`PACK_FORMAT`、`effect.chain` 的语法、`status` 状态机（`playing → volunteering → ended`）、API 路由表。这些一旦冻结就不能边写边改，**冻结前队友只能读不能写**。
- **`engine.js` 的任何改动**：所有人 import 同一份引擎，两人同时改必然互相覆盖。本次的做法是"队友只写数据文件与前端，引擎由 Lead 独占"，这条必须保持。
- **版本与发版**：`package.json` / `GAME_VERSION` / `AndroidManifest` / CHANGELOG / 产物名一次改齐（S3）。
- **平衡旋钮**：`EFF` / `DIFFICULTY` 是全局影响，只能一个人拍板，否则 sim 报告没有可比性。
- **最终验收**：跑四端 + 解包 APK + 真机或等价物验证。验收**必须由不写实现的人独立做**——写实现的人只会验证自己想到的路径，本次"网页有、安卓没有"两处分叉就是靠独立核验（离线接口那条测试）才暴露的。

### 6.4 给下一个接手的人三条规矩

1. **先 `git init` 并打 tag，再动代码**。当前没有版本控制，而工作区里有 850 MB 产物/工具链和一份 2,941 行的引擎。
2. **冻结接口再并行**。要拆给队友的活，先把格式写成文档 + 一条会红的测试，然后才允许开工。
3. **四端一起验收，只认命令输出**。`node --test test/`、CLI 真打一局、网页 `curl` 一次 API、解包 APK——四条都过才算完，README 里的数字和"应该没问题"都不算。
