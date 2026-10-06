#!/usr/bin/env node
/**
 * 难度调参工具：扫一遍关键旋钮，看每种策略的平均分和"上 985/清北"的比例。
 *
 * 和 tools/sim.js 的区别：sim.js 是"当前参数下的完整报告"，tune.js 是
 * "换几个参数横向对比"，用来决定该把旋钮拧到哪。参数改完还是要把最终值
 * 写回 src/engine.js 的 EFF / DIFFICULTY，再用 npm run sim 出正式报告。
 *
 *   node tools/tune.mjs                                 扫 gainScale
 *   node tools/tune.mjs --knob knowledgeSlope --from 0.5 --to 0.7 --step 0.05
 *   node tools/tune.mjs --knob weeklyMoodDrain --values 0.3,0.5,0.7
 *   node tools/tune.mjs --strategies diligent,balanced,casual --runs 24
 */

import process from 'node:process';

import { DIFFICULTY, EFF, createGame, playWeek } from '../src/engine.js';
import { STRATEGIES, getStrategy } from '../src/strategies.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [rawKey, inline] = token.slice(2).split('=');
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const next = argv[i + 1];
    if (inline !== undefined) out[key] = inline;
    else if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const runs = Number(args.runs ?? 16);
const weeks = Number(args.weeks ?? 6);
const difficulty = String(args.difficulty ?? 'normal');
const seedBase = String(args.seed ?? 'tune');
const knob = String(args.knob ?? 'gainScale');
const strategies = String(args.strategies ?? 'diligent,balanced,casual,slacker')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

/** 要扫的取值：--values 优先，否则用 --from/--to/--step 生成。 */
const values = args.values
  ? String(args.values)
      .split(',')
      .map((value) => Number(value.trim()))
  : (() => {
      const from = Number(args.from ?? (knob === 'gainScale' ? 0.7 : 0.4));
      const to = Number(args.to ?? (knob === 'gainScale' ? 0.9 : 0.8));
      const step = Number(args.step ?? 0.05);
      const list = [];
      for (let value = from; value <= to + 1e-9; value += step) list.push(Math.round(value * 1000) / 1000);
      return list;
    })();

const ORIGINAL = { ...EFF, ...DIFFICULTY[difficulty] };
const ORIGINAL_EFF = { ...EFF };
const ORIGINAL_DIFF = { ...DIFFICULTY[difficulty] };

/** 把旋钮拨到指定值（支持 EFF.xxx 和 DIFFICULTY.xxx 两种）。 */
function applyKnob(value) {
  Object.assign(EFF, ORIGINAL_EFF);
  Object.assign(DIFFICULTY[difficulty], ORIGINAL_DIFF);
  if (knob in ORIGINAL_EFF) EFF[knob] = value;
  else if (knob in ORIGINAL_DIFF) DIFFICULTY[difficulty][knob] = value;
  else throw new Error(`没有这个旋钮：${knob}（可用：${Object.keys(ORIGINAL_EFF).join(', ')} / ${Object.keys(ORIGINAL_DIFF).join(', ')}）`);
}

function measure(strategyName) {
  const totals = [];
  let top2 = 0;
  let c985 = 0;
  let collapse = 0;
  let moodSum = 0;
  let fatigueSum = 0;

  for (let i = 0; i < runs; i += 1) {
    const game = createGame({
      name: strategyName,
      seed: `${seedBase}-${strategyName}-${i}`,
      difficulty,
      weeksPerSemester: weeks,
      goal: ['top2', 'c985', 'yiben', 'special', 'happy', 'love', 'money', 'alive'][i % 8],
    });
    const strategy = getStrategy(strategyName);
    let guard = 0;
    while (game.status === 'playing' && guard < 400) {
      guard += 1;
      playWeek(game, strategy);
    }
    const ending = game.ending ?? {};
    if (ending.total !== undefined) totals.push(ending.total);
    const tier = ending.tier ?? '';
    if (tier === '清北' || ending.id === 'baosong') top2 += 1;
    else if (['华五', '985', '强基计划'].includes(tier)) c985 += 1;
    if (['expelled', 'depressed', 'hospital'].includes(ending.id)) collapse += 1;
    moodSum += game.stats.mood;
    fatigueSum += game.stats.fatigue;
  }

  const sum = totals.reduce((acc, value) => acc + value, 0);
  return {
    avg: totals.length ? sum / totals.length : 0,
    min: totals.length ? Math.min(...totals) : 0,
    max: totals.length ? Math.max(...totals) : 0,
    top2: top2 / runs,
    c985: c985 / runs,
    collapse: collapse / runs,
    mood: moodSum / runs,
    fatigue: fatigueSum / runs,
  };
}

const base = ORIGINAL[knob] ?? ORIGINAL_EFF[knob];
console.log(`\n难度调参：${knob}（当前 ${base}）　${difficulty} 难度　每格 ${runs} 局　每学期 ${weeks} 周\n`);

const header = ['取值', ...strategies.flatMap((name) => [`${name} 均分`, '985+', '清北']), '崩溃'];
const rows = [];

for (const value of values) {
  applyKnob(value);
  const cells = [String(value)];
  for (const name of strategies) {
    const result = measure(name);
    cells.push(result.avg.toFixed(0), `${(result.c985 * 100).toFixed(0)}%`, `${(result.top2 * 100).toFixed(0)}%`);
  }
  // 崩溃率用第一个策略代表（摆烂那种本来就高）
  const first = measure(strategies[0]);
  cells.push(`${(first.collapse * 100).toFixed(0)}%`);
  rows.push(cells);
}

const width = (text) => [...String(text)].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
const widths = header.map((title, index) => Math.max(width(title), ...rows.map((row) => width(row[index]))));
const line = (cells) => cells.map((cell, index) => cell + ' '.repeat(Math.max(0, widths[index] - width(cell)))).join('  ');

console.log(line(header));
console.log(widths.map((w) => '─'.repeat(w)).join('  '));
for (const row of rows) console.log(line(row));

// 还原，避免影响后续逻辑（这个脚本本来就是一次性的）
Object.assign(EFF, ORIGINAL_EFF);
Object.assign(DIFFICULTY[difficulty], ORIGINAL_DIFF);
console.log(`\n参考：985 线 636 分，清北线 696 分，一本线 552 分（安徽口径）。`);
console.log(`所有策略：${Object.keys(STRATEGIES).join(', ')}\n`);
