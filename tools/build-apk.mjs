#!/usr/bin/env node
/**
 * 打包 Android APK —— 不需要 Gradle、不需要 Android Studio。
 *
 *   node tools/android-sdk.mjs        # 第一次先装 SDK（约 300MB）
 *   node tools/build-apk.mjs          # 出包到 dist/
 *
 * 原理：直接用 build-tools 里的 aapt2 / d8 / zipalign / apksigner 走一遍
 * 「编译资源 → 链接 → 编译 Java → 转 dex → 塞进 apk → 对齐 → 签名」。
 *
 * 两个环境坑（都已在代码里绕开）：
 *   1. Windows 上 Node 不能直接 spawn .bat → d8 / apksigner 用 java 直接跑主类 / jar 包；
 *   2. 这台机器上的 aapt2 打不开绝对路径（哪怕全是 ASCII 也会报"数据无效"）→
 *      所有工具都以项目根目录为工作目录、只传相对路径。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { collectModulesChecked } from './module-graph.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SDK_DIR = path.resolve(
  process.env.MAS2Z_SDK_DIR ?? process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(ROOT, '.android-sdk'),
);
const BUILD_DIR = path.join(ROOT, 'build', 'android');
const DIST_DIR = path.join(ROOT, 'dist');
const APP_DIR = path.join(ROOT, 'android', 'app');
const MIN_SDK = 21;
const TARGET_SDK = 34;

/** 浏览器端的入口（其余模块顺着 import 自动收集）。 */
const WEB_ENTRIES = ['local-api.js', 'relations-view.js'];
/** 无论怎么收集，这几个都必须进包，否则页面必然打不开。 */
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
/** 这些是 Node 专用的，绝对不能进 APK。 */
const FORBIDDEN_MODULES = ['src/server.js', 'src/cli.js', 'src/profile.js', 'src/prompt.js', 'src/strategies.js'];

/** 浏览器端要带进 APK 的模块——按 import 图收集，不再手工登记。 */
function collectBrowserModules() {
  const { modules, problems } = collectModulesChecked({
    root: ROOT,
    entries: WEB_ENTRIES.map((name) => path.join(ROOT, 'web', name)),
    required: REQUIRED_MODULES,
    forbidden: FORBIDDEN_MODULES,
  });
  if (problems.length > 0) fail(problems.join('；'));
  return modules;
}

const log = (...args) => console.log('[apk]', ...args);
const isWindows = process.platform === 'win32';
const exe = (name) => (isWindows ? `${name}.exe` : name);

/** 转成相对项目根目录的路径——aapt2 只吃相对路径。 */
const rel = (target) => {
  const relative = path.relative(ROOT, target);
  return relative === '' ? '.' : relative;
};

function fail(message) {
  console.error(`[apk] 失败：${message}`);
  process.exit(1);
}

/* ------------------------------------------------------------ 工具链定位 */

function compareVersionsDesc(a, b) {
  const numeric = (value) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = numeric(a);
  const right = numeric(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function pickVersionedDir(parent, prefix) {
  if (!existsSync(parent)) return null;
  const candidates = readdirSync(parent)
    .filter((entry) => entry.startsWith(prefix))
    .filter((entry) => statSync(path.join(parent, entry)).isDirectory())
    .sort(compareVersionsDesc);
  return candidates[0] ? path.join(parent, candidates[0]) : null;
}

function resolveToolchain() {
  if (!existsSync(SDK_DIR)) {
    fail(`找不到 Android SDK：${SDK_DIR}\n先运行 node tools/android-sdk.mjs（或设置 ANDROID_HOME）`);
  }
  const buildTools = pickVersionedDir(path.join(SDK_DIR, 'build-tools'), '');
  const platform = pickVersionedDir(path.join(SDK_DIR, 'platforms'), 'android-');
  if (!buildTools) fail('SDK 里没有 build-tools，运行 node tools/android-sdk.mjs 安装 build-tools;34.0.0');
  if (!platform) fail('SDK 里没有 platforms，运行 node tools/android-sdk.mjs 安装 platforms;android-34');

  const tools = {
    buildTools,
    platform,
    androidJar: path.join(platform, 'android.jar'),
    aapt2: path.join(buildTools, exe('aapt2')),
    zipalign: path.join(buildTools, exe('zipalign')),
    d8Jar: path.join(buildTools, 'lib', 'd8.jar'),
    apksignerJar: path.join(buildTools, 'lib', 'apksigner.jar'),
  };
  for (const key of ['aapt2', 'zipalign', 'androidJar', 'd8Jar', 'apksignerJar']) {
    if (!existsSync(tools[key])) fail(`缺少 ${key}：${tools[key]}`);
  }
  return tools;
}

function javaBin() {
  const home = process.env.JAVA_HOME;
  if (home) {
    const candidate = path.join(home, 'bin', exe('java'));
    if (existsSync(candidate)) return candidate;
  }
  return exe('java');
}

function jdkBin(name) {
  const home = process.env.JAVA_HOME;
  if (home) {
    const candidate = path.join(home, 'bin', exe(name));
    if (existsSync(candidate)) return candidate;
  }
  return exe(name);
}

/** 所有工具都在项目根目录下执行，参数一律相对路径。 */
function run(command, args, { capture = false } = {}) {
  const readable = args.map((arg) => (String(arg).length > 48 ? `${String(arg).slice(0, 45)}...` : arg));
  log(`$ ${path.basename(command)} ${readable.join(' ')}`);
  return execFileSync(command, args, {
    cwd: ROOT,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/* -------------------------------------------------------------- 资源准备 */

function copyInto(from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

function prepareSources() {
  log('整理构建目录');
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });

  // 网页与引擎：APK 里保持 web/ 与 src/ 的相对关系，
  // 这样 app.js 里的 `../src/engine.js` 在 https://mas2z.local/www/app.js 下依然成立
  copyInto(path.join(ROOT, 'web'), path.join(BUILD_DIR, 'assets', 'www'));
  // 引擎文件按 import 图收集，新增模块不用再手工登记
  const modules = collectBrowserModules();
  for (const module of modules) {
    if (!module.startsWith('src/')) continue;
    const target = path.join(BUILD_DIR, 'assets', ...module.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(ROOT, ...module.split('/')), target);
  }
  log(`引擎模块 ${modules.filter((name) => name.startsWith('src/')).length} 个已入包：${modules
    .filter((name) => name.startsWith('src/'))
    .map((name) => name.replace('src/', ''))
    .join(' ')}`);

  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const versionCode = String(pkg.version)
    .split('.')
    .reduce((acc, part) => acc * 100 + (Number(part) || 0), 0);
  const manifest = readFileSync(path.join(APP_DIR, 'AndroidManifest.xml'), 'utf8')
    .replace(/android:versionCode="\d+"/, `android:versionCode="${versionCode}"`)
    .replace(/android:versionName="[^"]*"/, `android:versionName="${pkg.version}"`);
  writeFileSync(path.join(BUILD_DIR, 'AndroidManifest.xml'), manifest, 'utf8');

  copyInto(path.join(APP_DIR, 'res'), path.join(BUILD_DIR, 'res'));
  copyInto(path.join(APP_DIR, 'java'), path.join(BUILD_DIR, 'java'));
  for (const dir of ['gen', 'classes', 'dex']) mkdirSync(path.join(BUILD_DIR, dir), { recursive: true });

  return { version: pkg.version };
}

function listFiles(dir, extension) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, extension));
    else if (entry.name.endsWith(extension)) out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------------ 构建 */

function compileResources(tools) {
  log('1/6 编译资源（aapt2 compile）');
  const output = path.join(BUILD_DIR, 'compiled-res.zip');
  run(tools.aapt2, ['compile', '--dir', rel(path.join(BUILD_DIR, 'res')), '-o', rel(output)]);
  return output;
}

function linkResources(tools, compiledRes, version) {
  log('2/6 链接资源与清单（aapt2 link）');
  const apk = path.join(BUILD_DIR, 'base.apk');
  // 注意：这里刻意不用 aapt2 的 -A 加 assets——Windows 版 aapt2 会把目录分隔符写成
  // 反斜杠（assets\www\index.html），而 Android 的 AssetManager 只认正斜杠，会白屏。
  // assets 改由 jar 添加（见 packApk），jar 写的是标准正斜杠。
  run(tools.aapt2, [
    'link',
    '-o', rel(apk),
    '-I', rel(tools.androidJar),
    '--manifest', rel(path.join(BUILD_DIR, 'AndroidManifest.xml')),
    '--java', rel(path.join(BUILD_DIR, 'gen')),
    '--min-sdk-version', String(MIN_SDK),
    '--target-sdk-version', String(TARGET_SDK),
    '--no-version-vectors',
    rel(compiledRes),
  ]);
  if (!existsSync(apk)) fail('aapt2 link 没有产出 base.apk');
  return apk;
}

function compileJava(tools) {
  log('3/6 编译 Java（javac）');
  const sources = [...listFiles(path.join(BUILD_DIR, 'java'), '.java'), ...listFiles(path.join(BUILD_DIR, 'gen'), '.java')];
  if (sources.length === 0) fail('没有找到任何 Java 源码');
  run(jdkBin('javac'), [
    '-encoding', 'UTF-8',
    '-source', '11',
    '-target', '11',
    '-nowarn',
    '-classpath', rel(tools.androidJar),
    '-d', rel(path.join(BUILD_DIR, 'classes')),
    ...sources.map(rel),
  ]);
}

function buildDex(tools) {
  log('4/6 转成 dex（d8）');
  const classes = listFiles(path.join(BUILD_DIR, 'classes'), '.class');
  if (classes.length === 0) fail('javac 没有产出 class 文件');
  run(javaBin(), [
    '-classpath', rel(tools.d8Jar),
    'com.android.tools.r8.D8',
    '--release',
    '--min-api', String(MIN_SDK),
    '--lib', rel(tools.androidJar),
    '--output', rel(path.join(BUILD_DIR, 'dex')),
    ...classes.map(rel),
  ]);
  const dexFile = path.join(BUILD_DIR, 'dex', 'classes.dex');
  if (!existsSync(dexFile)) fail('d8 没有产出 classes.dex');
  return dexFile;
}

function packApk(tools, baseApk, dexFile) {
  log('5/6 塞入网页资源与 dex，然后对齐（jar + zipalign）');
  const jar = jdkBin('jar');
  // -C 会把该目录当作条目名的基准，所以这里要指到 assets 的父目录，
  // 条目名才会是 Android 需要的 assets/www/index.html
  run(jar, ['--update', '--file', rel(baseApk), '-C', rel(BUILD_DIR), 'assets']);
  run(jar, ['--update', '--file', rel(baseApk), '-C', rel(path.dirname(dexFile)), path.basename(dexFile)]);

  const aligned = path.join(BUILD_DIR, 'aligned.apk');
  run(tools.zipalign, ['-f', '-p', '4', rel(baseApk), rel(aligned)]);
  if (!existsSync(aligned)) fail('zipalign 没有产出 aligned.apk');
  return aligned;
}

function ensureKeystore() {
  const keystore = path.join(ROOT, 'android', 'debug.keystore');
  if (existsSync(keystore)) return keystore;
  log('生成调试签名证书（debug.keystore）');
  run(jdkBin('keytool'), [
    '-genkeypair',
    '-keystore', rel(keystore),
    '-storepass', 'android',
    '-keypass', 'android',
    '-alias', 'androiddebugkey',
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000',
    '-dname', 'CN=Android Debug,O=Android,C=US',
  ]);
  return keystore;
}

function signApk(tools, alignedApk, version) {
  log('6/6 签名（apksigner）');
  const keystore = ensureKeystore();
  mkdirSync(DIST_DIR, { recursive: true });
  const output = path.join(DIST_DIR, `中二野人实验室-${version}-debug.apk`);
  rmSync(output, { force: true });
  run(javaBin(), [
    '-jar', rel(tools.apksignerJar),
    'sign',
    '--ks', rel(keystore),
    '--ks-pass', 'pass:android',
    '--key-pass', 'pass:android',
    '--ks-key-alias', 'androiddebugkey',
    '--min-sdk-version', String(MIN_SDK),
    '--out', rel(output),
    rel(alignedApk),
  ]);
  if (!existsSync(output)) fail('apksigner 没有产出 APK');
  const verify = run(javaBin(), ['-jar', rel(tools.apksignerJar), 'verify', '--print-certs', rel(output)], { capture: true });
  log(String(verify).split('\n')[0] ?? '');
  return output;
}

/* ------------------------------------------------------------------ 主流程 */

function main() {
  const tools = resolveToolchain();
  log(`SDK：${SDK_DIR}`);
  log(`build-tools：${path.basename(tools.buildTools)}　platform：${path.basename(tools.platform)}`);

  const { version } = prepareSources();
  const compiledRes = compileResources(tools);
  const baseApk = linkResources(tools, compiledRes, version);
  compileJava(tools);
  const dexFile = buildDex(tools);
  const aligned = packApk(tools, baseApk, dexFile);
  const apk = signApk(tools, aligned, version);

  const size = (statSync(apk).size / 1024 / 1024).toFixed(2);
  log(`完成 ✅ ${path.relative(ROOT, apk)}（${size} MB）`);
  log(`安装：adb install -r "${apk}"　或把 apk 传到手机上点开安装`);
}

main();
