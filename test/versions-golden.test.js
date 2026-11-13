// Separate processes exercise the same isolation boundary as official version hosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSIONS, versionSlug } from '../shared/versions.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const families = ['roster', 'bonds', 'fields', 'matches', 'standins', 'diy'];

// A real Node binary for child processes that must produce stdout. process.execPath is the Electron host
// under the DSH harness and drops child stdout there; the repo's own `npm test` also runs on plain node.
const NODE_BIN = (() => {
  const cands = [process.env.SP_NODE, 'C:/Program Files/nodejs/node.exe', 'C:/Program Files (x86)/nodejs/node.exe'];
  for (const c of cands) if (c && existsSync(c)) return c;
  return process.execPath;
})();

/** Run `golden --list` with stdout and stderr on files. A file write finishes before process.exit. */
function spawnGoldenList(versionId) {
  const stamp = `${process.pid}-${versionId.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  const outPath = join(tmpdir(), `sp-golden-list-${stamp}.out`);
  const errPath = join(tmpdir(), `sp-golden-list-${stamp}.err`);
  const outFd = openSync(outPath, 'w');
  const errFd = openSync(errPath, 'w');
  try {
    // NOT process.execPath: under the Electron harness that is `DeepSeek Harness.exe`, which silently drops
    // a child's stdout (measured: `process.stdout.write('x')` came back as just a newline, and writeFileSync
    // never landed). That made --list look empty and the corpus look stale. Use a real node when we can find one.
    const list = spawnSync(NODE_BIN, ['tools/golden.mjs', '--version', versionId, '--list'], {
      cwd: root, stdio: ['ignore', outFd, errFd], timeout: 120000,
    });
    return {
      status: list.status, signal: list.signal, error: list.error,
      stdout: readFileSync(outPath, 'utf8'), stderr: readFileSync(errPath, 'utf8'),
    };
  } finally {
    closeSync(outFd);
    closeSync(errFd);
    unlinkSync(outPath);
    unlinkSync(errPath);
  }
}

for (const version of VERSIONS.filter((v) => v.dir)) {
  test(`${version.id}: complete corpus has identity, supported modes and no recorded engine errors`, () => {
    const expected = [];
    for (const family of families) {
      const doc = JSON.parse(readFileSync(new URL(`golden/${versionSlug(version)}/${family}.json`, import.meta.url), 'utf8'));
      assert.equal(doc.version, version.id);
      for (const [id, digest] of Object.entries(doc.scenarios)) {
        expected.push(`${family}\t${id}`);
        assert.ok(!digest.modeId?.endsWith('_abyss'), id);
        const errors = digest.errors || {};
        const count = errors.count ?? Object.values(errors).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
        assert.equal(count, 0, `${family}/${id}: ${JSON.stringify(errors)}`);
      }
    }
    // The child's stdout is a file, not a pipe: a file write is synchronous, so process.exit cannot drop
    // the tail the way a POSIX pipe did on Ubuntu's Node 22 (act2autochess@V2_1 stopped at diy-103). The
    // child loads only that version's tracked data directory.
    const list = spawnGoldenList(version.id);
    assert.equal(list.status, 0, list.error?.message || list.stderr);
    assert.equal(list.signal, null);
    assert.ok(list.stdout === '' || list.stdout.endsWith('\n'), 'golden --list stdout ended mid-line');
    assert.doesNotMatch(list.stderr, /\[content\] failed to load/, list.stderr);
    assert.deepEqual(list.stdout.trim().split('\n').map((line) => line.split('\t').slice(0, 2).join('\t')), expected);
  });

  test(`${version.id}: a representative golden reproduces in a worker with that version's data`, () => {
    const result = spawnSync(process.execPath, ['tools/golden.mjs', '--version', version.id, '--family', 'bonds', '--only', 'bond-raidShip-high', '--jobs', '2'], { cwd: root, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout, /1 scenarios match/);
  });
}
