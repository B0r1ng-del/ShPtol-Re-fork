// test/mod-layer-cap.test.js — the 「解除叠层上限」 Mod 开关 (shared/constants.js MOD_KEYS `uncapLayers`).
//
// The rule: every bond's layer count is capped at the official 999 (BOND_LAYER_CAP, the client's
// MAX_GARRISON_STACK). With the switch OFF — the default, and every caller that passes no mods — nothing changes at
// all. With it ON the ceiling is lifted and a bond may stack past 999; ONLY the ceiling moves, every other rule
// (who may gain, requireActive, the per-battle allowance, the client-result bound, the milestones) is untouched.
//
// `layerCapFor` is the one definition of the ceiling, so this file pins it plus every writer that reads it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOND_LAYER_CAP, MOD_KEYS, MOD_DEFAULTS, normalizeMods, layerCapFor, layerGainRoom } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

describe('解除叠层上限: the switch itself', () => {
  test('the switch exists, defaults OFF, and survives normalisation', () => {
    assert.ok(MOD_KEYS.includes('uncapLayers'), 'uncapLayers is a Mod key');
    assert.equal(MOD_DEFAULTS.uncapLayers, false, 'defaults off');
    // normalizeMods is what GameData runs on whatever the room carried: absent / garbage reads as off
    assert.equal(normalizeMods(undefined).uncapLayers, false);
    assert.equal(normalizeMods({}).uncapLayers, false);
    assert.equal(normalizeMods({ uncapLayers: 'yes' }).uncapLayers, false, 'not `=== true` ⇒ off');
    assert.equal(normalizeMods({ uncapLayers: true }).uncapLayers, true);
    // and every pre-existing switch keeps its own default
    for (const k of MOD_KEYS) assert.equal(typeof normalizeMods({})[k], 'boolean', `${k} normalises`);
  });

  test('the official cap is unchanged: 999, and OFF is byte-identical behaviour', () => {
    assert.equal(BOND_LAYER_CAP, 999);
    assert.equal(layerCapFor(undefined), 999);
    assert.equal(layerCapFor(null), 999);
    assert.equal(layerCapFor({}), 999);
    assert.equal(layerCapFor({ uncapLayers: false }), 999);
    assert.equal(layerCapFor({ uncapLayers: true }), Infinity, 'ON lifts the ceiling');
  });

  test('layerGainRoom: the third argument lifts the ceiling and nothing else', () => {
    // no third argument = the official cap, exactly as before this change
    assert.equal(layerGainRoom(995, 10), 4, 'at 995 the official cap leaves room 4');
    assert.equal(layerGainRoom(995, 10, 999), 4);
    assert.equal(layerGainRoom(999, 10), 0, 'at the cap a gain adds nothing');
    assert.equal(layerGainRoom(1500, 10), 0, 'over the cap (a legacy value) never lowers');
    // uncapped
    assert.equal(layerGainRoom(995, 10, Infinity), 10);
    assert.equal(layerGainRoom(999, 10, Infinity), 10, 'past 999 a gain lands in full');
    assert.equal(layerGainRoom(5000, 10, Infinity), 10, 'and keeps landing');
    // the shape of the function is untouched: non-positive / non-finite n adds nothing, n = Infinity means the room
    assert.equal(layerGainRoom(0, 0, Infinity), 0);
    assert.equal(layerGainRoom(0, -5, Infinity), 0);
    assert.equal(layerGainRoom(0, NaN, Infinity), 0);
    assert.equal(layerGainRoom(995, Infinity, 999), 4, 'the room left under the official cap');
    assert.equal(layerGainRoom(995, Infinity, Infinity), Infinity, 'unbounded room when uncapped');
    // a negative / non-finite `before` reads as 0, capped and uncapped alike
    assert.equal(layerGainRoom(-3, 10), 10);
    assert.equal(layerGainRoom(-3, 10, Infinity), 10);
    assert.equal(layerGainRoom(NaN, 10), 10);
    // `before` at or over the cap is never lowered
    assert.equal(layerGainRoom(1200, 10, Infinity), 10);
  });

  test('every layer writer routes through the match\'s ceiling', () => {
    // the ONE definition, read by GameData and handed to the battle as a wire-safe boolean
    assert.match(read('shared/constants.js'), /export function layerCapFor\(mods\)/, 'layerCapFor exists');
    assert.match(read('server/match/gamedata.js'), /get layerCap\(\) \{ return layerCapFor\(this\.mods\); \}/);
    assert.match(read('server/match/gamedata.js'), /get uncapLayers\(\) \{ return this\.mods\.uncapLayers === true; \}/);
    // prep-side gains, the settle of in-battle gains, the live sim copy, the 联防 view and the displayed view
    const sites = [
      ['server/match/player/economy.js', /layerGainRoom\(before, Math\.floor\(n\), this\.gd\.layerCap\)/],
      ['server/match/match/settle.js', /layerGainRoom\(before, Math\.floor\(n\), this\.gd\.layerCap\)/],
      ['server/match/unite.js', /layerGainRoom\(stored, Math\.floor\(gain\), m\.gd\.layerCap\)/],
    ];
    for (const [f, re] of sites) assert.match(read(f), re, `${f} passes the cap`);
    assert.match(read('server/sim/battle/economy.js'), /layerCapFor\(\{ uncapLayers: this\.flags\.uncapLayers === true \}\)/,
      'the sim reads its own wire-safe flag');
    assert.match(read('server/match/bondsMeta.js'), /export function bondsWithGains\(bonds, gains, cap = undefined\)/);
    assert.match(read('server/match/player/round.js'), /bondsWithGains\(this\.bonds, this\.pendingLayerGains, this\.gd\.layerCap\)/);
    // the battle is also built in the browser from a JSON spec, where Infinity would not survive: the flag is a boolean
    for (const f of ['server/match/match/combat.js', 'server/match/match/intents.js', 'server/match/match/bossRounds.js',
      'server/match/match/unitePhase.js', 'server/match/bot.js']) {
      const src = read(f);
      if (src.includes('flags: {')) assert.match(src, /uncapLayers: (this|m)\.gd\.uncapLayers/, `${f} passes the flag`);
    }
  });

  test('the invariant reads the match\'s ceiling, not the constant', () => {
    const src = read('server/match/invariants.js');
    assert.match(src, /v <= gd\.layerCap/, 'the layers check uses the effective cap');
    assert.ok(!/v <= BOND_LAYER_CAP/.test(src), 'and no longer the raw constant');
  });
});

describe('解除叠层上限: end to end in a real match', () => {
  test('with the switch OFF a bond stops at 999, exactly as before', async () => {
    const { makeMatch } = await import('./match/harness.js');
    const h = makeMatch({ mode: 'solo', humans: 1, seed: 3, fake: true }).start();
    try {
      assert.equal(h.m.gd.layerCap, 999, 'the default room carries the official ceiling');
      const id = h.m.gd.bondIds[0];
      const ps = h.ps('p_0');
      ps.layers[id] = 995;
      assert.equal(ps.addLayers(id, 10), 4, 'a gain at 995 adds only the room left (4)');
      assert.equal(ps.layers[id], 999, 'and the bond sits exactly at the cap');
      assert.equal(ps.addLayers(id, 10), 0, 'a further gain adds nothing');
      assert.equal(ps.layers[id], 999, 'never lowered, never passed');
    } finally { h.m.dispose(); }
  });

  test('with the switch ON the same gain passes 999', async () => {
    const { makeMatch } = await import('./match/harness.js');
    const h = makeMatch({ mode: 'solo', humans: 1, seed: 3, fake: true, mods: { uncapLayers: true } }).start();
    try {
      assert.equal(h.m.gd.layerCap, Infinity, 'the room carries no ceiling');
      assert.equal(h.m.gd.uncapLayers, true);
      const id = h.m.gd.bondIds[0];
      const ps = h.ps('p_0');
      ps.layers[id] = 995;
      assert.equal(ps.addLayers(id, 10), 10, 'the whole gain lands');
      assert.equal(ps.layers[id], 1005, 'past 999');
      assert.equal(ps.addLayers(id, 100), 100, 'and keeps landing');
      assert.equal(ps.layers[id], 1105);
      // the invariant admits the uncapped value instead of failing the match
      const { collectViolations } = await import('../server/match/invariants.js');
      assert.deepEqual(collectViolations(h.m).filter((v) => /layers/.test(v)), [], 'no layer violation at 1105');
    } finally { h.m.dispose(); }
  });

  test('the switch moves ONLY the ceiling: an inactive bond still cannot gain', async () => {
    const { makeMatch } = await import('./match/harness.js');
    for (const mods of [null, { uncapLayers: true }]) {
      const h = makeMatch({ mode: 'solo', humans: 1, seed: 3, fake: true, ...(mods ? { mods } : {}) }).start();
      try {
        const id = h.m.gd.bondIds.find((b) => !(h.ps('p_0').bonds[b] && h.ps('p_0').bonds[b].active));
        const ps = h.ps('p_0');
        ps.layers[id] = 0;
        assert.equal(ps.addLayers(id, 5, { requireActive: true }), 0,
          `requireActive still refuses an inactive bond (mods=${JSON.stringify(mods)})`);
        assert.equal(ps.layers[id], 0, 'and nothing was written');
      } finally { h.m.dispose(); }
    }
  });
});
