/**
 * 商店与道具：零花钱终于有地方花了。
 *
 * 每个道具要么提供永久修饰器（mods，会叠加到 game.mods 上），
 * 要么是一次性效果（effect），要么两者都有。
 * repeatable 的道具可以反复买（比如咖啡周卡）。
 */

export const ITEMS = [
  {
    id: 'workbook',
    name: '教辅全套（五三 + 必刷题）',
    icon: '📚',
    price: 320,
    desc: '学习收益 +10%',
    mods: { study: 0.1 },
  },
  {
    id: 'headphones',
    name: '降噪耳机',
    icon: '🎧',
    price: 520,
    desc: '心情消耗 -25%，自习时世界安静了(并不可以)',
    mods: { moodDrain: 0.25 },
  },
  {
    id: 'shoes',
    name: '专业跑鞋',
    icon: '👟',
    price: 340,
    desc: '运动带来的体质收益 +30%',
    mods: { physique: 0.3 },
  },
  {
    id: 'course',
    name: '网课年卡',
    icon: '💻',
    price: 660,
    desc: '学习收益 +12%（可与教辅叠加）',
    mods: { study: 0.12 },
  },
  {
    id: 'basketball',
    name: '专业篮球',
    icon: '🏀',
    price: 240,
    desc: '社交收益 +20%',
    mods: { social: 0.2 },
  },
  {
    id: 'gym',
    name: '健身房月卡',
    icon: '🏋️',
    price: 400,
    desc: '每周额外恢复 2 点疲劳',
    mods: { weeklyRecovery: 2 },
  },
  {
    id: 'phone',
    name: '新手机',
    icon: '📱',
    price: 1600,
    desc: '立刻心情 +10，之后每周心情 +0.3',
    mods: { weeklyMood: 0.3 },
    effect: { stats: { mood: 10 } },
  },
  {
    id: 'coffee',
    name: '咖啡周卡',
    icon: '☕',
    price: 120,
    repeatable: true,
    desc: '立刻恢复 12 点疲劳（可重复购买）',
    effect: { stats: { fatigue: -12 } },
  },
  {
    id: 'desk',
    name: '护眼台灯 + 人体工学椅',
    icon: '🪑',
    price: 900,
    desc: '疲劳增长 -20%，学习收益 +5%',
    mods: { fatigueGain: 0.2, study: 0.05 },
  },
  {
    id: 'album',
    name: '二中特色毕业纪念册预定',
    icon: '📔',
    price: 150,
    desc: '综合素质 +8，心情 +6（三年总得留点什么）',
    effect: { stats: { comprehensive: 8, mood: 6 } },
  },
];

export const ITEM_MAP = Object.fromEntries(ITEMS.map((item) => [item.id, item]));
