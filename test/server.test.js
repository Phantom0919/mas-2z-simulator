/**
 * 网页服务端测试：真的监听一个随机端口，用 fetch 打接口。
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { createGameServer } from '../src/server.js';
import { BACKGROUNDS, TRAITS } from '../src/data/character.js';

async function withServer(run) {
  const server = createGameServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base, server);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

const post = (base, path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function newGame(base, overrides = {}) {
  const response = await post(base, '/api/new', {
    name: '接口测试',
    seed: 'api-1',
    track: 'physics',
    electives: ['chemistry', 'biology'],
    traits: ['memory', 'easygoing'],
    background: 'magang',
    goal: 'c985',
    ...overrides,
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('健康检查返回会话数', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(typeof data.sessions, 'number');
  });
});

test('首页与静态资源可访问', async () => {
  await withServer(async (base) => {
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
    assert.match(await html.text(), /马鞍山二中模拟器/);

    const css = await fetch(`${base}/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    const missing = await fetch(`${base}/nope.js`);
    assert.equal(missing.status, 404);
  });
});

test('/src/** 能取到引擎源码（否则页面会因为模块 404 白屏）', async () => {
  await withServer(async (base) => {
    // web/local-api.js 里写的是 `../src/engine.js`，浏览器会请求 /src/engine.js。
    // 之前只把 web/ 设成静态根目录，这一批请求全是 404，整个页面起不来。
    for (const file of [
      'src/engine.js',
      'src/rng.js',
      'src/story.js',
      'src/tree.js',
      'src/data/events3.js',
      'src/data/calendar.js',
      'src/data/cast.js',
      'src/data/names.js',
      'src/data/story.js',
    ]) {
      const response = await fetch(`${base}/${file}`);
      assert.equal(response.status, 200, `/${file} 应该能访问到`);
      assert.match(response.headers.get('content-type'), /javascript/, `/${file} 的 MIME 应该是 JS`);
      assert.ok((await response.text()).length > 0);
    }

    // 不能顺着 /src/ 跑到项目其它目录去
    const escape = await fetch(`${base}/src/../package.json`);
    assert.equal(escape.status, 404, '/src/../ 不该能读到项目根目录的文件');
  });
});

test('/api/options 提供开局构筑需要的全部选项', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/options`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.tracks.length, 2);
    // 跟数据源对齐，别写死数字（加天赋的时候这种断言最容易漏改）
    assert.equal(data.traits.length, TRAITS.length);
    assert.ok(data.traits.length >= 10);
    assert.equal(data.backgrounds.length, BACKGROUNDS.length);
    assert.equal(data.goals.length >= 9, true);
    assert.equal(data.electivePick, 2);
    assert.equal(data.electives.length, 4);
    assert.ok(Array.isArray(data.catalog) && data.catalog.length >= 20);
    assert.ok(data.catalog.every((item) => item.id && item.title && item.hint));
    assert.doesNotThrow(() => JSON.stringify(data));
  });
});

test('新开一局：构筑参数生效，两段制推进正确', async () => {
  await withServer(async (base) => {
    const { gameId, view } = await newGame(base);
    assert.equal(view.phase, 'main');
    assert.equal(view.subjects.length, 6);
    assert.equal(view.selection.track, '物理类');
    assert.deepEqual(view.selection.electives, ['chemistry', 'biology']);
    assert.equal(view.build.background.name, '马钢职工子弟');
    assert.equal(view.build.goal.id, 'c985');
    assert.equal(view.build.traits.length, 2);
    assert.equal(view.npc.length, 7);
    assert.ok(view.shop.length >= 8);
    assert.ok(view.actions.every((action) => action.phase !== 'weekend'));

    const main = await post(base, '/api/action', { gameId, actionId: 'listen' });
    assert.equal(main.status, 200);
    const afterMain = await main.json();
    assert.ok(afterMain.lines.length > 0);
    assert.equal(afterMain.view.phase, 'weekend');
    assert.equal(afterMain.view.week, 1);
    assert.ok(afterMain.view.actions.every((action) => action.phase !== 'main'));

    const weekend = await post(base, '/api/action', { gameId, actionId: 'sport' });
    const afterWeekend = await weekend.json();
    assert.equal(afterWeekend.view.phase, 'main');
    assert.equal(afterWeekend.view.week, 2);
    assert.equal(afterWeekend.view.turn, 1);
  });
});

test('选科与商店接口', async () => {
  await withServer(async (base) => {
    const { gameId, view } = await newGame(base, { track: 'history', electives: ['politics', 'geography'] });
    assert.equal(view.selection.track, '历史类');
    assert.deepEqual(view.selection.electives, ['politics', 'geography']);

    const moneyBefore = view.stats.money;
    const bought = await post(base, '/api/shop', { gameId, itemId: 'workbook' });
    assert.equal(bought.status, 200);
    const payload = await bought.json();
    assert.ok(payload.lines.length > 0);
    assert.equal(payload.view.stats.money, moneyBefore - 320);
    assert.equal(payload.view.items.length, 1);
    assert.equal(payload.view.turn, 0, '买东西不消耗时间');

    const again = await post(base, '/api/shop', { gameId, itemId: 'workbook' });
    assert.equal(again.status, 400);
    assert.match((await again.json()).error, /已经买过/);
  });
});

test('需要选科的行动与事件接口', async () => {
  await withServer(async (base) => {
    const { gameId } = await newGame(base);

    const noSubject = await post(base, '/api/action', { gameId, actionId: 'drill' });
    assert.equal(noSubject.status, 400);
    assert.match((await noSubject.json()).error, /科目/);

    const badSubject = await post(base, '/api/action', { gameId, actionId: 'drill', subject: 'politics' });
    assert.equal(badSubject.status, 400);
    assert.match((await badSubject.json()).error, /可选范围/);

    const ok = await post(base, '/api/action', { gameId, actionId: 'drill', subject: 'math' });
    assert.equal(ok.status, 200);
    const payload = await ok.json();
    assert.equal(payload.view.phase, 'weekend');

    // 事件接口：没有待处理事件时应该报错
    const badEvent = await post(base, '/api/event', { gameId, choiceId: 'x' });
    assert.equal(badEvent.status, 400);
    assert.match((await badEvent.json()).error, /没有待处理的事件/);
  });
});

test('存档导出 / 导入 / 时间线接口', async () => {
  await withServer(async (base) => {
    const { gameId } = await newGame(base, { seed: 'api-save' });
    await post(base, '/api/action', { gameId, actionId: 'listen' });
    await post(base, '/api/action', { gameId, actionId: 'sport' });

    const exported = await fetch(`${base}/api/export?gameId=${encodeURIComponent(gameId)}`);
    assert.equal(exported.status, 200);
    const { save } = await exported.json();
    assert.match(save, /"version":2/);

    const imported = await post(base, '/api/import', { save });
    assert.equal(imported.status, 200);
    const reimported = await imported.json();
    assert.equal(reimported.view.turn, 1);
    assert.equal(reimported.view.phase, 'main');

    const view = await fetch(`${base}/api/view?gameId=${encodeURIComponent(reimported.gameId)}`);
    assert.equal(view.status, 200);
    assert.equal((await view.json()).view.turn, 1);
  });
});

test('人物关系图接口返回可直接画的树', async () => {
  await withServer(async (base) => {
    const { gameId } = await newGame(base, { seed: 'api-relations' });
    const response = await fetch(`${base}/api/relations?gameId=${encodeURIComponent(gameId)}`);
    assert.equal(response.status, 200);
    const data = await response.json();

    assert.equal(data.cast.length, 8, '阵容应该有 8 个人');
    assert.equal(data.graph.nodes.filter((node) => node.kind === 'person').length, 8);
    assert.ok(data.graph.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
    assert.ok(data.graph.width > 0 && data.graph.height > 0);
    assert.equal(data.graph.people.length, 8);
    assert.ok(data.text.includes('家里'), '文字版关系树要有分组');
    // 老师那一组用老师称呼
    assert.ok(/老师/.test(data.text));

    const missing = await fetch(`${base}/api/relations?gameId=g-none`);
    assert.equal(missing.status, 404);
  });
});

test('故事线接口返回目录与进度', async () => {
  await withServer(async (base) => {
    const { gameId } = await newGame(base, { seed: 'api-story' });
    const response = await fetch(`${base}/api/story?gameId=${encodeURIComponent(gameId)}`);
    assert.equal(response.status, 200);
    const data = await response.json();

    assert.equal(data.catalog.length, 7, '应该有 7 条剧情线');
    assert.equal(data.progress.arcs.length, 7);
    assert.equal(data.progress.done, 0, '刚开局还没演剧情');
    assert.ok(data.progress.total >= 30);
    for (const arc of data.catalog) {
      assert.ok(arc.title && arc.icon && arc.intro);
      assert.equal(arc.chapters.length, arc.total);
      assert.ok(arc.chapters.every((chapter) => chapter.unlocked === false && chapter.text === null));
    }

    const missing = await fetch(`${base}/api/story?gameId=g-none`);
    assert.equal(missing.status, 404);
  });
});

test('随机姓名接口给出中文姓名', async () => {
  await withServer(async (base) => {
    for (const gender of ['男', '女']) {
      const response = await fetch(`${base}/api/random-name?gender=${encodeURIComponent(gender)}&seed=api-name`);
      assert.equal(response.status, 200);
      const { name } = await response.json();
      assert.match(name, /^[\u4e00-\u9fa5]{2,4}$/, `${name} 不像中文姓名`);
    }
    // 同一个种子必然同一个名字
    const a = await (await fetch(`${base}/api/random-name?seed=stable`)).json();
    const b = await (await fetch(`${base}/api/random-name?seed=stable`)).json();
    assert.equal(a.name, b.name);
  });
});

test('新开的一局会带上随机人物和剧情计数', async () => {
  await withServer(async (base) => {
    const { view } = await newGame(base, { seed: 'api-cast' });
    assert.equal(view.cast.length, 8);
    assert.equal(view.npc.length, 7);
    assert.ok(view.npc.every((npc) => npc.short));
    assert.equal(view.story.total, view.story.arcs.reduce((sum, arc) => sum + arc.total, 0));
    assert.equal(view.story.done, 0);
    assert.ok(view.relations.people.length === 8);
    assert.ok(view.relations.stats.best);
    // 开局日志里应该点名了这一届的关键人物
    const intro = view.log.find((entry) => entry.title === '这一届的人');
    assert.ok(intro, '开局应该有"这一届的人"这条日志');
    for (const role of ['同桌', '死党', '老对手']) {
      const person = view.cast.find((item) => item.role === role);
      assert.ok(intro.text.includes(person.name), `开局介绍里少了${role}${person.name}`);
    }
    for (const role of ['班主任', '数学老师']) {
      const person = view.cast.find((item) => item.role === role);
      assert.ok(intro.text.includes(`${person.name.slice(0, 1)}老师`), `开局介绍里少了${role}的称呼`);
    }
  });
});

test('接口返回的数据能直接喂给前端渲染函数', async () => {
  const { relationsSvg, storyBodyHtml } = await import('../web/relations-view.js');
  await withServer(async (base) => {
    const { gameId } = await newGame(base, { seed: 'api-render' });
    // 打几周，让关系和剧情都有内容
    for (const actionId of ['drill', 'sport', 'listen', 'social', 'drill', 'sleep']) {
      await post(base, '/api/action', { gameId, actionId, subject: 'math' });
    }

    const relations = await (await fetch(`${base}/api/relations?gameId=${gameId}`)).json();
    const svg = relationsSvg(relations.graph);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(!svg.includes('undefined') && !svg.includes('NaN'));
    assert.equal((svg.match(/<g class="tree-node person"/g) ?? []).length, 8);

    const story = await (await fetch(`${base}/api/story?gameId=${gameId}`)).json();
    const html = storyBodyHtml(story.catalog);
    assert.ok(html.includes('story-arc'));
    assert.ok(!html.includes('undefined') && !html.includes('NaN'));
    assert.equal((html.match(/<section\b/g) ?? []).length, 7);
  });
});

test('非法输入返回 400，未知会话返回 404', async () => {
  await withServer(async (base) => {
    const badAction = await post(base, '/api/action', { gameId: 'g-none', actionId: 'listen' });
    assert.equal(badAction.status, 404);

    const { gameId } = await newGame(base);
    const unknown = await post(base, '/api/action', { gameId, actionId: 'fly' });
    assert.equal(unknown.status, 400);

    const shopMissing = await post(base, '/api/shop', { gameId, itemId: 'nope' });
    assert.equal(shopMissing.status, 400);

    const shopNoGame = await post(base, '/api/shop', { gameId: 'g-none', itemId: 'coffee' });
    assert.equal(shopNoGame.status, 404);

    const unknownApi = await fetch(`${base}/api/whatever`);
    assert.equal(unknownApi.status, 404);
  });
});

/* ------------------------------------------------- 热更新 / 志愿填报 */

test('内容包接口：查看 / 应用 / 拒绝坏包 / 恢复官方', async () => {
  await withServer(async (base) => {
    const before = await (await fetch(`${base}/api/content`)).json();
    assert.equal(before.source, 'official');
    assert.equal(before.pack, null);
    assert.ok(before.eventCount > 0);
    assert.equal(before.eventCount, before.baselineEventCount);

    const pack = {
      format: 1,
      meta: { name: '接口测试包', version: '1.0' },
      events: [{ id: 'srv_pack_event', name: '服务端热更新事件', icon: '🧪', kind: 'auto', weight: 9, text: '来自内容包', effect: { stats: { mood: 2 } } }],
      balance: { eff: { gainScale: 0.9 } },
    };
    const applied = await post(base, '/api/content/apply', { pack });
    assert.equal(applied.status, 200);
    const appliedBody = await applied.json();
    assert.equal(appliedBody.ok, true);
    assert.equal(appliedBody.summary.name, '接口测试包');
    assert.ok(appliedBody.checksum);
    assert.equal(appliedBody.eventCount, before.eventCount + 1);

    const after = await (await fetch(`${base}/api/content`)).json();
    assert.equal(after.source, 'imported');
    assert.equal(after.pack.meta.name, '接口测试包');

    // 坏 JSON / 坏包都要被拒，并且说清原因
    const badText = await post(base, '/api/content/apply', { text: '{不是 json' });
    assert.equal(badText.status, 400);
    assert.match((await badText.json()).error, /JSON/);
    const badPack = await post(base, '/api/content/apply', { pack: { format: 1, meta: { name: 'x' }, events: [{ id: 'broken', kind: 'choice' }] } });
    assert.equal(badPack.status, 400);
    assert.ok((await badPack.json()).errors.length > 0);
    const nothing = await post(base, '/api/content/apply', {});
    assert.equal(nothing.status, 400);

    const reset = await post(base, '/api/content/reset', {});
    assert.equal(reset.status, 200);
    const resetBody = await reset.json();
    assert.equal(resetBody.source, 'official');
    const restored = await (await fetch(`${base}/api/content`)).json();
    assert.equal(restored.eventCount, before.eventCount);
    assert.equal(restored.pack, null);
  });
});

test('志愿填报接口：能给志愿表、能提交、能拿到录取结果', async () => {
  await withServer(async (base) => {
    const { gameId } = await newGame(base, { seed: 'api-volunteer', weeksPerSemester: 3, difficulty: 'easy' });
    let view = (await (await fetch(`${base}/api/view?gameId=${gameId}`)).json()).view;
    let guard = 0;
    while ((view.status === 'playing' || view.status === 'volunteering') && guard < 200) {
      guard += 1;
      if (view.status === 'volunteering') {
        assert.equal(view.volunteer.active, true);
        assert.equal(view.volunteer.slots, 6);
        assert.ok(view.volunteer.options.length > 0);
        assert.ok(view.volunteer.rumor.length > 0);
        const picks = view.volunteer.options
          .slice()
          .sort((a, b) => a.minScore - b.minScore)
          .slice(0, 6)
          .map((option) => option.id);
        const submitted = await post(base, '/api/volunteer', { gameId, picks, adjust: true });
        assert.equal(submitted.status, 200);
        const body = await submitted.json();
        assert.ok(body.lines.length > 0);
        assert.ok(body.ending);
        assert.ok(body.ending.volunteer, '结局要带录取详情');
        view = body.view;
        continue;
      }
      const action = view.phase === 'main' ? { actionId: 'listen' } : { actionId: 'sport' };
      const result = await post(base, '/api/action', { gameId, ...action });
      view = (await result.json()).view;
      let inner = 0;
      while (view.pendingEvent && view.status === 'playing' && inner < 6) {
        inner += 1;
        const resolved = await post(base, '/api/event', { gameId, choiceId: view.pendingEvent.choices[0].id });
        view = (await resolved.json()).view;
      }
    }
    assert.equal(view.status, 'ended');
    assert.equal(view.volunteer.active, false);
    assert.equal(view.volunteer.submitted, true);

    // 不是填志愿的时候再提交 → 400，并且给一句人话
    const late = await post(base, '/api/volunteer', { gameId, picks: [], adjust: true });
    assert.equal(late.status, 400);
    assert.match((await late.json()).error, /填志愿/);
  });
});
