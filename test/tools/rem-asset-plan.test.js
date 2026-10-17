import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRemArtPlan, REM_BOND_ICON, REM_ENEMY_ART, remArtInput } from '../../tools/assets/rem-plan.mjs';
import { readFile } from 'node:fs/promises';
import { isCompletePng } from '../../tools/assets/formats.mjs';
import { collectLeaves } from '../../tools/assets/manifest.mjs';

test('Rem icon plan maps the local bond art and plans no download for it', () => {
  const template = { bonds: { other: '/art/other.svg' } };
  assert.equal(addRemArtPlan(template), template);
  assert.equal(template.bonds.other, '/art/other.svg');
  // Local art like 卡兹戴尔's: a path in the manifest, not a leaf with URLs to fetch.
  assert.equal(template.bonds.remShip, REM_BOND_ICON);
  assert.equal(REM_BOND_ICON, '/art/rem/bond.png');
  assert.deepEqual(collectLeaves(template), []);
});

test('Rem bond icon is committed art and a complete PNG', async () => {
  const bytes = await readFile(new URL(`../../public${REM_BOND_ICON}`, import.meta.url));
  assert.ok(isCompletePng(bytes), 'public/art/rem/bond.png is a complete PNG');
});

test('Rem art input plans all seven new native kits without dropping existing operators', () => {
  const input = remArtInput({assets07:{operators:{existing:{name:'existing'}}},ops03:{chess:[]}});
  assert.equal(Object.keys(input.assets07.operators).length,8);
  assert.equal(input.assets07.operators.existing.name,'existing');
  assert.equal(input.ops03.chess.length,7);
  assert.equal(Object.keys(REM_ENEMY_ART).length,8);
  for (const row of input.ops03.chess) {
    const op=input.assets07.operators[row.charId];
    assert.ok(op.battleSpine.front.skel.url.includes(row.charId));
    assert.ok(op.battleSpine.back.skel.url.includes(row.charId));
    assert.ok(op.skills.length>=2);
  }
});
