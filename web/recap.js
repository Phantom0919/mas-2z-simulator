/**
 * 续玩钩子账本 + 结局页「上一次的你」——纯函数模块（v3.6）。
 *
 * 为什么单独一个文件：这一版真正需要被守住的东西只有三件——
 *   1. **跨会话的钩子**：引擎其实一直在算"下回预告"（`src/data/teasers.js` →
 *      `view.teaser`），但它只活在正在玩的那个会话里；关掉 App，没写下来的
 *      承诺就等于没有承诺。这里只负责把 view 里**真的要念**的字段抽成一个
 *      能进 localStorage 的小账本，下次开屏原样念一遍。
 *   2. **mode 判定**：有钩子没存档（`orphan`）时必须说实话，不能假装还能接着上。
 *   3. **和上一次的自己比**：口径（同难度 / 第几局 / 差多少）写在这里才好测。
 *
 * 模块级的硬约束（都有测试盯着）：
 *   - **不做催玩**：本文件里不出现 `Date` / 当前时间，函数的入参里也没有"现在几点"。
 *     结构上就写不出"仅剩 3 小时"这种文案；续玩卡只陈述真实进度。
 *   - **不编文案**：预告逐字来自 `view.teaser`，结局线索逐字来自结局目录的 `hint`；
 *     这两条各有测试比对原文。
 *   - **坏数据不白屏**：localStorage 里被手改成垃圾 JSON 时一律降级成 null / 空卡，
 *     `JSON.parse` 的异常不会冒到渲染层。
 *
 * 不 import 引擎：`view` 已经是引擎算好的快照，这里只做形状收敛与组装，
 * 所以既能单独测，也不会和 `src/engine.js` 形成循环依赖。
 */

/** 账本的格式号：以后改结构就 +1，老账本读不出来会被安全忽略。 */
export const HOOK_FORMAT = 1;

/**
 * 续玩钩子账本的 localStorage 键。
 * ⚠️ `web/app.js` 里有一份同名字符串常量（守门测试会比对两处一致），
 * 改名字要两边一起改——它同时写在 CHANGELOG 里。
 */
export const HOOK_KEY = 'mas2z-hook-v1';

/** 预告语气只有这四档（和 `#next-teaser` 的四组配色一一对应）。 */
const TEASER_TONES = ['exam', 'danger', 'story', 'calm'];

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 收字符串：非字符串 → ''，并截断到合理长度（账本不该被一段长文撑爆）。 */
function asText(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** 收数字：非有限数 → null（区别于 0：「没考过」和「考了 0 分」不是一回事）。 */
function asNumber(value) {
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** 收整数并夹在 [min, max] 里。 */
function asInt(value, min, max, fallback) {
  const num = asNumber(value);
  if (num === null) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

/** 预告只留界面真的要念的三样东西；不是合法形状就整条丢掉。 */
function cleanTeaser(teaser) {
  if (!isObject(teaser)) return null;
  const text = asText(teaser.text, 160);
  if (!text) return null;
  const tone = asText(teaser.tone, 12);
  return {
    icon: asText(teaser.icon, 8) || '📌',
    text,
    tone: TEASER_TONES.includes(tone) ? tone : 'calm',
  };
}

/**
 * 把任意来源（view / localStorage 里的 JSON）收敛成一份可信的账本。
 * 形状不对一律 null —— 调用方据此降级，不用再判断字段。
 */
function sanitize(data) {
  if (!isObject(data)) return null;
  if (asNumber(data.format) !== HOOK_FORMAT) return null;
  // 只认两种状态：'playing'（这一局还在）/ 'ended'（这一局走完了）。
  const status = data.status === 'ended' ? 'ended' : data.status === 'playing' ? 'playing' : null;
  if (!status) return null;

  const turn = asInt(data.turn, 0, 10000, 0);
  const totalWeeks = asInt(data.totalWeeks, 0, 10000, 0);
  const weeksLeft = asInt(data.weeksLeft, 0, 10000, Math.max(0, totalWeeks - turn));
  const estimateTotal = asNumber(data.estimateTotal);
  const difficulty = isObject(data.difficulty) && asText(data.difficulty.key, 20)
    ? { key: asText(data.difficulty.key, 20), name: asText(data.difficulty.name, 20) }
    : null;
  const ending = isObject(data.ending) && asText(data.ending.id, 60)
    ? {
        id: asText(data.ending.id, 60),
        title: asText(data.ending.title, 60),
        total: asNumber(data.ending.total),
      }
    : null;

  return {
    format: HOOK_FORMAT,
    status,
    turn,
    week: asInt(data.week, 1, 10000, Math.max(1, turn)),
    totalWeeks,
    weeksLeft,
    calendarLabel: asText(data.calendarLabel, 40),
    phaseLabel: asText(data.phaseLabel, 20),
    semesterName: asText(data.semesterName, 20),
    estimateTotal,
    student: {
      name: asText(isObject(data.student) ? data.student.name : '', 24),
      className: asText(isObject(data.student) ? data.student.className : '', 24),
    },
    difficulty,
    selection: asText(data.selection, 60),
    teaser: cleanTeaser(data.teaser),
    ending,
  };
}

/**
 * 从 `view` 里抽出一个能存进 localStorage 的小钩子。
 *
 * 白名单式取值：只搬运界面真的要念的字段，`view.log` / `view.actions` 这些
 * 大块数据一个字都不进来（一局的 view 有几十 KB，账本只有几百字节）。
 *
 * @param {object} view 引擎的视图快照（`viewState()` 的返回值）
 * @returns {object|null} 账本；view 形状不对 / 这一局还没开始 → null
 */
export function buildHook(view) {
  if (!isObject(view)) return null;
  // 'volunteering'（高考出分、等填志愿）也是"这一局还在"，一样可以续玩。
  const status =
    view.status === 'ended' ? 'ended' : view.status === 'playing' || view.status === 'volunteering' ? 'playing' : null;
  if (!status) return null;
  return sanitize({
    format: HOOK_FORMAT,
    status,
    turn: view.turn,
    week: view.week,
    totalWeeks: view.totalWeeks,
    weeksLeft: view.weeksLeft,
    calendarLabel: view.calendarLabel,
    phaseLabel: view.phaseLabel,
    semesterName: view.semesterName,
    estimateTotal: view.estimateTotal,
    student: { name: view.student?.name, className: view.student?.className },
    difficulty: isObject(view.difficulty) ? { key: view.difficulty.key, name: view.difficulty.name } : null,
    selection: view.selection?.label,
    teaser: view.teaser,
    ending: isObject(view.ending) ? { id: view.ending.id, title: view.ending.title, total: view.ending.total } : null,
  });
}

/**
 * 读账本。**坏 JSON 一律 null**，绝不抛。
 * @param {string|object} raw localStorage 里的原文（也接受已经 parse 好的对象，方便测试）
 * @returns {object|null}
 */
export function readHook(raw) {
  if (isObject(raw)) return sanitize(raw);
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    return null; // 手改坏的、被截断的、别的程序写的——一律当没有
  }
  return sanitize(data);
}

/** localStorage 在隐私模式 / 存储被禁时可能直接抛，取不到就当没有存储。 */
function currentStorage() {
  try {
    const store = globalThis.localStorage;
    return store && typeof store.setItem === 'function' ? store : null;
  } catch {
    return null;
  }
}

/**
 * 写账本。存不下（配额满 / 存储被禁）就算了，游戏本身不受影响。
 * @returns {boolean} 是否真的写进去了
 */
export function writeHook(hook, storage = currentStorage()) {
  if (!hook) return false;
  try {
    storage.setItem(HOOK_KEY, JSON.stringify(hook));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清掉账本。
 * 玩家主动"重新捏一个人"时用它：钩子被消费掉，不该每次开屏都念同一句旧话。
 */
export function clearHook(storage = currentStorage()) {
  try {
    storage.removeItem(HOOK_KEY);
    return true;
  } catch {
    return false;
  }
}

/** 开场白式的一行：把账本里的时间坐标说清楚。 */
function placeText(hook) {
  if (hook.calendarLabel) return hook.calendarLabel;
  return `第 ${hook.week} 周`;
}

/** 预告行：**原文照搬** `view.teaser`，只允许在外面加一个引子。 */
function teaserLine(hook, lead) {
  if (!hook?.teaser) return null; // 没有账本（只有上一局档案）时就没有预告可念
  const line = { kind: 'teaser', icon: hook.teaser.icon, text: hook.teaser.text, tone: hook.teaser.tone };
  if (lead) line.lead = lead;
  return line;
}

/**
 * 组装开局屏最上面那张续玩卡。
 *
 * **刻意不接收"现在几点"**：整个模块没有时钟，所以结构上就写不出催促文案。
 *
 * mode 判定（顺序即优先级，和设计文档一致）：
 *   | 条件 | mode | 卡片 |
 *   | --- | --- | --- |
 *   | 这一局还在 + 存档读得到 | mid-run | 「接着上第 N 周」 |
 *   | 这一局还在 + 存档没了 | orphan | 说实话：只能重开 |
 *   | 账本说这一局走完了 / 档案里有上一局 | finished | 「上一局：…」+ 再来一局 |
 *   | 什么都没有（第一局的人） | fresh | 不显示这张卡 |
 *
 * 关于"`profile.lastRun` 比账本新"这条：账本不存时间戳（见模块头的反催玩约束），
 * 所以这里靠**写入顺序**判断——`persist()` 在每次行动和结局之后都会覆写账本，
 * 账本只可能和当前进度一样新或更新，不会出现"账本还在 playing，但档案里的上一局
 * 其实更晚"的情形。存档被清掉时优先说 orphan，不骗玩家。
 *
 * @param {{hook?:object, profile?:object, catalog?:Array, hasSave?:boolean}} input
 * @returns {{mode:string, title:string, lines:Array, primary:object|null, secondary:object|null}}
 */
export function resumeCard({ hook, profile, catalog, hasSave } = {}) {
  const current = readHook(hook);
  const archive = isObject(profile) ? profile : {};
  const lastRun = isObject(archive.lastRun) ? archive.lastRun : null;
  const entries = Array.isArray(catalog) ? catalog.filter(isObject) : [];
  const unlocked = isObject(archive.unlocked) ? archive.unlocked : {};

  let mode = 'fresh';
  if (current?.status === 'playing') mode = hasSave === true ? 'mid-run' : 'orphan';
  else if (current?.status === 'ended' || lastRun) mode = 'finished';

  if (mode === 'fresh') {
    return { mode, title: '', lines: [], primary: null, secondary: null };
  }

  if (mode === 'mid-run') {
    const lines = [teaserLine(current)];
    const meta = [];
    if (current.student.className) meta.push(current.student.className);
    meta.push(placeText(current));
    if (current.estimateTotal !== null) meta.push(`预估 ${current.estimateTotal} / 750`);
    lines.push({ kind: 'meta', text: meta.join(' · ') });
    return {
      mode,
      title: current.weeksLeft > 0 ? `⏳ 你的三年还剩 ${current.weeksLeft} 周` : `⏳ 你停在${placeText(current)}`,
      lines: lines.filter(Boolean),
      primary: { kind: 'resume', label: `▶ 接着上第 ${current.week} 周` },
      secondary: { kind: 'fresh', label: '重新捏一个人' },
    };
  }

  if (mode === 'orphan') {
    // 不挂预告：这一局已经读不回来了，留一句悬念就是骗人。
    return {
      mode,
      title: '⚠️ 上一局的存档被清掉了',
      lines: [{ kind: 'note', text: `上次走到${placeText(current)}，存档读不到了，只能重开一局。` }],
      primary: { kind: 'fresh', label: '重新捏一个人' },
      secondary: null,
    };
  }

  // finished：优先用档案里的上一局（那是玩家真的打完了的那一局）
  const title = asText(lastRun?.endingTitle, 60) || asText(current?.ending?.title, 60) || '上一局';
  const total = asNumber(lastRun?.total) ?? asNumber(current?.ending?.total);
  const memories = Array.isArray(lastRun?.memories) ? lastRun.memories.length : 0;
  const unlockedCount = entries.filter((entry) => unlocked[entry.id]).length;
  // 「最后」这个词在这条红线里是要绕开的（见模块头的反催玩约束），所以引子写成"走的时候留下的那一句"。
  const lines = [teaserLine(current, '走的时候留下的那一句是')].filter(Boolean);
  return {
    mode,
    title: `🏁 上一局：${title}${total !== null ? ` · 高考 ${total} / 750` : ''}`,
    lines,
    primary: { kind: 'restart', label: memories > 0 ? `🔁 再来一局（继承 ${memories} 条）` : '🔁 再来一局' },
    secondary: {
      kind: 'gallery',
      label: entries.length > 0 ? `📖 看看图鉴 ${unlockedCount} / ${entries.length}` : '📖 看看图鉴',
    },
  };
}

/**
 * 和上一次的自己比。
 *
 * 口径（写死在这里，界面只负责念）：
 *   - `prev` = 档案里**最近的一局**（可能和这一局难度不同，所以另有 prevSameDifficulty 标记）；
 *   - `deltaTotal` / `deltaAchievements` 只在两边都有数时才有值，没有就不显示（不是显示 0）；
 *   - `sameDifficulty`（同难度第几名）**只在档案条目真的写了 difficulty 且和这一局相同时**
 *     才算。老档案没有这个字段 → 这里返回 null，界面就不会说出「同难度」三个字
 *     （拿"当前难度"去顶替老条目就是编数据）。
 *   - 全部是陈述句：谁高谁低都只报数字。
 *
 * @param {Array} history 之前的局（不含这一局），档案里就是 newest-first
 * @param {object} current 这一局：{ total, achievements, difficulty, difficultyLabel, runNumber, ... }
 * @returns {object}
 */
export function selfCompare(history = [], current = {}) {
  const cur = isObject(current) ? current : {};
  const runs = (Array.isArray(history) ? history : []).filter(isObject);
  const runNumber = asInt(cur.runNumber, 1, 100000, 1);
  const total = asNumber(cur.total);
  const achievements = Array.isArray(cur.achievements) ? cur.achievements.filter((name) => typeof name === 'string') : [];
  const difficultyKey = asText(cur.difficulty, 20) || null;

  // 档案是新的在前：第 i 条（0 起）的"第几局"就是 runNumber - 1 - i。
  const known = runs.map((run, index) => ({
    ordinal: Math.max(1, runNumber - 1 - index),
    title: asText(run.title, 60) || '上一局',
    total: asNumber(run.total),
    difficulty: asText(run.difficulty, 20) || null,
    goalAchieved: typeof run.goalAchieved === 'boolean' ? run.goalAchieved : null,
    achievements: Array.isArray(run.achievements) ? run.achievements.length : 0,
  }));

  const previous = known[0] ?? null;
  const sameDifficultyRuns = difficultyKey ? known.filter((run) => run.difficulty === difficultyKey) : [];
  const prevSameDifficulty = Boolean(difficultyKey && previous?.difficulty === difficultyKey);

  const prevTotal = previous ? previous.total : null;
  const deltaTotal = prevTotal !== null && total !== null ? total - prevTotal : null;
  const deltaAchievements = previous ? achievements.length - previous.achievements : null;

  // 本机最好：把这一局也算进去；并列时算这一局（新记录更让人高兴）。
  let best = total !== null ? { total, ordinal: runNumber, isCurrent: true } : null;
  for (const run of known) {
    if (run.total === null) continue;
    if (!best || run.total > best.total) best = { total: run.total, ordinal: run.ordinal, isCurrent: false };
  }

  let sameDifficulty = null;
  if (difficultyKey && total !== null && sameDifficultyRuns.length > 0) {
    const scored = sameDifficultyRuns.filter((run) => run.total !== null);
    const ahead = scored.filter((run) => run.total > total).length;
    sameDifficulty = {
      rank: ahead + 1,
      of: sameDifficultyRuns.length + 1,
      key: difficultyKey,
      label: asText(cur.difficultyLabel, 20) || null,
    };
  }

  return {
    runNumber,
    isFirstRun: known.length === 0,
    prev: previous
      ? {
          ordinal: previous.ordinal,
          title: previous.title,
          total: previous.total,
          goalAchieved: previous.goalAchieved,
          achievements: previous.achievements,
        }
      : null,
    prevSameDifficulty,
    deltaTotal,
    deltaAchievements,
    best,
    sameDifficulty,
  };
}

/**
 * 「差一点」：从结局目录里挑还没解锁、且离玩家最近的两条。
 *
 * 排序是**推导出来的**，不是编的（hint 一个字都不改写）：
 *   1. 和"最近一局拿到的结局"同一档的，先上（玩家显然正在这条路上）；
 *   2. 该档里已经解锁得越多的越靠前（进度条越接近满）；
 *   3. 再按它和最近那个结局在目录里的距离，最后按目录顺序，保证结果稳定。
 *
 * @param {Array} catalog 结局目录（`endingCatalog()`，每条带 id/title/tier/hint）
 * @param {object} profile 跨局档案（`unlocked` / `history`）
 * @param {number} limit 最多几条
 * @returns {Array<{id:string, title:string, tier:string, hint:string}>}
 */
export function nearestUndiscovered(catalog = [], profile = {}, limit = 2) {
  const entries = (Array.isArray(catalog) ? catalog : []).filter((entry) => isObject(entry) && asText(entry.id, 60));
  const archive = isObject(profile) ? profile : {};
  const unlocked = isObject(archive.unlocked) ? archive.unlocked : {};
  const history = Array.isArray(archive.history) ? archive.history : [];
  const lastId = history.map((run) => (isObject(run) ? asText(run.endingId, 60) : '')).find(Boolean) ?? '';
  const lastIndex = entries.findIndex((entry) => entry.id === lastId);
  const lastTier = lastIndex >= 0 ? entries[lastIndex].tier : null;

  const tierUnlocked = new Map();
  for (const entry of entries) {
    if (unlocked[entry.id]) tierUnlocked.set(entry.tier, (tierUnlocked.get(entry.tier) ?? 0) + 1);
  }

  const wanted = asInt(limit, 0, 5, 2);
  if (wanted === 0) return [];

  const rows = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !unlocked[entry.id] && asText(entry.hint, 120));

  rows.sort((a, b) => {
    const scoreA = [
      lastTier && a.entry.tier === lastTier ? 0 : 1,
      -(tierUnlocked.get(a.entry.tier) ?? 0),
      lastIndex >= 0 ? Math.abs(a.index - lastIndex) : 0,
      a.index,
    ];
    const scoreB = [
      lastTier && b.entry.tier === lastTier ? 0 : 1,
      -(tierUnlocked.get(b.entry.tier) ?? 0),
      lastIndex >= 0 ? Math.abs(b.index - lastIndex) : 0,
      b.index,
    ];
    for (let i = 0; i < scoreA.length; i += 1) {
      if (scoreA[i] !== scoreB[i]) return scoreA[i] - scoreB[i];
    }
    return 0;
  });

  return rows.slice(0, wanted).map(({ entry }) => ({
    id: entry.id,
    title: asText(entry.title, 60),
    tier: asText(entry.tier, 20),
    hint: asText(entry.hint, 120), // ← 原文，界面前面自己加「线索：」
  }));
}

/**
 * 线索 → 开局构筑。
 *
 * 只映射"这条线索真的对应某个现成模板"的结局，映射表写死在这里；
 * 映射不到就返回 null，按钮退化成"只回开局屏"，不假装给了建议。
 * 用现成的角色模板（`CHARACTER_PRESETS`）而不是自己拼 track/goal：
 * 模板是不改选科的（选科留给玩家），而且数值都经过平衡。
 *
 * @param {string} endingId `endingCatalog()` 里的 id
 * @returns {{preset:string}|null}
 */
const LEAD_PRESETS = Object.freeze({
  baosong: 'olympiad', // 竞赛之光 → 竞赛生
  qiangji: 'olympiad', // 强基计划 → 竞赛奖项 + 单科
  sports: 'athlete', // 体育单招 → 体育生
  art: 'artist', // 艺考 → 文艺青年
  vlog: 'artist', // 自媒体 → 文艺青年
  zonghe: 'artist', // 综合评价 → 综合素质
  abroad: 'social', // 出国 → 生意家庭 / 有钱
  startup: 'social', // 创业 → 第一桶金
});

export function leadToDraft(endingId) {
  const id = asText(endingId, 60);
  const preset = LEAD_PRESETS[id];
  return preset ? { preset } : null;
}
