#!/usr/bin/env node
// scripts/make-voice-pack.mjs — release 的附加配音包。
//
// 为什么它单独一个脚本：完整包只带一种默认配音（`data/assets.json` 的 `audio.voiceLang`）加日配（`audio.voiceJp`），
// 其余语言（英 / 韩 / 母语）在仓库里**有清单、有文件路径，但不进 zip**。想全都要的玩家下一个附加包即可，主包体积
// 不受影响。真正打 zip 的那一步（几万个 mp3，几百 MB）由 release 流程手动跑一次，所以这里只做三件事：
//
//   1. `--help` 打印用法并以 0 退出（不写任何文件）；
//   2. 不认识的选项**报错退出**，而不是悄悄按缺省参数打一个「看起来对」的包；
//   3. 一个语言都没匹配上时**大声失败**，绝不留下一个空的 zip（空包比没有包更糟：玩家以为下到了东西）。
//
// 用法：node scripts/make-voice-pack.mjs [--langs=cn,jp,en,kr,native] [--include-default] [--out=<path>]
//   --langs=LIST      要打进去的语言（逗号分隔）。缺省 cn,jp，与完整包里已有的两种一致
//   --include-default 把 `audio.voiceLang` 也并进 --langs（写 --langs 却又想带上缺省语言时用）
//   --out=PATH        输出 zip 的路径，缺省 dist/voice-pack.zip
//
// 语言名就是 public/assets/audio/voice/ 下的目录名：cn / jp / en / kr / native。

import { createWriteStream, existsSync } from 'node:fs';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOICE_ROOT = join(ROOT, 'public', 'assets', 'audio', 'voice');
const ASSETS = join(ROOT, 'data', 'assets.json');

const USAGE = `release 附加资产：把额外语言的配音打成一个包。

用法：node scripts/make-voice-pack.mjs [选项]

  --langs=LIST       要打进去的语言，逗号分隔（cn / jp / en / kr / native）
                      缺省：cn,jp（与完整包里已有的两种一致）
  --include-default  把 data/assets.json 里 audio.voiceLang 指的那种也并进 --langs
  --out=PATH         输出 zip 的路径，缺省 dist/voice-pack.zip
  --help             打印这段用法并退出（不写任何文件）

例子：
  node scripts/make-voice-pack.mjs --langs=en,kr --out=dist/voice-en-kr.zip
  node scripts/make-voice-pack.mjs --include-default --langs=native
`;

/** 已知选项 —— 不在表里的就是拼错了，报错而不是忽略。 */
const KNOWN = new Set(['--langs', '--include-default', '--out', '--help', '-h']);

/**
 * 解析命令行。不认识的选项直接抛，消息里点名它 —— 比打出一个内容不对的包好得多。
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const out = { langs: null, includeDefault: false, out: null, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') { out.help = true; continue; }
    if (arg === '--include-default') { out.includeDefault = true; continue; }
    const cut = arg.indexOf('=');
    const key = cut < 0 ? arg : arg.slice(0, cut);
    const value = cut < 0 ? '' : arg.slice(cut + 1);
    if (!KNOWN.has(key)) throw new Error(`unknown option ${key}`);
    if (key === '--langs') {
      if (!value) throw new Error('--langs needs a value (e.g. --langs=en,kr)');
      out.langs = value.split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (key === '--out') {
      if (!value) throw new Error('--out needs a path (e.g. --out=dist/voice.zip)');
      out.out = value;
      continue;
    }
    throw new Error(`unknown option ${key}`);
  }
  return out;
}

/**
 * 决定要打哪几种语言。`--include-default` 把清单里 `audio.voiceLang` 那种并进来；结果按参数顺序去重。
 * @param {{ langs: string[] | null, includeDefault: boolean }} opts
 * @param {{ audio?: { voiceLang?: string } }} assets
 * @returns {string[]}
 */
export function resolveLangs(opts, assets) {
  const base = Array.isArray(opts.langs) && opts.langs.length
    ? [...opts.langs]
    : ['cn', 'jp'];
  const def = assets && assets.audio && typeof assets.audio.voiceLang === 'string' ? assets.audio.voiceLang : null;
  if (opts.includeDefault && def && !base.includes(def)) base.push(def);
  return [...new Set(base)];
}

/** 目录下的全部文件（递归），返回绝对路径。 */
async function walk(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  async function rec(d) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await rec(p);
      else if (e.isFile()) out.push(p);
    }
  }
  await rec(dir);
  return out;
}

/**
 * 一个语言的配音文件清单。语言目录不存在 ⇒ 空数组（调用方据此判断「一种都没匹配上」）。
 * @param {string} lang
 */
async function filesOf(lang) {
  const dir = join(VOICE_ROOT, lang);
  if (!existsSync(dir)) return [];
  return walk(dir);
}

/** zip 的中央目录项 —— 自己写，免得为一个一次性脚本引入依赖。 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
/** @param {Buffer} buf */
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * 把文件打成 zip（stored，不压缩：mp3 已经是压缩过的，再 deflate 只是白烧 CPU）。
 * @param {Array<{ abs: string, rel: string }>} items
 * @param {string} outPath
 */
async function writeZip(items, outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const it of items) {
    const data = await readFile(it.abs);
    const name = Buffer.from(it.rel.split(sep).join('/'), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(0, 8);             // method: stored
    local.writeUInt16LE(0, 10);            // time
    local.writeUInt16LE(0x21, 12);         // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  const fd = createWriteStream(outPath);
  for (const c of [...chunks, cdBuf, end]) await new Promise((res, rej) => fd.write(c, (e) => (e ? rej(e) : res(undefined))));
  await new Promise((res) => fd.end(res));
  return createHash('sha256').update(Buffer.concat([...chunks, cdBuf, end])).digest('hex');
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`${e.message}\n\n${USAGE}`);
    return 1;
  }
  if (opts.help) { process.stdout.write(USAGE); return 0; }

  let assets = {};
  try { assets = JSON.parse(await readFile(ASSETS, 'utf8')); } catch { assets = {}; }
  const langs = resolveLangs(opts, assets);
  const items = [];
  for (const lang of langs) {
    for (const abs of await filesOf(lang)) items.push({ abs, rel: join('audio', 'voice', lang, relative(join(VOICE_ROOT, lang), abs)) });
  }
  if (!items.length) {
    // 一个语言都没匹配上 ⇒ 大声失败，绝不写空包（空包比没有包更糟：玩家以为下到了东西）。
    const available = await readdir(VOICE_ROOT).catch(() => []);
    process.stderr.write(`没有可打包的语言：${langs.join(', ')}\n`
      + `（public/assets/audio/voice/ 下找不到这些语言的目录。现有的：${available.join(', ') || '（目录不存在）'}）\n`);
    return 1;
  }
  const out = opts.out ? join(ROOT, opts.out) : join(ROOT, 'dist', 'voice-pack.zip');
  const hash = await writeZip(items, out);
  process.stdout.write(`打包完成：${items.length} 个文件 → ${relative(ROOT, out)}\nsha256 ${hash}\n`);
  return 0;
}

// 只在直接运行时执行（被 test 或别的脚本 import 时只拿导出）。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`${e && e.message ? e.message : e}\n`);
    process.exitCode = 1;
  });
}
