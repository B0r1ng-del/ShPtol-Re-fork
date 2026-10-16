// tools/upstream-sync.mjs — 上游同步体检器（对照 docs/SYNC.md）。
//
// 这个 fork 与上游 sganggs/Stronghold-Protocol、以及源扩展 YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine 都有
// 大量自定义改动，所以**整体 merge 会炸**（实测 108 个冲突文件）。这个 CLI 不替你合代码，它把「哪些文件可以
// 直接采纳、哪些必须手工合」先算清楚，让每一批移植都有确定的边界。
//
// 三方比对：base 是两边共同祖先，ours 是本仓，theirs 是上游。
//   ADOPT  本仓没动过、上游动了   → 可以直接采纳上游版本
//   KEEP   上游没动、本仓动了     → 与本次同步无关
//   BOTH   两边都动了             → **真冲突**，必须手工合
//   SAME   两边一样               → 无需动作
//   MISSING/新增                   → 一边没有这个文件
//
// 用法：
//   node tools/upstream-sync.mjs doctor                       # 体检：列出 4 类，给出可自动采纳的比例
//   node tools/upstream-sync.mjs doctor --remote upstream     # 换一个 remote 名（默认 upstream）
//   node tools/upstream-sync.mjs doctor --only srcfork        # 只见某些文件（逗号分隔的子串）
//   node tools/upstream-sync.mjs list --class ADOPT           # 只列某一类
//   node tools/upstream-sync.mjs fetch <ref>                  # 打印取某个文件上游版本的命令（不落盘）
//   node tools/upstream-sync.mjs files <a> <b>                # 两个 rev 之间改动的文件（= 一批要同步的面）
//
// 它**只读**：不写工作区、不建分支、不改 data/。所有动作都要你显式执行。

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const gitQuiet = (...args) => {
  try { return git(...args); } catch { return null; }
};

const args = process.argv.slice(2);
const cmd = args[0] || 'doctor';
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

/** 默认对着 fork 自己的上游；源扩展（Rhine）用 --remote 指过去。 */
const REMOTE = flag('remote', 'upstream');

/** 只列关心的文件（子串，逗号分隔）。 */
const only = flag('only') ? flag('only').split(',').map((s) => s.trim()).filter(Boolean) : null;

/** 一个文件是不是「代码」（体检比例时用它把 docs/test 排除在外，免得比例被文档灌水）。 */
const isCode = (f) => !/^docs\/|^test\/|^README|^CHANGELOG|^\.github|^package(-lock)?\.json$/.test(f);

function refine(remote = REMOTE) {
  return gitQuiet('rev-parse', '--verify', '--quiet', `${remote}/HEAD`) || gitQuiet('rev-parse', '--verify', '--quiet', remote);
}

/** 三方比对出一张表：[{ path, klass }]。 */
function classify(remote, { commits = null, paths = null } = {}) {
  const theirs = refine(remote);
  if (!theirs) {
    console.error(`upstream-sync: 找不到 ${remote} —— 先 \`git remote add ${remote} <url>\` 再 \`git fetch ${remote}\`。`);
    process.exit(2);
  }
  const ours = 'HEAD';
  const base = git('merge-base', ours, theirs);

  let files;
  if (paths) {
    files = paths;
  } else {
    // 这一批要同步的面：commits 之间的改动；没给就取 base..theirs 的全部
    const range = commits ? `${commits[0]} ${commits[1]}` : `${base} ${theirs}`;
    const [a, b] = range.split(' ');
    files = git('diff', '--name-only', a, b).split('\n').filter(Boolean);
  }

  // One `git rev-parse` per FILE is what made a 187-file doctor take 35 s (3 calls x 187, each a fresh process).
  // `git ls-tree -r` prints `<mode> blob <sha>\t<path>` for a whole tree in ONE call, with no failure mode for
  // missing paths (a path that is absent simply is not listed), so the table costs three calls and stays correct.
  const want = new Set(files);
  const batch = (rev) => {
    let out;
    try { out = execFileSync('git', ['ls-tree', '-r', rev], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
    catch { return new Map(); }
    const map = new Map();
    for (const line of out.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const path = line.slice(tab + 1);
      if (!want.has(path)) continue;
      const sha = line.slice(0, tab).split(/\s+/)[2];
      if (sha) map.set(path, sha);
    }
    return map;
  };

  const baseMap = batch(base), oursMap = batch(ours), theirsMap = batch(theirs);
  const out = [];
  for (const path of files) {
    if (only && !only.some((s) => path.includes(s))) continue;
    // `Map.get` yields `undefined`, not `null` — normalise, or a file absent from a tree reads as "same as base"
    const b = baseMap.get(path) ?? null, o = oursMap.get(path) ?? null, t = theirsMap.get(path) ?? null;
    let klass;
    if (t === null) klass = 'GONE';            // 上游删了
    else if (o === null || b === null) klass = 'ADDED'; // 本仓还没有 / 上游新增
    else if (o === b && t !== b) klass = 'ADOPT';
    else if (t === b) klass = 'KEEP';
    else if (o === t) klass = 'SAME';
    else klass = 'BOTH';
    out.push({ path, klass });
  }
  return { base, ours, theirs, rows: out };
}

const ORDER = ['ADOPT', 'BOTH', 'ADDED', 'GONE', 'KEEP', 'SAME'];
const HINT = {
  ADOPT: '本仓没动过 → 可直接采纳上游版本（见 fetch）',
  BOTH: '两边都改过 → 必须手工合（先跑定向测试，再逐条对照）',
  ADDED: '本仓还没有 → 按需新增',
  GONE: '上游删了 → 确认本仓是否也要删',
  KEEP: '本仓独有改动 → 与本次同步无关',
  SAME: '两边一致 → 无需动作',
};

function doctor() {
  const { base, ours, theirs, rows } = classify(REMOTE);
  const code = rows.filter((r) => isCode(r.path));
  console.log(`upstream-sync doctor`);
  console.log(`  base   ${base.slice(0, 12)}`);
  console.log(`  ours   ${ours.slice(0, 12)} (HEAD)`);
  console.log(`  theirs ${theirs.slice(0, 12)} (${REMOTE})`);
  console.log(`  改动文件 ${rows.length}（其中代码 ${code.length}，docs/test ${rows.length - code.length}）`);
  console.log('');
  for (const k of ORDER) {
    const all = rows.filter((r) => r.klass === k);
    const c = all.filter((r) => isCode(r.path));
    if (!all.length) continue;
    console.log(`${k.padEnd(6)} ${String(all.length).padStart(4)} 文件（代码 ${c.length}）  ${HINT[k]}`);
    for (const r of c.slice(0, 12)) console.log(`         ${r.path}`);
    if (c.length > 12) console.log(`         … 还有 ${c.length - 12} 个（node tools/upstream-sync.mjs list --class ${k}）`);
  }
  const adopt = code.filter((r) => r.klass === 'ADOPT').length;
  const both = code.filter((r) => r.klass === 'BOTH').length;
  if (adopt + both) {
    console.log('');
    console.log(`  可自动采纳 ${Math.round((adopt / (adopt + both)) * 100)}%（${adopt}/${adopt + both} 个代码文件），其余 ${both} 个要手工合。`);
  }
}

function list() {
  const want = (flag('class', 'BOTH') || 'BOTH').toUpperCase();
  const { rows } = classify(REMOTE);
  for (const r of rows.filter((x) => x.klass === want)) console.log(r.path);
}

/** 打印「怎么把上游的某个文件取出来」——不落盘，你自己决定采不采纳。 */
function fetchFile() {
  const path = args[1];
  if (!path) { console.error('用法: node tools/upstream-sync.mjs fetch <path>'); process.exit(2); }
  const theirs = refine(REMOTE);
  console.log(`# 取上游版本（先看，别直接覆盖）`);
  console.log(`git show ${REMOTE}/HEAD:${path} > /tmp/theirs.txt`);
  console.log(`git show HEAD:${path} > /tmp/ours.txt`);
  console.log(`diff /tmp/ours.txt /tmp/theirs.txt`);
  console.log('');
  console.log(`# 确认要采纳（本仓没动过的文件才安全）：`);
  console.log(`git checkout ${REMOTE}/HEAD -- ${path}`);
  console.log('');
  console.log(`# 或只取某个提交引入的改动：`);
  console.log(`git log --oneline --no-merges ${git('merge-base', 'HEAD', theirs)}..${theirs} -- ${path}`);
}

/** 两个 rev 之间改动的文件 = 一批要同步的面。 */
function filesBetween() {
  const a = args[1], b = args[2];
  if (!a || !b) { console.error('用法: node tools/upstream-sync.mjs files <revA> <revB>'); process.exit(2); }
  const rows = git('diff', '--name-only', a, b).split('\n').filter(Boolean);
  console.log(`${rows.length} 个文件：`);
  for (const f of rows) console.log(f);
}

switch (cmd) {
  case 'doctor': doctor(); break;
  case 'list': list(); break;
  case 'fetch': fetchFile(); break;
  case 'files': filesBetween(); break;
  default:
    console.error(`upstream-sync: 未知命令 ${cmd}\n用法: doctor | list --class <C> | fetch <path> | files <a> <b>`);
    process.exit(2);
}
