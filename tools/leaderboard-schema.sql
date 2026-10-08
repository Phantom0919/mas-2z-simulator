-- 中二野人实验室 · 排行榜表（Supabase / Postgres）
--
-- 用法（大约 5 分钟）：
--   1. https://supabase.com 注册 → New project（免费版够用，区域随便选离你近的）
--   2. 左侧 SQL Editor → New query → 把这份文件整个粘进去 → Run
--   3. 左侧 Project Settings → API：抄下 Project URL 和 anon public key
--   4. 填进 web/content/leaderboard.json（url / anonKey 两个字段）
--   5. 重出发布页：node tools/build-pages.mjs
--
-- 为什么前端敢放 anon key：
--   anon key 是 Supabase 设计上公开的"publishable"密钥，真正的门禁是下面的 RLS 策略——
--   匿名只能 select 和 insert，**没有 update / delete 策略 = 改不了也删不掉别人的记录**。
--   想删脏数据时你自己在控制台执行：
--     delete from public.leaderboard where id in (...);
--   想一刀清空：truncate public.leaderboard;

create table if not exists public.leaderboard (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  nickname text not null check (char_length(nickname) between 1 and 16),
  score int check (score is null or (score >= 0 and score <= 750)),
  rank int check (rank is null or (rank >= 1 and rank <= 1000)),
  ending_id text check (char_length(coalesce(ending_id, '')) <= 40),
  ending_title text not null check (char_length(ending_title) between 1 and 60),
  tier text check (char_length(coalesce(tier, '')) <= 20),
  endings int not null default 0 check (endings between 0 and 500),
  achievements int not null default 0 check (achievements between 0 and 500),
  runs int not null default 0 check (runs between 0 and 9999),
  difficulty text not null default 'normal',
  mode text not null default 'solo' check (mode in ('solo', 'versus')),
  rival_level text,
  versus_winner text check (versus_winner is null or versus_winner in ('you', 'rival', 'tie')),
  seed text check (char_length(coalesce(seed, '')) <= 40),
  build text check (char_length(coalesce(build, '')) <= 80)
);

-- 榜单页按"分高的先来"读，这两个索引让它别全表扫
create index if not exists leaderboard_score_idx on public.leaderboard (score desc);
create index if not exists leaderboard_collection_idx on public.leaderboard (endings desc, achievements desc);

-- 行级安全：公开可读、只许插入，不许改和删
alter table public.leaderboard enable row level security;

drop policy if exists "leaderboard read" on public.leaderboard;
create policy "leaderboard read" on public.leaderboard
  for select using (true);

drop policy if exists "leaderboard insert" on public.leaderboard;
create policy "leaderboard insert" on public.leaderboard
  for insert with check (true);

-- 注意：这里**故意不建** update / delete 策略。
-- 匿名（含把 anon key 抄走的人）只能往表里加行，不能改分数、不能删别人的记录。

-- 自检：下面这条应该能列出你的表
-- select count(*) from public.leaderboard;
