// 卡兹戴尔亡魂详情卡 (内容包 卡兹戴尔, tools/kazdel-data.mjs): a soul is a runtime def derived from the dead operator, so its
// card must NOT resolve back to the owner's editable piece and must read its own name / maxHp / range instead. Covered:
// resolveDetail hands the soul unit to the token card as `soulState` (the catalogue lookup falls back to the
// KAZDEL_SOUL_TOKEN placeholder — souls are deliberately absent from data/tokens.json), and TokenDetail renders the 亡魂
// chip, the soul's own name and the 众魂归来 rules instead of the summon's 说明 / 技能 / 天赋 sections.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLang, setMessages, registerLangs } from '../../shared/i18n.js';
import { KAZDEL_SOUL_TOKEN } from '../../shared/kazdel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

registerLangs([]);
setLang('zh');
setMessages('zh', {});

// The client modules read the generated data through public/js/data.js: stub fetch with the files on disk.
const FILES = { tokens: 'tokens.json', chess: 'chess.json', items: 'items.json', assets: 'assets.json', bonds: 'bonds.json' };
globalThis.fetch = async (url) => {
  const name = String(url).replace(/^.*\/([^/]+)$/, '$1');
  const file = FILES[name.replace(/\.json$/, '')];
  try {
    const body = readFileSync(path.join(ROOT, 'data', file ?? name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};
const { data } = await import('../../public/js/data.js');
await data.loadAll('tokens', 'assets');
const { resolveDetail, TokenDetail } = await import('../../public/js/ui/detailPanel.js');

const EXPAND = new Set(['Section', 'Stat', 'LiveTag']);
function* walk(v) {
  if (v == null || typeof v === 'boolean') return;
  if (typeof v === 'string' || typeof v === 'number') return;
  if (Array.isArray(v)) { for (const c of v) yield* walk(c); return; }
  yield v;
  if (typeof v.type === 'function' && EXPAND.has(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v.type === 'function' && EXPAND.has(v.type.name)) return textOf(v.type(v.props));
  if (typeof v.type === 'function' && v.type.name === 'RichText') return String(v.props.text || '');
  return textOf(v.props?.children);
};
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const byClass = (tree, c) => [...walk(tree)].filter((v) => hasClass(v, c));

/** A UnitInfo of a soul as the sim sends it (server/sim/snapshot.js: kazdelSoul + name / maxHp / avatar). */
const soulUnit = (o = {}) => ({
  id: 41, kind: 'token', defId: 'kazdel_soul_char_1_05', name: '红豆的亡魂', kazdelSoul: true,
  maxHp: 2300, avatar: '/art/kazdel/bond.png', range: [[0, 0], [0, 1]], side: 'ally', uid: 7, ...o,
});

test('resolveDetail: a soul reaches the token card as soulState, never as the owner piece', () => {
  const d = resolveDetail({ kind: 'unit', unit: soulUnit() }, new Map());
  assert.equal(d.type, 'token');
  assert.equal(d.token.tokenId, KAZDEL_SOUL_TOKEN, 'souls are absent from the token catalogue');
  assert.equal(d.token.name, '红豆的亡魂', 'the placeholder carries the soul name');
  assert.equal(d.soulState.kazdelSoul, true);
  assert.equal(d.unitId, 41);
  // a plain summon takes the ordinary path: no soulState (it resolves through its piece, not this unit branch)
  const plain = resolveDetail({ kind: 'unit', unit: { id: 42, kind: 'token', defId: 'token_10035_wisdel_wward' } }, new Map());
  assert.ok(!plain || plain.soulState === undefined);
});

test('TokenDetail: the 亡魂 card shows its own name, HP and the 众魂归来 rules, not the summon sections', () => {
  const soul = soulUnit();
  const tree = TokenDetail({ token: { tokenId: KAZDEL_SOUL_TOKEN, name: soul.name, stats: {} }, soulState: soul });
  const text = textOf(tree);
  assert.equal(byClass(tree, 'dtag-kazdel-soul').length, 1, 'the 亡魂 chip');
  assert.match(text, /亡魂/);
  assert.match(text, /红豆的亡魂/);
  assert.match(text, /2,300/, 'the unit maxHp, not the (absent) token record');
  assert.match(text, /众魂归来/);
  assert.match(text, /不占人口/);
  assert.match(text, /战争巨炮不会伤害亡魂/);
  assert.doesNotMatch(text, /召唤物/, 'a soul is not called a summon');
  assert.ok(byClass(tree, 'drange').length >= 1, 'the soul keeps a 攻击范围 mini-map');
  // a plain token keeps the summon card: no 亡魂 chip, no 众魂归来 section
  const plain = TokenDetail({ token: { tokenId: 'token_10035_wisdel_wward', name: '魂灵', stats: { maxHp: 1200, atk: 100 } } });
  assert.equal(byClass(plain, 'dtag-kazdel-soul').length, 0);
  assert.doesNotMatch(textOf(plain), /众魂归来/);
  assert.match(textOf(plain), /召唤物/);
});
