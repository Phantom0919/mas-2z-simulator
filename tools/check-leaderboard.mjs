/**
 * 排行榜后端自检：拿 web/content/leaderboard.json 里的 Supabase 走一遍完整读写链路。
 *
 *   node tools/check-leaderboard.mjs
 *
 * 检查四件事：
 *   1. 读榜单（GET）—— 表存不存在、RLS 的 select 策略有没有生效；
 *   2. 写一条（POST）—— insert 策略有没有生效（会留下一条"自检员"记录，脚本末尾有清理 SQL）；
 *   3. 改（PATCH）和删（DELETE）—— **必须失败**：这是 RLS 的关键，
 *      抄走 anon key 的人也只能加行，改不了分数、删不掉别人的记录；
 *   4. 再读一次，确认刚写的那条真的在榜上。
 *
 * 提示：在国内的部分网络里 `*.supabase.co` 会被按 SNI 阻断（TCP 能连、TLS 被重置），
 * 这时脚本会报 `unreachable`——游戏本身不受影响，它会退回本机榜（离线优先）。
 */

import { readFileSync } from 'node:fs';

import { entryFromRun, fetchBoard, isConfigured, submitEntry } from '../src/leaderboard.js';

const config = JSON.parse(readFileSync('web/content/leaderboard.json', 'utf8'));
if (!isConfigured(config)) {
  console.error('还没配置后端');
  process.exit(1);
}

const base = config.supabase.url.replace(/\/+$/, '');
const table = config.supabase.table;
const headers = {
  apikey: config.supabase.anonKey,
  authorization: `Bearer ${config.supabase.anonKey}`,
  'content-type': 'application/json',
};
const log = (...args) => console.log(...args);

/* 1. 读 */
const before = await fetchBoard(config, { metric: 'score' });
log(`1) 读榜单：${before.ok ? `OK（${before.entries.length} 条）` : `失败 → ${before.reason}`}`);
if (!before.ok && before.reason === 'http-404') {
  log('   → 表还不存在：需要先把 tools/leaderboard-schema.sql 在 Supabase 的 SQL Editor 里跑一遍');
  process.exit(2);
}
if (!before.ok) {
  log(`   → 详情：${JSON.stringify(before.error?.message ?? before.error ?? before.reason)}`);
  process.exit(3);
}

/* 2. 写一条自检记录 */
const view = {
  mode: 'solo',
  seed: 'selftest-2026',
  difficulty: { key: 'normal' },
  selection: { label: '物理类 · 化学+生物' },
  build: { traits: [{ name: '过目不忘' }], goal: { name: '稳上一本' } },
  ending: { id: 'tier211', title: '【自检记录】后端连通性测试', total: 601, rank: 180, tier: '211', achievements: [] },
};
const entry = entryFromRun({ nickname: '自检员', view, profile: { runs: 1, unlocked: { a: {} }, achievements: {} } });
entry.at = new Date().toISOString();
const written = await submitEntry(config, entry);
log(`2) 写一条：${written.ok ? 'OK' : `失败 → ${written.reason} ${written.detail ?? ''}`}`);

/* 3. 改 / 删必须被 RLS 拦住 */
const patch = await fetch(`${base}/rest/v1/${table}?nickname=eq.${encodeURIComponent('自检员')}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ score: 750 }),
});
log(`3) 改别人的分数：HTTP ${patch.status}（期望 401/403/404/0 行受影响）→ ${(await patch.text()).slice(0, 120) || '（空响应）'}`);

const del = await fetch(`${base}/rest/v1/${table}?nickname=eq.${encodeURIComponent('自检员')}`, {
  method: 'DELETE',
  headers,
});
log(`4) 删记录：HTTP ${del.status}（期望 401/403）→ ${(await del.text()).slice(0, 120) || '（空响应）'}`);

/* 5. 再读一次，看看刚写的在不在 */
const after = await fetchBoard(config, { metric: 'score' });
log(`5) 再读榜单：${after.ok ? `OK（${after.entries.length} 条）` : `失败 → ${after.reason}`}`);
if (after.ok) {
  for (const row of after.entries.slice(0, 5)) {
    log(`   ${row.position}. ${row.nickname}　${row.endingTitle}　${row.score ?? '-'} 分　难度 ${row.difficulty}　${row.mode}`);
  }
}

log('\n清理自检数据（在 Supabase 控制台的 SQL Editor 里跑这一行）：');
log("  delete from public.leaderboard where nickname = '自检员';");
