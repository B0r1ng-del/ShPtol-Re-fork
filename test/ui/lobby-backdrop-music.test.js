// 大厅背景与音乐、名片干员 (from the old UI PR #643's keep list: custom lobby music and picture / video backdrops,
// 名片干员). #643 was never merged; its kept parts came in as the split PRs #695…#705 for the screens, and these four
// stayed on the author's list. This file pins what this fork actually ships:
//
//   1. the backdrop is a local preference — the picture in IndexedDB, the choice in localStorage, nothing uploaded;
//   2. the lobby music is a local track with the same shape, and it yields to the battle's own BGM;
//   3. 名片干员 is a per-device pick that falls back to one operator chosen by the player id (the same on every client);
//   4. the site policy lets a blob: media element play (media-src), which is what the maintainer named as the clash
//      that kept these out of 0.3.1;
//   5. every string goes through t() — #643's 157 unwrapped Chinese literals were a rejection reason, not a style nit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('the backdrop keeps the picture on this device and the choice in a pref', () => {
  const src = read('public/js/ui/hubBackdrop.js');
  assert.match(src, /const DB_NAME = 'sp-hub-backdrop'/, 'the picture lives in IndexedDB, not localStorage');
  assert.match(src, /indexedDB\.open\(DB_NAME, 1\)/);
  assert.match(src, /const PREF_KEY = 'hub\.backdrop'/, 'the choice is a pref');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|net\.request/, 'nothing is uploaded');
  // the four generated scenes, plus the custom slot
  assert.match(src, /id: 'night'/);
  assert.match(src, /id: 'frost'/);
  assert.match(src, /id: 'ember'/);
  assert.match(src, /id: 'calm'/);
  assert.match(src, /theme === 'custom'|theme: 'custom'/);
});

test('the lobby music is a local track and yields to the battle BGM', () => {
  const src = read('public/js/ui/lobbyMusic.js');
  assert.match(src, /indexedDB\.open\('sp-lobby-music', 1\)/);
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|net\.request/, 'nothing is uploaded');
  assert.match(src, /export const MAX_MUSIC_BYTES = 20 \* 1024 \* 1024/);
  // the hook audio.js asks, and the fade rather than a hard cut
  assert.match(src, /audio\.lobbyMusicOverride = key =>/, 'audio.js asks before playing the lobby BGM');
  assert.match(src, /linearRampToValueAtTime/, 'the track fades in and out');
  assert.match(src, /media\.loop = true/, 'the track loops');
});

test('名片干员: the pick is per device, the fallback is one operator per player id', () => {
  const art = read('public/js/ui/seatArt.js');
  assert.match(art, /export const CARD_PREF = 'room\.card'/);
  assert.match(art, /export function cardOperators\(/);
  assert.match(art, /export function seatPortrait\(/);
  // the same operator on every client: a hash of the player id, not Math.random
  assert.match(art, /hash32\(seat\.playerId\) % pool\.length/);
  assert.doesNotMatch(art, /Math\.random/);
  const room = read('public/js/screens/room.js');
  assert.match(room, /import \{ CARD_PREF, cardOperators, seatPortrait \} from '\.\.\/ui\/seatArt\.js'/);
  // the seat card shows it as a full-bleed portrait (the new UI's 竖版立绘卡: an <img>, not the old AvatarFrame)
  assert.match(room, /cardSrc \? html`<img src=\$\{cardSrc\}/, 'the seat card shows the portrait');
  assert.match(room, /const cardSrc = seat\.isBot \|\| !portraits \? null : seatPortrait\(seat, portraits\)/);
  assert.match(room, /export const CARD_SYNC = Object\.hasOwn\(C2S, 'room\.card'\)/, 'the pick syncs only when the server knows it');
});

test('the site policy lets a blob: media element play', () => {
  const csp = read('server/http/csp.js');
  assert.match(csp, /media-src 'self' blob:/, 'a Blob this page created is a blob: URL; without media-src it is blocked');
  assert.doesNotMatch(csp, /media-src[^;]*https?:/, 'no remote origin — the file never leaves the device');
  // the other relaxations must not have moved
  assert.match(csp, /img-src 'self' data: blob:/);
  assert.match(csp, /default-src 'self'/);
});

test('★ every string in the two new modules goes through t()', () => {
  // #643 shipped 157 Chinese literals that never reached t(); the maintainer named that when splitting it.
  for (const rel of ['public/js/ui/lobbyMusic.js', 'public/js/ui/hubBackdrop.js', 'public/js/ui/seatArt.js']) {
    const src = read(rel)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
      .join('\n');
    // a Chinese literal outside t() / N_() (the two ways a msgid may be named)
    const bad = [...src.matchAll(/(?<![tN_]\(\s*)'([^']*[\u4e00-\u9fff][^']*)'/g)]
      .filter((m) => !/t\(\s*'|N_\(\s*'/.test(src.slice(Math.max(0, m.index - 3), m.index + 1)));
    assert.deepEqual(bad.map((m) => m[1]), [], `${rel}: a Chinese literal outside t()`);
  }
});

test('the four packs carry the new strings', () => {
  const en = JSON.parse(read('public/i18n/en.json'));
  const ja = JSON.parse(read('public/i18n/ja.json'));
  const ko = JSON.parse(read('public/i18n/ko.json'));
  const tw = JSON.parse(read('public/i18n/zh-TW.json'));
  for (const id of ['大厅音乐', '大厅背景', '名片干员', '夜巡', '自定义背景', '上传音乐', '点击更换名片干员']) {
    for (const [name, pack] of [['en', en], ['ja', ja], ['ko', ko], ['zh-TW', tw]]) {
      assert.ok(typeof pack[id] === 'string' && pack[id].length, `${name}.json is missing 「${id}」`);
    }
  }
});
