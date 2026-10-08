/**
 * 中二野人实验室 · 网页前端 v2
 *
 * 原生 ES 模块，无构建步骤、无依赖。流程：
 *   开局构筑（选科 / 天赋 / 背景 / 目标）→ 每周两段（主行动 + 周末）
 *   → 商店与结局图鉴 → 结局结算（目标达成 / 成就 / 高考分数）
 *
 * 服务端接口：/api/options、/api/new、/api/action、/api/event、/api/shop、
 *            /api/view、/api/export、/api/import
 *
 * 没有服务端时（file:// / 手机 WebView / 静态托管）自动改用 web/local-api.js，
 * 在页面内直接调用引擎，接口形状完全一致。
 */

import { createLocalApi } from './local-api.js';
import { GAME_VERSION } from '../src/engine.js';
import {
  DEFAULT_NICKNAME,
  LEADERBOARD_METRICS,
  MAX_LOCAL_ENTRIES,
  emptyConfig,
  entryFromRun,
  isConfigured,
  normalizeNickname,
  rankEntries,
  reproduceText,
  submitEntry,
  fetchBoard,
  summarizeBoard,
} from '../src/leaderboard.js';
import { summarizeUpdate } from '../src/update.js';
import {
  castCardHtml,
  relationsSummaryHtml,
  relationsSvg,
  storyBodyHtml,
} from './relations-view.js';

/** 跨局图鉴的 localStorage 键（题目约定，勿改）。 */
const PROFILE_KEY = 'mas2z-profile-v2';
/** 自动存档的 localStorage 键。 */
const SAVE_KEY = 'mas2z-save-v2';
/** 自定义人物角色卡的 localStorage 键。 */
const CARD_KEY = 'mas2z-cards-v1';
/** 天赋固定选 2 个（与引擎 EFF.maxTraits 一致）。 */
const TRAIT_PICK = 2;
/** 缺陷最多 1 个（与引擎 EFF.maxFlaws 一致）。 */
const MAX_FLAWS = 1;
/**
 * 腾讯频道【模拟器发布页】。
 *
 * 只在这里写一次，HTML 里的链接、复制按钮、分享文案全用它。
 * 它是真链接（不是按钮）：浏览器新开标签页、桌面端交给系统浏览器
 * （electron/main.cjs）、安卓端跳出 WebView（MainActivity.shouldOverrideUrlLoading）。
 * 在网页上玩的人也就多了，所以这个地址必须能被复制出去。
 */
const COMMUNITY_URL = 'https://pd.qq.com/s/c38ht6k4r';
/** 榜单昵称（只在这台设备上） */
const NICKNAME_KEY = 'mas2z-nickname-v1';
/** 本机榜（没接后端、或者断网时看的就是它） */
const LEADERBOARD_KEY = 'mas2z-leaderboard-local-v1';
/** 已经上榜过的"局"，避免同一局反复提交 */
const LEADERBOARD_SUBMITTED_KEY = 'mas2z-leaderboard-submitted-v1';

const state = {
  gameId: null,
  view: null,
  options: null,
  busy: false,
  linesTimer: null,
  /** 已经记入图鉴的「局 + 结局」，避免重复统计。 */
  recorded: null,
  /** 排行榜的运行时状态（配置、当前看的榜、拉回来的条目、待上榜的那一局）。 */
  leaderboard: {
    config: null,
    metric: 'score',
    entries: [],
    source: 'local',
    loading: false,
    recorded: null,
    pending: null,
  },
  /** 开局构筑的临时选择（自定义人物的全部字段都在这里）。 */
  draft: {
    name: '',
    gender: '男',
    nickname: '',
    avatar: 'student',
    personality: 'plain',
    flaws: [],
    points: { spend: {}, subjects: {} },
    customCast: {},
    track: 'physics',
    electives: [],
    traits: [],
    background: 'worker',
    goal: 'yiben',
    difficulty: 'normal',
    custom: {},
    weeksPerSemester: 6,
    seed: '',
    endless: false,
    preset: null,
  },
};

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------ 通用工具 */

function escapeHtml(text) {
  return String(text ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;

function meter(value, max, color) {
  const ratio = Math.max(0, Math.min(1, max ? value / max : 0));
  return `<span class="meter"><i style="width:${(ratio * 100).toFixed(1)}%;background:${color}"></i></span>`;
}

/** 越高越好 / 越低越好的属性条颜色。 */
function statColor(meta, value) {
  const ratio = meta.max ? value / meta.max : 0;
  if (meta.better === 'low') return ratio > 0.5 ? '#f85149' : ratio > 0.2 ? '#d29922' : '#3fb950';
  return ratio > 0.66 ? '#3fb950' : ratio > 0.33 ? '#d29922' : '#f85149';
}

function ratioColor(value, max) {
  const ratio = max ? value / max : 0;
  return ratio > 0.66 ? '#3fb950' : ratio > 0.33 ? '#d29922' : '#f85149';
}

/** 从 view.subjects 里取科目名，找不到就退回内置表。 */
const SUBJECT_NAMES = { chinese: '语文', math: '数学', english: '英语', physics: '物理', history: '历史', chemistry: '化学', biology: '生物', politics: '政治', geography: '地理' };

function subjectName(key) {
  const found = state.view?.subjects?.find((subject) => subject.key === key);
  return found?.name ?? SUBJECT_NAMES[key] ?? key;
}

/* ------------------------------------------------------------ 网络 */

/**
 * 两种运行模式：
 *   server —— 有 Node 服务（npm run web / Electron 客户端里的内嵌服务）
 *   local  —— 没有服务，直接在页面里跑引擎（file://、手机 WebView、静态托管）
 * 接口形状一致，所以下面所有业务代码都不需要关心自己在哪种模式下。
 */
let localApi = null;

async function detectApiMode() {
  const params = new URLSearchParams(location.search);
  if (location.protocol === 'file:' || params.has('local')) {
    localApi = createLocalApi();
    return 'local';
  }
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (response.ok) return 'server';
  } catch {
    /* 没有服务，退回本地引擎 */
  }
  localApi = createLocalApi();
  return 'local';
}

async function api(path, { method = 'GET', body } = {}) {
  if (localApi) return localApi.request(path, { method, body });

  const response = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) throw new Error(payload?.error ?? `请求失败（${response.status}）`);
  return payload;
}

/* ------------------------------------------------------------ 浮层提示 */

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.remove('hidden');
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.add('hidden'), 3200);
}

/** 每回合的旁白：短暂浮层，点击可立刻收起。 */
function showTurnLines(lines) {
  const node = $('turn-lines');
  node.textContent = lines.join('\n');
  node.classList.remove('hidden');
  node.scrollTop = 0;
  clearTimeout(state.linesTimer);
  state.linesTimer = setTimeout(() => node.classList.add('hidden'), 9000);
}

/* -------------------------------------------------------- 交流 / 关于 */

/**
 * 复制文本：先走剪贴板 API，失败再退回 textarea + execCommand。
 *
 * 安卓 WebView 里 navigator.clipboard 会因为权限或"用户手势"判定失败，
 * 而「复制频道链接」正是这个面板最不该出的错——复制不到，玩家就只能手打地址。
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底
  }
  try {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    const ok = document.execCommand('copy');
    helper.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 把链接和版本号对齐到常量：HTML 里手写的那份只是"没有 JS 时也能点"。 */
function syncCommunityLinks() {
  for (const link of document.querySelectorAll('[data-community-link]')) link.href = COMMUNITY_URL;
  const url = $('community-url');
  if (url) url.textContent = COMMUNITY_URL;
  const version = $('community-version');
  if (version) version.textContent = `v${GAME_VERSION}`;
}

/** 推荐文案（不是给玩家看的，是给他粘到群里 / 频道里的）。 */
function communityShareText() {
  return [
    `我在玩《中二野人实验室》v${GAME_VERSION}：三年、六个学期、72 次抉择，`,
    '37 种行动、95 个随机事件、29 个结局，高考之后还要自己填六个志愿。',
    `腾讯频道【模拟器发布页】：${COMMUNITY_URL}`,
  ].join('');
}

/** 结局分享文案：带上这一局的成绩，比干巴巴推荐一句有用得多。 */
function endingShareText() {
  const ending = state.view?.ending;
  if (!ending) return communityShareText();
  const bits = [];
  if (ending.total) bits.push(`高考 ${ending.total} / 750`);
  if (ending.rank) bits.push(`年级第 ${ending.rank} 名`);
  if (ending.achievements?.length) bits.push(`${ending.achievements.length} 个成就`);
  return [
    `我在《中二野人实验室》v${GAME_VERSION} 里打出了「${ending.title}」`,
    bits.length > 0 ? `（${bits.join('，')}）` : '',
    `。腾讯频道【模拟器发布页】：${COMMUNITY_URL}`,
  ].join('');
}

function openCommunityModal() {
  syncCommunityLinks();
  $('community-modal').classList.remove('hidden');
}

/* ------------------------------------------------------------ 请求包装 */

/**
 * 统一的"忙碌"包装：请求期间禁用作用域内所有按钮，避免重复点击；
 * 出错走 toast，结束后重画行动区与商店。
 */
async function guard(scope, run) {
  if (state.busy) return;
  state.busy = true;
  if (scope) for (const button of scope.querySelectorAll('button')) button.disabled = true;
  document.body.style.cursor = 'progress';
  try {
    await run();
  } catch (error) {
    toast(error?.message ?? '出错了，请再试一次');
  } finally {
    state.busy = false;
    document.body.style.cursor = '';
    if (state.view) {
      renderActions(state.view);
      if (!$('shop-modal').classList.contains('hidden')) renderShop(state.view);
    }
  }
}

/* ------------------------------------------------------------ 顶栏 */

function renderTopbar(view) {
  const next = view.nextExam;
  const nextText = next
    ? `${escapeHtml(next.name)}${next.inWeeks === 0 ? '（本周）' : `（${next.inWeeks} 周后）`}`
    : '无';
  const progress = view.endless
    ? `第 <b>${view.turn + 1}</b> 周（不设上限）`
    : `距离高考 <b>${view.weeksLeft}</b> 周`;
  const goal = view.build.goal;
  $('topbar-info').innerHTML = `
    <span>👤 <b>${escapeHtml(view.student.name)}</b>　${escapeHtml(view.student.className ?? '')}　${escapeHtml(view.selection.label)}</span>
    <span>📅 <b>${escapeHtml(view.calendarLabel)}</b></span>
    <span>⏳ ${progress}</span>
    <span>📝 下一场：<b>${nextText}</b></span>
    <span>🎯 ${goal ? `${goal.icon} ${escapeHtml(goal.name)}` : '未定目标'}　预估 <b>${view.estimateTotal}</b> / 750</span>
    <span>${view.status === 'ended' ? '🏁 已结局' : view.endless ? '🕊️ 自由模式' : '· 进行中'}</span>
  `;
}

/* ------------------------------------------------------------ 左栏 */

function renderStats(view) {
  const rows = Object.entries(view.statMeta)
    .map(([key, meta]) => {
      const value = view.stats[key] ?? 0;
      return `
        <div class="stat-row" title="${escapeHtml(meta.desc)}">
          <span>${meta.icon} ${escapeHtml(meta.name)}</span>
          ${meter(value, meta.max, statColor(meta, value))}
          <span class="stat-value">${Math.round(value)}</span>
        </div>`;
    })
    .join('');
  $('stats').innerHTML =
    rows + `<div class="money-row"><span>💰 零花钱</span><b>${view.stats.money} 元</b></div>`;
}

function renderSubjects(view) {
  $('subjects').innerHTML = view.subjects
    .map(
      (subject) => `
      <div class="subject-row" title="${escapeHtml(subject.name)}：知识 ${subject.knowledge} / 100">
        <span>${subject.icon} ${escapeHtml(subject.name)}</span>
        ${meter(subject.knowledge, 100, ratioColor(subject.knowledge, 100))}
        <span class="sub-score">${subject.estimate}/${subject.max}</span>
      </div>`,
    )
    .join('');
}

/** 开局构筑：选科、家庭背景、高考目标、天赋。 */
function renderBuild(view) {
  const traits = view.build.traits
    .map((trait) => `<span class="chip" title="${escapeHtml(trait.desc)}">${trait.icon} ${escapeHtml(trait.name)}</span>`)
    .join('');
  const background = view.build.background
    ? `<div class="build-row"><span class="muted">家庭</span><b>${view.build.background.icon} ${escapeHtml(view.build.background.name)}</b></div>`
    : '';
  const goal = view.build.goal
    ? `<div class="build-row"><span class="muted">目标</span><b>${view.build.goal.icon} ${escapeHtml(view.build.goal.name)}</b></div>
       <p class="muted small">${escapeHtml(view.build.goal.desc ?? '')}</p>`
    : '';

  // 难度 + 「不进则退」的提示：让玩家知道不学的科目每周会掉多少
  const diff = view.difficulty ?? {};
  const decay = view.decayPerWeek ?? {};
  const difficulty = `<div class="build-row"><span class="muted">难度</span><b>${diff.icon ?? ''} ${escapeHtml(diff.name ?? '')}</b></div>`;
  const forgetting = decay.idle
    ? `<p class="muted small" title="每周结算时，这一周没碰过的科目会忘掉这么多">
         📉 不进则退：周末不学习，每科每周约 -${decay.idle}；学过的那科几乎不掉
       </p>`
    : '';
  const profile = view.startProfile?.lopsided
    ? `<p class="muted small">💀 偏科开局${
        view.startProfile.weakNames?.length ? `：${escapeHtml(view.startProfile.weakNames.join('、'))}是短板` : ''
      }</p>`
    : '';

  // 自定义人物：性格、缺陷、属性点、外号——让玩家在游戏里也能看到"我捏的人"
  const build = view.build ?? {};
  const creator = [];
  if (view.student?.nickname) creator.push(`<div class="build-row"><span class="muted">外号</span><b>「${escapeHtml(view.student.nickname)}」</b></div>`);
  if (build.personality && build.personality.id !== 'plain') {
    creator.push(
      `<div class="build-row"><span class="muted">性格</span><b title="${escapeHtml(build.personality.desc ?? '')}">${build.personality.icon} ${escapeHtml(
        build.personality.name,
      )}</b></div>`,
    );
  }
  if (build.flaws?.length) {
    creator.push(
      `<div class="chips">${build.flaws
        .map((flaw) => `<span class="chip flaw" title="${escapeHtml(flaw.desc)}">${flaw.icon} ${escapeHtml(flaw.name)}</span>`)
        .join('')}</div>`,
    );
  }
  if (build.points?.spent) {
    const spent = Object.entries(build.points.spend ?? {})
      .map(([key, value]) => {
        const meta = state.options?.pointBuy?.find((item) => item.key === key);
        return meta ? `${meta.name} ${value}` : null;
      })
      .filter(Boolean);
    const subjects = Object.entries(build.points.subjects ?? {})
      .map(([key, value]) => `${subjectName(key)} ${value}`)
      .filter(Boolean);
    creator.push(
      `<p class="muted small">🧬 属性点 ${build.points.spent}/${build.points.budget + (build.points.legacy ?? 0)}：${escapeHtml(
        [...spent, ...subjects].join('　') || '—',
      )}</p>`,
    );
  }
  if (build.legacyPoints) creator.push(`<p class="muted small">🔁 多周目传承：额外 ${build.legacyPoints} 点属性点</p>`);
  if (view.customRules) creator.push('<p class="muted small">🛠️ 这一局用的是自定义难度</p>');

  $('build').innerHTML = `
    <div class="build-row"><span class="muted">选科</span><b>${escapeHtml(view.selection.label)}</b></div>
    ${background}
    ${goal}
    ${difficulty}
    <div class="chips">${traits || '<span class="muted">没有天赋</span>'}</div>
    ${creator.join('')}
    ${profile}
    ${forgetting}
  `;
}

function renderNpc(view) {
  $('npc').innerHTML = view.npc
    .map(
      (npc) => `
      <div class="npc-row" data-relations="1" title="${escapeHtml(npc.name)}：${escapeHtml(npc.desc ?? '')}">
        <span>${npc.icon} ${escapeHtml(npc.short ?? npc.role ?? npc.name)}</span>
        ${meter(npc.value, 100, ratioColor(npc.value, 100))}
        <span class="npc-value">${npc.value}</span>
      </div>`,
    )
    .join('');
  // 点人际关系那一栏，直接看关系图
  for (const row of $('npc').querySelectorAll('[data-relations]')) {
    row.addEventListener('click', openRelationsModal);
  }
}

function renderItems(view) {
  $('items').innerHTML = view.items.length
    ? `<div class="chips">${view.items
        .map((item) => `<span class="chip" title="${escapeHtml(item.desc)}">${item.icon} ${escapeHtml(item.name)}</span>`)
        .join('')}</div>`
    : '<p class="muted">还没买过东西，去 🛒 商店看看。</p>';
}

/* ------------------------------------------------------------ 中栏：行动 */

function actionCard(action) {
  const meta = [];
  if (action.cost) meta.push(`花费 ${action.cost} 元`);
  if (action.cooldownLeft) meta.push(`冷却 ${action.cooldownLeft} 周`);
  if (action.once) meta.push('一局一次');
  if (action.needsSubject) meta.push('需要选科');
  const disabled = action.available ? '' : 'disabled';
  return `<button class="action-card" data-action="${escapeHtml(action.id)}" ${disabled}>
    <span class="action-name">${action.icon} ${escapeHtml(action.name)}</span>
    <span class="action-desc">${escapeHtml(action.desc)}</span>
    ${meta.length ? `<span class="action-meta">${meta.map(escapeHtml).join('　')}</span>` : ''}
    ${action.available ? '' : `<span class="action-reason">✕ ${escapeHtml(action.reason ?? '现在做不了')}</span>`}
  </button>`;
}

function renderActions(view) {
  const tags = [...new Set(view.actions.map((action) => action.tag))];
  $('actions').innerHTML = tags
    .map(
      (tag) =>
        `<div class="action-group" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</div>` +
        view.actions
          .filter((action) => action.tag === tag)
          .map(actionCard)
          .join(''),
    )
    .join('');

  renderActionTabs(view, tags);

  // 当前阶段徽章：主行动 100%，周末按 weekendScale 打折
  const phase = $('phase-badge');
  phase.className = `phase-banner ${view.phase === 'weekend' ? 'weekend' : 'main'}`;
  phase.innerHTML =
    view.phase === 'weekend'
      ? `<b>🌇 ${escapeHtml(view.phaseLabel)}</b><span>周末安排效果约 ${pct(view.weekendScale)}，适合休息、赚钱和经营关系。</span>`
      : `<b>🏫 ${escapeHtml(view.phaseLabel)}</b><span>本周主行动效果 100%，学习推进主要靠它。</span>`;

  const usable = view.actions.filter((action) => action.available).length;
  $('action-hint').textContent = state.busy ? '处理中…' : `共 ${usable} 个可做`;

  for (const button of $('actions').querySelectorAll('button[data-action]')) {
    button.addEventListener('click', () => {
      const action = view.actions.find((item) => item.id === button.dataset.action);
      if (!action) return;
      if (action.needsSubject) openSubjectModal(action);
      else doAction(action.id);
    });
  }
}

/**
 * 行动分组快速跳转条。
 *
 * 37 个行动分成七组，手机上从头翻到尾很累（而且以前还翻不到底），
 * 所以给一排可以直接跳过去的分组标签：点了就滚到那一组。
 * 顺带把"当前正在看哪一组"高亮出来。
 */
function renderActionTabs(view, tags) {
  const tabs = $('action-tabs');
  if (!tabs) return;
  tabs.innerHTML = tags
    .map((tag) => {
      const count = view.actions.filter((action) => action.tag === tag && action.available).length;
      return `<button type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}<span class="muted small"> ${count}</span></button>`;
    })
    .join('');

  const scrollToTag = (tag) => {
    const group = $('actions').querySelector(`.action-group[data-tag="${CSS.escape(tag)}"]`);
    if (!group) return;
    // scrollIntoView 会自动选对滚动容器：桌面是每一栏自己滚，手机是整页滚。
    // 顶部留出的空隙由 CSS 的 .action-group { scroll-margin-top } 负责。
    // 这里刻意不做平滑动画：从"学习"跳到"大事"要滚过三十多张卡片，
    // 动画期间玩家什么也做不了，直接落位反而干脆。
    group.scrollIntoView({ block: 'start' });
    highlight(tag);
  };

  const highlight = (tag) => {
    for (const button of tabs.querySelectorAll('button[data-tag]')) {
      button.classList.toggle('on', button.dataset.tag === tag);
    }
  };

  for (const button of tabs.querySelectorAll('button[data-tag]')) {
    button.addEventListener('click', () => scrollToTag(button.dataset.tag));
  }
  if (tags.length > 0) highlight(tags[0]);
}

/* ------------------------------------------------------------ 右栏 */

function renderLog(view) {
  $('log').innerHTML =
    view.log
      .slice()
      .reverse()
      .map(
        (entry) => `
        <div class="log-entry" data-kind="${escapeHtml(entry.kind)}">
          <div class="log-at">${escapeHtml(entry.at)}</div>
          <div class="log-title">${escapeHtml(entry.title)}</div>
          <div class="log-text">${escapeHtml(entry.text ?? '')}</div>
        </div>`,
      )
      .join('') || '<p class="muted">还没有发生什么。</p>';
}

function renderExams(view) {
  $('exams').innerHTML = view.exams.length
    ? view.exams
        .slice()
        .reverse()
        .map(
          (exam) => `
          <div class="exam-row">
            <span class="exam-name">${escapeHtml(exam.name)}</span>
            <span><b>${exam.total}</b> 分　第 ${exam.rank} 名</span>
          </div>`,
        )
        .join('')
    : '<p class="muted">还没有考过试。</p>';
}

/* ------------------------------------------------------------ 主渲染 */

/**
 * 只重画常驻界面（顶栏 + 三栏），**不碰任何弹层**。
 *
 * 内容包热更新、志愿提交之后都要刷一遍界面文案（行动说明、事件数、状态），
 * 但那时玩家的弹层还开着，所以不能走 render()（它会重新打开事件 / 结局弹层）。
 */
function renderPanels(view) {
  state.view = view;
  $('motto').textContent = `${view.school.motto}　·　${view.school.city}`;
  $('layout').hidden = false;
  renderTopbar(view);
  renderStats(view);
  renderSubjects(view);
  renderBuild(view);
  renderNpc(view);
  renderItems(view);
  renderActions(view);
  renderLog(view);
  renderExams(view);
}

function render(view) {
  renderPanels(view);
  renderVersus(view);
  if (view.pendingEvent) openEventModal(view.pendingEvent);
  if (view.status === 'ended' && view.ending) {
    recordRun(view);
    recordLeaderboardRun(view);
    renderEnding(view.ending);
  } else if (view.status === 'volunteering' && view.volunteer?.active && !view.volunteer?.submitted) {
    // 高考出分之后、录取之前：先填志愿，填完才进结局
    openVolunteerModal();
  }
}

/**
 * ⚔️ 对战面板（只有 AI 对战模式才显示）。
 *
 * 只显示"能立刻做判断"的三个数：两边最近一次考试的分数与名次、交手记录。
 * 别把 AI 的属性摊开——那是另一个人的隐私，也是玩家不需要操心的细节。
 */
function renderVersus(view) {
  const title = $('versus-title');
  const node = $('versus-body');
  if (!title || !node) return;
  const versus = view?.versus;
  if (!versus?.active) {
    title.hidden = true;
    node.hidden = true;
    node.innerHTML = '';
    return;
  }

  title.hidden = false;
  node.hidden = false;
  const level = versus.level ?? {};
  const me = versus.you?.exam;
  const rival = versus.rival ?? {};
  const ai = rival.exam;
  const ahead = versus.ahead;
  const note = !versus.last
    ? '还没考过试，先各自过日子。'
    : versus.last.winner === 'tie'
      ? '上一次考试打平。'
      : versus.last.winner === 'you'
        ? `上一次考试你领先 ${Math.abs(versus.last.diff)} 分。`
        : `上一次考试你落后 ${Math.abs(versus.last.diff)} 分。`;

  node.innerHTML = `
    <p class="versus-level">${level.icon ?? '⚔️'} ${escapeHtml(level.name ?? '')} AI · ${escapeHtml(level.style ?? '')}</p>
    <div class="versus-row ${ahead === 'you' ? 'ok' : ''}">
      <span class="versus-who">你</span>
      <span class="versus-score">${me ? `${me.total} 分 · 年级第 ${me.rank}` : `预估 ${versus.you?.estimateTotal ?? view.estimateTotal} 分`}</span>
    </div>
    <div class="versus-row ${ahead === 'rival' ? 'miss' : ''}">
      <span class="versus-who">${escapeHtml(rival.avatarIcon ?? '🧑')} ${escapeHtml(rival.name ?? '对手')}</span>
      <span class="versus-score">${ai ? `${ai.total} 分 · 年级第 ${ai.rank}` : `预估 ${rival.estimateTotal ?? 0} 分`}</span>
    </div>
    <p class="versus-note">${escapeHtml(note)}${
      versus.records.length
        ? `　交手 ${versus.records.length} 次：你胜 ${versus.wins.you} · 对手胜 ${versus.wins.rival}${versus.wins.tie ? ` · 平 ${versus.wins.tie}` : ''}`
        : ''
    }</p>`;
}

/** 结局页里那一方的分数怎么念（没有高考分的是特殊路线，标一下等效判定）。 */
function versusScoreText(side) {
  const score = side.total ? `${side.total} 分` : '未参加高考';
  const rank = side.rank ? ` · 年级第 ${side.rank} 名` : '';
  return `${score}${rank}${side.equivalent ? '（按结局档次等效判定）' : ''}`;
}

function versusEndingHtml(versus) {
  if (!versus) return '';
  const verdict =
    versus.winner === 'you' ? '你赢了' : versus.winner === 'rival' ? `${versus.rival.name} 赢了` : '打平';
  return `
    <div class="versus-card ${versus.winner === 'you' ? 'win' : versus.winner === 'rival' ? 'lose' : ''}">
      <div class="versus-head">⚔️ ${escapeHtml(versus.level.icon ?? '')} ${escapeHtml(versus.level.name)} AI 对战 · <b>${escapeHtml(verdict)}</b></div>
      <div class="versus-line"><span>你</span><b>${escapeHtml(versus.you.endingTitle)}</b><i>${escapeHtml(versusScoreText(versus.you))}</i></div>
      <div class="versus-line"><span>${escapeHtml(versus.rival.name)}</span><b>${escapeHtml(versus.rival.endingTitle)}</b><i>${escapeHtml(versusScoreText(versus.rival))}</i></div>
      <div class="versus-foot">考试交手 ${versus.records.length} 次：你胜 ${versus.wins.you} · 对手胜 ${versus.wins.rival} · 平 ${versus.wins.tie}　·　${escapeHtml(versus.level.desc ?? '')}</div>
    </div>`;
}

/* ------------------------------------------------------------ 开局构筑 */

const keyOf = (item) => item.key ?? item.id;
const attrItems = () => (state.options?.pointBuy ?? []).filter((item) => !item.perSubject);
const subjectPointItem = () => (state.options?.pointBuy ?? []).find((item) => item.perSubject);
const listOf = (key) => state.options?.[key] ?? [];

/** 通用卡片组：单选或多选。 */
function renderPickGrid(node, items, selected, multi, onToggle) {
  node.innerHTML = items
    .map((item) => {
      const key = keyOf(item);
      const on = selected.includes(key);
      return `<button type="button" class="pick-card${on ? ' on' : ''}" data-key="${escapeHtml(key)}">
        <span class="pick-icon">${item.icon ?? '•'}</span>
        <span class="pick-name">${escapeHtml(item.name)}</span>
        <span class="pick-desc">${escapeHtml(item.desc ?? '')}</span>
        <span class="pick-mark">${on ? '✓ 已选' : multi ? '点击选择' : '选择'}</span>
      </button>`;
    })
    .join('');
  for (const button of node.querySelectorAll('button[data-key]')) {
    button.addEventListener('click', () => onToggle(button.dataset.key));
  }
}

/** 多选：选满 limit 之后再点新的，就替换掉最早选的那个。 */
function toggleMulti(list, key, limit) {
  const index = list.indexOf(key);
  if (index >= 0) {
    list.splice(index, 1);
    return;
  }
  if (list.length >= limit) list.shift();
  list.push(key);
}

function electiveLimit() {
  return Number(state.options?.electivePick) || 2;
}

function traitLimit() {
  return Number(state.options?.maxTraits) || TRAIT_PICK;
}

function flawLimit() {
  return Number(state.options?.maxFlaws) || MAX_FLAWS;
}

/* -------------------------------------------- 自定义人物：草稿与预算 */

function defaultDraft() {
  return {
    name: '',
    gender: '男',
    nickname: '',
    avatar: 'student',
    personality: 'plain',
    flaws: [],
    points: { spend: {}, subjects: {} },
    customCast: {},
    track: 'physics',
    electives: [],
    traits: [],
    background: 'worker',
    goal: 'yiben',
    difficulty: 'normal',
    custom: {},
    weeksPerSemester: 6,
    seed: '',
    endless: false,
    preset: null,
    /** v3.0：'solo' | 'versus'（玩法）与 AI 强度档 */
    mode: 'solo',
    rivalLevel: 'normal',
  };
}

/** 难度给的基础属性点预算（自定义难度用滑杆上的值）。 */
function pointBudgetBase() {
  const draft = state.draft;
  if (draft.difficulty === 'custom') {
    const knob = listOf('customKnobs').find((item) => item.id === 'points');
    return Math.round(Number(draft.custom?.points ?? knob?.def ?? 12));
  }
  const table = state.options?.pointBudget ?? {};
  return Number(table[draft.difficulty] ?? table.normal ?? 12);
}

/** 缺陷换来的点数。 */
function flawPoints() {
  const table = new Map(listOf('flaws').map((item) => [item.id, item]));
  return state.draft.flaws.reduce((sum, id) => sum + (table.get(id)?.points ?? 0), 0);
}

/** 多周目传承点：玩满若干局就能多几点属性点（跟图鉴共用一份数据）。 */
function legacyPoints() {
  const info = state.options?.legacy ?? { runsPerPoint: 2, max: 6 };
  const per = Number(info.runsPerPoint) || 2;
  const runs = loadProfile().runs ?? 0;
  return Math.min(Number(info.max) || 6, Math.floor(runs / per));
}

function budgetInfo() {
  const base = pointBudgetBase();
  const flaw = flawPoints();
  const legacy = legacyPoints();
  return { base, flaw, legacy, total: base + flaw + legacy };
}

function spentPoints() {
  const { spend = {}, subjects = {} } = state.draft.points ?? {};
  return [...Object.values(spend), ...Object.values(subjects)].reduce((sum, value) => sum + value, 0);
}

/** 当前选科对应的六门课（跟引擎的 subjectsFor 一致）。 */
function selectedSubjects() {
  const pool = new Map(listOf('subjects').map((item) => [item.key, item]));
  const keys = ['chinese', 'math', 'english', state.draft.track, ...state.draft.electives];
  return keys.filter(Boolean).map((key) => pool.get(key) ?? { key, name: subjectName(key), icon: '📘' });
}

/* -------------------------------------------- 自定义人物：各区块渲染 */

function renderAvatars() {
  const node = $('avatar-options');
  node.innerHTML = listOf('avatars')
    .map(
      (item) =>
        `<button type="button" class="avatar-btn${state.draft.avatar === item.id ? ' on' : ''}" data-avatar="${escapeHtml(item.id)}" title="${escapeHtml(item.name)}">${item.icon}</button>`,
    )
    .join('');
  for (const button of node.querySelectorAll('button[data-avatar]')) {
    button.addEventListener('click', () => {
      state.draft.avatar = button.dataset.avatar;
      renderBuildForm();
    });
  }
}

function renderPersonalities() {
  renderPickGrid($('personality-options'), listOf('personalities'), [state.draft.personality], false, (key) => {
    state.draft.personality = key;
    renderBuildForm();
  });
}

function renderFlaws() {
  renderPickGrid($('flaw-options'), listOf('flaws'), state.draft.flaws, true, (key) => {
    toggleMulti(state.draft.flaws, key, flawLimit());
    renderBuildForm();
  });
}

/**
 * v3.0 玩法：单人 / AI 对战。
 *
 * 选 AI 对战才会把"AI 强度"放出来——两个选择放在同一个区块里，
 * 顺序就是玩家的思考顺序：先决定跟谁玩，再决定对手多强。
 */
function renderModes() {
  renderPickGrid($('mode-options'), listOf('modes'), [state.draft.mode], false, (key) => {
    state.draft.mode = key;
    renderBuildForm();
  });
  renderRivalLevels();
}

function renderRivalLevels() {
  const box = $('rival-levels');
  if (!box) return;
  const versus = state.draft.mode === 'versus';
  box.hidden = !versus;
  if (!versus) return;
  renderPickGrid($('rival-options'), listOf('rivalLevels'), [state.draft.rivalLevel], false, (key) => {
    state.draft.rivalLevel = key;
    renderBuildForm();
  });
}

function renderPresets() {
  renderPickGrid($('preset-options'), listOf('presets'), state.draft.preset ? [state.draft.preset] : [], false, (key) => {
    applyPreset(key);
  });
}

/**
 * 属性点：每个属性一行加减号，单科底子用"点一下加一级"的方块。
 *
 * 为什么不用滑杆：手机上滑杆太细，容易点错；加减号 + 方块在两个平台上都稳。
 */
function renderPoints() {
  const info = budgetInfo();
  const spent = spentPoints();
  const over = spent > info.total;
  const draft = state.draft;

  const parts = [`难度 ${info.base} 点`];
  if (info.flaw) parts.push(`缺陷 +${info.flaw}`);
  if (info.legacy) parts.push(`传承 +${info.legacy}`);
  $('point-budget').innerHTML =
    `属性点预算 <b>${info.total}</b> 点（${parts.join('　')}）　已用 <b class="${over ? 'budget-over' : ''}">${spent}</b> 点` +
    (over ? '　⚠️ 超了，超出的部分会被砍掉' : '');

  const fill = $('point-fill');
  fill.style.width = `${(info.total ? Math.min(1, spent / info.total) * 100 : 0).toFixed(1)}%`;
  fill.className = `point-fill${over ? ' over' : ''}`;

  $('point-attrs').innerHTML = attrItems()
    .map((item) => {
      const value = Number(draft.points.spend?.[item.key] ?? 0);
      return `<div class="point-row">
        <span class="point-label">${item.icon ?? '•'} ${escapeHtml(item.name)}<small>1 点 = +${item.per}</small></span>
        <span class="point-controls">
          <button type="button" class="point-btn" data-point="${item.key}" data-delta="-1" ${value <= 0 ? 'disabled' : ''}>−</button>
          <span class="point-value">${value}<small>/${item.max}</small></span>
          <button type="button" class="point-btn" data-point="${item.key}" data-delta="1" ${value >= item.max ? 'disabled' : ''}>＋</button>
        </span>
        <span class="point-desc muted small">${escapeHtml(item.desc ?? '')}</span>
      </div>`;
    })
    .join('');
  for (const button of $('point-attrs').querySelectorAll('button[data-point]')) {
    button.addEventListener('click', () => {
      const key = button.dataset.point;
      const delta = Number(button.dataset.delta);
      const item = attrItems().find((entry) => entry.key === key);
      const next = Math.max(0, Math.min(item?.max ?? 0, (draft.points.spend[key] ?? 0) + delta));
      if (next) draft.points.spend[key] = next;
      else delete draft.points.spend[key];
      renderBuildForm();
    });
  }

  const knowledgeItem = subjectPointItem();
  const perSubject = knowledgeItem?.per ?? 4;
  const subjectMax = knowledgeItem?.max ?? 3;
  $('point-subjects').innerHTML = selectedSubjects()
    .map((subject) => {
      const value = Number(draft.points.subjects?.[subject.key] ?? 0);
      return `<button type="button" class="point-subject${value ? ' on' : ''}" data-subject="${subject.key}" title="点一下加一点，满 ${subjectMax} 点后再点清零">
        <span class="point-subject-name">${subject.icon ?? '📘'} ${escapeHtml(subject.name)}</span>
        <span class="point-subject-value">${value}/${subjectMax}<small>+${value * perSubject}</small></span>
      </button>`;
    })
    .join('');
  for (const button of $('point-subjects').querySelectorAll('button[data-subject]')) {
    button.addEventListener('click', () => {
      const key = button.dataset.subject;
      const next = ((draft.points.subjects[key] ?? 0) + 1) % (subjectMax + 1);
      if (next) draft.points.subjects[key] = next;
      else delete draft.points.subjects[key];
      renderBuildForm();
    });
  }
}

/** 自定义关系人物：四个同学角色位的名字 + 性别。 */
function renderCastRoles() {
  const roles = listOf('castRoles').filter((role) => role.group === 'class');
  $('cast-roles').innerHTML = roles
    .map((role) => {
      const entry = state.draft.customCast?.[role.id] ?? {};
      const fallback = role.gender === 'same' ? state.draft.gender : role.gender === 'opposite' ? (state.draft.gender === '女' ? '男' : '女') : role.gender;
      const current = entry.gender ?? fallback;
      const options = ['男', '女']
        .map((value) => `<option value="${value}"${value === current ? ' selected' : ''}>${value}</option>`)
        .join('');
      return `<div class="cast-role-row">
        <span class="cast-role-name">${role.icon} ${escapeHtml(role.role)}</span>
        <input type="text" maxlength="12" data-cast-name="${role.id}" placeholder="留空则随机" value="${escapeHtml(entry.name ?? '')}" />
        <select data-cast-gender="${role.id}" title="TA 的性别">${options}</select>
      </div>`;
    })
    .join('');
  for (const input of $('cast-roles').querySelectorAll('input[data-cast-name]')) {
    input.addEventListener('input', () => {
      const role = input.dataset.castName;
      const entry = state.draft.customCast[role] ?? {};
      const name = input.value.trim();
      if (name) state.draft.customCast[role] = { ...entry, name };
      else delete entry.name;
      if (!state.draft.customCast[role] || (!state.draft.customCast[role].name && !state.draft.customCast[role].gender)) {
        delete state.draft.customCast[role];
      }
      updateBuildHint();
    });
  }
  for (const select of $('cast-roles').querySelectorAll('select[data-cast-gender]')) {
    select.addEventListener('change', () => {
      const role = select.dataset.castGender;
      state.draft.customCast[role] = { ...(state.draft.customCast[role] ?? {}), gender: select.value };
    });
  }
}

/** 自定义难度的滑杆。 */
function renderCustomKnobs() {
  const node = $('custom-knobs');
  const custom = state.draft.difficulty === 'custom';
  node.hidden = !custom;
  if (!custom) return;
  node.innerHTML = listOf('customKnobs')
    .map((knob) => {
      const value = Number(state.draft.custom?.[knob.id] ?? knob.def);
      return `<div class="knob-row">
        <label class="knob-label" for="knob-${knob.id}">${knob.icon} ${escapeHtml(knob.name)}</label>
        <input type="range" id="knob-${knob.id}" data-knob="${knob.id}" min="${knob.min}" max="${knob.max}" step="${knob.step}" value="${value}" />
        <span class="knob-value" id="knob-value-${knob.id}">${formatKnob(knob, value)}</span>
        <span class="knob-desc muted small">${escapeHtml(knob.desc ?? '')}</span>
      </div>`;
    })
    .join('');
  for (const input of node.querySelectorAll('input[data-knob]')) {
    input.addEventListener('input', () => {
      const knob = listOf('customKnobs').find((item) => item.id === input.dataset.knob);
      state.draft.custom[input.dataset.knob] = Number(input.value);
      const label = $(`knob-value-${input.dataset.knob}`);
      if (label && knob) label.textContent = formatKnob(knob, Number(input.value));
      // 点数预算滑杆会影响属性点，所以这里要顺手刷新属性点区
      if (input.dataset.knob === 'points') renderPoints();
      updateBuildHint();
    });
  }
}

function formatKnob(knob, value) {
  if (knob.format === 'pct') return pct(value);
  if (knob.format === 'bool') return value >= 0.5 ? '开' : '关';
  if (knob.format === 'mul') return `×${value.toFixed(2)}`;
  return String(value);
}

/* -------------------------------------------- 表单 <-> 草稿 */

/** 把输入框里的值收进草稿（不重绘，避免打字时丢焦点）。 */
function syncDraftFromForm() {
  const draft = state.draft;
  draft.name = $('input-name').value.trim();
  draft.gender = $('input-gender').value === '女' ? '女' : '男';
  draft.nickname = $('input-nickname').value.trim();
  draft.difficulty = $('input-difficulty').value || 'normal';
  draft.weeksPerSemester = Number($('input-weeks').value) || state.options?.defaultWeeks || 6;
  draft.seed = $('input-seed').value.trim();
  draft.endless = $('input-endless').checked;
  return draft;
}

/** 把草稿写回输入框（换模板 / 读角色卡 / 随机时用）。 */
function applyDraftToForm() {
  const draft = state.draft;
  $('input-name').value = draft.name ?? '';
  $('input-gender').value = draft.gender === '女' ? '女' : '男';
  $('input-nickname').value = draft.nickname ?? '';
  $('input-difficulty').value = draft.difficulty ?? 'normal';
  $('input-weeks').value = String(draft.weeksPerSemester ?? 6);
  $('input-seed').value = draft.seed ?? '';
  $('input-endless').checked = Boolean(draft.endless);
  renderDifficultyHint();
}

/** 难度下拉下面挂一行说明；自定义难度时把滑杆放出来。 */
function renderDifficultyHint() {
  const select = $('input-difficulty');
  const hint = $('difficulty-hint');
  if (!select || !hint) return;
  const item = listOf('difficulties').find((entry) => entry.key === select.value);
  hint.textContent = item?.desc ? `${item.icon ?? ''} ${item.desc}`.trim() : '';
  hint.title = hint.textContent;
}

/** 用 /api/options 填充开局表单的默认值。 */
function applyOptions(options) {
  state.options = options;
  const difficulty = $('input-difficulty');
  difficulty.innerHTML = options.difficulties
    .map((item) => `<option value="${escapeHtml(item.key)}">${item.icon ?? ''} ${escapeHtml(item.name)}</option>`)
    .join('');
  difficulty.value = 'normal';
  difficulty.addEventListener('change', () => {
    state.draft.difficulty = difficulty.value;
    renderDifficultyHint();
    renderCustomKnobs();
    renderPoints();
    updateBuildHint();
  });
  $('input-weeks').value = String(options.defaultWeeks ?? 6);

  state.draft = defaultDraft();
  state.draft.weeksPerSemester = options.defaultWeeks ?? 6;
  state.draft.difficulty = 'normal';
  state.draft.avatar = options.avatars?.[0]?.id ?? 'student';
  state.draft.personality = options.personalities?.find((item) => item.id === 'plain')?.id ?? options.personalities?.[0]?.id ?? 'plain';
  state.draft.track = options.tracks?.[0]?.id ?? 'physics';
  state.draft.background = options.backgrounds?.[0]?.id ?? 'worker';
  state.draft.goal = options.goals?.find((goal) => goal.id === 'yiben')?.id ?? options.goals?.[0]?.id ?? 'yiben';
  for (const knob of listOf('customKnobs')) state.draft.custom[knob.id] = knob.def;
  applyDraftToForm();
  renderBuildForm();
  updateCardCount();
}

/** 选完选项之后统一重绘（按钮类的交互都走这里，不会影响输入框焦点）。 */
function renderBuildForm() {
  if (!state.options) return;
  syncDraftFromForm();
  renderPresets();
  renderModes();
  renderAvatars();
  renderPersonalities();
  renderFlaws();
  renderPoints();
  renderCastRoles();
  renderCustomKnobs();

  renderPickGrid($('track-options'), state.options.tracks, [state.draft.track], false, (key) => {
    state.draft.track = key;
    renderBuildForm();
  });
  renderPickGrid($('elective-options'), state.options.electives, state.draft.electives, true, (key) => {
    toggleMulti(state.draft.electives, key, electiveLimit());
    renderBuildForm();
  });
  renderPickGrid($('trait-options'), state.options.traits, state.draft.traits, true, (key) => {
    toggleMulti(state.draft.traits, key, traitLimit());
    renderBuildForm();
  });
  renderPickGrid($('background-options'), state.options.backgrounds, [state.draft.background], false, (key) => {
    state.draft.background = key;
    renderBuildForm();
  });
  renderPickGrid($('goal-options'), state.options.goals, [state.draft.goal], false, (key) => {
    state.draft.goal = key;
    renderBuildForm();
  });

  $('trait-count').textContent = `　已选 ${state.draft.traits.length}/${traitLimit()}`;
  updateBuildHint();
}

/** 只刷新底部的提示与"开始三年"按钮。 */
function updateBuildHint() {
  if (!state.options) return;
  syncDraftFromForm();
  const draft = state.draft;
  const info = budgetInfo();
  const spent = spentPoints();
  const problems = [];
  if (draft.electives.length !== electiveLimit()) {
    problems.push(`再选科目必须正好选 ${electiveLimit()} 门（还差 ${electiveLimit() - draft.electives.length} 门）`);
  }
  if (draft.traits.length !== traitLimit()) {
    problems.push(`天赋必须正好选 ${traitLimit()} 个（还差 ${traitLimit() - draft.traits.length} 个）`);
  }
  if (draft.flaws.length > flawLimit()) problems.push(`缺陷最多选 ${flawLimit()} 个`);
  if (spent > info.total) problems.push(`属性点超了 ${spent - info.total} 点`);

  const hint = $('build-hint');
  hint.className = `build-hint${problems.length ? '' : ' ready'}`;
  const who = `${draft.name || '（随机姓名）'}${draft.nickname ? `「${draft.nickname}」` : ''}`;
  const modeText =
    draft.mode === 'versus'
      ? `⚔️ AI 对战（${listOf('rivalLevels').find((item) => item.key === draft.rivalLevel)?.name ?? '普通'}）`
      : '🎮 单人模式';
  hint.textContent = problems.length
    ? `⚠️ ${problems.join('；')}`
    : `✅ ${who} 构筑完成，可以开始三年了。${modeText}　属性点已用 ${spent}/${info.total}。`;
  $('btn-start').disabled = problems.length > 0;
}

/* -------------------------------------------- 模板 / 随机 / 角色卡 */

/** 一键套用角色模板（只改"人"，不改选科）。 */
function applyPreset(id) {
  const preset = listOf('presets').find((item) => item.id === id);
  if (!preset) return;
  const draft = state.draft;
  draft.preset = id;
  if (preset.avatar) draft.avatar = preset.avatar;
  if (preset.personality) draft.personality = preset.personality;
  draft.flaws = preset.flaw ? [preset.flaw] : [];
  if (preset.background) draft.background = preset.background;
  if (preset.goal) draft.goal = preset.goal;
  if (preset.traits) draft.traits = preset.traits.filter((trait) => state.options.traits.some((item) => item.id === trait)).slice(0, traitLimit());
  draft.points = { spend: {}, subjects: {} };
  for (const [key, value] of Object.entries(preset.points ?? {})) {
    if (key === 'subjects') continue;
    if (attrItems().some((item) => item.key === key)) draft.points.spend[key] = Number(value) || 0;
  }
  const subjectKeys = new Set(selectedSubjects().map((subject) => subject.key));
  for (const [key, value] of Object.entries(preset.points?.subjects ?? {})) {
    if (subjectKeys.has(key)) draft.points.subjects[key] = Number(value) || 0;
  }
  renderBuildForm();
  toast(`已套用模板「${preset.name}」，接下来可以自己改。`);
}

/** 随机捏一个人：名字、外号、头像、性格、天赋、缺陷、属性点全部随机。 */
async function randomizeAll() {
  const draft = state.draft;
  const options = state.options ?? {};
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
  if (options.personalities) draft.personality = pickOne(options.personalities).id;
  if (options.avatars) draft.avatar = pickOne(options.avatars).id;
  if (options.traits) {
    const pool = options.traits.slice();
    draft.traits = [];
    while (draft.traits.length < traitLimit() && pool.length) draft.traits.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
  }
  draft.flaws = options.flaws?.length && Math.random() < 0.4 ? [pickOne(options.flaws).id] : [];
  draft.points = { spend: {}, subjects: {} };
  draft.preset = null;
  const info = budgetInfo();
  const attrs = attrItems();
  for (let left = info.total; left > 0; left -= 1) {
    if (Math.random() < 0.35) {
      const subject = pickOne(selectedSubjects());
      const max = subjectPointItem()?.max ?? 3;
      if ((draft.points.subjects[subject.key] ?? 0) < max) {
        draft.points.subjects[subject.key] = (draft.points.subjects[subject.key] ?? 0) + 1;
        continue;
      }
    }
    const usable = attrs.filter((item) => (draft.points.spend[item.key] ?? 0) < item.max);
    if (!usable.length) break;
    const item = pickOne(usable);
    draft.points.spend[item.key] = (draft.points.spend[item.key] ?? 0) + 1;
  }
  try {
    const seed = `${Date.now()}-${Math.random()}`;
    const data = await api(`/api/random-name?gender=${encodeURIComponent(draft.gender)}&seed=${encodeURIComponent(seed)}`);
    draft.name = data.name;
    const nick = await api(`/api/nickname?seed=${encodeURIComponent(seed)}`);
    draft.nickname = nick.nickname;
  } catch {
    /* 随机名字失败也无所谓，留空照样能开局 */
  }
  applyDraftToForm();
  renderBuildForm();
  toast('随机捏了一个人，不满意再点一次。');
}

function resetCreator() {
  const keep = { name: '', gender: state.draft.gender, difficulty: state.draft.difficulty };
  state.draft = defaultDraft();
  state.draft.gender = keep.gender;
  state.draft.difficulty = keep.difficulty === 'custom' ? 'normal' : keep.difficulty;
  state.draft.avatar = state.options?.avatars?.[0]?.id ?? 'student';
  state.draft.personality = 'plain';
  state.draft.track = state.options?.tracks?.[0]?.id ?? 'physics';
  state.draft.background = state.options?.backgrounds?.[0]?.id ?? 'worker';
  state.draft.goal = state.options?.goals?.find((goal) => goal.id === 'yiben')?.id ?? 'yiben';
  state.draft.weeksPerSemester = state.options?.defaultWeeks ?? 6;
  for (const knob of listOf('customKnobs')) state.draft.custom[knob.id] = knob.def;
  applyDraftToForm();
  renderBuildForm();
}

function loadCards() {
  try {
    const raw = localStorage.getItem(CARD_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveCards(list) {
  try {
    localStorage.setItem(CARD_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    toast('角色卡存不下（浏览器存储不可用）。');
  }
  updateCardCount();
}

function updateCardCount() {
  const node = $('card-count');
  if (node) node.textContent = String(loadCards().length);
}

/** 把当前配置打包成一张角色卡。 */
function draftToCard(name) {
  const draft = syncDraftFromForm();
  return {
    id: `card-${Date.now().toString(36)}`,
    name: String(name ?? '').trim().slice(0, 16) || `${draft.name || '无名'}的构筑`,
    at: new Date().toISOString().slice(0, 10),
    draft: JSON.parse(JSON.stringify(draft)),
  };
}

function renderCards() {
  const cards = loadCards();
  const node = $('cards-body');
  if (!cards.length) {
    node.innerHTML = '<p class="muted">还没有角色卡。填一个名字，点上面的"把当前配置存成角色卡"。</p>';
    return;
  }
  node.innerHTML = cards
    .map((card) => {
      const draft = card.draft ?? {};
      const bits = [
        listOf('personalities').find((item) => item.id === draft.personality)?.name,
        (draft.traits ?? []).map((id) => listOf('traits').find((item) => item.id === id)?.name).filter(Boolean).join('+'),
        listOf('backgrounds').find((item) => item.id === draft.background)?.name,
        draft.difficulty,
        `属性点 ${[...Object.values(draft.points?.spend ?? {}), ...Object.values(draft.points?.subjects ?? {})].reduce((a, b) => a + b, 0)}`,
      ].filter(Boolean);
      return `<div class="card-item">
        <div class="card-item-head">
          <b>${escapeHtml(card.name)}</b>
          <span class="muted small">${escapeHtml(card.at ?? '')}</span>
        </div>
        <div class="card-item-desc muted small">${escapeHtml(bits.join('　·　'))}</div>
        <div class="card-item-actions">
          <button type="button" class="ghost" data-load-card="${escapeHtml(card.id)}">读取</button>
          <button type="button" class="ghost" data-delete-card="${escapeHtml(card.id)}">删除</button>
        </div>
      </div>`;
    })
    .join('');
  for (const button of node.querySelectorAll('button[data-load-card]')) {
    button.addEventListener('click', () => {
      const card = loadCards().find((item) => item.id === button.dataset.loadCard);
      if (!card) return;
      state.draft = { ...defaultDraft(), ...JSON.parse(JSON.stringify(card.draft)) };
      state.draft.points ??= { spend: {}, subjects: {} };
      state.draft.customCast ??= {};
      applyDraftToForm();
      renderBuildForm();
      $('cards-modal').classList.add('hidden');
      toast(`已读取角色卡「${card.name}」。`);
    });
  }
  for (const button of node.querySelectorAll('button[data-delete-card]')) {
    button.addEventListener('click', () => {
      saveCards(loadCards().filter((item) => item.id !== button.dataset.deleteCard));
      renderCards();
      toast('角色卡已删除。');
    });
  }
}

function openCardsModal() {
  renderCards();
  $('cards-modal').classList.remove('hidden');
}

function saveCurrentCard() {
  const nameInput = $('input-card-name');
  const card = draftToCard(nameInput.value);
  saveCards([card, ...loadCards()]);
  nameInput.value = '';
  renderCards();
  toast(`已存成角色卡「${card.name}」。`);
}

/* ------------------------------------------------------------ 流程 */

async function startNew() {
  const draft = syncDraftFromForm();
  if (draft.electives.length !== electiveLimit() || draft.traits.length !== traitLimit()) {
    toast('选科和天赋还没选完。');
    return;
  }
  const customCast = {};
  for (const [role, entry] of Object.entries(draft.customCast ?? {})) {
    if (entry?.name || entry?.gender) customCast[role] = { name: entry.name ?? undefined, gender: entry.gender ?? undefined };
  }
  const payload = {
    name: draft.name || undefined,
    gender: draft.gender,
    nickname: draft.nickname || undefined,
    avatar: draft.avatar,
    difficulty: draft.difficulty,
    custom: draft.difficulty === 'custom' ? draft.custom : undefined,
    seed: draft.seed || undefined,
    weeksPerSemester: draft.weeksPerSemester,
    track: draft.track,
    electives: draft.electives.slice(),
    traits: draft.traits.slice(),
    background: draft.background,
    goal: draft.goal,
    personality: draft.personality,
    flaw: draft.flaws[0] ?? undefined,
    points: { ...(draft.points.spend ?? {}), subjects: draft.points.subjects ?? {} },
    legacyPoints: legacyPoints(),
    preset: draft.preset ?? undefined,
    customCast,
    endless: $('input-endless').checked,
    // v3.0 玩法：单人 / AI 对战（AI 强度只在对战时带过去）
    mode: draft.mode ?? 'solo',
    rivalLevel: draft.mode === 'versus' ? draft.rivalLevel : undefined,
    // 只有分享链接会关掉志愿填报（?volunteers=0），正常开局一律走完整流程
    volunteers: draft.volunteers === false ? false : undefined,
  };
  await guard($('start-screen'), async () => {
    const data = await api('/api/new', { method: 'POST', body: payload });
    state.gameId = data.gameId;
    state.recorded = null;
    hideRunModals();
    $('start-screen').classList.add('hidden');
    $('ending-modal').classList.add('hidden');
    render(data.view);
    await persist();
  });
}

async function resumeSave() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) {
    toast('没有找到上次的存档。');
    return;
  }
  await guard($('start-screen'), async () => {
    const data = await api('/api/import', { method: 'POST', body: { save: raw } });
    state.gameId = data.gameId;
    state.recorded = null;
    hideRunModals();
    $('start-screen').classList.add('hidden');
    $('ending-modal').classList.add('hidden');
    render(data.view);
  });
}

async function doAction(actionId, subject) {
  await guard($('actions'), async () => {
    closeModals();
    const data = await api('/api/action', {
      method: 'POST',
      body: { gameId: state.gameId, actionId, subject },
    });
    if (data.lines?.length) showTurnLines(data.lines);
    render(data.view);
    await persist();
  });
}

async function pickEventChoice(choiceId) {
  await guard($('event-choices'), async () => {
    const data = await api('/api/event', { method: 'POST', body: { gameId: state.gameId, choiceId } });
    $('event-modal').classList.add('hidden');
    if (data.lines?.length) showTurnLines(data.lines);
    render(data.view);
    await persist();
  });
}

async function buyItem(itemId) {
  await guard($('shop-body'), async () => {
    const data = await api('/api/shop', { method: 'POST', body: { gameId: state.gameId, itemId } });
    if (data.lines?.length) showTurnLines(data.lines);
    render(data.view);
    await persist();
  });
}

/** 自动存档到 localStorage（失败不影响游戏）。 */
async function persist() {
  if (!state.gameId) return;
  try {
    const data = await api(`/api/export?gameId=${encodeURIComponent(state.gameId)}`);
    localStorage.setItem(SAVE_KEY, data.save);
  } catch {
    /* 自动存档失败不影响游戏 */
  }
}

function updateContinueButton() {
  $('btn-continue').hidden = !localStorage.getItem(SAVE_KEY);
}

/* ------------------------------------------------------------ 弹层 */

function closeModals() {
  $('subject-modal').classList.add('hidden');
  $('event-modal').classList.add('hidden');
  $('relations-modal').classList.add('hidden');
  $('story-modal').classList.add('hidden');
  $('community-modal').classList.add('hidden');
  $('leaderboard-modal').classList.add('hidden');
}

/**
 * 离开"这一局"时把局内弹层收掉（志愿表、内容包面板）。
 * 不然从志愿填报直接点"新的一局"，弹层会飘在开局界面上。
 */
function hideRunModals() {
  $('volunteer-modal').classList.add('hidden');
  $('content-modal').classList.add('hidden');
  $('community-modal').classList.add('hidden');
  $('leaderboard-modal').classList.add('hidden');
}

function openEventModal(pending) {
  $('event-title').innerHTML = pending.story
    ? `📖 ${escapeHtml(pending.arcTitle ?? '故事')}　<span class="story-mark">${escapeHtml(pending.name)}</span>`
    : `${pending.icon ?? '🎲'} ${escapeHtml(pending.name)}`;
  $('event-text').textContent = pending.text;
  $('event-choices').innerHTML = pending.choices
    .map(
      (choice) => `
      <button data-choice="${escapeHtml(choice.id)}">
        ${escapeHtml(choice.label)}
        ${choice.hint ? `<span class="choice-hint">${escapeHtml(choice.hint)}</span>` : ''}
      </button>`,
    )
    .join('');
  for (const button of $('event-choices').querySelectorAll('button[data-choice]')) {
    button.addEventListener('click', () => pickEventChoice(button.dataset.choice));
  }
  $('event-modal').classList.toggle('story', Boolean(pending.story));
  $('event-modal').classList.remove('hidden');
}

/** 需要选科的行动：用行动自己给出的 subjectOptions 弹科目。 */
function openSubjectModal(action) {
  $('subject-title').textContent = `${action.icon} ${action.name} · 选择科目`;
  $('subject-choices').innerHTML =
    action.subjectOptions
      .map((option) => {
        const subject = state.view?.subjects?.find((item) => item.key === option.key);
        const hint = subject
          ? `知识 ${subject.knowledge} / 100　预估 ${subject.estimate} / ${subject.max}`
          : '';
        return `<button data-subject="${escapeHtml(option.key)}">
          ${option.icon} ${escapeHtml(option.name)}
          <span class="choice-hint">${hint}</span>
        </button>`;
      })
      .join('') || '<p class="muted">现在没有可以选的科目。</p>';
  for (const button of $('subject-choices').querySelectorAll('button[data-subject]')) {
    button.addEventListener('click', () => {
      $('subject-modal').classList.add('hidden');
      doAction(action.id, button.dataset.subject);
    });
  }
  $('subject-modal').classList.remove('hidden');
}

/* ------------------------------------------------------------ 商店 */

function openShopModal() {
  if (!state.view) {
    toast('还没有开始的游戏。');
    return;
  }
  renderShop(state.view);
  $('shop-modal').classList.remove('hidden');
}

function renderShop(view) {
  $('shop-money').textContent = `零花钱 ${view.stats.money} 元　·　买东西不消耗时间，随时可以来逛。`;
  $('shop-body').innerHTML = view.shop
    .map((item) => {
      const tags = [];
      if (item.owned) tags.push('已拥有');
      if (item.repeatable) tags.push('可重复购买');
      return `<div class="shop-item${item.owned ? ' owned' : ''}">
        <div class="shop-head">
          <span class="shop-icon">${item.icon}</span>
          <span class="shop-name">${escapeHtml(item.name)}</span>
          <span class="shop-price">${item.price} 元</span>
        </div>
        <p class="shop-desc">${escapeHtml(item.desc)}</p>
        <div class="shop-foot">
          <span class="muted small">${tags.map(escapeHtml).join('　')}</span>
          <button data-item="${escapeHtml(item.id)}" ${item.canBuy ? '' : 'disabled'}>
            ${item.canBuy ? '买下' : escapeHtml(item.reason ?? '不能买')}
          </button>
        </div>
      </div>`;
    })
    .join('');
  for (const button of $('shop-body').querySelectorAll('button[data-item]')) {
    button.addEventListener('click', () => buyItem(button.dataset.item));
  }
}

/* ------------------------------------------------------------ 图鉴 */

function emptyProfile() {
  return { version: 2, runs: 0, unlocked: {}, history: [] };
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return emptyProfile();
    const data = JSON.parse(raw);
    return {
      version: 2,
      runs: Number(data.runs) || 0,
      unlocked: data.unlocked && typeof data.unlocked === 'object' ? data.unlocked : {},
      history: Array.isArray(data.history) ? data.history : [],
    };
  } catch {
    return emptyProfile();
  }
}

function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* 存储不可用时图鉴只是本局有效 */
  }
}

/** 一局结束时把结局、分数、成就记进图鉴。 */
function recordRun(view) {
  const ending = view.ending;
  if (!ending) return;
  const stamp = `${state.gameId ?? 'local'}|${ending.id}`;
  if (state.recorded === stamp) return;
  state.recorded = stamp;

  const profile = loadProfile();
  profile.runs += 1;
  const entry = profile.unlocked[ending.id] ?? { count: 0, best: 0, title: ending.title };
  entry.count += 1;
  entry.title = ending.title;
  entry.best = Math.max(entry.best ?? 0, ending.total ?? 0);
  entry.at = new Date().toISOString().slice(0, 10);
  profile.unlocked[ending.id] = entry;

  profile.history.unshift({
    name: view.student.name,
    title: ending.title,
    endingId: ending.id,
    total: ending.total ?? null,
    goal: ending.goal?.name ?? null,
    goalAchieved: Boolean(ending.goal?.achieved),
    achievements: (ending.achievements ?? []).map((item) => item.name),
    cast: (ending.cast ?? []).map((person) => `${person.role} ${person.name}`),
    story: (ending.story ?? []).length,
    at: entry.at,
  });
  profile.history = profile.history.slice(0, 30);
  saveProfile(profile);
}

function openGalleryModal() {
  renderGallery();
  $('gallery-modal').classList.remove('hidden');
}

function renderGallery() {
  const catalog = state.options?.catalog ?? [];
  const profile = loadProfile();
  const unlockedCount = catalog.filter((entry) => profile.unlocked[entry.id]).length;

  const legacy = legacyPoints();
  const legacyInfo = state.options?.legacy ?? { runsPerPoint: 2, max: 6 };
  $('gallery-progress').innerHTML =
    `已解锁 <b>${unlockedCount}</b> / ${catalog.length}　·　共玩了 <b>${profile.runs}</b> 局` +
    `　·　成就收录 <b>${new Set(profile.history.flatMap((run) => run.achievements ?? [])).size}</b> 种` +
    `<br>🔁 多周目传承：<b>+${legacy}</b> 点属性点（每玩满 ${legacyInfo.runsPerPoint} 局多得 1 点，最多 ${legacyInfo.max} 点）`;

  $('gallery-body').innerHTML = catalog
    .map((entry) => {
      const record = profile.unlocked[entry.id];
      if (!record) {
        return `<div class="gallery-item locked">
          <div class="gallery-icon">🔒</div>
          <div class="gallery-title">？？？</div>
          <div class="gallery-tier">${escapeHtml(entry.tier)}</div>
          <div class="gallery-hint">线索：${escapeHtml(entry.hint)}</div>
        </div>`;
      }
      return `<div class="gallery-item unlocked">
        <div class="gallery-icon">${entry.icon}</div>
        <div class="gallery-title">${escapeHtml(entry.title)}</div>
        <div class="gallery-tier">${escapeHtml(entry.tier)}</div>
        <div class="gallery-hint">已收集 ${record.count} 次${record.best ? `　最高 ${record.best} 分` : ''}</div>
      </div>`;
    })
    .join('');

  const recent = profile.history
    .slice(0, 6)
    .map(
      (run) =>
        `<div class="gallery-run">${escapeHtml(run.title)}${run.total ? `　${run.total} 分` : ''}${
          run.goal ? `　目标：${escapeHtml(run.goal)}${run.goalAchieved ? ' ✅' : ' ✕'}` : ''
        }</div>`,
    )
    .join('');
  $('gallery-runs').innerHTML = recent ? `<h3 class="build-title">最近几局</h3>${recent}` : '';
}

/* ------------------------------------------------------------ 内容包（热更新） */

/**
 * 内容包面板：看清"现在跑的是哪份内容"，然后给三条导入路。
 *
 * 三条路都收敛到 POST /api/content/apply：本地文件走 FileReader 读成 text，
 * 粘贴框直接给 text，URL 那条把地址交给服务端（离线模式由 local-api 在页面里 fetch）。
 * 热更新只改内容数组，不动存档，所以导入完接着玩就行。
 */

/** 上一次 /api/content 的结果，用于"操作后刷新摘要"。 */
let contentInfo = null;

function contentSourceChip(source) {
  if (source === 'url') return { text: '🌐 从地址拉取', cls: 'url' };
  if (source === 'imported') return { text: '📂 本地导入', cls: 'imported' };
  return { text: '🏫 官方内置', cls: 'official' };
}

function renderContentPanel(info) {
  if (info) contentInfo = info;
  const data = contentInfo ?? {};
  const summary = data.summary ?? null;
  const source = contentSourceChip(data.source);
  const node = $('content-status');

  const events = data.eventCount ?? '—';
  const baseline = data.baselineEventCount ?? '—';
  const counts = summary?.counts ?? {};
  const breakdown = [
    ['事件', counts.events],
    ['道具', counts.items],
    ['天赋', counts.traits],
    ['性格', counts.personalities],
    ['缺陷', counts.flaws],
    ['行动文案', counts.actions],
    ['平衡调整', counts.balance],
  ]
    .filter(([, value]) => Number(value) > 0)
    .map(([label, value]) => `${label} <b>${Number(value)}</b>`)
    .join('　');

  if (!summary) {
    node.className = 'content-status official';
    node.innerHTML = `
      <div class="content-pack">
        <b>官方内置内容</b>
        <span class="content-chip ${source.cls}">${source.text}</span>
      </div>
      <div class="content-grid">
        <span>随机事件 <b>${events}</b>（自带 ${baseline}）</span>
        <span>校验和 <b>—</b></span>
        <span>条目数 <b>0</b></span>
      </div>
      <p class="muted small">现在跑的就是安装包自带的内容。在下面导入一个内容包，就能加事件、加道具、调平衡，不用重装。</p>`;
    return;
  }

  node.className = 'content-status';
  node.innerHTML = `
    <div class="content-pack">
      <b>${escapeHtml(summary.name || '未命名内容包')}</b>
      ${summary.version ? `<span class="content-chip">v${escapeHtml(summary.version)}</span>` : ''}
      ${summary.author ? `<span class="content-chip">${escapeHtml(summary.author)}</span>` : ''}
      <span class="content-chip ${source.cls}">${source.text}</span>
    </div>
    ${summary.note ? `<div class="muted small">${escapeHtml(summary.note)}</div>` : ''}
    <div class="content-grid">
      <span>校验和 <span class="content-mono">${escapeHtml(data.checksum ?? '—')}</span></span>
      <span>条目数 <b>${Number(summary.total) || 0}</b></span>
      <span>随机事件 <b>${events}</b>（内置 ${baseline}）</span>
      <span>格式 <b>v${escapeHtml(String(data.format ?? summary.format ?? '—'))}</b></span>
      ${summary.requires ? `<span>要求版本 <b>${escapeHtml(summary.requires)}</b></span>` : ''}
    </div>
    ${breakdown ? `<div class="content-grid">${breakdown}</div>` : ''}`;
}

async function refreshContentStatus() {
  const info = await api('/api/content');
  renderContentPanel(info);
  // 顶栏 / 行动说明里的"事件数"等文案跟着更新
  if (state.options && Number.isFinite(Number(info.eventCount))) state.options.eventCount = Number(info.eventCount);
  return info;
}

async function openContentModal() {
  $('content-warnings').innerHTML = '';
  $('content-modal').classList.remove('hidden');
  // 打开面板就顺手问一次更新：这样"没配更新地址"也能被看见，而不是一个空框让人猜
  void checkUpdatesFromPanel();
  try {
    await refreshContentStatus();
  } catch (error) {
    $('content-status').className = 'content-status';
    $('content-status').innerHTML = `<p class="content-note bad">读取内容包状态失败：${escapeHtml(error?.message ?? '未知错误')}</p>`;
  }
}

/**
 * 统一的"应用 / 恢复"请求：请求期间禁用整个面板的按钮，
 * 成功后刷新摘要 + 常驻界面，失败就把错因写在面板里（不只是弹个 toast）。
 */
async function runContentRequest(path, body, note) {
  if (state.busy) return;
  state.busy = true;
  const buttons = [...$('content-modal').querySelectorAll('button')];
  for (const button of buttons) button.disabled = true;
  document.body.style.cursor = 'progress';
  try {
    const result = await api(path, { method: 'POST', body });
    if (result?.view) renderPanels(result.view);
    const info = await refreshContentStatus();
    const warnings = result?.warnings ?? [];
    $('content-warnings').innerHTML = `
      <p class="content-note ok">✅ ${escapeHtml(note)}内容已热更新，无需重装。现在有 <b>${info?.eventCount ?? '—'}</b> 个随机事件${
        Number.isFinite(Number(info?.baselineEventCount)) ? `（内置 ${info.baselineEventCount} 个）` : ''
      }。</p>
      ${warnings.length ? `<ul class="content-warn-list">${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}`;
    toast('内容已热更新，无需重装。');
  } catch (error) {
    $('content-warnings').innerHTML = `<p class="content-note bad">✕ ${escapeHtml(error?.message ?? '导入失败，请检查 JSON')}</p>`;
    toast(`内容包没能生效：${error?.message ?? '未知错误'}`);
  } finally {
    state.busy = false;
    document.body.style.cursor = '';
    for (const button of buttons) button.disabled = false;
    if (state.view) renderActions(state.view);
  }
}

/** 用 FileReader 读本地 JSON（不联网、不上传）。 */
function readLocalFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(reader.error?.message ?? '读不了这个文件'));
    reader.readAsText(file, 'utf-8');
  });
}

async function importContentFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await readLocalFile(file);
    // 顺手放进粘贴框：玩家能先看一眼包里写了什么，改完再点"应用"
    $('content-text').value = text.length > 200000 ? '' : text;
    await runContentRequest('/api/content/apply', { text }, `已应用本地文件「${file.name}」。`);
  } catch (error) {
    $('content-warnings').innerHTML = `<p class="content-note bad">✕ ${escapeHtml(error?.message ?? '读取文件失败')}</p>`;
  } finally {
    event.target.value = '';
  }
}

async function applyPastedContent() {
  const text = $('content-text').value.trim();
  if (!text) {
    toast('先把内容包 JSON 粘进文本框。');
    return;
  }
  await runContentRequest('/api/content/apply', { text }, '已应用粘贴的内容包。');
}

/**
 * 内容包地址的准入规则：只认 https。
 *
 * 例外是回环地址（127.0.0.1 / localhost / [::1]）上的 http——本地起个小服务写包、
 * 自己拉自己很常见，而且页面的 CSP 只有 connect-src 'self' https:，
 * 线上的 http 地址本来就会被浏览器拦掉（https 页面还会撞混合内容策略）。
 */
function isAllowedPackUrl(value) {
  let parsed;
  try {
    parsed = new URL(value, location.href);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname);
  return parsed.protocol === 'http:' && loopback;
}

async function fetchContentFromUrl() {
  const url = $('content-url').value.trim();
  if (!url) {
    toast('先填一个内容包地址。');
    return;
  }
  if (!isAllowedPackUrl(url)) {
    toast('只支持 https 地址（回环地址上的 http 可以，比如 http://127.0.0.1:8080/pack.json）。');
    return;
  }
  await runContentRequest('/api/content/apply', { url }, '已从地址拉取并应用内容包。');
}

async function resetContentPack() {
  await runContentRequest('/api/content/reset', {}, '已恢复官方内容。');
}

/* ------------------------------------------------------- 更新检查（推送） */

/** 玩家点过"忽略这个版本"的那个校验和：只忽略这一版，下次再来还会提示。 */
const UPDATE_IGNORE_KEY = 'mas2z-update-ignore-v1';

/** 本次会话里点过"稍后"：这一轮不再弹，刷新页面后还会提醒。 */
let updatePostponed = false;

/** 有弹层开着时先把横幅挂在这里，等弹层关了再弹（见 watchOverlays）。 */
let pendingUpdateBanner = null;
let overlayWatcher = null;

const UPDATE_STATUS_LABEL = {
  'up-to-date': '已是最新',
  update: '可更新',
  ignored: '已忽略',
  downgrade: '线上更旧',
  'channel-mismatch': '通道不匹配',
  incompatible: '需先升级客户端',
  invalid: '清单有问题',
  unreachable: '拉不到清单',
  disabled: '未启用',
};

function ignoredChecksum() {
  try {
    return localStorage.getItem(UPDATE_IGNORE_KEY) ?? '';
  } catch {
    // 隐私模式 / 禁用存储：当成"没忽略过"，不影响功能
    return '';
  }
}

/** 问一次"有没有新内容"。调用方负责处理异常（启动自检是静默的）。 */
function checkUpdates() {
  const ignored = ignoredChecksum();
  return api(ignored ? `/api/update?ignored=${encodeURIComponent(ignored)}` : '/api/update');
}

function hideUpdateBanner() {
  pendingUpdateBanner = null;
  $('update-banner').classList.add('hidden');
}

/** 有没有弹层开着？（`.overlay` 的 z-index 比横幅高，开着的时候横幅会被盖住） */
function anyOverlayOpen() {
  return [...document.querySelectorAll('.overlay')].some((node) => !node.classList.contains('hidden'));
}

/**
 * 有弹层开着就先记住、等关了再弹。
 *
 * 起因是一个真被测出来的问题：开局那个"开学第一天"弹层一直在（z-index 40 > 横幅），
 * 横幅虽然画出来了、按钮却点不动——"看得见点不动"比"看不见"更糟。
 * 用 MutationObserver 而不是去每个关闭弹层的地方插一行，是因为关弹层的路径太多
 * （开局、事件、商店、结局、志愿……），漏一个就会复现这个 bug。
 */
function watchOverlays() {
  if (overlayWatcher) return;
  overlayWatcher = new MutationObserver(() => {
    if (!pendingUpdateBanner || anyOverlayOpen()) return;
    const info = pendingUpdateBanner;
    pendingUpdateBanner = null;
    showUpdateBannerNow(info);
  });
  for (const node of document.querySelectorAll('.overlay')) {
    overlayWatcher.observe(node, { attributes: true, attributeFilter: ['class'] });
  }
}

/** 把一次判定结果变成顶部那条横幅（弹层开着就先挂起）。 */
function showUpdateBanner(info) {
  if (anyOverlayOpen()) {
    pendingUpdateBanner = info;
    watchOverlays();
    return;
  }
  showUpdateBannerNow(info);
}

function showUpdateBannerNow(info) {
  const view = summarizeUpdate(info);
  const banner = $('update-banner');
  $('update-banner-title').textContent = view.title || '有新内容';
  $('update-banner-detail').textContent = view.detail;
  $('update-banner-icon').textContent = info.status === 'downgrade' ? '⬇️' : '🔄';
  $('btn-update-now').textContent = info.status === 'downgrade' ? '仍然降级' : '立即更新';
  // mandatory 的更新不提供"稍后 / 忽略"——但按钮只是藏起来，不是禁用
  $('btn-update-later').hidden = !view.canIgnore;
  $('btn-update-ignore').hidden = !view.canIgnore;
  banner.classList.toggle('mandatory', Boolean(info.mandatory));
  banner.classList.remove('hidden');
  banner.dataset.checksum = info.latest?.checksum ?? '';
  banner.dataset.packUrl = info.packUrl ?? '';
}

/** 真的去装：复用内容包面板那条请求（同一套校验、落盘、"已热更新"提示）。 */
async function applyUpdateFromBanner() {
  const packUrl = $('update-banner').dataset.packUrl ?? '';
  if (!packUrl) {
    toast('这条更新没有可用的内容包地址。');
    return;
  }
  hideUpdateBanner();
  await runContentRequest('/api/content/apply', { url: packUrl }, '已更新到最新内容。');
}

function ignoreUpdateVersion() {
  const checksum = $('update-banner').dataset.checksum ?? '';
  if (checksum) {
    try {
      localStorage.setItem(UPDATE_IGNORE_KEY, checksum);
    } catch {
      // 写不了就算了，下次还会提示，不是致命问题
    }
  }
  hideUpdateBanner();
  toast('这一版不再提示（下次有新版本还会提醒）。');
}

/** 把判定结果渲染成内容包面板里的一段人话。 */
function renderUpdateStatus(info) {
  const view = summarizeUpdate(info);
  const latest = info.latest;
  const statusLabel = UPDATE_STATUS_LABEL[info.status] ?? String(info.status ?? '未知');
  const lines = [
    `<div class="content-pack"><b>${escapeHtml(view.title)}</b>${
      latest?.version ? `<span class="content-chip">v${escapeHtml(latest.version)}</span>` : ''
    }<span class="content-chip">${escapeHtml(statusLabel)}</span></div>`,
  ];
  if (view.detail) lines.push(`<div class="muted small">${escapeHtml(view.detail)}</div>`);
  if (latest) {
    lines.push(`<div class="content-grid">
      <span>线上校验和 <span class="content-mono">${escapeHtml(latest.checksum || '—')}</span></span>
      ${latest.releasedAt ? `<span>发布于 ${escapeHtml(latest.releasedAt)}</span>` : ''}
      ${info.packUrl ? `<span>地址 <span class="content-mono">${escapeHtml(info.packUrl)}</span></span>` : ''}
    </div>`);
  }
  const reasons = (info.reasons ?? []).filter(Boolean);
  if (reasons.length) lines.push(`<div class="muted small">${reasons.map((item) => escapeHtml(item)).join('<br />')}</div>`);
  return lines.join('');
}

/** 面板里的"📡 检查更新"：结论写在面板里，能更新的话同时弹横幅。 */
async function checkUpdatesFromPanel({ manual = false } = {}) {
  // 玩家主动来问，就把"稍后"作废——否则点了稍后再自己点检查，反而什么都不显示
  if (manual) updatePostponed = false;
  const box = $('update-status');
  box.className = 'content-status';
  box.innerHTML = '<p class="muted small">正在检查……</p>';
  let info;
  try {
    info = await checkUpdates();
  } catch (error) {
    box.innerHTML = `<p class="content-note bad">✕ 检查更新失败：${escapeHtml(error?.message ?? '未知错误')}</p>`;
    return null;
  }
  box.innerHTML = renderUpdateStatus(info);
  if (info.actionable && (manual || !updatePostponed)) showUpdateBanner(info);
  else if (!info.actionable) hideUpdateBanner();
  return info;
}

/**
 * 启动自检：问一句"有没有新内容"。
 *
 * 三条"绝不能"决定了它的写法：**不能挡住游戏**（fire-and-forget）、
 * **不能因为失败弹错**（整段 try 里吞掉）、**不能覆盖玩家手里的新包**
 * （默认只提示，只有清单明确写 `auto: true` 且不是强制更新时才静默安装）。
 */
async function updateCheckOnBoot() {
  if (updatePostponed) return;
  try {
    const info = await checkUpdates();
    if (!info?.actionable) return;
    if (info.status === 'update' && info.auto && !info.mandatory && info.packUrl) {
      await runContentRequest('/api/content/apply', { url: info.packUrl }, '已自动更新到最新内容。');
      return;
    }
    showUpdateBanner(info);
  } catch {
    // 断网 / 没起服务端 / 没配清单：什么都不做（离线优先）
  }
}

/* ------------------------------------------------------------ 高考志愿填报 */

/**
 * 志愿填报：出分之后、"这一局怎么结束"之前的那一步。
 *
 * 规则（引擎侧）：最多 6 个志愿，picks 的顺序就是录取顺序；冲=红 / 稳=黄 / 保=绿；
 * 单科要求不达标（比如"英语 105 / 需要 110"）的专业组灰掉、不给点。
 * 界面上真正要回答的问题只有一个：**你这张表，滑不滑档？**
 */

/** 冲 / 稳 / 保 → 颜色类名。 */
const VOLUNTEER_LEVEL_CLASS = { 冲: 'chong', 稳: 'wen', 保: 'bao' };

function levelClass(level) {
  return VOLUNTEER_LEVEL_CLASS[level] ?? 'wen';
}

/** 面板上的临时选择（点选项时先改这里，提交时才发给服务端）。 */
let volunteering = { picks: [], adjust: true };

function volunteerSlots() {
  return Number(state.view?.volunteer?.slots) || 6;
}

function volunteerOptions() {
  return state.view?.volunteer?.options ?? [];
}

/**
 * 单科要求对照：把 option.require 的 {subject, min} 和这一局**高考的单科分**比一比。
 *
 * 分数取 view.volunteer.subjects（引擎投档时用的就是它，见 data/colleges.js 的 resolveVolunteers），
 * 用 view.subjects[].estimate 会跟真正的退档判定对不上。
 * 找不到科目信息就不拦（宁可放行，也不要因为字段没对上把玩家卡死）。
 */
function requirementInfo(option) {
  const require = option?.require;
  if (!require || require.subject === undefined || require.min === undefined) return null;
  const scoreTable = state.view?.volunteer?.subjects ?? {};
  const subject = state.view?.subjects?.find(
    (item) => item.key === require.subject || item.name === require.subject,
  );
  const need = Number(require.min);
  const raw = Number(scoreTable[require.subject] ?? subject?.score);
  const name = subject?.name ?? String(require.subject);
  if (!Number.isFinite(raw) || !Number.isFinite(need)) {
    return { ok: true, text: require.label ? `${require.label}（这一局没有这科成绩）` : `${name} 需要 ${need}` };
  }
  return { ok: raw >= need, text: `${name} ${raw} / 需要 ${need}` };
}

function volunteerOptionHtml(option) {
  const req = requirementInfo(option);
  const blocked = Boolean(req && !req.ok);
  const slot = volunteering.picks.indexOf(option.id);
  const classes = [
    'volunteer-option',
    `line-${levelClass(option.level)}`,
    slot >= 0 ? 'on' : '',
    blocked ? 'blocked' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const major = option.majorName ?? option.major ?? '';
  const meta = [
    Number.isFinite(Number(option.minScore)) ? `参考分 ${Number(option.minScore)}` : '',
    slot >= 0 ? `<span class="volunteer-pick-mark">第 ${slot + 1} 志愿</span>` : '',
  ]
    .filter(Boolean)
    .join('　');
  return `<button type="button" class="${classes}" data-volunteer-option="${escapeHtml(option.id)}"
      aria-pressed="${slot >= 0}" ${blocked ? 'disabled' : ''}
      title="${escapeHtml(`${option.school ?? ''} ${option.tierName ?? ''} ${major}`.trim())}">
    <span class="volunteer-option-top">
      <span class="volunteer-option-school">${escapeHtml(option.school ?? '')}</span>
      <span class="volunteer-tag line-${levelClass(option.level)}">${escapeHtml(option.level ?? '稳')}</span>
    </span>
    <span class="volunteer-option-major">${escapeHtml(
      [option.tierName, major].filter(Boolean).join(' · '),
    )}</span>
    ${meta ? `<span class="volunteer-option-meta">${meta}</span>` : ''}
    ${req ? `<span class="volunteer-req ${req.ok ? 'ok' : 'bad'}">${req.ok ? '✓' : '✕'} ${escapeHtml(req.text)}</span>` : ''}
    ${option.note ? `<span class="volunteer-option-meta">${escapeHtml(option.note)}</span>` : ''}
  </button>`;
}

function volunteerSlotHtml(index) {
  const id = volunteering.picks[index];
  const option = id ? volunteerOptions().find((item) => item.id === id) : null;
  if (!option) {
    return `<div class="volunteer-slot empty">
      <span class="volunteer-slot-index">${index + 1}</span>
      <span class="volunteer-slot-empty">空着——点下面的专业组填进来</span>
    </div>`;
  }
  const major = option.majorName ?? option.major ?? '';
  const last = volunteering.picks.length - 1;
  return `<div class="volunteer-slot line-${levelClass(option.level)}" data-volunteer-slot="${index}">
    <span class="volunteer-slot-index">${index + 1}</span>
    <span class="volunteer-slot-main">
      <span class="volunteer-slot-school">${escapeHtml(option.school ?? '')}　<span class="volunteer-tag line-${levelClass(option.level)}">${escapeHtml(option.level ?? '')}</span></span>
      <span class="volunteer-slot-major">${escapeHtml([option.tierName, major].filter(Boolean).join(' · '))}</span>
    </span>
    <span class="volunteer-slot-actions">
      <button type="button" class="ghost" data-volunteer-up="${index}" title="往前挪一位" ${index === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="ghost" data-volunteer-down="${index}" title="往后挪一位" ${index >= last ? 'disabled' : ''}>↓</button>
      <button type="button" class="ghost" data-volunteer-remove="${index}" title="取消这个志愿">✕</button>
    </span>
  </div>`;
}

/** 当前志愿表的冲/稳/保结构（本地算：服务端要等提交后才会回填 picks）。 */
function volunteerTally() {
  const options = volunteerOptions();
  const tally = { chong: 0, wen: 0, bao: 0 };
  for (const id of volunteering.picks) {
    const option = options.find((item) => item.id === id);
    if (!option) continue;
    if (option.level === '冲') tally.chong += 1;
    else if (option.level === '稳') tally.wen += 1;
    else if (option.level === '保') tally.bao += 1;
  }
  return tally;
}

function renderVolunteer() {
  const vol = state.view?.volunteer;
  if (!vol?.active) return;
  const slots = volunteerSlots();
  const summary = volunteerTally();
  const picked = volunteering.picks.length;

  $('volunteer-head').innerHTML = `
    <span class="volunteer-stat">总分 <b>${escapeHtml(String(vol.total ?? '—'))}</b> / 750</span>
    <span class="volunteer-stat">全省排名 <b>${escapeHtml(String(vol.rank ?? '—'))}</b></span>
    <span class="volunteer-stat">冲 <b>${summary.chong}</b>　稳 <b>${summary.wen}</b>　保 <b>${summary.bao}</b></span>
    <span class="volunteer-stat">已填 <b>${picked}</b> / ${slots}</span>`;

  $('volunteer-rumor').textContent = vol.rumor ? `📣 分数线风声：${vol.rumor}` : '';

  const slotList = Array.from({ length: slots }, (_, index) => volunteerSlotHtml(index)).join('');
  $('volunteer-slots').innerHTML =
    `<div class="build-title">我的志愿表（顺序就是录取顺序）</div>${slotList}`;

  const options = volunteerOptions();
  const optionList = options.map(volunteerOptionHtml).join('');
  $('volunteer-options').innerHTML =
    `<div class="build-title">可以填的院校专业组</div>` +
    (optionList || '<p class="volunteer-empty">这一局没有可填的专业组。</p>');

  for (const button of $('volunteer-options').querySelectorAll('button[data-volunteer-option]')) {
    button.addEventListener('click', () => toggleVolunteerPick(button.dataset.volunteerOption));
  }
  for (const button of $('volunteer-slots').querySelectorAll('button[data-volunteer-remove]')) {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.volunteerRemove);
      removeVolunteerPick(index);
    });
  }
  for (const button of $('volunteer-slots').querySelectorAll('button[data-volunteer-up]')) {
    button.addEventListener('click', () => moveVolunteerPick(Number(button.dataset.volunteerUp), -1));
  }
  for (const button of $('volunteer-slots').querySelectorAll('button[data-volunteer-down]')) {
    button.addEventListener('click', () => moveVolunteerPick(Number(button.dataset.volunteerDown), 1));
  }

  const adjust = $('volunteer-adjust');
  adjust.checked = volunteering.adjust;
  adjust.disabled = vol.adjustable === false;

  const submit = $('btn-volunteer-submit');
  submit.disabled = picked === 0;
  submit.textContent = picked === 0 ? `至少填 1 个志愿（共 ${slots} 格）` : `提交志愿（已填 ${picked} / ${slots}）`;
}

function toggleVolunteerPick(id) {
  if (!id) return;
  const picks = volunteering.picks;
  const at = picks.indexOf(id);
  if (at >= 0) picks.splice(at, 1);
  else if (picks.length >= volunteerSlots()) {
    toast(`最多填 ${volunteerSlots()} 个志愿，先取消一个再换。`);
    return;
  } else picks.push(id);
  renderVolunteer();
}

function removeVolunteerPick(index) {
  volunteering.picks.splice(index, 1);
  renderVolunteer();
}

function moveVolunteerPick(index, delta) {
  const picks = volunteering.picks;
  const to = index + delta;
  if (to < 0 || to >= picks.length) return;
  const [item] = picks.splice(index, 1);
  picks.splice(to, 0, item);
  renderVolunteer();
}

function openVolunteerModal() {
  const vol = state.view?.volunteer;
  if (!vol?.active) return;
  // 回显服务端记住的志愿表，只保留这一局真实存在的 option id
  const valid = new Set(volunteerOptions().map((option) => option.id));
  volunteering = {
    picks: (Array.isArray(vol.picks) ? vol.picks : []).filter((id) => valid.has(id)).slice(0, volunteerSlots()),
    adjust: vol.adjustable === false ? false : vol.adjust !== false,
  };
  $('volunteer-result').classList.add('hidden');
  $('btn-volunteer-continue').hidden = true;
  $('volunteer-foot').classList.remove('hidden');
  $('volunteer-modal').classList.remove('hidden');
  renderVolunteer();
}

/** 提交后展示录取结果（第几志愿 / 学校 / 专业），再让玩家自己点进结局。 */
function renderVolunteerResult(data) {
  const vol = state.view?.volunteer ?? {};
  // 录取详情的三个来源：提交响应 → 引擎记在志愿状态里的 result → 结局上的 volunteer
  const admission = data?.ending?.volunteer ?? vol.result ?? vol.admission ?? null;
  const lines = data?.lines ?? vol.lines ?? [];
  const slip = Boolean(admission?.slip);
  const title = slip
    ? '📉 六个志愿全部滑档'
    : admission
      ? `🎉 第 ${admission.round} 志愿录取`
      : '📮 志愿已提交';
  const major = admission?.majorName ?? admission?.major ?? '';
  const detail = admission
    ? `<div class="content-pack">
        <b>${escapeHtml(admission.school ?? '')}</b>
        ${major ? `<span class="content-chip">${escapeHtml(major)}</span>` : ''}
        ${admission.tierName ? `<span class="content-chip">${escapeHtml(admission.tierName)}</span>` : ''}
        ${admission.adjusted ? '<span class="content-chip url">服从调剂录取</span>' : ''}
      </div>`
    : '';
  $('volunteer-result').innerHTML = `
    <div class="volunteer-result-title ${slip ? 'slip' : 'ok'}">${escapeHtml(title)}</div>
    ${detail}
    ${lines.length ? `<ul class="volunteer-result-lines">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}
    <p class="muted small">${
      slip
        ? '滑档不等于没学上——结局页会告诉你最后去了哪里。'
        : '录取结果已经写进这一局的结局，点下面看完整结算。'
    }</p>`;
  $('volunteer-result').classList.remove('hidden');
  // 志愿已经交上去了，把挑学校的部分收起来，免得玩家以为还能改
  $('volunteer-slots').innerHTML = '';
  $('volunteer-options').innerHTML = '';
  $('volunteer-rumor').textContent = '';
  $('volunteer-foot').classList.add('hidden');
  // guard() 把弹层里的按钮全禁用了，而且不会自己恢复（它平时靠重画 DOM 换新按钮）。
  // 这里必须手动把"看结局"放出来、把"提交"锁死，否则玩家交完志愿就卡在这一步。
  const next = $('btn-volunteer-continue');
  next.hidden = false;
  next.disabled = false;
  $('btn-volunteer-submit').disabled = true;
}

async function submitVolunteer() {
  if (!volunteering.picks.length) {
    toast('至少填 1 个志愿再交。');
    return;
  }
  await guard($('volunteer-modal'), async () => {
    const data = await api('/api/volunteer', {
      method: 'POST',
      body: {
        gameId: state.gameId,
        picks: volunteering.picks.slice(),
        adjust: $('volunteer-adjust').checked,
      },
    });
    if (data.lines?.length) showTurnLines(data.lines);
    // 提交后这一局就结束了：只刷常驻界面，结局弹层等玩家点"看结局"
    if (data.view) renderPanels(data.view);
    renderVolunteerResult(data);
  });
}

function continueToEnding() {
  $('volunteer-modal').classList.add('hidden');
  const view = state.view;
  if (view?.status === 'ended' && view.ending) {
    recordRun(view);
    renderEnding(view.ending);
  } else {
    render(view);
  }
}

/* ------------------------------------------------------------ 🏆 排行榜 */

/**
 * 昵称 + 排行榜（v3.1）。
 *
 * 三条原则，跟这个项目其余部分一致：
 *   1. **离线优先**：没配后端就只玩本机榜，一个请求都不发；断网时榜单降级成本机榜；
 *   2. **不挡游戏**：任何一步失败都只是 toast，绝不让排行榜卡住开局或结局；
 *   3. **不装**：客户端提交的成绩防不了作弊，能给的只有"可复核"（条目里带种子和构筑）。
 */

function getNickname() {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 保存昵称；返回最终使用的昵称（空的会退回默认名）。 */
function setNickname(value) {
  const name = normalizeNickname(value, '');
  try {
    if (name) localStorage.setItem(NICKNAME_KEY, name);
    else localStorage.removeItem(NICKNAME_KEY);
  } catch {
    /* 存储不可用时昵称只是本次会话有效 */
  }
  return name || DEFAULT_NICKNAME;
}

function loadLocalBoard() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    const data = raw ? JSON.parse(raw) : null;
    const entries = Array.isArray(data?.entries) ? data.entries : Array.isArray(data) ? data : [];
    return entries.filter((item) => item && typeof item === 'object');
  } catch {
    return [];
  }
}

function saveLocalBoard(entries) {
  try {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify({ version: 1, entries: entries.slice(0, MAX_LOCAL_ENTRIES) }));
  } catch {
    /* 存不下就算了，不影响这一局 */
  }
}

/** 读取后端配置（web/content/leaderboard.json）。空 = 只有本机榜。 */
async function leaderboardConfig() {
  if (state.leaderboard.config) return state.leaderboard.config;
  let config = emptyConfig();
  try {
    const response = await fetch('./content/leaderboard.json', { cache: 'no-store' });
    if (response.ok) {
      const text = await response.text();
      const data = JSON.parse(text);
      if (data && typeof data === 'object') config = { ...emptyConfig(), ...data };
    }
  } catch {
    config = emptyConfig();
  }
  state.leaderboard.config = config;
  return config;
}

/** 一局结束时：整理成榜单条目、记进本机榜、留作"待上榜"。 */
function recordLeaderboardRun(view) {
  const ending = view?.ending;
  if (!ending) return;
  const profile = loadProfile();
  const entry = entryFromRun({ nickname: getNickname() || DEFAULT_NICKNAME, view, profile });
  const stamp = `${view.student?.name ?? '我'}|${entry.endingId}|${entry.score ?? '-'}|${entry.endings}`;
  if (state.leaderboard.recorded === stamp) return;
  state.leaderboard.recorded = stamp;

  const board = loadLocalBoard();
  board.unshift(entry);
  saveLocalBoard(board);
  state.leaderboard.pending = entry;
}

/** 已经上榜过的局就不重复提交了（同一局点两次不该多一条记录）。 */
function alreadySubmitted(entry) {
  try {
    const list = JSON.parse(localStorage.getItem(LEADERBOARD_SUBMITTED_KEY) ?? '[]');
    const key = `${entry.nickname}|${entry.endingId}|${entry.score ?? '-'}|${entry.seed ?? ''}`;
    return Array.isArray(list) && list.includes(key);
  } catch {
    return false;
  }
}

function markSubmitted(entry) {
  try {
    const list = JSON.parse(localStorage.getItem(LEADERBOARD_SUBMITTED_KEY) ?? '[]');
    const key = `${entry.nickname}|${entry.endingId}|${entry.score ?? '-'}|${entry.seed ?? ''}`;
    const next = [...new Set([...(Array.isArray(list) ? list : []), key])].slice(-40);
    localStorage.setItem(LEADERBOARD_SUBMITTED_KEY, JSON.stringify(next));
  } catch {
    /* 记不住就允许重复提交，问题不大 */
  }
}

function difficultyLabel(key) {
  const item = listOf('difficulties').find((entry) => entry.key === key);
  return item?.name ?? key ?? '';
}

function leaderboardRowHtml(entry) {
  const badges = [
    `<span class="board-badge">${escapeHtml(difficultyLabel(entry.difficulty))}</span>`,
    entry.mode === 'versus'
      ? `<span class="board-badge versus">⚔️ AI${entry.rivalLevel ? `·${escapeHtml(entry.rivalLevel)}` : ''}</span>`
      : `<span class="board-badge">🎮 单人</span>`,
  ];
  const score = entry.score ? `<b>${entry.score}</b> 分` : '未参加高考';
  const rank = entry.rank ? `　年级第 ${entry.rank} 名` : '';
  return `
    <li class="board-row${entry.tied ? ' tied' : ''}">
      <span class="board-position">${entry.position}</span>
      <span class="board-main">
        <span class="board-name">${escapeHtml(entry.nickname)}${entry.tied ? ' <i>并列</i>' : ''}</span>
        <span class="board-ending">${escapeHtml(entry.endingTitle)}</span>
        <span class="board-meta">${score}${rank}　📖 图鉴 ${entry.endings}　🏅 成就 ${entry.achievements}　${badges.join('')}</span>
      </span>
    </li>`;
}

function renderLeaderboard() {
  const board = state.leaderboard;
  const metric = LEADERBOARD_METRICS.find((item) => item.key === board.metric) ?? LEADERBOARD_METRICS[0];
  const configured = isConfigured(board.config);
  const nickname = getNickname() || DEFAULT_NICKNAME;

  $('leaderboard-tabs').innerHTML = LEADERBOARD_METRICS.map(
    (item) =>
      `<button type="button" class="tab${item.key === metric.key ? ' on' : ''}" data-metric="${item.key}">${item.icon} ${escapeHtml(item.name)}</button>`,
  ).join('');
  for (const button of $('leaderboard-tabs').querySelectorAll('button[data-metric]')) {
    button.addEventListener('click', () => {
      board.metric = button.dataset.metric;
      renderLeaderboard();
      void refreshBoard();
    });
  }

  const summary = summarizeBoard(board.entries, metric.key, nickname);
  const sourceText = configured
    ? board.source === 'remote'
      ? `🌐 全服榜（共 ${summary.total} 位玩家）`
      : board.loading
        ? '🌐 全服榜读取中…（下面先显示本机成绩）'
        : '🌐 全服榜（读取中…）'
    : '📴 本机榜（作者还没接后端，只有这台设备上的成绩）';
  $('leaderboard-status').innerHTML =
    `${sourceText}　·　你的昵称：<b>${escapeHtml(nickname)}</b>` +
    (summary.mine ? `　·　当前排第 <b>${summary.mine.position}</b>` : '') +
    (configured ? '' : '　·　接后端的方法见 README 的「排行榜」一节');
  $('leaderboard-note').textContent = `${metric.icon} ${metric.desc}`;

  const list = board.entries;
  $('leaderboard-body').innerHTML = list.length
    ? `<ol class="board-list">${list.map(leaderboardRowHtml).join('')}</ol>`
    : `<p class="muted small">${configured ? '这个榜还是空的——打完一局点「🏆 把这一局上榜」就是第一条。' : '还没有本地成绩：打完一局会自动记下来。'}</p>`;

  const input = $('input-nickname-board');
  if (input && document.activeElement !== input) input.value = getNickname();
}

/** 本机榜也要排序 + 并列名次（和全服榜走同一套规则） */
function rankLocal(metric) {
  return rankEntries(loadLocalBoard(), metric);
}

async function refreshBoard() {
  const board = state.leaderboard;
  const config = await leaderboardConfig();
  if (!isConfigured(config)) {
    board.source = 'local';
    board.entries = rankLocal(board.metric);
    renderLeaderboard();
    return;
  }
  board.loading = true;
  renderLeaderboard();
  const result = await fetchBoard(config, { metric: board.metric });
  board.loading = false;
  if (result.ok) {
    board.source = 'remote';
    board.entries = result.entries;
  } else {
    // 读不到就退回本机榜：断网、墙上、后端挂了都不该让玩家看到一个空白面板
    board.source = 'local';
    board.entries = rankLocal(board.metric);
    toast('排行榜连不上，先看本机成绩。');
  }
  renderLeaderboard();
}

async function openLeaderboardModal() {
  state.leaderboard.entries = rankLocal(state.leaderboard.metric);
  renderLeaderboard();
  $('leaderboard-modal').classList.remove('hidden');
  await refreshBoard();
}

/**
 * 把这一局上榜。
 *
 * 顺序刻意是"先记本机、再试后端"：没网、没配后端、Supabase 挂了，
 * 玩家至少还能在本机榜看到自己的成绩，而不是点一下什么都没发生。
 */
async function submitCurrentRun({ announce = true } = {}) {
  const entry = state.leaderboard.pending;
  if (!entry) {
    if (announce) toast('先打完一局再来上榜。');
    return false;
  }
  const nickname = setNickname(getNickname() || entry.nickname);
  const finalEntry = { ...entry, nickname };

  const config = await leaderboardConfig();
  if (!isConfigured(config)) {
    if (announce) toast(`本机榜已记下（${nickname}）。全服榜还没接后端，作者配好之后就能上榜。`);
    return false;
  }
  if (alreadySubmitted(finalEntry)) {
    if (announce) toast('这一局已经上过榜了。');
    return true;
  }

  state.leaderboard.loading = true;
  renderLeaderboard();
  const result = await submitEntry(config, finalEntry);
  state.leaderboard.loading = false;
  if (!result.ok) {
    const why =
      result.reason === 'unreachable' ? '连不上排行榜服务器，稍后再试（本机榜已经记下了）。' : `上榜失败：${result.reason}`;
    if (announce) toast(why);
    return false;
  }
  markSubmitted(finalEntry);
  if (announce) {
    toast(`已上榜：${finalEntry.nickname} · ${finalEntry.endingTitle}。复制这行可以让人复核：${reproduceText(finalEntry)}`);
  }
  await refreshBoard();
  return true;
}

/* ------------------------------------------------------------ 结局 */

function renderEnding(ending) {
  const goal = ending.goal;
  const goalHtml = goal
    ? `<div class="goal-banner ${goal.achieved ? 'ok' : 'miss'}">
        <span class="goal-icon">${goal.icon}</span>
        <div>
          <div class="goal-name">高考目标：${escapeHtml(goal.name)}　<b>${goal.achieved ? '已达成' : '未达成'}</b></div>
          <div class="muted small">${escapeHtml(goal.desc ?? '')}</div>
        </div>
      </div>`
    : '';

  const subjects = ending.subjects
    ? `<table class="score-table">
        <tr><th>科目</th><th>分数</th></tr>
        ${Object.entries(ending.subjects)
          .map(([key, value]) => `<tr><td>${escapeHtml(subjectName(key))}</td><td>${value}</td></tr>`)
          .join('')}
      </table>`
    : '';

  // 志愿填报的录取结果（只走普通高考路线的局才有）
  const admission = ending.volunteer;
  const admissionHtml = admission
    ? `<div class="goal-banner ${admission.slip ? 'miss' : 'ok'}">
        <span class="goal-icon">🎯</span>
        <div>
          <div class="goal-name">${
            admission.slip ? '六个志愿全部滑档，最后被调剂录取' : `第 ${escapeHtml(String(admission.round ?? '?'))} 志愿录取`
          }　<b>${escapeHtml(admission.school ?? '')}</b></div>
          <div class="muted small">${escapeHtml(
            [admission.tierName, admission.majorName ?? admission.major].filter(Boolean).join(' · '),
          )}${admission.adjusted ? '　·　服从专业调剂' : ''}</div>
        </div>
      </div>`
    : '';

  const achievements = ending.achievements ?? [];

  // 这一局的关系网 + 演过的剧情，一起放在结局页收尾
  const relations = ending.relations
    ? `<div class="ending-relations">
        <span>🌳 处得最好的人是 <b>${escapeHtml(
          (ending.cast ?? []).slice().sort((a, b) => b.value - a.value)[0]?.name ?? '——',
        )}</b></span>
        <span>走得近 ${ending.relations.close} 人　平均好感 ${ending.relations.average}</span>
      </div>`
    : '';
  const story = (ending.story ?? []).length
    ? `<h3 class="build-title">这一局演过的故事（${ending.story.length} 章）</h3>
       <div class="ending-story">${ending.story
         .map((entry) => `<span class="story-chip">${escapeHtml(entry.arcTitle)} · ${escapeHtml(entry.title)}</span>`)
         .join('')}</div>`
    : '';

  $('ending-body').innerHTML = `
    <div class="ending-title">🏁 ${escapeHtml(ending.title)}</div>
    <div class="ending-school">${escapeHtml(ending.tier ?? '')}${
      ending.school ? ` · ${escapeHtml(ending.school)}` : ''
    }${ending.total ? `　高考 ${ending.total} / 750　年级第 ${ending.rank} 名` : ''}</div>
    ${admissionHtml}
    ${versusEndingHtml(ending.versus)}
    ${goalHtml}
    <p class="ending-text">${escapeHtml(ending.text ?? '')}</p>
    ${subjects}
    ${relations}
    ${story}
    <h3 class="build-title">成就（${achievements.length}）</h3>
    <div class="achievements">${
      achievements
        .map((item) => `<div class="achievement">${item.icon} ${escapeHtml(item.name)}<span>${escapeHtml(item.desc)}</span></div>`)
        .join('') || '<p class="muted">这一局什么都没留下，除了三年。</p>'
    }</div>
    <p class="ending-community">
      📣 喜欢这一局？点上面的「分享这一局」可以把成绩复制走，粘给同学就行；
      也欢迎来腾讯频道【模拟器发布页】聊聊：
      <a href="${escapeHtml(COMMUNITY_URL)}" target="_blank" rel="noopener noreferrer">${escapeHtml(COMMUNITY_URL)}</a>
    </p>
    ${
      state.leaderboard.pending
        ? `<p class="ending-community">🏆 这一局已经记进<b>本机榜</b>（榜上昵称：<b>${escapeHtml(
            state.leaderboard.pending.nickname,
          )}</b>）。点「🏆 上榜」可以提交到全服榜，昵称在排行榜面板里随时改。</p>`
        : ''
    }
  `;
  $('ending-modal').classList.remove('hidden');
}

/* ------------------------------------------------------------ 人物关系树 */

function renderRelations(data) {
  const graph = data.graph;
  $('relations-summary').innerHTML = relationsSummaryHtml(graph.people);
  $('relations-canvas').innerHTML = relationsSvg(graph);
  $('relations-list').innerHTML = graph.people
    .slice()
    .sort((a, b) => b.affinity - a.affinity)
    .map(castCardHtml)
    .join('');
}

async function openRelationsModal() {
  if (!state.gameId) {
    toast('还没有开始的游戏。');
    return;
  }
  try {
    const data = await api(`/api/relations?gameId=${encodeURIComponent(state.gameId)}`);
    renderRelations(data);
    $('relations-modal').classList.remove('hidden');
  } catch (error) {
    toast(`读关系图失败：${error.message}`);
  }
}

/* ------------------------------------------------------------ 故事线 */

function renderStory(data) {
  const progress = data.progress ?? { done: 0, total: 0 };
  $('story-progress').innerHTML =
    `这一局演了 <b>${progress.done}</b> / ${progress.total} 章。` +
    `剧情是排队触发的，不会跟随机事件抢——不过有些线要先跟人处好关系才会往下走。`;
  $('story-body').innerHTML = storyBodyHtml(data.catalog);
}

async function openStoryModal() {
  if (!state.gameId) {
    toast('还没有开始的游戏。');
    return;
  }
  try {
    const data = await api(`/api/story?gameId=${encodeURIComponent(state.gameId)}`);
    renderStory(data);
    $('story-modal').classList.remove('hidden');
  } catch (error) {
    toast(`读故事线失败：${error.message}`);
  }
}

/* ------------------------------------------------------------ 存档文件 */

async function exportSave() {
  if (!state.gameId) {
    toast('还没有开始的游戏。');
    return;
  }
  try {
    const data = await api(`/api/export?gameId=${encodeURIComponent(state.gameId)}`);
    const suggestedName = `中二野人实验室-${state.view?.student.name ?? '存档'}.json`;

    // 桌面版：走原生"另存为"对话框
    if (window.mas2z?.saveFile) {
      const result = await window.mas2z.saveFile({ suggestedName, contents: data.save });
      if (result?.canceled) return;
      if (result?.ok) {
        toast(`存档已保存到 ${result.path}`);
        return;
      }
      toast(`保存失败：${result?.error ?? '未知错误'}`);
      return;
    }

    const blob = new Blob([data.save], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast(error.message);
  }
}

/** 用一段存档 JSON 接上进度（网页版和桌面版共用）。 */
async function applySave(text) {
  const data = await api('/api/import', { method: 'POST', body: { save: text } });
  state.gameId = data.gameId;
  state.recorded = null;
  hideRunModals();
  $('start-screen').classList.add('hidden');
  $('ending-modal').classList.add('hidden');
  render(data.view);
  await persist();
}

async function importSave(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await applySave(await file.text());
  } catch (error) {
    toast(`读档失败：${error.message}`);
  } finally {
    event.target.value = '';
  }
}

/** 随机一个中文常见姓名，填进开局表单。 */
async function randomizeName() {
  try {
    const gender = $('input-gender').value;
    const seed = $('input-seed').value.trim() || `${Date.now()}-${Math.random()}`;
    const data = await api(`/api/random-name?gender=${encodeURIComponent(gender)}&seed=${encodeURIComponent(seed)}`);
    $('input-name').value = data.name;
  } catch (error) {
    toast(`随机姓名失败：${error.message}`);
  }
}

/** 随机一个外号，填进开局表单。 */
async function randomizeNickname() {
  try {
    const seed = `${Date.now()}-${Math.random()}`;
    const data = await api(`/api/nickname?seed=${encodeURIComponent(seed)}`);
    $('input-nickname').value = data.nickname;
    syncDraftFromForm();
    updateBuildHint();
  } catch (error) {
    toast(`随机外号失败：${error.message}`);
  }
}

/**
 * 解析 URL 上的属性点写法：`intelligence:4,mood:2,math:2`。
 * 键可以是 POINT_BUY 里的属性，也可以是科目 key（数学写中文也行）。
 */
function parsePointSpec(text) {
  const points = { spend: {}, subjects: {} };
  const nameToKey = new Map(Object.entries(SUBJECT_NAMES).map(([key, name]) => [name, key]));
  const attrKeys = new Set(attrItems().map((item) => item.key));
  for (const chunk of String(text ?? '').split(/[,，;；\s]+/).filter(Boolean)) {
    const [rawKey, rawValue] = chunk.split(/[:=：]/);
    const value = Math.max(0, Math.round(Number(rawValue)));
    if (!Number.isFinite(value) || value <= 0) continue;
    const key = String(rawKey ?? '').trim();
    if (attrKeys.has(key)) points.spend[key] = (points.spend[key] ?? 0) + value;
    else {
      const subjectKey = SUBJECT_NAMES[key] ? key : nameToKey.get(key);
      if (subjectKey) points.subjects[subjectKey] = (points.subjects[subjectKey] ?? 0) + value;
    }
  }
  return points;
}

/** 桌面版：走原生"打开文件"对话框读档。 */
async function importSaveFromDesktop() {
  try {
    const result = await window.mas2z?.openFile();
    if (!result || result.canceled) return;
    if (!result.ok) {
      toast(`读档失败：${result.error}`);
      return;
    }
    await applySave(result.contents);
  } catch (error) {
    toast(`读档失败：${error.message}`);
  }
}

/* ------------------------------------------------------------ 启动 */

function backToStart() {
  hideRunModals();
  $('ending-modal').classList.add('hidden');
  $('start-screen').classList.remove('hidden');
  updateContinueButton();
}

function bind() {
  $('btn-start').addEventListener('click', startNew);
  $('btn-continue').addEventListener('click', resumeSave);
  $('btn-new').addEventListener('click', backToStart);
  $('btn-restart').addEventListener('click', backToStart);
  $('btn-shop').addEventListener('click', openShopModal);
  $('btn-shop-close').addEventListener('click', () => $('shop-modal').classList.add('hidden'));
  $('btn-relations').addEventListener('click', openRelationsModal);
  $('btn-relations-close').addEventListener('click', () => $('relations-modal').classList.add('hidden'));
  $('btn-story').addEventListener('click', openStoryModal);
  $('btn-story-close').addEventListener('click', () => $('story-modal').classList.add('hidden'));
  $('btn-random-name').addEventListener('click', randomizeName);
  $('btn-random-nickname').addEventListener('click', randomizeNickname);
  $('btn-random-all').addEventListener('click', randomizeAll);
  $('btn-reset-creator').addEventListener('click', resetCreator);
  $('btn-open-cards').addEventListener('click', openCardsModal);
  $('btn-card-save').addEventListener('click', saveCurrentCard);
  $('btn-save-card').addEventListener('click', () => {
    openCardsModal();
    $('input-card-name').focus();
  });
  $('btn-cards-close').addEventListener('click', () => $('cards-modal').classList.add('hidden'));
  $('btn-cards-clear').addEventListener('click', () => {
    saveCards([]);
    renderCards();
    toast('角色卡已全部清空。');
  });
  // 打字类输入只更新草稿和提示，不重绘，免得焦点被抢走
  for (const id of ['input-name', 'input-nickname']) {
    $(id).addEventListener('input', () => {
      syncDraftFromForm();
      updateBuildHint();
    });
  }
  $('input-gender').addEventListener('change', () => {
    syncDraftFromForm();
    renderCastRoles();
    updateBuildHint();
  });
  for (const id of ['input-weeks', 'input-seed']) $(id).addEventListener('input', updateBuildHint);
  $('input-endless').addEventListener('change', updateBuildHint);
  $('btn-gallery').addEventListener('click', openGalleryModal);
  $('btn-start-gallery').addEventListener('click', openGalleryModal);
  $('btn-ending-gallery').addEventListener('click', openGalleryModal);
  $('btn-gallery-close').addEventListener('click', () => $('gallery-modal').classList.add('hidden'));

  // 交流 / 关于：顶栏和开局那一屏都能打开同一个面板
  $('btn-community').addEventListener('click', openCommunityModal);
  $('btn-about-start').addEventListener('click', openCommunityModal);
  $('btn-community-close').addEventListener('click', () => $('community-modal').classList.add('hidden'));
  $('btn-community-copy').addEventListener('click', async () => {
    const ok = await copyText(COMMUNITY_URL);
    toast(ok ? '频道链接已复制，粘给同学就能进来。' : `复制失败，链接是 ${COMMUNITY_URL}`);
  });
  $('btn-community-share').addEventListener('click', async () => {
    const ok = await copyText(communityShareText());
    toast(ok ? '推荐文案已复制，粘到群里就行。' : `复制失败，链接是 ${COMMUNITY_URL}`);
  });
  $('btn-ending-share').addEventListener('click', async () => {
    const ok = await copyText(endingShareText());
    toast(ok ? '这一局的成绩已复制，去频道或群里晒一晒。' : `复制失败，链接是 ${COMMUNITY_URL}`);
  });

  // 🏆 排行榜：昵称 + 两个榜 + 上榜
  $('btn-leaderboard').addEventListener('click', openLeaderboardModal);
  $('btn-leaderboard-close').addEventListener('click', () => $('leaderboard-modal').classList.add('hidden'));
  $('btn-leaderboard-refresh').addEventListener('click', () => {
    void refreshBoard();
  });
  $('btn-leaderboard-submit').addEventListener('click', () => {
    void submitCurrentRun();
  });
  $('btn-ending-leaderboard').addEventListener('click', async () => {
    await submitCurrentRun();
    await openLeaderboardModal();
  });
  $('btn-save-nickname').addEventListener('click', () => {
    const name = setNickname($('input-nickname-board').value);
    if (state.leaderboard.pending) state.leaderboard.pending = { ...state.leaderboard.pending, nickname: name };
    toast(`昵称已保存：${name}`);
    renderLeaderboard();
  });
  $('btn-nickname-save').addEventListener('click', () => {
    const name = setNickname($('input-nickname-first').value);
    $('nickname-modal').classList.add('hidden');
    toast(`好，${name}——三年之后榜上见。`);
  });
  $('btn-nickname-skip').addEventListener('click', () => {
    $('nickname-modal').classList.add('hidden');
  });
  $('btn-gallery-reset').addEventListener('click', () => {
    saveProfile(emptyProfile());
    renderGallery();
    toast('图鉴收集已清空。');
  });
  $('btn-save').addEventListener('click', exportSave);
  $('btn-load').addEventListener('click', () => {
    if (window.mas2z?.openFile) importSaveFromDesktop();
    else $('file-input').click();
  });
  $('file-input').addEventListener('change', importSave);
  $('turn-lines').addEventListener('click', () => $('turn-lines').classList.add('hidden'));

  // 内容包面板（热更新入口）
  $('btn-content').addEventListener('click', openContentModal);
  $('btn-content-close').addEventListener('click', () => $('content-modal').classList.add('hidden'));
  $('btn-content-file').addEventListener('click', () => $('content-file-input').click());
  $('content-file-input').addEventListener('change', importContentFile);
  $('btn-content-text').addEventListener('click', applyPastedContent);
  $('btn-content-url').addEventListener('click', fetchContentFromUrl);
  $('btn-content-reset').addEventListener('click', resetContentPack);
  $('btn-content-update').addEventListener('click', () => void checkUpdatesFromPanel({ manual: true }));

  // 更新提示（推送）：立即更新 / 稍后 / 忽略这一版
  $('btn-update-now').addEventListener('click', applyUpdateFromBanner);
  $('btn-update-later').addEventListener('click', () => {
    updatePostponed = true;
    hideUpdateBanner();
  });
  $('btn-update-ignore').addEventListener('click', ignoreUpdateVersion);

  // 志愿填报
  $('btn-volunteer-submit').addEventListener('click', submitVolunteer);
  $('btn-volunteer-continue').addEventListener('click', continueToEnding);

  // 桌面版：接住原生菜单命令
  window.mas2z?.onCommand?.((command) => {
    if (command === 'new-game') backToStart();
    else if (command === 'export') exportSave();
    else if (command === 'import') importSaveFromDesktop();
    else if (command === 'gallery') openGalleryModal();
    else if (command === 'shop' && state.gameId) openShopModal();
  });
}

/**
 * `?demo` 快速开始：用一套默认构筑直接开局，跳过开局表单。
 *
 *   index.html?demo        直接开局（名字随机）
 *   index.html?demo=6      开局后再自动走 6 步，让日志里有东西
 *   index.html?demo&preset=olympiad&nickname=闪电&points=intelligence:6,math:2
 *   index.html?demo=60&mode=versus&rival=hard&weeks=3   AI 对战 + 短学期（分享用）
 *
 * 后几个参数是给"分享链接"和版面探针用的：能在不开表单的情况下
 * 直接展示自定义人物的效果（外号、性格、属性点都会出现在侧栏里）。
 */
async function maybeAutoStart() {
  const params = new URLSearchParams(location.search);
  if (!params.has('demo')) return false;
  const options = state.options;
  if (!options) return false;

  const draft = state.draft;
  draft.track = options.tracks?.[0]?.id ?? 'physics';
  draft.electives = (options.electives ?? []).slice(0, electiveLimit()).map((item) => item.key);
  draft.traits = (options.traits ?? []).slice(0, traitLimit()).map((item) => item.id);
  draft.background = options.backgrounds?.[0]?.id ?? 'worker';
  draft.goal = 'yiben';
  draft.endless = false;
  $('input-difficulty').value = 'normal';
  draft.difficulty = 'normal';
  $('input-weeks').value = String(options.defaultWeeks ?? 6);
  draft.weeksPerSemester = options.defaultWeeks ?? 6;

  if (params.get('preset') && listOf('presets').some((item) => item.id === params.get('preset'))) {
    applyPreset(params.get('preset'));
  }
  if (params.get('personality') && listOf('personalities').some((item) => item.id === params.get('personality'))) {
    draft.personality = params.get('personality');
  }
  if (params.get('avatar')) draft.avatar = params.get('avatar');
  if (params.get('nickname')) draft.nickname = params.get('nickname');
  if (params.get('flaw')) draft.flaws = [params.get('flaw')];
  if (params.get('points')) draft.points = parsePointSpec(params.get('points'));
  if (params.get('difficulty') && options.difficulties.some((item) => item.key === params.get('difficulty'))) {
    draft.difficulty = params.get('difficulty');
    $('input-difficulty').value = draft.difficulty;
  }
  // v3.0：分享链接也能直接指定玩法，例如 ?demo=3&mode=versus&rival=hard
  if (params.get('mode') === 'versus') draft.mode = 'versus';
  if (params.get('rival') && listOf('rivalLevels').some((item) => item.key === params.get('rival'))) {
    draft.rivalLevel = params.get('rival');
  }
  // 学期周数：分享一个"短一点的局"用，例如 ?demo=60&weeks=3
  if (params.get('weeks')) {
    const weeks = Math.max(3, Math.min(20, Number(params.get('weeks')) || 6));
    draft.weeksPerSemester = weeks;
    $('input-weeks').value = String(weeks);
  }
  // 跳过志愿填报直接按分数录取：分享"一键看到结局"的链接用（?demo=60&weeks=3&volunteers=0）
  if (params.get('volunteers') === '0') draft.volunteers = false;
  // 上面改的是草稿，startNew 会从表单读一遍，所以要先把草稿写回表单
  applyDraftToForm();

  await startNew();
  if (state.view?.status !== 'playing') return true;

  // 想顺便把日志填满的话，就自动走几步（每步都挑第一个能做的行动）
  const steps = Math.max(0, Math.min(60, Number(params.get('demo')) || 0));
  for (let i = 0; i < steps && state.view?.status === 'playing'; i += 1) {
    const action = state.view.actions.find((item) => item.available);
    if (!action) break;
    try {
      await doAction(action.id, action.subjectOptions?.[0]?.key);
    } catch {
      break;
    }
    if (state.view?.pendingEvent) {
      await pickEventChoice(state.view.pendingEvent.choices[0].id);
    }
  }
  return true;
}

async function main() {
  bind();
  syncCommunityLinks();
  const mode = await detectApiMode();
  showModeBadge(mode);
  try {
    applyOptions(await api('/api/options'));
  } catch (error) {
    toast(`读取开局选项失败：${error.message}`);
  }
  updateContinueButton();
  // 第一次进来先问昵称：它只是本机的一个字符串，没有网络请求，所以同步弹就行
  if (!getNickname()) $('nickname-modal').classList.remove('hidden');
  try {
    await maybeAutoStart();
  } catch (error) {
    toast(`快速开局失败：${error.message}`);
  }
  // 更新自检放在最后、而且不 await：它可能要等 5 秒网络，绝不能拖住界面
  void updateCheckOnBoot();
}

/** 顶栏上标一下当前是"服务端"还是"离线单机"，离线时说明进度存在本机。 */
function showModeBadge(mode) {
  const badge = $('mode-badge');
  if (!badge) return;
  if (mode === 'local') {
    badge.textContent = window.mas2z?.isDesktop ? '桌面离线版' : '离线单机版';
    badge.title = '没有连接服务端，游戏逻辑直接跑在页面里；进度保存在本机浏览器。';
    badge.hidden = false;
  } else {
    badge.textContent = '服务端模式';
    badge.title = '由 Node 服务提供游戏逻辑与存档会话。';
    badge.hidden = false;
  }
}

main();
