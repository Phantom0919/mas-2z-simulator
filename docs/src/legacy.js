/**
 * 周目继承（v3.5）：上一局的**选择**会长成这一局的起点。
 *
 * 为什么不按结局给：结局只是一个分数档位（985 / 专科 / 电竞…），
 * 按它继承等于"上次考得好，这次白送加成"——玩家没有选择空间，也没有故事。
 * 这里按**选择**（引擎里写在 game.flags 上的那一个个决定）来继承：
 * 你上次帮老师改过卷子，这次开学老师就认得你；上次手机被收过，这次你会更小心；
 * 上次认真写完了同学录，这次你心里有底。同一个结局，完全可以继承出不同的开局。
 *
 * 三条来源，优先级从高到低：
 *   1. **选择**（CHOICE_MEMORIES）：由 flags 决定，最多带 3 条；
 *   2. **积累**（THRESHOLD_MEMORIES）：成就数 / 图鉴解锁数够多时各给一条；
 *   3. **兜底**（ENDING_MEMORIES）：只有"一条选择都没有"时才按结局给一条——
 *      这种情况只会出现在刚装游戏、刚清存档的第一局之后。
 *
 * 边界：
 *   - 全部走**白名单**：引擎只认这张表里的记忆 id，前端/服务端传别的 id 一律忽略，
 *     所以继承不可能被拿来当"注入任意属性"的后门（有测试钉着）；
 *   - 数字都很小（单项 ≤ 6 点知识 / ≤ 8 点状态），它是"起点略有不同"，不是"开了挂"；
 *   - 纯数据 + 纯函数，不 import 引擎，能单独测。
 */

export const MEMORY_LIMIT = 3;
export const INHERIT_FORMAT = 1;

/**
 * 选择记忆表：flag 来自内容文件（events*.js / 因果链 / 剧情）。
 * 改动这里之后一定要跑 `node --test test/legacy.test.js`——
 * 里面有"每个 flag 都必须真的会被某个内容文件写出来"的检查，防手滑写错名字。
 */
export const CHOICE_MEMORIES = [
  {
    id: 'grader_trusted',
    flag: 'graderTrusted',
    icon: '🧑‍🏫',
    name: '老师的小助手',
    desc: '上次你帮着改过一摞卷子，这学期老师认得你',
    effects: { knowledge: { math: 5 }, stats: { teacherFavor: 8 } },
  },
  {
    id: 'class_album',
    flag: 'classAlbumSigned',
    icon: '📖',
    name: '写过同学录的人',
    desc: '上次你认真写完了那本同学录，这次你更早开始珍惜',
    effects: { stats: { mood: 6, social: 4 } },
  },
  {
    id: 'relay_anchor',
    flag: 'relayAnchor',
    icon: '🏃',
    name: '跑过第四棒',
    desc: '上次你在跑道上接过棒，这次开学没人敢小看你',
    effects: { stats: { physique: 6, social: 5 } },
  },
  {
    id: 'window_swap',
    flag: 'windowSwap',
    icon: '❄️',
    name: '换过座位的人',
    desc: '上次你为了别人换了一周座位，你学会了怎么跟人打交道',
    effects: { stats: { social: 6, mood: 3 } },
  },
  {
    id: 'phone_seized',
    flag: 'phoneSeized',
    icon: '📱',
    name: '手机被收过一次',
    desc: '上次那个牛皮纸信封你记到现在，这次你会把手机放远点',
    effects: { stats: { discipline: 8, mood: -2 } },
  },
  {
    id: 'review_writer',
    flag: 'reviewWriter',
    icon: '✍️',
    name: '写过三千字检讨',
    desc: '上次你把检讨写成了一篇文章，你发现写字也能当武器',
    effects: { knowledge: { chinese: 6 }, stats: { discipline: 4 } },
  },
  {
    id: 'window_cold',
    flag: 'winterCold',
    icon: '🤒',
    name: '吹风感冒过',
    desc: '上次那场感冒让你学会了别硬撑，这次你一冷就加衣服',
    effects: { stats: { physique: 7, fatigue: -4 } },
  },
  {
    id: 'relay_injury',
    flag: 'relayInjury',
    icon: '🩹',
    name: '拉伤过的腿',
    desc: '上次最后三十米你摔在跑道上，这次你学会了先热身',
    effects: { stats: { physique: 4, discipline: 3 } },
  },
  {
    id: 'meet_studied',
    flag: 'meetStudied',
    icon: '📚',
    name: '运动会做卷子的人',
    desc: '上次全班在看比赛，你在教室刷完了一整套卷子',
    effects: { knowledge: { all: 3 }, stats: { social: -3 } },
  },
  {
    id: 'canteen_cutter',
    flag: 'canteenCutter',
    icon: '🍜',
    name: '插过队的人',
    desc: '上次你插队插得挺顺，但你知道后面有人记住了你',
    effects: { stats: { social: -2, mood: 2, discipline: -3 } },
  },
  {
    id: 'peeking_score',
    flag: 'peekingScore',
    icon: '👀',
    name: '偷看过分数的人',
    desc: '上次你翻了那张卷子，从此你知道分数没那么可怕，也没那么重要',
    effects: { stats: { mood: 4, comprehensive: 3 } },
  },
  {
    id: 'told_truth',
    flag: 'toldTruth',
    icon: '🗣️',
    name: '跟家里说过实话',
    desc: '上次你把名次原原本本说出来了，这次爸妈更愿意信你',
    effects: { stats: { mood: 4 }, npc: { parents: 10 } },
  },
  {
    id: 'hid_score_busted',
    flag: 'hidScoreBusted',
    icon: '📄',
    name: '报喜不报忧过',
    desc: '上次成绩条还是被看见了，这次你不想再演一遍',
    effects: { stats: { mood: -2, comprehensive: 3 }, npc: { parents: 4 } },
  },
  {
    id: 'seat_picked_weak',
    flag: 'seatPickedWeak',
    icon: '🪑',
    name: '坐过差生旁边',
    desc: '上次你把名字写在成绩靠后的同学旁边，你比同龄人多懂一点事',
    effects: { stats: { comprehensive: 5, social: 3 } },
  },
  {
    id: 'broadcast_star',
    flag: 'broadcastStar',
    icon: '📻',
    name: '上过广播的人',
    desc: '上次午休的那首歌是三栋楼一起哼的',
    effects: { stats: { mood: 5, social: 5 } },
  },
  {
    id: 'desk_carving',
    flag: 'deskCarving',
    icon: '✏️',
    name: '刻过字的人',
    desc: '上次你把自己的名字刻进了课桌，这次你抬头看了眼前面',
    effects: { stats: { mood: 3, comprehensive: 3 } },
  },
];

/** 积累记忆：跟"你打了多久"有关，跟具体哪一局无关。 */
export const THRESHOLD_MEMORIES = [
  {
    id: 'legend',
    icon: '🏅',
    name: '传说',
    desc: '成就拿了 20 个以上，开学第一天就有人在走廊里念你的名字',
    when: (profile) => (profile.achievementCount ?? 0) >= 20,
    effects: { stats: { social: 6, teacherFavor: 4, mood: 4 } },
  },
  {
    id: 'veteran',
    icon: '🎒',
    name: '过来人',
    desc: '结局图鉴解锁了 10 个以上，你已经知道这三年会有哪些坑',
    when: (profile) => Object.keys(profile.unlocked ?? {}).length >= 10,
    effects: { knowledge: { all: 3 } },
  },
  {
    id: 'repeat',
    icon: '🔁',
    name: '又来了',
    desc: '这已经是第 2 周目以后了，你对这套节奏熟得不能再熟',
    when: (profile) => (profile.runs ?? 0) >= 2,
    effects: { stats: { fatigue: -5, discipline: 3 } },
  },
];

/** 兜底：一条选择记忆都没有时，按上一局的结局给一条（只有新手第一局会遇到）。 */
export const ENDING_MEMORIES = [
  { id: 'from_top', ending: ['tsinghua', 'huawu', 'c9', 'top985'], icon: '🎓', name: '学长的笔记', desc: '上一局你考得很好，有一套自己的笔记留了下来', effects: { knowledge: { math: 4, physics: 4 } } },
  { id: 'from_games', ending: ['esports'], icon: '🖥️', name: '网吧熟人', desc: '上一局在网咖泡过很久，那边的人都认识你', effects: { stats: { mood: 6, social: 4, discipline: -4 } } },
  { id: 'from_fail', ending: ['fail', 'dropout', 'vocational'], icon: '🔁', name: '复读的决心', desc: '上一局的结果不好，但你知道自己哪里出了问题', effects: { stats: { discipline: 8, mood: 4 } } },
  { id: 'from_trade', ending: ['startup', 'arts', 'sports', 'media'], icon: '🧰', name: '手里有活', desc: '上一局你走了另一条路，手上攒下了点真本事', effects: { stats: { comprehensive: 6, social: 3 } } },
];

export const MEMORY_MAP = Object.fromEntries(
  [...CHOICE_MEMORIES, ...THRESHOLD_MEMORIES, ...ENDING_MEMORIES].map((memory) => [memory.id, memory]),
);

/** 这一局实际拿到了哪些"选择记忆"（按内容文件写下的 flag）。 */
export function memoryIdsForFlags(flags = {}) {
  return CHOICE_MEMORIES.filter((memory) => flags[memory.flag]).map((memory) => memory.id);
}

/**
 * 从存档档案推导这一局开局该继承什么。
 * @param {object} profile { runs, unlocked, achievementCount, lastRun: { memories: [], endingId } }
 * @returns {{ memories: object[], title: string }}
 */
export function deriveInheritance(profile = {}) {
  const memories = [];
  const seen = new Set();
  const take = (memory) => {
    if (!memory || seen.has(memory.id) || memories.length >= MEMORY_LIMIT) return;
    seen.add(memory.id);
    memories.push(memory);
  };

  // 1. 上一局的选择（按存档里记下的顺序，最多 3 条）
  const earned = Array.isArray(profile.lastRun?.memories) ? profile.lastRun.memories : [];
  for (const id of earned) {
    if (CHOICE_MEMORIES.some((memory) => memory.id === id)) take(MEMORY_MAP[id]);
  }

  // 2. 积累（成就 / 图鉴 / 周目）
  for (const memory of THRESHOLD_MEMORIES) {
    try {
      if (memory.when(profile)) take(memory);
    } catch {
      /* 档案坏了就当这条不成立 */
    }
  }

  // 3. 兜底：一条都没有时按上一局结局给一条
  if (memories.length === 0) {
    const endingId = profile.lastRun?.endingId ? String(profile.lastRun.endingId) : '';
    const fallback = ENDING_MEMORIES.find((memory) => memory.ending.includes(endingId)) ?? ENDING_MEMORIES[3];
    take(fallback);
  }

  return {
    memories,
    title: memories.length > 0 ? memories.map((memory) => `${memory.icon} ${memory.name}`).join(' · ') : '',
  };
}

/**
 * 校验客户端传来的继承请求：**只认 id**，别的字段一律丢掉。
 * 这样前端（或者改过前端的玩家）不可能靠继承往开局里塞任意数值。
 */
export function normalizeInherit(input) {
  if (!input || typeof input !== 'object' || input.enabled === false) return { memoryIds: [] };
  const raw = Array.isArray(input.memoryIds) ? input.memoryIds : [];
  const memoryIds = [];
  for (const id of raw) {
    const key = String(id ?? '');
    if (!MEMORY_MAP[key] || memoryIds.includes(key) || memoryIds.length >= MEMORY_LIMIT) continue;
    memoryIds.push(key);
  }
  return { memoryIds };
}

/**
 * 把继承应用到刚创建的一局上（就地改 game）。
 * 只碰 stats / knowledge / npc / flags——不碰难度、周数、随机种子这些规则性的东西。
 */
export function applyInheritance(game, inherit) {
  const { memoryIds } = normalizeInherit(inherit);
  const applied = [];
  for (const id of memoryIds) {
    const memory = MEMORY_MAP[id];
    if (!memory || !memory.effects) continue;
    const { stats = {}, knowledge = {}, npc = {} } = memory.effects;
    for (const [key, delta] of Object.entries(stats)) {
      if (!(key in game.stats)) continue;
      game.stats[key] = Math.max(0, Math.min(100, (game.stats[key] ?? 0) + delta));
    }
    for (const [key, delta] of Object.entries(knowledge)) {
      if (key === 'all') {
        for (const subject of Object.keys(game.knowledge)) {
          game.knowledge[subject] = Math.max(0, Math.min(150, (game.knowledge[subject] ?? 0) + delta));
        }
        continue;
      }
      if (!(key in game.knowledge)) continue;
      game.knowledge[key] = Math.max(0, Math.min(150, (game.knowledge[key] ?? 0) + delta));
    }
    for (const [key, delta] of Object.entries(npc)) {
      if (!(key in game.npc)) continue;
      game.npc[key] = Math.max(0, Math.min(100, (game.npc[key] ?? 0) + delta));
    }
    game.flags[`inherit_${memory.id}`] = true;
    applied.push(memory.id);
  }
  if (applied.length > 0) {
    game.inherit = { format: INHERIT_FORMAT, memoryIds: applied };
  }
  return applied;
}
