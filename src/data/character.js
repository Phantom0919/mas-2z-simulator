/**
 * 角色构筑数据：选科方向、天赋、家庭背景、高考目标、人际关系。
 *
 * 所有 mods 字段都是"叠加式修饰量"，默认 0，含义见 emptyMods() 的注释。
 */

/** 修饰器默认值。 */
export function emptyMods() {
  return {
    study: 0, // 学习收益 +x
    physique: 0, // 体质正收益 +x
    social: 0, // 社交正收益 +x
    comprehensive: 0, // 综合素质正收益 +x
    moodDrain: 0, // 心情负收益 -x（0.5 = 只掉一半）
    fatigueGain: 0, // 疲劳正收益 -x
    rest: 0, // 休息 / 恢复效果 +x
    weeklyRecovery: 0, // 每周额外恢复疲劳（绝对值）
    weeklyMood: 0, // 每周额外心情（绝对值）
    allowance: 0, // 每周生活费 +x 元
    startMoneyMul: 0, // 开局零花钱倍数 +x（2 = ×3）
    startMoney: 0, // 开局零花钱 +x 元
    startKnowledge: 0, // 初始知识 +x
    startMood: 0, // 初始心情 +x
    startPhysique: 0, // 初始体质 +x（缺陷"从小体弱"用它压底子）
    startSocial: 0, // 初始社交 +x
    startComprehensive: 0, // 初始综合素质 +x
    intelligence: 0, // 初始智力 +x
    parents: 0, // 初始父母好感 +x
    contest: 0, // 竞赛成功率 +x
    examNoise: 0, // 考试波动 -x（0.4 = 波动只剩 60%）
    decay: 0, // 遗忘速度 -x（0.35 = 忘得只剩 65%，"不进则退"里占便宜）
    luck: 0, // 综合运气
  };
}

/** 把若干份 mods 相加（可以传 null / undefined）。 */
export function sumMods(...lists) {
  const total = emptyMods();
  for (const list of lists) {
    if (!list) continue;
    for (const [key, value] of Object.entries(list)) {
      if (typeof value === 'number' && key in total) total[key] += value;
    }
  }
  return total;
}

/** 高考选科方向：3+1+2 里的那个"1"。 */
export const TRACKS = [
  {
    id: 'physics',
    name: '物理类',
    icon: '🧲',
    primary: 'physics',
    desc: '专业覆盖面最广，物理更难但性价比高，二中主流选择',
  },
  {
    id: 'history',
    name: '历史类',
    icon: '📜',
    primary: 'history',
    desc: '背诵量更大，但适合记忆力和表达强的学生',
  },
];

/** 天赋：开局选 2 个。 */
export const TRAITS = [
  { id: 'memory', name: '过目不忘', icon: '📚', desc: '学习收益 +15%，而且忘得慢（遗忘 -40%）', mods: { study: 0.15, decay: 0.4 } },
  { id: 'athletic', name: '运动天赋', icon: '🏀', desc: '体质收益 +35%，更容易走体育路线', mods: { physique: 0.35 } },
  { id: 'easygoing', name: '心大', icon: '🧘', desc: '心情消耗减半', mods: { moodDrain: 0.5 } },
  { id: 'nightowl', name: '夜猫子', icon: '🌙', desc: '疲劳增长 -35%', mods: { fatigueGain: 0.35 } },
  { id: 'wealthy', name: '家境优渥', icon: '💰', desc: '开局零花钱 ×3，每周生活费 +60', mods: { startMoneyMul: 2, allowance: 60 } },
  { id: 'artist', name: '文艺细胞', icon: '🎤', desc: '综合素质收益 +60%', mods: { comprehensive: 0.6 } },
  { id: 'socialite', name: '社牛', icon: '🗣️', desc: '社交收益 +40%', mods: { social: 0.4 } },
  { id: 'olympiad', name: '竞赛苗子', icon: '🧮', desc: '初始智力 +12，竞赛成功率 +12%', mods: { intelligence: 12, contest: 0.12 } },
  { id: 'recover', name: '恢复力强', icon: '😴', desc: '睡觉效果 +60%，每周多恢复 3 点疲劳', mods: { rest: 0.6, weeklyRecovery: 3 } },
  { id: 'lucky', name: '运气不错', icon: '🍀', desc: '考试波动 -40%，事件更容易走运', mods: { examNoise: 0.4, luck: 1 } },
  { id: 'diligent', name: '坐得住', icon: '🪑', desc: '知识更抗忘（遗忘 -25%），但社交收益 -20%', mods: { decay: 0.25, social: -0.2 } },
];

/** 家庭背景：开局选 1 个。 */
export const BACKGROUNDS = [
  { id: 'worker', name: '普通工薪家庭', icon: '🏠', desc: '平平无奇，但心态稳：心情 +6', mods: { startMood: 6 } },
  { id: 'magang', name: '马钢职工子弟', icon: '🏭', desc: '零花钱 +300，父母关系 +10', mods: { startMoney: 300, parents: 10 } },
  { id: 'town', name: '周边乡镇考来的', icon: '🌾', desc: '初始知识 +6、学习 +5%，零花钱 -200', mods: { startKnowledge: 6, study: 0.05, startMoney: -200 } },
  { id: 'business', name: '做生意的家庭', icon: '🏢', desc: '零花钱 +600，但父母陪得少：父母关系 -15', mods: { startMoney: 600, parents: -15 } },
];

/** 高考目标：开局选 1 个，结局时判定是否达成。 */
export const GOALS = [
  {
    id: 'top2',
    name: '冲刺清北',
    icon: '👑',
    desc: '高考 696 分以上（或竞赛保送）',
    check: (game, ending) => ending.id === 'baosong' || (ending.total ?? 0) >= 696,
  },
  {
    id: 'c985',
    name: '考上 985',
    icon: '🎓',
    desc: '高考 636 分以上，强基 / 保送也算',
    check: (game, ending) => (ending.total ?? 0) >= 636 || ['baosong', 'qiangji'].includes(ending.id),
  },
  {
    id: 'yiben',
    name: '稳上一本',
    icon: '📗',
    desc: '高考 552 分以上',
    check: (game, ending) => (ending.total ?? 0) >= 552,
  },
  {
    id: 'baosong',
    name: '竞赛保送',
    icon: '🏅',
    desc: '在竞赛线打到国家集训队(没有信息TvT)',
    check: (game, ending) => ending.id === 'baosong',
  },
  {
    id: 'special',
    name: '走特长路线',
    icon: '🎨',
    desc: '体育特招 / 艺考综评 / 出国',
    check: (game, ending) => ['sports', 'art', 'abroad'].includes(ending.id),
  },
  {
    id: 'happy',
    name: '快乐毕业',
    icon: '😄',
    desc: '结束时心情 ≥75、违纪 <40，且没有崩溃',
    check: (game, ending) => !['expelled', 'depressed', 'hospital'].includes(ending.id) && game.stats.mood >= 75 && game.stats.discipline < 40,
  },
  {
    id: 'love',
    name: '和 TA 走到毕业',
    icon: '💗',
    desc: '恋爱线撑到高考那一天',
    check: (game) => game.flags.earlyLove === true,
  },
  {
    id: 'money',
    name: '攒够第一桶金',
    icon: '💰',
    desc: '毕业时手里有 3000 元',
    check: (game) => game.stats.money >= 3000,
  },
  {
    id: 'alive',
    name: '完整读完三年',
    icon: '🎒',
    desc: '没有提前退学或休学（最简单的目标）',
    check: (game, ending) => !['expelled', 'depressed', 'hospital'].includes(ending.id),
  },
];

/**
 * 人际关系：七个好感度键。
 *
 * 名字不再写死——具体是谁由 data/cast.js 按种子随机生成（game.cast），
 * 这里只保留"角色定位"，作为显示名的兜底。
 * 键的顺序决定了界面上的排列顺序，也是关系树里"同学"那一组的顺序。
 */
export const NPCS = [
  { key: 'head', role: '班主任', name: '班主任', icon: '👩‍🏫', desc: '推荐名额与违纪处理，都看她的态度' },
  { key: 'math', role: '数学老师', name: '数学老师', icon: '🧮', desc: '答疑、竞赛推荐，好感高了会单独给你开小灶' },
  { key: 'deskmate', role: '同桌', name: '同桌', icon: '🧑', desc: '一起自习互相打气的朋友，好感 70 以上有友情结局线' },
  { key: 'friend', role: '死党', name: '死党', icon: '🧢', desc: '敢在你想翘课的时候拉你一把，也敢拉你下水的那个人' },
  { key: 'rival', role: '老对手', name: '老对手', icon: '⚔️', desc: '红榜上和你咬得最紧的那个人，好感高了会互相借笔记' },
  { key: 'parents', role: '爸爸妈妈', name: '爸爸妈妈', icon: '🏠', desc: '好感高会多给零花钱、多包容；低于 30 会天天吵架' },
  { key: 'love', role: '心动对象', name: '心里的那个人', icon: '💗', desc: '好感 35 以上可以表白' },
];

export const NPC_KEYS = NPCS.map((npc) => npc.key);
export const NPC_MAP = Object.fromEntries(NPCS.map((npc) => [npc.key, npc]));

export const TRAIT_MAP = Object.fromEntries(TRAITS.map((trait) => [trait.id, trait]));
export const BACKGROUND_MAP = Object.fromEntries(BACKGROUNDS.map((item) => [item.id, item]));
export const GOAL_MAP = Object.fromEntries(GOALS.map((goal) => [goal.id, goal]));
export const TRACK_MAP = Object.fromEntries(TRACKS.map((track) => [track.id, track]));

/* ==================================================================== 自定义人物 */

/**
 * 头像：纯装饰，出现在顶栏、日志和关系图里。
 * 故意做得"不像证件照"——高中生在游戏里挑头像，本来就是挑个乐子。
 */
export const AVATARS = [
  { id: 'student', icon: '🧑', name: '普通同学' },
  { id: 'boy', icon: '👦', name: '男生' },
  { id: 'girl', icon: '👧', name: '女生' },
  { id: 'glasses', icon: '🤓', name: '眼镜仔' },
  { id: 'cool', icon: '😎', name: '装酷的' },
  { id: 'sleepy', icon: '😴', name: '没睡醒' },
  { id: 'panda', icon: '🐼', name: '熊猫' },
  { id: 'cat', icon: '🐱', name: '猫' },
  { id: 'fox', icon: '🦊', name: '狐狸' },
  { id: 'penguin', icon: '🐧', name: '企鹅' },
  { id: 'rocket', icon: '🚀', name: '火箭' },
  { id: 'book', icon: '📚', name: '书的化身' },
  { id: 'crown', icon: '👑', name: '自封第一' },
  { id: 'ghost', icon: '👻', name: '幽灵' },
];

/** 随机外号池（用的时候可以自己改，也可以留空随机一个）。 */
export const NICKNAMES = [
  '根号三', '老王', '小马', '闪电', '活字典', '阿哲', '土豆', '面点王', '睡神',
  '卷帘大将', '马钢小王', '三点一线', '数学课代表', '雨山湖一哥', '采石矶诗仙',
  '大聪明', '人间清醒', '干饭人', '时间管理大师', '自习室雕像', '错题本收藏家',
  '笔芯杀手', '饮水机管理员', '广播站之友', '红榜钉子户', '操场幽灵',
];

/**
 * 性格：开局选 **1** 个，和"天赋选 2 个"分开。
 *
 * 天赋给的是能力，性格给的是"这个人的脾气"——所以性格可以带负面，
 * 而且数值比天赋更极端（比如"锋芒"是典型的高收益高消耗）。
 */
export const PERSONALITIES = [
  { id: 'plain', name: '平常心', icon: '😐', desc: '不加成也不吃亏——"我就是个普通高中生"', mods: {} },
  { id: 'sunny', name: '阳光', icon: '☀️', desc: '心情消耗 -25%，社交收益 +20%', mods: { moodDrain: 0.25, social: 0.2 } },
  { id: 'calm', name: '沉稳', icon: '🌊', desc: '考试波动 -30%，学习 +4%，社交 -10%', mods: { examNoise: 0.3, study: 0.04, social: -0.1 } },
  { id: 'sharp', name: '锋芒', icon: '⚡', desc: '学习 +12%，但心情消耗 +30%', mods: { study: 0.12, moodDrain: -0.3 } },
  { id: 'lazy', name: '慵懒', icon: '🛋️', desc: '疲劳增长 -40%，学习 -8%', mods: { fatigueGain: 0.4, study: -0.08 } },
  { id: 'sensitive', name: '敏感', icon: '🌧️', desc: '综合素质 +45%，心情消耗 +20%', mods: { comprehensive: 0.45, moodDrain: -0.2 } },
  { id: 'tough', name: '硬气', icon: '🛡️', desc: '体质收益 +30%，每周多恢复 2 点疲劳，社交 -10%', mods: { physique: 0.3, weeklyRecovery: 2, social: -0.1 } },
];

/**
 * 缺陷：开局最多选 **1** 个，用负面换属性点。
 *
 * 这是"自定义人物"里最像 roguelite 的一环：想多要点属性点，就得先认下一个短板。
 */
export const FLAWS = [
  { id: 'myopia', name: '近视六百度', icon: '👓', desc: '社交收益 -15% → +4 点属性点', points: 4, mods: { social: -0.15 } },
  { id: 'poor', name: '零花钱很少', icon: '🪙', desc: '开局零花钱 -250 元 → +4 点属性点', points: 4, mods: { startMoney: -250 } },
  { id: 'light_sleep', name: '睡眠浅', icon: '🌚', desc: '每周少恢复 2 点疲劳 → +4 点属性点', points: 4, mods: { weeklyRecovery: -2 } },
  { id: 'frail', name: '从小体弱', icon: '🩹', desc: '初始体质 -10 → +6 点属性点', points: 6, mods: { startPhysique: -10 } },
  { id: 'slow_start', name: '开窍晚', icon: '🐢', desc: '学习 -10%，而且忘得更快（遗忘 +20%）→ +6 点属性点', points: 6, mods: { study: -0.1, decay: -0.2 } },
];

/**
 * 属性点：自定义人物的核心。
 *
 * 每 1 点可以换 `per` 点属性（或 `per` 分单科底子），`max` 是单项上限。
 * 每档难度的预算见 POINT_BUDGET —— 难度越高，能自由分配的点越少。
 * `perSubject: true` 的项要求玩家指定科目，写在 `points.subjects` 里。
 */
export const POINT_BUY = [
  { key: 'intelligence', name: '智力', icon: '🧠', per: 1, max: 12, desc: '直接影响学同样时间能涨多少分' },
  { key: 'physique', name: '体质', icon: '💪', per: 2, max: 12, desc: '抗熬夜、抗生病；低于 35 会触发意外结局' },
  { key: 'mood', name: '心情', icon: '🙂', per: 3, max: 8, desc: '心情好效率高，归零就休学' },
  { key: 'social', name: '社交', icon: '🗣️', per: 3, max: 10, desc: '和同学、老师打交道的基础' },
  { key: 'comprehensive', name: '综合素质', icon: '🎨', per: 3, max: 10, desc: '综评、艺考、传媒路线的门票' },
  { key: 'knowledge', name: '单科底子', icon: '📖', per: 4, max: 3, perSubject: true, desc: '给某一门课开局加 4 分（每科最多投 3 点）' },
  { key: 'money', name: '零花钱', icon: '💵', per: 200, max: 3, desc: '每点 +200 元开局零花钱' },
];

/**
 * 属性点预算。
 *
 * 正常 12 点大致等于"一项拉满，或者两项各一半"；难度越高给得越少，
 * 真实（地狱开局）只给 7 点，逼你在偏科的局面里做减法。
 */
export const POINT_BUDGET = {
  easy: 16,
  normal: 12,
  hard: 9,
  realistic: 7,
  custom: 12,
};

/**
 * 多周目"传承点"：玩过的局数越多，新一局能多分几点。
 * 引擎只认 `legacyPoints` 这个数字，怎么算由前端决定。
 */
export const LEGACY = {
  /** 每玩满这么多局，多 1 点传承点。 */
  runsPerPoint: 2,
  max: 6,
};

/**
 * 一键角色模板。
 *
 * 只负责"人"（性格 / 天赋 / 缺陷 / 背景 / 目标 / 属性点），
 * 选科留给玩家自己点——模板不该替玩家决定考什么。
 * `points.subjects` 里的科目如果不在当前选科里，前端会丢掉。
 */
export const CHARACTER_PRESETS = [
  {
    id: 'xueba',
    name: '卷王',
    icon: '📚',
    avatar: 'glasses',
    desc: '智力与数学物理底子拉满，代价是心情',
    personality: 'sharp',
    flaw: null,
    background: 'worker',
    goal: 'c985',
    traits: ['memory', 'diligent'],
    points: { intelligence: 6, mood: 2, subjects: { math: 2, physics: 2 } },
  },
  {
    id: 'athlete',
    name: '体育生',
    icon: '🏀',
    avatar: 'cool',
    desc: '体质极高，走体育单招那条路',
    personality: 'tough',
    flaw: null,
    background: 'magang',
    goal: 'special',
    traits: ['athletic', 'nightowl'],
    points: { physique: 6, mood: 3, social: 3 },
  },
  {
    id: 'artist',
    name: '文艺青年',
    icon: '🎨',
    avatar: 'girl',
    desc: '综合素质拉满，艺考 / 传媒 / 综评三选一',
    personality: 'sensitive',
    flaw: null,
    background: 'business',
    goal: 'special',
    traits: ['artist', 'socialite'],
    points: { comprehensive: 5, social: 4, mood: 3 },
  },
  {
    id: 'social',
    name: '社牛',
    icon: '🗣️',
    avatar: 'boy',
    desc: '人缘就是资源，钱也是资源',
    personality: 'sunny',
    flaw: null,
    background: 'business',
    goal: 'money',
    traits: ['socialite', 'wealthy'],
    points: { social: 6, mood: 4, money: 2 },
  },
  {
    id: 'olympiad',
    name: '竞赛生',
    icon: '🧮',
    avatar: 'panda',
    desc: '智力和理科单科底子极高，冲竞赛保送',
    personality: 'calm',
    flaw: null,
    background: 'worker',
    goal: 'baosong',
    traits: ['olympiad', 'memory'],
    points: { intelligence: 8, subjects: { math: 3, physics: 1 } },
  },
  {
    id: 'lying',
    name: '躺平',
    icon: '🛋️',
    avatar: 'sleepy',
    desc: '不为分数活，只为"快乐毕业"这个目标活',
    personality: 'lazy',
    flaw: null,
    background: 'worker',
    goal: 'happy',
    traits: ['easygoing', 'recover'],
    points: { mood: 6, physique: 4, money: 2 },
  },
  {
    id: 'lopsided',
    name: '偏科怪才',
    icon: '🎭',
    avatar: 'fox',
    desc: '三科顶尖、三科稀烂，教学楼的走廊为你分裂',
    personality: 'sharp',
    flaw: null,
    background: 'town',
    goal: 'yiben',
    traits: ['olympiad', 'artist'],
    points: { subjects: { math: 3, physics: 3, chinese: 3 }, mood: 3 },
  },
  {
    id: 'balanced',
    name: '均衡派',
    icon: '⚖️',
    avatar: 'student',
    desc: '什么都不突出，但什么都不缺',
    personality: 'calm',
    flaw: null,
    background: 'worker',
    goal: 'yiben',
    traits: ['lucky', 'recover'],
    points: { mood: 3, physique: 3, social: 3, comprehensive: 3 },
  },
  {
    id: 'debtor',
    name: '梭哈怪',
    icon: '🎯',
    avatar: 'rocket',
    desc: '认下一个短板换一堆属性点，要么封神要么崩盘',
    personality: 'sharp',
    flaw: 'frail',
    background: 'town',
    goal: 'c985',
    traits: ['olympiad', 'memory'],
    points: { intelligence: 10, subjects: { math: 3, physics: 3 } },
  },
];

export const AVATAR_MAP = Object.fromEntries(AVATARS.map((item) => [item.id, item]));
export const PERSONALITY_MAP = Object.fromEntries(PERSONALITIES.map((item) => [item.id, item]));
export const FLAW_MAP = Object.fromEntries(FLAWS.map((item) => [item.id, item]));
export const POINT_BUY_MAP = Object.fromEntries(POINT_BUY.map((item) => [item.key, item]));
export const PRESET_MAP = Object.fromEntries(CHARACTER_PRESETS.map((item) => [item.id, item]));
