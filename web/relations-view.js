/**
 * 人物关系树 + 故事线的纯渲染函数（不碰 DOM，只吐 HTML/SVG 字符串）。
 *
 * 单独拆出来的原因：这样可以在 Node 里直接跑单元测试，
 * 断言"每个人都在图上""SVG 标签闭合""没有 undefined 漏出来"，
 * 而不用去开浏览器。
 */

/** 关系树上一个节点的盒子尺寸（viewBox 单位，跟 src/tree.js 的布局常量对应）。 */
export const TREE_NODE = { width: 196, height: 54 };

/** 关系冷热 → 颜色，跟引擎 src/data/cast.js 里的 TONE_COLORS 对齐。 */
export const TONE_COLORS = {
  best: '#3fb950',
  good: '#56d364',
  warm: '#d29922',
  plain: '#8b949e',
  cold: '#db6d28',
  bad: '#f85149',
};

export const toneColor = (tone) => TONE_COLORS[tone] ?? TONE_COLORS.plain;

export function esc(text) {
  return String(text ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

/** 一条进度条（跟 app.js 里的 meter 同形，独立一份避免循环依赖）。 */
function meterBar(value, max, color) {
  const ratio = Math.max(0, Math.min(1, max ? value / max : 0));
  return `<span class="meter"><i style="width:${(ratio * 100).toFixed(1)}%;background:${color}"></i></span>`;
}

/** 关系树上的一条连线：父节点右侧 → 子节点左侧，用三次贝塞尔画得柔和些。 */
function treeEdgeSvg(from, to) {
  const half = TREE_NODE.width / 2;
  const x1 = from.x + half;
  const y1 = from.y;
  const x2 = to.x - half;
  const y2 = to.y;
  const mid = (x1 + x2) / 2;
  return `<path class="tree-edge" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" />`;
}

/** 关系树上的一个节点盒子。 */
export function treeNodeSvg(node) {
  const w = TREE_NODE.width;
  const h = TREE_NODE.height;
  const left = node.x - w / 2;
  const top = node.y - h / 2;
  const color = node.kind === 'person' ? toneColor(node.tone) : '#58a6ff';
  const stroke = node.kind === 'person' ? color : node.kind === 'root' ? '#58a6ff' : '#30363d';

  const box = `<rect class="tree-box ${node.kind}" x="${left}" y="${top}" width="${w}" height="${h}" rx="10" stroke="${stroke}" />`;

  if (node.kind !== 'person') {
    // 图标和文字放在同一个 <text> 里居中排，避免两个 text 叠在一起
    return `<g class="tree-node ${node.kind}">${box}
      <text class="tree-label" x="${node.x}" y="${top + 25}" text-anchor="middle">${node.icon} ${esc(node.label)}</text>
      <text class="tree-sub" x="${node.x}" y="${top + 42}" text-anchor="middle">${esc(node.sub ?? '')}</text>
    </g>`;
  }

  const barX = left + 46;
  const barW = w - 46 - 12;
  const ratio = Math.max(0, Math.min(1, (node.affinity ?? 0) / 100));
  return `<g class="tree-node person" data-person="${esc(node.personId)}">
    ${box}
    <text class="tree-icon" x="${left + 26}" y="${top + 24}" text-anchor="middle">${node.icon}</text>
    <text class="tree-label" x="${left + 46}" y="${top + 22}">${esc(node.label)}</text>
    <text class="tree-value" x="${left + w - 12}" y="${top + 22}" text-anchor="end" fill="${color}">${Number(node.affinity) || 0}</text>
    <text class="tree-sub" x="${left + 46}" y="${top + 37}">${esc(node.role)}　${esc(node.affinityLabel)}</text>
    <rect class="tree-bar-bg" x="${barX}" y="${top + 42}" width="${barW}" height="5" rx="2.5" />
    <rect x="${barX}" y="${top + 42}" width="${(barW * ratio).toFixed(1)}" height="5" rx="2.5" fill="${color}" />
  </g>`;
}

/** 关系树整张 SVG。 */
export function relationsSvg(graph) {
  if (!graph?.nodes?.length) return '<p class="muted">还没有建立人际关系。</p>';
  const byId = Object.fromEntries(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges
    .map((edge) => {
      const from = byId[edge.from];
      const to = byId[edge.to];
      if (!from || !to) return '';
      return treeEdgeSvg(from, to);
    })
    .join('');
  const nodes = graph.nodes.map(treeNodeSvg).join('');
  // 带上 xmlns：塞进 HTML 里不影响，单独存成 .svg 文件也能被浏览器/工具正确识别
  return `<svg xmlns="http://www.w3.org/2000/svg" class="tree-svg" viewBox="0 0 ${graph.width} ${graph.height}" width="${graph.width}" height="${graph.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="人物关系树状图">
    <g class="tree-edges">${edges}</g>
    <g class="tree-nodes">${nodes}</g>
  </svg>`;
}

/** 关系图上方的一句话摘要。 */
export function relationsSummaryHtml(people) {
  const list = people ?? [];
  if (list.length === 0) return '这一局还没有跟谁建立关系。';
  const close = list.filter((person) => person.affinity >= 70).length;
  const best = list.slice().sort((a, b) => b.affinity - a.affinity)[0];
  return (
    `这一局一共 <b>${list.length}</b> 个人跟你有关系：` +
    `走得很近的 <b>${close}</b> 个，最高的是 ${best.icon} <b>${esc(best.name)}</b>（${best.affinity}）。` +
    `线越绿关系越好，越红越僵；点卡片可以看每个人的近况。`
  );
}

/** 人物卡片（关系图下方的列表，手机上比看 SVG 舒服）。 */
export function castCardHtml(person) {
  const color = toneColor(person.tone);
  const share = person.shared ? '<span class="muted small">共用好感</span>' : '';
  return `<div class="cast-card" style="border-color:${color}55">
    <div class="cast-head">
      <span class="cast-icon">${person.icon}</span>
      <span class="cast-name">${esc(person.name)}</span>
      <span class="cast-role">${esc(person.role)}</span>
    </div>
    <div class="cast-meter">
      ${meterBar(person.affinity, 100, color)}
      <span style="color:${color}">${person.affinity}</span>
      <span class="muted small">${esc(person.affinityLabel)}</span>
    </div>
    <p class="cast-blurb">${esc(person.blurb ?? '')}</p>
    ${share}
  </div>`;
}

/** 故事线里的一个章节。 */
export function storyChapterHtml(chapter, index) {
  const number = `<span class="story-index">${String(index + 1).padStart(2, '0')}</span>`;
  if (!chapter.unlocked) {
    return `<div class="story-chapter locked">
      ${number}
      <div class="story-chapter-body">
        <div class="story-chapter-title">🔒 ${esc(chapter.title)}</div>
        <div class="story-chapter-hint">还没演到（大约第 ${chapter.week} 周之后，有些章节还要先跟人处好关系）</div>
      </div>
    </div>`;
  }
  return `<div class="story-chapter unlocked">
    ${number}
    <div class="story-chapter-body">
      <div class="story-chapter-title">${esc(chapter.title)}${
        chapter.at ? `<span class="muted small">　${esc(chapter.at)}</span>` : ''
      }</div>
      <p class="story-chapter-text">${esc(chapter.text ?? '')}</p>
    </div>
  </div>`;
}

/** 一条故事线（含全部章节）。 */
export function storyArcHtml(arc) {
  return `<section class="story-arc${arc.done ? '' : ' untouched'}" data-arc="${esc(arc.id)}">
    <header class="story-arc-head">
      <span class="story-arc-icon">${arc.icon}</span>
      <div>
        <div class="story-arc-title">${esc(arc.title)}</div>
        <div class="muted small">${esc(arc.intro)}${
          arc.personName ? `　·　与 ${esc(arc.personName)} 有关` : ''
        }</div>
      </div>
      <span class="story-arc-progress">${arc.done}/${arc.total}</span>
    </header>
    <div class="story-chapters">${arc.chapters.map(storyChapterHtml).join('')}</div>
  </section>`;
}

/** 整个故事线弹层的内容。 */
export function storyBodyHtml(catalog) {
  const list = catalog ?? [];
  if (list.length === 0) return '<p class="muted">这一版还没有剧情线。</p>';
  return list.map(storyArcHtml).join('');
}
