/**
 * 发布页的增强脚本（没有它页面也完整可读，只是少了放大截图和自动取版本号）。
 *
 * 只做四件事：
 *   1. 截图点击放大（Esc / 点背景关闭）；
 *   2. 复制腾讯频道链接（QQ 里点开链接和复制链接是两种需求）；
 *   3. 拉一下 ./download/latest.json，把版本号、体积、SHA-256 填进页面——
 *      这几个数字由 tools/build-pages.mjs 从真实产物算出来，手写就一定会写旧；
 *   4. 页脚年份。
 */

const byId = (id) => document.getElementById(id);

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

setupLightbox();
setupCopyButtons();
applyText('[data-year]', String(new Date().getFullYear()));
loadBuildInfo();
