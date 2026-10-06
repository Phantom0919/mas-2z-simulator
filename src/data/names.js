/**
 * 中文常见姓名生成器。
 *
 * 只用最常见的百家姓与常见的名字用字，生成"一听就是中国学生"的名字。
 * 为了让同一局里出现的人不重名，用 createNameBook() 拿到一个"记名册"，
 * 每次取名都保证和之前取过的不一样（同名概率极低，撞了就换一个）。
 *
 * 随机数走的是**独立随机流**（一个只有 rngState 字段的小对象），
 * 所以取名字不会打乱 game.rngState 的主随机序列——
 * 老存档、老种子、平衡测试的数值全都不会因为加了名字而改变。
 */

import { hashSeed, nextFloat, randInt } from '../rng.js';

/** 百家姓（按常见程度大致排序）。 */
export const SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周',
  '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗',
  '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹',
  '彭', '曾', '肖', '田', '董', '袁', '潘', '于', '蒋', '蔡',
  '余', '杜', '叶', '程', '苏', '魏', '吕', '丁', '任', '沈',
  '姚', '卢', '姜', '崔', '钟', '谭', '陆', '汪', '范', '金',
  '石', '廖', '贾', '夏', '韦', '方', '白', '邹', '孟', '熊',
  '秦', '邱', '江', '尹', '薛', '段', '雷', '侯', '龙', '史',
  '陶', '黎', '贺', '顾', '毛', '郝', '龚', '邵', '万', '钱',
  '严', '武', '戴', '莫', '孔', '向', '汤', '常', '温', '康',
  '施', '文', '牛', '樊', '葛', '邢', '安', '齐', '易', '乔',
  '伍', '庞', '颜', '倪', '庄', '聂', '章', '鲁', '岳', '翟',
];

/** 男孩名字里最常见的字。 */
export const MALE_CHARS = [
  '伟', '强', '磊', '军', '洋', '勇', '杰', '涛', '明', '超',
  '鹏', '刚', '毅', '俊', '峰', '亮', '辉', '波', '宇', '浩',
  '凯', '鑫', '宸', '昊', '睿', '泽', '轩', '晨', '阳', '帆',
  '楠', '博', '文', '天', '龙', '飞', '航', '铭', '哲', '岩',
  '健', '宁', '恒', '诚', '翔', '思', '远', '志', '宏', '建',
  '国', '平', '东', '海', '江', '山', '林', '森', '斌', '旭',
  '尧', '亦', '子', '嘉', '家', '一', '正', '维', '梓', '锦',
];

/** 女孩名字里最常见的字。 */
export const FEMALE_CHARS = [
  '静', '丽', '娜', '敏', '芳', '燕', '娟', '霞', '秀', '英',
  '玲', '红', '梅', '兰', '琳', '雪', '婷', '悦', '欣', '佳',
  '怡', '倩', '颖', '雅', '琪', '慧', '珊', '萌', '雨', '晴',
  '梦', '瑶', '蕾', '莹', '蕊', '薇', '萱', '涵', '月', '汐',
  '思', '语', '诗', '若', '梓', '子', '一', '嘉', '宁', '钰',
  '婉', '柔', '清', '洁', '莉', '萍', '媛', '璇', '瑜', '彤',
  '菲', '蕊', '娇', '媚', '菁', '晶', '曼', '笛', '韵', '澜',
];

/** 现成的常见双字名（男孩），比随机拼两个字的成品率更高。 */
export const MALE_GIVEN = [
  '伟强', '建华', '志强', '俊杰', '浩然', '子轩', '宇航', '文博', '嘉豪', '天宇',
  '雨泽', '明轩', '思远', '晨曦', '泽宇', '奕辰', '博文', '梓豪', '一鸣', '逸凡',
  '子墨', '浩宇', '睿泽', '俊熙', '家豪', '若飞', '振宇', '逸轩', '天佑', '志远',
  '思聪', '承宇', '嘉铭', '梓涵', '立诚', '少凡', '书豪', '亦航', '景行', '瑞霖',
];

/** 现成的常见双字名（女孩）。 */
export const FEMALE_GIVEN = [
  '雨欣', '欣怡', '诗涵', '语嫣', '梓萱', '若曦', '思琪', '佳怡', '雅静', '梦洁',
  '一诺', '可欣', '晓婷', '静怡', '文萱', '嘉怡', '子涵', '雅琪', '丽娜', '雨薇',
  '心怡', '佳琪', '梦琪', '婉清', '锦悦', '书瑶', '亦菲', '若涵', '清越', '灵珊',
  '筱雨', '佳宁', '汐月', '一萱', '雨桐', '悦然', '语彤', '思彤', '莹莹', '雪莹',
];

/**
 * 造一个独立随机流。
 *
 * 形状和 game 一样只需要 { rngState }，所以可以直接喂给 rng.js 里的函数。
 * @param {string} tag 这个流用来干什么（进哈希，保证不同用途互不影响）
 * @param {string} seedText 种子文本
 */
export function createStream(tag, seedText) {
  return { rngState: hashSeed(`${seedText}|${tag}`) };
}

/** 随机取一个姓。 */
export function randomSurname(stream) {
  return SURNAMES[Math.floor(nextFloat(stream) * SURNAMES.length)];
}

/** 随机取一个名（1 字或 2 字，2 字为主）。 */
export function randomGivenName(stream, gender = '男') {
  const male = gender !== '女';
  const chars = male ? MALE_CHARS : FEMALE_CHARS;
  const ready = male ? MALE_GIVEN : FEMALE_GIVEN;

  const roll = nextFloat(stream);
  if (roll < 0.66) return ready[Math.floor(nextFloat(stream) * ready.length)];
  if (roll < 0.86) {
    // 拼一个双字名：两个字不能一样
    const first = chars[Math.floor(nextFloat(stream) * chars.length)];
    let second = chars[Math.floor(nextFloat(stream) * chars.length)];
    if (second === first) second = chars[(chars.indexOf(first) + 7) % chars.length];
    return `${first}${second}`;
  }
  return chars[Math.floor(nextFloat(stream) * chars.length)];
}

/** 随机生成一个完整姓名。 */
export function randomName(stream, gender = '男', surname) {
  return `${surname ?? randomSurname(stream)}${randomGivenName(stream, gender)}`;
}

/**
 * 记名册：同一局内不重名。
 *
 * @param {string} seedText 种子文本（同一个种子 → 同一批名字）
 * @param {string} tag 用途标签，默认 'cast'
 */
export function createNameBook(seedText, tag = 'cast') {
  const stream = createStream(tag, seedText);
  const used = new Set();
  const usedGiven = new Set();

  /**
   * 取一个没被用过的名字。
   * 连"名"也不重复——一局里出现"王雨欣"和"李雨欣"两个人，
   * 同学之间互相叫"雨欣"时就分不清谁是谁了。
   */
  function take(gender = '男', surname) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidate = randomName(stream, gender, attempt === 0 ? surname : undefined);
      const given = candidate.slice(1);
      if (used.has(candidate) || usedGiven.has(given)) continue;
      used.add(candidate);
      usedGiven.add(given);
      return candidate;
    }
    // 极端情况下用序号兜底，保证一定能返回
    let candidate = randomName(stream, gender);
    let index = 2;
    while (used.has(candidate) || usedGiven.has(candidate.slice(1))) {
      candidate = `${candidate}${index}`;
      index += 1;
    }
    used.add(candidate);
    usedGiven.add(candidate.slice(1));
    return candidate;
  }

  return {
    stream,
    take,
    /**
     * 占掉一个名字（"自定义人物"里玩家自己填的名字）。
     * 不消耗随机流，但之后随机取名时会避开它，免得一局里出现两个"张伟"。
     */
    reserve(name) {
      const text = String(name ?? '').trim();
      if (!text) return;
      used.add(text);
      if (text.length > 1) usedGiven.add(text.slice(1));
    },
    /** 已经取过的名字。 */
    names: () => [...used],
    /** 随机一个数字（给"座号""班级"之类用）。 */
    int: (min, max) => randInt(stream, min, max),
    /** 随机取数组中的一个。 */
    pick: (list) => list[Math.floor(nextFloat(stream) * list.length)],
  };
}

/** 名字的姓。 */
export const surnameOf = (fullName) => String(fullName ?? '').slice(0, 1);

/** 名字的名（去掉姓）。 */
export const givenNameOf = (fullName) => String(fullName ?? '').slice(1);

/**
 * 中文里的称呼：单字名连姓叫（"王静" → "王静"），
 * 双字名常省姓只叫名（"王雨欣" → "雨欣"），更符合同学之间的叫法。
 */
export function familiarName(fullName, { keepSurname = false } = {}) {
  const name = String(fullName ?? '');
  if (keepSurname || name.length <= 2) return name;
  return name.slice(1);
}

/** 老师称呼："王老师" / "王雅静老师"。 */
export function teacherName(fullName, { full = false } = {}) {
  const name = String(fullName ?? '');
  if (!name) return '老师';
  return full ? `${name}老师` : `${name.slice(0, 1)}老师`;
}
