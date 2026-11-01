import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleLine, roomPluginFacts, pluginTagText } from '../../public/js/ui/pluginTag.js';
import { pieceBondIds, grantedBonds, setMorphPairing } from '../../public/js/ui/gameLogic/bonds.js';
import { equipReplaces } from '../../public/js/ui/gameLogic/placement.js';
import { replaceRequest } from '../../public/js/ui/equipReplace.js';
import { describeError } from '../../public/js/ui/toasts.js';
import { catalog } from '../../public/js/content.js';
import { addMessages, setLang } from '../../shared/i18n.js';
import fs from 'node:fs';
import { errorMsg } from '../../server/net.js';

test('P9: rule-conflict toasts name both plugins and the switch in the player language', () => {
  const before = catalog.get();
  catalog.set({ ...before, plugins: [
    { id: 'aa', names: { zh: '甲', en: 'Alpha' } }, { id: 'bb', names: { zh: '乙', en: 'Beta' } },
  ] });
  const err = { code: 'PLUGIN_RULE_CONFLICT', detail: 'PLUGIN_RULE_CONFLICT unequip: aa and bb set unequip to different options' };
  try {
    assert.equal(describeError(err), '「甲」和「乙」的规则开关「卸下装备」选项冲突');
    addMessages('en', JSON.parse(fs.readFileSync(new URL('../../public/i18n/en.json', import.meta.url))));
    setLang('en');
    assert.equal(describeError(err), '“Alpha” and “Beta” choose different options for “Unequip items”');
    catalog.set({ ...before, plugins: [] });
    assert.match(describeError(err), /aa.*bb/);
    const a = 'a'.repeat(32), b = 'b'.repeat(32);
    for (const rule of ['shopBias', 'prepLoadout', 'morphPairing', 'unequip']) {
      const wire = errorMsg('PLUGIN_RULE_CONFLICT', 'test', `PLUGIN_RULE_CONFLICT ${rule}: ${a} and ${b} set ${rule} to different options`);
      assert.match(describeError(wire), new RegExp(`${a}.*${b}`), `${rule}: bounded wire detail still names both ids`);
    }
    assert.doesNotThrow(() => describeError({ code: 'PLUGIN_RULE_CONFLICT', detail: 'malformed' }));
  } finally { setLang('zh'); catalog.set(before); }
});

test('room and match summaries expose the active rules in words; vanilla adds no text', () => {
  assert.equal(ruleLine(null), '');
  const room = { content: { vanilla: false, plugins: [{ id: 'rule-demo', class: 'content' }], rules: { unequip: 'allow' } } };
  assert.deepEqual(roomPluginFacts(room).rules, { unequip: 'allow' });
  assert.equal(ruleLine(room.content.rules), '规则：可以卸下装备');
  assert.match(pluginTagText(room), /可以卸下装备/);
  assert.equal(pluginTagText({}), '原版');
});

test('client plus pairing and replacement options follow the same slot policy', () => {
  const records = { morph: { canGiveBond: true }, hammer: { giveBondId: 'one' }, shield: { giveBondId: 'two' }, incoming: {} };
  const get = (id) => records[id];
  const items = [{ id: 'morph', uid: 1 }, { id: 'hammer', uid: 2 }, { id: 'shield', uid: 3 }];
  assert.deepEqual(grantedBonds(items, get), ['one', 'two']);
    // ★ 2026-11-01(戊组)：plus 档由**全局** morphPairing 决定（bonds.js:17 的 setMorphPairing，roomMods.js:65 写它），
  //   本文件从没设过 ⇒ 拿到默认档，于是多出 'two'。按裁定在断言前显式切到 plus 档（功能不动）。
  setMorphPairing('plus');
  assert.deepEqual(pieceBondIds({ bonds: ['base'] }, items, get), ['base', 'one']);
  setMorphPairing(null);
  const target = { uid: 9, kind: 'chess', id: 'wearer', items };
  const incoming = { uid: 4, kind: 'item', id: 'incoming' };
  const pieces = new Map([[9, { piece: target }], [4, { piece: incoming }], [5, { piece: { id: 'morph' } }]]);
  const ctx = { pieces, getItem: get, morphMode: 'plus' };
  assert.equal(equipReplaces(ctx, 4, target), true);
  assert.equal(equipReplaces(ctx, 5, target), false, 'morph never requests replacement');
  const request = replaceRequest(ctx, { t: 'g.equip', fields: { itemUid: 4, targetUid: 9 }, confirmReplace: true }, () => null, get);
  assert.deepEqual(request.options.map((it) => it.uid), [2, 3], 'morph is never offered for destruction');
  target.items = items.slice(0, 2);
  assert.equal(equipReplaces(ctx, 4, target), false, 'one real slot is still free');
});
