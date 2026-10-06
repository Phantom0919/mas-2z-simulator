/**
 * 人物阵容（cast）：把引擎里的好感度键，映射成有名字、有身份、有关系的具体的人。
 *
 * 设计要点：
 *   - **键保持不变**（head / math / deskmate / parents / love …），老存档照样能读；
 *     名字只是显示层，存在 game.cast 里。
 *   - 名字由 names.js 的记名册生成，走**独立随机流**，不会打乱主随机序列。
 *   - 每个人属于一个"分组"（家庭 / 老师 / 同学），关系树状图直接按这个分组画。
 */

import { createNameBook, familiarName, teacherName } from './names.js';
/**
 * 分组：关系树中间那一层。
 * group 顺序就是树上的排列顺序。
 */
export const CAST_GROUPS = [
  { id: 'family', name: '家里', icon: '🏠', desc: '无论考多少分，他们都得管你饭' },
  { id: 'school', name: '老师', icon: '🏫', desc: '推荐名额、违纪处理、答疑，都握在他们手里' },
  { id: 'class', name: '同学', icon: '🎒', desc: '三年里跟你抬头不见低头见的人' },
];

/**
 * 角色位。
 *
 * gender: '男' / '女' / 'same'（跟主角同性别）/ 'opposite'（跟主角相反）
 * affinity: 对应 game.npc 里的哪个键
 */
export const CAST_ROLES = [
  {
    id: 'father',
    role: '爸爸',
    title: '家长',
    icon: '👨',
    group: 'family',
    affinity: 'parents',
    gender: '男',
    blurb: '话不多，但你每次晚自习回家，客厅那盏灯都还亮着',
  },
  {
    id: 'mother',
    role: '妈妈',
    title: '家长',
    icon: '👩',
    group: 'family',
    affinity: 'parents',
    gender: '女',
    blurb: '你书包里那盒牛奶，永远是她趁你不注意塞进去的',
  },
  {
    id: 'head',
    role: '班主任',
    title: '老师',
    icon: '👩‍🏫',
    group: 'school',
    affinity: 'head',
    gender: '女',
    blurb: '推荐名额与违纪处理，都看她的态度',
  },
  {
    id: 'math',
    role: '数学老师',
    title: '老师',
    icon: '🧮',
    group: 'school',
    affinity: 'math',
    gender: '男',
    blurb: '好感高了会单独给你开小灶，竞赛推荐也归他管',
  },
  {
    id: 'deskmate',
    role: '同桌',
    title: '同学',
    icon: '🧑',
    group: 'class',
    affinity: 'deskmate',
    gender: 'same',
    blurb: '一起自习互相打气的朋友，好感 70 以上有友情结局线',
  },
  {
    id: 'friend',
    role: '死党',
    title: '同学',
    icon: '🧢',
    group: 'class',
    affinity: 'friend',
    gender: 'same',
    blurb: '一起翻墙去团结广场的那个人，也是敢骂你"别学了"的那个人',
  },
  {
    id: 'rival',
    role: '老对手',
    title: '同学',
    icon: '⚔️',
    group: 'class',
    affinity: 'rival',
    gender: 'opposite',
    blurb: '成绩榜上永远压你一头或被你压一头，你们互相盯着对方',
  },
  {
    id: 'love',
    role: '心动对象',
    title: '同学',
    icon: '💗',
    group: 'class',
    affinity: 'love',
    gender: 'opposite',
    blurb: '好感 35 以上可以表白',
  },
];

export const CAST_ROLE_MAP = Object.fromEntries(CAST_ROLES.map((item) => [item.id, item]));
export const CAST_GROUP_MAP = Object.fromEntries(CAST_GROUPS.map((item) => [item.id, item]));

/** 角色位顺序，关系树按这个顺序排。 */
export const CAST_ROLE_IDS = CAST_ROLES.map((item) => item.id);

/** 好感度 → 关系描述。 */
export function affinityLevel(value, roleId) {
  const v = Number(value) || 0;
  if (roleId === 'love') {
    if (v >= 80) return { label: '两情相悦', tone: 'best' };
    if (v >= 60) return { label: '心里有你', tone: 'good' };
    if (v >= 35) return { label: '有点暧昧', tone: 'warm' };
    if (v >= 15) return { label: '认识而已', tone: 'plain' };
    return { label: '形同路人', tone: 'cold' };
  }
  if (v >= 85) return { label: '无话不谈', tone: 'best' };
  if (v >= 70) return { label: '关系很好', tone: 'good' };
  if (v >= 50) return { label: '相处不错', tone: 'warm' };
  if (v >= 30) return { label: '不咸不淡', tone: 'plain' };
  if (v >= 15) return { label: '有点疏远', tone: 'cold' };
  return { label: '几乎闹翻', tone: 'bad' };
}

/** 关系描述的配色（前端和文档共用一份）。 */
export const TONE_COLORS = {
  best: '#3fb950',
  good: '#56d364',
  warm: '#d29922',
  plain: '#8b949e',
  cold: '#db6d28',
  bad: '#f85149',
};

/** 主角性别 + 'same' / 'opposite' → 具体性别。 */
function resolveGender(spec, studentGender) {
  const mine = studentGender === '女' ? '女' : '男';
  if (spec === 'same') return mine;
  if (spec === 'opposite') return mine === '女' ? '男' : '女';
  return spec === '女' ? '女' : '男';
}

/**
 * 生成一局游戏的全部人物。
 *
 * @param {string} seedText 随机种子文本
 * @param {{
 *   studentGender?: string,
 *   studentName?: string,
 *   studentSurname?: string,
 *   overrides?: Record<string, { name?: string, gender?: string }>,
 * }} options
 *   overrides 是"自定义人物"用的：玩家可以给任意角色位指定名字和性别
 *   （比如把同桌改成"小美"+女生）。没指定的角色位照旧随机。
 * @returns {{ list: object[], map: Record<string, object>, byAffinity: Record<string, object[]> }}
 */
export function buildCast(seedText, options = {}) {
  const book = createNameBook(String(seedText ?? 'seed'), 'cast');
  const studentGender = options.studentGender === '女' ? '女' : '男';
  const avoid = options.avoid ? String(options.avoid) : null;
  const overrides = options.overrides && typeof options.overrides === 'object' ? options.overrides : {};

  const list = CAST_ROLES.map((spec) => {
    const custom = overrides[spec.id] ?? {};
    const customName = String(custom.name ?? '').trim().slice(0, 12);
    // 自定义性别优先；否则按角色位规则推导（同性别 / 相反性别 / 固定）
    const customGender = custom.gender === '女' ? '女' : custom.gender === '男' ? '男' : null;
    const gender = customGender ?? resolveGender(spec.gender, studentGender);
    const gender2 = customGender
      ? customGender === studentGender
        ? 'same'
        : 'opposite'
      : spec.gender === 'same'
        ? 'same'
        : spec.gender === 'opposite'
          ? 'opposite'
          : gender;
    let name;
    if (customName) {
      // 自定义名字不消耗随机流，但照样要占掉这个名字，免得别的角色位撞名
      name = customName;
      book.reserve(name);
    } else {
      name = book.take(gender, spec.id === 'father' ? options.studentSurname : undefined);
      // 别跟主角同名，读起来会串戏
      if (avoid && name === avoid) name = book.take(gender);
    }
    const person = {
      id: spec.id,
      name,
      surname: name.slice(0, 1),
      given: name.slice(1),
      /** 同学之间怎么叫（双字名去姓） */
      call: spec.group === 'class' ? familiarName(name) : name,
      /** 老师怎么称呼 */
      teacher: spec.group === 'school' ? teacherName(name) : null,
      role: spec.role,
      title: spec.title,
      icon: spec.icon,
      group: spec.group,
      affinity: spec.affinity,
      gender,
      genderSpec: gender2,
      /** 正文里指代这个人时用的代词（他/她），避免"男同桌写成她" */
      ta: gender === '女' ? '她' : '他',
      blurb: spec.blurb,
      /** 这个名字是玩家自己定的 */
      custom: Boolean(customName) || Boolean(customGender),
    };
    return person;
  });

  const map = Object.fromEntries(list.map((person) => [person.id, person]));
  const byAffinity = {};
  for (const person of list) {
    byAffinity[person.affinity] ??= [];
    byAffinity[person.affinity].push(person.id);
  }
  return { list, map, byAffinity };
}

/**
 * 随机一个主角姓名（开局表单上的"随机"按钮用）。
 * 用 'student' 这条独立随机流，跟 NPC 的 'cast' 流分开，避免主角跟 NPC 撞名。
 */
export function randomStudentName(seedText, gender = '男') {
  const book = createNameBook(String(seedText ?? Date.now()), 'student');
  return book.take(gender === '女' ? '女' : '男');
}

/**
 * 老存档没有 game.cast 时，按种子把它补出来。
 * 这样读档后人物还是同一批人。
 */
export function castToPeople(cast) {
  if (!cast?.list) return [];
  return cast.list;
}
