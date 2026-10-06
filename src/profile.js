/**
 * 跨局元进度：结局图鉴、成就收集、历史战绩。
 * CLI 存成 JSON 文件（默认 saves/profile.json），网页版存在 localStorage。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { runSummary } from './engine.js';

export const DEFAULT_PROFILE_FILE = 'saves/profile.json';

export function emptyProfile() {
  return {
    version: 1,
    games: 0,
    endings: {}, // id -> { count, bestTotal, firstAt, lastAt }
    achievements: {}, // name -> count
    best: null, // { total, ending, name, seed, at }
    history: [], // 最近 20 局
  };
}

export function loadProfile(file = DEFAULT_PROFILE_FILE) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return { ...emptyProfile(), ...data };
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(profile, file = DEFAULT_PROFILE_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8');
  return profile;
}

/** 把一局游戏的结果记进档案。 */
export function recordGame(profile, game, at = new Date().toISOString()) {
  const summary = runSummary(game);
  if (!summary.ending) return profile;

  const endingId = summary.ending.id;
  const entry = profile.endings[endingId] ?? { count: 0, bestTotal: 0, firstAt: at, lastAt: at };
  entry.count += 1;
  entry.lastAt = at;
  if (summary.ending.total) entry.bestTotal = Math.max(entry.bestTotal, summary.ending.total);
  profile.endings[endingId] = entry;

  for (const name of summary.achievements) {
    profile.achievements[name] = (profile.achievements[name] ?? 0) + 1;
  }

  profile.games += 1;
  const total = summary.ending.total ?? 0;
  if (!profile.best || total > (profile.best.total ?? 0)) {
    profile.best = { total, ending: summary.ending.title, name: summary.name, seed: summary.seed, at };
  }
  profile.history.unshift({
    name: summary.name,
    seed: summary.seed,
    ending: summary.ending.title,
    tier: summary.ending.tier,
    total: summary.ending.total ?? null,
    goal: summary.ending.goal?.achieved ?? null,
    at,
  });
  profile.history = profile.history.slice(0, 20);
  return profile;
}

/** 档案概览：解锁进度。 */
export function profileStats(profile, catalog) {
  const unlocked = catalog.filter((item) => profile.endings[item.id]);
  return {
    games: profile.games,
    unlocked: unlocked.length,
    total: catalog.length,
    achievements: Object.keys(profile.achievements).length,
    best: profile.best,
    unlockedIds: new Set(unlocked.map((item) => item.id)),
  };
}
