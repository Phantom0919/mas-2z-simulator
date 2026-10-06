/**
 * 统一的命令行输入器。
 *
 * 为什么不用 readline 的 question()：从管道 / 文件喂进来的输入会一次性到达，
 * 而 question() 只能接住"当前正在等待的那一行"，其余行会被当成无主的 line 事件丢掉。
 * 这里改成"先入队、再取用"，交互式终端和脚本化输入都能正常工作。
 */

import { createInterface } from 'node:readline';

export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output, terminal: false });
  const queue = [];
  let waiting = null;
  let closed = false;

  rl.on('line', (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      queue.push(line);
    }
  });

  rl.on('close', () => {
    closed = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });

  return {
    /** 打印提示并返回一行输入；输入结束（EOF）时返回 null。 */
    ask(promptText = '') {
      if (promptText) output.write(promptText);
      if (queue.length > 0) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    close() {
      rl.close();
    },
    get closed() {
      return closed;
    },
  };
}
