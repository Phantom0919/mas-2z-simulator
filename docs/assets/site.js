/**
 * 发布页的增强脚本（没有它页面也完整可读，只是少了放大截图和自动取版本号）。
 *
 * 只做五件事：
 *   1. 截图点击放大（Esc / 点背景关闭）；
 *   2. 复制腾讯频道链接（QQ 里点开链接和复制链接是两种需求）；
 *   3. 拉一下 ./download/latest.json，把版本号、体积、SHA-256 填进页面——
 *      这几个数字由 tools/build-pages.mjs 从真实产物算出来，手写就一定会写旧；
 *   4. 页脚年份；
 *   5. 排行榜：读 ./content/leaderboard.json 的后端配置（留空就什么都不发），
 *      再按当前指标拉榜单。排序和并列名次直接用游戏那份 src/leaderboard.js，
 *      所以官网页和游戏里看到的榜是同一套规则，不会两处各写一遍。
 */

import { LEADERBOARD_METRICS, fetchBoard, isConfigured, rankEntries, summarizeBoard } from '../src/leaderboard.js';

const byId = (id) => document.getElementById(id);
const NICKNAME_KEY = 'mas2z-nickname-v1';

/* ------------------------------------------------------------ 截图放大 */

function setupLightbox() {
  const box = byId('lightbox');
  const image = byId('lightbox-img');
  const title = byId('lightbox-title');
  const close = byId('lightbox-close');
  if (!box || !image || !close) return;

  let lastFocus = null;

  const hide = () => {
    box.hidden = true;
    image.removeAttribute('src');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  };

  const show = (button) => {
    const full = button.getAttribute('data-full');
    if (!full) return;
    lastFocus = button;
    image.src = full;
    image.alt = button.querySelector('img')?.alt ?? '';
    if (title) title.textContent = button.getAttribute('data-title') ?? '';
    box.hidden = false;
    close.focus();
  };

  for (const button of document.querySelectorAll('.shot-btn')) {
    button.addEventListener('click', () => show(button));
  }

  close.addEventListener('click', hide);
  box.addEventListener('click', (event) => {
    if (event.target === box) hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !box.hidden) hide();
  });
}

/* -------------------------------------------------------------- 小提示 */

let toastTimer = null;

function toast(message) {
  const node = byId('toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 2200);
}

/* ------------------------------------------------------ 复制频道链接 */

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => fallbackCopy(text),
    );
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text) {
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  helper.remove();
  return ok;
}

function setupCopyButtons() {
  for (const button of document.querySelectorAll('[data-copy-link]')) {
    button.addEventListener('click', () => {
      const link = button.getAttribute('data-copy-link') ?? '';
      Promise.resolve(copyText(link)).then((ok) => {
        toast(ok ? '链接已复制，去 QQ 里粘贴打开' : `复制失败，链接是 ${link}`);
      });
    });
  }
}

/* ------------------------------------------------- 真实产物信息回填 */

function applyText(selector, text) {
  for (const node of document.querySelectorAll(selector)) node.textContent = text;
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function loadBuildInfo() {
  let info = null;
  try {
    const response = await fetch('./download/latest.json', { cache: 'no-store' });
    if (response.ok) info = await response.json();
  } catch {
    info = null;
  }
  if (!info || typeof info !== 'object') return;

  if (info.version) {
    applyText('[data-version-badge]', `v${String(info.version).replace(/^v/, '')}`);
    applyText('[data-apk-version]', `v${String(info.version).replace(/^v/, '')}`);
  }
  const size = formatSize(Number(info.bytes));
  if (size) applyText('[data-apk-size]', size);
  if (info.sha256) applyText('[data-apk-sha]', `${String(info.sha256).slice(0, 24)}…`);
  applyText('[data-year]', String(new Date().getFullYear()));
}

/* ------------------------------------------------------------- 排行榜 */

const boardState = { config: null, metric: 'score', entries: [], source: 'none' };

function difficultyName(key) {
  return (
    {
      easy: '轻松',
      normal: '普通',
      hard: '困难',
      realistic: '真实',
      custom: '自定义',
    }[key] ?? key
  );
}

function myNickname() {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

async function boardConfig() {
  if (boardState.config) return boardState.config;
  let config = { format: 1, supabase: { url: '', anonKey: '', table: 'leaderboard' } };
  try {
    const response = await fetch('./content/leaderboard.json', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (data && typeof data === 'object') config = { ...config, ...data };
    }
  } catch {
    /* 读不到就当没配置：只有本机那点数据可看 */
  }
  boardState.config = config;
  return config;
}

function rowHtml(entry, nickname) {
  const mine = nickname && entry.nickname.toLowerCase() === nickname.toLowerCase();
  const badges = [
    `<span class="board-badge">${difficultyName(entry.difficulty)}</span>`,
    entry.mode === 'versus' ? `<span class="board-badge versus">⚔️ AI 对战</span>` : '<span class="board-badge">🎮 单人</span>',
  ].join('');
  const score = entry.score ? `<b>${entry.score}</b> 分` : '未参加高考';
  const rank = entry.rank ? `　年级第 ${entry.rank} 名` : '';
  return `
    <li class="${[entry.tied ? 'tied' : '', mine ? 'mine' : ''].filter(Boolean).join(' ')}">
      <span class="board-position">${entry.position}</span>
      <span class="board-main">
        <span class="board-name">${escapeText(entry.nickname)}${mine ? '（你）' : ''}</span>
        <span class="board-ending">${escapeText(entry.endingTitle)}</span>
        <span class="board-meta">${score}${rank}　📖 图鉴 ${entry.endings}　🏅 成就 ${entry.achievements}${badges}</span>
      </span>
    </li>`;
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function renderBoard() {
  const tabs = byId('board-tabs');
  const list = byId('board-list');
  const empty = byId('board-empty');
  const note = byId('board-note');
  const mine = byId('board-mine');
  if (!tabs || !list) return;

  const metric = LEADERBOARD_METRICS.find((item) => item.key === boardState.metric) ?? LEADERBOARD_METRICS[0];
  tabs.innerHTML = LEADERBOARD_METRICS.map(
    (item) =>
      `<button type="button" role="tab" aria-selected="${item.key === metric.key}" class="${item.key === metric.key ? 'on' : ''}" data-metric="${item.key}">${item.icon} ${item.name}</button>`,
  ).join('');
  for (const button of tabs.querySelectorAll('button[data-metric]')) {
    button.addEventListener('click', () => {
      boardState.metric = button.dataset.metric;
      renderBoard();
      void loadBoard();
    });
  }
  if (note) note.textContent = `${metric.icon} ${metric.desc}`;

  const nickname = myNickname();
  const configured = isConfigured(boardState.config);
  list.innerHTML = boardState.entries.map((entry) => rowHtml(entry, nickname)).join('');

  if (empty) {
    const show = boardState.entries.length === 0;
    empty.hidden = !show;
    if (show) {
      empty.textContent = !configured
        ? '排行榜还没接后端：作者需要先建一个 Supabase 项目（README 里「玩家排行榜」一节有 5 步说明）。接上之后这里会自动显示全服榜单。'
        : boardState.source === 'error'
          ? '排行榜暂时读不到（服务器或网络的问题），刷新再试。'
          : '这个榜还是空的——去游戏里打完一局，在结局页点「🏆 上榜」就是第一条。';
    }
  }

  if (mine) {
    const summary = summarizeBoard(boardState.entries, metric.key, nickname);
    if (nickname && summary.mine) {
      mine.hidden = false;
      mine.innerHTML = `你的昵称是 <b>${escapeText(nickname)}</b>，当前在${metric.name}上排第 <b>${summary.mine.position}</b> 名（共 ${summary.total} 位）。`;
    } else {
      mine.hidden = true;
      mine.textContent = '';
    }
  }
}

async function loadBoard() {
  const config = await boardConfig();
  if (!isConfigured(config)) {
    // 没配后端：本地那份"本机榜"在游戏里，网页上不显示（同一个 origin 下游戏和网页共享 localStorage，
    // 但没上过榜的成绩不该在官网被当成全服榜展示）
    boardState.entries = [];
    boardState.source = 'unconfigured';
    renderBoard();
    return;
  }
  const result = await fetchBoard(config, { metric: boardState.metric });
  if (result.ok) {
    boardState.entries = rankEntries(result.entries, boardState.metric);
    boardState.source = 'remote';
  } else {
    boardState.entries = [];
    boardState.source = 'error';
  }
  renderBoard();
}

function setupLeaderboard() {
  if (!byId('board-list')) return;
  // 先画一遍骨架（未配置时也要有说明文案），再去拉数据
  boardState.config = null;
  renderBoard();
  void loadBoard();
}

setupLightbox();
setupCopyButtons();
setupLeaderboard();
applyText('[data-year]', String(new Date().getFullYear()));
loadBuildInfo();
