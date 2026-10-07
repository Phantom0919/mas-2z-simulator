/**
 * 学期日历：给随机事件和行动排一张"什么时候才合理"的时间表。
 *
 * 为什么单独一个文件：事件定义（events.js / events2.js / events3.js）里塞满
 * `cond` 会让"这个事件到底什么时候会出现"变得没法一眼看完。这里把时间约束
 * 集中成一张表，好处是：
 *   1. 一眼能看出每个事件落在哪个年级、哪个学期、第几周；
 *   2. 有测试强制要求"每个事件都必须登记"，新增事件忘了定时间会直接测试失败；
 *   3. 和具体文案解耦，改日历不用动文案。
 *
 * 一条时间表长这样：
 *   { grade: [1, 2], term: 'autumn', minWeek: 2, maxWeek: 5, note: '秋游' }
 *
 * 字段含义（都可以省略，省略 = 不限）：
 *   grade     年级，可以是数字或数组（1=高一，2=高二，3=高三）
 *   term      'autumn'（上学期，9月-1月）或 'spring'（下学期，2月-7月）
 *   semester  直接指定学期序号 0-5（比 grade+term 更精确，一般用不上）
 *   minWeek   本学期的第几周之后（含），会按实际周数自动收拢
 *   maxWeek   本学期的第几周之前（含）
 *   anytime   true = 明确表示"任何时候都合理"，写它是为了让"必须登记"的检查通过
 */

/** 一学年两个学期：上学期是秋季，下学期是春季。 */
export const TERMS = [
  { id: 'autumn', name: '秋季学期', months: '9 月 — 次年 1 月', icon: '🍂' },
  { id: 'spring', name: '春季学期', months: '2 月 — 7 月', icon: '🌱' },
];

export const TERM_MAP = Object.fromEntries(TERMS.map((term) => [term.id, term]));

/** 第 n 个学期是秋还是春（0 起）。 */
export const semesterTerm = (semesterIndex) => (semesterIndex % 2 === 0 ? 'autumn' : 'spring');

/** 明确标记"任何时候都合理"。 */
const ANYTIME = { anytime: true };

/**
 * 把游戏状态折算成日历。
 *
 * @param {object} game
 * @returns {{ grade: number, term: string, semesterIndex: number, week: number, weeks: number, isFinalSemester: boolean }}
 */
export function calendarOf(game) {
  const index = Number.isFinite(game?.semesterIndex) ? game.semesterIndex : 0;
  const weeks = Number(game?.weeksPerSemester) || 6;
  // 自由模式下 semesterIndex 会停在高二下/高三下，这时仍然按高三算
  const clampedIndex = Math.max(0, Math.min(index, 5));
  const grade = clampedIndex <= 1 ? 1 : clampedIndex <= 3 ? 2 : 3;
  return {
    grade,
    term: semesterTerm(clampedIndex),
    semesterIndex: index,
    week: Number(game?.week) || 1,
    weeks,
    isFinalSemester: clampedIndex >= 5,
  };
}

/**
 * 这条时间表在当前日历下成不成立。
 *
 * minWeek / maxWeek 会按"这一学期实际有多少周"收拢：如果配置里一学期只有 3 周，
 * 而时间表写的是第 5 周，就自动落到最后一周，而不是永远不触发。
 */
export function matchesSchedule(schedule, cal) {
  if (!schedule || schedule.anytime) return true;

  if (schedule.semester !== undefined) {
    const list = Array.isArray(schedule.semester) ? schedule.semester : [schedule.semester];
    if (!list.includes(cal.semesterIndex)) return false;
  }
  if (schedule.grade !== undefined) {
    const list = Array.isArray(schedule.grade) ? schedule.grade : [schedule.grade];
    if (!list.includes(cal.grade)) return false;
  }
  if (schedule.term !== undefined) {
    const list = Array.isArray(schedule.term) ? schedule.term : [schedule.term];
    if (!list.includes(cal.term)) return false;
  }

  const weeks = Math.max(1, cal.weeks);
  if (schedule.minWeek !== undefined) {
    const min = Math.min(Math.max(schedule.minWeek, 1), weeks);
    if (cal.week < min) return false;
  }
  if (schedule.maxWeek !== undefined) {
    const max = Math.min(Math.max(schedule.maxWeek, 1), weeks);
    if (cal.week > max) return false;
  }
  return true;
}

/** 把时间表翻译成给玩家看的一句话（做不了某件事时显示）。 */
export function scheduleHint(schedule) {
  if (!schedule || schedule.anytime) return '';
  const parts = [];
  if (schedule.grade !== undefined) {
    const list = Array.isArray(schedule.grade) ? schedule.grade : [schedule.grade];
    parts.push(`只在${list.map((grade) => ['', '高一', '高二', '高三'][grade] ?? `第${grade}年`).join('、')}`);
  }
  if (schedule.term !== undefined) {
    const list = Array.isArray(schedule.term) ? schedule.term : [schedule.term];
    parts.push(`只在${list.map((term) => TERM_MAP[term]?.name ?? term).join('、')}`);
  }
  if (schedule.semester !== undefined) {
    const list = Array.isArray(schedule.semester) ? schedule.semester : [schedule.semester];
    parts.push(`只在第 ${list.map((index) => index + 1).join('、')} 个学期`);
  }
  if (schedule.minWeek !== undefined && schedule.maxWeek !== undefined) {
    parts.push(`第 ${schedule.minWeek}~${schedule.maxWeek} 周`);
  } else if (schedule.minWeek !== undefined) {
    parts.push(`第 ${schedule.minWeek} 周之后`);
  } else if (schedule.maxWeek !== undefined) {
    parts.push(`第 ${schedule.maxWeek} 周之前`);
  }
  return parts.join('　');
}

/* ------------------------------------------------------------------ 事件 */

/**
 * 事件的时间表。
 *
 * 原则：**只约束明显跟时间有关的事**。食堂、下雨、修自行车链条这类
 * "什么时候都可能发生"的不做限制，但要显式写 anytime，这样"有没有漏登记"可查。
 */
export const EVENT_SCHEDULE = {
  /* --- 季节 / 校历明确的事 --- */
  caishiji_trip: { term: 'autumn', minWeek: 2, note: '采石矶秋游，秋天才有' },
  new_year_gala: { term: 'autumn', minWeek: 4, note: '元旦晚会，元旦前后' },
  spring_sports: { term: 'spring', minWeek: 2, note: '春季运动会' },
  winter_run: { term: 'autumn', note: '冬季跑操，天冷了才开始' },
  spring_festival_stay: { term: 'autumn', minWeek: 4, note: '除夕年夜饭，寒假前' },
  winter_plan: { semester: 0, minWeek: 4, note: '寒假计划，高一上学期期末' },
  basketball_final: { term: 'autumn', minWeek: 2, note: '班级篮球赛在秋天打' },
  flu: { term: 'autumn', note: '流感高峰在秋冬' },

  /* --- 高一才有的事 --- */
  class_cadre: { semester: 0, maxWeek: 4, note: '班干部竞选只在开学初' },
  walking_class_new_desk: { semester: 0, maxWeek: 3, note: '高一开学走班换教室' },
  olympiad_notice: { grade: [1, 2], note: '竞赛班高一高二招募，高三不招新人' },
  track_doubt_history: { grade: [1], note: '刚选完历史类才纠结' },
  friend_persuade_switch: { semester: 0, note: '改科窗口期同学才会劝你改' },
  subject_switch_window: { semester: 0, note: '换科窗口只在高一上学期' },
  deskmate_note: { grade: [1, 2], note: '同桌刚熟起来的那阵' },

  /* --- 高二、高三才有的事 --- */
  lost_wallet: { grade: [1, 2], note: '失主是高二学姐，你自己得是高一或高二' },
  math_teacher_tutoring: { grade: [1, 2], note: '数学老师补差主要抓高一高二' },
  teacher_recommend: { grade: [2, 3], note: '推荐名额到高二高三才有意义' },
  sister_tutoring: { grade: [2, 3], note: '表姐辅导是高二高三的事' },
  part_time_flyer: { grade: [2, 3], note: '周末发传单，高二高三缺钱才去' },

  /* --- 高三专属 --- */
  gaokao_slogan: { semester: 5, maxWeek: 2, note: '百日誓师在高三下学期开学' },
  countdown_board: { grade: [3], note: '倒计时牌只在高三楼' },
  zhuangyuan_bridge: { grade: [3], note: '状元桥是高考前才走的' },
  mock_exam_pressure: { grade: [3], note: '模考排名' },
  insomnia_night: { grade: [3], note: '高三凌晨两点的台灯' },
  rival_notes: { grade: [3], note: '高三对手互相借笔记' },
  relatives_score_ask: { grade: [3], note: '亲戚问分数是高三的事' },
  album_photo: { grade: [3], term: 'spring', minWeek: 3, note: '高中纪念册在毕业前' },

  /* --- 校历上的固定节目（events3.js） --- */
  military_training: { semester: 0, maxWeek: 2, note: '军训在开学头两周' },
  opening_ceremony: { term: 'autumn', maxWeek: 1, note: '开学典礼在每学期开学第一周' },
  mid_autumn_mooncake: { term: 'autumn', maxWeek: 3, note: '中秋在九月下旬' },
  art_festival: { term: 'spring', minWeek: 3, note: '校园艺术节在春季学期' },
  science_week: { term: 'autumn', minWeek: 3, note: '科技活动周在秋天' },
  adult_ceremony: { grade: [3], term: 'spring', maxWeek: 2, note: '成人礼在高三下学期开学' },
  gaokao_physical: { grade: [3], term: 'spring', maxWeek: 2, note: '高考体检在高三下开学' },
  graduation_photo: { semester: 5, minWeek: 3, note: '毕业照在高考前' },
  flag_ceremony: ANYTIME,
  mahgang_visit: { grade: [1], term: 'autumn', note: '社会实践一般安排在高一上学期' },
  rainy_pe_class: ANYTIME,

  /* --- 抽象事件（events4.js） --- */
  street_stall: ANYTIME,
  yushanhu_boat: { term: 'spring', minWeek: 2, note: '划船是春天的活动，天冷了码头就收了' },
  gaokao_eve_allnighter: { semester: 5, minWeek: 4, note: '高考前夜，只有高三下学期最后几周' },

  /* --- 校园日常与本地生活（events5.js） --- */
  broadcast_station_shift: { anytime: true },
  desk_carving_words: { anytime: true },
  cleaning_duty_escape: { anytime: true },
  putang_bamboo_hike: { term: 'spring', minWeek: 2, note: '濮塘远足是开春以后的事' },
  laoshili_noodle_shop: { anytime: true },
  jiankang_road_barber: { anytime: true },
  ebike_battery_dead: { term: 'autumn', minWeek: 2, note: '天冷了电池才掉得这么快' },
  moving_house_boxes: { term: 'spring', minWeek: 2, note: '租约多在开春到期' },
  new_year_kitchen_help: { term: 'autumn', minWeek: 4, note: '年夜饭在寒假前' },
  borrow_notes_refused: { anytime: true },
  quarrel_apology_late: { anytime: true },
  lunch_alone_isolation: { anytime: true },
  mock_exam_phone_home: { grade: [3], note: '模考排名是高三的事' },
  volunteer_form_dispute: { grade: [3], term: 'spring', minWeek: 4, note: '志愿表在高考前后才发下来' },
  mom_midnight_light: { grade: [3], note: '台灯亮到凌晨一点的高三' },
  short_video_loop: { anytime: true },
  netbar_amateur_cup: { anytime: true },
  part_time_rebate_scam: { grade: [2, 3], note: '高二高三缺零花钱的人才会去找兼职' },

  /* --- 因果链（events6.js） ---
   * 第一环是随机池里的种子，后续环（chain_ 前缀、chainOnly）只能被前一环的
   * `chain` 强制弹出来，所以时间上不设限：它该来的时候是"几周后"，不是"第几周"。
   * 一律登记 anytime，让"必须登记"的检查仍然有效。
   */
  lend_out_earphones: ANYTIME,
  chain_lend_item_returned: ANYTIME,
  chain_lend_item_aftermath: ANYTIME,
  forged_parent_signature: ANYTIME,
  chain_signature_check: ANYTIME,
  help_old_man_market: ANYTIME,
  chain_stranger_find_school: ANYTIME,
  chain_stranger_shop_offer: ANYTIME,
  secret_skill_nights: ANYTIME,
  chain_secret_skill_debut: ANYTIME,
  quarrel_parents_phone: ANYTIME,
  chain_parents_cold_home: ANYTIME,
  chain_parents_choice_night: ANYTIME,
  club_form_unreturned: ANYTIME,
  chain_club_first_meeting: ANYTIME,
  chain_club_recommendation: ANYTIME,
  exam_peek_hand: ANYTIME,
  chain_exam_peek_aftermath: ANYTIME,
  yushanhu_lake_promise: ANYTIME,
  chain_lake_promise_winter: ANYTIME,
  chain_lake_promise_summer: ANYTIME,

  /* --- 什么时候都合理 --- */
  yushanhu_run: ANYTIME,
  canteen_braised: ANYTIME,
  egg_pancake: ANYTIME,
  tuanjie_street_food: ANYTIME,
  monthly_rank: ANYTIME,
  parent_meeting: ANYTIME,
  head_teacher_talk: ANYTIME,
  midnight_game: ANYTIME,
  study_group: ANYTIME,
  math_teacher_praise: ANYTIME,
  seat_change: ANYTIME,
  rain_no_umbrella: ANYTIME,
  bike_chain: ANYTIME,
  mahgang_smoke: ANYTIME,
  grandma_soup: ANYTIME,
  dad_overtime: ANYTIME,
  neighbor_kid: ANYTIME,
  library_old_book: ANYTIME,
  exam_leak: ANYTIME,
  hot_milk: ANYTIME,
  mahgang_stadium: ANYTIME,
  friend_failed: ANYTIME,
  anxiety: ANYTIME,
  volunteer_recruit: ANYTIME,
  deskmate_zhaohao_game: ANYTIME,
  dad_bike_rain: ANYTIME,
  tangtang_pancake_price: ANYTIME,
};

/* ------------------------------------------------------------------ 行动 */

/**
 * 行动的时间表。这里只放"时间上说不通"的：高二报名艺考班、高三才报强基……
 * 数值门槛（智力、体质、钱）仍然写在各自 action 的 requirement 里。
 */
export const ACTION_SCHEDULE = {
  club: { grade: [1, 2], note: '社团高一高二玩，高三基本停了' },
  run_class: { grade: [1], note: '班干部竞选只在高一' },
  art_class: { grade: [2], note: '艺考班高二进画室，高三来不及' },
  apply_qiangji: { grade: [3], note: '强基计划高三报名' },
  apply_zonghe: { grade: [3], note: '综合评价高三报名' },
  take_gaokao: { grade: [3], note: '高考当然在高三' },
};

/** 按类型取时间表。 */
export function scheduleFor(kind, id) {
  if (kind === 'action') return ACTION_SCHEDULE[id] ?? ANYTIME;
  return EVENT_SCHEDULE[id] ?? ANYTIME;
}

export { ANYTIME };
