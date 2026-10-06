/**
 * 「给玩家推送更新」测试：清单格式 → 决策矩阵 → 地址护栏 → 真·端到端。
 *
 * 端到端那条最有价值：起一个真实服务端，拉清单 → 装包 → 再拉一次变"已是最新"，
 * 装的过程走的就是内容包那条接口（`/api/content/apply { url }`）——推和拉共用一条链路。
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { checksumPack } from '../src/content.js';
import { createGameServer } from '../src/server.js';
import {
  MAX_MANIFEST_BYTES,
  UPDATE_STATUS,
  compareVersions,
  decideUpdate,
  describeUpdate,
  disabledUpdate,
  emptyManifest,
  hostKind,
  isAllowedManifestUrl,
  normalizeManifest,
  parseVersion,
  resolvePackUrl,
  summarizeUpdate,
  validateManifest,
} from '../src/update.js';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../web/content/${name}`, import.meta.url), 'utf8'));
const officialPack = readJson('official-pack.json');
const manifest = readJson('update-manifest.json');
const endpoint = readJson('update-endpoint.json');

const latest = { version: '2.6.1', url: 'https://example.com/pack.json', checksum: '51333b01' };
const decide = (overrides = {}) =>
  decideUpdate({ manifest: { format: 1, channel: 'stable', latest }, appVersion: '2.6.0', ...overrides });

/* ------------------------------------------------------------- 清单形状 */

test('normalizeManifest：垃圾输入不炸，形状总是对的', () => {
  assert.deepEqual(normalizeManifest(null), emptyManifest());
  assert.equal(normalizeManifest('nonsense').latest, null);
  assert.equal(normalizeManifest({ latest: null }).latest, null);

  // 偷懒写法（顶层直接写 version / url）也认——玩家和运营真的会这么写
  const loose = normalizeManifest({ version: '1.2.3', url: 'https://x/p.json', checksum: 'ABCDEF12', notes: '  hi  ' });
  assert.equal(loose.latest.version, '1.2.3');
  assert.equal(loose.latest.checksum, 'abcdef12', '校验和统一小写');
  assert.equal(loose.latest.notes, 'hi');

  const long = normalizeManifest({ latest: { ...latest, notes: 'x'.repeat(500) } });
  assert.equal(long.latest.notes.length, 200, '超长说明要截断');
});

test('validateManifest：缺 version / url / checksum 都要报，并说清缺哪个', () => {
  for (const field of ['version', 'url', 'checksum']) {
    const broken = { ...latest };
    delete broken[field];
    const result = validateManifest(normalizeManifest({ format: 1, channel: 'stable', latest: broken }));
    assert.equal(result.ok, false, `${field} 缺失应该报错`);
    assert.ok(result.errors.some((error) => error.includes(field)), `${field}: ${result.errors.join('|')}`);
  }
  assert.equal(validateManifest(normalizeManifest({ format: 1, channel: 'stable', latest })).ok, true);
});

test('validateManifest：格式版本 / 通道写错是错误，校验和写法怪只是警告', () => {
  const badFormat = validateManifest(normalizeManifest({ format: 99, channel: 'stable', latest }));
  assert.equal(badFormat.ok, false);
  assert.match(badFormat.errors[0], /format 1/);

  const badChannel = validateManifest(normalizeManifest({ format: 1, channel: 'nightly', latest }));
  assert.equal(badChannel.ok, false);
  assert.match(badChannel.errors[0], /通道/);

  const oddChecksum = validateManifest(normalizeManifest({ format: 1, channel: 'stable', latest: { ...latest, checksum: 'sha256:zzz' } }));
  assert.equal(oddChecksum.ok, true, '写法怪但能用：只警告，别把玩家挡在门外');
  assert.equal(oddChecksum.warnings.length, 1);
});

/* --------------------------------------------------------------- 决策 */

test('decideUpdate：没装过 = 有新内容，相对地址按清单自己的位置解析成绝对地址', () => {
  const decision = decide({
    manifest: { format: 1, channel: 'stable', latest: { ...latest, url: 'pack.json' } },
    manifestUrl: 'https://example.com/upd/update-manifest.json',
  });
  assert.equal(decision.status, UPDATE_STATUS.UPDATE);
  assert.equal(decision.actionable, true);
  assert.equal(decision.packUrl, 'https://example.com/upd/pack.json');
  assert.equal(decision.auto, false, '没写 auto 就必须玩家自己点');
});

test('decideUpdate：checksum 相同就是最新；版本号没变但校验和变了照样推', () => {
  const same = decide({ installed: { checksum: '51333b01', version: '2.6.1' } });
  assert.equal(same.status, UPDATE_STATUS.UP_TO_DATE);
  assert.equal(same.actionable, false);

  const resend = decide({ installed: { checksum: 'ffffffff', version: '2.6.1' } });
  assert.equal(resend.status, UPDATE_STATUS.UPDATE, '同一版本号重发一次改过的包，必须能推下去');
});

test('decideUpdate：忽略过的版本不再提示，换了一版还会提示', () => {
  assert.equal(decide({ ignoredChecksum: '51333b01' }).status, UPDATE_STATUS.IGNORED);
  assert.equal(decide({ ignoredChecksum: '51333b01' }).actionable, false);
  assert.equal(decide({ ignoredChecksum: 'deadbeef' }).status, UPDATE_STATUS.UPDATE);
  assert.equal(
    decide({ ignoredChecksum: '51333b01', installed: { checksum: '51333b01', version: '2.6.1' } }).status,
    UPDATE_STATUS.UP_TO_DATE,
    '"已装"优先于"忽略"',
  );
});

test('decideUpdate：绝不自动降级（玩家手里的包可能比线上新）', () => {
  const decision = decide({ installed: { checksum: 'ffffffff', version: '2.9.0' } });
  assert.equal(decision.status, UPDATE_STATUS.DOWNGRADE);
  assert.equal(decision.auto, false);
  assert.equal(decision.actionable, true, '要提示，但必须玩家自己点');
});

test('decideUpdate：通道不匹配 / 需要更高的游戏本体版本，都不推', () => {
  assert.equal(decide({ manifest: { format: 1, channel: 'beta', latest } }).status, UPDATE_STATUS.CHANNEL);
  assert.equal(decide({ channel: 'beta', manifest: { format: 1, channel: 'beta', latest } }).status, UPDATE_STATUS.UPDATE);

  const tooNew = decide({ manifest: { format: 1, channel: 'stable', latest: { ...latest, requires: { app: '>=3.0.0' } } } });
  assert.equal(tooNew.status, UPDATE_STATUS.INCOMPATIBLE);
  assert.equal(tooNew.actionable, false);

  const fits = decide({ manifest: { format: 1, channel: 'stable', latest: { ...latest, requires: { app: '>=2.6.0' } } } });
  assert.equal(fits.status, UPDATE_STATUS.UPDATE);
});

test('decideUpdate：清单坏了就是 invalid，且什么都不做', () => {
  const decision = decide({ manifest: { format: 1, channel: 'stable', latest: { version: '2.6.1' } } });
  assert.equal(decision.status, UPDATE_STATUS.INVALID);
  assert.equal(decision.actionable, false);
  assert.equal(decision.packUrl, '');
  assert.ok(decision.errors.length > 0);
});

test('decideUpdate：auto / mandatory 只从清单来，不会被别的东西污染', () => {
  const auto = decide({ manifest: { format: 1, channel: 'stable', latest: { ...latest, auto: true } } });
  assert.equal(auto.auto, true);
  assert.equal(auto.mandatory, false);
  const mandatory = decide({ manifest: { format: 1, channel: 'stable', latest: { ...latest, auto: true, mandatory: true } } });
  assert.equal(mandatory.mandatory, true);
});

/* ----------------------------------------------------------- 人话与空态 */

test('describeUpdate / summarizeUpdate：每种状态都有人话，绝不出现 undefined', () => {
  for (const status of Object.values(UPDATE_STATUS)) {
    const text = describeUpdate({ status, reasons: [], latest: null });
    assert.ok(text.length > 0 && !text.includes('undefined'), `${status} 的描述是「${text}」`);
    const view = summarizeUpdate({ status, reasons: [], latest: null });
    assert.equal(typeof view.title, 'string');
    assert.ok(!view.title.includes('undefined'), `${status} 的标题是「${view.title}」`);
    assert.equal(typeof view.canApply, 'boolean');
  }
  assert.ok(!describeUpdate(null).includes('undefined'));
  assert.equal(summarizeUpdate(null).canApply, false);
});

test('disabledUpdate：没配地址时的统一结果', () => {
  const info = disabledUpdate();
  assert.equal(info.status, UPDATE_STATUS.DISABLED);
  assert.equal(info.actionable, false);
  assert.equal(info.latest, null);
  assert.ok(info.reasons[0].includes('更新清单'));
});

/* ----------------------------------------------------------- 地址护栏 */

test('清单地址护栏：https 放行，http 只放行回环 / 内网，file、data、元数据端点一律拒绝', () => {
  assert.equal(isAllowedManifestUrl('https://example.com/update.json'), true);
  assert.equal(isAllowedManifestUrl('http://127.0.0.1:8080/update.json'), true);
  assert.equal(isAllowedManifestUrl('http://192.168.1.10/update.json'), true, '局域网自建服务是正常部署');
  assert.equal(isAllowedManifestUrl('http://example.com/update.json'), false, '公网明文 http 不行');
  assert.equal(isAllowedManifestUrl('file:///C:/secrets.json'), false);
  assert.equal(isAllowedManifestUrl('data:application/json,{}'), false);
  assert.equal(isAllowedManifestUrl('http://169.254.169.254/latest/meta-data/'), false, '云元数据端点是最经典的 SSRF 靶子');
  assert.equal(isAllowedManifestUrl('这不是一个地址'), false);
  assert.equal(isAllowedManifestUrl(''), false);

  assert.equal(hostKind('localhost'), 'loopback');
  assert.equal(hostKind('127.0.0.1'), 'loopback');
  assert.equal(hostKind('10.1.2.3'), 'private');
  assert.equal(hostKind('172.20.5.5'), 'private');
  assert.equal(hostKind('192.168.3.4'), 'private');
  assert.equal(hostKind('8.8.8.8'), 'public');
  assert.equal(hostKind('999.1.1.1'), 'invalid');
});

test('resolvePackUrl / compareVersions / parseVersion：地址与版本的小工具', () => {
  assert.equal(resolvePackUrl('https://a.com/x/m.json', 'p.json'), 'https://a.com/x/p.json');
  assert.equal(resolvePackUrl('https://a.com/x/m.json', '/p.json'), 'https://a.com/p.json');
  assert.equal(resolvePackUrl('https://a.com/x/m.json', 'https://b.com/p.json'), 'https://b.com/p.json');
  assert.equal(resolvePackUrl('', 'https://b.com/p.json'), 'https://b.com/p.json');
  assert.equal(resolvePackUrl('https://a.com/m.json', ''), '');

  assert.equal(compareVersions('2.6.1', '2.6.0'), 1);
  assert.equal(compareVersions('2.6', '2.6.0'), 0, '两段等于补零');
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1, '按段比较，不是字符串比较');
  assert.deepEqual(parseVersion('2.6'), [2, 6, 0]);
  assert.deepEqual(parseVersion('乱写'), [0, 0, 0]);
});

/* ------------------------------------------- 仓库里的示例（防漂移守门） */

test('示例清单和示例包对得上：改了包不改清单，推送会永远显示"有新内容"', () => {
  assert.equal(manifest.channel, 'stable');
  assert.equal(manifest.latest.url, 'official-pack.json');
  assert.equal(
    manifest.latest.checksum,
    checksumPack(officialPack),
    'update-manifest.json 里的校验和必须等于 official-pack.json 的真实校验和',
  );
  assert.equal(validateManifest(normalizeManifest(manifest)).ok, true);
  assert.ok(MAX_MANIFEST_BYTES >= 1024);
});

test('默认配置必须是"不检查更新"（离线优先，装了 APK 的人不该被死地址拖住）', () => {
  assert.equal(typeof endpoint.manifest, 'string');
  assert.equal(endpoint.manifest, '', 'web/content/update-endpoint.json 的 manifest 默认要留空');
  assert.ok(['stable', 'beta'].includes(endpoint.channel));
});

/* ----------------------------------------------------------- 端到端 */

async function withServer(run, options = {}) {
  const server = createGameServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

const postJson = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('端到端：拉清单 → 装包 → 再拉一次变"已是最新"（推和拉走同一条链路）', async () => {
  await withServer(async (base) => {
    const manifestUrl = `${base}/content/update-manifest.json`;
    const check = async (extra = '') => (await fetch(`${base}/api/update?url=${encodeURIComponent(manifestUrl)}${extra}`)).json();

    // ① 没配地址：一次网络请求都不发
    const off = await (await fetch(`${base}/api/update`)).json();
    assert.equal(off.status, UPDATE_STATUS.DISABLED);

    // ② 客户端问一句：服务端代拉清单，给出结论和绝对包地址
    const first = await check();
    assert.equal(first.status, UPDATE_STATUS.UPDATE, JSON.stringify(first));
    assert.equal(first.latest.checksum, manifest.latest.checksum);
    assert.equal(first.packUrl, `${base}/content/official-pack.json`);
    assert.equal(first.installed, null, '还没装过内容包');

    // ③ 玩家点"忽略这个版本"：同一个校验和不再提示
    const ignored = await check(`&ignored=${first.latest.checksum}`);
    assert.equal(ignored.status, UPDATE_STATUS.IGNORED);

    // ④ 点"立即更新"：走的就是内容包那条接口，装完事件数真的变多
    const applied = await (await postJson(base, '/api/content/apply', { url: first.packUrl })).json();
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.eventCount, applied.baselineEventCount + 2);
    assert.equal(applied.checksum, manifest.latest.checksum);

    // ⑤ 再问一次：已是最新（哪怕带着"忽略"，已装也优先）
    const second = await check(`&ignored=${first.latest.checksum}`);
    assert.equal(second.status, UPDATE_STATUS.UP_TO_DATE, JSON.stringify(second));
    assert.equal(second.installed.checksum, manifest.latest.checksum);

    // ⑥ 收尾：还原引擎内容，别影响同文件里后面的测试
    const reset = await (await postJson(base, '/api/content/reset', {})).json();
    assert.equal(reset.ok, true);
    assert.equal(reset.active, false);
    const afterReset = await check();
    assert.equal(afterReset.status, UPDATE_STATUS.UPDATE, '还原之后又变回"有新内容"');
  });
});

test('端到端：服务端配置的清单地址（--update-url 那条路）也生效', async () => {
  // 起一个"托管清单"的服务，再起一个"客户端访问的"服务，后者把前者写进配置
  await withServer(async (host) => {
    await withServer(
      async (base) => {
        const info = await (await fetch(`${base}/api/update`)).json();
        assert.equal(info.status, UPDATE_STATUS.UPDATE, JSON.stringify(info));
        assert.equal(info.packUrl, `${host}/content/official-pack.json`);
      },
      { updateUrl: `${host}/content/update-manifest.json` },
    );
  });
});

test('端到端：清单拉不到是 unreachable，地址不合规是 invalid（界面提示完全不同）', async () => {
  await withServer(async (base) => {
    // 9 端口基本不会有人听：连接被拒 → 拉不到
    const unreachable = await (await fetch(`${base}/api/update?url=${encodeURIComponent('http://127.0.0.1:9/none.json')}`)).json();
    assert.equal(unreachable.status, UPDATE_STATUS.UNREACHABLE, JSON.stringify(unreachable));
    assert.equal(unreachable.actionable, false);
    assert.ok(unreachable.reasons[0].includes('拉取更新清单失败'));

    const invalid = await (await fetch(`${base}/api/update?url=${encodeURIComponent('file:///C:/secrets.json')}`)).json();
    assert.equal(invalid.status, UPDATE_STATUS.INVALID);
    assert.equal(invalid.actionable, false);
  });
});

test('端到端：清单本体是坏 JSON 时只说清单有问题，不会把服务打挂', async () => {
  await withServer(async (base) => {
    // 随便找一个必然不是 JSON 的静态资源当清单
    const url = `${base}/style.css`;
    const info = await (await fetch(`${base}/api/update?url=${encodeURIComponent(url)}`)).json();
    assert.equal(info.status, UPDATE_STATUS.UNREACHABLE, '解析失败也算拉不到，但不是崩溃');
    assert.ok(info.reasons[0].length > 0);
  });
});

/* ------------------------------------------------- 离线（手机 / 桌面） */

test('离线模式：没有服务端时走页面内实现，同源清单也能判（手机 APK 走的就是这条）', async () => {
  const { createLocalApi } = await import('../web/local-api.js');
  const api = createLocalApi();

  // ① 没有 location / 拉不到配置文件时不能炸：结论就是"未启用"
  const off = await api.request('/api/update');
  assert.equal(off.status, UPDATE_STATUS.DISABLED);

  // ② 造一个假的页面环境：同源的端点配置 + 清单
  const originalLocation = globalThis.location;
  const originalFetch = globalThis.fetch;
  const files = {
    // 端点配置是相对路径读的（浏览器里由文档地址解析）
    'content/update-endpoint.json': JSON.stringify({ format: 1, manifest: 'content/update-manifest.json', channel: 'stable' }),
    'https://mas2z.local/content/update-manifest.json': JSON.stringify(manifest),
  };
  globalThis.location = { href: 'https://mas2z.local/index.html', origin: 'https://mas2z.local' };
  globalThis.fetch = async (target) => {
    const text = files[target];
    if (text === undefined) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => text };
  };
  try {
    const info = await api.request('/api/update');
    assert.equal(info.status, UPDATE_STATUS.UPDATE, JSON.stringify(info));
    assert.equal(info.packUrl, 'https://mas2z.local/content/official-pack.json', '相对地址按清单自己的位置解析');
    assert.equal(info.installed, null);

    // ③ 跨域但只给了回环 http：地址准入照样拦得住
    const blocked = await api.request(`/api/update?url=${encodeURIComponent('file:///C:/secrets.json')}`);
    assert.equal(blocked.status, UPDATE_STATUS.INVALID);
  } finally {
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
    globalThis.fetch = originalFetch;
  }
});
