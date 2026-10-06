#!/usr/bin/env node
/**
 * 一键准备 Android SDK（不需要 Android Studio / Gradle）。
 *
 *   node tools/android-sdk.mjs            安装到项目里的 .android-sdk/
 *   MAS2Z_SDK_DIR=D:\android-sdk node tools/android-sdk.mjs
 *
 * 只下载打包 APK 必需的三样东西：platform-tools、platforms;android-34、build-tools;34.0.0。
 * 之后用 tools/build-apk.mjs 直接调 aapt2 / d8 / apksigner 出包。
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SDK_DIR = path.resolve(process.env.MAS2Z_SDK_DIR ?? path.join(ROOT, '.android-sdk'));
const CMDLINE_TOOLS = ['11076708', '9477386', '8512546'];
const PACKAGES = (process.env.MAS2Z_SDK_PACKAGES ?? 'platform-tools,platforms;android-34,build-tools;34.0.0')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const log = (...args) => console.log('[sdk]', ...args);
const isWindows = process.platform === 'win32';

function sdkmanagerPath() {
  const bin = path.join(SDK_DIR, 'cmdline-tools', 'latest', 'bin', isWindows ? 'sdkmanager.bat' : 'sdkmanager');
  return existsSync(bin) ? bin : null;
}

function hasPackage(relative, marker) {
  const target = path.join(SDK_DIR, relative);
  return existsSync(target) && readdirSync(target).some((entry) => entry.startsWith(marker));
}

async function download(url, destination) {
  log(`下载 ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let lastTick = 0;
  const stream = Readable.fromWeb(response.body);
  stream.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastTick > 3000) {
      lastTick = now;
      const percent = total ? ` (${((received / total) * 100).toFixed(0)}%)` : '';
      log(`  已下载 ${(received / 1024 / 1024).toFixed(1)} MB${percent}`);
    }
  });
  await pipeline(stream, createWriteStream(destination));
  return destination;
}

async function installCmdlineTools() {
  if (sdkmanagerPath()) {
    log('command-line tools 已经就绪');
    return;
  }
  mkdirSync(SDK_DIR, { recursive: true });
  const zipPath = path.join(SDK_DIR, 'cmdline-tools.zip');
  const errors = [];
  for (const version of CMDLINE_TOOLS) {
    const url = `https://dl.google.com/android/repository/commandlinetools-win-${version}_latest.zip`;
    try {
      await download(url, zipPath);
      log('解压 command-line tools');
      const extractDir = path.join(SDK_DIR, 'cmdline-tools-tmp');
      rmSync(extractDir, { recursive: true, force: true });
      mkdirSync(extractDir, { recursive: true });
      execFileSync(isWindows ? 'tar' : 'unzip', isWindows ? ['-xf', zipPath, '-C', extractDir] : ['-q', zipPath, '-d', extractDir], {
        stdio: 'inherit',
      });
      const target = path.join(SDK_DIR, 'cmdline-tools', 'latest');
      rmSync(target, { recursive: true, force: true });
      mkdirSync(path.dirname(target), { recursive: true });
      renameSync(path.join(extractDir, 'cmdline-tools'), target);
      rmSync(extractDir, { recursive: true, force: true });
      rmSync(zipPath, { force: true });
      log('command-line tools 安装完成');
      return;
    } catch (error) {
      errors.push(`${version}: ${error.message}`);
      log(`版本 ${version} 失败，换下一个`);
    }
  }
  throw new Error(`command-line tools 全部下载失败：\n${errors.join('\n')}`);
}

/** 找到可用的 java（JDK 里的就行，sdkmanager 本身就是 Java 程序）。 */
function javaPath() {
  const candidates = [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', isWindows ? 'java.exe' : 'java') : null,
    'java',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* 换下一个 */
    }
  }
  return null;
}

/**
 * 调用 sdkmanager。
 * Windows 上 Node 不允许直接 spawn .bat（EINVAL），所以这里绕开批处理，
 * 直接用 java 跑 sdkmanager 的主类——顺便让三个平台行为一致。
 */
function runSdkmanager(args, { input } = {}) {
  const sdkmanager = sdkmanagerPath();
  if (!sdkmanager) throw new Error('找不到 sdkmanager');
  const fullArgs = [`--sdk_root=${SDK_DIR}`, ...args];
  const java = javaPath();
  const options = {
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input,
    env: { ...process.env, ANDROID_HOME: SDK_DIR, ANDROID_SDK_ROOT: SDK_DIR },
  };

  if (java) {
    const classpath = path.join(SDK_DIR, 'cmdline-tools', 'latest', 'lib', 'sdkmanager-classpath.jar');
    return execFileSync(
      java,
      ['-classpath', classpath, 'com.android.sdklib.tool.sdkmanager.SdkManagerCli', ...fullArgs],
      options,
    );
  }
  // 没有 java 就退回批处理（需要 shell 解析）
  return execFileSync(sdkmanager, fullArgs, { ...options, shell: true });
}

async function main() {
  log(`SDK 目录：${SDK_DIR}`);
  await installCmdlineTools();

  log('接受 SDK 许可协议');
  try {
    runSdkmanager(['--licenses'], { input: `${'y\n'.repeat(60)}` });
  } catch {
    log('许可协议交互被跳过（可能已经接受过）');
  }

  const needed = [];
  if (!hasPackage(path.join('platform-tools'), 'adb') && PACKAGES.includes('platform-tools')) needed.push('platform-tools');
  if (!hasPackage(path.join('platforms'), 'android-34') && PACKAGES.some((item) => item.startsWith('platforms;'))) {
    needed.push(...PACKAGES.filter((item) => item.startsWith('platforms;')));
  }
  if (!hasPackage(path.join('build-tools'), '34.0.0') && PACKAGES.some((item) => item.startsWith('build-tools;'))) {
    needed.push(...PACKAGES.filter((item) => item.startsWith('build-tools;')));
  }

  if (needed.length > 0) {
    log(`安装：${needed.join(' ')}`);
    runSdkmanager(['--install', ...needed]);
  } else {
    log('需要的 SDK 组件都已安装');
  }

  const buildTools = path.join(SDK_DIR, 'build-tools');
  log(`build-tools：${existsSync(buildTools) ? readdirSync(buildTools).join(', ') : '缺失'}`);
  log('全部就绪。下一步：node tools/build-apk.mjs');
}

main().catch((error) => {
  console.error('[sdk] 失败：', error.message);
  process.exit(1);
});
