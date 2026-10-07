#!/usr/bin/env node
/**
 * 生成 GitHub Pages 发布页（docs/）。
 *
 *   python tools/build-pages-shots.py   # 第一次 / 界面改了以后：压截图、出分享图
 *   node tools/build-pages.mjs          # 每次发版：同步在线试玩副本 + APK + 清单
 *
 * 分工刻意划清楚：
 *   手写的（不会被覆盖）：docs/index.html、docs/assets/style.css、docs/assets/site.js
 *   生成的（本脚本负责）：docs/play/**（web/ 的副本）、docs/src/**（浏览器要用的引擎模块）、
 *                       docs/download/**（APK + latest.json）、docs/content/**（推送源）、
 *                       docs/.nojekyll
 *
 * 为什么要把 web/ 和 src/ 复制一份到 docs/：
 *   GitHub Pages 只能托管一个目录。复制一份（保持 web/ 与 src/ 的相对关系，
 *   app.js 里的 `../src/engine.js` 才解析得到）就能让访客「点开就玩」，
 *   而不用先下载 0.5 MB 的 APK。副本会被测试盯着和真源逐字节比对，不会偷偷漂移。
 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { deflateRawSync } from 'node:zlib';

import { collectModulesChecked } from './module-graph.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const DIST = path.join(ROOT, 'dist');

/** 浏览器端的入口（和 build-apk.mjs 一致：APK 与发布页共享同一份模块图）。 */
const WEB_ENTRIES = ['local-api.js', 'relations-view.js'];
const REQUIRED_MODULES = [
  'src/engine.js',
  'src/rng.js',
  'src/story.js',
  'src/tree.js',
  'src/data/school.js',
  'src/data/character.js',
  'src/data/items.js',
  'src/data/actions.js',
  'src/data/events.js',
  'src/data/events2.js',
  'src/data/names.js',
  'src/data/cast.js',
  'src/data/story.js',
];
const FORBIDDEN_MODULES = ['src/server.js', 'src/cli.js', 'src/profile.js', 'src/prompt.js', 'src/strategies.js'];

/** APK 在发布页上的固定文件名（不带版本号：页面上的版本号由 latest.json 提供）。 */
const APK_NAME = '马鞍山二中模拟器-安卓版.apk';
const APK_LINK = `./download/${APK_NAME}`;

const log = (...args) => console.log('[pages]', ...args);

function fail(message) {
  console.error(`[pages] 失败：${message}`);
  process.exit(1);
}

/* ---------------------------------------------------------------- 准备 */

function readPackage() {
  return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

function findApk(version) {
  const expected = path.join(DIST, `马鞍山二中模拟器-${version}-debug.apk`);
  if (existsSync(expected)) return expected;
  const candidates = existsSync(DIST)
    ? readdirSync(DIST)
        .filter((name) => name.endsWith('.apk'))
        .map((name) => path.join(DIST, name))
    : [];
  if (candidates.length === 0) fail(`dist/ 里没有 APK，先跑 npm run apk（期望 ${path.basename(expected)}）`);
  const newest = candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  fail(`找不到 ${path.basename(expected)}，最新的是 ${path.basename(newest)}——先跑 npm run apk 把版本对齐`);
  return newest;
}

function copyTree(from, to) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

/* ------------------------------------------------ 1. 在线试玩副本 */

function buildPlayCopy() {
  copyTree(path.join(ROOT, 'web'), path.join(DOCS, 'play'));

  const { modules, problems } = collectModulesChecked({
    root: ROOT,
    entries: WEB_ENTRIES.map((name) => path.join(ROOT, 'web', name)),
    required: REQUIRED_MODULES,
    forbidden: FORBIDDEN_MODULES,
  });
  if (problems.length > 0) fail(problems.join('；'));

  const engineModules = modules.filter((name) => name.startsWith('src/'));
  rmSync(path.join(DOCS, 'src'), { recursive: true, force: true });
  for (const module of engineModules) {
    const target = path.join(DOCS, ...module.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(ROOT, ...module.split('/')), target);
  }
  log(`在线试玩副本：web/ → docs/play/，引擎 ${engineModules.length} 个模块 → docs/src/`);
}

/* --------------------------------------------------- 2. APK + 版本信息 */

function buildDownload(version) {
  const apk = findApk(version);
  const bytes = readFileSync(apk);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  mkdirSync(path.join(DOCS, 'download'), { recursive: true });
  const target = path.join(DOCS, 'download', APK_NAME);
  writeFileSync(target, bytes);

  const info = {
    format: 1,
    version,
    file: APK_NAME,
    url: APK_LINK,
    bytes: bytes.length,
    sha256,
    builtAt: new Date().toISOString(),
    note: 'debug 签名，安装时系统会提示「未知来源应用」，功能不受影响。',
  };
  writeFileSync(path.join(DOCS, 'download', 'latest.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8');
  log(`安卓包：${path.basename(apk)} → docs/download/${APK_NAME}（${Math.round(bytes.length / 1024)} KB）`);
  log(`   sha256 ${sha256}`);
  return info;
}

/* ------------------------------------------------ 3. 推送源（顺手的） */

function buildContentSource() {
  const sourceDir = path.join(ROOT, 'web', 'content');
  const targetDir = path.join(DOCS, 'content');
  mkdirSync(targetDir, { recursive: true });

  // 内容包：发布页和 APK 里的示例包是同一份文件
  cpSync(path.join(sourceDir, 'official-pack.json'), path.join(targetDir, 'official-pack.json'));

  // 更新清单：从仓库里那份「可以照抄的示例」派生，只把包地址改成同目录的相对路径
  const manifest = JSON.parse(readFileSync(path.join(sourceDir, 'update-manifest.json'), 'utf8'));
  manifest.latest = { ...manifest.latest, url: 'official-pack.json' };
  manifest.note = 'GitHub Pages 自带 CORS 头，所以手机上的离线版也能直接从这个地址检查更新。';
  writeFileSync(path.join(targetDir, 'update-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  log(`推送源：docs/content/update-manifest.json（latest ${manifest.latest.version}，校验和 ${manifest.latest.checksum}）`);
}

/* ------------------------------------------------------------ 4. 自检 */

/** 页面引用的每一张本地截图都必须真实存在——不然发布页就是一堆破图。 */
function checkShotAssets() {
  const html = readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/src="\.\/(assets\/shots\/[^"]+)"/g)].map((match) => match[1]);
  if (refs.length === 0) fail('docs/index.html 里没有引用任何截图，页面大概没写完');
  const missing = refs.filter((ref) => !existsSync(path.join(DOCS, ...ref.split('/'))));
  if (missing.length > 0) {
    fail(`缺少截图 ${missing.join('、')}——先跑 python tools/build-pages-shots.py`);
  }
  log(`截图：index.html 引用的 ${refs.length} 张都存在`);
  for (const name of ['assets/style.css', 'assets/site.js', 'assets/icon-192.png', 'assets/og.jpg']) {
    if (!existsSync(path.join(DOCS, ...name.split('/')))) fail(`缺少 docs/${name}`);
  }
}

/* ------------------------------------------------------------- 5. 打包 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/**
 * 写一个 zip（只用 zlib，不引依赖）。
 *
 * 时间戳写死成 2000-01-01：内容相同 → 字节相同，方便比对两次打包有没有变化。
 * 文件名统一用 UTF-8（general purpose bit 11），中文路径在 Windows / Linux / macOS 都能解开。
 */
function writeZip(files, target) {
  const DOS_TIME = 0;
  const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    chunks.push(local, nameBuffer, deflated);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(deflated.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuffer.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // 外部属性：普通文件
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuffer);

    offset += local.length + nameBuffer.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  rmSync(target, { force: true });
  writeFileSync(target, Buffer.concat([...chunks, centralBuffer, end]));
  return target;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push({ name: path.relative(base, full).split(path.sep).join('/'), full });
  }
  return out;
}

function packZip(version) {
  const entries = listFiles(DOCS).map(({ name, full }) => ({ name, data: readFileSync(full) }));
  const target = path.join(DIST, `马鞍山二中模拟器-${version}-发布页.zip`);
  mkdirSync(DIST, { recursive: true });
  writeZip(entries, target);
  const size = statSync(target).size;
  log(`打包：dist/${path.basename(target)}（${entries.length} 个文件，${Math.round(size / 1024)} KB）`);
  return target;
}

/* ------------------------------------------------------------- 主流程 */

function main() {
  const pkg = readPackage();
  const version = pkg.version;
  log(`版本 ${version}`);

  writeFileSync(path.join(DOCS, '.nojekyll'), '', 'utf8'); // 让 Pages 跳过 Jekyll，_ 开头的文件也照发
  buildPlayCopy();
  const info = buildDownload(version);
  buildContentSource();
  checkShotAssets();
  const zip = packZip(version);

  log('完成 ✅');
  log('本地预览：node tools/serve-pages.mjs（默认 http://127.0.0.1:8080/）');
  log(`部署：把 docs/ 推到 GitHub 仓库的 main 分支，Settings → Pages → Source 选 “Deploy from a branch”，目录选 /docs`);
  log(`      （或者直接上传 ${path.basename(zip)} 解压后的内容）`);
  log(`页面上的 APK：${APK_LINK}（${info.bytes} 字节，sha256 ${info.sha256.slice(0, 16)}…）`);
}

main();
