/**
 * 排行榜测试（v3.1）。
 *
 * 分三层：
 *   1. 纯数据层：昵称规范化、条目校验、两个榜的排序与并列名次、同昵称去重、可复核文案；
 *   2. 后端层：不接受任何"只有真 Supabase 才能测"的假设——起一个假的 REST 服务，
 *      真的走一遍 POST / GET，顺便验证它发的 URL、头、body（snake_case 列名）；
 *   3. 守门层：配置文件默认必须是空的（离线优先）、SQL 里必须开 RLS 且只有读/插策略。
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_NICKNAME,
  LEADERBOARD_METRICS,
  bestPerNickname,
  emptyConfig,
  entryFromRun,
  fetchBoard,
  fromRow,
  isConfigured,
  normalizeEntry,
  normalizeNickname,
  rankEntries,
  reproduceText,
  submitEntry,
  summarizeBoard,
  toRow,
  validateEntry,
} from '../src/leaderboard.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => readFileSync(join(root, ...relative.split('/')), 'utf8');

/** 固定时间戳：让排序在"完全同档"时有稳定次序，测试也不会因为毫秒差而时好时坏。 */
const entry = (overrides = {}) =>
  normalizeEntry({ nickname: '小明', score: 600, endingTitle: '本科，也拿到了', at: '2026-10-08T00:00:00.000Z', ...overrides });

/* ------------------------------------------------------------ 数据层 */

test('两个榜的定义齐全（名字、图标、说明都要有）', () => {
  assert.deepEqual(
    LEADERBOARD_METRICS.map((item) => item.key),
    ['score', 'collection'],
  );
  for (const metric of LEADERBOARD_METRICS) {
    assert.ok(metric.name && metric.icon && metric.desc, `${metric.key} 缺文案`);
  }
});

test('昵称规范化：去控制字符、压空白、截断、空值兜底', () => {
  assert.equal(normalizeNickname('  小明  '), '小明');
  assert.equal(normalizeNickname('小\u0000明\n'), '小明');
  assert.equal(normalizeNickname('小  明'), '小 明');
  assert.equal(normalizeNickname(''), DEFAULT_NICKNAME);
  assert.equal(normalizeNickname(null), DEFAULT_NICKNAME);
  assert.equal(normalizeNickname('一'.repeat(40)).length, 16);
});

test('entryFromRun：把一局整理成榜单条目', () => {
  const view = {
    mode: 'solo',
    seed: 'seed-1',
    difficulty: { key: 'hard' },
    selection: { label: '物理类 · 化学+生物' },
    build: { traits: [{ name: '过目不忘' }, { name: '运动天赋' }], goal: { name: '稳上一本' } },
    ending: { id: 'tier211', title: '211 也很好', total: 612, rank: 147, tier: '211', achievements: [{ name: '年级前十' }] },
  };
  const profile = { runs: 4, unlocked: { a: {}, b: {}, c: {} }, achievements: { 年级前十: 1, 一生之友: 1 } };
  const value = entryFromRun({ nickname: ' 小明 ', view, profile });

  assert.equal(value.nickname, '小明');
  assert.equal(value.score, 612);
  assert.equal(value.rank, 147);
  assert.equal(value.endingId, 'tier211');
  assert.equal(value.endingTitle, '211 也很好');
  assert.equal(value.endings, 3);
  assert.equal(value.achievements, 2);
  assert.equal(value.runs, 4);
  assert.equal(value.difficulty, 'hard');
  assert.equal(value.mode, 'solo');
  assert.equal(value.seed, 'seed-1');
  assert.match(value.build, /物理类/);
  assert.match(value.build, /过目不忘/);
  assert.equal(validateEntry(value).ok, true);
});

test('entryFromRun：AI 对战会带上对手强度与胜负', () => {
  const view = {
    mode: 'versus',
    seed: 'seed-2',
    difficulty: { key: 'normal' },
    ending: { id: 'startup', title: '创业：没有学历，但有第一桶金', total: null, rank: null, tier: '创业' },
    versus: { active: true, level: { key: 'real' }, winner: 'rival' },
  };
  const value = entryFromRun({ nickname: '阿豆', view, profile: { runs: 1, unlocked: {}, achievements: {} } });
  assert.equal(value.mode, 'versus');
  assert.equal(value.rivalLevel, 'real');
  assert.equal(value.versusWinner, 'rival');
  assert.equal(value.score, null);
  assert.equal(validateEntry(value).ok, true, '没有总分但有结局名的特殊结局也是合法条目');
});

test('校验：空昵称、越界分数、超长昵称都要报出来', () => {
  // 注意：这些用例必须传**没归一化过**的原始对象。
  // normalizeEntry 会把空昵称补成默认名、把 9999 夹到 750——先归一化再校验就什么都测不出来。
  const raw = (overrides = {}) => ({ nickname: '小明', score: 600, endingTitle: '随便', ...overrides });
  assert.equal(validateEntry(raw({ nickname: '   ' })).ok, false);
  assert.match(validateEntry(raw({ nickname: '' })).errors.join('；'), /昵称/);
  assert.equal(validateEntry(raw({ score: 900 })).ok, false);
  assert.equal(validateEntry(raw({ score: -5 })).ok, false);
  assert.equal(validateEntry(raw({ nickname: '一'.repeat(20) })).ok, false);
  assert.equal(validateEntry(raw({ score: 750 })).ok, true);
  assert.equal(validateEntry(raw({ score: null, endingTitle: null })).ok, false, '既没分数也没结局名不该收');
  // 非法枚举会被归一化，而不是整条作废
  const odd = validateEntry(raw({ difficulty: 'nightmare', mode: 'chaos' }));
  assert.equal(odd.ok, true);
  assert.equal(odd.entry.difficulty, 'normal');
  assert.equal(odd.entry.mode, 'solo');
});

test('总分榜排序：总分 → 年级名次 → 成就数', () => {
  const ranked = rankEntries(
    [
      entry({ nickname: '乙', score: 600, rank: 300, achievements: 5 }),
      entry({ nickname: '甲', score: 600, rank: 120, achievements: 1 }),
      entry({ nickname: '丙', score: 601, rank: 900, achievements: 0 }),
      entry({ nickname: '丁', score: 600, rank: 300, achievements: 9 }),
    ],
    'score',
  );
  assert.deepEqual(ranked.map((item) => item.nickname), ['丙', '甲', '丁', '乙']);
  assert.deepEqual(ranked.map((item) => item.position), [1, 2, 3, 4]);
});

test('收集榜排序：图鉴数 → 成就数 → 总分', () => {
  const ranked = rankEntries(
    [
      entry({ nickname: '乙', endings: 5, achievements: 20, score: 700 }),
      entry({ nickname: '甲', endings: 5, achievements: 21, score: 300 }),
      entry({ nickname: '丙', endings: 9, achievements: 1, score: 100 }),
      entry({ nickname: '丁', endings: 5, achievements: 21, score: 650 }),
    ],
    'collection',
  );
  // 丙(9) 第一；甲与丁都是 5 个图鉴、21 个成就，再比总分 → 丁 650 > 甲 300
  assert.deepEqual(ranked.map((item) => item.nickname), ['丙', '丁', '甲', '乙']);
});

test('并列名次：完全相同的两条并列，下一位按真实条数继续', () => {
  const ranked = rankEntries(
    [
      entry({ nickname: '甲', score: 650, rank: 100, achievements: 3 }),
      entry({ nickname: '乙', score: 650, rank: 100, achievements: 3 }),
      entry({ nickname: '丙', score: 640, rank: 200, achievements: 1 }),
    ],
    'score',
  );
  assert.deepEqual(ranked.map((item) => item.position), [1, 1, 3]);
  assert.deepEqual(ranked.map((item) => item.tied), [true, true, false]);
});

test('同一个昵称只留最好的一条（两个榜各自的最好）', () => {
  const rows = [
    entry({ nickname: '小明', score: 500 }),
    entry({ nickname: '小明', score: 660 }),
    entry({ nickname: '小明', endings: 3 }),
    entry({ nickname: '小明', endings: 11 }),
  ];
  assert.equal(bestPerNickname(rows, 'score').length, 1);
  assert.equal(bestPerNickname(rows, 'score')[0].score, 660);
  assert.equal(bestPerNickname(rows, 'collection')[0].endings, 11);
  // 大小写不同的同一昵称也算同一个人（防"小明 / 小明 "刷屏）
  assert.equal(bestPerNickname([entry({ nickname: 'XiaoMing', score: 1 }), entry({ nickname: 'xiaoming', score: 2 })], 'score').length, 1);
});

test('summarizeBoard：总人数、榜首、我的名次', () => {
  const rows = [
    entry({ nickname: '甲', score: 700 }),
    entry({ nickname: '乙', score: 600 }),
    entry({ nickname: '丙', score: 500 }),
  ];
  const summary = summarizeBoard(rows, 'score', '乙');
  assert.equal(summary.total, 3);
  assert.equal(summary.top[0].nickname, '甲');
  assert.equal(summary.mine.nickname, '乙');
  assert.equal(summary.mine.position, 2);
  assert.equal(summarizeBoard(rows, 'score', '查无此人').mine, null);
});

test('可复核文案：带种子和构筑，别人照着能跑出同一局', () => {
  const text = reproduceText(
    entry({ nickname: '小明', score: 612, rank: 147, seed: 'abc123', build: '物理类 · 过目不忘/运动天赋', mode: 'versus', rivalLevel: 'hard' }),
  );
  assert.match(text, /小明/);
  assert.match(text, /612 分/);
  assert.match(text, /年级第 147 名/);
  assert.match(text, /种子 abc123/);
  assert.match(text, /物理类/);
  assert.match(text, /AI 对战/);
});

test('toRow / fromRow 往返：数据库列名是 snake_case', () => {
  const original = entry({ nickname: '小明', score: 612, rank: 147, endingId: 'tier211', rivalLevel: 'hard', versusWinner: 'you', mode: 'versus', seed: 's1' });
  const row = toRow(original);
  assert.equal(row.ending_id, 'tier211');
  assert.equal(row.ending_title, original.endingTitle);
  assert.equal(row.rival_level, 'hard');
  assert.equal(row.versus_winner, 'you');
  assert.equal('endingId' in row, false, '不该把 camelCase 发给 Postgres');
  const back = fromRow({ ...row, created_at: '2026-10-08T00:00:00.000Z' });
  assert.equal(back.endingId, 'tier211');
  assert.equal(back.rivalLevel, 'hard');
  assert.equal(back.versusWinner, 'you');
  assert.equal(back.at, '2026-10-08T00:00:00.000Z');
});

/* ------------------------------------------------------------ 后端层 */

/** 一个刚好够用的假 Supabase：/rest/v1/leaderboard 支持 GET / POST。 */
async function startFakeSupabase({ failWith = null } = {}) {
  const rows = [];
  const seen = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: request.method, url: request.url, headers: request.headers, body });
      if (failWith) {
        response.writeHead(failWith, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'nope' }));
        return;
      }
      if (request.method === 'POST') {
        rows.push({ id: rows.length + 1, created_at: `2026-10-08T00:00:0${rows.length}.000Z`, ...JSON.parse(body) });
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end('');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(rows));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    rows,
    seen,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

test('没配置后端时：不发任何请求，只回报 unconfigured（离线优先）', async () => {
  const config = emptyConfig();
  assert.equal(isConfigured(config), false);
  let called = 0;
  const spy = async () => {
    called += 1;
    return { ok: true, json: async () => [] };
  };
  const board = await fetchBoard(config, { fetchImpl: spy });
  assert.equal(board.ok, false);
  assert.equal(board.reason, 'unconfigured');
  const sent = await submitEntry(config, entry(), { fetchImpl: spy });
  assert.equal(sent.ok, false);
  assert.equal(called, 0, '没配置就一个请求都不许发');
});

test('假 Supabase 端到端：提交 → 读取 → 排序（URL / 头 / body 都要对）', async () => {
  const fake = await startFakeSupabase();
  const config = { format: 1, supabase: { url: `${fake.url}/`, anonKey: 'anon-key-123', table: 'leaderboard' } };
  try {
    assert.equal(isConfigured(config), true);

    for (const [nickname, score] of [
      ['甲', 700],
      ['乙', 660],
      ['丙', 590],
    ]) {
      const sent = await submitEntry(config, entry({ nickname, score }));
      assert.equal(sent.ok, true, `${nickname} 应该提交成功`);
    }

    const posted = fake.seen.find((item) => item.method === 'POST');
    assert.match(posted.url, /^\/rest\/v1\/leaderboard$/, 'URL 里不该有双斜杠');
    assert.equal(posted.headers.apikey, 'anon-key-123');
    assert.equal(posted.headers.authorization, 'Bearer anon-key-123');
    assert.equal(posted.headers.prefer, 'return=minimal');
    const payload = JSON.parse(posted.body);
    assert.equal(payload.nickname, '甲');
    assert.equal(payload.ending_title, '本科，也拿到了', 'body 里必须是数据库列名');

    const board = await fetchBoard(config, { metric: 'score' });
    assert.equal(board.ok, true);
    assert.deepEqual(board.entries.map((item) => item.nickname), ['甲', '乙', '丙']);
    assert.deepEqual(board.entries.map((item) => item.position), [1, 2, 3]);

    const got = fake.seen.find((item) => item.method === 'GET');
    assert.match(got.url, /order=score\.desc/);
    assert.match(got.url, /limit=200/);

    const collection = await fetchBoard(config, { metric: 'collection' });
    assert.equal(collection.ok, true);
    assert.match(fake.seen.filter((item) => item.method === 'GET').at(-1).url, /order=endings\.desc/);
  } finally {
    await fake.close();
  }
});

test('后端出错要当成"读不到"，不能把游戏弄崩', async () => {
  const forbidden = await startFakeSupabase({ failWith: 403 });
  const config = { format: 1, supabase: { url: forbidden.url, anonKey: 'k', table: 'leaderboard' } };
  try {
    const board = await fetchBoard(config);
    assert.equal(board.ok, false);
    assert.equal(board.reason, 'http-403');
    assert.deepEqual(board.entries, []);

    const sent = await submitEntry(config, entry());
    assert.equal(sent.ok, false);
    assert.equal(sent.reason, 'http-403');
    assert.match(sent.detail, /nope/);
  } finally {
    await forbidden.close();
  }
});

test('连不上后端：返回 unreachable，不抛异常（墙上、断网都是这条路）', async () => {
  const config = { format: 1, supabase: { url: 'http://127.0.0.1:9', anonKey: 'k', table: 'leaderboard' } };
  const board = await fetchBoard(config);
  assert.equal(board.ok, false);
  assert.equal(board.reason, 'unreachable');
  const sent = await submitEntry(config, entry());
  assert.equal(sent.ok, false);
  assert.equal(sent.reason, 'unreachable');
});

test('非法条目在客户端就被拦住，不会发出去脏数据', async () => {
  const fake = await startFakeSupabase();
  const config = { format: 1, supabase: { url: fake.url, anonKey: 'k', table: 'leaderboard' } };
  try {
    // 故意传**没归一化过**的原始对象：归一化会把空昵称补成默认名、把 9999 夹到 750，
    // 那样就测不出校验了
    const sent = await submitEntry(config, { nickname: '   ', score: 9999, endingTitle: '随便' });
    assert.equal(sent.ok, false);
    assert.equal(sent.reason, 'invalid');
    assert.ok(sent.errors.length >= 2);
    assert.equal(fake.seen.length, 0, '不合法的条目不发送');
  } finally {
    await fake.close();
  }
});

/* ------------------------------------------------------------ 守门层 */

test('界面守门：昵称询问、排行榜面板、结局上榜按钮都在，而且是真绑了事件', () => {
  const html = read('web/index.html');
  for (const id of [
    'nickname-modal',
    'input-nickname-first',
    'btn-nickname-save',
    'btn-nickname-skip',
    'leaderboard-modal',
    'input-nickname-board',
    'btn-save-nickname',
    'leaderboard-tabs',
    'leaderboard-body',
    'leaderboard-status',
    'btn-leaderboard',
    'btn-leaderboard-refresh',
    'btn-leaderboard-submit',
    'btn-leaderboard-close',
    'btn-ending-leaderboard',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html 少了 #${id}`);
  }

  const app = read('web/app.js');
  assert.match(app, /from '\.\.\/src\/leaderboard\.js'/, 'app.js 应该复用排行榜那份纯逻辑');
  for (const name of [
    'getNickname',
    'setNickname',
    'loadLocalBoard',
    'saveLocalBoard',
    'leaderboardConfig',
    'recordLeaderboardRun',
    'renderLeaderboard',
    'refreshBoard',
    'submitCurrentRun',
  ]) {
    assert.match(app, new RegExp(`(async )?function ${name}\\(`), `app.js 缺少 ${name}()`);
  }
  for (const id of ['btn-leaderboard', 'btn-ending-leaderboard', 'btn-nickname-save', 'btn-nickname-skip', 'btn-save-nickname', 'btn-leaderboard-submit', 'btn-leaderboard-refresh']) {
    assert.ok(app.includes(`$('${id}').addEventListener`), `${id} 没绑事件（画着好看的假按钮）`);
  }
  assert.match(app, /recordLeaderboardRun\(view\)/, '结局时应该自动记进本机榜');
  assert.match(app, /if \(!getNickname\(\)\) \$\('nickname-modal'\)\.classList\.remove\('hidden'\)/, '第一次进来要问昵称');
  // 离线优先：没配后端就不发请求、只读本机榜
  assert.match(app, /if \(!isConfigured\(config\)\) \{[\s\S]{0,160}rankLocal/, '没配后端应该退回本机榜');

  const css = read('web/style.css');
  for (const className of ['.board-row', '.board-list', '.board-badge', '.board-position', '.tab-row', '.leaderboard-nick']) {
    assert.ok(css.includes(className), `style.css 缺少 ${className}`);
  }
});

test('发布页也有排行榜区块，而且和游戏共用同一份排序逻辑', () => {
  const html = read('docs/index.html');
  assert.match(html, /id="leaderboard"/, '发布页缺少排行榜区块');
  assert.match(html, /id="board-tabs"/);
  assert.match(html, /id="board-list"/);
  assert.match(html, /id="board-empty"/, '没接后端时要有说明文案的位置');
  assert.match(html, /type="module"/, 'site.js 得是模块才能 import 排行榜逻辑');

  const site = read('docs/assets/site.js');
  assert.match(site, /from '\.\.\/src\/leaderboard\.js'/, '发布页也要复用同一份纯逻辑');
  assert.match(site, /isConfigured\(boardState\.config\)/, '没配后端时不该发请求');
  assert.match(site, /rankEntries\(/, '排序走共享实现，别在页面上再写一遍');
});

test('APK 内容检查里登记了排行榜的检查项（少一样就红）', () => {
  const checker = read('tools/check-apk-content.py');
  for (const needle of [
    'assets/src/leaderboard.js',
    'LEADERBOARD_METRICS',
    'id="nickname-modal"',
    'id="leaderboard-modal"',
    'id="btn-ending-leaderboard"',
    'recordLeaderboardRun',
    '"table": "leaderboard"',
  ]) {
    assert.ok(checker.includes(needle), `APK 内容检查里少了 ${needle}`);
  }
});

test('浏览器模块图必须收进 leaderboard.js（否则 APK 一装就是白屏）', async () => {
  const { collectModulesChecked } = await import('../tools/module-graph.mjs');
  const path = await import('node:path');
  const { modules, problems } = collectModulesChecked({
    root,
    entries: ['app.js', 'local-api.js', 'relations-view.js'].map((name) => path.join(root, 'web', name)),
    required: ['src/leaderboard.js'],
  });
  assert.deepEqual(problems, [], problems.join('；'));
  assert.ok(modules.includes('src/leaderboard.js'));

  // 两个打包脚本的入口清单也必须带上 app.js
  for (const file of ['tools/build-apk.mjs', 'tools/build-pages.mjs']) {
    const script = read(file);
    assert.match(script, /WEB_ENTRIES = \['app\.js'/, `${file} 的入口清单少了 app.js`);
    assert.match(script, /'src\/leaderboard\.js'/, `${file} 的必需模块清单少了 leaderboard.js`);
  }
});

test('没接后端时一切降级：不发请求、只读本机榜（离线优先）', async () => {
  const config = emptyConfig();
  assert.equal(isConfigured(config), false);
  let called = 0;
  const spy = async () => {
    called += 1;
    return { ok: true, json: async () => [] };
  };
  const board = await fetchBoard(config, { fetchImpl: spy });
  assert.equal(board.ok, false);
  assert.equal(board.reason, 'unconfigured');
  const sent = await submitEntry(config, entry(), { fetchImpl: spy });
  assert.equal(sent.ok, false);
  assert.equal(called, 0, '没配置就一个请求都不许发');
});

test('配置文件本身必须合法：要么留空（离线优先），要么是 https + 像样的 anon key', () => {
  const config = JSON.parse(read('web/content/leaderboard.json'));
  assert.equal(config.format, 1);
  assert.match(config.supabase.table, /^[a-z_][a-z0-9_]*$/, '表名要是合法的 Postgres 标识符');
  assert.match(config.note, /RLS|anon/);

  const { url, anonKey } = config.supabase;
  if (!url && !anonKey) {
    assert.equal(isConfigured(config), false, '留空就是没配后端');
    return;
  }
  assert.match(url, /^https:\/\/[a-z0-9-]+\.supabase\.co$/, 'url 必须是这个 Supabase 项目的 https 地址');
  // anon key 是 JWT：三段 base64url，第二段里能解出 role=anon
  assert.match(anonKey, /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/, 'anon key 应该是形如 JWT 的公钥');
  const payload = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(payload.role, 'anon', '前端只能放 anon key，绝不能是 service_role');
  assert.equal(isConfigured(config), true);
});

test('建表 SQL 只给匿名读和插，绝不给改和删', () => {
  const example = read('tools/leaderboard-schema.sql');
  assert.match(example, /create table if not exists public\.leaderboard/);
  assert.match(example, /enable row level security/, '必须开 RLS');
  assert.match(example, /for select using \(true\)/);
  assert.match(example, /for insert with check \(true\)/);
  assert.ok(!/for update/i.test(example), '绝不能给匿名 update 权限');
  assert.ok(!/for delete/i.test(example), '绝不能给匿名 delete 权限');
  assert.match(example, /check \(score is null or \(score >= 0 and score <= 750\)\)/, '数据库层也要挡住越界分数');
});
