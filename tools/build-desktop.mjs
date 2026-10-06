#!/usr/bin/env node
/**
 * 打包 Windows 便携版（不需要 electron-builder）。
 *
 *   node tools/build-desktop.mjs
 *
 * 做法：把 node_modules/electron/dist 里的 Electron 运行时整个拿来，
 * 再把游戏文件放进 resources/app/，重命名 exe，最后压成 zip。
 * Electron 启动时会优先加载 resources/app，所以这就是一个可独立运行的绿色版。
 *
 * 需要先装好 electron（GitHub 被墙时用镜像）：
 *   $env:ELECTRON_MIRROR='https://registry.npmmirror.com/-/binary/electron/'; npm install electron
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const OUT_ROOT = path.join(ROOT, 'dist', 'desktop');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const FOLDER_NAME = `${pkg.productName ?? pkg.name}-${pkg.version}-win-x64`;
const STAGE = path.join(OUT_ROOT, FOLDER_NAME);
const APP_DIR = path.join(STAGE, 'resources', 'app');
const EXE_NAME = `${pkg.productName ?? pkg.name}.exe`;

const log = (...args) => console.log('[desktop]', ...args);

function fail(message) {
  console.error(`[desktop] 失败：${message}`);
  process.exit(1);
}

/** 需要放进 resources/app 的东西（不含 devDependencies / 测试 / 安卓工程）。 */
const APP_FILES = ['electron', 'src', 'web', 'README.md'];

function stageRuntime() {
  if (!existsSync(ELECTRON_DIST)) {
    fail(
      `找不到 Electron 运行时：${ELECTRON_DIST}\n` +
        `先安装（GitHub 被墙时带上镜像）：\n` +
        `  $env:ELECTRON_MIRROR='https://registry.npmmirror.com/-/binary/electron/'; npm install electron`,
    );
  }
  log(`复制 Electron 运行时（${(statSync(ELECTRON_DIST).size / 1024 / 1024).toFixed(1)} MB 的 electron.exe）`);
  cpSync(ELECTRON_DIST, STAGE, { recursive: true });
}

function stageApp() {
  log('放入游戏文件');
  mkdirSync(APP_DIR, { recursive: true });
  for (const entry of APP_FILES) {
    const from = path.join(ROOT, entry);
    if (!existsSync(from)) fail(`缺少 ${entry}`);
    cpSync(from, path.join(APP_DIR, entry), { recursive: true });
  }

  // 运行时 package.json：只保留 Electron 启动需要的字段
  const runtimePkg = {
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    description: pkg.description,
    type: 'module',
    main: 'electron/main.cjs',
    private: true,
    license: pkg.license,
  };
  writeFileSync(path.join(APP_DIR, 'package.json'), `${JSON.stringify(runtimePkg, null, 2)}\n`, 'utf8');
}

function renameExe() {
  const original = path.join(STAGE, 'electron.exe');
  if (!existsSync(original)) fail('Electron 运行时里没有 electron.exe');
  const target = path.join(STAGE, EXE_NAME);
  rmSync(target, { force: true });
  // 必须重命名而不是复制：复制会让包里多出一份 180MB 的 electron.exe
  renameSync(original, target);
  log(`生成可执行文件：${EXE_NAME}`);
}

function writeLaunchers() {
  writeFileSync(
    path.join(STAGE, '启动游戏.bat'),
    ['@echo off', 'cd /d "%~dp0"', `start "" "${EXE_NAME}"`, ''].join('\r\n'),
    'utf8',
  );
  writeFileSync(
    path.join(STAGE, '说明.txt'),
    [
      `${pkg.productName} v${pkg.version} · Windows 便携版`,
      '',
      '直接双击「' + EXE_NAME + '」或「启动游戏.bat」即可开玩。',
      '完全离线，不需要安装 Node.js，不需要联网。',
      '',
      '存档位置：%APPDATA%\\' + (pkg.productName ?? pkg.name) + '（自动保存窗口大小与游戏进度）',
      '菜单栏：游戏（新的一局 / 导出存档 / 导入存档 / 图鉴 / 商店）、视图（缩放 / 全屏 / 开发者工具）、帮助',
      '',
      '本作品为虚构娱乐内容，与任何真实学校、机构无关。',
      '',
    ].join('\r\n'),
    'utf8',
  );
}

function zipIt() {
  const zipPath = path.join(OUT_ROOT, `${FOLDER_NAME}.zip`);
  rmSync(zipPath, { force: true });
  log('压缩成 zip（Electron 运行时较大，请稍等）');

  if (process.platform === 'win32') {
    // 自己控制条目名：既要是正斜杠（zip 规范），又要带 UTF-8 标记（中文文件名不乱码）。
    // .NET 的 CreateFromDirectory 会用反斜杠，tar 会按 ANSI 写名字，所以这里逐个 CreateEntry。
    const script = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$base = $env:MAS2Z_STAGE
$root = Split-Path $base -Parent
$zip = $env:MAS2Z_ZIP
if (Test-Path $zip) { Remove-Item $zip -Force }
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  Get-ChildItem -Recurse -File -LiteralPath $base | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1).Replace('\\', '/')
    $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $_.LastWriteTime
    $input = [System.IO.File]::OpenRead($_.FullName)
    try {
      $output = $entry.Open()
      try { $input.CopyTo($output) } finally { $output.Dispose() }
    } finally { $input.Dispose() }
  }
} finally {
  $archive.Dispose()
}
`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'inherit',
      env: { ...process.env, MAS2Z_STAGE: STAGE, MAS2Z_ZIP: zipPath },
    });
    return zipPath;
  }

  log('非 Windows：用 tar 打包（中文文件名可能缺少 UTF-8 标记）');
  execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', OUT_ROOT, FOLDER_NAME], { stdio: 'inherit' });
  return zipPath;
}

function report(zipPath) {
  const size = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
  const exe = path.join(STAGE, EXE_NAME);
  log('完成 ✅');
  log(`  目录：${path.relative(ROOT, STAGE)}`);
  log(`  压缩包：${path.relative(ROOT, zipPath)}（${size} MB）`);
  log(`  可执行：${path.relative(ROOT, exe)}（${(statSync(exe).size / 1024 / 1024).toFixed(1)} MB）`);
  const appEntries = readdirSync(APP_DIR);
  log(`  resources/app：${appEntries.join(', ')}`);
  if (existsSync(path.join(STAGE, 'electron.exe'))) {
    log('  ⚠️ 目录里还留着一份 electron.exe，包体会白白大一倍');
  }
  log(`  自检（可选）："${exe}" --selftest`);
}

function main() {
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(OUT_ROOT, { recursive: true });
  stageRuntime();
  stageApp();
  renameExe();
  writeLaunchers();
  const zipPath = zipIt();
  report(zipPath);
}

main();
