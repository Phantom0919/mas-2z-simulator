/**
 * 高考志愿填报：把"分数出来 → 录取"这一段做成一个真正要动脑的终局玩法。
 *
 * 为什么单独一个文件：
 *   原来一局游戏的结局是 `总分 → collegeTierFor(总分)` 一步到位，
 *   玩家在最后关头没有任何决策权。真实的高考不是这样——**分数只是入场券，
 *   志愿表才是最后一关**：冲得太狠会滑档，全填保险又浪费分数，
 *   单科不达标会被退档，不服从调剂就只能等征集志愿。
 *
 * 这个文件只负责"生成一张志愿表"和"按规则投档"这两件纯数据的事：
 *   - 分数线的**年度波动**（同一所学校，今年可能比去年高 18 分，也可能低 12 分）
 *   - 每个专业组的**单科要求**（英语 110、数学 120……把你三年的偏科带进终局）
 *   - 平行志愿的投档规则（按顺序检索，够线即投，前面作废后面不看）
 *   - 服从调剂 / 滑档
 *
 * 随机数由调用方（engine.js）传进来，所以这里可以脱离引擎单测。
 */

import { COLLEGE_TIERS, SUBJECT_MAP } from './school.js';

/** 志愿表上有几个格子（平行志愿）。 */
export const VOLUNTEER_SLOTS = 6;

/** 一共生成多少个院校专业组供选择（够铺满"冲稳保"三档，又不至于挑花眼）。 */
export const VOLUNTEER_OPTIONS = 16;

/**
 * 专业池。
 *
 *   heat        热门程度 0~2，越热投档线越高（计算机类今年就是比冶金高）
 *   require     单科要求：{ subject, min }——不达标直接退档，这条把"偏科"带进终局
 *   tierBias    只在这些层次出现的专业（不写就是所有层次都可能）
 */
export const MAJORS = [
  { id: 'jisuanji', name: '计算机类', icon: '💻', heat: 2 },
  { id: 'rengong', name: '人工智能', icon: '🤖', heat: 2, require: { subject: 'math', min: 115 } },
  { id: 'dianzi', name: '电子信息类', icon: '📡', heat: 1 },
  { id: 'dianqi', name: '电气工程及其自动化', icon: '⚡', heat: 1 },
  { id: 'jixie', name: '机械类', icon: '⚙️', heat: 0 },
  { id: 'yiejin', name: '冶金工程', icon: '🏭', heat: 0 },
  { id: 'cailiao', name: '材料类', icon: '🧱', heat: 0 },
  { id: 'tumu', name: '土木工程', icon: '🏗️', heat: -1 },
  { id: 'linchuang', name: '临床医学', icon: '🩺', heat: 2, require: { subject: 'biology', min: 78 } },
  { id: 'kouqiang', name: '口腔医学', icon: '🦷', heat: 2, require: { subject: 'biology', min: 82 } },
  { id: 'huli', name: '护理学', icon: '💉', heat: 0, tierBias: ['dazhuan', 'minban', 'erben'] },
  { id: 'kuaiji', name: '会计学', icon: '🧾', heat: 1 },
  { id: 'jinrong', name: '金融学', icon: '💰', heat: 2 },
  { id: 'falu', name: '法学', icon: '⚖️', heat: 2 },
  { id: 'hanyu', name: '汉语言文学', icon: '📖', heat: 1 },
  { id: 'yingyu', name: '英语', icon: '🔤', heat: 1, require: { subject: 'english', min: 110 } },
  { id: 'xinwen', name: '新闻传播学类', icon: '🎙️', heat: 2 },
  { id: 'shifan', name: '数学与应用数学（师范）', icon: '🧮', heat: 1, require: { subject: 'math', min: 100 } },
  { id: 'xinli', name: '应用心理学', icon: '🧠', heat: 1 },
  { id: 'shengwu', name: '生物科学', icon: '🧬', heat: 0 },
  { id: 'lishi', name: '历史学', icon: '📜', heat: 0, tierBias: ['yiben', 'erben', 'minban'] },
  { id: 'dianzishangwu', name: '电子商务', icon: '🛒', heat: 0, tierBias: ['dazhuan', 'minban', 'erben'] },
  { id: 'xueqian', name: '学前教育', icon: '🧸', heat: 0, tierBias: ['dazhuan', 'minban'] },
  { id: 'yejin_jishu', name: '钢铁智能冶金技术', icon: '🔩', heat: -1, tierBias: ['dazhuan'] },
];

/** 调剂会被塞进来的"没人报"的专业。 */
const ADJUST_MAJORS = ['cailiao', 'tumu', 'yejin_jishu', 'huli', 'xueqian', 'shengwu', 'dianzishangwu'];

export const MAJOR_MAP = Object.fromEntries(MAJORS.map((major) => [major.id, major]));

/**
 * 年度分数线波动：放榜前谁也不知道今年会涨还是跌。
 *
 * 返回一个"整年的偏移"（所有学校一起动）+ 每个专业组自己的噪声。
 * 玩家能看到的只有一条 **风声**（rumor），不能看到确切数字——
 * 这就是"冲稳保"真正要赌的东西。
 */
export function rollYearShift(random) {
  const roll = random(); // 0~1
  let shift;
  let rumor;
  if (roll < 0.3) {
    shift = -Math.round(6 + random() * 12); // 降 6~18 分
    rumor = '今年题偏难，网上都在传"分数线要降"。老师却说要小心——分数线是考生填出来的，不是题目决定的。';
  } else if (roll > 0.72) {
    shift = Math.round(6 + random() * 14); // 涨 6~20 分
    rumor = '今年大家考得都不错，群里在传"分数线要涨"。你的排名比去年同分的人要难看一些。';
  } else if (roll > 0.55) {
    shift = Math.round(2 + random() * 5);
    rumor = '今年是"大年"，高分的人特别多，每一档的线都可能往上抬一点点。';
  } else {
    shift = -Math.round(1 + random() * 4);
    rumor = '和往年差不多，招生计划没什么变化。班主任说："按你的排名填，别赌。"';
  }
  return { shift, rumor };
}

/** 某个专业组今年的投档线。 */
export function cutLineFor(tier, major, yearShift, noise) {
  const heat = major.heat ?? 0;
  // 越是顶尖的学校，专业冷热带来的分差越小（都是全省前几百名的人在挤）
  const heatWeight = tier.id === 'top2' || tier.id === 'huawu' ? 3 : 6;
  return Math.max(0, Math.round(tier.min + yearShift + heat * heatWeight + noise));
}

/**
 * 生成一张志愿表。
 *
 * @param {{ total: number, rank: number, subjects: Record<string, number> }} record 高考成绩
 * @param {() => number} random 0~1 的随机函数（引擎传 game 的随机流）
 * @returns {{
 *   shift: number, rumor: string, options: object[], reachable: {min: number, max: number}
 * }}
 */
export function buildVolunteerBoard(record, random) {
  const { shift, rumor } = rollYearShift(random);
  const options = [];
  const used = new Set();

  // 从顶尖到底部走一遍，每一档挑 1~2 个专业组；保证分数的上下都够得着
  for (const tier of COLLEGE_TIERS) {
    if (tier.id === 'fudu') continue; // 复读不是志愿，是滑档之后的去处
    if (options.length >= VOLUNTEER_OPTIONS) break;
    const pool = MAJORS.filter((major) => !major.tierBias || major.tierBias.includes(tier.id));
    const count = tier.min >= 596 ? 2 : 2;
    for (let i = 0; i < count; i += 1) {
      // 随机挑一个还没用过的专业；同一个档次里尽量一热一冷
      const candidates = pool.filter((major) => !used.has(`${tier.id}-${major.id}`));
      if (candidates.length === 0) break;
      const preferHot = i === 0;
      const sorted = candidates.slice().sort((a, b) => (preferHot ? (b.heat ?? 0) - (a.heat ?? 0) : (a.heat ?? 0) - (b.heat ?? 0)));
      const slice = sorted.slice(0, Math.max(1, Math.min(4, sorted.length)));
      const major = slice[Math.floor(random() * slice.length)];
      used.add(`${tier.id}-${major.id}`);
      const schools = tier.schools ?? ['某大学'];
      const school = schools[Math.floor(random() * schools.length)];
      const noise = Math.round((random() - 0.5) * 18); // ±9 分的专业组波动
      const minScore = cutLineFor(tier, major, shift, noise);
      const gap = record.total - minScore;
      options.push({
        id: `vol-${String(options.length + 1).padStart(2, '0')}-${major.id}`,
        tierId: tier.id,
        tierName: tier.tier,
        tierTitle: tier.title,
        school,
        major: major.id,
        majorName: major.name,
        majorIcon: major.icon,
        minScore,
        heat: major.heat ?? 0,
        require: major.require ? { ...major.require, label: `${SUBJECT_MAP[major.require.subject]?.name ?? major.require.subject} ≥ ${major.require.min}` } : null,
        level: levelFor(gap),
        gap,
        note: tier.id === 'top2' ? '全省前列才敢填' : tier.id === 'fudu' ? '' : '',
      });
    }
  }

  // 打散一下顺序，免得"从上到下正好是冲稳保"变成看图做题
  const shuffled = shuffleWith(options, random);
  return {
    shift,
    rumor,
    options: shuffled.map((option, index) => ({ ...option, id: `vol-${String(index + 1).padStart(2, '0')}-${option.major}` })),
    reachable: { min: Math.min(...options.map((option) => option.minScore)), max: Math.max(...options.map((option) => option.minScore)) },
  };
}

/** 冲 / 稳 / 保。 */
export function levelFor(gap) {
  if (gap >= 25) return '保';
  if (gap >= 8) return '稳';
  return '冲';
}

/** 洗牌（Fisher-Yates，用外部随机流）。 */
function shuffleWith(list, random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 投档：平行志愿按顺序检索，**够线即投，投中就不再看后面的**。
 *
 * @param {{ total: number, subjects: Record<string, number> }} record
 * @param {object[]} options 志愿表
 * @param {string[]} picks 玩家填的志愿 id（顺序 = 志愿顺序）
 * @param {boolean} adjust 是否服从调剂
 * @returns {{ admitted: object|null, round: number, adjusted: boolean, slip: boolean, rejected: object[], lines: string[] }}
 */
export function resolveVolunteers(record, options, picks, adjust) {
  const lines = [];
  const rejected = [];
  let admitted = null;
  let round = 0;
  const byId = new Map(options.map((option) => [option.id, option]));

  picks.forEach((id, index) => {
    if (admitted) return;
    const option = byId.get(id);
    if (!option) return;
    const order = index + 1;
    // 单科不达标：直接退档，这个志愿作废（这是"偏科"在终局的代价）
    if (option.require) {
      const score = record.subjects?.[option.require.subject] ?? 0;
      if (score < option.require.min) {
        rejected.push({ option, reason: 'require', order });
        lines.push(
          `第 ${order} 志愿 ${option.school} ${option.majorName}：${option.require.label}，你只有 ${score} 分，**不符合报考条件，志愿作废**。`,
        );
        return;
      }
    }
    if (record.total >= option.minScore) {
      admitted = option;
      round = order;
      lines.push(
        `第 ${order} 志愿投档成功：${option.school} ${option.majorName}（今年投档线 ${option.minScore}，你 ${record.total} 分）。`,
      );
      return;
    }
    rejected.push({ option, reason: 'score', order, gap: option.minScore - record.total });
    lines.push(`第 ${order} 志愿 ${option.school}：今年投档线 ${option.minScore}，你差 ${option.minScore - record.total} 分，滑过去了。`);
  });

  if (admitted) return { admitted, round, adjusted: false, slip: false, rejected, lines };

  if (adjust) {
    // 服从调剂：没被任何志愿录取时，系统会在还有名额的专业里给你找一个
    const fallback = options
      .filter((option) => option.minScore <= record.total && ADJUST_MAJORS.includes(option.major))
      .sort((a, b) => b.minScore - a.minScore)[0];
    if (fallback) {
      lines.push(`📞 招生办的电话打来了："你服从调剂，我们在${fallback.school}给你留了一个位置。"`);
      return {
        admitted: { ...fallback, majorName: MAJOR_MAP[fallback.major]?.name ?? fallback.majorName, adjusted: true },
        round: 0,
        adjusted: true,
        slip: false,
        rejected,
        lines,
      };
    }
  }

  return { admitted: null, round: 0, adjusted: false, slip: true, rejected, lines };
}
