#!/usr/bin/env node
// scripts/editor.mjs — 启动本地工坊编辑器（Forge 工坊）。
//
// 为什么要有这个文件：`editor/server.mjs` 只是一个**库**（导出 `createEditorServer`），它默认 `port: 0`（随机端口）——
// 于是「跳转到本地编辑器」的按钮没有一个稳定地址可以跳。这里给一个固定的 CLI 入口：
//   npm run editor        → http://127.0.0.1:8787
//   npm run editor -- --port=9000
//
// 默认端口 8787 是任意挑的（避开游戏服务器的常用端口）；被占用时报一句人话并以 2 退出，不静默换端口 ——
// 那样按钮就会指向一个没人监听的地址。
import { createEditorServer } from '../editor/server.mjs';

const DEFAULT_PORT = 8787;
const argOf = (name) => {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const cut = hit.indexOf('=');
  return cut < 0 ? '' : hit.slice(cut + 1);
};

const rawPort = argOf('port');
const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`--port must be an integer in 1..65535 (got "${rawPort}")\n`);
  process.exit(2);
}

let editor = null;
try {
  editor = await createEditorServer({ port, host: '127.0.0.1', log: (...a) => console.log('[editor]', ...a) });
} catch (e) {
  const busy = e && (e.code === 'EADDRINUSE' || /EADDRINUSE/.test(String(e.message)));
  process.stderr.write(busy
    ? `端口 ${port} 已被占用 —— 也许编辑器已经开着了（看看浏览器里有没有 ${`http://127.0.0.1:${port}`}），或者换一个：npm run editor -- --port=9000\n`
    : `编辑器启动失败：${e && e.message ? e.message : e}\n`);
  process.exit(2);
}
process.stdout.write(`工坊编辑器已启动：${editor.url}\n（在这个终端按 Ctrl+C 关闭）\n`);

const stop = async () => { try { await editor.close(); } finally { process.exit(0); } };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
