/**
 * 下回预告（v3.4）：每周结算的最后一句"钩子"。
 *
 * 为什么加这个：这游戏是一周一格往前走的，玩家最容易在"这一周结束了"的地方关掉。
 * 光给结算日志（回顾）不够，还得给一句**往前的悬念**——考试、排队等着的因果链、
 * 快要崩的状态、关系的变化。它不改变任何数值，只负责让人想点下一周。
 *
 * 设计上的三条约束：
 *   1. **纯函数**：只吃一个快照（见 engine 里 buildTeaserContext），不 import 引擎，
 *      所以不会和 engine.js 形成循环依赖，也能单独测；
 *   2. **说实话**：预告必须能兑现——只预告真的会发生的事（考试周数、链在几周后到、
 *      状态已经进了危险区），不许为了悬念编造不存在的剧情；
 *   3. **有优先级**：越"紧迫、越具体"的越靠前（临近的考试 > 排队中的链 > 状态危险 >
 *      关系 > 纯氛围），所以同一周永远只有一句，而且是该说的那句。
 */

/** 氛围句：没有更紧迫的事时用，按周数轮换，保证不同周看到的不一样。 */
const AMBIENT = [
  { icon: '📖', text: '明天早读要抽查背诵，你还没背完。' },
  { icon: '🪟', text: '靠窗那个位置的风好像比上周更冷了。' },
  { icon: '🧹', text: '下周轮到你们组值日，倒垃圾的活没人愿意接。' },
  { icon: '🍚', text: '食堂这周的菜谱贴在门口了，周三有你爱吃的。' },
  { icon: '📢', text: '广播站又在征集点歌单，你同桌已经写了三张。' },
  { icon: '🏀', text: '操场那边有人在约球，缺一个人。' },
  { icon: '📚', text: '教辅书店到货了，门口排了半条街。' },
  { icon: '🌧️', text: '天气预报说下周连着下雨，跑操大概要取消。' },
];

/** 高三专属：倒计时的存在感 */
const SENIOR = [
  { icon: '📅', text: '倒计时牌又翻了一页。' },
  { icon: '🕯️', text: '班里的灯走得比别的班晚，保安都认识你们了。' },
  { icon: '📝', text: '又一套模考卷发下来，名字那一栏还没填。' },
];

const examLabel = (exam) => {
  if (!exam) return null;
  const when = exam.inWeeks === 0 ? '就在这一周' : `还有 ${exam.inWeeks} 周`;
  return { icon: '📝', text: `${exam.name}${when}。这周投入多少，会直接写在卷子上。`, tone: 'exam' };
};

/**
 * @param {object} snapshot 由引擎拼好的快照（见 engine 的 buildTeaserContext）
 * @returns {{ icon: string, text: string, tone: string } | null}
 */
export function nextWeekTeaser(snapshot) {
  if (!snapshot || snapshot.status !== 'playing') return null;
  const {
    turn = 0,
    phase = 'main',
    stats = {},
    npc = {},
    flags = {},
    chains = [],
    nextExam = null,
    weeksLeft = null,
    grade = 1,
  } = snapshot;

  // 1. 这一周／下一周就有考试：最具体的钩子
  if (nextExam && (nextExam.inWeeks ?? 99) <= 1) return examLabel(nextExam);

  // 2. 有因果链排着队：上次那个选择还没给结果，明确告诉玩家"还没完"
  const pending = (Array.isArray(chains) ? chains : [])
    .filter((entry) => entry && Number.isFinite(entry.atTurn))
    .sort((a, b) => a.atTurn - b.atTurn)[0];
  if (pending) {
    const inWeeks = Math.max(1, pending.atTurn - turn);
    return {
      icon: '🧵',
      text: `上次那件事还没完——大概还有 ${inWeeks} 周会找上门来。`,
      tone: 'story',
    };
  }

  // 3. 状态已经进了危险区：把"再撑就要出事"提前说出来
  if ((stats.fatigue ?? 0) >= 72) {
    return { icon: '🥱', text: '你连着几周没睡够了。再硬撑，身体会先替你喊停。', tone: 'danger' };
  }
  if ((stats.mood ?? 100) <= 25) {
    return { icon: '🌫️', text: '这个状态下容易出事：一次当众的难堪就可能压垮你。', tone: 'danger' };
  }
  if ((stats.physique ?? 100) <= 30) {
    return { icon: '🤒', text: '你已经很久没动过了，医务室的门就在楼下。', tone: 'danger' };
  }
  if ((stats.discipline ?? 0) >= 70) {
    return { icon: '📋', text: '德育处的老师已经记住你的名字了。', tone: 'danger' };
  }

  // 4. 关系：有人正朝你走过来
  if ((npc.love ?? 0) >= 60 && !flags.loveConfessed) {
    return { icon: '💌', text: '那个人最近看你的眼神有点不对。', tone: 'story' };
  }
  if ((npc.deskmate ?? 0) >= 75) {
    return { icon: '🤝', text: '同桌今天把最后一颗糖放在了你桌上，什么也没说。', tone: 'story' };
  }
  if ((npc.head ?? 0) <= 20) {
    return { icon: '🚪', text: '班主任这周已经找你谈过两次话了。', tone: 'danger' };
  }

  // 5. 高三的倒计时
  if (grade >= 3) {
    if (Number.isFinite(weeksLeft) && weeksLeft <= 6) {
      return { icon: '⏳', text: `离高考只剩 ${weeksLeft} 周。走廊里没人再开玩笑了。`, tone: 'exam' };
    }
    return { ...SENIOR[turn % SENIOR.length], tone: 'calm' };
  }

  // 6. 什么都没发生：给一句氛围，让"下一周"仍然像个片段而不是空转
  const ambient = AMBIENT[(turn + (phase === 'weekend' ? 1 : 0)) % AMBIENT.length];
  return { ...ambient, tone: 'calm' };
}
