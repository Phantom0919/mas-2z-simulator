#!/usr/bin/env node
/**
 * 数值平衡工具：用不同策略批量跑完整局，看高考分数、结局分布与目标达成率。
 *
 *   node tools/sim.js                              默认每种策略 24 局
 *   node tools/sim.js --runs 60 --weeks 6
 *   node tools/sim.js --strategies diligent,casual,artist,athlete,lover
 *   node tools/sim.js --track history --electives politics,geography
 *   node tools/sim.js --verbose --strategy diligent --seed 7
 */

import process from 'node:process';

import { createGame, playWeek } from '../src/engine.js';
import { GOAL_MAP, TRACK_MAP } from '../src/data/character.js';
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
const runs = Number(args.runs ?? 24);
const weeks = Number(args.weeks ?? 6);
const difficulty = String(args.difficulty ?? 'normal');
const seedBase = String(args.seed ?? 'sim');
const track = args.track === 'history' ? 'history' : 'physics';
const electives = args.electives ? String(args.electives).split(',').map((s) => s.trim()) : undefined;
const traits = args.traits ? String(args.traits).split(',').map((s) => s.trim()) : undefined;
const background = args.background ? String(args.background) : undefined;
const goal = args.goal ? String(args.goal) : undefined;
const endless = Boolean(args.endless);
const strategyNames = String(args.strategies ?? Object.keys(STRATEGIES).join(','))
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const verbose = Boolean(args.verbose);
const verboseStrategy = String(args.strategy ?? 'diligent');

/** 完整跑一局，返回结束时的 game。 */
export function playFull(strategyName, seed, options = {}) {
  const game = createGame({
    name: strategyName,
    seed,
    difficulty: options.difficulty ?? difficulty,
    weeksPerSemester: options.weeks ?? weeks,
    track: options.track ?? track,
    electives: options.electives ?? electives,
    traits: options.traits ?? traits,
    background: options.background ?? background,
    goal: options.goal ?? goal,
    endless: options.endless ?? endless,
    // v2.6：默认走完整流程（高考 → 填志愿）。加 --no-volunteers 可以关掉做对照。
    volunteers: options.volunteers ?? !args.noVolunteers,
  });
  const strategy = getStrategy(strategyName);
  let guard = 0;
  // 志愿填报阶段也算"没打完"：playWeek 会按冲稳保自动把志愿填掉
  while ((game.status === 'playing' || game.status === 'volunteering') && guard < 400) {
    guard += 1;
    playWeek(game, strategy);
  }
  return game;
}

function stats(values) {
  if (values.length === 0) return { avg: 0, min: 0, max: 0, median: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    avg: sum / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
  };
}

function runVerbose() {
  const game = createGame({
    name: verboseStrategy,
    seed: `${seedBase}-verbose`,
    difficulty,
    weeksPerSemester: weeks,
    track,
    electives,
    traits,
    background,
    goal,
    endless,
  });
  const strategy = getStrategy(verboseStrategy);
  let guard = 0;
  while ((game.status === 'playing' || game.status === 'volunteering') && guard < 400) {
    guard += 1;
    const week = playWeek(game, strategy);
    console.log(week.lines.join('\n'));
  }
  const ending = game.ending ?? {};
  console.log('\n================ 结局 ================');
  console.log(`${ending.title}　${ending.tier ?? ''} ${ending.school ?? ''}`);
  if (ending.total) console.log(`高考 ${ending.total} / 750　年级第 ${ending.rank} 名`);
  if (ending.volunteer) {
    const v = ending.volunteer;
    console.log(
      v.slip
        ? '志愿填报：六个全滑档'
        : `志愿填报：${v.adjusted ? '调剂录取' : `第 ${v.round} 志愿`}　${v.school}　${v.majorName}（投档线 ${v.minScore}）`,
    );
  }
  if (ending.goal) console.log(`目标「${ending.goal.name}」：${ending.goal.achieved ? '✅ 达成' : '❌ 未达成'}`);
  console.log(`最终属性：${JSON.stringify(game.stats)}`);
  console.log(`人物好感：${JSON.stringify(game.npc)}`);
  console.log(`最终知识：${JSON.stringify(game.knowledge)}`);
  console.log(`成就：${(ending.achievements ?? []).map((item) => item.name).join('、') || '无'}`);
}

function runMatrix() {
  const trackName = TRACK_MAP[track]?.name ?? track;
  const goalName = goal ? GOAL_MAP[goal]?.name ?? goal : '（每局随机目标）';
  console.log('\n中二野人实验室 · 平衡测试');
  console.log(
    `难度 ${difficulty}　${trackName}　每学期 ${weeks} 周（一局 ${weeks * 6} 周 × 2 段）　每种策略 ${runs} 局` +
      `${endless ? '　自由模式' : ''}　目标：${goalName}\n`,
  );

  const STUDY_ACTIONS = new Set(['listen', 'drill', 'preview', 'cram', 'tutor', 'help', 'contest', 'review_notes', 'study_together']);
  const header = ['策略', '平均分', '中位', '最低', '最高', '清北', '985+', '好结局', '本科率', '崩溃', '目标达成', '知识均值', '学习回合', '心情', '疲劳'];
  const rows = [];
  const endingCounts = new Map();

  for (const name of strategyNames) {
    const totals = [];
    const collapses = [];
    const knowledgeAvg = [];
    const studyTurns = [];
    const moodAvg = [];
    const fatigueAvg = [];
    let top2 = 0;
    let c985 = 0;
    let above1 = 0;
    let bachelor = 0;
    let goalHit = 0;
    let goalTotal = 0;

    for (let i = 0; i < runs; i += 1) {
      const game = playFull(name, `${seedBase}-${name}-${i}`, {
        difficulty,
        weeks,
        // 每局换一个目标，避免只测一条路线
        goal: goal ?? ['top2', 'c985', 'yiben', 'special', 'happy', 'love', 'money', 'alive'][i % 8],
      });
      const ending = game.ending ?? {};
      if (ending.total !== undefined) totals.push(ending.total);
      knowledgeAvg.push(
        game.subjectKeys.reduce((sum, key) => sum + (game.knowledge[key] ?? 0), 0) / game.subjectKeys.length,
      );
      studyTurns.push(game.history.filter((item) => STUDY_ACTIONS.has(item.action)).length);
      moodAvg.push(game.stats.mood);
      fatigueAvg.push(game.stats.fatigue);
      if (['expelled', 'depressed', 'hospital'].includes(ending.id)) collapses.push(ending.id);
      if (ending.goal) {
        goalTotal += 1;
        if (ending.goal.achieved) goalHit += 1;
      }
      const tier = ending.tier ?? '';
      if (tier === '清北' || ending.id === 'baosong') top2 += 1;
      else if (['华五', '985', '强基计划'].includes(tier)) c985 += 1;
      if (['一本', '211', '985', '华五', '清北', '强基计划', '海外本科', '体育特招', '综合评价', '艺术类', '传媒路线', '友情结局', '爱情结局', '创业'].includes(tier)) above1 += 1;
      if (ending.gaokao && !['高职专科', '复读'].includes(tier)) bachelor += 1;
      if (ending.id === 'baosong') bachelor += 1;
      endingCounts.set(tier || ending.id || '未知', (endingCounts.get(tier || ending.id || '未知') ?? 0) + 1);
    }

    const s = stats(totals);
    rows.push([
      name,
      s.avg.toFixed(1),
      String(s.median),
      String(s.min),
      String(s.max),
      `${((top2 / runs) * 100).toFixed(0)}%`,
      `${((c985 / runs) * 100).toFixed(0)}%`,
      `${((above1 / runs) * 100).toFixed(0)}%`,
      `${((bachelor / runs) * 100).toFixed(0)}%`,
      `${((collapses.length / runs) * 100).toFixed(0)}%`,
      goalTotal ? `${((goalHit / goalTotal) * 100).toFixed(0)}%` : '—',
      stats(knowledgeAvg).avg.toFixed(1),
      stats(studyTurns).avg.toFixed(1),
      stats(moodAvg).avg.toFixed(0),
      stats(fatigueAvg).avg.toFixed(0),
    ]);
  }

  const widths = header.map((title, index) => Math.max(displayWidth(title), ...rows.map((row) => displayWidth(row[index]))));
  console.log(printRow(header, widths));
  console.log(widths.map((width) => '─'.repeat(width)).join('  '));
  for (const row of rows) console.log(printRow(row, widths));

  console.log('\n结局分布（单位：局）：');
  for (const [tier, count] of [...endingCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tier.padEnd(12, ' ')} ${count}`);
  }
}

function displayWidth(text) {
  return [...String(text)].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
}

function printRow(cells, widths) {
  return cells
    .map((cell, index) => {
      const padLength = widths[index] - displayWidth(cell);
      return `${cell}${' '.repeat(Math.max(0, padLength))}`;
    })
    .join('  ');
}

if (verbose) runVerbose();
else runMatrix();
