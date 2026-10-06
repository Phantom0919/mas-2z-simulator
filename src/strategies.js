/**
 * 自动对局策略：CLI 的 --auto 模式、平衡测试 tools/sim.js 都用这里。
 *
 * 每个策略都是 (game, phase) => { actionId, subject, chooseEvent }：
 *   phase = 'main'    本周主行动
 *   phase = 'weekend' 周末安排
 * 策略只看游戏状态做决定（不使用随机数），所以同一局面下行为可复现。
 */

import { SUBJECT_MAP } from './data/school.js';
import { listActions, nextExamInfo } from './engine.js';

/** 事件选择偏好：按优先级取第一个可用的选项，没命中就选第一个。 */
const EVENT_PREFERENCE = [
  'run',
  'honest',
  'admit',
  'rest',
  'sleep',
  'refuse',
  'return',
  'breathe',
  'call',
  'go',
  'notes',
  'pass',
  'perform',
  'study',
  'join',
  'light',
  'middle',
  'contest',
  /*
   * 下面这两个是"看懂了陷阱所以不去踩"的选项：
   * 自动对局不是高手，但也不该闭着眼睛往刷单诈骗里跳——
   * 否则 tools/sim.js 统计出来的意外结局率会失真。
   *
   * 注意：不要往这里加网咖赛的"回家做卷子"。
   * 加了以后自动对局会永远绕开网吧线，esports 结局就再也测不出来了。
   */
  'ask_classmate',
  'report_it',
];

export function chooseEvent(pending) {
  const choices = pending?.choices ?? [];
  if (choices.length === 0) return null;
  for (const id of EVENT_PREFERENCE) {
    const hit = choices.find((choice) => choice.id === id);
    if (hit) return hit.id;
  }
  return choices[0].id;
}

function actionTable(game, phase) {
  const map = new Map();
  for (const action of listActions(game, phase)) map.set(action.id, action);
  return map;
}

function weakestSubject(game) {
  const keys = (game.subjectKeys ?? []).slice().sort((a, b) => (game.knowledge[a] ?? 0) - (game.knowledge[b] ?? 0));
  return keys[0] ?? 'math';
}

function strongestSubject(game) {
  const keys = (game.subjectKeys ?? []).slice().sort((a, b) => (game.knowledge[b] ?? 0) - (game.knowledge[a] ?? 0));
  return keys[0] ?? 'math';
}

function pick(actions, ...ids) {
  for (const id of ids) {
    const action = actions.get(id);
    if (action?.available) return action;
  }
  return null;
}

function wrap(action, subject) {
  if (!action) return { actionId: 'listen', chooseEvent };
  if (action.needsSubject) {
    return { actionId: action.id, subject: subject ?? action.subjectOptions?.[0]?.key, chooseEvent };
  }
  return { actionId: action.id, chooseEvent };
}

function planStudy(actions, game, phase) {
  const exam = nextExamInfo(game);
  const weakest = weakestSubject(game);
  const weekend = phase === 'weekend';
  if (exam && exam.inWeeks <= 1) {
    const target = weekend
      ? pick(actions, 'cram', 'drill', 'review_notes', 'tutor')
      : pick(actions, 'cram', 'drill', 'listen', 'review_notes');
    return wrap(target, weakest);
  }
  if (weekend) {
    const target = pick(actions, 'drill', 'study_together', 'review_notes', 'tutor', 'ask_teacher', 'help');
    return wrap(target, weakest);
  }
  const target = pick(actions, 'listen', 'drill', 'review_notes', 'preview');
  return wrap(target, weakest);
}

/**
 * 状态维护：疲劳 / 心情 / 体质 / 钱。返回 null 表示不需要维护。
 *
 * 阈值是按引擎里 moodFactor / fatigueFactor 的曲线定的：疲劳过了 45 就开始扣效率，
 * 心情低于 50 学东西明显变慢。所以"早点休息"比"硬撑到 85 再睡"更划算——
 * 这也是这一版难度的核心：资源（时间 / 状态）真的不够用，必须取舍。
 */
function planMaintenance(actions, game, phase) {
  // 提前介入：等疲劳到 72 再睡，前面几周的效率已经白白折掉了
  if (game.stats.fatigue >= 58) return wrap(pick(actions, 'sleep', 'sport'));
  if (game.stats.mood <= 62) return wrap(pick(actions, 'canteen', 'family_time', 'social', 'sport', 'sleep'));
  if (game.stats.physique <= 45) return wrap(pick(actions, 'sport', 'canteen'));
  if (game.stats.money < 180 && pick(actions, 'tutor_job', 'work')) {
    const job = pick(actions, 'tutor_job', 'work');
    if (job) return wrap(job, strongestSubject(game));
  }
  return null;
}

/** 自由模式：高三下学期快结束时就去报名高考，否则这一局永远打不完。 */
function planGaokao(actions, game, phase) {
  if (!game.endless || phase !== 'main' || game.semesterIndex < 5) return null;
  const action = actions.get('take_gaokao');
  if (!action?.available) return null;
  const lastWeek = Math.max(2, (game.weeksPerSemester ?? 6) - 1);
  if (game.week >= lastWeek) return wrap(action);
  return null;
}

export const STRATEGIES = {
  /** 卷王：学习为主，靠运动和加餐维持状态，专补最弱的一科。 */
  diligent(game, phase) {
    const actions = actionTable(game, phase);
    const gaokao = planGaokao(actions, game, phase);
    if (gaokao) return gaokao;
    const maintenance = planMaintenance(actions, game, phase);
    if (maintenance) return maintenance;
    if (phase === 'weekend' && game.stats.mood <= 45) {
      const comfort = wrap(pick(actions, 'canteen', 'family_time', 'social', 'sport'));
      if (comfort.actionId !== 'listen') return comfort;
    }
    if (game.turn % 4 === 3 && (game.stats.fatigue >= 45 || game.stats.mood <= 75)) {
      // 状态还行就别歇——这一版状态扣效率扣得狠，但也别白送一周
      const rest = wrap(pick(actions, 'sport', 'canteen', 'family_time', 'club'));
      if (rest.actionId !== 'listen') return rest;
    }
    const stage = game.flags.contestStage ?? 0;
    if (stage >= 3 && stage < 5 && game.turn % 5 === 2) {
      const contest = actions.get('contest');
      if (contest?.available) return { actionId: 'contest', subject: strongestSubject(game), chooseEvent };
    }
    if (phase === 'main' && !game.flags.qiangji && game.flags.contestProv1) {
      const qiangji = actions.get('apply_qiangji');
      if (qiangji?.available) return wrap(qiangji);
    }
    return planStudy(actions, game, phase);
  },

  /** 竞赛生：把竞赛线走到底，冲保送。 */
  olympiad(game, phase) {
    const actions = actionTable(game, phase);
    const gaokao = planGaokao(actions, game, phase);
    if (gaokao) return gaokao;
    const exam = nextExamInfo(game);
    const maintenance = planMaintenance(actions, game, phase);
    if (maintenance) return maintenance;
    const stage = game.flags.contestStage ?? 0;
    if (stage < 5) {
      const contest = actions.get('contest');
      if (contest?.available && (exam === null || exam.inWeeks > 1) && game.turn % 5 !== 4) {
        return { actionId: 'contest', subject: strongestSubject(game), chooseEvent };
      }
    }
    if (phase === 'main' && !game.flags.qiangji && stage >= 3) {
      const qiangji = actions.get('apply_qiangji');
      if (qiangji?.available) return wrap(qiangji);
    }
    return planStudy(actions, game, phase);
  },

  /** 均衡：学习和生活各占一半。 */
  balanced(game, phase) {
    const actions = actionTable(game, phase);
    const gaokao = planGaokao(actions, game, phase);
    if (gaokao) return gaokao;
    const maintenance = planMaintenance(actions, game, phase);
    if (maintenance) return maintenance;
    const cycle = game.turn % 5;
    if (cycle === 0 || cycle === 2) return planStudy(actions, game, phase);
    if (cycle === 1) {
      const target = pick(actions, 'drill', 'help', 'study_together');
      if (target) return wrap(target, weakestSubject(game));
      return planStudy(actions, game, phase);
    }
    if (cycle === 3) {
      const target = pick(actions, 'sport', 'club', 'volunteer', 'social', 'family_time');
      if (target) return wrap(target);
      return planStudy(actions, game, phase);
    }
    const target = pick(actions, 'read', 'club', 'canteen', 'sleep', 'write_novel');
    return target ? wrap(target) : planStudy(actions, game, phase);
  },

  /** 佛系：能过就行，一周六段里大概只认真学两段。 */
  casual(game, phase) {
    const actions = actionTable(game, phase);
    const gaokao = planGaokao(actions, game, phase);
    if (gaokao) return gaokao;
    if (game.stats.fatigue >= 75) return wrap(pick(actions, 'sleep', 'canteen'));
    if (game.stats.mood <= 35) return wrap(pick(actions, 'canteen', 'social', 'family_time', 'sleep'));
    const cycle = game.turn % 6;
    if (cycle === 0 || cycle === 3) return planStudy(actions, game, phase);
    if (cycle === 1) return wrap(pick(actions, 'social', 'read', 'club', 'vlog', 'family_time'));
    if (cycle === 2) return wrap(pick(actions, 'game', 'sport', 'phone', 'write_novel'));
    if (cycle === 4) return wrap(pick(actions, 'sport', 'read', 'social', 'vlog', 'club'));
    return wrap(pick(actions, 'sport', 'canteen', 'sleep', 'read', 'social')) ?? planStudy(actions, game, phase);
  },

  /** 摆烂：几乎不学，用来测坏结局。 */
  slacker(game, phase) {
    const actions = actionTable(game, phase);
    const gaokao = planGaokao(actions, game, phase);
    if (gaokao) return gaokao;
    if (game.stats.mood <= 18) return wrap(pick(actions, 'sleep', 'therapy'));
    const cycle = game.turn % 5;
    if (cycle === 0) return wrap(pick(actions, 'game', 'phone', 'skip', 'vlog'));
    if (cycle === 1) return wrap(pick(actions, 'skip', 'social', 'game', 'date'));
    if (cycle === 2) return wrap(pick(actions, 'sleep', 'read', 'canteen', 'vlog'));
    if (cycle === 3) return wrap(pick(actions, 'date', 'social', 'work', 'family_time'));
    return wrap(pick(actions, 'listen', 'game', 'phone', 'review_notes'));
  },

  /** 死磕：只刷题，用来验证疲劳与崩溃线。 */
  crammer(game, phase) {
    const actions = actionTable(game, phase);
    const gaokao = planGaokao(actions, game, phase);
    if (gaokao) return gaokao;
    if (game.stats.fatigue >= 92 || game.stats.mood <= 12) return wrap(pick(actions, 'sleep', 'canteen'));
    const target = pick(actions, 'cram', 'drill', 'listen', 'review_notes');
    return wrap(target, weakestSubject(game));
  },

  /** 艺术生：综合素质 + 艺考路线。 */
  artist(game, phase) {
    const actions = actionTable(game, phase);
    const gaokao = planGaokao(actions, game, phase);
    if (gaokao) return gaokao;
    const maintenance = planMaintenance(actions, game, phase);
    if (maintenance) return maintenance;
    if (phase === 'main' && !game.flags.artTrack && game.stats.comprehensive >= 35) {
      const art = actions.get('art_class');
      if (art?.available) return wrap(art);
    }
    if (phase === 'main' && !game.flags.zonghe && game.stats.comprehensive >= 60) {
      const zonghe = actions.get('apply_zonghe');
      if (zonghe?.available) return wrap(zonghe);
    }
    const cycle = game.turn % 4;
    if (cycle === 0) return wrap(pick(actions, 'club', 'volunteer', 'read'));
    if (cycle === 1) return wrap(pick(actions, 'write_novel', 'vlog', 'read'));
    if (cycle === 2) return planStudy(actions, game, phase);
    return wrap(pick(actions, 'volunteer', 'club', 'canteen', 'family_time')) ?? planStudy(actions, game, phase);
  },

  /** 体育生：体质 + 校队路线。 */
  athlete(game, phase) {
    const actions = actionTable(game, phase);
    const gaokao = planGaokao(actions, game, phase);
    if (gaokao) return gaokao;
    if (game.stats.mood <= 22) return wrap(pick(actions, 'therapy', 'family_time', 'sleep'));
    if (game.stats.fatigue >= 86) return wrap(pick(actions, 'sleep', 'canteen'));
    if (phase === 'main' && game.stats.physique >= 55 && game.turn % 3 === 0) {
      const team = actions.get('sports_team');
      if (team?.available) return wrap(team);
    }
    const cycle = game.turn % 4;
    if (cycle === 0) return wrap(pick(actions, 'sport', 'sports_team', 'canteen'));
    if (cycle === 2) return wrap(pick(actions, 'sport', 'canteen', 'sleep')) ?? planStudy(actions, game, phase);
    return planStudy(actions, game, phase);
  },

  /** 恋爱线：把好感度堆到告白成功，再看能不能撑到高考。 */
  lover(game, phase) {
    const actions = actionTable(game, phase);
    const gaokao = planGaokao(actions, game, phase);
    if (gaokao) return gaokao;
    if (game.stats.mood <= 20) return wrap(pick(actions, 'therapy', 'family_time', 'sleep'));
    if (phase === 'main' && !game.flags.earlyLove && game.npc.love >= 40) {
      const confess = actions.get('confess');
      if (confess?.available) return wrap(confess);
    }
    const cycle = game.turn % 4;
    if (cycle === 1) return wrap(pick(actions, 'date', 'social', 'study_together'));
    if (cycle === 3) return wrap(pick(actions, 'social', 'family_time', 'read', 'vlog'));
    return wrap(pick(actions, 'study_together', 'help', 'ask_teacher')) ?? planStudy(actions, game, phase);
  },
};

/** 把策略名解析成策略函数。 */
export function getStrategy(name) {
  const key = String(name ?? 'diligent');
  if (STRATEGIES[key]) return STRATEGIES[key];
  const available = Object.keys(STRATEGIES).join(', ');
  throw new Error(`未知策略 "${name}"，可用：${available}`);
}

export { SUBJECT_MAP };
