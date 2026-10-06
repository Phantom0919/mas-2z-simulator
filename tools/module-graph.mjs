/**
 * 顺着 ES 模块的相对 import，把一个入口能碰到的所有 .js 文件收集出来。
 *
 * 给打包脚本用：APK 里必须带上浏览器真正会加载的每一个模块。
 * 以前是手写清单，新增一个模块忘了登记，装到手机上就是白屏；
 * 现在改成扫 import，并且"import 了但文件不存在"会直接报出来。
 *
 * 单独放一个文件是为了能被单元测试直接调用——测试和打包脚本跑的是同一份逻辑。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 匹配两种相对导入：
 *   import './x.js'            （只为副作用导入）
 *   import { a } from './x.js'  /  export { a } from './x.js'
 * 要求出现在行首（允许缩进），避免匹配到字符串里的假 import。
 */
const IMPORT_PATTERN = /(?:^|\n)[ \t]*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/g;

/**
 * @param {object} options
 * @param {string} options.root 项目根目录（返回的路径都是相对它的，用 / 分隔）
 * @param {string[]} options.entries 入口文件的绝对路径
 * @returns {{ modules: string[], missing: string[] }}
 *   modules 按发现顺序排列，包含入口自己；missing 是被 import 但不存在的文件
 */
export function collectModules({ root, entries }) {
  const seen = new Set();
  const missing = [];
  const queue = [...entries];

  while (queue.length > 0) {
    const file = queue.shift();
    const key = path.relative(root, file).split(path.sep).join('/');

    if (!existsSync(file)) {
      if (!missing.includes(key)) missing.push(key);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);

    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      queue.push(path.resolve(path.dirname(file), match[1]));
    }
  }

  return { modules: [...seen].filter((name) => name.endsWith('.js')), missing };
}

/**
 * 收集并做"必须要有 / 绝不能有"的检查。
 * @returns {{ modules: string[], missing: string[], problems: string[] }}
 */
export function collectModulesChecked({ root, entries, required = [], forbidden = [] }) {
  const { modules, missing } = collectModules({ root, entries });
  const problems = [];
  if (missing.length > 0) problems.push(`这些模块被 import 了但文件不存在：${missing.join('、')}`);
  for (const name of required) {
    if (!modules.includes(name)) problems.push(`浏览器模块图里少了 ${name}`);
  }
  for (const name of forbidden) {
    if (modules.includes(name)) problems.push(`${name} 是 Node 专用的，不该进 APK`);
  }
  return { modules, missing, problems };
}
