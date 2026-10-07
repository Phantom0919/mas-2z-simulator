/**
 * 确定性随机数工具。
 *
 * 所有随机状态都保存在 game.rngState 里（一个 32 位整数），
 * 因此同一个种子必然得到同一局游戏，存档 / 读档后随机序列也能精确接上。
 */

const GOLDEN = 0x9e3779b9;

/** 返回 [0, 1) 之间的随机浮点数，并推进游戏内的随机状态。 */
export function nextFloat(game) {
  game.rngState = (game.rngState + GOLDEN) >>> 0;
  let t = game.rngState;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
  t = (t ^ (t >>> 15)) >>> 0;
  return t / 4294967296;
}

/** [min, max] 闭区间内的随机整数。 */
export function randInt(game, min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(nextFloat(game) * (hi - lo + 1));
}

/** [min, max) 区间内的随机浮点数。 */
export function randFloat(game, min, max) {
  return min + nextFloat(game) * (max - min);
}

/** 以概率 p 命中。 */
export function chance(game, p) {
  return nextFloat(game) < p;
}

/** 从数组里等概率取一个元素。 */
export function pick(game, list) {
  if (!list || list.length === 0) return undefined;
  return list[Math.floor(nextFloat(game) * list.length)];
}

/** 从数组里按权重取一个元素，默认读取 item.weight。 */
export function pickWeighted(game, list, weightOf = (item) => item.weight ?? 1) {
  if (!list || list.length === 0) return undefined;
  let total = 0;
  const weights = list.map((item) => {
    const w = Math.max(0, Number(weightOf(item)) || 0);
    total += w;
    return w;
  });
  if (total <= 0) return list[0];
  let roll = nextFloat(game) * total;
  for (let i = 0; i < list.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return list[i];
  }
  return list[list.length - 1];
}

/** Fisher-Yates 洗牌，返回新数组。 */
export function shuffle(game, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextFloat(game) * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 把任意字符串散列成 32 位种子（FNV-1a）。 */
export function hashSeed(text) {
  const s = String(text);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
