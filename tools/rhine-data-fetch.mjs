// tools/rhine-data-fetch.mjs — 刷新 `rhine-data.mjs` 用到的**那一小份固定源子集**。
//
// 来自 Rhine 仓（`codex/rhine-upstream-021`）的同名脚本，改了两处：
//   1. **数据来源改为本机已解包的官方表**（`.`cache/gamedata/excel/`，`tools/build-data.mjs` 用的就是这一份），
//      而不是 `raw.githubusercontent.com` —— 本机直连那个域名不通，而同一份表的字节就在本地。
//   2. 换人：多萝西 `char_4048_doroth` → 麦哲伦 `char_248_mgllan`（Rhine 2026-10-14 起），
//      对应的 token 也换成麦哲伦的三架原生无人机。
//
// 为什么仍要「钉住这一小份」而不是直接用完整官方表：`rhine-data.mjs` 只认这十几个干员，
// 把 15 MB 的 `character_table` 抄进 `rhine-data-source.json` 没有意义；固定子集让这份 JSON 可读、可 diff。
//
// 用法：`node tools/rhine-data-fetch.mjs`（幂等：同样的表 + 同样的名单 ⇒ 同样的字节）
import { readFile, writeFile } from 'node:fs/promises';

const REVISION = 'a550f5e048bb94e7cdefc6eb97a4091f0c4c7add';
const EXCEL = new URL('../.cache/gamedata/excel/', import.meta.url);
const NAMES = ['character_table', 'skill_table', 'range_table', 'uniequip_table', 'battle_equip_table'];

const load = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, EXCEL), 'utf8'));
const [chars, skills, ranges, equipment, battleEquipment] = await Promise.all(NAMES.map(load));

/** 有模组的干员（`charEquip` 里查得到的那几个）。 */
const moduleOwners = ['char_242_otter', 'char_4224_turdus', 'char_416_zumama', 'char_134_ifrit', 'char_135_halo', 'char_248_mgllan'];
/** 进固定子集的角色与 token。★ 多萝西换成麦哲伦；麦哲伦的三架无人机 token 也要在（`rhine.js` 按 defId 认它们）。 */
const ids = [
  ...moduleOwners,
  'char_128_plosis', 'char_202_demkni',
  'token_10004_otter_motter',
  'token_10005_mgllan_drone1', 'token_10005_mgllan_drone2', 'token_10005_mgllan_drone3',
];
for (const id of ids) if (!chars[id]) throw new Error(`Missing pinned character ${id}`);

const charTable = Object.fromEntries(ids.map((id) => [id, chars[id]]));
const skillIds = [...new Set(Object.values(charTable).flatMap((c) => (c.skills || []).map((s) => s.skillId)))];
const skillTable = Object.fromEntries(skillIds.filter((id) => skills[id]).map((id) => [id, skills[id]]));

const charEquip = Object.fromEntries(moduleOwners.map((id) => [id, equipment.charEquip[id] ?? []]));
const moduleIds = [...new Set(Object.values(charEquip).flat())];
const KEEP = ['uniEquipId', 'uniEquipName', 'uniEquipIcon', 'typeIcon', 'typeName1', 'typeName2', 'type', 'charId', 'isSpecialEquip', 'showEvolvePhase', 'unlockEvolvePhase', 'charLevel'];
const equipDict = Object.fromEntries(moduleIds.filter((id) => equipment.equipDict[id]).map((id) => {
  const e = equipment.equipDict[id];
  return [id, Object.fromEntries(KEEP.filter((k) => k in e).map((k) => [k, e[k]]))];
}));
const uniequipTable = { charEquip, equipDict };
const battleEquipTable = Object.fromEntries(moduleIds.filter((id) => battleEquipment[id]).map((id) => [id, battleEquipment[id]]));

const rangeIds = new Set();
const visit = (x) => {
  if (!x || typeof x !== 'object') return;
  for (const [k, v] of Object.entries(x)) { if (k === 'rangeId' && v) rangeIds.add(v); else visit(v); }
};
visit(charTable); visit(skillTable); visit(battleEquipTable);
const rangeTable = Object.fromEntries([...rangeIds].sort().filter((id) => ranges[id]).map((id) => [id, ranges[id]]));

const source = {
  source: {
    repository: 'https://github.com/Kengxxiao/ArknightsGameData',
    revision: REVISION,
    note: 'Extracted original client game data; no trust or potential bonuses. Optional modules retain all levels and mode conditions. This repository mirrors client data and is not an official Hypergryph repository. 本 fork 的取数改读本机 .cache/gamedata/excel/（同一份表的本地副本，本机无法直连 raw.githubusercontent.com）。',
    verifiedAgainst: ['梅尔', '乌啾', '森蚺', '伊芙利特', '星源', '麦哲伦'].map((name) => `https://prts.wiki/w/${encodeURIComponent(name)}`),
    files: NAMES.map((name) => `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${REVISION}/zh_CN/gamedata/excel/${name}.json`),
  },
  charTable, skillTable, rangeTable, uniequipTable, battleEquipTable,
};
await writeFile(new URL('./rhine-data-source.json', import.meta.url), `${JSON.stringify(source, null, 2)}\n`);
console.log(`Wrote ${ids.length} characters/tokens and ${skillIds.length} skills at ${REVISION}`);
