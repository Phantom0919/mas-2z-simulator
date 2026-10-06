/**
 * 人物阵容 / 随机姓名 / 关系树 / 故事线 的测试。
 *
 * 这一组测试守的是四件事：
 *   1. 名字是中文常见姓名，同一局不重名，同一个种子必然得到同一批人；
 *   2. 取名字不会打乱 game.rngState 的主随机序列（否则老种子、老平衡就全变了）；
 *   3. 关系树结构正确（父子关系、不重叠、能画出文字版）；
 *   4. 剧情章节结构合法、按顺序强制触发、且绝不会混进随机事件池。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIONS,
  ALL_EVENTS,
  DIFFICULTY,
  EVENT_MAP,
  createGame,
  deserialize,
  listActions,
  performAction,
  playWeek,
  relationGraph,
  renderTreeText,
  resolveEvent,
  serialize,
  storyCatalog,
  storyEvents,
  storyProgress,
  treeStats,
  viewState,
} from '../src/engine.js';
import {
  BACKGROUND_MAP,
  GOALS,
  NPCS,
  NPC_KEYS,
  TRAIT_MAP,
} from '../src/data/character.js';
import { ITEM_MAP } from '../src/data/items.js';
import { ALL_SUBJECT_KEYS, SCHOOL } from '../src/data/school.js';
import { CAST_GROUPS, CAST_ROLES, affinityLevel, buildCast, randomStudentName } from '../src/data/cast.js';
import { SURNAMES } from '../src/data/names.js';
import { STORY_ARCS } from '../src/data/story.js';
import { hashSeed, pick, randFloat, randInt } from '../src/rng.js';
import { getStrategy, STRATEGIES } from '../src/strategies.js';

/** 跟引擎里的 clamp 一致（测试里自己写一份，避免把内部函数导出）。 */
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/* ------------------------------------------------------------ 随机姓名 */

test('随机姓名是中文常见姓名，姓来自百家姓表', () => {
  const cast = buildCast('name-seed-1');
  for (const person of cast.list) {
    assert.ok(/^[\u4e00-\u9fa5]{2,4}$/.test(person.name), `${person.name} 不是中文姓名`);
    assert.ok(SURNAMES.includes(person.surname), `${person.surname} 不在百家姓表里`);
    assert.equal(person.name, person.surname + person.given);
  }
});

test('同一个种子必然得到同一批人，不同种子得到不同的人', () => {
  const a = buildCast('same-seed');
  const b = buildCast('same-seed');
  const c = buildCast('other-seed');
  assert.deepEqual(
    a.list.map((person) => person.name),
    b.list.map((person) => person.name),
  );
  assert.notDeepEqual(
    a.list.map((person) => person.name),
    c.list.map((person) => person.name),
  );
});

test('同一局里不会出现重名，连"名"也不重复', () => {
  for (let i = 0; i < 40; i += 1) {
    const names = buildCast(`dup-${i}`).list.map((person) => person.name);
    assert.equal(new Set(names).size, names.length, `种子 dup-${i} 出现了重名：${names.join('、')}`);
    // 双字名之间不能共用一个"名"（否则同学们互相叫起来会混）
    const given = names.map((name) => (name.length > 2 ? name.slice(1) : null)).filter(Boolean);
    assert.equal(new Set(given).size, given.length, `种子 dup-${i} 出现了同名不同姓：${given.join('、')}`);
  }
});

test('主角姓名可以随机生成，且跟 NPC 不重名', () => {
  const name = randomStudentName('student-seed', '女');
  assert.ok(SURNAMES.includes(name.slice(0, 1)));
  assert.ok(/^[\u4e00-\u9fa5]{2,4}$/.test(name));

  const game = createGame({ seed: 'auto-name', gender: '女' });
  assert.ok(SURNAMES.includes(game.student.name.slice(0, 1)), '不填名字时应该自动生成中文姓名');
  assert.ok(game.cast.list.every((person) => person.name !== game.student.name));

  // 老版本的占位符"无名氏"不能再当姓氏用（否则爸爸会姓"无"）
  const placeholder = createGame({ name: '无名氏', seed: 'placeholder-name' });
  assert.notEqual(placeholder.student.name, '无名氏');
  assert.ok(SURNAMES.includes(placeholder.student.name.slice(0, 1)));
  assert.equal(placeholder.cast.map.father.surname, placeholder.student.name.slice(0, 1));
  assert.ok(SURNAMES.includes(placeholder.cast.map.father.surname));

  // 取的名字得真的像中文常见姓名
  for (let i = 0; i < 30; i += 1) {
    const person = createGame({ seed: `name-quality-${i}` });
    assert.ok(SURNAMES.includes(person.student.name.slice(0, 1)));
    assert.ok(/^[\u4e00-\u9fa5]{2,4}$/.test(person.student.name));
  }
});

test('取名字不会消耗 game.rngState（主随机序列不被污染）', () => {
  const game = createGame({ name: '测试', seed: 'rng-isolation' });

  // 按"没有名字这回事"的顺序，手动重放 createGame 里真正的随机消费：
  // 班级 → 智力 → 体质 → 九科初始知识。如果取名字动了 game.rngState，
  // 重放出来的状态就对不上，这一条会立刻失败。
  const probe = { rngState: hashSeed('rng-isolation|测试|normal|physics|chemistrybiology') };
  pick(probe, SCHOOL.classOptions);
  const intelligence = randInt(probe, 46, 72);
  const physique = randInt(probe, 45, 70);
  const knowledge = ALL_SUBJECT_KEYS.map(() => randFloat(probe, 10, 24));

  assert.equal(game.rngState, probe.rngState, '主随机序列被名字生成打乱了');
  assert.equal(game.stats.intelligence, clamp(intelligence, 0, 100));
  assert.equal(game.stats.physique, physique);
  for (const [index, key] of ALL_SUBJECT_KEYS.entries()) {
    assert.equal(game.knowledge[key], Math.round(clamp(knowledge[index], 0, 100) * 10) / 10);
  }
});

/* ------------------------------------------------------------ 人物阵容 */

test('阵容固定 8 个人，三组齐全，好感键都能对上', () => {
  const game = createGame({ name: '阵容', seed: 'cast-1' });
  assert.equal(game.cast.list.length, 8);
  assert.equal(game.cast.list.length, CAST_ROLES.length);

  const groups = new Set(game.cast.list.map((person) => person.group));
  assert.deepEqual([...groups].sort(), CAST_GROUPS.map((group) => group.id).sort());

  for (const person of game.cast.list) {
    assert.ok(NPC_KEYS.includes(person.affinity), `${person.id} 的好感键 ${person.affinity} 不在 NPC_KEYS 里`);
  }
  // 七个好感键都要有人负责
  for (const key of NPC_KEYS) {
    assert.ok(game.cast.byAffinity[key]?.length >= 1, `好感键 ${key} 没有人对应`);
  }
});

test('爸爸跟主角同姓；同桌跟主角同性别；心动对象是异性', () => {
  const boy = createGame({ name: '王小明', seed: 'gender-boy', gender: '男' });
  assert.equal(boy.cast.map.father.surname, '王');
  assert.equal(boy.cast.map.deskmate.gender, '男');
  assert.equal(boy.cast.map.friend.gender, '男');
  assert.equal(boy.cast.map.love.gender, '女');
  assert.equal(boy.cast.map.rival.gender, '女');

  const girl = createGame({ name: '李小红', seed: 'gender-girl', gender: '女' });
  assert.equal(girl.cast.map.father.surname, '李');
  assert.equal(girl.cast.map.deskmate.gender, '女');
  assert.equal(girl.cast.map.love.gender, '男');
});

test('老师的称呼是"某老师"，同学用去姓的叫法', () => {
  const game = createGame({ name: '称呼', seed: 'call-1' });
  const { head, math, deskmate } = game.cast.map;
  assert.equal(head.teacher, `${head.surname}老师`);
  assert.equal(math.teacher, `${math.surname}老师`);
  // 双字名去姓，单字名保留
  assert.equal(deskmate.call, deskmate.name.length > 2 ? deskmate.name.slice(1) : deskmate.name);
});

test('viewState 里每个人都能被前端直接使用', () => {
  const game = createGame({ name: '视图', seed: 'view-cast' });
  const view = viewState(game);
  assert.equal(view.cast.length, 8);
  for (const person of view.cast) {
    assert.ok(person.name && person.role && person.icon, '人物缺字段');
    assert.equal(typeof person.value, 'number');
  }
  for (const npc of view.npc) {
    assert.ok(npc.short, 'npcs 应该带上具体的人名');
    assert.ok(npc.name.includes('·'), 'npcs 的 name 保持"角色 · 全名"的形状');
  }
});

test('旧存档（没有 cast / 新好感键）读进来会补齐', () => {
  const game = createGame({ name: '老存档', seed: 'old-save' });
  const data = JSON.parse(serialize(game));
  delete data.cast;
  delete data.story;
  delete data.npc.friend;
  delete data.npc.rival;
  const restored = deserialize(data);
  assert.equal(restored.cast.list.length, 8);
  assert.deepEqual(
    restored.cast.list.map((person) => person.name),
    game.cast.list.map((person) => person.name),
    '读档后应该还是同一批人',
  );
  assert.equal(typeof restored.npc.friend, 'number');
  assert.equal(typeof restored.npc.rival, 'number');
  assert.deepEqual(restored.story, []);
});

/* ------------------------------------------------------------ 关系树 */

test('关系树：根 → 分组 → 人，每条边两端都在节点表里', () => {
  const game = createGame({ name: '树', seed: 'tree-1' });
  const graph = relationGraph(game);
  const ids = new Set(graph.nodes.map((node) => node.id));
  assert.ok(ids.has('me'));

  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.from), `边的起点 ${edge.from} 不存在`);
    assert.ok(ids.has(edge.to), `边的终点 ${edge.to} 不存在`);
  }
  // 每个分组都挂在根上，每个人都挂在自己的分组上
  for (const group of CAST_GROUPS) {
    const groupId = `group:${group.id}`;
    assert.ok(graph.edges.some((edge) => edge.from === 'me' && edge.to === groupId), `${group.name} 没挂在根上`);
    for (const person of game.cast.list.filter((item) => item.group === group.id)) {
      const personId = `person:${person.id}`;
      assert.ok(
        graph.edges.some((edge) => edge.from === groupId && edge.to === personId),
        `${person.name} 没挂在 ${group.name} 下`,
      );
    }
  }
});

test('关系树：节点不重叠，每层的横坐标单调递增', () => {
  const game = createGame({ name: '布局', seed: 'tree-layout' });
  const graph = relationGraph(game);
  const people = graph.nodes.filter((node) => node.kind === 'person');
  assert.equal(people.length, 8);

  const ys = people.map((node) => node.y);
  assert.equal(new Set(ys).size, ys.length, '同一层的人不能挤在一个位置上');

  const depthX = new Map();
  for (const node of graph.nodes) {
    const known = depthX.get(node.depth);
    if (known === undefined) depthX.set(node.depth, node.x);
    else assert.equal(node.x, known, `第 ${node.depth} 层的横坐标应该一致`);
  }
  assert.ok(depthX.get(0) < depthX.get(1));
  assert.ok(depthX.get(1) < depthX.get(2));

  for (const node of graph.nodes) {
    assert.ok(node.x >= 0 && node.x <= graph.width, `${node.id} 超出画布宽度`);
    assert.ok(node.y >= 0 && node.y <= graph.height, `${node.id} 超出画布高度`);
  }
});

test('关系树：文字版包含每个人的名字和好感度', () => {
  const game = createGame({ name: '文字树', seed: 'tree-text' });
  game.npc.deskmate = 88;
  const text = renderTreeText(relationGraph(game));
  for (const person of game.cast.list) {
    assert.ok(text.includes(person.name), `文字树里少了 ${person.name}`);
  }
  assert.ok(text.includes('88'));
  assert.ok(text.includes('无话不谈'));
  assert.ok(text.includes(game.student.name), '文字树要有根节点（主角）');
  assert.ok(text.includes('└─') || text.includes('├─'), '文字树要有树枝');
});

test('关系树的统计跟数据对得上', () => {
  const game = createGame({ name: '统计', seed: 'tree-stats' });
  game.npc.deskmate = 90;
  game.npc.friend = 10;
  const stats = treeStats(relationGraph(game));
  assert.equal(stats.total, 8);
  assert.ok(stats.close >= 1, 'deskmate 90 应该被算成"走得近"');
  assert.ok(stats.cold >= 1, 'love 0 应该被算成"还僵着"');
  assert.equal(stats.best.id, 'deskmate');
  assert.equal(stats.best.affinity, 90);
});

test('好感度分档覆盖 0-100 且不重复错位', () => {
  const levels = [0, 20, 40, 60, 80, 100].map((value) => affinityLevel(value, 'deskmate').label);
  assert.equal(new Set(levels).size, levels.length);
  assert.notEqual(affinityLevel(90, 'deskmate').label, affinityLevel(90, 'love').label);
});

/* ------------------------------------------------------------ 不进则退 */

/** 把当前这一周剩下的阶段走完。 */
function settle(game) {
  let guard = 0;
  while (game.pendingEvent && game.status === 'playing' && guard < 10) {
    guard += 1;
    resolveEvent(game, game.pendingEvent.choices[0].id);
  }
}

test('不进则退：没碰过的科目每周都会掉，碰过的几乎不掉', () => {
  const game = createGame({ name: '遗忘', seed: 'decay-basic', weeksPerSemester: 6 });
  const before = { ...game.knowledge };

  // 主行动只学数学；周末故意安排一个不学习的行动
  performAction(game, 'drill', { subject: 'math' });
  settle(game);
  performAction(game, 'sleep');
  settle(game);

  const mathDelta = (game.knowledge.math ?? 0) - before.math;
  const others = ['chinese', 'english', 'physics', 'chemistry', 'biology'].map(
    (key) => (game.knowledge[key] ?? 0) - before[key],
  );

  assert.ok(mathDelta > 0, `学过的那科应该涨（实际 ${mathDelta.toFixed(2)}）`);
  for (const [index, delta] of others.entries()) {
    assert.ok(delta < 0, `没碰过的科目应该在掉（第 ${index} 科 ${delta.toFixed(2)}）`);
  }
});

test('周末学了 vs 没学，掉的速度明显不一样', () => {
  const runWeek = (weekendAction) => {
    const game = createGame({ name: '对比', seed: 'decay-weekend', weeksPerSemester: 6 });
    const before = { ...game.knowledge };
    performAction(game, 'drill', { subject: 'math' });
    settle(game);
    performAction(game, weekendAction, weekendAction === 'drill' ? { subject: 'english' } : undefined);
    settle(game);

    const untouched = ['chinese', 'physics', 'chemistry', 'biology'];
    const losses = untouched.map((key) => before[key] - (game.knowledge[key] ?? 0));
    return losses.reduce((sum, value) => sum + value, 0) / losses.length;
  };

  const idle = runWeek('sleep'); // 周末睡觉
  const study = runWeek('drill'); // 周末也学一门
  assert.ok(idle > study * 2, `周末不学应该掉得明显更多（不学 ${idle.toFixed(3)} vs 学 ${study.toFixed(3)}）`);
});

test('遗忘会被难度放大、被"过目不忘"这类天赋缩小', () => {
  const measure = (difficulty, traits) => {
    const game = createGame({ name: '遗忘', seed: 'decay-scale', difficulty, traits, weeksPerSemester: 6 });
    const before = { ...game.knowledge };
    performAction(game, 'sleep');
    settle(game);
    performAction(game, 'sleep');
    settle(game);
    const losses = Object.keys(before).map((key) => before[key] - (game.knowledge[key] ?? 0));
    return losses.reduce((sum, value) => sum + value, 0) / losses.length;
  };

  const easy = measure('easy', ['athletic', 'easygoing']);
  const normal = measure('normal', ['athletic', 'easygoing']);
  const hard = measure('hard', ['athletic', 'easygoing']);
  const realistic = measure('realistic', ['athletic', 'easygoing']);

  assert.ok(normal > easy, '正常应该比轻松忘得多');
  assert.ok(hard > normal, '困难应该比正常忘得多');
  assert.ok(realistic > hard, '真实（地狱开局）应该忘得最多');

  const sharp = measure('normal', ['memory', 'athletic']);
  assert.ok(sharp < normal, '带"过目不忘"应该忘得更慢');
});

test('知识不会被遗忘压到负数', () => {
  const game = createGame({ name: '归零', seed: 'decay-floor', difficulty: 'realistic' });
  for (const key of Object.keys(game.knowledge)) game.knowledge[key] = 0.2;
  for (let i = 0; i < 12; i += 1) {
    performAction(game, 'sleep');
    settle(game);
    performAction(game, 'sleep');
    settle(game);
  }
  for (const key of game.subjectKeys) {
    assert.ok(game.knowledge[key] >= 0, `${key} 掉成负数了：${game.knowledge[key]}`);
  }
});

test('界面能拿到"每周会掉多少"的说明', () => {
  const view = viewState(createGame({ name: '说明', seed: 'decay-view' }));
  assert.equal(typeof view.decayPerWeek.idle, 'number');
  assert.equal(typeof view.decayPerWeek.maintained, 'number');
  assert.ok(view.decayPerWeek.idle > view.decayPerWeek.maintained, '不学应该比学过掉得多');
  assert.equal(typeof view.difficulty.icon, 'string');
  assert.equal(typeof view.difficulty.desc, 'string');
});

/* ------------------------------------------------------------ 真实（地狱开局） */

test('真实难度：开局在及格线附近，而且明显偏科', () => {
  const game = createGame({ name: '偏科', seed: 'realistic-start', difficulty: 'realistic' });
  const values = game.subjectKeys.map((key) => game.knowledge[key]);

  for (const [index, value] of values.entries()) {
    assert.ok(value > 20 && value < 95, `第 ${index} 科开局 ${value} 不在"及格线附近"的范围内`);
  }

  const spread = Math.max(...values) - Math.min(...values);
  assert.ok(spread >= 20, `偏科应该让分数拉开（现在只有 ${spread.toFixed(1)}）`);
  assert.equal(game.startProfile.lopsided, true);
  assert.ok(game.startProfile.weakKeys.length >= 1, '应该至少有一门明显的弱科');
});

test('普通难度不偏科，起点也低得多', () => {
  const game = createGame({ name: '常规', seed: 'normal-start' });
  assert.equal(game.startProfile.lopsided, false);
  assert.deepEqual(game.startProfile.weakKeys, []);
  const values = game.subjectKeys.map((key) => game.knowledge[key]);
  assert.ok(Math.max(...values) < 40, '普通难度不该一上来就四十分以上');
});

test('每个难度的开局知识都在合法范围内', () => {
  for (const key of Object.keys(DIFFICULTY)) {
    for (let i = 0; i < 8; i += 1) {
      const game = createGame({ name: '区间', seed: `range-${key}-${i}`, difficulty: key });
      for (const subjectKey of game.subjectKeys) {
        const value = game.knowledge[subjectKey];
        assert.ok(value >= 0 && value <= 100, `${key} 开局知识越界：${value}`);
      }
    }
  }
});

/* ------------------------------------------------------------ 占位符防漏 */

/**
 * 界面上会**原样显示**、不经过占位符替换的字段，绝对不能出现 `{xxx}`。
 * 这类字段包括：行动的名字与说明、事件的名字、剧情章节的标题、天赋/背景/目标/道具的名字与说明。
 * （事件正文、选项、章节正文都会走 resolveText，所以那里可以写占位符。）
 */
test('界面上不会漏出未替换的占位符', () => {
  const offenders = [];
  const check = (where, value) => {
    if (typeof value === 'string' && /\{[a-zA-Z]/.test(value)) offenders.push(`${where}：${value}`);
  };

  for (const action of ACTIONS) {
    check(`行动 ${action.id}.name`, action.name);
    check(`行动 ${action.id}.desc`, action.desc);
    check(`行动 ${action.id}.tag`, action.tag);
  }
  for (const event of ALL_EVENTS) check(`事件 ${event.id}.name`, event.name);
  for (const arc of STORY_ARCS) {
    check(`剧情 ${arc.id}.title`, arc.title);
    check(`剧情 ${arc.id}.intro`, arc.intro);
    for (const chapter of arc.chapters) check(`剧情 ${arc.id}/${chapter.id}.title`, chapter.title);
  }
  for (const [id, item] of Object.entries(TRAIT_MAP)) {
    check(`天赋 ${id}.name`, item.name);
    check(`天赋 ${id}.desc`, item.desc);
  }
  for (const [id, item] of Object.entries(BACKGROUND_MAP)) {
    check(`背景 ${id}.name`, item.name);
    check(`背景 ${id}.desc`, item.desc);
  }
  for (const goal of GOALS) {
    check(`目标 ${goal.id}.name`, goal.name);
    check(`目标 ${goal.id}.desc`, goal.desc);
  }
  for (const [id, item] of Object.entries(ITEM_MAP)) {
    check(`道具 ${id}.name`, item.name);
    check(`道具 ${id}.desc`, item.desc);
  }
  for (const npc of NPCS) check(`人物 ${npc.key}.name`, npc.name);

  assert.deepEqual(offenders, [], `这些字段会原样显示，不能写占位符：\n${offenders.join('\n')}`);
});

test('一局跑完，界面上看到的每一处文字都是替换过的', () => {
  const game = createGame({ name: '防漏', seed: 'placeholder-run' });
  const strategy = getStrategy('balanced');
  let guard = 0;
  while (game.status === 'playing' && guard < 400) {
    guard += 1;
    playWeek(game, strategy);
  }
  const view = viewState(game);
  const offenders = [];
  const check = (where, value) => {
    if (typeof value === 'string' && /\{[a-zA-Z]/.test(value)) offenders.push(`${where}：${value}`);
  };

  for (const action of view.actions) {
    check(`行动 ${action.id}.name`, action.name);
    check(`行动 ${action.id}.desc`, action.desc);
    check(`行动 ${action.id}.tag`, action.tag);
  }
  for (const entry of view.log) {
    check(`日志 ${entry.title}`, entry.title);
    check(`日志 ${entry.title}.text`, entry.text);
  }
  for (const item of view.shop) {
    check(`商品 ${item.id}`, item.name);
    check(`商品 ${item.id}.desc`, item.desc);
  }
  for (const entry of game.story) {
    check(`剧情 ${entry.title}.title`, entry.title);
    check(`剧情 ${entry.title}.text`, entry.text);
  }
  for (const exam of view.exams) check(`考试 ${exam.name}`, exam.name);
  for (const npc of view.npc) check(`人物 ${npc.key}`, npc.name);
  for (const person of view.cast) check(`阵容 ${person.id}`, person.blurb);
  check('结局标题', view.ending?.title);
  check('结局正文', view.ending?.text);

  assert.deepEqual(offenders, [], `这些文字漏出了占位符：\n${offenders.join('\n')}`);
});

test('剧情和事件正文里的占位符全都替换成了这一局的人', () => {
  const game = createGame({ name: '林晚', seed: 'placeholder-text', gender: '女' });
  const strategy = getStrategy('balanced');
  let guard = 0;
  while (game.status === 'playing' && guard < 300) {
    guard += 1;
    playWeek(game, strategy);
  }
  const allText = [
    ...game.story.map((entry) => entry.text),
    ...game.log.map((entry) => entry.text),
    viewState(game).ending?.text ?? '',
  ].join('\n');

  assert.ok(!/\{[a-zA-Z]/.test(allText), `正文里还有没替换的占位符：${allText.match(/\{[a-zA-Z][^}]*\}/g)?.join('、')}`);
  // 代词必须是"他"或"她"，不能出现残留的英文
  assert.ok(!/\bta\b/.test(allText), '正文里漏出了 ta');
});

/* ------------------------------------------------------------ 故事线 */

test('剧情线结构合法：id 唯一、周数递增、每章都有正文', () => {
  assert.equal(STORY_ARCS.length, 7);
  const chapterTotal = STORY_ARCS.reduce((sum, arc) => sum + arc.chapters.length, 0);
  assert.ok(chapterTotal >= 30, `章节太少：${chapterTotal}`);

  for (const arc of STORY_ARCS) {
    assert.ok(arc.id && arc.title && arc.icon, `${arc.id} 缺字段`);
    const ids = new Set();
    let lastWeek = -1;
    for (const chapter of arc.chapters) {
      assert.ok(!ids.has(chapter.id), `${arc.id} 里章节 id 重复：${chapter.id}`);
      ids.add(chapter.id);
      assert.ok(chapter.title, `${arc.id}/${chapter.id} 缺标题`);
      // 每章都必须有 text：没正文的章节在界面上就是一片空白
      assert.equal(typeof chapter.text, 'function', `${arc.id}/${chapter.id} 缺 text`);
      const week = chapter.week ?? 0;
      assert.ok(week >= 0 && week <= 40, `${arc.id}/${chapter.id} 的 week 超出范围：${week}`);
      assert.ok(week >= lastWeek, `${arc.id} 的章节周数倒退了`);
      lastWeek = week;

      if (chapter.requires) {
        assert.ok(NPC_KEYS.includes(chapter.requires.npc), `${arc.id}/${chapter.id} 的 requires.npc 不合法`);
        assert.ok(chapter.requires.min >= 0 && chapter.requires.min <= 100);
      }
      if (chapter.choices) {
        const choiceIds = new Set();
        for (const choice of chapter.choices) {
          assert.ok(!choiceIds.has(choice.id), `${arc.id}/${chapter.id} 选项 id 重复`);
          choiceIds.add(choice.id);
          assert.ok(choice.label, `${arc.id}/${chapter.id}/${choice.id} 缺 label`);
          assert.equal(typeof choice.outcome, 'function', `${arc.id}/${chapter.id}/${choice.id} 缺 outcome`);
        }
      }
    }
  }
});

test('每个章节都被包成了一个"排队专用"的事件', () => {
  const events = storyEvents();
  const chapterTotal = STORY_ARCS.reduce((sum, arc) => sum + arc.chapters.length, 0);
  assert.equal(events.length, chapterTotal);
  for (const event of events) {
    assert.equal(event.story, true);
    assert.ok(EVENT_MAP[event.id], `${event.id} 没进 EVENT_MAP`);
    assert.equal(typeof event.text, 'function');
    // 随机池的双保险：cond 永远返回 false，story 标记也会被 rollEvent 过滤掉
    assert.equal(event.cond(), false);
  }
});

test('剧情事件不会出现在随机事件池里', () => {
  const randomPool = ALL_EVENTS.filter((event) => !event.story);
  assert.ok(randomPool.length >= 55);
  assert.equal(randomPool.filter((event) => event.id.startsWith('story_')).length, 0);
});

test('剧情会强制按顺序触发，并且不会互相插队', () => {
  const game = createGame({ name: '剧情', seed: 'story-run', weeksPerSemester: 6 });
  const strategy = getStrategy('balanced');
  let guard = 0;
  while (game.status === 'playing' && guard < 400) {
    guard += 1;
    playWeek(game, strategy);
  }
  assert.ok(game.story.length >= 12, `一局至少该演 12 章，实际 ${game.story.length}`);

  // 每条线内部的章节顺序必须跟定义一致
  const order = Object.fromEntries(STORY_ARCS.map((arc) => [arc.id, arc.chapters.map((chapter) => chapter.id)]));
  for (const arc of STORY_ARCS) {
    const played = game.story.filter((entry) => entry.arc === arc.id).map((entry) => entry.id);
    assert.deepEqual(played, order[arc.id].slice(0, played.length), `${arc.id} 的章节顺序乱了`);
  }
  // 同一章不会演两次
  const keys = game.story.map((entry) => `${entry.arc}:${entry.id}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('七条线的进度在一局里都能推进（不会互相饿死）', () => {
  const game = createGame({ name: '公平', seed: 'story-fair', weeksPerSemester: 6 });
  const strategy = getStrategy('balanced');
  let guard = 0;
  while (game.status === 'playing' && guard < 400) {
    guard += 1;
    playWeek(game, strategy);
  }
  const progress = storyProgress(game);
  assert.equal(progress.arcs.length, 7);
  for (const arc of progress.arcs) {
    assert.ok(arc.done > 0, `${arc.title} 一章都没演到`);
    assert.ok(arc.done <= arc.total);
  }
});

test('故事线目录：未解锁的只给标题，解锁的带正文', () => {
  const game = createGame({ name: '目录', seed: 'story-catalog' });
  const before = storyCatalog(game);
  assert.ok(before.every((arc) => arc.chapters.every((chapter) => !chapter.unlocked && chapter.text === null)));

  game.story.push({
    arc: 'family',
    arcTitle: '家里那盏灯',
    arcIcon: '🏠',
    id: 'f1',
    title: '夜宵',
    text: '一碗热好了的面。',
    turn: 1,
    week: 2,
    at: '高一上学期 第 2 周',
  });
  const after = storyCatalog(game);
  const family = after.find((arc) => arc.id === 'family');
  assert.equal(family.done, 1);
  assert.equal(family.chapters[0].unlocked, true);
  assert.equal(family.chapters[0].text, '一碗热好了的面。');
  assert.equal(family.chapters[0].at, '高一上学期 第 2 周');
  assert.equal(family.chapters[1].unlocked, false);
});

test('剧情正文里的名字用的是这一局的人，不写死', () => {
  const game = createGame({ name: '正文', seed: 'story-text' });
  const strategy = getStrategy('balanced');
  let guard = 0;
  while (game.status === 'playing' && guard < 300) {
    guard += 1;
    playWeek(game, strategy);
  }
  assert.ok(game.story.length > 0);
  for (const entry of game.story) {
    assert.ok(entry.text && entry.text.length > 10, `${entry.title} 的正文太短`);
    assert.ok(!entry.text.includes('undefined'), `${entry.title} 的正文里有 undefined`);
    assert.ok(!/张昊|王老师|李老师/.test(entry.text), `${entry.title} 里写死了人名`);
  }
  // 至少有一章提到了这一局某个人的名字
  const names = game.cast.list.map((person) => person.name);
  assert.ok(game.story.some((entry) => names.some((name) => entry.text.includes(name))));
});

test('结局会带上关系网和故事线的收尾快照', () => {
  const game = createGame({ name: '收尾', seed: 'story-ending' });
  const strategy = getStrategy('balanced');
  let guard = 0;
  while (game.status === 'playing' && guard < 300) {
    guard += 1;
    playWeek(game, strategy);
  }
  assert.equal(game.status, 'ended');
  const ending = game.ending;
  assert.ok(ending.relations.total >= 8);
  assert.equal(ending.cast.length, 8);
  assert.equal(ending.story.length, game.story.length);
  assert.ok(ending.story.every((entry) => entry.title && entry.arcTitle));
  assert.doesNotThrow(() => JSON.stringify(ending));
});

test('全部自动策略都能跑完一局并正常演剧情（不崩、不卡死）', () => {
  for (const name of Object.keys(STRATEGIES)) {
    const game = createGame({ name: '策略', seed: `story-${name}` });
    const strategy = getStrategy(name);
    let guard = 0;
    while (game.status === 'playing' && guard < 400) {
      guard += 1;
      playWeek(game, strategy);
    }
    assert.notEqual(game.status, 'playing', `${name} 没有跑完`);
    assert.ok(game.story.length > 0, `${name} 一章剧情都没演到`);
  }
});
