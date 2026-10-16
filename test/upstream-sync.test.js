// test/upstream-sync.test.js — tools/upstream-sync.mjs（对照 docs/SYNC.md）。
//
// 这个工具是**只读**的体检器：它算「哪些文件能直接采纳上游、哪些必须手工合」，不替你合代码。它顺手解决了
// 本 fork 一个真实痛点 —— 与上游分叉太深，整体 merge 会炸，所以必须先知道边界。
//
// 这里钉三件事：
//   1. 它是只读的：源码里没有写工作区的调用（checkout / merge / reset / commit / writeFile）；
//   2. 三方比对的分类规则正确（拿真仓库做端到端）；
//   3. 文档与工具对得上：docs/SYNC.md 提到的命令在 CLI 里真的存在。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const SRC = 'tools/upstream-sync.mjs';

describe('upstream-sync：只读体检器', () => {
  test('它不写工作区 —— 任何会改动仓库的 git 子命令都不许出现', () => {
    // 去掉注释，只看真实代码：注释里提到 `git checkout`（教用户怎么取件）是正当的
    const code = read(SRC)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const bad of [
      /execFileSync\(\s*'git'\s*,\s*\[\s*'checkout'/, /'merge'/, /'reset'/, /'commit'/, /'push'/, /'add'/,
      /writeFileSync/, /mkdirSync/, /rmSync/, /renameSync/,
    ]) {
      assert.ok(!bad.test(code), `不得出现会写仓库的调用：${bad}`);
    }
    // 它只跑这几条只读 git 命令
    assert.match(code, /'merge-base'/, '要算共同祖先');
    assert.match(code, /'rev-parse'/, '要取 blob / ref');
    assert.match(code, /'diff', '--name-only'/, '要列改动文件');
  });

  test('分类规则：ADOPT / KEEP / BOTH / SAME / ADDED / GONE 六个都在，且各有处置说明', () => {
    const src = read(SRC);
    for (const k of ['ADOPT', 'KEEP', 'BOTH', 'SAME', 'ADDED', 'GONE']) {
      assert.ok(src.includes(`'${k}'`) || src.includes(`${k}:`), `${k} 是分类之一`);
      assert.ok(new RegExp(`${k}:\\s*'`).test(src), `${k} 在 HINT 里有处置说明`);
    }
    // 判据本身：ours==base 且 theirs!=base ⇒ ADOPT；两边都 !=base ⇒ BOTH
    assert.match(src, /o === b && t !== b\)\s*klass = 'ADOPT'/);
    assert.match(src, /else klass = 'BOTH'/);
    // 代码比例要排除 docs/test，否则比例被文档灌水
    assert.match(src, /const isCode = \(f\) => !\/\^docs\\\/\|\^test\\\//, '体检比例只算代码文件');
  });

  test('端到端：对着真实的上游 ref 能算出结果（本仓与上游必然同根，所以 base 存在）', () => {
    const ref = process.env.SP_SYNC_REF;
    if (!ref) return; // 没有配置上游 remote 时跳过（CI 与干净克隆都不会有）
    const out = execFileSync('node', ['tools/upstream-sync.mjs', 'doctor', '--remote', ref], { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /upstream-sync doctor/);
    assert.match(out, /base\s+[0-9a-f]{12}/, '算出了共同祖先');
    assert.match(out, /改动文件 \d+/);
  });

  test('缺文件必须归为 ADDED/GONE，不能因为 Map.get 返回 undefined 而误判成 ADOPT/KEEP', () => {
    // 这个坑真的踩到过：批量查询用 `map.get(path)`，文件不在那棵树里时得到 `undefined`，
    // 而 `o === b` 对 `undefined === undefined` 竟然成立 ⇒ 上游独有的新文件被报成「可直接采纳」。
    // 现在两处都归一化成 null，这里把规则本身钉住。
    const src = read(SRC);
    assert.match(src, /const b = baseMap\.get\(path\) \?\? null, o = oursMap\.get\(path\) \?\? null, t = theirsMap\.get\(path\) \?\? null;/,
      '三边取值都归一化成 null');
    assert.match(src, /if \(t === null\) klass = 'GONE'/, '上游没有 ⇒ GONE');
    assert.match(src, /else if \(o === null \|\| b === null\) klass = 'ADDED'/, '本仓或 base 没有 ⇒ ADDED');
    // 批量取 blob 不能用 rev-parse 拼一长串：任一对象缺失就整体失败、且输出会错位
    assert.ok(!/rev-parse', '--verify', '--quiet', '--end-of-options'/.test(src), '不用批量 rev-parse 取 blob');
    assert.match(src, /'ls-tree', '-r'/, '用 ls-tree 一次拿整棵树（缺路径时只是不出现）');
  });

  test('文档与工具对得上：docs/SYNC.md 里的每个命令都在 CLI 里存在', () => {
    const doc = read('docs/SYNC.md');
    const src = read(SRC);
    // 文档点名的四个子命令
    for (const cmd of ['doctor', 'list', 'fetch', 'files']) {
      assert.match(doc, new RegExp(`upstream-sync\\.mjs ${cmd}`), `SYNC.md 提到 ${cmd}`);
      assert.ok(new RegExp(`case '${cmd}':`).test(src), `CLI 实现了 ${cmd}`);
    }
    // 文档里的旗标也要真实存在
    for (const flag of ['--remote', '--only', '--class']) {
      assert.ok(doc.includes(flag), `SYNC.md 提到 ${flag}`);
      assert.ok(src.includes(`--${flag.slice(2)}`), `CLI 解析 ${flag}`);
    }
    // 四种方案都要在文档里
    for (const plan of ['选择式移植', '整体 merge', 'GitHub Actions', 'Pull App']) {
      assert.ok(doc.includes(plan), `SYNC.md 覆盖了方案「${plan}」`);
    }
    // 文档必须写清「为什么不能整体 merge」，且给出实测数字而不是形容词
    assert.match(doc, /108 个冲突文件/, '给出了实测冲突数');
    assert.match(doc, /packId/, '说明了本仓的门控机制');
    assert.match(doc, /rhineEnabled/, '以及上游的机制');
  });
});
