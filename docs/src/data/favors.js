/**
 * 人情账本（v3.7）：把好感度从"只涨不减的数字"变成**会来讨债的债**。
 *
 * 为什么加这个：上一版（考前押卷）解决的是一场考试里的判断，这一版解决的是**关系**。
 * 现在的关系只有单向：数值越高越像背景音——它给你解锁成就、偶尔触发结局，但从来不会
 * 反过来要求你什么。可高中三年最真实的体验恰恰是"欠人情"：你借过同桌一整本笔记、
 * 抄过死党的作业、让老师单独给你讲了一节课、爸妈替你挡了一次家长会。
 * 这些事当场都是好处，**几个月后都要还**。
 *
 * 机制（三条，每条都有测试钉着）：
 *   1. **人情是当场的好处**：接受人情立刻拿到实在的东西（时间 / 心情 / 知识 / 钱），
 *      所以玩家有动机去欠——不欠的人在这个系统里拿不到任何好处，也拿不到任何成就。
 *   2. **账一定有到期日**：接受时排一条因果链（`chainOnly` 事件，到点必弹、概率挤不掉），
 *      到期会来讨：还 / 拖 / 赖三选一，三条路都有可观测的后果。
 *   3. **拖延会滚利息**：拖一次，账升一级、期限缩短、而且还要多掉状态；
 *      赖掉的人会在班上传开（`favorBadName`），后面的人不会再来帮你。
 *
 * 这个文件只有数据与纯函数，不 import 引擎——内容作者按这里的表写事件，
 * 引擎按这里的表结算，两边不会各写一套。
 */

/** 同时欠着几条，开始"人情压着"（每周扣心情）。 */
export const FAVOR_PRESSURE_LIMIT = 2;
/** 每超出一条，每周扣多少心情。 */
export const FAVOR_PRESSURE_MOOD = 0.6;
/** 拖一次账升一级，期限缩短这么多回合（且不低于 2）。 */
export const FAVOR_DELAY_SHORTEN = 2;
/** 赖账累积到几条，就算"在班里没信用了"。 */
export const FAVOR_BAD_NAME_AT = 2;

const round2 = (value) => Math.round(Number(value) * 100) / 100;

/**
 * 人情表。
 *
 * 每条对应两个事件（内容作者写在 src/data/events8.js 里，并在 calendar.js 登记）：
 *   - `offerEvent`：随机池里的一环，某个选项写 `favor: { kind: 'xxx' }` → 欠下这笔账；
 *   - `collectEvent`：`chainOnly: true` 的讨债环，三个选项分别写
 *     `favor: { resolve: 'repay' | 'delay' | 'refuse' }`。
 *
 * `actions` 里的 `stats / npc / money / flags` 全部走引擎现有的效果解释器，
 * 所以内容作者不用碰引擎；这里的数值是"账本"的语义（还多少、拖多重、赖多狠）。
 */
export const FAVORS = [
  {
    id: 'notes',
    icon: '📓',
    title: '借来的笔记',
    npc: 'deskmate',
    offerEvent: 'favor_offer_notes',
    collectEvent: 'favor_collect_notes',
    /** 账期（回合；1 回合 = 半周） */
    delay: 6,
    level: 1,
    benefit: '你把同桌那本记了三年的笔记抱回宿舍抄了两晚，期中前省下不少时间。',
    owe: '帮他整理一份错题清单',
    actions: {
      repay: {
        label: '整理一份错题清单还回去',
        hint: '花两个晚上，把人情还清',
        stats: { fatigue: 6, mood: 2 },
        npc: { deskmate: 8 },
        flags: { favorRepaidNotes: true },
      },
      delay: {
        label: '这周太忙了，下周再说',
        hint: '账会变重，而且他记住了',
        stats: { mood: -3 },
        npc: { deskmate: -5 },
        flags: { favorDelayedNotes: true },
      },
      refuse: {
        label: '就当没这回事',
        hint: '不还了。这事会在班上传开',
        stats: { mood: -4 },
        npc: { deskmate: -14 },
        flags: { favorRefusedNotes: true },
      },
    },
  },
  {
    id: 'homework',
    icon: '📝',
    title: '抄来的作业',
    npc: 'friend',
    offerEvent: 'favor_offer_homework',
    collectEvent: 'favor_collect_homework',
    delay: 5,
    level: 1,
    benefit: '来不及写的数学作业，死党把本子推过来一半。你抄完还多睡了半小时。',
    owe: '替他顶一次早读的值日',
    actions: {
      repay: {
        label: '周一早读替他值日',
        hint: '早起半小时，把事情了了',
        stats: { fatigue: 8, discipline: 2 },
        npc: { friend: 7 },
        flags: { favorRepaidHomework: true },
      },
      delay: {
        label: '拖一拖，他应该会忘',
        hint: '他不会忘，而且话会变难听',
        stats: { mood: -3 },
        npc: { friend: -5 },
        flags: { favorDelayedHomework: true },
      },
      refuse: {
        label: '抄都抄了，还什么还',
        hint: '赖掉这笔，传得比作业本快',
        stats: { mood: -4 },
        npc: { friend: -13 },
        flags: { favorRefusedHomework: true },
      },
    },
  },
  {
    id: 'meal',
    icon: '🍜',
    title: '垫上的饭钱',
    npc: 'friend',
    offerEvent: 'favor_offer_meal',
    collectEvent: 'favor_collect_meal',
    delay: 4,
    level: 1,
    benefit: '饭卡没钱那天，是死党替你刷的。后来他又顺手多刷了两瓶水。',
    owe: '把饭钱还上',
    actions: {
      repay: {
        label: '连本带利还回去',
        hint: '花点钱，别让小事变大',
        money: -60,
        stats: { mood: 3 },
        npc: { friend: 7 },
        flags: { favorRepaidMeal: true },
      },
      delay: {
        label: '下次一起吃饭再说',
        hint: '钱不多，但他开始记账了',
        stats: { mood: -2 },
        npc: { friend: -4 },
        flags: { favorDelayedMeal: true },
      },
      refuse: {
        label: '几十块钱而已',
        hint: '小事不还，最伤交情',
        stats: { mood: -3 },
        npc: { friend: -12 },
        flags: { favorRefusedMeal: true },
      },
    },
  },
  {
    id: 'tutoring',
    icon: '🧮',
    title: '单独讲的一节课',
    npc: 'math',
    offerEvent: 'favor_offer_tutoring',
    collectEvent: 'favor_collect_tutoring',
    delay: 7,
    level: 2,
    benefit: '数学老师把你留下讲了四十分钟压轴题，办公室的灯比教室熄得晚。',
    owe: '帮老师把这一届的卷子搬去档案室',
    actions: {
      repay: {
        label: '留下来把卷子搬完',
        hint: '累一点，但老师会记得你懂事',
        stats: { fatigue: 10, teacherFavor: 5 },
        npc: { math: 9 },
        flags: { favorRepaidTutoring: true },
      },
      delay: {
        label: '跟老师说过两天',
        hint: '老师嘴上说好，心里有数',
        stats: { mood: -3, teacherFavor: -2 },
        npc: { math: -6 },
        flags: { favorDelayedTutoring: true },
      },
      refuse: {
        label: '装作忘了',
        hint: '办公室里的事，传得最快',
        stats: { mood: -4, teacherFavor: -4 },
        npc: { math: -15 },
        flags: { favorRefusedTutoring: true },
      },
    },
  },
  {
    id: 'rival_paper',
    icon: '📄',
    title: '错题本上的字',
    npc: 'rival',
    offerEvent: 'favor_offer_rival_paper',
    collectEvent: 'favor_collect_rival_paper',
    delay: 6,
    level: 2,
    benefit: '红榜上跟你咬得最紧的那个人，把自己的错题本推过来一半。你们都清楚这意味着什么。',
    owe: '下次他月考前，把你的物理笔记给他过一遍',
    actions: {
      repay: {
        label: '把物理笔记摊开讲一遍',
        hint: '把对手喂强一点，也把自己讲明白',
        stats: { fatigue: 6, comprehensive: 2 },
        npc: { rival: 10 },
        flags: { favorRepaidRival: true },
      },
      delay: {
        label: '他成绩已经够好了',
        hint: '这份人情，比你想要的更重',
        stats: { mood: -3 },
        npc: { rival: -6 },
        flags: { favorDelayedRival: true },
      },
      refuse: {
        label: '这本错题本来就是我先看到的',
        hint: '你们从对手变回陌生人',
        stats: { mood: -5 },
        npc: { rival: -16 },
        flags: { favorRefusedRival: true },
      },
    },
  },
  {
    id: 'parents_cover',
    icon: '🏠',
    title: '替你挡下的那次家长会',
    npc: 'parents',
    offerEvent: 'favor_offer_parents_cover',
    collectEvent: 'favor_collect_parents_cover',
    delay: 5,
    level: 2,
    benefit: '家长会那天你成绩不好，爸妈在老师面前替你说了不少话。回家只煮了面，一句没提。',
    owe: '周末回家吃顿饭，把实话说了',
    actions: {
      repay: {
        label: '周末回家，把话说清楚',
        hint: '比考高分更让他们安心（会有点累）',
        stats: { fatigue: 3, mood: 2 },
        npc: { parents: 10 },
        flags: { favorRepaidParents: true },
      },
      delay: {
        label: '等考好了再说',
        hint: '他们没催，但那碗面凉了',
        stats: { mood: -3 },
        npc: { parents: -5 },
        flags: { favorDelayedParents: true },
      },
      refuse: {
        label: '回家就关上门',
        hint: '家里的人也会寒心',
        stats: { mood: -4 },
        npc: { parents: -14 },
        flags: { favorRefusedParents: true },
      },
    },
  },
];

export const FAVOR_MAP = Object.fromEntries(FAVORS.map((favor) => [favor.id, favor]));

/** 按事件 id 反查这条人情（内容作者写错 id 时测试会当场抓住）。 */
export const FAVOR_BY_OFFER = Object.fromEntries(FAVORS.map((favor) => [favor.offerEvent, favor]));
export const FAVOR_BY_COLLECT = Object.fromEntries(FAVORS.map((favor) => [favor.collectEvent, favor]));

/** 认得的三种处理方式。 */
export const FAVOR_ACTIONS = ['repay', 'delay', 'refuse'];

export function favorOf(id) {
  return FAVOR_MAP[id] ?? null;
}

/**
 * 账期换算：还差几周（回合 → 周，向上取整，0 表示这周就到）。
 * 界面直接用它显示"还有几周"，别让前端自己算。
 */
export function weeksLeftOf(favor, turn) {
  const turns = Math.max(0, (favor?.dueTurn ?? 0) - (Number(turn) || 0));
  return Math.ceil(turns / 2);
}

/**
 * 人情压力：同时欠着超过 FAVOR_PRESSURE_LIMIT 条时，每周扣的心情总和。
 * 这是"账本"对玩法的真正约束——你可以一直欠，但心里会一直压着。
 */
export function favorPressure(openCount) {
  const count = Math.max(0, Number(openCount) || 0);
  const over = Math.max(0, count - FAVOR_PRESSURE_LIMIT);
  return { count, limit: FAVOR_PRESSURE_LIMIT, over, moodPerWeek: round2(over * FAVOR_PRESSURE_MOOD) };
}

/**
 * 拖一次之后的账：升一级、期限缩短、但仍然是一笔"欠着"的账。
 * 返回给引擎排新链用的参数（纯函数，方便单独测）。
 */
export function delayFavor(favor) {
  const meta = FAVOR_MAP[favor?.kind];
  if (!meta) return null;
  return {
    level: Math.min(3, (Number(favor.level) || 1) + 1),
    delay: Math.max(2, (Number(meta.delay) || 4) - FAVOR_DELAY_SHORTEN),
  };
}

/**
 * 人情自带的成就（内容文件声明 flag，引擎按 flag 捡——和 events5/6/7 一个写法）。
 * 这些 flag **不会**进 CHOICE_MEMORIES（周目继承）：欠债不继承，
 * 下一局的开局不该替上一局还钱。
 */
export const FAVOR_ACHIEVEMENTS = [
  { flag: 'favorRepaidOnce', icon: '🧾', name: '有借有还', desc: '第一次把欠下的人情还上' },
  { flag: 'favorRepaidMany', icon: '🏅', name: '人情簿记员', desc: '一局里还清了四笔人情' },
  { flag: 'favorRefusedOnce', icon: '🐍', name: '赖账的人', desc: '有一笔人情，你选择了不还' },
  { flag: 'favorBadName', icon: '🗣️', name: '在班里没信用了', desc: '赖掉两笔以上，后来没人愿意再帮你' },
  { flag: 'favorBigDebt', icon: '💣', name: '债主上门', desc: '同时欠着四条以上人情' },
  { flag: 'favorClean', icon: '🕊️', name: '万事不求人', desc: '一局下来一条人情都没欠过' },
];
