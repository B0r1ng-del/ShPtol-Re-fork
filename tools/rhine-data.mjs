// Deterministic, offline roster overlay. Run: node tools/rhine-data.mjs [--out data]
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkill, statsFrom, interpolateAttrs, baseTalentList, traitRecord, rangeGrid, immunitiesOf,
  unlocked, bestCandidate, moduleAttr, moduleTalentChanges, splitModuleParts, tokenVariant, OPERATOR_POTENTIAL,
  withPotential, attachPotential } from './build-data.mjs';
import { RHINE_BOND, RHINE_CHARACTERS, RHINE_BALANCE, RHINE_DEVICES, RHINE_EQUIPMENT } from '../shared/rhineResearch.js';
import { composeStats, composeTalents } from '../shared/loadoutRecord.js';
import { atRank, stripPotential, FULL_RANK } from '../shared/potential.js';
import { PACK_RESTORE_FIELD, PACK_ID_FIELD } from '../shared/packData.js';

/** The Mod switch this expansion belongs to (`shared/constants.js` PACK_KEYS); `packRestore` is keyed by it. */
const RHINE_PACK = 'packRhine';
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * `chess.identifier` of the first ported operator (normal form; the elite takes the next one). An identifier is a
 * display-order key, and the official run ends at 277 (`chess_char_6_diy5_b`) with the fork's own 自选 slots at
 * 266–277 and `tools/fork-extra6.mjs` holding 10001–10004 — so the ported roster continues that block. The source
 * expansion's own 200 + index collided with five official elites (`chess_char_4_08_b` … `_4_13_b`) and gave both forms
 * of an operator the same number, which `test/fork-data.test.js` rejects.
 */
const RHINE_IDENTIFIER = 10005;
/** The tables `build-data.mjs` writes in natural key order (see the re-key at the end of `applyRhineData`). */
const SORTED_TABLES = ['chess', 'garrisons', 'items'];
/** `tools/build-data.mjs naturalCmp` — the sort its own tables are written in. */
const naturalCmp = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

/** `files` at one potential rank: every annotated record stripped back to that rank's own values. */
function atPotential(files, rank) {
  const out = structuredClone(files);
  for (const [id, record] of Object.entries(out.chess)) out.chess[id] = stripPotential(atRank(record, rank));
  for (const unit of Object.values(out.backups?.units || {})) {
    for (const [key, form] of Object.entries(unit.forms)) unit.forms[key] = stripPotential(atRank(form, rank));
  }
  for (const table of [out.tokens, out.backups?.tokens]) {
    for (const token of Object.values(table || {})) {
      for (const [owner, variant] of Object.entries(token.variants || {})) token.variants[owner] = stripPotential(atRank(variant, rank));
    }
  }
  return out;
}

/**
 * Build the ported records at EVERY potential rank, then annotate them the way the official roster is annotated: the
 * ported operators' `potDown` chains are produced by the same `attachPotential`, so their 潜能 1–6 behaviour is the
 * upstream annotation format rather than a second, extension-only shape.
 */
async function applyPotentialOverlay(files, apply, source) {
  const passes = [];
  for (let rank = 0; rank <= FULL_RANK; rank++) {
    const current = atPotential(files, rank);
    await apply(current, { ...source, potRank: rank });
    passes.push(current);
  }
  const errors = attachPotential(passes.map((p) => ({ chess: p.chess, tokens: p.tokens, backups: p.backups || { units: {}, tokens: {} } })));
  if (errors.length) throw new Error(errors.join('\n'));
  Object.assign(files, passes[FULL_RANK]);
  return files;
}

export const RHINE_ADDITIONS = Object.freeze([
  { key: 'mayer', charId: 'char_242_otter', tier: 1, bonds: [RHINE_BOND], skillId: 'skchr_otter_1', defaultModuleId: 'uniequip_002_otter', subName: '召唤师', trait: 'mayer' },
  { key: 'wuhoo', charId: 'char_4224_turdus', tier: 4, bonds: ['skillfulShip', 'emptyShip'], skillId: 'skchr_turdus_2', defaultModuleId: 'uniequip_002_turdus', subName: '链愈师', trait: 'copy_start' },
  { key: 'eunectes', charId: 'char_416_zumama', tier: 5, bonds: ['soloShip', 'sargonShip'], skillId: 'skchr_zumama_3', defaultModuleId: 'uniequip_002_zumama', excludedModuleIds: ['uniequip_004_zumama'], subName: '决战者', trait: 'copy_end' },
  { key: 'ifrit', charId: 'char_134_ifrit', tier: 5, bonds: ['arcaneShip', RHINE_BOND], skillId: 'skchr_ifrit_2', defaultModuleId: 'uniequip_002_ifrit', subName: '轰击术师', trait: 'ifrit' },
  { key: 'astgenne', charId: 'char_135_halo', tier: 2, bonds: [RHINE_BOND, 'preciShip'], skillId: 'skchr_halo_1', defaultModuleId: 'uniequip_002_halo', subName: '链术师', trait: 'astgenne' },
  { key: 'dorothy', charId: 'char_4048_doroth', tier: 4, bonds: [RHINE_BOND], skillId: 'skchr_doroth_3', defaultModuleId: 'uniequip_002_doroth', excludedModuleIds: ['uniequip_003_doroth'], subName: '陷阱师', trait: 'dorothy' },
]);
const TOKEN = 'token_10004_otter_motter';
export const DOROTHY_TOKEN = 'token_10025_doroth_recttp';
const clone = x => structuredClone(x);
const BASE_STATS = { maxHp: 3000, atk: 300, def: 0, res: 0, cost: 0, blockCnt: 0, bat: 1, aspd: 100,
  respawnTime: 999, spRecovery: 0, hpRecoveryPerSec: 0, moveSpeed: 0, tauntLevel: -10, massLevel: 0, deployLimit: 1, deckStack: 0 };
const TEXT = `在场${RHINE_BALANCE.thresholds[0]}名不同【莱茵生命】干员时启动一台科研装置；在场${RHINE_BALANCE.thresholds[1]}名时同时启动两台，${RHINE_BALANCE.thresholds[2]}名时三台全部启动。达到${RHINE_BALANCE.sharingCount}名时，除伊芙利特和治疗干员外的莱茵输出干员获得己方已部署装置中最高基础攻击力的${RHINE_BALANCE.researchSharing[0] * 100}%，精锐${RHINE_BALANCE.researchSharing[1] * 100}%，作为额外攻击力；多个装置不重复共享。3名时获得生态维持仪与能量谐振仪，9名时解锁只有一级的全场激光钻机。装置基础攻击力${RHINE_BALANCE.baseAttack}，每层科研增加${RHINE_BALANCE.attackPerLayer}点。生态维持仪与能量谐振仪参战成功获得${RHINE_BALANCE.successPoints}研究点，失败获得${RHINE_BALANCE.failurePoints}点；${RHINE_BALANCE.breakthroughPoints.map((n,i) => `第${i+1}次突破需要${n}点`).join('，')}。每次突破后研究点清零，溢出不保留；科研层数不受影响，激光钻机不积累研究点或突破。`;

// This expansion is not a sandbox/roguelike mode. Preserve the source conditions for auditing,
// but never compile mode-restricted module parts into the live ordinary-battle blackboards.
function ordinaryModulePhase(ctx, id, equipLevel) {
  const raw = ctx.battleEquipTable?.[id]?.phases.find(p => p.equipLevel === equipLevel);
  return raw ? { ...raw, parts: raw.parts.filter(p => !p.validInGameTag && !p.validInMapTag) } : null;
}
function moduleChoices(ctx, char, status, label, spec) {
  if (!status.equipLevel) return [];
  const { phase, level, equipLevel } = status;
  return (ctx.uniequipTable?.charEquip[char.charId] || []).flatMap(id => {
    const meta = ctx.uniequipTable.equipDict[id], ph = ordinaryModulePhase(ctx, id, equipLevel);
    if (meta.type === 'INITIAL' || !ph || spec.excludedModuleIds?.includes(id)) return [];
    const { op } = splitModuleParts(ph);
    const hasTrait = op.some(p => bestCandidate(p.overrideTraitDataBundle?.candidates, phase, level, (ctx.potRank ?? OPERATOR_POTENTIAL)));
    const restrictedModes = [...new Set(ctx.battleEquipTable[id].phases.flatMap(p => p.parts.map(x => x.validInGameTag).filter(Boolean)))];
    const scopeNote = meta.isSpecialEquip ? '仅应用基础属性；生息演算限定的技力限制解除、食物、引敌、额外阻挡、群攻和物理脆弱效果在卫戍协议中不生效。'
      : id === 'uniequip_002_otter' ? '首个召唤物不占部署位；不过卫戍召唤物本来就不占人口，所以这条效果没了XP' : null;
    const traitOverride = hasTrait ? traitRecord(ctx, char, phase, level, op, label, (ctx.potRank ?? OPERATOR_POTENTIAL)).trait : null;
    // RA-alpha's source trait part has no tag, but its own description explicitly scopes the
    // SP unlock to sandbox mode. Keep that original explanation while retaining the ordinary
    // blocking-only SP rule; the condition is semantic, not safely inferred from a null tag.
    if (id === 'uniequip_004_zumama' && traitOverride) {
      const baseTrait = traitRecord(ctx, char, phase, level, [], label, (ctx.potRank ?? OPERATOR_POTENTIAL)).trait;
      traitOverride.bb = clone(baseTrait.bb); traitOverride.bbStr = clone(baseTrait.bbStr);
    }
    return [{ uniEquipId: id, name: meta.uniEquipName,
      typeName: `${meta.typeName1}-${({ A: 'α', D: 'Δ' })[meta.typeName2] || meta.typeName2}`,
      typeIcon: meta.typeIcon, icon: meta.uniEquipIcon || id, isDefault: id === spec.defaultModuleId, level: equipLevel,
      attr: moduleAttr(ph), traitOverride,
      talentChanges: moduleTalentChanges(ctx, op, phase, level, label, (ctx.potRank ?? OPERATOR_POTENTIAL)),
      ...(scopeNote ? { scopeNote } : {}), ...(meta.isSpecialEquip ? { isSpecialEquip: true, restrictedModes } : {}) }];
  });
}

function garrison(id, desc, eventType, effectKey, bb = {}, bbStr = {}) {
  return { garrisonId: id, desc, descRaw: desc, eventType, eventTypeDesc: '特异化', eventTypeIcon: 'icon_support',
    effectType: effectKey, effectKey, battleRuneKey: null, charLevel: 0, bb, bbStr, owners: [] };
}
function makeGarrison(key, gold) {
  const suffix = gold ? 'b' : 'a', id = `garrison_rhine_${key}_${suffix}`;
  const grade = gold ? 1 : 0, r = RHINE_BALANCE;
  if (key === 'copy_start') return garrison(id, '身前一格干员若为“进入休整期时”特质，本干员的特质与其相同', 'SERVER_PREP_START', 'SERVER_FRONT_SAME_EFFECT_PREP_START');
  if (key === 'copy_end') return garrison(id, '身前一格干员若为“休整期结束时”特质，本干员的特质与其相同', 'SERVER_PREP_FIN', 'SERVER_FRONT_SAME_EFFECT_PREP_FIN');
  if (key === 'mayer') return garrison(id, `战斗中，身前一格科研装置每完成一次有效工作，使已激活的【莱茵生命】增加${r.mayerDeviceLayers[grade]}层。能量装置每次实际发射脉冲计一次；生态维持仪有实际治疗、护盾净增加或累计${r.ecologyResearchInterval}秒有效减速时计一次，同一装置${r.medicalInterval}秒内最多计一次，多个目标和治疗来源不重复计数；激光钻机累计${r.laserResearchInterval}秒有效输出计一次，逐次伤害不重复产层。无目标时暂停累计。同一装置只取最强的一名梅尔；每场普通主战同玩家全部梅尔共享${r.mayerBattleLayerCap[grade]}层预算，普通与精锐共存取48层，退场或换装置不重置`, 'IN_BATTLE', 'RHINE_MAYER_RESEARCH', { device_layers: r.mayerDeviceLayers[grade], max_layer: r.mayerBattleLayerCap[grade] });
  if (key === 'saria') return garrison(id, `战斗中，每${r.sariaLayerStep}层科研使自身治疗量提高${r.sariaHealBonus[grade] * 100}%`, 'IN_BATTLE', 'RHINE_SARIA_HEALING', { layer_step: r.sariaLayerStep, heal: r.sariaHealBonus[grade] });
  if (key === 'ifrit') return garrison(id, `战斗中，自身获得己方已部署且有效的单台科研装置中最高基础攻击力的${r.ifritInheritance[grade] * 100}%作为额外攻击力，多台不相加，无独立继承上限`, 'IN_BATTLE', 'RHINE_IFRIT_INHERITANCE', { atk_scale: r.ifritInheritance[grade] });
  if (key === 'astgenne') return garrison(id, `战斗中，首次开启技能时，使已激活的【莱茵生命】与【精准】各增加${r.astgenneFirstSkillLayers[grade]}层`, 'IN_BATTLE', 'RHINE_ASTGENNE_FIRST_SKILL', { layer: r.astgenneFirstSkillLayers[grade] }, { bond_ids: `${RHINE_BOND},preciShip` });
  if (key === 'dorothy') return garrison(id, `已激活的【莱茵生命】每层科研为自身提供${r.dorothyAttackPerLayer[grade]}点固定攻击力，不消耗科研；与六人盟约共享攻击以固定值相加。陷阱不再提供科研，原生技能与梦想家保持不变`, 'IN_BATTLE', 'RHINE_DOROTHY_ATTACK', { atk_per_layer: r.dorothyAttackPerLayer[grade] });
  return garrison(id, `休整期结束时，每名实际在场的莱茵生命干员使莱茵生命增加${r.ptilopsisLayersPerMember[grade]}层科研；同名干员分别计数，调和的虚拟人数不计入`, 'SERVER_PREP_FIN', 'RHINE_RESEARCH_BY_MEMBER', { layer: r.ptilopsisLayersPerMember[grade] }, { conditionkey: 'character_target_inboard' });
}

function adaptMayerTalent(talent, count) {
  if (talent.bb?.cnt == null) return;
  talent.bb.cnt = count;
  for (const field of ['desc', 'descRaw']) talent[field] = String(talent[field]).replace(/可以使用.*?个机械水獭召唤物/, `可以使用${count}个机械水獭召唤物`) + '。机械水獭不能接受干员治疗（包括塞雷娅及干员的治疗召唤物），可接受生态维持仪治疗';
}

function adaptDorothyTalent(talent, count) {
  if (talent.bb?.cnt == null || talent.tokenKey !== DOROTHY_TOKEN) return;
  talent.bb.cnt = count;
  for (const field of ['desc', 'descRaw']) talent[field] = String(talent[field]).replace(/可以使用.*?个共振装置（最多拥有\d+个）/, `可以使用${count}个共振装置（最多拥有${count}个，同时最多部署${count}个）`);
}

function compileDorothyToken(ctx, chess) {
  const t = ctx.charTable[DOROTHY_TOKEN], variants = {}, owners = ['chess_rhine_dorothy_a', 'chess_rhine_dorothy_b'];
  for (const id of owners) {
    const c = chess[id], opts = { ...c.status, potRank: (ctx.potRank ?? OPERATOR_POTENTIAL), skillIndex: c.skill.index, label: id };
    if (c.module?.active) {
      opts.modulePhase = ordinaryModulePhase(ctx, c.module.id, c.module.level);
      opts.moduleTokenParts = splitModuleParts(opts.modulePhase).token;
    }
    const count = RHINE_BALANCE.dorothyTrapLimit[c.isGolden ? 1 : 0];
    const variant = (extra = {}) => {
      const v = tokenVariant({ ...ctx, ac: {} }, DOROTHY_TOKEN, t, { ...opts, ...extra });
      v.stats.deployLimit = count; v.stats.deckStack = count;
      // Only the trap kit may activate the zero-SP token skill after a ground enemy steps on it.
      if (v.skill) v.skill.trigger = { rule: 'DOROTHY_TRAP', rawRule: 'DEFAULT', customRangeGrid: null };
      return v;
    };
    const v = variants[id] = { ...variant(), count, sources: ['talent', 'display'], bySkill: {} };
    for (const s of c.skills.filter(s => !s.isDefault)) v.bySkill[s.index] = { skill: variant({ skillIndex: s.index }).skill, count, sources: ['talent', 'display'] };
    if (c.isGolden) {
      const mv = variant({ modulePhase: null, moduleTokenParts: [] });
      v.byModule = { none: { stats: mv.stats, immunities: mv.immunities, trait: mv.trait, talents: mv.talents } };
    }
  }
  const initial = variants[owners[0]], desc = `${t.description}；库存与同时部署上限为普通4个、精锐5个，开场自动部署也占上限。撤回、搬动或未触发销毁不会获得科研层数`;
  return { tokenId: DOROTHY_TOKEN, kind: 'summon', name: t.name, appellation: t.appellation, desc, descRaw: desc,
    profession: 'TOKEN', subProfessionId: t.subProfessionId, position: 'MELEE', displayType: 'DEFAULT', placeable: true, ownerRange: false,
    owners, stats: initial.stats, rangeGrid: initial.rangeGrid, dmgType: 'none', attackKind: 'melee', projectile: 'none', canHitFly: false,
    skill: null, deployLimit: initial.stats.deployLimit, count: initial.count, abnormal: ['isolated'], variants,
    assets: { avatar: DOROTHY_TOKEN, spine: DOROTHY_TOKEN } };
}

/**
 * Build one ported operator record at one potential rank.
 *
 * `spec.prefix` and `spec.garrison` let another expansion reuse this compiler with its own ids and its own trait record
 * (雷姆必拓 passes `prefix: 'rem'` and a pre-built garrison); 莱茵 passes neither and gets `chess_rhine_*` + `makeGarrison`.
 * The caller owns `identifier` — 莱茵's own numbering is below, and an expansion with a different block overwrites it
 * after the call rather than threading a second parameter through every spec.
 */
export function compileChess(ctx, config, spec, gold, index) {
  const prefix = spec.prefix || 'rhine';
  const c = ctx.charTable[spec.charId], baseId = `chess_${prefix}_${spec.key}_a`, goldenId = `chess_${prefix}_${spec.key}_b`;
  const chessId = gold ? goldenId : baseId;
  const st = config.economy.chessStatus[spec.tier][gold ? 'golden' : 'normal'];
  const status = { phase: st.phase, level: st.level, skillLevel: st.skillLevel, equipLevel: st.equipLevel };
  const attrs = withPotential(c, interpolateAttrs(c, status.phase, status.level), (ctx.potRank ?? OPERATOR_POTENTIAL), chessId);
  const { trait, classify } = traitRecord(ctx, c, status.phase, status.level, [], chessId, (ctx.potRank ?? OPERATOR_POTENTIAL));
  const skills = c.skills.flatMap((s, index) => {
    if (!unlocked(s.unlockCond, status.phase, status.level)) return [];
    const skill = buildSkill(ctx, s.skillId, status.skillLevel, null, chessId);
    skill.index = index; skill.overrideTokenKey = s.overrideTokenKey || null;
    if (spec.key === 'mayer' && index === 1) skill.trigger = { rule: 'SP_FULL', rawRule: 'ALWAYS', customRangeGrid: null };
    if (spec.key === 'dorothy') skill.trigger = { rule: 'SP_FULL', rawRule: 'ALWAYS', customRangeGrid: null };
    return [{ ...skill, isDefault: s.skillId === spec.skillId }];
  });
  const skill = clone(skills.find(s => s.isDefault)); delete skill.isDefault;
  const g = spec.garrison || makeGarrison(spec.trait, gold);
  const statsBase = statsFrom(attrs), talentsBase = baseTalentList(ctx, c, status.phase, status.level, chessId, (ctx.potRank ?? OPERATOR_POTENTIAL));
  if (spec.key === 'mayer') for (const t of talentsBase) adaptMayerTalent(t, RHINE_BALANCE.mayerSummons[gold ? 1 : 0]);
  if (spec.key === 'dorothy') for (const t of talentsBase) adaptDorothyTalent(t, RHINE_BALANCE.dorothyTrapLimit[gold ? 1 : 0]);
  const modules = gold ? moduleChoices(ctx, { ...c, charId: spec.charId }, status, chessId, spec) : [];
  if (spec.key === 'mayer') for (const m of modules) for (const t of m.talentChanges) adaptMayerTalent(t, RHINE_BALANCE.mayerSummons[gold ? 1 : 0]);
  if (spec.key === 'dorothy') for (const m of modules) for (const t of m.talentChanges) adaptDorothyTalent(t, RHINE_BALANCE.dorothyTrapLimit[gold ? 1 : 0]);
  const mod = modules.find(m => m.isDefault);
  return { chessId, baseId, goldenId, isGolden: gold, tier: spec.tier, identifier: RHINE_IDENTIFIER + index * 2 + (gold ? 1 : 0),
    isHidden: false, isDiy: false, visible: true, chessType: 'PRESET', shopSortId: 200 + index,
    backup: { charId: spec.charId, tmplId: null, skillIndex: skill.index, uniEquipId: spec.defaultModuleId, potRank: (ctx.potRank ?? OPERATOR_POTENTIAL) },
    charId: spec.charId, name: c.name, appellation: c.appellation, rarity: Number(c.rarity.replace('TIER_', '')),
    profession: c.profession, subProfessionId: c.subProfessionId, subProfessionName: spec.subName, position: c.position,
    nationId: c.nationId, bonds: [...spec.bonds], garrisonIds: [g.garrisonId],
    price: config.economy.chessPrice[spec.tier][gold ? 'golden' : 'normal'], sellPrice: 1,
    upgradeNum: gold ? 0 : 3, upgradeChessId: gold ? null : goldenId, status,
    stats: mod ? composeStats(statsBase, mod.attr) : statsBase, immunities: immunitiesOf(attrs), rangeId: c.phases[status.phase].rangeId,
    rangeGrid: rangeGrid(ctx, c.phases[status.phase].rangeId), ...classify, trait: mod?.traitOverride || trait, skill,
    skills, talents: mod ? composeTalents(talentsBase, mod.talentChanges) : talentsBase,
    tokens: spec.key === 'mayer' ? [TOKEN] : spec.key === 'dorothy' ? [DOROTHY_TOKEN] : [], module: mod ? { id: mod.uniEquipId, name: mod.name, type: mod.typeName, level: mod.level, active: true } : null,
    assets: { avatar: gold ? `${spec.charId}_2` : spec.charId, portrait: `${spec.charId}_${gold ? 2 : 1}`, spine: spec.charId, skillIcon: skill.iconId, subProfIcon: `sub_${c.subProfessionId}_icon` },
    ...(gold ? { statsBase, traitBase: clone(trait), talentsBase, modules } : {}),
    extension: { id: 'rhine-research', sourceRevision: ctx.source.revision, supportedSkills: skills.map(s => s.skillId) } };
}

function applyEquipment({ items, effects }) {
  const specs = [
    { key: 'terminal', name: '莱茵实验终端', price: 2, sort: 13 },
    { key: 'mainframe', name: '联合研究主机', price: 4, sort: 12 },
  ];
  for (const [index, spec] of specs.entries()) for (const gold of [false, true]) {
    const r = RHINE_EQUIPMENT[spec.key], grade = gold ? 1 : 0, terminal = spec.key === 'terminal';
    const baseId = `${r.key}_a`, goldenId = `${r.key}_b`, id = gold ? goldenId : baseId;
    const stat = terminal ? { atk: r.attack[grade] } : { max_hp: r.hp[grade] };
    const special = terminal
      ? { layer_step: r.layerStep, attack_speed: r.attackSpeed[grade], max_attack_speed: r.attackSpeedCap[grade] }
      : { atk_per_layer: r.attackPerLayer, combo_atk_per_layer: r.comboAttackPerLayer };
    const specialStrings = { key: `rhine_${spec.key}`, ...(terminal ? {} : { equip_chess_id: RHINE_EQUIPMENT.terminal.key }) };
    const buffs = [
      { key: 'env_gbuff_new_with_verify', countType: 'NONE', bb: stat, bbStr: { key: 'attr_common_global_buff' } },
      { key: 'env_gbuff_new_with_verify', countType: 'NONE', bb: special, bbStr: specialStrings },
    ];
    const desc = terminal
      ? `攻击力+${r.attack[grade] * 100}%；己方【莱茵生命】盟约激活时，携带者每${r.layerStep}层科研获得${r.attackSpeed[grade]}攻击速度，最多${r.attackSpeedCap[grade]}。`
      : `生命上限+${r.hp[grade] * 100}%；携带者属于【莱茵生命】且在场时，己方每台已部署科研装置每层科研额外获得${r.attackPerLayer}点基础攻击力。携带者同时装备“莱茵实验终端”时，变为每层${r.comboAttackPerLayer}点。该额外攻击无数值上限；多个主机只取最强效果，不叠加。该增益计入伊芙利特的继承与科研成果共享。`;
    const effectId = `eff_rhine_${spec.key}_${gold ? 'b' : 'a'}`;
    effects[effectId] = { effectId, effectType: 'EQUIP', name: spec.name, desc, descRaw: desc,
      counterType: 'NONE', continuedRound: -1, decoIconId: null, enemyPrice: 0,
      buffs: clone(buffs), params: { ...stat, ...special, ...specialStrings } };
    items[id] = { id, baseId, goldenId, isGolden: gold, trapId: `trap_rhine_${spec.key}`, iconId: `trap_rhine_${spec.key}`,
      identifier: 500 + index * 2 + grade, name: spec.name, itemType: 'EQUIP', tier: r.tier, shopSortId: spec.sort,
      price: gold ? 5 : spec.price, hideInShop: false, shopExcluded: false, shopExcludedBy: null,
      mergeable: !gold, upgradeNum: gold ? 0 : 2, upgradeChessId: gold ? null : goldenId, duration: gold ? 0 : -1,
      giveBondId: terminal ? RHINE_BOND : null, givePowerId: null, canGiveBond: false, requiresBondId: terminal ? null : RHINE_BOND,
      effectId, effectName: spec.name, desc, descRaw: desc, buffs, params: clone(effects[effectId].params),
      category: 'BOND_SIGNATURE', kind: 'passive', family: 'rhine',
      implFormula: terminal ? 'ATK% += atk. If own Rhine bond is active, ASPD += min(floor(layers / layer_step) * attack_speed, max_attack_speed).'
        : 'HP% += max_hp. Each deployed research device gains the strongest live Rhine carrier contribution: layers * atk_per_layer, or combo_atk_per_layer when that carrier also equips the terminal, without an attack cap. This enters device base ATK before inheritance/sharing and never reads device ATK.',
      rangeGrid: [[0, 0]], flavor: null };
  }
  // The ordinary grant mechanism already reads the OTHER item's giveBondId. Explain the new
  // pairing in both item grades and their source effect without replacing existing mappings.
  const mapping = '与“莱茵实验终端”同时携带时，额外获得【莱茵生命】盟约。';
  for (const it of Object.values(items).filter(i => i.canGiveBond)) {
    for (const rec of [it, effects[it.effectId]].filter(Boolean)) for (const key of ['desc', 'descRaw']) {
      if (!String(rec[key] || '').includes(mapping)) rec[key] = `${rec[key] || ''}\n${mapping}`;
    }
  }
}

/**
 * Record, on every record the overlay CHANGED, the value each touched field had before it (`packRestore`, 六.F).
 *
 * This expansion is not purely additive: it re-tiers 白面鸮 and 塞雷娅, swaps their 特质, extends a 奥术 garrison's bond
 * list and rewrites a couple of item/effect descriptions. `shared/packData.js` drops the pack's OWN records when its
 * switch is off but cannot know what a survivor looked like before, so the pack has to carry the originals itself —
 * exactly like `packBonds` carries what it appended. Without this, a room with every switch off still plays a
 * III-cost 白面鸮, which is the one guarantee the port is built around.
 */
function recordRestore(before, files) {
  for (const [name, table] of Object.entries(files)) {
    // `config` is not an id → record map (it holds `modes`, `economy`, …), so the per-id walk does not apply.
    if (name === 'config') continue;
    const was = before[name];
    if (!isPlain(table) || !isPlain(was)) continue;
    for (const [id, rec] of Object.entries(table)) {
      const old = was[id];
      if (!isPlain(old) || !isPlain(rec)) continue;
      const restore = {};
      for (const [field, value] of Object.entries(old)) {
        if (field === PACK_RESTORE_FIELD || field === PACK_ID_FIELD) continue;
        if (JSON.stringify(rec[field]) === JSON.stringify(value)) continue;
        restore[field] = value;
      }
      if (!Object.keys(restore).length) continue;
      rec[PACK_RESTORE_FIELD] = { ...(isPlain(rec[PACK_RESTORE_FIELD]) ? rec[PACK_RESTORE_FIELD] : {}), [RHINE_PACK]: restore };
    }
  }
}

/**
 * Stamp `packId` on every record the overlay ADDED, so `shared/packData.js recordAvailable` drops it again while
 * `packRhine` is off (`data/*.json` holds the ALL-PACKS-ON truth; the switches remove).
 *
 * "Added" = absent from `before`, OR already carrying this pack's stamp. The second case is what makes a RE-run work:
 * `compileChess` builds each record from scratch, so the stamp it wrote last time is gone by the time this runs again,
 * and a plain `id in before` test would read the overlay's own output as a pre-existing official record and never
 * re-stamp it (the 12 `chess_rhine_*` lost their `packId` on every second pass).
 *
 * The 六.3 bond and its effect are NOT re-stamped: `tools/fork-overrides.mjs applyForkBonds` / `applyForkEffects` own
 * those two records and give them `packId: 'packRhine'` (谬因·并入莱茵 merged into 莱茵生命 on 2026-10-23, so the
 * 盟约). They already carry a `packId` by the time this runs, so the "already stamped" guard leaves them alone — which
 * is why the walk is over EVERY table and not a skip list: the 六.F 装备 effects are the overlay's own and do need it.
 */
function stampAdditions(before, files) {
  for (const [name, table] of Object.entries(files)) {
    const was = before[name];
    if (!isPlain(table) || !isPlain(was)) continue;
    for (const [id, rec] of Object.entries(table)) {
      if (!isPlain(rec) || rec[PACK_ID_FIELD]) continue;
      const prev = was[id];
      if (prev && prev[PACK_ID_FIELD] !== RHINE_PACK) continue;
      rec[PACK_ID_FIELD] = RHINE_PACK;
    }
  }
}

/**
 * `backups.diy.locked[tier][charId].from` = the NORMAL 补位 rows of that tier whose `backup.charId` is the prototype
 * (`tools/build-data.mjs buildBackups`). It is a pure function of `chess`, so any change to a record's `tier` makes it
 * stale — the re-tier of 塞雷娅 V → III does exactly that. Recomputing it here keeps the overlay's output equal to what
 * the builder would produce if it had known the final tiers. Only `from` moves: the skill / module of a locked
 * selection were read off the same row and that row keeps its `backup`.
 */
function refreshLockedFrom(files) {
  const locked = files.backups?.diy?.locked;
  if (!isPlain(locked)) return;
  for (const [tier, picks] of Object.entries(locked)) {
    if (!isPlain(picks)) continue;
    for (const [charId, sel] of Object.entries(picks)) {
      if (!isPlain(sel)) continue;
      sel.from = Object.values(files.chess)
        .filter((c) => c.chessType === 'NORMAL' && !c.isGolden && c.tier === Number(tier) && c.backup?.charId === charId)
        .map((c) => c.chessId).sort(naturalCmp);
    }
  }
}

export async function applyRhineData(files, source = null) {
  const ctx = source || JSON.parse(await readFile(new URL('./rhine-data-source.json', import.meta.url), 'utf8'));
  // The OUTER call owns `packRestore`: the overlay runs once per potential rank (below), and the originals it must
  // carry are the ones from before ANY of them — recording them per rank would diff the ranks against each other.
  if (!Number.isInteger(ctx.potRank)) {
    const before = structuredClone(files);
    await applyPotentialOverlay(files, applyRhineData, ctx);
    stampAdditions(before, files);
    recordRestore(before, files);
    // Re-key the three naturally-sorted tables. `build-data.mjs` writes `chess`/`garrisons`/`items` in `naturalCmp`
    // order and `test/fork-data.test.js` pins `data/chess.json` to it; this overlay can only APPEND, so without this
    // the twelve ported operators land after `chess_char_6_oblvns_b` instead of between `chess_rhine_astgenne_a` and
    // `chess_rhine_dorothy_a`. Values are untouched — only the insertion order of the object's keys changes.
    for (const name of SORTED_TABLES) {
      const table = files[name];
      if (isPlain(table)) files[name] = Object.fromEntries(Object.keys(table).sort(naturalCmp).map((k) => [k, table[k]]));
    }
    // `backups.diy.locked[tier][charId].from` names the 补位 rows the locked selection was read from, and it is derived
    // from `chess[].tier` — which the re-tier above just changed for 塞雷娅 (V → III). Left stale it points a tier-5
    // prototype at a tier-3 chess (`test/backups.test.js` re-derives the list and rejects it). The skill / module
    // themselves are untouched: they came from the same row and that row kept its `backup`.
    refreshLockedFrom(files);
    return files;
  }
  const { chess, bonds, garrisons, tokens, effects, config } = files;
  for (const [index, spec] of RHINE_ADDITIONS.entries()) for (const gold of [false, true]) {
    const c = compileChess(ctx, config, spec, gold, index);
    chess[c.chessId] = c;
    const g = makeGarrison(spec.trait, gold); garrisons[g.garrisonId] = g;
  }
  for (const c of Object.values(chess)) {
    if (c.charId === RHINE_CHARACTERS.ptilopsis || c.charId === RHINE_CHARACTERS.saria) {
      c.tier = 3;
      c.price = config.economy.chessPrice[3][c.isGolden ? 'golden' : 'normal'];
      // Tiers III–V share E2 L1 / E2 L60 and skill levels; existing module stats remain valid.
      const tierStatus = config.economy.chessStatus[3][c.isGolden ? 'golden' : 'normal'];
      for (const k of ['phase','level','skillLevel','equipLevel']) c.status[k] = tierStatus[k];
      c.bonds = [c.charId === RHINE_CHARACTERS.saria ? 'steadShip' : 'deputShip', RHINE_BOND];
      const g = makeGarrison(c.charId === RHINE_CHARACTERS.saria ? 'saria' : 'ptilopsis', c.isGolden);
      garrisons[g.garrisonId] = g; c.garrisonIds = [g.garrisonId];
    }
    if ([RHINE_CHARACTERS.silence, RHINE_CHARACTERS.muelsyse, RHINE_CHARACTERS.halo2].includes(c.charId) && !c.bonds.includes(RHINE_BOND)) c.bonds.push(RHINE_BOND);
  }
  // Extend only the Rhine profile's existing Solstice Astgenne trait. Its event, spending
  // arithmetic and copy/retrigger behavior remain those of the upstream handler.
  for (const c of Object.values(chess).filter(c => c.charId === RHINE_CHARACTERS.halo2)) {
    for (const id of c.garrisonIds) {
      const g = garrisons[id];
      if (g?.effectKey !== 'SERVER_ADD_BOND_ROUND_COIN_COST') continue;
      const ids = String(g.bbStr.bond || '').split(',').filter(Boolean);
      if (!ids.includes(RHINE_BOND)) ids.push(RHINE_BOND);
      g.bbStr.bond = ids.join(',');
      for (const field of ['desc', 'descRaw']) {
        if (!g[field].includes('【莱茵生命】')) g[field] = g[field].replace('【奥术】', '【奥术】【莱茵生命】');
      }
    }
  }
  for (const g of Object.values(garrisons)) g.owners = Object.values(chess).filter(c => c.garrisonIds.includes(g.garrisonId)).map(c => c.chessId);
  // 六.F: the 盟约 record itself and its effect are OWNED by the fork layer (tools/fork-overrides.mjs applyForkBonds /
  // applyForkEffects, 六.3) — they carry `packId: 'packRhine'` and the `env_gbuff_new`
  // blackboard every other 盟约 is read through. Rebuilding them here would drop the `packId` (the bond would survive a
  // room with every switch off) and blank `buffs` (`rhineBb()` reads back `{}` and the 盟约's whole effect goes to
  // zero). So the two records are only CREATED here when nothing has made them yet (`node tools/rhine-data.mjs`, the
  // probe's own entry point); inside the fork's build they already exist and are left alone.
  const owned = !bonds[RHINE_BOND];
  if (owned) {
    bonds[RHINE_BOND] = { ...clone(bonds.yanShip), bondId: RHINE_BOND, name: '莱茵生命', identifier: 24, bondOrder: 24,
      isCore: true, bondType: 'SEASON', iconId: 'rhineShip', activeCount: RHINE_BALANCE.thresholds[0], thresholds: [...RHINE_BALANCE.thresholds], maxCount: null,
      layerMilestones: [], powerIdList: [], desc: TEXT, descRaw: TEXT, effectId: 'bondeffect_rhine', effectName: '莱茵生命',
      effectDesc: TEXT, effectDescRaw: TEXT, effectDescParams: [], bb: { base_atk: RHINE_BALANCE.baseAttack, atk_per_stack: RHINE_BALANCE.attackPerLayer, sharing_count: RHINE_BALANCE.sharingCount, sharing_atk: RHINE_BALANCE.researchSharing[0], sharing_golden_atk: RHINE_BALANCE.researchSharing[1] },
      bbStr: { key: 'rhine_research' }, buffs: [], baseParams: {}, perStackParams: {}, spec: { researchDevices: RHINE_DEVICES.map(d => d.tokenId) } };
    effects.bondeffect_rhine = { effectId: 'bondeffect_rhine', effectType: 'BOND', name: '莱茵生命', desc: TEXT, descRaw: TEXT,
      counterType: 'NONE', continuedRound: -1, decoIconId: null, enemyPrice: 0, buffs: [], params: { base_atk: RHINE_BALANCE.baseAttack, atk_per_stack: RHINE_BALANCE.attackPerLayer, sharing_count: RHINE_BALANCE.sharingCount, sharing_atk: RHINE_BALANCE.researchSharing[0], sharing_golden_atk: RHINE_BALANCE.researchSharing[1] } };
  }
  // The member lists follow the source's own recompute — every 盟约's from the chess that name it — so the ported
  // operators join the OFFICIAL 盟约 they list (伊芙利特→奥术, 森蚺→沙卒/孤军, 白面鸮→链愈…) exactly as they do in the
  // expansion, and `rhineShip` picks up the 4 that name it. `recordRestore` (below, outer call) has the pre-overlay
  // lists, so `shared/packData.js withPackRestore` puts the official ones back in an all-off room: the additions never
  // need a `packMembers` entry of their own.
  for (const b of Object.values(bonds)) {
    // `naturalCmp`, not the chess table's insertion order: `build-data.mjs buildBonds` writes members with
    // `.sort(naturalCmp)`, and this recompute runs on a table whose order depends on whether the overlay ran before
    // (a fresh build) or after (a re-run on the committed file) the re-key above — unsorted, the two disagree.
    b.members = Object.values(chess).filter(c => !c.isGolden && c.bonds.includes(b.bondId)).map(c => c.chessId).sort(naturalCmp);
    b.visibleMembers = b.members.filter(id => chess[id].visible);
  }
  // `config.modes[].activeBondIds` is deliberately NOT touched: the source appends `rhineShip` to it, but nothing at
  // runtime reads that field (the match's live bond set comes from the board via `support/index.js activeBondIds`, and
  // the mode's own ban list from `inactiveBondIds`, gamedata.js), while `test/fork-data.test.js` and
  // `test/fork-ultimate-bans.test.js` pin it at the official 23. PR-B already left it out for the same reason.
  const t = ctx.charTable[TOKEN], variants = {}, owners = ['chess_rhine_mayer_a', 'chess_rhine_mayer_b'];
  for (const id of owners) {
    const c = chess[id], opts = { ...c.status, potRank: (ctx.potRank ?? OPERATOR_POTENTIAL), skillIndex: c.skill.index, label: id };
    if (c.module?.active) {
      opts.modulePhase = ordinaryModulePhase(ctx, c.module.id, c.module.level);
      opts.moduleTokenParts = splitModuleParts(opts.modulePhase).token;
    }
    const variant = (extra = {}) => {
      const v = tokenVariant({ ...ctx, ac: {} }, TOKEN, t, { ...opts, ...extra });
      // Expansion summon limit applies to every loadout variant, not only the default skill.
      v.stats.deployLimit = RHINE_BALANCE.mayerSummons[c.isGolden ? 1 : 0];
      for (const talent of v.talents) if (talent.bb.max_deploy_count != null) talent.bb.max_deploy_count = v.stats.deployLimit;
      return v;
    };
    const v = variants[id] = { ...variant(), count: c.talents[0].bb.cnt, sources: ['talent', 'display'], bySkill: {} };
    for (const s of c.skills.filter(s => !s.isDefault)) v.bySkill[s.index] = { skill: variant({ skillIndex: s.index }).skill, count: v.count, sources: ['talent', 'display'] };
    if (c.isGolden) {
      v.byModule = {};
      for (const m of [...c.modules.filter(m => !m.isDefault), ...(c.module?.active ? [null] : [])]) {
        const ph = m && ordinaryModulePhase(ctx, m.uniEquipId, m.level);
        const mv = variant({ modulePhase: ph, moduleTokenParts: ph ? splitModuleParts(ph).token : [] });
        v.byModule[m?.uniEquipId || 'none'] = { stats: mv.stats, immunities: mv.immunities, trait: mv.trait, talents: mv.talents };
      }
    }
  }
  const initial = variants[owners[0]];
  const otterDesc = `${t.description}；机械水獭不能接受干员治疗（包括塞雷娅及干员的治疗召唤物），可接受生命维持仪治疗`;
  tokens[TOKEN] = { tokenId: TOKEN, kind: 'summon', name: t.name, appellation: t.appellation, desc: otterDesc, descRaw: otterDesc,
    profession: 'TOKEN', subProfessionId: t.subProfessionId, position: 'MELEE', displayType: 'DEFAULT', placeable: true, ownerRange: false,
    owners, stats: initial.stats, rangeGrid: initial.rangeGrid, dmgType: 'phys', attackKind: 'melee', projectile: 'none', canHitFly: false,
    skill: null, deployLimit: initial.stats.deployLimit, count: initial.count, abnormal: [], variants, assets: { avatar: TOKEN, spine: TOKEN } };
  tokens[DOROTHY_TOKEN] = compileDorothyToken(ctx, chess);
  delete tokens.token_rhine_ecology;
  for (const d of RHINE_DEVICES) tokens[d.tokenId] = { tokenId: d.tokenId, kind: 'summon', name: d.name, appellation: d.name,
    desc: d.description, descRaw: d.description, profession: 'TOKEN', subProfessionId: 'notchar1', position: 'ALL', displayType: 'DEFAULT',
    placeable: false, ownerRange: false, owners: [], stats: { ...BASE_STATS, atk: RHINE_BALANCE.baseAttack },
    rangeGrid: [[0,0]], dmgType: 'none', attackKind: 'ranged', projectile: 'none', canHitFly: false, skill: null,
    deployLimit: 1, count: 1, abnormal: [], variants: {}, assets: { avatar: d.tokenId, spine: null, icon: d.icon, sprite: d.sprite } };
  applyEquipment(files);
  return files;
}

export function validateRhineData({ chess, bonds, garrisons, tokens, config, items, effects }) {
  const errors = [], rhine = bonds[RHINE_BOND];
  if (!rhine || rhine.visibleMembers.length !== 9) errors.push('Rhine must have exactly 9 visible normal members');
  for (const spec of RHINE_ADDITIONS) for (const suffix of ['a','b']) {
    const c = chess[`chess_rhine_${spec.key}_${suffix}`];
    if (!c || c.charId !== spec.charId || c.skills.length !== (['mayer','wuhoo','astgenne'].includes(spec.key) ? 2 : 3)
      || c.skill.skillId !== spec.skillId || c.skills.filter(s => s.isDefault).length !== 1) errors.push(`Rhine missing supported unit ${spec.key}_${suffix}`);
    if (c) for (const id of c.garrisonIds) if (!garrisons[id]) errors.push(`Rhine missing garrison ${id}`);
    if (c) for (const id of c.tokens) if (!tokens[id]) errors.push(`Rhine missing token ${id}`);
  }
  for (const d of RHINE_DEVICES) if (tokens[d.tokenId]?.stats.atk !== RHINE_BALANCE.baseAttack) errors.push(`Rhine bad device attack ${d.tokenId}`);
  // The runtime-relevant half of the mode record: `inactiveBondIds` is the mode's ban list (`gamedata.js` reads it into
  // `modeInactiveBonds`), so a mode that banned the ported 盟约 would make the switch do nothing. `activeBondIds` is
  // not asserted — nothing reads it at runtime and the fork's tests pin it at the official 23.
  for (const m of Object.values(config.modes)) if (m.inactiveBondIds?.includes(RHINE_BOND)) errors.push(`Rhine banned in mode ${m.modeId}`);
  for (const [key, spec] of Object.entries(RHINE_EQUIPMENT)) for (const suffix of ['a','b']) {
    const id = `${spec.key}_${suffix}`, it = items?.[id];
    if (!it || it.tier !== spec.tier || !effects[it.effectId] || it.itemType !== 'EQUIP') errors.push(`Rhine missing equipment ${id}`);
    if (it && (it.isGolden !== (suffix === 'b') || it.mergeable !== (suffix === 'a') || !items[it.goldenId]?.isGolden)) errors.push(`Rhine bad equipment upgrade ${id}`);
    if (key === 'terminal' && it?.giveBondId !== RHINE_BOND) errors.push(`Rhine missing terminal transfer ${id}`);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('usage: node tools/rhine-data.mjs [--out data]');
  const out = resolve(args[1] || fileURLToPath(new URL('../data', import.meta.url)));
  const names = ['chess','bonds','garrisons','tokens','effects','config','items'];
  const files = Object.fromEntries(await Promise.all(names.map(async n => [n, JSON.parse(await readFile(join(out, `${n}.json`), 'utf8'))])));
  await applyRhineData(files);
  const errors = validateRhineData(files);
  if (errors.length) throw new Error(errors.join('\n'));
  for (const n of names) { const dest = join(out, `${n}.json`), tmp = `${dest}.tmp-${process.pid}`; await writeFile(tmp, JSON.stringify(files[n])); await rename(tmp, dest); }
  const { refreshRhineTranslations } = await import('./rhine-i18n.mjs');
  await refreshRhineTranslations(out);
  console.log('Rhine overlay complete: 6 operators, 9 Rhine members, 3 research devices, 2 equipment pairs.');
}
