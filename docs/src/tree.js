/**
 * 人物关系树状图：把 game.cast + game.npc 变成"可以直接画出来"的图。
 *
 * 布局是纯函数、确定性的（不依赖随机、不依赖时间），所以：
 *   - 前端可以拿坐标直接画 SVG；
 *   - 命令行可以打出 ASCII 版；
 *   - 测试可以断言"每个孩子都挂在父节点下""同层不重叠"。
 *
 * 坐标单位是"格"，不是像素：前端用 viewBox 缩放到容器大小。
 */

import { CAST_GROUPS, CAST_GROUP_MAP, TONE_COLORS, affinityLevel } from './data/cast.js';

/** 布局常量（单位：格）。 */
export const LAYOUT = {
  colWidth: 240, // 层与层之间的横向间距
  rowHeight: 68, // 同一层内相邻节点的纵向间距
  paddingX: 120, // 左右留白（放节点气泡）
  paddingY: 60,
};

/** 关系树上的一条边。 */
function edge(from, to, kind) {
  return { from, to, kind };
}

/**
 * 生成关系树。
 *
 * @param {object} game
 * @returns {{
 *   width: number, height: number,
 *   nodes: object[], edges: object[],
 *   groups: object[], people: object[]
 * }}
 */
export function relationGraph(game) {
  const cast = game?.cast?.list ?? [];
  const npc = game?.npc ?? {};

  const nodes = [];
  const edges = [];

  const rootId = 'me';
  const rootNode = {
    id: rootId,
    kind: 'root',
    label: game?.student?.name ?? '你',
    sub: `${game?.student?.className ?? ''}　${game?.student?.track ?? ''}`.trim(),
    icon: '🧑‍🎓',
    depth: 0,
    x: LAYOUT.paddingX,
    y: 0,
    affinity: null,
    affinityLabel: null,
    tone: null,
  };
  nodes.push(rootNode);

  // 只保留真的有人在的分组
  const groups = CAST_GROUPS.map((group) => ({
    ...group,
    members: cast.filter((person) => person.group === group.id),
  })).filter((group) => group.members.length > 0);

  const personNodes = [];
  let leafIndex = 0;

  for (const group of groups) {
    const groupId = `group:${group.id}`;
    const groupNode = {
      id: groupId,
      kind: 'group',
      group: group.id,
      label: group.name,
      sub: `${group.members.length} 人`,
      icon: group.icon,
      desc: group.desc,
      depth: 1,
      x: LAYOUT.paddingX + LAYOUT.colWidth,
      y: 0,
      affinity: null,
      affinityLabel: null,
      tone: null,
      children: [],
    };
    nodes.push(groupNode);
    edges.push(edge(rootId, groupId, 'group'));

    for (const person of group.members) {
      const value = Math.round(npc[person.affinity] ?? 0);
      const level = affinityLevel(value, person.id);
      const personId = `person:${person.id}`;
      const shared = (cast.filter((item) => item.affinity === person.affinity) ?? []).length > 1;
      const node = {
        id: personId,
        kind: 'person',
        personId: person.id,
        role: person.role,
        group: person.group,
        affinityKey: person.affinity,
        label: person.name,
        call: person.call,
        sub: person.role,
        icon: person.icon,
        gender: person.gender,
        blurb: person.blurb,
        depth: 2,
        x: LAYOUT.paddingX + LAYOUT.colWidth * 2,
        y: 0,
        affinity: value,
        affinityLabel: level.label,
        tone: level.tone,
        color: TONE_COLORS[level.tone] ?? TONE_COLORS.plain,
        shared,
      };
      nodes.push(node);
      personNodes.push(node);
      edges.push(edge(groupId, personId, 'member'));
      groupNode.children.push(node);
    }
  }

  // 叶子按顺序排开，父节点落在孩子的中间
  for (const node of personNodes) {
    node.y = LAYOUT.paddingY + leafIndex * LAYOUT.rowHeight;
    leafIndex += 1;
  }
  const centerOf = (list) => {
    const ys = list.map((item) => item.y);
    return (Math.min(...ys) + Math.max(...ys)) / 2;
  };
  for (const group of groups) {
    const groupNode = nodes.find((item) => item.id === `group:${group.id}`);
    groupNode.y = centerOf(groupNode.children);
  }
  rootNode.y = centerOf(groups.map((group) => nodes.find((item) => item.id === `group:${group.id}`)));

  const width = LAYOUT.paddingX * 2 + LAYOUT.colWidth * 2;
  const height = LAYOUT.paddingY * 2 + Math.max(1, leafIndex - 1) * LAYOUT.rowHeight;

  for (const node of nodes) delete node.children;

  const people = personNodes
    .slice()
    .sort((a, b) => b.affinity - a.affinity || a.role.localeCompare(b.role, 'zh'))
    .map((node) => ({
      id: node.personId,
      name: node.label,
      role: node.role,
      icon: node.icon,
      group: node.group,
      affinityKey: node.affinityKey,
      affinity: node.affinity,
      affinityLabel: node.affinityLabel,
      tone: node.tone,
      color: node.color,
      shared: node.shared,
      blurb: node.blurb,
    }));

  return {
    width,
    height,
    nodes,
    edges,
    groups: groups.map((group) => {
      const groupNode = nodes.find((item) => item.id === `group:${group.id}`);
      return {
        id: group.id,
        name: group.name,
        icon: group.icon,
        desc: group.desc,
        x: groupNode.x,
        y: groupNode.y,
        members: group.members.map((person) => `person:${person.id}`),
      };
    }),
    people,
  };
}

/** 一条好感度进度条（纯文本，给命令行用）。 */
export function affinityBar(value, width = 10) {
  const filled = Math.round((Math.max(0, Math.min(100, Number(value) || 0)) / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

/**
 * 把关系树打成命令行里的缩进树。
 * @param {ReturnType<typeof relationGraph>} graph
 */
export function renderTreeText(graph) {
  if (!graph?.nodes?.length) return '（这一局还没有建立人际关系）';
  const byId = Object.fromEntries(graph.nodes.map((node) => [node.id, node]));
  const childrenOf = (id) => graph.edges.filter((item) => item.from === id).map((item) => byId[item.to]).filter(Boolean);

  const lines = [];
  const root = byId.me;
  lines.push(`${root.icon} ${root.label}${root.sub ? `　${root.sub}` : ''}`);

  const groups = childrenOf('me');
  groups.forEach((group, groupIndex) => {
    const lastGroup = groupIndex === groups.length - 1;
    lines.push(`${lastGroup ? '└─' : '├─'} ${group.icon} ${group.label}　${group.sub}`);
    const prefix = lastGroup ? '   ' : '│  ';
    const members = childrenOf(group.id);
    members.forEach((person, index) => {
      const lastPerson = index === members.length - 1;
      const bar = affinityBar(person.affinity);
      const head = `${prefix}${lastPerson ? '└─' : '├─'} ${person.icon} ${padWidth(person.label, 8)} ${person.sub}`;
      lines.push(`${head}　${bar} ${String(person.affinity).padStart(3)}　${person.affinityLabel}${person.shared ? '（共用好感）' : ''}`);
    });
  });
  return lines.join('\n');
}

/** 按显示宽度补空格（中文算两格）。 */
function padWidth(text, width) {
  const value = String(text ?? '');
  let visual = 0;
  for (const ch of value) visual += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  return value + ' '.repeat(Math.max(0, width - visual));
}

/** 关系树的统计信息（测试和界面摘要都用它）。 */
export function treeStats(graph) {
  const people = graph?.nodes?.filter((node) => node.kind === 'person') ?? [];
  const close = people.filter((node) => node.affinity >= 70).length;
  const cold = people.filter((node) => node.affinity < 30).length;
  const best = people.slice().sort((a, b) => b.affinity - a.affinity)[0] ?? null;
  return {
    total: people.length,
    close,
    cold,
    average: people.length ? Math.round(people.reduce((sum, node) => sum + node.affinity, 0) / people.length) : 0,
    best: best ? { id: best.personId, name: best.label, role: best.role, affinity: best.affinity } : null,
  };
}

export { CAST_GROUP_MAP };
