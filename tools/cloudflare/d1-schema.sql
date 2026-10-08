-- 中二野人实验室 · 排行榜表（Cloudflare D1 / SQLite）
--
-- 用法（详见同目录 README.md）：
--   wrangler d1 create mas2z-leaderboard          # 建库，把返回的 database_id 填进 wrangler.toml
--   wrangler d1 execute mas2z-leaderboard --remote --file tools/cloudflare/d1-schema.sql
--
-- 说明：和 Supabase 那版的列名**完全一致**（snake_case），所以前端代码一个字都不用改；
-- 区别是这里没有 RLS —— "只能读和插、字段范围、同一昵称 60 秒一条"这些约束
-- 全在 worker-d1-leaderboard.js 里实现（有测试盯着）。

CREATE TABLE IF NOT EXISTS leaderboard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  nickname TEXT NOT NULL,
  score INTEGER,
  rank INTEGER,
  ending_id TEXT,
  ending_title TEXT NOT NULL,
  tier TEXT,
  endings INTEGER NOT NULL DEFAULT 0,
  achievements INTEGER NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  difficulty TEXT NOT NULL DEFAULT 'normal',
  mode TEXT NOT NULL DEFAULT 'solo',
  rival_level TEXT,
  versus_winner TEXT,
  seed TEXT,
  build TEXT
);

-- 两个榜各自的排序都要走索引，别全表扫
CREATE INDEX IF NOT EXISTS leaderboard_score_idx ON leaderboard (score DESC, rank ASC);
CREATE INDEX IF NOT EXISTS leaderboard_collection_idx ON leaderboard (endings DESC, achievements DESC);

-- 限流那条查询（同一昵称 60 秒内只收一条）靠它
CREATE INDEX IF NOT EXISTS leaderboard_nickname_idx ON leaderboard (nickname, created_at);

-- 自检：应该返回 0
-- SELECT COUNT(*) FROM leaderboard;
