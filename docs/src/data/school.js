/**
 * 学校、学科池、学期、排名、大学录取线等静态数据。
 *
 * 学科采用安徽新高考「3+1+2」：
 *   3 门必考：语文 150 + 数学 150 + 英语 150
 *   1 门首选：物理 / 历史（各 100）
 *   2 门再选：化学 / 生物 / 政治 / 地理 里选 2 门（各 100）
 *   总分 750，选科在开学前定，之后还能改一次。
 *
 * 说明：本模拟器中的事件、人物、分数线和结局都是虚构的娱乐内容，
 * 与马鞍山市第二中学及任何真实机构无关。
 */

export const SCHOOL = {
  name: '马鞍山市第二中学',
  short: '马鞍山二中',
  motto: '厚德 · 励学 · 敦行',
  city: '安徽省马鞍山市',
  address: '花山区健康路',
  classOptions: ['高一(3)班', '高一(19)班', '高一(1)班', '高一(13)班'],
  landmarks: [
    '雨山湖公园',
    '采石矶',
    '濮塘风景区',
    '大华国际广场',
    '团结广场',
    '马钢体育馆',
    '佳山公园',
    '滨江公园',
  ],
};

/** 全部九门学科。 */
export const SUBJECT_POOL = [
  { key: 'chinese', name: '语文', short: '语', max: 150, icon: '📕', group: 'core' },
  { key: 'math', name: '数学', short: '数', max: 150, icon: '📐', group: 'core' },
  { key: 'english', name: '英语', short: '英', max: 150, icon: '🔤', group: 'core' },
  { key: 'physics', name: '物理', short: '物', max: 100, icon: '🧲', group: 'primary' },
  { key: 'history', name: '历史', short: '史', max: 100, icon: '📜', group: 'primary' },
  { key: 'chemistry', name: '化学', short: '化', max: 100, icon: '⚗️', group: 'elective' },
  { key: 'biology', name: '生物', short: '生', max: 100, icon: '🧬', group: 'elective' },
  { key: 'politics', name: '政治', short: '政', max: 100, icon: '⚖️', group: 'elective' },
  { key: 'geography', name: '地理', short: '地', max: 100, icon: '🌏', group: 'elective' },
];

export const SUBJECT_MAP = Object.fromEntries(SUBJECT_POOL.map((subject) => [subject.key, subject]));
export const ALL_SUBJECT_KEYS = SUBJECT_POOL.map((subject) => subject.key);

export const CORE_KEYS = ['chinese', 'math', 'english'];
export const PRIMARY_KEYS = ['physics', 'history'];
export const ELECTIVE_KEYS = ['chemistry', 'biology', 'politics', 'geography'];
export const ELECTIVE_PICK = 2;

/** 高考满分：450（必考）+ 300（选考）。 */
export const TOTAL_MAX = 750;

/** 一组合法的选科组合。 */
export function subjectsFor(trackId = 'physics', electives = ['chemistry', 'biology']) {
  const primary = trackId === 'history' ? 'history' : 'physics';
  const pool = ELECTIVE_KEYS.filter((key) => key !== primary);
  const picked = [];
  for (const key of electives) {
    if (pool.includes(key) && !picked.includes(key)) picked.push(key);
  }
  for (const key of pool) {
    if (picked.length >= ELECTIVE_PICK) break;
    if (!picked.includes(key)) picked.push(key);
  }
  const keys = [...CORE_KEYS, primary, ...picked.slice(0, ELECTIVE_PICK)];
  return keys.map((key) => SUBJECT_MAP[key]);
}

/** 校验选科是否合法，返回错误信息或 null。 */
export function validateSelection(trackId, electives = []) {
  if (!['physics', 'history'].includes(trackId)) return '首选科目只能是物理或历史。';
  const unique = [...new Set(electives)];
  if (unique.length !== ELECTIVE_PICK) return `再选科目必须正好选 ${ELECTIVE_PICK} 门。`;
  for (const key of unique) {
    if (!ELECTIVE_KEYS.includes(key)) return `${key} 不是可选的再选科目。`;
  }
  return null;
}

/** 属性表：min/max 是取值区间，better 说明越大越好还是越小越好。 */
export const STAT_META = {
  intelligence: { name: '智力', icon: '🧠', min: 0, max: 100, better: 'high', desc: '影响学习效率与竞赛上限' },
  physique: { name: '体质', icon: '💪', min: 0, max: 100, better: 'high', desc: '影响考场状态与体育特招' },
  mood: { name: '心情', icon: '🙂', min: 0, max: 100, better: 'high', desc: '心情归零会休学' },
  social: { name: '社交', icon: '👥', min: 0, max: 100, better: 'high', desc: '人缘、班干部、恋爱线' },
  teacherFavor: { name: '老师好感', icon: '👩‍🏫', min: 0, max: 100, better: 'high', desc: '全体老师的平均观感' },
  comprehensive: { name: '综合素质', icon: '🌟', min: 0, max: 100, better: 'high', desc: '社团、艺考、强基计划' },
  fatigue: { name: '疲劳', icon: '😪', min: 0, max: 100, better: 'low', desc: '过高会拖垮考试发挥' },
  discipline: { name: '违纪', icon: '🚨', min: 0, max: 150, better: 'low', desc: '达到 120 会被劝退' },
};

export const STAT_KEYS = Object.keys(STAT_META);

export const SEMESTERS = [
  { grade: 1, term: 1, name: '高一上学期' },
  { grade: 1, term: 2, name: '高一下学期' },
  { grade: 2, term: 1, name: '高二上学期' },
  { grade: 2, term: 2, name: '高二下学期' },
  { grade: 3, term: 1, name: '高三上学期' },
  { grade: 3, term: 2, name: '高三下学期' },
];

export const DEFAULT_WEEKS_PER_SEMESTER = 6;

/**
 * 某学期的考试安排：期中和期末。
 * 自由模式（endless）下高三下学期的期末只是模拟考，高考要自己报名。
 */
export function examPlan(semesterIndex, weeksPerSemester = DEFAULT_WEEKS_PER_SEMESTER, options = {}) {
  const weeks = Math.max(2, weeksPerSemester);
  const midWeek = Math.max(1, Math.round(weeks / 2));
  const finalWeek = weeks;
  const isSenior1 = semesterIndex === 4;
  const isSenior2 = semesterIndex === 5;
  const endless = Boolean(options.endless);

  const mid = {
    week: midWeek,
    name: isSenior2 ? '二模考试' : isSenior1 ? '高三第一次月考' : '期中考试',
    kind: isSenior2 ? 'mock' : 'mid',
  };
  const final = isSenior2 && !endless
    ? { week: finalWeek, name: '高考', kind: 'gaokao' }
    : {
        week: finalWeek,
        name: isSenior2 ? '高考前模拟考' : isSenior1 ? '一模考试' : '期末考试',
        kind: isSenior1 || isSenior2 ? 'mock' : 'final',
      };
  return midWeek === finalWeek ? [final] : [mid, final];
}

/**
 * 年级排名：满分 750，映射到 1000 名同级生里的名次。
 * 表内是 [总分, 名次] 的锚点，中间用线性插值。
 */
const RANK_ANCHORS = [
  [750, 1],
  [720, 2],
  [700, 6],
  [680, 15],
  [660, 35],
  [640, 70],
  [620, 120],
  [600, 180],
  [580, 255],
  [560, 340],
  [540, 435],
  [520, 535],
  [500, 630],
  [470, 760],
  [440, 860],
  [410, 930],
  [380, 970],
  [0, 1000],
];

export function rankFromScore(total) {
  const score = Math.max(0, Math.min(750, total));
  for (let i = 0; i < RANK_ANCHORS.length - 1; i += 1) {
    const [hiScore, hiRank] = RANK_ANCHORS[i];
    const [loScore, loRank] = RANK_ANCHORS[i + 1];
    if (score <= hiScore && score >= loScore) {
      const span = hiScore - loScore || 1;
      const ratio = (hiScore - score) / span;
      return Math.max(1, Math.round(hiRank + (loRank - hiRank) * ratio));
    }
  }
  return 1000;
}

/** 大学录取档次（按高考总分，安徽口径，数值为虚构娱乐设定）。 */
export const COLLEGE_TIERS = [
  {
    id: 'top2',
    min: 696,
    tier: '清北',
    title: '未名湖与清华园',
    schools: ['清华大学', '北京大学'],
    text: '查分那天下着小雨。屏幕上跳出的数字让你手抖了三次才截图成功——马鞍山二中门口的红榜上，你的名字在最上面那一行。校长在升旗仪式上念了你的名字，班主任哭得比你还厉害。',
  },
  {
    id: 'huawu',
    min: 668,
    tier: '华五',
    title: '华东五校的录取通知书',
    schools: ['复旦大学', '上海交通大学', '浙江大学', '南京大学', '中国科学技术大学'],
    text: '雨山湖边的晚风里，你收到了一封印着校徽的EMS。虽然是"差一点就够到清北"的分数，但已经足够让整条健康路的邻居都知道：二中今年又出了一个厉害的学生。',
  },
  {
    id: 'c985',
    min: 636,
    tier: '985',
    title: '985，稳稳的幸福',
    schools: ['武汉大学', '华中科技大学', '西安交通大学', '哈尔滨工业大学', '东南大学', '同济大学', '中山大学', '四川大学', '山东大学'],
    text: '三年里你扔掉了几十支笔芯、喝掉了数不清的咖啡。录取通知书寄到家里那天，你爸在团结广场请全家吃了顿饭，还破天荒让你喝了半罐啤酒。',
  },
  {
    id: 'c211',
    min: 596,
    tier: '211',
    title: '211 也很好',
    schools: ['合肥工业大学', '安徽大学', '南京航空航天大学', '南京理工大学', '苏州大学', '河海大学', '江南大学', '上海大学'],
    text: '你没能冲进顶尖的那一档，但你拿到了一个实打实的好去处。班主任在志愿表上写下"稳妥"两个字，说："高考不是终点，是换乘站。"',
  },
  {
    id: 'yiben',
    min: 552,
    tier: '一本',
    title: '一本线上岸',
    schools: ['安徽师范大学', '安徽医科大学', '安徽财经大学', '安徽工业大学', '安徽建筑大学', '合肥大学'],
    text: '分数出来那一刻你有点恍惚——不高不低，正好把你稳稳送进了一本。马鞍山到芜湖只要二十几分钟高铁，你妈说这样周末还能回家吃饭。',
  },
  {
    id: 'erben',
    min: 498,
    tier: '二本',
    title: '二本，人生照样长',
    schools: ['皖江工学院', '池州学院', '巢湖学院', '宿州学院', '滁州学院', '蚌埠学院'],
    text: '你按自己的分数认认真真填了志愿。多年以后你才明白，那天填下的不是一所学校，而是一条你亲自选的路。',
  },
  {
    id: 'minban',
    min: 436,
    tier: '民办本科',
    title: '本科，也拿到了',
    schools: ['马鞍山学院', '安徽外国语学院', '合肥城市学院', '安徽信息工程学院'],
    text: '学费有点贵，你爸沉默了两天，最后还是把第一年的学费转到了你卡上。你决定大学里把这笔钱"挣回来"。',
  },
  {
    id: 'dazhuan',
    min: 366,
    tier: '高职专科',
    title: '专科，技能流',
    schools: ['马鞍山师范高等专科学校', '安徽冶金科技职业学院', '马鞍山职业技术学院', '合肥职业技术学院'],
    text: '你选了一个能上手的技术专业。三年后你会发现，马钢、宝武、长三角的工厂里，到处都需要你这样的人。',
  },
  {
    id: 'fudu',
    min: 0,
    tier: '复读',
    title: '再来一年',
    schools: ['马鞍山中加双语', '毛坦厂中学（六安）'],
    text: '成绩单上的数字不太好看。你把校服叠好放进柜子，第二天又在早读铃响前坐回了教室——这一年，你只想赢一次。',
  },
];

export function collegeTierFor(total) {
  return COLLEGE_TIERS.find((tier) => total >= tier.min) ?? COLLEGE_TIERS[COLLEGE_TIERS.length - 1];
}
