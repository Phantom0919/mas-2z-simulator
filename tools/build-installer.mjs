#!/usr/bin/env node
/**
 * 编译 Windows 安装包（NSIS）。
 *
 *   node tools/build-installer.mjs
 *   node tools/build-installer.mjs --source dist/desktop/win-unpacked
 *
 * 不需要 electron-builder：直接用 NSIS 的 makensis 编译 desktop/installer.nsi。
 * 那份 .nsi 是模板，脚本会把绝对路径写进一份临时副本（UTF-8 带 BOM）再编译，
 * 避免中文/空格路径走命令行参数时的编码问题。
 *
 * makensis 从哪来（按顺序找）：
 *   1. 环境变量 MAS2Z_MAKENSIS
 *   2. electron-builder 的缓存（%LOCALAPPDATA%\electron-builder\Cache\nsis-*）
 *   3. C:\Program Files (x86)\NSIS\makensis.exe
 *   4. PATH 里的 makensis
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const TEMPLATE = path.join(ROOT, 'desktop', 'installer.nsi');
const ICON = path.join(ROOT, 'electron', 'assets', 'icon.ico');

const log = (...args) => console.log('[installer]', ...args);
const fail = (message) => {
  console.error(`[installer] 失败：${message}`);
  process.exit(1);
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

/** 找到 makensis.exe。 */
function findMakensis() {
  const candidates = [];
  if (process.env.MAS2Z_MAKENSIS) candidates.push(process.env.MAS2Z_MAKENSIS);

  const ebCache = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache') : null;
  if (ebCache && existsSync(ebCache)) {
    for (const entry of readdirSync(ebCache)) {
      if (!entry.startsWith('nsis')) continue;
      candidates.push(path.join(ebCache, entry, 'makensis.exe'));
      candidates.push(path.join(ebCache, entry, 'Bin', 'makensis.exe'));
    }
  }
  for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
    if (base) candidates.push(path.join(base, 'NSIS', 'makensis.exe'));
  }
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return 'makensis'; // 交给 PATH，找不到就会抛错
}

/** 找到要打包的应用目录。 */
function findSource() {
  const explicit = args.source ? path.resolve(ROOT, String(args.source)) : null;
  if (explicit) {
    if (!existsSync(path.join(explicit, `${pkg.productName}.exe`))) {
      fail(`${explicit} 里没有 ${pkg.productName}.exe`);
    }
    return explicit;
  }
  const candidates = [
    path.join(ROOT, 'dist', 'desktop', 'win-unpacked'),
    path.join(ROOT, 'dist', 'desktop', `${pkg.productName}-${pkg.version}-win-x64`),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, `${pkg.productName}.exe`))) return candidate;
  }
  fail(
    '找不到可打包的应用目录。先执行其中之一：\n' +
      '  npm run desktop:portable     （免 electron-builder 的便携版目录）\n' +
      '  npx electron-builder --dir   （electron-builder 的 win-unpacked）',
  );
  return null;
}

function main() {
  const source = findSource();
  const makensis = findMakensis();
  const workDir = path.join(tmpdir(), `mas2z-installer-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });

  const outFile = path.join(ROOT, 'dist', 'desktop', `${pkg.productName}-${pkg.version}-安装版.exe`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  rmSync(outFile, { force: true });

  const [major, minor, patch] = String(pkg.version).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const script = readFileSync(TEMPLATE, 'utf8')
    .replaceAll('@@APP_NAME@@', pkg.productName)
    .replaceAll('@@APP_EXE@@', `${pkg.productName}.exe`)
    .replaceAll('@@APP_VERSION@@', pkg.version)
    .replaceAll('@@APP_PUBLISHER@@', typeof pkg.author === 'object' ? pkg.author.name : String(pkg.author ?? '匿名'))
    .replaceAll('@@APP_SOURCE@@', source)
    .replaceAll('@@OUT_FILE@@', outFile)
    .replaceAll('@@ICON_FILE@@', existsSync(ICON) ? ICON : path.join(source, `${pkg.productName}.exe`))
    .replaceAll('@@VI_VERSION@@', `${major}.${minor}.${patch}.0`);

  const nsiPath = path.join(workDir, 'installer.nsi');
  writeFileSync(nsiPath, `\ufeff${script}`, 'utf8'); // NSIS 用 BOM 判断 UTF-8

  log(`makensis：${makensis}`);
  log(`打包源：${source}`);
  log(`输出：${path.relative(ROOT, outFile)}`);
  log('开始编译（LZMA 压缩 200MB+，需要几分钟）');

  const started = Date.now();
  try {
    execFileSync(makensis, ['/V2', nsiPath], { stdio: 'inherit' });
  } catch (error) {
    fail(`makensis 编译失败：${error.message}`);
  }

  if (!existsSync(outFile)) fail('makensis 没有产出安装包');
  const size = (statSync(outFile).size / 1024 / 1024).toFixed(1);
  log(`完成 ✅ ${path.relative(ROOT, outFile)}（${size} MB，用时 ${Math.round((Date.now() - started) / 1000)} 秒）`);
  log('安装：双击即可（按用户安装到 %LOCALAPPDATA%\\Programs，不需要管理员权限）');

  // 顺手把便携目录也复制一份到 dist/desktop，方便一起发布
  const portableDir = path.join(ROOT, 'dist', 'desktop', `${pkg.productName}-${pkg.version}-win-x64`);
  if (path.resolve(portableDir) !== path.resolve(source) && existsSync(source) && !existsSync(portableDir)) {
    void copyFileSync;
  }
}

main();
