/**
 * 窗口位置 / 大小的持久化。
 * 纯逻辑部分（normalizeState）不依赖 Electron，方便单测。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_BOUNDS = { width: 1320, height: 880 };
export const MIN_WIDTH = 1024;
export const MIN_HEIGHT = 680;

/**
 * 校验并修正窗口状态，保证窗口至少有一部分落在某个显示器的工作区里。
 * @param {object|null} state 存档里的窗口状态
 * @param {Array<{x:number,y:number,width:number,height:number}>} workAreas 各显示器工作区
 */
export function normalizeState(state, workAreas = []) {
  const width = Math.max(MIN_WIDTH, Math.round(Number(state?.width) || DEFAULT_BOUNDS.width));
  const height = Math.max(MIN_HEIGHT, Math.round(Number(state?.height) || DEFAULT_BOUNDS.height));
  const maximized = Boolean(state?.maximized);

  const x = Number.isFinite(state?.x) ? Math.round(state.x) : null;
  const y = Number.isFinite(state?.y) ? Math.round(state.y) : null;
  if (x === null || y === null || workAreas.length === 0) {
    return { width, height, maximized };
  }

  // 至少要有一部分（120px 宽 / 60px 高）露在某个屏幕里，否则交给系统居中
  const visible = workAreas.some(
    (area) =>
      x + width > area.x + 120 &&
      x < area.x + area.width - 120 &&
      y + height > area.y + 60 &&
      y < area.y + area.height - 60,
  );
  return visible ? { x, y, width, height, maximized } : { width, height, maximized };
}

export function loadWindowState(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function saveWindowState(file, state) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}
