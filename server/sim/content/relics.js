// Collection bonuses are resolved from shared, trusted definitions. A single persistent buff contains the
// collection modifiers, so death, redeployment and re-installation never multiply the same bonuses.
import { getRelic, relicModifiers } from '../../../shared/relics.js';
import { passiveBuff, playerOps, onField, inRange, unitBonds } from './support/index.js';
import { spawnYanyou } from './tokens.js';
import { RESIST_STATUSES } from '../buffs.js';

const KEY = 'relic:collection';
const healingHandInstalled = new WeakSet();
const fertilizerInstalled = new WeakSet();
const skillEndSpInstalled = new WeakSet();
const poisonDaggerInstalled = new WeakSet();
const riverPrayerInstalled = new WeakSet();
const killRelicsInstalled = new WeakSet();
const sachetInstalled = new WeakSet();
const iceFireInstalled = new WeakSet();

function installSachet(battle, byPlayer) {
  if (sachetInstalled.has(battle)) return;
  sachetInstalled.add(battle);
  const used = new Set();
  battle.on('deploy', ({ unit }) => {
    if (unit.kind !== 'op' || !byPlayer.get(unit.ownerId)?.includes('relic_132')
      || used.has(unit.ownerId) || !unitBonds(unit).includes('yanShip')) return;
    used.add(unit.ownerId);
    // PRTS integrated-strategy variant: base stats, no Yan stat inheritance or elemental immunity.
    // [ASSUMED] Once per owner per battle; current Yan membership includes bond-granting equipment.
    for (const y of spawnYanyou(battle, unit.ownerId, { at: [unit.tileR, unit.tileC] })) y.mem.relicYanyou = true;
  });
}

function installIceFire(battle) {
  if (iceFireInstalled.has(battle)) return;
  iceFireInstalled.add(battle);
  // One field-wide enemy intake bonus; repeated IDs/holders never multiply the same collectible.
  const apply = (unit) => {
    if (unit.side === 'enemy') passiveBuff(battle, unit, 'relic:133', { elemTakenMul: 1.75, elementalTakenMul: 1.75 });
  };
  for (const unit of battle.enemies) apply(unit);
  battle.on('enemySpawn', ({ enemy }) => apply(enemy));
}

function installKillRelics(battle, byPlayer) {
  if (![...byPlayer.values()].some((ids) => ids.some((id) => ['relic_116', 'relic_117', 'relic_118', 'relic_119'].includes(id)))
    || killRelicsInstalled.has(battle)) return;
  killRelicsInstalled.add(battle);
  // A kill hook precedes enemy survival/revival checks; death confirms an actual knock-out.
  battle.on('death', ({ unit: victim, killer, reason }) => {
    if (reason !== 'killed' || victim.side !== 'enemy' || killer?.kind !== 'op' || !onField(killer) || killer.removed || killer.hp <= 0) return;
    const ids = byPlayer.get(killer.ownerId);
    if (!ids) return;
    if (ids.includes('relic_116')) battle.addBuff(killer, {
      key: 'relic:116', duration: 2, mods: { aspd: 100 },
    });
    // [ASSUMED] An ordinary SP gift: respects active-skill/noSp locks and the skill's charge cap.
    if (ids.includes('relic_117')) killer.skill.gainSp(2, 'relic');
    if (ids.includes('relic_118')) battle.heal(killer, killer, killer.s.maxHp * 0.1, { self: true });
  });
  const deployments = new WeakMap();
  const originalPositions = new WeakMap();
  for (const u of battle.allyUnits) originalPositions.set(u, u.def?.position);
  battle.on('deploy', ({ unit: u }) => {
    if (u.kind !== 'op' || !byPlayer.get(u.ownerId)?.includes('relic_119') || !onField(u) || u.removed) return;
    if (!originalPositions.has(u)) originalPositions.set(u, u.def?.position);
    // PRTS: current and original deployment types must both be RANGED; a melee unit on a high tile is excluded.
    if (originalPositions.get(u) !== 'RANGED' || u.def?.position !== 'RANGED' || deployments.get(u) === u.deploySeq) return;
    deployments.set(u, u.deploySeq);
    battle.addBuff(u, { key: 'relic:119', shield: u.s.maxHp, shieldPriority: -1000, duration: Infinity });
  });
}

function installRiverPrayer(battle) {
  if (riverPrayerInstalled.has(battle)) return;
  riverPrayerInstalled.add(battle);
  // PRTS 河谷祭祈 (No.134): every enemy receives the four burst enhancements, regardless of fill source.
  // One field-wide effect, even if several players hold it. Ally bursts and the legacy gauge are unchanged.
  battle.on('elementBurst', ({ target, element, config }) => {
    if (target.side !== 'enemy') return;
    if (element === 'apoptosis') { config.elemDps *= 2.5; config.atkMul = 0.7; }
    else if (element === 'burn') { config.elemDamage *= 3.8; config.resDown += 20; }
    else if (element === 'neural') { config.elemDamage *= 2; config.elemDps = 1000; }
    else if (element === 'erosion') { config.defDown += 120; config.physTicks = 10; config.physTickDamage = 1500; }
  });
}

function installPoisonDagger(battle, owners) {
  if (!owners.size || poisonDaggerInstalled.has(battle)) return;
  poisonDaggerInstalled.add(battle);
  let seq = 0;
  battle.on('death', ({ unit }) => {
    for (const buff of unit.buffs.slice()) if (buff.tags.includes('relic:240')) battle.removeBuff(unit, buff);
  });
  battle.on('damageConvert', (ctx) => {
    const { source, target, dmg } = ctx;
    if (ctx.cancel || source?.kind !== 'op' || !owners.has(source.ownerId) || target.side !== 'enemy') return;
    // Weakness-damage hooks can turn an Arts tick back into Physical. Keep the converted tick Arts,
    // rather than splitting it into five new poison layers every second.
    if (dmg.tags.includes('relic:240')) { dmg.type = 'arts'; return; }
    if (dmg.type !== 'phys' || !(dmg.amount > 0)) return;
    // Conversion replaces ordinary injury settlement, so resolve this hit's Physical dodge once here.
    if (dmg.canDodge && target.s.dodgePhys > 0 && battle.rng() < target.s.dodgePhys) {
      battle.fx('dodge', { x: target.x, y: target.y, id: target.id });
      const cancelled = dmg.dodgeMode !== 'uncancellable' && !dmg.ignoreCancelReasons?.includes('dodge');
      if (battle._hooks.dodge) battle.emit('dodge', { source, target, dmg, credit: ctx.credit, cancelled });
      if (cancelled) { ctx.cancel = true; return; }
    }
    // Physical boosts are captured once, before DEF. Each delayed arts instance then uses live RES,
    // arts/general multipliers and shields. A missed/cancelled hit never reaches this hook.
    const amount = dmg.amount * source.s.physDealtMul / 5;
    const { mul, resIgnorePct, resIgnoreFlat } = dmg;
    const tags = [...dmg.tags, 'dot', 'relic:240'];
    let remaining = 5;
    let nextAt = battle.time + 1;
    battle.addBuff(target, {
      key: `relic:240:${++seq}`, source, duration: Infinity, tags: ['relic:240'],
      onTick: ({ buff }) => {
        // Scheduled skills can hit before this frame's buff pass; wait a full second from the actual hit.
        if (battle.time + 1e-9 < nextAt) return;
        nextAt += 1;
        battle.dealDamage(source, target, {
          amount, type: 'arts', mul, resIgnorePct, resIgnoreFlat,
          canDodge: false, ignoreSelect: true, tags,
        });
        if (--remaining === 0) battle.removeBuff(target, buff);
      },
    });
    ctx.cancel = true;
  });
}

function installSkillEndSp(battle, byPlayer) {
  const refunds = new Map();
  for (const [pid, ids] of byPlayer) {
    const amount = ids.reduce((sum, id) => sum + (getRelic(id).skillEndSp ?? 0), 0);
    if (amount > 0) refunds.set(pid, amount);
  }
  if (!refunds.size || skillEndSpInstalled.has(battle)) return;
  skillEndSpInstalled.add(battle);
  // PRTS No.139/140: forced SP recovery bypasses 阻回, retaining the runtime's charge/cost caps.
  // [ASSUMED] Only a living, deployed operator receives the refund; death/retreat is not a completed cast.
  battle.on('skillEnd', ({ unit: u, skill, reason }) => {
    const amount = refunds.get(u?.ownerId);
    if (!amount || u?.kind !== 'op' || !onField(u) || u.removed || reason === 'death') return;
    skill.gainSp(amount, 'relic', false, { ignoreLock: true });
  });
}

function installFertilizer(battle, owners) {
  if (!owners.size || fertilizerInstalled.has(battle)) return;
  fertilizerInstalled.add(battle);
  // One proc per completed attack action (including healing attacks), never per target or hit.
  // [ASSUMED] Follow the engine's attack event, after the attack resolves; direct skill damage is not an attack.
  battle.on('attack', ({ attacker: u }) => {
    if (u?.kind !== 'op' || !onField(u) || u.removed || !owners.has(u.ownerId)) return;
    battle.loseHp(u, Math.min(50, Math.max(0, u.hp - 1)), { tags: ['relic:125'] });
    if (!onField(u) || u.removed) return;
    const key = 'relic:125:barrier';
    const cap = u.s.maxHp * 1.4;
    const shield = Math.min(cap, (u.findBuff(key)?.shield ?? 0) + 100);
    battle.addBuff(u, { key, shield, duration: Infinity });
  });
}
// [ASSUMED] Use the engine's control-status catalogue plus stack-based palsy. Attribute debuffs,
// elemental buildup and HP loss are not abnormal statuses. PRTS 护愈之手 (No.172), adapted by maintainer:
// every MEDIC, no prerequisite relic; both benefits apply to the owner's operators inside a medic's range.
const HAND_ABNORMAL = new Set([...RESIST_STATUSES, 'palsy']);

function installHealingHand(battle, owners) {
  if (!owners.size || healingHandInstalled.has(battle)) return;
  healingHandInstalled.add(battle);
  const covered = (target) => target?.kind === 'op' && onField(target) && !target.removed && owners.has(target.ownerId)
    && battle.allyUnits.some((u) => u.kind === 'op' && u.ownerId === target.ownerId && u.def?.profession === 'MEDIC'
      && onField(u) && !u.removed && inRange(u, target));
  battle.on('beforeStatus', (ctx) => {
    if (HAND_ABNORMAL.has(ctx.status) && covered(ctx.target)) ctx.cancel = true;
  });
  // [ASSUMED] Existing control statuses are removed when entering coverage. Passive coverage survives
  // a medic's inability to act; range, death and redeployment are checked live, without lingering aura buffs.
  const cleanse = () => {
    for (const u of battle.allyUnits) {
      if (!covered(u)) continue;
      for (const buff of u.buffs.slice()) if (HAND_ABNORMAL.has(buff.status)) battle.removeStatus(u, buff.status);
    }
  };
  battle.on('tick', cleanse);
  battle.on('deploy', cleanse);
  // Maintainer adaptation: full-HP operators can be healed to build the barrier. Stop selecting them at the cap;
  // the query's existing HP-ratio ordering still puts injured allies first.
  battle.on('healTarget', (ctx) => {
    const a = ctx.target;
    if (!a.s.flags.noHeal && !a.profile?.noHeal && covered(a)
      && (a.findBuff('overheal')?.shield ?? 0) < a.s.maxHp) ctx.eligible = true;
  });
  battle.on('heal', ({ target, opts }) => {
    // Regeneration is not a healing action; blocked heals never reach this hook.
    if (!opts.regen && covered(target)) opts.overheal = true;
  });
}

export function install(battle) {
  const byPlayer = new Map();
  for (const ps of battle.players) {
    const input = ps.input?.relics;
    const ids = Array.isArray(input) ? [...new Set(input.filter((id) => typeof id === 'string' && getRelic(id)))] : [];
    if (ids.length) byPlayer.set(ps.playerId, ids);
  }
  if (!byPlayer.size) return;
  if ([...byPlayer.values()].some((ids) => ids.includes('relic_133'))) installIceFire(battle);
  installSachet(battle, byPlayer);
  if ([...byPlayer.values()].some((ids) => ids.includes('relic_134'))) installRiverPrayer(battle);
  installHealingHand(battle, new Set([...byPlayer].filter(([, ids]) => ids.includes('relic_172')).map(([pid]) => pid)));
  installFertilizer(battle, new Set([...byPlayer].filter(([, ids]) => ids.includes('relic_125')).map(([pid]) => pid)));
  installSkillEndSp(battle, byPlayer);
  installPoisonDagger(battle, new Set([...byPlayer].filter(([, ids]) => ids.includes('relic_240')).map(([pid]) => pid)));

  const apply = (unit) => {
    if (!unit || unit.kind !== 'op') return;
    const ids = byPlayer.get(unit.ownerId);
    if (!ids) return;
    const mods = relicModifiers(ids, unit.def?.profession, unit.def?.position);
    if (Object.keys(mods).length) passiveBuff(battle, unit, KEY, mods);
  };

  // Before the first deployment: HP bonuses are already included in its full-health / carry-ratio state.
  for (const pid of byPlayer.keys()) for (const unit of playerOps(battle, pid)) apply(unit);
  // Covers future operators too; the same key replaces the passive instead of stacking it on redeploy.
  battle.on('deploy', ({ unit }) => apply(unit));
  installKillRelics(battle, byPlayer);
}
