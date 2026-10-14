// server/sim/content/bonds/addon/rhine.js — 莱茵生命 (`rhineShip`), the ported 盟约 (六.3, fork-overrides.mjs
// applyForkBonds). Data: `data/bonds.json` `rhineShip` + `data/effects.json` `bondeffect_rhine`; the operators that
// list it are the official 莱茵生命 members (`applyForkPackMembers`) plus 谬因 through her 自选 entry
// (`applyForkPackAphris`). The whole 盟约 comes and goes with the 内容包开关 `packRhine` / `packAphris`
// (shared/packData.js), and with both off nothing here is reached: the bond is not in `gd.bondIds` at all.
//
// Implemented here (the source expansion's own numbers, shared/constants.js PACK_AUTHORS.packRhine):
//   3 / 6 / 9 distinct members (the bond record's thresholds) and the 6-member ATK sharing — a deployed 莱茵 damage
//   operator gains `sharing_atk` (0.15, elite 0.25) of the highest deployed 科研装置's base attack as flat ATK.
//
//   [ASSUMED] the device base attack is taken from the bond's own formula (`base_atk + atk_per_stack · 科研层数`,
//   300 + 4·L) instead of reading the deployed devices, because the devices themselves are 六.4's scope: with none of
//   them on the field yet, reading the devices would make the 盟约's headline effect a permanent zero. The source
//   expansion takes the highest of its DEPLOYED, enabled devices (0 when there are none) — when 六.4 lands, this
//   function should read that instead and this note goes away.
//
// NOT here (the 科研装置 themselves — 生态维持仪 / 能量谐振仪 / 激光钻机, their deployment, breakthroughs, healing,
// shields and pulses): that is 六.4's scope (the ported 莱茵生命 expansion in full). Until then the 盟约 is fully
// functional as a 盟约 — it activates, it stacks, it shows in the 盟约 bar with its own description, and its members
// gain the ATK sharing.
//
// The 特征 that read 莱茵 membership for their own kits (梅尔 / 白面鸮 / 塞雷娅 / 缪尔赛思 / 伊芙利特) use their own
// hard-coded `character_table` groupId lists and are unaffected: this file never changes an operator's identity.

import { bondRecord, buffParams, num, playerOps, isElite, isMember, passiveBuff } from '../../support/index.js';

export const RHINE_BOND = 'rhineShip';
/** The FT-ATK passive key (replaced in place, so `refresh` is idempotent). */
const KEY = 'bond:rhineShip:sharing';
/**
 * The sharing goes to the 莱茵 输出干员 that are genuinely damage dealers: 伊芙利特 and the 治疗干员 are out, and so is
 * 塞雷娅 — the source expansion gives HER the healing trait (`garrison_rhine_saria`, 六.4) instead of a share. Same set
 * as the source's `damageOperator`, so her 六.4 trait and this sharing never both land on one operator.
 */
const MEDIC = 'MEDIC';
const IFRIT = 'char_134_ifrit';
const SARIA = 'char_202_demkni';
const DAMAGE_TYPES = ['phys', 'arts', 'true'];
const charIdOf = (u) => u?.def?.charId ?? u?.def?.raw?.charId ?? null;
const damageOperator = (u) =>
  u.def?.profession !== MEDIC && charIdOf(u) !== IFRIT && charIdOf(u) !== SARIA && DAMAGE_TYPES.includes(u.dmgType);
/** The source expansion's `alive()`: a share only reaches an operator standing on the field. */
const deployed = (u) => !!u && u.alive && u.deployed && !u.removed && !u.hidden;

/**
 * The bond's own blackboard (`env_gbuff_new`), like every other add-on bond — the same lookup `addon/battle.js bondBb`
 * does, kept as a named export here so the tests of this 盟约 do not reach into another bond's module.
 */
export const rhineBb = (bondId = RHINE_BOND) => buffParams(bondRecord(bondId), 'env_gbuff_new') ?? {};

/**
 * Base attack of a 科研装置 at `layers` 科研层数: `base_atk + atk_per_stack · L`. Exported for the tests — this is the
 * value the 6-member sharing takes a share of.
 */
export function rhineDeviceAttack(bb, layers) {
  return Math.max(0, num(bb.base_atk) + num(bb.atk_per_stack) * Math.max(0, num(layers)));
}

/**
 * The 莱茵生命 ATK sharing of one player: with `sharing_count` (6) distinct members, every DEPLOYED 莱茵 damage operator
 * that is NOT 伊芙利特 / 塞雷娅 / a 治疗干员 gains `sharing_atk` (elite: `sharing_golden_atk`) of the device's base
 * attack. Re-applied on every change that can move it; `passiveBuff` replaces by key, so it is idempotent.
 */
export function applyRhineSharing(battle, st) {
  const bond = battle.getPlayer(st.pid)?.bonds?.[RHINE_BOND];
  const bb = st.bb;
  const count = num(bond?.count);
  const sharing = !!bond?.active && count >= num(bb.sharing_count, 6);
  const layers = Math.max(0, num(bond?.layers));
  const atk = sharing ? rhineDeviceAttack(bb, layers) : 0;
  for (const u of st.ops) {
    // membership first: the share is a 莱茵生命 effect and reaches 莱茵生命 operators only (the source's `memberOf`)
    const eligible = sharing && deployed(u) && isMember(battle, u, RHINE_BOND) && damageOperator(u);
    const flat = eligible ? atk * num(isElite(u) ? bb.sharing_golden_atk : bb.sharing_atk) : 0;
    // `atkFlat` is 最终加算 (units.js: `(base + atkFlat) · (1 + atkPct) + atkFinal`), which is what the bond's own text
    // calls for: the device's base attack is added to the operator's, not scaled by its ATK +%.
    if (flat > 0) passiveBuff(battle, u, KEY, { atkFlat: flat });
    else if (u.findBuff?.(KEY)) battle.removeBuff(u, KEY);
  }
}

export function install(battle) {
  if (!battle || !Array.isArray(battle.players) || !battle.players.length) return;
  /** @type {Map<string, { pid: string, ops: any[], bb: any }>} */
  const states = new Map();
  for (const p of battle.players) {
    const bond = p.bonds?.[RHINE_BOND];
    if (!bond || !(num(bond.count) > 0)) continue;
    states.set(p.playerId, { pid: p.playerId, ops: playerOps(battle, p.playerId), bb: rhineBb() });
  }
  if (!states.size) return;
  const refresh = () => { for (const st of states.values()) applyRhineSharing(battle, st); };
  battle.on('battleStart', refresh);
  battle.on('deploy', refresh);
  battle.on('death', refresh);
  // A live layer change (层数 gains during the battle) moves the device attack the sharing is a fraction of. The gain
  // is emitted before the engine writes the live count, so run after that transaction — the rule 助力 follows.
  battle.on('layerGain', (c) => {
    if (!c || c.bondId !== RHINE_BOND || !states.has(c.playerId)) return;
    battle.after(0, refresh);
  });
  refresh();
}
