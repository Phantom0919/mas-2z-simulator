#!/usr/bin/env node
/**
 * 马鞍山二中模拟器 · 终端界面 v2
 *
 *   node src/cli.js                                 开局向导 + 交互游玩
 *   node src/cli.js --track history --electives politics,geography
 *   node src/cli.js --traits memory,nightowl --background magang --goal c985
 *   node src/cli.js --endless                       自由模式（自己决定何时高考）
 *   node src/cli.js --auto --strategy diligent      自动打完一整局
 *   node src/cli.js --gallery                       查看结局图鉴与战绩
 */

import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  CUSTOM_KNOBS,
  DIFFICULTY,
  EFF,
  GameError,
  SUBJECT_MAP,
  TOTAL_MAX,
  applyContentPack,
  autoFillVolunteers,
  buyItem,
  contentStatus,
  createGame,
  deserialize,
  endingCatalog,
  listActions,
  listShop,
  pendingChains,
  performAction,
  playWeek,
  relationGraph,
  renderTreeText,
  resetContent,
  resolveEvent,
  serialize,
  storyCatalog,
  storyProgress,
  submitVolunteers,
  totalWeeks,
  treeStats,
  viewState,
  VOLUNTEER_SLOTS,
  volunteerState,
} from './engine.js';
import { MAJOR_MAP } from './data/colleges.js';
import { BACKGROUNDS, FLAW_MAP, FLAWS, GOALS, PERSONALITIES, POINT_BUY, POINT_BUDGET, TRAITS, TRACKS } from './data/character.js';
import { ALL_SUBJECT_KEYS, SCHOOL, STAT_META, ELECTIVE_KEYS, DEFAULT_WEEKS_PER_SEMESTER } from './data/school.js';
import { DEFAULT_PROFILE_FILE, loadProfile, profileStats, recordGame, saveProfile } from './profile.js';
import { createPrompter } from './prompt.js';
import { STRATEGIES, getStrategy } from './strategies.js';

/* ------------------------------------------------------------------ 参数 */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const [rawKey, inline] = token.slice(2).split('=');
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const next = argv[i + 1];
    if (inline !== undefined) out[key] = inline;
    else if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else out[key] = true;
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
const profileFile = String(argv.profile ?? DEFAULT_PROFILE_FILE);

if (argv.help || argv.h) {
  printHelp();
  process.exit(0);
}
if (argv.listStrategies) {
  console.log('可用策略：');
  for (const name of Object.keys(STRATEGIES)) console.log(`  ${name}`);
  process.exit(0);
}

/* ------------------------------------------------------------------ 样式 */

const useColor = process.stdout.isTTY && !argv.noColor;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const blue = paint('36');
const magenta = paint('35');

const segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' });

function stringWidth(text) {
  let width = 0;
  for (const { segment } of segmenter.segment(String(text))) {
    if (/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u.test(segment)) width += 2;
    else if ([...segment].some((ch) => ch.codePointAt(0) > 127)) width += 2;
    else width += 1;
  }
  return width;
}

const pad = (text, width) => String(text) + ' '.repeat(Math.max(0, width - stringWidth(text)));

function bar(value, max, width = 12) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function divider(title = '') {
  const line = '─'.repeat(Math.max(4, 56 - stringWidth(title)));
  return dim(`── ${title} ${line}`);
}

/* ------------------------------------------------------------------ 渲染 */

function renderStatus(game) {
  const view = viewState(game);
  const lines = [];
  const phaseBadge = view.phase === 'weekend' ? yellow('【周末安排】') : green('【本周主行动】');
  lines.push('');
  lines.push(bold(blue(`╭─ ${SCHOOL.name} · ${view.student.name}${view.student.nickname ? `（${view.student.nickname}）` : ''}（${view.student.className}） ${'─'.repeat(6)}`)));
  lines.push(
    `│ ${pad(view.calendarLabel, 20)} ${phaseBadge} ${dim(
      view.phase === 'weekend' ? `效果 ×${view.weekendScale}` : '效果 100%',
    )}`,
  );
  lines.push(
    `│ ${pad(view.selection.label, 30)} ${
      view.endless ? yellow('自由模式') : `总进度 ${bar(view.progress * 100, 100, 16)} ${String(Math.round(view.progress * 100)).padStart(3)}%`
    }`,
  );
  lines.push(
    `│ 距离高考 ${bold(yellow(view.endless ? '由你决定' : String(view.weeksLeft)))} 周　${
      view.nextExam ? `下一场：${view.nextExam.name}（${view.nextExam.inWeeks === 0 ? '本周' : `${view.nextExam.inWeeks} 周后`}）` : '无'
    }`,
  );
  const statCells = [];
  for (const [key, meta] of Object.entries(STAT_META)) {
    const value = view.stats[key];
    const ratio = value / meta.max;
    const color = meta.better === 'high' ? (ratio > 0.66 ? green : ratio > 0.33 ? yellow : red) : ratio > 0.5 ? red : ratio > 0.2 ? yellow : green;
    statCells.push(`${meta.icon}${pad(meta.name, 9)}${color(bar(value, meta.max, 10))}${String(value).padStart(6)}`);
  }
  lines.push(`│ 零花钱 💰 ${String(view.stats.money).padStart(5)} 元　预估高考分 ${bold(magenta(String(view.estimateTotal)))} / ${TOTAL_MAX}`);
  for (let i = 0; i < statCells.length; i += 2) {
    lines.push(`│ ${pad(statCells[i], 34)} ${statCells[i + 1] ?? ''}`);
  }
  lines.push(`│ ${dim('知识：')}${view.subjects.map((s) => `${s.name} ${String(s.knowledge).padStart(5)}`).join('　')}`);
  lines.push(
    `│ ${dim('人物：')}${view.npc
      .map((npc) => `${npc.role ?? npc.name} ${String(npc.value).padStart(3)}（${npc.short ?? ''}）`)
      .join('　')}`,
  );
  const build = view.build;
  lines.push(
    `│ ${dim('构筑：')}${(build.traits ?? []).map((t) => `${t.icon}${t.name}`).join(' ')}　${build.background?.icon ?? ''}${
      build.background?.name ?? ''
    }　目标 ${build.goal?.icon ?? ''}${build.goal?.name ?? ''}`,
  );
  // 自定义人物：性格 / 缺陷 / 属性点 / 传承点，一眼能看出"这一局的人是自己捏的"
  const creatorBits = [];
  if (build.personality && build.personality.id !== 'plain') creatorBits.push(`${build.personality.icon}${build.personality.name}`);
  for (const flaw of build.flaws ?? []) creatorBits.push(`${flaw.icon}${flaw.name}`);
  if (build.points?.spent) creatorBits.push(`🧬属性点 ${build.points.spent}/${build.points.budget + (build.points.legacy ?? 0)}`);
  if (build.legacyPoints) creatorBits.push(`🔁传承 +${build.legacyPoints}`);
  if ((build.customCast ?? []).length) creatorBits.push(`✍️自定义人物 ${build.customCast.length}`);
  if (view.difficulty?.key === 'custom') creatorBits.push('🛠️自定义难度');
  if (creatorBits.length) lines.push(`│ ${dim('自定义：')}${creatorBits.join('　')}`);
  if (view.items.length) {
    lines.push(`│ ${dim('物品：')}${view.items.map((item) => `${item.icon}${item.name}`).join('　')}`);
  }
  lines.push(`╰${'─'.repeat(58)}`);
  console.log(lines.join('\n'));
}

/** 人物关系树状图（ASCII 版）。 */
function renderRelations(game) {
  const graph = relationGraph(game);
  console.log(divider('人物关系图'));
  console.log(renderTreeText(graph));
  const stats = treeStats(graph);
  console.log('');
  console.log(
    dim(
      `  一共 ${stats.total} 个人　走得很近 ${stats.close} 个　还僵着 ${stats.cold} 个　平均好感 ${stats.average}` +
        (stats.best ? `　最高：${stats.best.name}（${stats.best.role} ${stats.best.affinity}）` : ''),
    ),
  );
  console.log(dim('  线越绿关系越好：🟢 70+ 亲密　🟡 40-69 还行　🔴 30 以下疏远'));
}

/** 故事线进度（已解锁的章节会带上正文）。 */
function renderStory(game) {
  const catalog = storyCatalog(game);
  const progress = storyProgress(game);
  console.log(divider(`故事线（已演 ${progress.done} / ${progress.total} 章）`));
  for (const arc of catalog) {
    const head = `${arc.icon} ${bold(arc.title)}　${arc.done}/${arc.total}${arc.personName ? dim(`　与 ${arc.personName} 有关`) : ''}`;
    console.log(`\n  ${head}`);
    console.log(`  ${dim(arc.intro)}`);
    arc.chapters.forEach((chapter, index) => {
      const number = String(index + 1).padStart(2, '0');
      if (!chapter.unlocked) {
        console.log(`   ${dim(number)} 🔒 ${dim(chapter.title)}${dim(`　（还没演到，大约第 ${chapter.week} 周之后）`)}`);
        return;
      }
      console.log(`   ${number} ✅ ${bold(chapter.title)}${chapter.at ? dim(`　${chapter.at}`) : ''}`);
      for (const line of String(chapter.text ?? '').split('\n')) {
        console.log(`      ${line}`);
      }
    });
  }
  if (progress.done === 0) console.log(dim('\n  还没演到任何一章——多跟人打交道，剧情自然会来。'));
}

function renderActions(game) {
  const actions = listActions(game);
  const tags = [...new Set(actions.map((action) => action.tag))];
  console.log(divider(game.phase === 'weekend' ? '周末安排（效果打折，但不算白过）' : '本周主行动'));
  let index = 0;
  for (const tag of tags) {
    const group = actions.filter((action) => action.tag === tag);
    console.log(dim(`  ${tag}`));
    for (const action of group) {
      index += 1;
      const number = String(index).padStart(2);
      const label = `${action.icon} ${action.name}${action.needsSubject ? dim('（选科）') : ''}${action.once && !action.used ? yellow('（一次性）') : ''}`;
      const suffix = action.available ? dim(action.cost ? `-${action.cost}元` : '') : red(`✕ ${action.reason}`);
      console.log(`  ${bold(number)}. ${pad(label, 28)} ${pad(action.desc.slice(0, 22), 24)} ${suffix}`);
    }
  }
  console.log(dim('  命令：数字=行动　s=状态　l=日志　e=成绩单　b=商店　g=图鉴　w=存档　q=退出'));
  return actions;
}

function renderEnding(game) {
  const view = viewState(game);
  const ending = view.ending ?? {};
  console.log('');
  console.log(bold(magenta(`╔${'═'.repeat(58)}╗`)));
  console.log(bold(magenta('║')) + pad(`  🏁 结局：${ending.title ?? '毕业'}`, 58) + bold(magenta('║')));
  console.log(bold(magenta(`╚${'═'.repeat(58)}╝`)));
  if (ending.goal) {
    console.log(
      `  目标「${ending.goal.icon} ${ending.goal.name}」：${ending.goal.achieved ? bold(green('✅ 达成')) : bold(red('❌ 未达成'))}`,
    );
  }
  if (ending.gaokao) {
    console.log(`  高考总分：${bold(magenta(String(ending.total)))} / ${TOTAL_MAX}　年级第 ${ending.rank} 名　档次：${bold(ending.tier)}`);
    console.log(`  录取院校：${bold(green(ending.school))}`);
    console.log(`  各科：${view.subjects.map((s) => `${s.name} ${ending.subjects?.[s.key] ?? '-'}`).join('　')}`);
  } else {
    console.log(`  去向：${bold(green(ending.school ?? '—'))}（${ending.tier ?? '—'}）`);
  }
  console.log('');
  console.log(`  ${ending.text ?? ''}`);
  console.log('');
  const build = ending.build ?? {};
  console.log(divider('三年构筑'));
  console.log(
    `  ${build.track ?? ''}　选考 ${(build.electives ?? []).join('+')}　天赋 ${(build.traits ?? []).map((t) => t.name).join('、')}　${
      build.background?.name ?? ''
    }`,
  );
  console.log(`  人物：${Object.entries(ending.npc ?? {}).map(([key, value]) => `${key} ${value}`).join('　')}`);
  const achievements = ending.achievements ?? [];
  console.log(divider(`成就（${achievements.length}）`));
  if (achievements.length === 0) console.log(dim('  这一局什么都没留下，除了三年。'));
  for (const item of achievements) console.log(`  ${item.icon} ${bold(item.name)} ${dim(item.desc)}`);
  console.log('');
  const stats = ending.stats ?? view.stats;
  console.log(`  ${Object.entries(STAT_META).map(([key, meta]) => `${meta.name} ${stats[key]}`).join('　')}`);
  console.log(`  零花钱 ${stats.money ?? 0} 元　局内回合 ${view.turn}　种子 ${game.seedText}`);
  console.log('');
}

function renderGallery(catalog, profile) {
  const stat = profileStats(profile, catalog);
  console.log('');
  console.log(bold(magenta(`📖 结局图鉴　解锁 ${stat.unlocked}/${stat.total}`)));
  console.log(divider('全部结局'));
  for (const item of catalog) {
    const entry = profile.endings[item.id];
    if (entry) {
      const best = entry.bestTotal ? `最高 ${entry.bestTotal} 分` : '';
      console.log(`  ${green('✅')} ${item.icon} ${bold(item.title)} ${dim(`${item.tier}　解锁 ${entry.count} 次　${best}`)}`);
    } else {
      console.log(`  ${dim(`🔒 ${item.icon} ${item.tier}　线索：${item.hint}`)}`);
    }
  }
  console.log('');
  console.log(divider('战绩'));
  console.log(`  总游玩 ${stat.games} 局　成就 ${stat.achievements} 种`);
  if (stat.best) console.log(`  最好成绩：${bold(String(stat.best.total))} 分　${stat.best.ending}　（${stat.best.name} / ${stat.best.seed}）`);
  for (const record of profile.history.slice(0, 8)) {
    console.log(
      `  ${dim(record.at?.slice(0, 10) ?? '')} ${pad(record.ending ?? '', 18)} ${String(record.total ?? '-').padStart(4)} 分　${
        record.goal === null ? '' : record.goal ? green('目标达成') : red('目标未达成')
      }`,
    );
  }
  console.log('');
}

function printLines(lines) {
  for (const line of lines) console.log(`  ${line}`);
}

/* ------------------------------------------------------------------ 向导 */

function subjectKeyFromInput(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (SUBJECT_MAP[text]) return text;
  const byName = Object.values(SUBJECT_MAP).find((subject) => subject.name === text);
  return byName?.key ?? null;
}

function parseSubjectList(input, allowed) {
  const parts = String(input ?? '')
    .split(/[\s,，、+]+/)
    .filter(Boolean);
  const keys = [];
  for (const part of parts) {
    const key = subjectKeyFromInput(part) ?? allowed[Number(part) - 1];
    if (key && allowed.includes(key) && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

async function setupWizard(prompter, options) {
  const ask = async (promptText) => {
    const answer = await prompter.ask(promptText);
    return answer === null ? '' : answer.trim();
  };

  console.log(bold(green(`\n${SCHOOL.name} · 校训：${SCHOOL.motto}`)));
  console.log(dim('  三年六个学期，每周两段决策：主行动 + 周末安排。先把你的高中设定好。'));
  console.log(dim('  提示：每项都可以直接按回车用默认值。\n'));

  const name = (await ask(`  姓名（默认 ${options.name}）：`));
  if (name) options.name = name;

  console.log('\n  首选科目：');
  TRACKS.forEach((track, index) => console.log(`    ${index + 1}. ${track.icon} ${track.name}　${dim(track.desc)}`));
  const trackAnswer = (await ask(`  选择（默认 1 物理类）：`));
  options.track = TRACKS[Number(trackAnswer) - 1]?.id ?? 'physics';

  const electives = ELECTIVE_KEYS.filter((key) => key !== options.track);
  console.log(`\n  再选两门（${options.track === 'history' ? '历史类' : '物理类'}可选）：`);
  electives.forEach((key, index) => console.log(`    ${index + 1}. ${SUBJECT_MAP[key].icon} ${SUBJECT_MAP[key].name}`));
  const electiveAnswer = (await ask('  输入两个编号，例如 "1 3"：'));
  const picked = parseSubjectList(electiveAnswer, electives);
  options.electives = picked.length === 2 ? picked : electives.slice(0, 2);

  console.log('\n  天赋（选 2 个）：');
  TRAITS.forEach((trait, index) => console.log(`    ${String(index + 1).padStart(2)}. ${trait.icon} ${pad(trait.name, 10)} ${dim(trait.desc)}`));
  const traitAnswer = (await ask('  输入两个编号，例如 "1 5"：'));
  const traitIds = String(traitAnswer)
    .split(/[\s,，、+]+/)
    .map((part) => TRAITS[Number(part) - 1]?.id)
    .filter(Boolean);
  options.traits = traitIds.length === 2 ? traitIds : ['memory', 'easygoing'];

  console.log('\n  性格（选 1 个）：');
  PERSONALITIES.forEach((item, index) => console.log(`    ${String(index + 1).padStart(2)}. ${item.icon} ${pad(item.name, 10)} ${dim(item.desc)}`));
  const personaAnswer = (await ask('  选择（默认 1 平常心）：'));
  options.personality = PERSONALITIES[Number(personaAnswer) - 1]?.id ?? 'plain';

  console.log(`\n  缺陷（最多 ${EFF.maxFlaws} 个，用短板换属性点；直接回车 = 不要）：`);
  FLAWS.forEach((item, index) => console.log(`    ${String(index + 1).padStart(2)}. ${item.icon} ${pad(item.name, 12)} ${dim(`${item.desc}（+${item.points} 点）`)}`));
  const flawAnswer = (await ask('  选择（默认 不要）：'));
  options.flaw = FLAWS[Number(flawAnswer) - 1]?.id ?? null;

  const nickAnswer = await ask('  外号（留空 = 随机一个，例如"根号三"）：');
  if (nickAnswer) options.nickname = nickAnswer;

  console.log('\n  家庭背景：');
  BACKGROUNDS.forEach((bg, index) => console.log(`    ${index + 1}. ${bg.icon} ${pad(bg.name, 14)} ${dim(bg.desc)}`));
  const bgAnswer = (await ask('  选择（默认 1 普通工薪家庭）：'));
  options.background = BACKGROUNDS[Number(bgAnswer) - 1]?.id ?? 'worker';

  console.log('\n  高考目标（结局时会判定达成）：');
  GOALS.forEach((goal, index) => console.log(`    ${String(index + 1).padStart(2)}. ${goal.icon} ${pad(goal.name, 12)} ${dim(goal.desc)}`));
  const goalAnswer = (await ask('  选择（默认 3 稳上一本）：'));
  options.goal = GOALS[Number(goalAnswer) - 1]?.id ?? 'yiben';

  const difficultyList = Object.values(DIFFICULTY);
  console.log('\n  难度（开局底子和遗忘速度都不一样）：');
  difficultyList.forEach((item, index) =>
    console.log(`    ${String(index + 1).padStart(2)}. ${item.icon ?? ''} ${pad(item.name, 18)} ${dim(item.desc ?? '')}`),
  );
  const diffAnswer = (await ask('  选择（默认 2 正常）：'));
  options.difficulty = difficultyList[Number(diffAnswer) - 1]?.key ?? 'normal';

  // 自定义难度：CLI 里把八个旋钮逐个问一遍，回车就用默认值
  if (options.difficulty === 'custom') {
    console.log(dim('\n  自定义难度：每一项回车都用默认值。'));
    const custom = {};
    for (const knob of CUSTOM_KNOBS) {
      const answer = await ask(`  ${knob.name}（${knob.min}~${knob.max}，默认 ${knob.def}）：`);
      custom[knob.id] = answer === '' ? knob.def : Number(answer);
    }
    options.custom = custom;
  }

  /*
   * 属性点：CLI 不适合一格一格点，所以一次问一行。
   * 预算 = 难度给的点数 + 缺陷换来的点数。
   */
  const flawPoints = options.flaw ? FLAW_MAP[options.flaw]?.points ?? 0 : 0;
  const budget = (POINT_BUDGET[options.difficulty] ?? 12) + flawPoints;
  console.log(`\n  属性点（共 ${budget} 点，1 点 = 下面这些增量；直接回车 = 不分配）：`);
  POINT_BUY.forEach((item) =>
    console.log(`    ${pad(item.key, 16)} ${item.icon} ${item.name}　1 点 = +${item.per}${item.perSubject ? ' 分（写科目名）' : ''}　最多 ${item.max} 点`),
  );
  const pointAnswer = await ask('  例如 "intelligence:4, math:2, mood:2"：');
  if (pointAnswer) options.points = parsePointSpec(pointAnswer);

  const weeksAnswer = (await ask(`  每学期周数（3-20，默认 ${DEFAULT_WEEKS_PER_SEMESTER}，越大越肝）：`));
  options.weeksPerSemester = Number(weeksAnswer) || DEFAULT_WEEKS_PER_SEMESTER;

  const endlessAnswer = (await ask('  自由模式？（y/N，自由模式下高考时间由你决定）：'));
  options.endless = /^y(es)?$/i.test(endlessAnswer);

  const seedAnswer = (await ask('  随机种子（回车用当前时间）：'));
  if (seedAnswer) options.seed = seedAnswer;
  return options;
}

/* --------------------------------------------------------------- 交互玩法 */

/**
 * 解析 `--points` / 向导里输入的属性点方案。
 *
 * 支持：`intelligence:4, math:2 mood:2`、`智力:4`、`数学:2`。
 * 非法的键和负数直接忽略（引擎那边还会再收拢一次预算和上限）。
 */
/**
 * 解析 `--custom` 里的自定义难度旋钮：`gain:1.4,forgetScale:2,points:20`。
 * 键名就是 CUSTOM_KNOBS 的 id；引擎那边会按上下限收拢。
 */
export function parseCustomSpec(text) {
  const out = {};
  const known = new Set(CUSTOM_KNOBS.map((item) => item.id));
  for (const chunk of String(text ?? '').split(/[,，;；\s]+/).filter(Boolean)) {
    const [rawKey, rawValue] = chunk.split(/[:=：]/);
    const key = String(rawKey ?? '').trim();
    if (!known.has(key)) continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) out[key] = value;
  }
  return out;
}

export function parsePointSpec(text) {
  const points = { subjects: {} };
  const nameToKey = new Map();
  for (const [key, subject] of Object.entries(SUBJECT_MAP)) nameToKey.set(subject.name, key);
  const attrKeys = new Set(POINT_BUY.filter((item) => !item.perSubject).map((item) => item.key));

  for (const chunk of String(text ?? '').split(/[,，;；\s]+/).filter(Boolean)) {
    const [rawKey, rawValue] = chunk.split(/[:=：]/);
    const value = Math.max(0, Math.round(Number(rawValue)));
    if (!Number.isFinite(value) || value <= 0) continue;
    const key = String(rawKey ?? '').trim();
    if (attrKeys.has(key)) points[key] = (points[key] ?? 0) + value;
    else {
      const subjectKey = SUBJECT_MAP[key] ? key : nameToKey.get(key);
      if (subjectKey) points.subjects[subjectKey] = (points.subjects[subjectKey] ?? 0) + value;
    }
  }
  if (!Object.keys(points.subjects).length) delete points.subjects;
  return points;
}

async function chooseActionInteractive(prompter, game, lastAction) {
  const actions = listActions(game);
  for (;;) {
    const raw = await prompter.ask(bold('\n> 选择行动（数字/s/l/e/b/g/w/q，回车重复上次）：'));
    if (raw === null) return null; // 输入结束 = 退出
    const answer = raw.trim();
    if (answer === '') {
      if (!lastAction) {
        console.log(red('  还没有可以重复的行动。'));
        continue;
      }
      const action = actions.find((item) => item.id === lastAction.id);
      if (!action?.available) {
        console.log(red(`  ${action?.reason ?? '上次的行动现在不可用。'}`));
        continue;
      }
      return action;
    }
    if (['q', 'quit', 'exit'].includes(answer)) return null;
    if (['s', 'status'].includes(answer)) {
      renderStatus(game);
      continue;
    }
    if (['l', 'log'].includes(answer)) {
      for (const entry of game.log.slice(-18)) console.log(`  ${dim(`[${entry.at}]`)} ${entry.title}`);
      continue;
    }
    if (['e', 'exam'].includes(answer)) {
      if (game.exams.length === 0) console.log(dim('  还没有考过试。'));
      for (const exam of game.exams.slice(-6)) console.log(`  ${exam.name}：${bold(String(exam.total))} 分　年级第 ${exam.rank} 名`);
      continue;
    }
    if (['b', 'shop'].includes(answer)) {
      await shopInteractive(prompter, game);
      continue;
    }
    if (['r', 'relations', 'tree'].includes(answer)) {
      renderRelations(game);
      continue;
    }
    if (['t', 'story', 'stories'].includes(answer)) {
      renderStory(game);
      continue;
    }
    if (['g', 'gallery'].includes(answer)) {
      renderGallery(endingCatalog(), loadProfile(profileFile));
      continue;
    }
    if (['w', 'save'].includes(answer)) {
      saveGame(game, argv.saveFile || `saves/${game.student.name}-${game.seedText}.json`);
      continue;
    }
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= actions.length) {
      const action = actions[index - 1];
      if (!action.available) {
        console.log(red(`  ${action.reason}`));
        continue;
      }
      return action;
    }
    console.log(red('  看不懂这个输入，输个数字吧。'));
  }
}

async function chooseSubjectInteractive(prompter, game, action) {
  const options = action.subjectOptions;
  console.log(dim(`  ${action.name}需要选一个科目：`));
  options.forEach((item, index) => {
    const knowledge = game.knowledge[item.key] ?? 0;
    console.log(`  ${bold(String(index + 1))}. ${pad(item.name, 4)} 知识 ${String(Math.round(knowledge * 10) / 10).padStart(5)}`);
  });
  for (;;) {
    const raw = await prompter.ask('> 选择科目：');
    if (raw === null) return options[0]?.key;
    const answer = raw.trim();
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) return options[index - 1].key;
    const byName = options.find((item) => item.name === answer || item.key === answer);
    if (byName) return byName.key;
    console.log(red(`  输入 1-${options.length} 或者科目名。`));
  }
}

async function chooseEventInteractive(prompter, pending) {
  console.log('');
  console.log(bold(yellow(`  ${pending.icon} ${pending.name}`)));
  console.log(`  ${pending.text}`);
  pending.choices.forEach((choice, index) => {
    console.log(`  ${bold(String(index + 1))}. ${choice.label}${choice.hint ? dim(`（${choice.hint}）`) : ''}`);
  });
  for (;;) {
    const raw = await prompter.ask('> 你的选择：');
    if (raw === null) return pending.choices[0]?.id;
    const answer = raw.trim();
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= pending.choices.length) return pending.choices[index - 1].id;
    const byId = pending.choices.find((choice) => choice.id === answer);
    if (byId) return byId.id;
    console.log(red('  输入选项编号。'));
  }
}

async function shopInteractive(prompter, game) {
  const shop = listShop(game);
  console.log(divider(`商场（零花钱 ${game.stats.money} 元，买东西不花时间）`));
  shop.forEach((item, index) => {
    const state = item.canBuy ? green('可购买') : red(item.reason ?? '不可购买');
    console.log(
      `  ${bold(String(index + 1).padStart(2))}. ${item.icon} ${pad(item.name, 20)} ${String(item.price).padStart(5)} 元　${dim(
        item.desc,
      )}　${state}${item.owned ? yellow('（已拥有）') : ''}`,
    );
  });
  for (;;) {
    const raw = await prompter.ask('> 输入编号购买，回车返回：');
    if (raw === null) return;
    const answer = raw.trim();
    if (answer === '') return;
    const index = Number(answer);
    const item = shop[index - 1];
    if (!item) {
      console.log(red('  没有这个编号。'));
      continue;
    }
    try {
      const result = buyItem(game, item.id);
      printLines(result.lines);
    } catch (error) {
      console.log(red(`  ${error.message}`));
    }
    return shopInteractive(prompter, game);
  }
}

async function runInteractive(game, existingPrompter) {
  const prompter = existingPrompter ?? createPrompter();
  const ownsPrompter = !existingPrompter;
  let lastAction = null;
  try {
    while (game.status === 'playing') {
      renderStatus(game);
      renderActions(game);
      const action = await chooseActionInteractive(prompter, game, lastAction);
      if (!action) {
        console.log(dim('\n  你把书包收好，走出了校门。'));
        break;
      }
      let subject;
      if (action.needsSubject) subject = await chooseSubjectInteractive(prompter, game, action);
      let result;
      try {
        result = performAction(game, action.id, { subject });
      } catch (error) {
        if (error instanceof GameError) {
          console.log(red(`  ${error.message}`));
          continue;
        }
        throw error;
      }
      lastAction = action;
      console.log('');
      printLines(result.lines);
      while (game.pendingEvent && game.status === 'playing') {
        const choiceId = await chooseEventInteractive(prompter, game.pendingEvent);
        printLines(resolveEvent(game, choiceId).lines);
      }
      if (game.status === 'playing' && argv.saveFile) saveGame(game, argv.saveFile, { silent: true });
    }
    if (game.status === 'volunteering') {
      await volunteerInteractive(prompter, game);
      if (argv.saveFile) saveGame(game, argv.saveFile, { silent: true });
    }
  } catch (error) {
    if (error?.name === 'AbortError') console.log(dim('\n  已退出。'));
    else throw error;
  } finally {
    if (ownsPrompter) prompter.close();
  }
  if (game.status === 'ended') renderEnding(game);
}

/**
 * 高考之后的志愿填报：六个格子，自己填。
 *
 * 这是 v2.6 的新终局玩法——分数只决定你能碰到哪些学校，
 * **志愿顺序 + 要不要服从调剂**才是最后那一关。
 */
async function volunteerInteractive(prompter, game) {
  const ask = async (promptText) => {
    const answer = await prompter.ask(promptText);
    return answer === null ? '' : answer.trim();
  };
  let state = volunteerState(game);
  console.log(bold(green('\n📋 志愿填报')));
  console.log(`  总分 ${bold(String(state.total))}　全省排名 ${state.rank}`);
  console.log(yellow(`  今年的风声：${state.rumor}`));

  let chosen = [];
  let adjust = true;
  for (;;) {
    const picked = new Set(chosen);
    console.log(dim('\n  可填的院校专业组（冲=分不够但想赌，稳=差不多，保=有余量）：'));
    state.options.forEach((option, index) => {
      const mark = picked.has(option.id) ? green('✔') : ' ';
      const level = option.level === '冲' ? red('冲') : option.level === '稳' ? yellow('稳') : green('保');
      const limit = option.require ? dim(`　${option.require.label}`) : '';
      const gap = option.gap >= 0 ? `+${option.gap}` : String(option.gap);
      console.log(
        `   ${mark} ${String(index + 1).padStart(2)}. ${level} ${pad(option.school, 12)} ${pad(option.majorName, 14)} 线 ${String(option.minScore).padStart(3)}（${gap}）${limit}`,
      );
    });
    console.log(
      `\n  已填 ${chosen.length}/${state.slots}：` +
        (chosen.length
          ? chosen.map((id, i) => `${i + 1}.${state.options.find((option) => option.id === id)?.school ?? '?'}`).join('　')
          : dim('（还没填）')),
    );
    console.log(dim('  命令：数字=按顺序填入　c=清空　a=服从调剂开关　d=提交并投档'));
    const raw = await ask(`\n> 你的选择（a 现在${adjust ? '开' : '关'}）：`);
    if (raw === null || raw === '') {
      console.log(dim('  你把笔放下了。'));
      break;
    }
    if (/^d$/i.test(raw)) {
      if (chosen.length === 0) {
        console.log(red('  一个都没填，招生办不会等你。再想想。'));
        continue;
      }
      const result = submitVolunteers(game, chosen, { adjust });
      printLines(result.lines);
      return;
    }
    if (/^c$/i.test(raw)) {
      chosen = [];
      continue;
    }
    if (/^a$/i.test(raw)) {
      adjust = !adjust;
      console.log(dim(`  服从调剂：${adjust ? '开' : '关'}${adjust ? '' : '（不服从 = 滑档就真的没书读）'}`));
      continue;
    }
    const number = Number(raw);
    if (Number.isFinite(number) && number >= 1 && number <= state.options.length) {
      const option = state.options[number - 1];
      if (!picked.has(option.id) && chosen.length < state.slots) chosen.push(option.id);
      else if (picked.has(option.id)) chosen = chosen.filter((id) => id !== option.id);
      continue;
    }
    // 也允许一次输入多个编号，例如 "3 7 2"
    const numbers = String(raw)
      .split(/[\s,，、]+/)
      .map((part) => Number(part))
      .filter((value) => Number.isFinite(value) && value >= 1 && value <= state.options.length);
    if (numbers.length) {
      for (const value of numbers) {
        const option = state.options[value - 1];
        if (!picked.has(option.id) && chosen.length < state.slots) chosen.push(option.id);
      }
      continue;
    }
    console.log(red('  看不懂这个输入，试试数字 / c / a / d。'));
  }
  // 退出交互（输入结束）时别把玩家卡在 volunteering 上：按最稳的方案兜底
  const auto = autoFillVolunteers(game, 'safe');
  printLines(submitVolunteers(game, auto.picks, { adjust: true }).lines);
}

/* ------------------------------------------------------------- 自动对局 */

/**
 * 解析 `--volunteers`：既接受列表里的编号（"3 7 2"），也接受志愿 id
 * （`vol-03-jisuanji`）。没给就按"冲稳保"自动填一张。
 */
function parseVolunteerPicks(raw, game) {
  const state = volunteerState(game);
  if (!state) return [];
  if (raw === undefined || raw === true || String(raw).trim() === '') {
    return autoFillVolunteers(game, 'balanced').picks;
  }
  const picks = [];
  for (const part of String(raw).split(/[,，\s、]+/).filter(Boolean)) {
    const number = Number(part);
    const option = Number.isFinite(number)
      ? state.options[number - 1]
      : state.options.find((entry) => entry.id === part);
    if (option && !picks.includes(option.id) && picks.length < VOLUNTEER_SLOTS) picks.push(option.id);
  }
  return picks.length ? picks : autoFillVolunteers(game, 'balanced').picks;
}

function runAuto(game, options = {}) {
  const strategy = options.strategy ?? STRATEGIES.diligent;
  const requested = Number.isFinite(options.maxWeeks) ? options.maxWeeks : Number.POSITIVE_INFINITY;
  // 自由模式没有"自动到来"的高考，策略又可能一直不复习完，这里加一个安全上限，避免无限循环
  const safety = game.endless ? Math.max(totalWeeks(game) * 3, 120) : Number.POSITIVE_INFINITY;
  const maxWeeks = Math.min(requested, safety);
  const quiet = Boolean(options.quiet);
  const saveFile = options.saveFile;
  let weeks = 0;
  // 志愿填报阶段也算"没打完"：playWeek 会替自动对局把志愿表填掉
  while ((game.status === 'playing' || game.status === 'volunteering') && weeks < maxWeeks) {
    weeks += 1;
    if (!quiet) renderStatus(game);
    const week = playWeek(game, strategy, { volunteerStrategy: options.volunteerStrategy });
    if (!quiet) printLines(week.lines);
    if (saveFile) saveGame(game, saveFile, { silent: quiet });
  }
  if (saveFile) saveGame(game, saveFile, { silent: quiet });
  if (game.status === 'playing' && !quiet) {
    console.log(dim(`\n  已经打到 ${game.turn} 周，自由模式还没有报名高考，先停在这里。`));
  }
  if (options.showEnding !== false && game.status === 'ended') renderEnding(game);
  return game;
}

/* ------------------------------------------------------------------ 存档 */

function saveGame(game, file, options = {}) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serialize(game, true), 'utf8');
    if (!options.silent) console.log(green(`  💾 已存档到 ${file}`));
    return true;
  } catch (error) {
    if (!options.silent) console.log(red(`  存档失败：${error.message}`));
    return false;
  }
}

function loadGame(file) {
  return deserialize(readFileSync(file, 'utf8'));
}

/* ------------------------------------------------------------------ 入口 */

function printHelp() {
  console.log(`
${SCHOOL.name} 模拟器 · 终端版 v2

用法：
  node src/cli.js [选项]        不带参数会进入开局向导

构筑选项：
  --name <名字>           学生姓名
  --nickname <外号>       外号（留空则随机一个）
  --gender <男|女>        性别
  --track <physics|history>  首选方向（物理类 / 历史类）
  --electives <a,b>       再选两门（chemistry/biology/politics/geography）
  --traits <a,b>          天赋（选 2 个，见 --list-traits）
  --personality <id>      性格（plain/sunny/calm/sharp/lazy/sensitive/tough）
  --flaw <id>             缺陷（最多 1 个，用短板换属性点；myopia/poor/light_sleep/frail/slow_start）
  --points <方案>         属性点，例如 "intelligence:4,math:2"（可用的键列在帮助最后）
  --legacy <点数>         多周目传承点（额外属性点）
  --background <id>       家庭背景（worker/magang/town/business）
  --goal <id>             高考目标（top2/c985/yiben/baosong/special/happy/love/money/alive）
  --difficulty <难度>     easy | normal | hard | realistic | custom
  --weeks <周数>          每学期周数，3-20（默认 ${DEFAULT_WEEKS_PER_SEMESTER}）
  --endless               自由模式：什么时候高考由你决定
  --no-volunteers         跳过高考后的志愿填报（直接按分数录取，做对照用）
  --volunteers <编号>     自动对局时指定的志愿，例如 "3 7 2"（编号见对局中打印的志愿表）
  --no-adjust             填志愿时不服从调剂（滑档就真的没书读）
  --pack <文件>           启动时加载内容包（热更新）；给 --pack 不带值则读 saves/content-pack.json
  --content               打印当前内容包状态后退出
  --seed <种子>           固定种子，结果可复现

对局选项：
  --wizard                强制进入开局向导（管道输入时也能用，方便脚本化）
  --yes                   跳过向导，全部用默认值 / 命令行参数开局
  --auto [周数]           自动对局（不给周数就一直打到结局）
  --strategy <策略>       ${Object.keys(STRATEGIES).join(' | ')}
  --quiet                 自动对局时只输出结局
  --json                  结束时输出 JSON 摘要
  --load <文件>           读取存档继续
  --save-file <文件>      每回合自动存档
  --gallery               查看结局图鉴与历史战绩
  --relations             自动对局结束后打印人物关系图
  --story                 自动对局结束后打印故事线
  --profile <文件>        档案文件（默认 ${DEFAULT_PROFILE_FILE}）
  --list-strategies       列出所有自动策略
  --help                  显示帮助

属性点（--points 用的键）：
  ${POINT_BUY.filter((item) => !item.perSubject)
    .map((item) => `${item.key}（${item.name}，1 点 = +${item.per}，最多 ${item.max} 点）`)
    .join('\n  ')}
  单科底子直接写科目：${ALL_SUBJECT_KEYS.map((key) => SUBJECT_MAP[key]?.name ?? key).join(' / ')}（也可以写中文科目名，每科最多 3 点）

交互命令：
  数字=行动　s=状态　l=日志　e=成绩单　b=商店　g=图鉴
  r=人物关系图　t=故事线　w=存档　q=退出
`);
}

async function main() {
  if (argv.gallery) {
    renderGallery(endingCatalog(), loadProfile(profileFile));
    return;
  }
  if (argv.content) {
    const status = contentStatus();
    console.log(bold('\n🔄 内容包状态'));
    console.log(`  当前：${status.active ? `${status.summary.name}${status.summary.version ? ` v${status.summary.version}` : ''}` : '官方内置内容'}`);
    if (status.active) {
      console.log(`  校验和：${status.checksum}`);
      const counts = status.summary.counts;
      console.log(`  改动：事件 ${counts.events}　道具 ${counts.items}　天赋 ${counts.traits}　平衡 ${counts.balance}`);
    }
    console.log(`  随机事件：${status.eventCount} 个（内置 ${status.baselineEventCount} 个）`);
    return;
  }

  const options = {
    name: argv.name,
    nickname: argv.nickname,
    gender: argv.gender === '女' ? '女' : '男',
    seed: argv.seed ?? String(Date.now()),
    difficulty: String(argv.difficulty ?? 'normal'),
    custom: argv.custom ? parseCustomSpec(String(argv.custom)) : undefined,
    weeksPerSemester: argv.weeks ? Number(argv.weeks) : DEFAULT_WEEKS_PER_SEMESTER,
    track: argv.track === 'history' ? 'history' : 'physics',
    electives: argv.electives ? String(argv.electives).split(',') : undefined,
    traits: argv.traits ? String(argv.traits).split(',') : undefined,
    personality: argv.personality ? String(argv.personality) : undefined,
    flaw: argv.flaw ? String(argv.flaw) : undefined,
    points: argv.points ? parsePointSpec(String(argv.points)) : undefined,
    legacyPoints: argv.legacy ? Number(argv.legacy) : undefined,
    background: argv.background ? String(argv.background) : undefined,
    goal: argv.goal ? String(argv.goal) : undefined,
    endless: Boolean(argv.endless),
    // 高考之后要不要填志愿（v2.6 的新终局玩法）；--no-volunteers 可以关掉
    volunteers: !argv.noVolunteers,
  };

  // 启动时先打内容包（热更新）：--pack <文件> 指定，默认读 saves/content-pack.json
  if (argv.pack !== undefined) {
    try {
      const file = typeof argv.pack === 'string' ? argv.pack : 'saves/content-pack.json';
      const result = applyContentPack(JSON.parse(readFileSync(file, 'utf8')));
      if (result.ok) console.log(green(`  🔄 已加载内容包：${result.summary.name}（${result.summary.total} 项）`));
      else console.error(red(`  内容包没生效：${result.errors.join('；')}`));
    } catch (error) {
      console.error(red(`  读内容包失败：${error.message}`));
    }
  }

  let game;
  const wantsWizard = Boolean(argv.wizard) || (!argv.auto && !argv.json && process.stdin.isTTY && !argv.yes);

  if (argv.load) {
    try {
      game = loadGame(argv.load);
      console.log(green(`  📂 已读取存档：${argv.load}`));
    } catch (error) {
      console.error(red(`读取存档失败：${error.message}`));
      process.exit(1);
    }
    if (!argv.auto && !argv.json) {
      const prompter = createPrompter();
      try {
        await runInteractive(game, prompter);
      } finally {
        prompter.close();
      }
      finishAndReport(game);
      return;
    }
  } else if (wantsWizard || (!argv.auto && !argv.json)) {
    // 开局向导和整局游玩共用同一个输入器，脚本化输入也不会丢行
    const prompter = createPrompter();
    try {
      if (wantsWizard) {
        try {
          await setupWizard(prompter, options);
        } catch (error) {
          if (error?.name !== 'AbortError') throw error;
        }
      }
      game = createGame(options);
      await runInteractive(game, prompter);
    } finally {
      prompter.close();
    }
    finishAndReport(game);
    return;
  } else {
    game = createGame(options);
  }

  if (argv.auto) {
    const maxWeeks = argv.auto === true ? Number.POSITIVE_INFINITY : Number(argv.auto) || Number.POSITIVE_INFINITY;
    const strategy = getStrategy(argv.strategy ?? 'diligent');
    runAuto(game, { strategy, maxWeeks, quiet: Boolean(argv.quiet), showEnding: !argv.json, saveFile: argv.saveFile });
    // 自动对局默认自己填志愿；--volunteers 可以用编号指定（例如 "3 7 2"）
    if (game.status === 'volunteering') {
      const picks = parseVolunteerPicks(argv.volunteers, game);
      if (!argv.quiet) {
        const state = volunteerState(game);
        console.log(bold(`\n📋 志愿填报：总分 ${state.total}　排名 ${state.rank}`));
        console.log(dim(`  ${state.rumor}`));
      }
      const result = submitVolunteers(game, picks, { adjust: !argv.noAdjust });
      if (!argv.quiet) printLines(result.lines);
    }
    if (!argv.json && !argv.quiet && argv.relations) renderRelations(game);
    if (!argv.json && !argv.quiet && argv.story) renderStory(game);
    finishAndReport(game);
    return;
  }

  await runInteractive(game);
  finishAndReport(game);
}

function finishAndReport(game) {
  if (game.status !== 'ended') {
    if (argv.auto && !argv.json && !argv.quiet) console.log(dim(`\n  自动对局暂停在第 ${game.turn} 周。`));
    return;
  }
  const profile = loadProfile(profileFile);
  recordGame(profile, game);
  saveProfile(profile, profileFile);

  if (argv.json) {
    console.log(JSON.stringify({ ...summaryOf(game), profile: { file: profileFile, games: profile.games } }, null, 2));
    return;
  }
  if (!argv.quiet) {
    const stat = profileStats(profile, endingCatalog());
    console.log(dim(`  档案已更新：${profileFile}　图鉴 ${stat.unlocked}/${stat.total}　成就 ${stat.achievements} 种`));
  }
}

function summaryOf(game) {
  const view = viewState(game);
  const gaokao = game.exams.find((exam) => exam.kind === 'gaokao');
  return {
    name: game.student.name,
    seed: game.seedText,
    difficulty: game.difficulty,
    endless: game.endless,
    build: view.build,
    selection: view.selection,
    turns: view.turn,
    status: game.status,
    ending: game.ending
      ? {
          id: game.ending.id,
          title: game.ending.title,
          tier: game.ending.tier,
          school: game.ending.school,
          total: game.ending.total ?? null,
          rank: game.ending.rank ?? null,
          goal: game.ending.goal ?? null,
        }
      : null,
    gaokao: gaokao ? { total: gaokao.total, rank: gaokao.rank, subjects: gaokao.subjects } : null,
    stats: view.stats,
    npc: view.npc.map((npc) => ({ name: npc.name, value: npc.value })),
    knowledge: Object.fromEntries(view.subjects.map((subject) => [subject.key, subject.knowledge])),
    achievements: game.ending?.achievements?.map((item) => item.name) ?? [],
    items: view.items.map((item) => item.name),
  };
}

main().catch((error) => {
  console.error(red(`出错了：${error?.stack ?? error}`));
  process.exit(1);
});
