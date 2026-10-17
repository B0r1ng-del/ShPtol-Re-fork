// 10 个内容包干员的 Spine 骨架回归：manifest 里有条目，且条目指向的文件在磁盘上真实存在。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const CHARS = [
  'char_219_meteo', 'char_4131_odda', 'char_4071_peper', 'char_365_aprl', 'char_378_asbest',
  'char_449_glider', 'char_4237_jcinta', 'char_230_savage', 'char_4236_tmslot', 'char_4081_warmy',
];
const manifest = () => readFile(new URL('../data/assets.json', import.meta.url), 'utf8').then(JSON.parse);
const installed = () => existsSync(new URL('../public/assets/', import.meta.url));

test('pack operators: every one has a Front battle Spine in the asset manifest', async () => {
  const chars = (await manifest()).chars;
  for (const id of CHARS) {
    const front = chars[id]?.spine?.front;
    assert.ok(front, `${id} has a Spine`);
    assert.equal(front.skel, `/assets/spine/op/${id}/front/${id}.skel`);
    assert.equal(front.atlas, `/assets/spine/op/${id}/front/${id}.atlas`);
    assert.ok(front.textures.length > 0, `${id} names its atlas pages`);
    assert.ok(front.anims?.idle && front.anims.attack?.loop, `${id} resolves its animation roles`);
  }
});

test('pack operators: the manifest names no character without a Spine', async () => {
  const chars = (await manifest()).chars;
  assert.deepEqual(Object.keys(chars).filter((id) => !chars[id].spine), []);
});

test('pack operators: the Spine files are on disk', { skip: !installed() && 'download game art to check installed files' }, async () => {
  const chars = (await manifest()).chars;
  for (const id of CHARS) {
    const front = chars[id].spine.front;
    for (const path of [front.skel, front.atlas, ...front.textures]) {
      assert.ok((await stat(new URL(`../public${path}`, import.meta.url))).size > 0, path);
    }
  }
});
