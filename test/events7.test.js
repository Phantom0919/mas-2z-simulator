/**
 * 一周日常事件（events7.js）自检（v3.3）。
 *
 * 内容文件最容易出的四类问题，这里各钉一条：
 *   1. **撞 id**：新事件和前面六批重名 → 引擎的 EVENT_MAP 会悄悄覆盖；
 *   2. **忘了登记日历**：`test/calendar.test.js` 会红，但那边的报错不如这里直接；
 *   3. **选项跑不通**：文案里写了个不存在的字段、或者函数里访问了 undefined →
 *      真正跑一遍每个选项（含 risk 分支）才算过关；
 *   4. **成就 flag 对不上**：成就挂在某个 flag 上，但没有任何选项写这个 flag → 永远拿不到。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DAILY_ACHIEVEMENTS, DAILY_EVENTS } from '../src/data/events7.js';
import { CAMPUS_EVENTS } from '../src/data/events5.js';
import { CHAIN_EVENTS } from '../src/data/events6.js';
import { EVENTS } from '../src/data/events.js';
import { EXTRA_EVENTS } from '../src/data/events2.js';
import { SEASONAL_EVENTS } from '../src/data/events3.js';
import { ABSTRACT_EVENTS } from '../src/data/events4.js';
import { EVENT_SCHEDULE } from '../src/data/calendar.js';
import { createGame, resolveEvent, viewState } from '../src/engine.js';

const ALL_OTHER = [...EVENTS, ...EXTRA_EVENTS, ...SEASONAL_EVENTS, ...ABSTRACT_EVENTS, ...CAMPUS_EVENTS, ...CHAIN_EVENTS];
const OTHER_IDS = new Set(ALL_OTHER.map((event) => event.id));

test('8 个新事件，字段齐全，id 不与前面六批撞名', () => {
  assert.equal(DAILY_EVENTS.length, 8, '这一批应该是 8 个事件');
  const seen = new Set();
  for (const event of DAILY_EVENTS) {
    assert.ok(event.id && /^[a-z][a-z0-9_]*$/.test(event.id), `id 不合法：${event.id}`);
    assert.ok(!OTHER_IDS.has(event.id), `id 与前面几批撞名：${event.id}`);
    assert.ok(!seen.has(event.id), `这一批内部撞名：${event.id}`);
    seen.add(event.id);

    assert.ok(event.name && event.icon && event.text, `${event.id} 缺 name/icon/text`);
    assert.equal(event.kind, 'choice', `${event.id} 这一批只写选择事件`);
    assert.ok(Number.isFinite(event.weight) && event.weight > 0, `${event.id} 的 weight 不合法`);
    assert.equal(event.choices.length, 3, `${event.id} 应该有 3 个选项`);
    for (const choice of event.choices) {
      assert.ok(choice.id && choice.label && choice.outcome, `${event.id} 的选项缺字段`);
      assert.ok(choice.hint, `${event.id}/${choice.id} 缺 hint（玩家要看到代价）`);
      assert.ok(choice.effect, `${event.id}/${choice.id} 缺 effect`);
    }
  }
});

test('每个新事件都登记了日历，而且窗口在本局真实可达', () => {
  for (const event of DAILY_EVENTS) {
    const schedule = EVENT_SCHEDULE[event.id];
    assert.ok(schedule, `${event.id} 没登记日历（EVENT_SCHEDULE）`);
    // 窗口里的学期必须落在 0~5；minWeek 不能超过最短的学期周数（3）
    if (schedule.semester !== undefined) {
      assert.ok(schedule.semester >= 0 && schedule.semester <= 5, `${event.id} 的学期序号越界`);
    }
    if (schedule.minWeek !== undefined) {
      assert.ok(schedule.minWeek <= 3, `${event.id} 的 minWeek=${schedule.minWeek} 在最短学期（3 周）里永远到不了`);
    }
  }
});

test('每个选项都能被真实引擎跑通（含 risk 分支），不吃异常、不写脏字段', () => {
  let resolved = 0;
  let riskRolled = 0;
  for (const event of DAILY_EVENTS) {
    for (const choice of event.choices) {
      const game = createGame({ name: '自检', seed: `events7-${event.id}-${choice.id}`, weeksPerSemester: 6 });
      // 状态拉到"最糟"再跑一遍：risk 分支大多是状态差才会触发
      game.stats.mood = 12;
      game.stats.physique = 22;
      game.stats.fatigue = 78;
      game.knowledge.math = 30;
      game.knowledge.chinese = 30;

      game.pendingEvent = { id: event.id, name: event.name, icon: event.icon, story: false, text: event.text, choices: event.choices };
      const before = JSON.stringify({ stats: game.stats, npc: game.npc, flags: game.flags });
      resolveEvent(game, choice.id);
      resolved += 1;
      const after = JSON.stringify({ stats: game.stats, npc: game.npc, flags: game.flags });
      assert.notEqual(after, before, `${event.id}/${choice.id} 什么都没改变`);

      // 数值必须留在合法区间：这一条挡住"心情掉到 -30"这种手滑
      for (const [key, value] of Object.entries(game.stats)) {
        if (key === 'money') continue;
        assert.ok(value >= -10 && value <= 100, `${event.id}/${choice.id} 把 ${key} 改成了 ${value}`);
      }
      assert.ok(game.pendingEvent === null, `${event.id}/${choice.id} 结束后不该还挂着待处理事件`);
      const view = viewState(game);
      assert.ok(!JSON.stringify(view.log).includes('undefined'), `${event.id}/${choice.id} 的文案里有 undefined`);
      if (choice.effect && typeof choice.effect === 'function') riskRolled += 1;
    }
  }
  assert.equal(resolved, 24, '8 个事件 × 3 个选项都要跑一遍');
  assert.ok(riskRolled >= 3, '带风险的选项（effect 是函数）至少要有 3 个');
});

test('成就的 flag 真的会被某个选项写出来（否则永远拿不到）', () => {
  const written = new Set();
  const collect = (effect) => {
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.flags) for (const key of Object.keys(node.flags)) written.add(key);
      for (const risk of node.risk ?? []) visit(risk.effect);
    };
    if (typeof effect === 'function') {
      // 函数式 effect：拿一个各种状态都试一遍，尽量把分支里的 flag 挖出来
      for (const mood of [80, 12]) {
        for (const physique of [80, 22]) {
          const game = createGame({ name: '自检', seed: `flag-${mood}-${physique}` });
          game.stats.mood = mood;
          game.stats.physique = physique;
          game.stats.fatigue = 30;
          visit(effect(game));
        }
      }
      return;
    }
    visit(effect);
  };
  for (const event of DAILY_EVENTS) for (const choice of event.choices) collect(choice.effect);

  assert.ok(DAILY_ACHIEVEMENTS.length >= 3, '至少给几个"不容易做到的事"发成就');
  for (const item of DAILY_ACHIEVEMENTS) {
    assert.ok(written.has(item.flag), `成就 flag「${item.flag}」没有任何选项会写它（永远拿不到）`);
    assert.ok(item.icon && item.name && item.desc, `成就 ${item.flag} 缺文案`);
  }
});

test('文案里没有占位符残留（{xxx} 都要能被引擎解析）', () => {
  for (const event of DAILY_EVENTS) {
    const text = [event.text, ...event.choices.map((choice) => choice.outcome)].join('\n');
    for (const match of text.matchAll(/\{([^}]+)\}/g)) {
      // 引擎认这几种：name / subject / 人物名与人物属性 / 分数占位
      assert.match(match[1], /^[a-z][a-z0-9_.]*$/i, `${event.id} 里有奇怪的占位符 {${match[1]}}`);
    }
  }
});
