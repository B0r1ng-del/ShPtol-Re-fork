// 主页浮层互斥（第 6 轮实测 Bug，2026-11-17）。
//
// 现象：主页七个浮层（同盟方式 / 模拟协议 / 危机入口 / 危机选约 / SWEEP / 成就 / 个人档案）
// 各自持有独立 state，没有任何一处负责「打开之前先关掉别的」。脚本连续点击两个入口，
// 两个弹窗会同时存在，互相盖住又盖住主页按钮 —— 用户看到的现象是「点不动」。
//
// 根因：入口有四个（openMode 一个分发器 + 三个绕开它的直连 onClick），
// 每个都只 set 自己那一个状态，没有任何收敛点。
//
// 修法：新增 closeLayers() 作为唯一收敛点；openMode 开头调用它，
// 三个直连入口改走 openSweep / openAch / openAcct（内部同样先 closeLayers）。
// 以后新增浮层只需往 closeLayers 里加一行 —— 这个测试就是防止有人再加一个绕过它的入口。
//
// Run: node --test test/ui/lobby-layer-exclusive.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('closeLayers 关闭全部七个浮层状态', () => {
  const src = read('public/js/screens/lobby.js');
  const at = src.indexOf('const closeLayers = () => {');
  assert.ok(at > 0, '必须有 closeLayers 收敛点');
  const body = src.slice(at, src.indexOf('};', at));
  for (const call of [
    'setAllyOpen(false)',
    'setProtoOpen(null)',
    'setCrisisEntry(null)',
    'setCrisisReturned(false)',
    'setCrisisSkin(null)',
    'setSweepOpen(false)',
    'setAchOpen(false)',
    'setAcctOpen(false)',
  ]) {
    assert.ok(body.includes(call), `closeLayers 必须包含 ${call}`);
  }
});

test('openMode 在打开任何模式前先 closeLayers', () => {
  const src = read('public/js/screens/lobby.js');
  const at = src.indexOf('const openMode = (m) => {');
  assert.ok(at > 0, '必须有 openMode');
  const body = src.slice(at, src.indexOf('\n  };', at));
  assert.ok(body.includes('closeLayers()'), 'openMode 开头必须先收敛');
  // 收敛必须发生在任何一个 set 之前 —— 否则先开新的再关旧的，旧的永远关不掉
  assert.ok(
    body.indexOf('closeLayers()') < body.indexOf('setProtoOpen('),
    'closeLayers 必须早于 setProtoOpen',
  );
  assert.ok(
    body.indexOf('closeLayers()') < body.indexOf('setCrisisEntry('),
    'closeLayers 必须早于 setCrisisEntry',
  );
  assert.ok(
    body.indexOf('closeLayers()') < body.indexOf('setAllyOpen(true)'),
    'closeLayers 必须早于 setAllyOpen(true)',
  );
});

test('★ 三个绕开 openMode 的入口也必须先收敛', () => {
  const src = read('public/js/screens/lobby.js');
  for (const [fn, setter] of [
    ['openSweep', 'setSweepOpen(true)'],
    ['openAch', 'setAchOpen(true)'],
    ['openAcct', 'setAcctOpen(true)'],
  ]) {
    const at = src.indexOf(`const ${fn} = () => {`);
    assert.ok(at > 0, `必须有 ${fn}`);
    const body = src.slice(at, src.indexOf('};', at));
    assert.ok(body.includes('closeLayers()'), `${fn} 必须先收敛`);
    assert.ok(body.includes(setter), `${fn} 必须打开自己的层`);
  }
});

test('★ 模板里不再有绕过收敛点的直连 setState onClick', () => {
  const src = read('public/js/screens/lobby.js');
  // 这三种写法正是最初的 Bug 来源；出现任何一个都说明又有入口绕开了收敛点
  assert.ok(!/onClick=\$\{\(\) => setSweepOpen\(true\)\}/.test(src),
    'home-report 必须走 openSweep，不能直连 setSweepOpen(true)');
  assert.ok(!/onOpen=\$\{\(\) => setAchOpen\(true\)\}/.test(src),
    'achievement 必须走 openAch');
  assert.ok(!/onOpen=\$\{\(\) => setAcctOpen\(true\)\}/.test(src),
    'MeChip 必须走 openAcct');
});

test('★ 账号弹窗「查看统计」也保持互斥（先关注销再开成就）', () => {
  const src = read('public/js/screens/lobby.js');
  assert.match(src, /onStats=\$\{\(\) => \{ setAcctOpen\(false\); setAchOpen\(true\); \}\}/,
    '账号 → 统计 的切换必须先关闭账号层');
});
