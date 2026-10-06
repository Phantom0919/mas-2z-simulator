/**
 * 一次性调试脚本：把关系树的 SVG 和故事线的 HTML 落盘，供人眼/脚本检查。
 * 不进测试、不影响游戏，只是为了"没有浏览器也能看一眼效果"。
 *
 *   node tools/preview-relations.mjs [输出目录]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createGame, playWeek, relationGraph, storyCatalog, storyProgress } from '../src/engine.js';
import { getStrategy } from '../src/strategies.js';
import { relationsSvg, storyBodyHtml } from '../web/relations-view.js';

const outDir = process.argv[2] ?? 'build/preview';
mkdirSync(outDir, { recursive: true });

const game = createGame({ name: '林晚', seed: process.argv[3] ?? 'preview-1', gender: '女' });

// 打到一半，好让关系和剧情都有内容
const strategy = getStrategy('balanced');
let guard = 0;
while (game.status === 'playing' && game.turn < 18 && guard < 200) {
  guard += 1;
  playWeek(game, strategy);
}

const graph = relationGraph(game);
writeFileSync(join(outDir, 'relations.svg'), relationsSvg(graph), 'utf8');
writeFileSync(join(outDir, 'graph.json'), JSON.stringify(graph, null, 2), 'utf8');
writeFileSync(
  join(outDir, 'story.html'),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>故事线预览</title>` +
    `<link rel="stylesheet" href="../../web/style.css"></head><body>` +
    `<div class="card wide-card"><div class="event-title">📜 故事线</div>${storyBodyHtml(storyCatalog(game))}</div></body></html>`,
  'utf8',
);

const progress = storyProgress(game);
console.log(`已输出到 ${outDir}：relations.svg / graph.json / story.html`);
console.log(`第 ${game.turn} 周，剧情 ${progress.done}/${progress.total} 章`);
console.log(game.cast.list.map((person) => `${person.role}:${person.name}`).join('　'));
