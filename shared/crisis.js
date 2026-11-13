import { enemyTargetRounds } from './crisisEnemyPlan-20261026.js';
import { ARC_ROUTES, ARC_SEASON, checkArc, isArcSelection, arcRules } from './crisisArc.js';
import { N_ } from './i18n.js';
// shared/crisis.js — 危机合约 (the owner's design standard V1.1, 2026-10-21): the contract's tags as rules.
// Pure ESM (server + browser). The event page (static js/ui/crisisTags.js) keeps the texts and glyphs; this table keeps
// what a match needs — every route's risk per mode and the numbers of each tier — and the checks the lobby runs.
//
// 下半「重燃作战」(rules `rn1`, 2026-10-26; design: 危机合约·重燃作战-下半词条设计-20261025.md): the 上半 routes A–O
// with the changes of its table ③ (M2 left the pool), and the routes the season's fixed leaders allow (§5.7): P 护卫强化,
// Q 敌群异变, R 破绽悬赏, S 领袖强化, T 战场变化, U 协同作战 (四人), F4 循环超载. The season fixes the leaders — the
// main one is “萨米的意志” (boss_7), a second one is 假想敌：铳 (boss_2), the Hidden Core is 假想敌：铳（隐秘核心版）
// (boss_9) — so a tag of another leader is not offered at all.
//
// A selection is { mode: 'solo' | 'quad', tags: ['A1-2', 'Q3-1', …] }: a tag is a route id and a 1-based tier. Rules
// (the owner, 2026-10-21): no cap on the total and no one-pick-per-group — anything that does not conflict stacks.
// Conflicts: two tiers of one route, and two of the leader schemes L2–L5 (each sets up the leader fight its own way;
// L1 stacks with any of them since 下半). A route may need a scheme (`needs`, any of): it is offered only beside it.
// A route whose risk is null in a mode is not offered there. 单人 = a solo room, 四人 = a co-op room of exactly 4 seats;
// both run on 绝境模拟 (HARD).
//
// Enemy and map routes also need their targets in the match (`targets`): the seed decides the map and the round
// entries, so a route counts only when its enemies show up in enough rounds (or the map is its map) — crisisTargets
// checks a selection against a seed's preview (server/crisis-rn1-20261026.mjs builds it; the page shows it).
//
// 「弧光作战」(season `arc1`, 2026-11-05: shared/crisisArc.js): a selection with `season: 'arc'` is that season's —
// checkCrisis / isCrisisSelection / crisisRules hand it over, its routes (ids X…) sit in CRISIS_ROUTES beside these
// (names, risks; no targets), and the rules of a match say which season it is (crisisRulesOf).
//
// crisisRules(sel) compiles a checked selection into `fx`: one entry per picked route, its tier's numbers resolved
// (e.g. fx.A1 = { hp: 0.5 }). Absent key = route not picked. Rounds and seconds are those of the standard: rounds are
// match rounds, seconds are battle (field clock) seconds.

export const CRISIS_RULES = 'rn1';
/** The season of the open board: its name and fixed leaders (boss ids of data/bosses.json). */
export const CRISIS_SEASON = Object.freeze({ id: 'rn1', name: N_('重燃作战'), leader: 'boss_7', second: 'boss_2', hidden: 'boss_9' });
export const CRISIS_MODES = Object.freeze(['solo', 'quad']);
export const CRISIS_DIFFICULTY = 'HARD';
export const CRISIS_QUAD_SEATS = 4;
/** 领袖登场方案: at most one of these routes. */
export const CRISIS_SCHEMES = Object.freeze(['L2', 'L3', 'L4', 'L5']);
/** Whole groups whose routes exclude each other: none since 下半 (kept for old imports). */
export const CRISIS_EXCLUSIVE = Object.freeze([]);
export const CRISIS_GROUPS = Object.freeze({
  A: N_('敌军规模'), B: N_('敌方攻击'), C: N_('敌方防护'), D: N_('我方输出'), E: N_('我方生存'), F: N_('技能循环'), G: N_('经济'), H: N_('调度'),
  I: N_('盟约'), J: N_('养成'), K: N_('布阵'), L: N_('领袖'), M: N_('后备与援护'), N: N_('进攻节奏'), O: N_('目标生命'),
  P: N_('护卫强化'), Q: N_('敌群异变'), R: N_('破绽悬赏'), S: N_('领袖强化'), T: N_('战场变化'), U: N_('协同作战'),
});

/** Enemy keys of the targets (data/enemies.json). */
const K = Object.freeze({
  frost: 'enemy_1042_frostd', slime: 'enemy_1067_snslime', partisan: 'enemy_1081_sotisd', grail: 'enemy_1430_lrrook',
  elem: 'enemy_9007_acelem', pupp: 'enemy_9010_acpupp', toxi: 'enemy_9006_actoxi', vanguard: 'enemy_10124_uashld_2',
  phalanx: ['enemy_1169_duphlx', 'enemy_1169_duphlx_2'], dusk: ['enemy_1288_duskls', 'enemy_1288_duskls_2', 'enemy_1292_duskld'],
  tide: ['enemy_1161_tidmag', 'enemy_1161_tidmag_2'], holy: ['enemy_1174_duholy_2', 'enemy_1175_dushdo_2'], lancer: 'enemy_1072_dlancer',
  prisoners: ['enemy_1118_lidbox_2', 'enemy_1121_lifbos', 'enemy_1121_lifbos_2'],
  strong: ['enemy_1045_hammer', 'enemy_1045_hammer_2', 'enemy_1160_hvyslr', 'enemy_1160_hvyslr_2', 'enemy_1320_wdrrl_2', 'enemy_1275_dwlock_2'],
  mirror: ['enemy_1329_cbshld', 'enemy_1329_cbshld_2'],
});
const MAP = Object.freeze({ wind: 'act2autochess_m01', smoke: 'act2autochess_m03', tide: 'act2autochess_m04' });
/** Enemy targets: the keys, in at least `min` of rounds from..to of the seed's schedule (a round's entry, its normal
 *  or its elite key); `r14` also counts the Final Assault's flyer slot when that is the key. */
const foes = (keys, { from = 4, to = 13, min = 2, r14 = null } = {}) => ({ keys: [].concat(keys), from, to, min, r14 });
const SCHEME_2 = Object.freeze(['L2', 'L3', 'L4']);   // the second leader (铳) comes

const t2 = (a, b) => [a, b];
const t3 = (a, b, c) => [a, b, c];
/**
 * Routes: [id, name, solo risks | null, quad risks | null, tiers (one params object per tier; a single object = every
 * tier, a function (mode) => params = per mode), { needs, targets }].
 */
const ROWS = [
  ['A1', N_('源石环境：活性'), [1, 2, 3], [1, 2, 3], t3({ hp: 0.25 }, { hp: 0.5 }, { hp: 0.8 })],
  ['A2', N_('回声前锋'), [2], [2], (mode) => ({ rounds: [5, 13], delay: 6, hp: mode === 'solo' ? 0.4 : 0.25, perField: mode === 'solo' ? 3 : 2 })],
  ['A3', N_('第三梯队'), [2], [2], (mode) => ({ rounds: [5, 13], at: 35, perField: mode === 'solo' ? 2 : 1 })],
  ['B1', N_('源石环境：刺激'), [1, 2, 3], [1, 2, 3], t3({ atk: 0.15 }, { atk: 0.3 }, { atk: 0.5 })],
  ['B2', N_('远程压制'), [2], [2], { range: 1, interval: 0.2 }],
  ['B3', N_('冲击前锋'), [2], [1], { perField: 2, mul: 1.5, stun: 1.5 }],
  ['C1', N_('反装甲'), [1, 2], [1, 2], [{ def: 100, res: 5 }, { def: 200, res: 10 }]],
  ['C2', N_('适应外壳'), [2], [2], { period: 12, cut: 0.25 }],
  ['D1', N_('环境：高价值目标'), [1, 2, 3], [1, 2, 3], t3({ atk: 0.1 }, { atk: 0.2 }, { atk: 0.3 })],
  ['D2', N_('单点疲劳'), [2], [1], { from: 6, cut: 0.35, reset: 5 }],
  ['D3', N_('火力错峰'), [3], [2], { period: 20, cut: 0.25 }],
  ['D4', N_('外源增幅衰减'), [1, 2, 3], [1, 2, 3], t3({ keep: 0.75 }, { keep: 0.5 }, { keep: 0.25 })],
  ['E1', N_('源石环境：侵蚀'), [1, 2], [1, 2], [{ hp: 0.15 }, { hp: 0.3 }]],
  ['E2', N_('医疗间歇'), [2], [2], { start: 25, period: 30, dur: 6, cut: 0.6 }],
  ['E3', N_('复起延迟'), [1], [1], { delay: 3 }],
  ['F1', N_('源石环境：阻抑'), [1, 2, 3], [1, 2, 3], t3({ sp: 0.15 }, { sp: 0.3 }, { sp: 0.5 })],
  ['F2', N_('供能削弱'), [2], [2], { cut: 0.5 }],
  ['F3', N_('首轮静默'), [2], [1], { dur: 8 }],
  ['F4', N_('循环超载'), [1], [1], (mode) => ({ dur: 30, regen: 0.3, cut: mode === 'solo' ? 0.15 : 0.1 })],
  ['G1', N_('预算削减'), [1, 2, 3], [1, 2, 3], t3({ from: 7, cut: 1 }, { from: 7, cut: 2 }, { from: 7, cut: 3 })],
  ['G2', N_('延期拨款'), [2], [1], { rounds: [4, 6], hold: 2, back: 7 }],
  ['G3', N_('集中采购税'), [2], [2], { free: 3, tax: 1 }],
  ['G4', N_('资本冻结'), [2], [2], { until: 13 }],
  ['H1', N_('频率限制'), [1, 2, 3], [1, 2, 3], t3({ from: 4, cap: 12 }, { from: 4, cap: 9 }, { from: 4, cap: 6 })],
  ['H2', N_('升格管制'), [2], [1], { tax: 2, free: 1 }],
  ['H3', N_('授衔延误'), [1], [1], {}],
  ['H4', N_('商店封存'), [1], [1], {}],
  ['H5', N_('流通审计'), [1, 2, 3], [1, 2, 3], t3({ cap: 30 }, { cap: 22 }, { cap: 16 })],
  ['I1', N_('成长迟滞'), [1, 2, 3], [1, 2, 3], t3({ mul: 0.8 }, { mul: 0.65 }, { mul: 0.5 })],
  ['I2', N_('主次协定'), [2], [1], { by: 3, mul: 0.7 }],
  ['I3', N_('四方异盟'), null, [3], {}],
  ['I4', N_('整备层数限流'), [1, 2, 3], [1, 2, 3], t3({ cap: 40 }, { cap: 25 }, { cap: 15 })],
  ['J1', N_('军备配给'), [1, 2, 3], [1, 2, 3], t3({ cap: 6 }, { cap: 4 }, { cap: 2 })],
  ['J2', N_('战地轮检'), [2], [2], { from: 5, n: 2, dur: 15 }],
  ['J3', N_('精锐限额'), [2, 3], [1, 2], [{ cap: 4 }, { cap: 3 }]],
  ['J4', N_('制式限流'), null, [1], { team: 3, each: 1 }],
  ['J5', N_('维式军备管制'), [2], [1], { normal: 0.25, golden: 0.4 }],
  ['J6', N_('消耗品配给'), [1, 2], [1, 2], [{ cap: 4 }, { cap: 2 }]],
  ['K1', N_('环境：交战区'), [1, 2], [1, 2], [{ cap: 7 }, { cap: 6 }]],
  ['K2', N_('固定封锁'), [1], [1], {}],
  ['K3', N_('疏散阵型'), [1], [1], { adj: 3, dur: 10, cut: 0.15 }],
  ['K4', N_('统筹部署'), null, [2], { cut: 6 }],
  ['L1', N_('王权高压'), [2, 3], [2, 3], [{ hp: 0.25, aspd: 10 }, { hp: 0.4, aspd: 20 }]],
  ['L2', N_('双首并临'), [3], [3], { hp: 0.65 }],
  ['L3', N_('第二号令'), [2], [2], { at: 40, below: 0.5, hp: 0.8, hp2: 0.55 }],
  ['L4', N_('双战区：锁链'), null, [3], { hp: 0.6, gap: 0.2, cut: 0.3, atk: 0.2 }],
  ['L5', N_('交叉追猎'), null, [3], { hp: 0.6, swap: 30 }],
  ['M1', N_('后备封存'), [2], null, { hand: 7 }],
  ['M3', N_('援护限额'), null, [1], { helpers: 1 }],
  ['M4', N_('轮值支援'), null, [1], { dur: 10, cut: 0.1 }],
  ['M5', N_('互援试炼'), null, [2], { rounds: [6, 10], dur: 40 }],
  ['N1', N_('反机动'), [1], [1], { move: 0.2 }],
  ['N2', N_('猝发攻势'), [1], [1], { rounds: [4, 13], cut: 0.2 }],
  ['N3', N_('刻不容缓'), [1], [1], { cut: 0.1 }],
  ['O1', N_('最后防线'), [1], [1], { cap: 10 }],
  ['O2', N_('共同命运'), null, [1], { keep: 0.75 }],
  ['O3', N_('同生共死'), null, [1, 3], [{ saves: 1 }, { saves: 0 }]],
  // ---- 下半 ----
  ['P1', N_('冰晶殉爆'), [1, 2], [1, 2], (mode) => [{ hp: 0.4, blast: 2.5 }, { hp: 0.4, blast: 2.5, add: mode === 'solo' ? 2 : 1 }]],
  ['P2', N_('盾卫号召'), [2], [2], { layer: 0.06, layers: 4, vuln: 0.1, dur: 8, coop: 12, coopShare: 0.15, windows: 2 }],
  ['P3', N_('圣杯共担'), [1, 2], [1, 2], t2({ share: 0.15, vuln: 0.2, dur: 6, radius: 1.7 }, { share: 0.25, hp: 0.25, vuln: 0.2, dur: 6, radius: 1.7 }), { needs: ['S3'] }],
  ['Q1', N_('寒潮编队'), [1, 2, 3], [1, 2, 3], t3({ hp: 0.3 }, { hp: 0.3, radius: 3 }, { hp: 0.3, radius: 3, aspd: -0.6 }), { targets: foes(K.frost, { r14: K.frost }) }],
  ['Q2', N_('寄生蔓延'), [1, 2], [1, 2], t2({ elem: 1.45 }, { elem: 1.45, hp: 0.3, ratio: 0.4 }), { targets: foes(K.elem, { from: 8 }) }],
  ['Q3', N_('中坚列阵'), [1, 2], [1, 2], t2({ cut: 0.15, radius: 1.5 }, { cut: 0.15, radius: 1.5, regen: 300 }), { targets: foes(K.vanguard, { from: 8 }) }],
  ['Q4', N_('方阵重整'), [1, 2], [1, 2], t2({ def: 250 }, { def: 250, squad: 0.5 }), { targets: foes(K.phalanx) }],
  ['Q5', N_('余烬复燃'), [1, 2], [1, 2], t2({ revive: 8 }, { revive: 8, hits: 7, guardHits: 14 }), { targets: foes(K.dusk) }],
  ['Q6', N_('蚀裂连锁'), [1, 2], [1, 2], t2({ radius: 1.2 }, { radius: 1.2, dur: 12 }), { targets: foes(K.toxi, { from: 8 }) }],
  ['Q7', N_('潮涌术阵'), [1, 2], [1, 2], (mode) => [{ ratio: 1 }, { ratio: 1, extra: mode === 'solo' ? 2 : 1, at: 20 }], { targets: foes(K.tide) }],
  ['Q8', N_('伙友护影'), [1, 2], [1, 2], t2({ radius: 1.5 }, { radius: 1.5, cut: 1.6, together: true }), { targets: foes(K.holy, { from: 8 }) }],
  ['Q9', N_('穿刺突进'), [1, 2], [1, 2], t2({ move: 0.7 }, { move: 0.7, hp: 0.2, pairs: true }), { targets: foes(K.lancer, { from: 8 }) }],
  ['R1', N_('再生残响'), [2], [2], { shield: 7, reborn: 12, vuln: 0.15, dur: 5, radius: 2 }, { targets: foes(K.pupp, { from: 8 }) }],
  ['R2', N_('暴动预告'), [1, 2], [1, 2], t2({ hits: 3, sp: 5, cap: 15 }, { hits: 3, atk: 0.65, sp: 5, cap: 15 }), { targets: foes(K.prisoners) }],
  ['R3', N_('强敌露隙'), [2], [2], (mode) => ({ bat: 0.15, vuln: 0.25, dur: mode === 'solo' ? 6 : 8, gap: 15 }), { targets: foes(K.strong) }],
  ['R4', N_('破阵悬赏'), [1], [1], { rounds: [7, 13], hp: 0.25, sp: 10, heal: 0.1, giftSp: 15, giftHeal: 0.15 }],
  ['R5', N_('镜卫重燃'), [1], [1], { idle: 5, layers: 20, vuln: 0.2 }, { targets: foes(K.mirror, { from: 8 }) }],
  ['S1', N_('最终之罚重燃'), [1], null, { cd: 24 }, { needs: SCHEME_2 }],
  ['S2', N_('冰原狂潮'), [1, 2], [1, 2], t2({ icd: 30, cd: 50 }, { icd: 30, cd: 50, targets: 2 })],
  ['S3', N_('护卫合流'), [1, 2], [1, 2], t2({ share: 0.5 }, { share: 1 }), { needs: SCHEME_2 }],
  ['S4', N_('同步共鸣'), [2], [2], { period: 30, gap: 0.15, cut: 0.25, cutDur: 10, vuln: 0.15, vulnDur: 8 }, { needs: SCHEME_2 }],
  ['S5', N_('接力号令'), [1, 2], [1, 2], t2({}, { below: 0.6, at: 30 }), { needs: ['L3'] }],
  ['S6', N_('双首破局'), [1], [1], (mode) => ({ sp: 20, shield: mode === 'solo' ? 0.15 : 0.2, shieldDur: 10, after: 20, aspd: 10 }), { needs: ['L2', 'L3'] }],
  ['T1', N_('风向突变'), [1, 2], [1, 2], t2({ from: 40, every: 40, dur: 10 }, { from: 25, every: 25, dur: 10 }), { targets: { stages: [MAP.wind] } }],
  ['T2', N_('烟幕中断'), [1, 2], [1, 2], t2({ from: 40, every: 40, dur: 8 }, { from: 25, every: 25, dur: 8 }), { targets: { stages: [MAP.smoke] } }],
  ['T3', N_('潮汐回落'), [1, 2], [1, 2], t2({ from: 40, every: 40, dur: 10 }, { from: 30, every: 30, dur: 12 }), { targets: { stages: [MAP.tide] } }],
  ['T4', N_('重燃梯队'), [1, 2], [1, 2], (mode) => [{ rounds: [10, 13], share: 0.3, at: 30 }, { rounds: [8, 13], share: 0.3, at: 30, extra: mode === 'solo' ? 2 : 1 }]],
  ['T5', N_('寒风停歇'), [1, 2], [1, 2], t2({ mul: 1.5 }, { off: true })],
  ['U1', N_('分线承压'), null, [2], { rounds: [7, 13], at: 20, n: 2, each: 2 }],
  ['U2', N_('拼场轮压'), null, [2], { from: 20, every: 30, dur: 12, aspd: 20 }],
  ['U3', N_('联防迟援'), null, [1], { delay: 4 }],
  ['U4', N_('援护回响'), null, [1], { hp: 0.2, sp: 10, cut: 0.1, dur: 10 }],
];

/** id → { id, g, name, risk: { solo, quad }, needs, targets, params(mode, tier) } (弧光作战's X… routes included) */

/** The official page effect text per route, verbatim from sh.bbsmc.cn/v024 js/ui/crisisTags.js:47.
 * Placeholders: {a|b|c} = one value per tier (the picked tier is lit); [III]text = appended from tier III on.
 * A route may give {solo, quad} when the two modes read differently. This is the SAME table the page
 * renders, kept here so the server and the UI never quote different numbers. */
export const CRISIS_FX = {
  A1: '所有敌人生命增加{25%|50%|80%}', /* i18n-ignore: per-tier value list resolved by crisisFxText */
  A2: { solo: N_('第5—13回合，指定普通敌人首次死亡6秒后，生成40%生命的复制体，每轮3名。复制体不再复制、不提供资金及叠层收益'),
    quad: N_('第5—13回合，指定普通敌人首次死亡6秒后，生成25%生命的复制体，每名玩家每轮2名。复制体不再复制、不提供资金及叠层收益') },
  A3: { solo: N_('第5—13回合，若战斗持续至35秒，追加一批固定精英（2名）。名单与入口提前公开，每轮只触发一次'),
    quad: N_('第5—13回合，战斗到第35秒时本原战区仍有敌人，追加一批固定精英（每名玩家1名），已清场的玩家不追加。名单与入口提前公开，每轮只触发一次') },
  B1: '所有敌人攻击增加{15%|30%|50%}', /* i18n-ignore: per-tier value list */
  B2: N_('远程敌人攻击范围增加1格，攻击间隔缩短20%'),
  B3: N_('每名玩家原战区每轮预先标记的前2名精英，首次攻击造成150%伤害，并使目标晕眩1.5秒；无足够精英时不额外补怪'),
  C1: N_('敌人防御增加{100|200}，法术抗性增加{5|10}'),
  C2: N_('敌人每12秒在“物理伤害降低25%”与“法术伤害降低25%”之间切换（计入敌方受到伤害降低，合计最多−50%）；真实和元素伤害不变'),
  D1: '我方攻击降低{10%|20%|30%}', /* i18n-ignore: per-tier value list */
  D2: N_('同一单位连续普攻同一敌人，第6次起普攻伤害降低35%；切换目标或5秒未命中该目标后清除'),
  D3: N_('我方棋盘分为左、右两个半区，每20秒轮换一次；处于受压半区内的我方单位造成伤害降低25%（计入我方造成伤害降低，合计最多−60%）'),
  D4: '盟约、装备、策略提供的我方独立百分比伤害增幅，超过100%的增益部分仅保留{75%|50%|25%}；不直接修改攻击力或技能伤害倍率，也不影响指标带来的敌方受到伤害增加', /* i18n-ignore: per-tier value list */
  E1: N_('我方生命上限降低{15%|30%}'),
  E2: N_('战斗第25秒起，每30秒出现6秒干扰，受到的治疗量降低60%；护盾及非治疗类生命回复不变'),
  E3: N_('击倒时立刻生效的复活（5阿戈尔盟约的复活、不屈盟约的立刻重新部署、M3茧甲等复活装备、埃芒加德的复活）改为击倒3秒后生效，次数与效果不变；这3秒内干员离场，不可被选中、不阻挡。战斗在3秒内结束则不消耗复活次数；普通再部署时间不受影响'),
  F1: '技能所需技力增加{15%|30%|50%}', /* i18n-ignore: per-tier value list */
  F2: N_('装备、盟约、策略提供的直接技力回复量降低50%；自然、攻击与受击回复不变'),
  F3: N_('每场战斗前8秒，干员不能开启主动技能；仍可积攒技力，被动技能和天赋正常生效'),
  F4: { solo: N_('每场战斗前30秒，干员的自然技力回复增加30%，同时技能伤害降低15%（计入我方造成伤害降低，合计最多−60%）；治疗和护盾不受影响，复活与再部署不会重新计时'),
    quad: N_('每场战斗前30秒，干员的自然技力回复增加30%，同时技能伤害降低10%（计入我方造成伤害降低，合计最多−60%）；治疗和护盾不受影响，复活与再部署不会重新计时') },
  G1: '第7回合起，每回合系统基础资金减少{1|2|3}，最低为0；其他收入正常', /* i18n-ignore: per-tier value list */
  G2: N_('第4—6回合每回合扣留2点基础资金，第7回合一次性返还被扣留的资金（最多6点）'),
  G3: N_('每回合前3次购买干员正常计价，第4次起每次额外消耗1资金；赠送与合成奖励不计入购买次数'),
  G4: N_('休整期内全部非基础资金收入，包括出售、返款、盟约、特质、策略和装备资金，延至下一休整期开始可用；不减少资金总额。终局突袭（第14回合）休整期的收入不冻结'),
  H1: '第4回合起，每回合主动刷新最多{12|9|6}次，免费刷新也计次', /* i18n-ignore: per-tier value list */
  H2: N_('调度中心第1次升级不加价，第2次起每次升级额外消耗2资金'),
  H3: N_('精锐合成立即生效，但合成附赠的免费选择奖励延至下一回合发放；奖励等阶按合成时计算'),
  H4: N_('每次普通主动刷新后，最左侧的干员商品格本次不可购买；自动刷新和独立奖励界面不受影响'),
  H5: '每名玩家每休整期主动购买、出售、使用消耗品合计最多{30|22|16}次，免费操作也计数；自动赠送、自动合成不另计', /* i18n-ignore: per-tier value list */
  I1: '所有来源获得的盟约层数变为{80%|65%|50%}，小数累计', /* i18n-ignore: per-tier value list */
  I2: N_('第3回合结束前指定一个主核心盟约；其他核心盟约层数获取量变为70%，附加盟约正常'),
  I3: N_('四人各登记一个不同的核心盟约；只有登记的核心可触发高阶人数档，其他核心仍可使用基础激活效果及层数效果'),
  I4: '每名玩家每种盟约，每休整期实际新增层数最多{40|25|15}层；覆盖所有休整来源，战斗阶段叠层不限', /* i18n-ignore: per-tier value list */
  J1: '每名玩家场上最多携带{6|4|2}件进阶装备，基础装备不受限制', /* i18n-ignore: per-tier value list */
  J2: N_('第5回合起，每场装备等阶最高的两件装备前15秒失效；同阶时由系统自动选取。仍计为“携带装备”'),
  J3: N_('每名玩家在场精锐干员最多{4|3}名；允许继续合成并存放其他精锐'),
  J4: N_('同名进阶装备全队最多携带3件，每名玩家最多携带其中1件；已淘汰玩家的装备不计入，基础装备不限'),
  J5: N_('将六人维多利亚效果中每件基础／进阶装备的攻击加成，从50%／80%改为25%／40%；仍保留两个装备位、装备自身效果及套装组合'),
  J6: N_('每名玩家每休整期最多使用{4|2}份基础等价消耗装备；基础品质计1份、进阶品质计2份，所有适用消耗装备共用配额'),
  K1: N_('每名玩家同时在场干员最多{7|6}名；原有总部署位与召唤物占位规则保留。与K4同选时，每名玩家的上限取两者中较小的一个'),
  K2: N_('第1回合休整开始时公开1个地面格、1个高台格，整局封锁，同一局所有玩家相同，由开局种子决定；开局即封锁，不会把干员移出棋盘'),
  K3: N_('战斗开始时的布阵中，正交相邻的其他干员达到3名的干员，每场战斗前10秒造成伤害降低15%（计入我方造成伤害降低，合计最多−60%）；召唤物和战斗中的移动不计'),
  K4: N_('全队总部署位额度减少6，由四人自由分配；个人不能超过其原本上限。与K1同选时，每名玩家的上限取两者中较小的一个，K4不再额外扣减'),
  L1: N_('领袖生命额外增加{25%|40%}，攻击速度增加{10|20}；可与任一领袖登场方案同选，双领袖时对两名领袖各自生效'),
  L2: { solo: N_('“萨米的意志”与第二名领袖“假想敌：铳”同时登场，各为正常生命的65%，两者均须击败（仅终局突袭；隐秘核心仍为单领袖）'),
    quad: N_('“萨米的意志”与第二名领袖“假想敌：铳”同时登场，各为正常生命的65%，两个拼场共享这两个生命池；两者均须击败（仅终局突袭；隐秘核心仍为单领袖）') },
  L3: N_('“萨米的意志”先登场；其生命首次降至50%，或战斗到达40秒时，第二名领袖“假想敌：铳”登场，取较早者。主／副生命为80%／55%（仅终局突袭；隐秘核心仍为单领袖）'),
  L4: N_('两个拼场分别面对“萨米的意志”与“假想敌：铳”，各为正常生命的60%。两者剩余生命百分比相差超过20个百分点时，血量较低者受到伤害降低30%（计入敌方受到伤害降低，合计最多−50%）；一名死亡后解除减伤，另一名攻击力增加20%（仅终局突袭；隐秘核心仍为单领袖）'),
  L5: N_('两个拼场各面对一名“萨米的意志”，各为正常生命的60%；每30秒交换一次战区，保留生命、阶段与技能冷却（仅终局突袭；隐秘核心仍为单领袖）'),
  M1: N_('常规手牌区由10格降为7格，临时手牌区规则保留'),
  M3: N_('每轮联防最多由1名成功玩家承接'),
  M4: N_('允许同一玩家连续承接联防；连续第2轮及以后承接的玩家，下一场常规战斗前10秒造成伤害降低10%（计入我方造成伤害降低，合计最多−60%），不叠加'),
  M5: N_('第6、10回合正常作战及联防结束后，强制两两拼场进行40秒援护战。每名玩家追加1名固定重甲精英、1名固定术师精英；继承当前状态，不叠层、不发资金；存活人数为奇数时，多出的一名玩家不参加'),
  N1: N_('所有敌人移动速度增加20%'),
  N2: N_('第4—13回合，敌人出生间隔缩短20%，敌人总数不变'),
  N3: N_('领袖战原始计时缩短10%'),
  O1: { solo: N_('目标生命上限变为10'), quad: N_('每名玩家目标生命上限变为10，领袖轮仍合并实际剩余生命') },
  O2: N_('四人领袖轮合并目标生命后，仅保留75%，向下取整、最低1点'),
  O3: N_('领袖轮前，{全队共享一次保命：首次有人目标生命将归零时保留为1；此后再有人归零，全队立即失败|任意一名玩家目标生命归零，全队立即失败}'),
  // ---- 下半 ----
  P1: { solo: N_('终局突袭中，“萨米的意志”战场的冰爆源石虫生命增加40%，死亡爆炸伤害由攻击力的200%提高到250%[Ⅱ:数量由5只增加到7只，多出的不提供奖励]'),
    quad: N_('终局突袭中，“萨米的意志”战场的冰爆源石虫生命增加40%，死亡爆炸伤害由攻击力的200%提高到250%[Ⅱ:每个拼场的数量由8只增加到10只，多出的不提供奖励]') },
  P2: { solo: N_('终局突袭中，“萨米的意志”战场每有1名存活的游击队盾卫，萨米受到伤害降低6%（最多4层）（计入敌方受到伤害降低，合计最多−50%）；每击倒1名盾卫，萨米受到伤害增加10%，持续8秒（最多同时2个）（计入敌方受到伤害增加，合计最多+60%）'),
    quad: N_('终局突袭中，“萨米的意志”战场每有1名存活的游击队盾卫，萨米受到伤害降低6%（最多4层）（计入敌方受到伤害降低，合计最多−50%）；每击倒1名盾卫，萨米受到伤害增加10%，持续8秒（最多同时2个）（计入敌方受到伤害增加，合计最多+60%）。同拼场两名玩家都对该盾卫造成过15%最大生命以上的伤害时，持续时间延长为12秒') },
  P3: N_('需同选S3。终局突袭中，愧悔魂灵圣杯为周围敌人分担的伤害比例由5%提高到{15%|25%}[Ⅱ:圣杯生命增加25%]；一名敌人只向最近的圣杯分担。圣杯被击倒时，周围1.7格内的地面敌人受到伤害增加20%，持续6秒（计入敌方受到伤害增加，合计最多+60%）'),
  Q1: N_('含寒霜的常规回合与终局突袭中，寒霜生命增加30%[Ⅱ:光环半径由2.5格扩大到3格][Ⅲ:光环降低我方攻击速度的幅度由50提高到60]'),
  Q2: N_('第8—13回合，假想敌：淤困寄生期间，宿主受到的元素损伤倍率由1.3提高到1.45[Ⅱ:淤困生命增加30%，寄生伤害倍率由0.3提高到0.4]'),
  Q3: N_('第8—13回合，集团军中坚盾卫存活时，周围1.5格内的其他敌人受到伤害降低15%，多只不叠加（计入敌方受到伤害降低，合计最多−50%）[Ⅱ:宿主重装士兵每秒回复由200提高到300]'),
  Q4: N_('深池方阵步兵、方阵指挥官每名附近同伴提供的防御由200提高到250[Ⅱ:同一出生点的方阵成员出生间隔缩短50%（总数不变），成队行进]'),
  Q5: N_('深池逐火战士、逐火精锐战士、逐火护卫的余烬重生间隔由10缩短为8[Ⅱ:余烬击倒所需次数由5提高到7（逐火护卫由10提高到14）]'),
  Q6: N_('第8—13回合，假想敌：蚀裂被击倒后射向击倒者的毒雾，半径由0.8格扩大到1.2格[Ⅱ:毒雾持续时间由8延长到12]'),
  Q7: { solo: N_('控潮术师、领潮员的侵蚀比例由0.8提高到1.0[Ⅱ:含领潮员的回合第20秒追加2名领潮员，从原入口出生，不提供奖励]'),
    quad: N_('控潮术师、领潮员的侵蚀比例由0.8提高到1.0[Ⅱ:含领潮员的回合第20秒，每名玩家原战区追加1名领潮员，从原入口出生，不提供奖励]') },
  Q8: N_('第8—13回合，深池伙友卫队精英的力场半径由1.1格扩大到1.5格[Ⅱ:影刃在卫队附近时攻击间隔的缩减由1.3提高到1.6；精英位的卫队与影刃同点、同时出生]'),
  Q9: N_('第8—13回合，萨卡兹穿刺手的移动加速上限由+0.5提高到+0.7[Ⅱ:生命增加20%，同一出生点两名一组出生（总数不变）]'),
  R1: N_('第8—13回合，假想敌：再生倒下时给周围敌人的抵挡护盾由5次提高到7次，重生间隔由15缩短为12；在它重生之前将其彻底击倒，周围2格内的敌人立刻失去抵挡护盾，并受到伤害增加15%，持续5秒（每只一次）（计入敌方受到伤害增加，合计最多+60%）'),
  R2: N_('囚犯解除禁锢所需的攻击次数由4降为3[Ⅱ:解放后攻击加成由50%提高到65%]；囚犯在禁锢状态下被击倒时，击倒者及其周围1格内的我方干员各获得5点技力，每名干员每场最多15点（视为策略来源，受F2影响）'),
  R3: { solo: N_('粉碎攻坚手、码头水手、萨卡兹悖谬暴虐兵长、萨卡兹王庭军精锐术师的攻击间隔缩短15%；它们完成技能（重击命中、首次溅射命中、死亡之眼结算）后受到伤害增加25%，持续6秒（计入敌方受到伤害增加，合计最多+60%），每名敌人至少间隔15秒'),
    quad: N_('粉碎攻坚手、码头水手、萨卡兹悖谬暴虐兵长、萨卡兹王庭军精锐术师的攻击间隔缩短15%；它们完成技能（重击命中、首次溅射命中、死亡之眼结算）后受到伤害增加25%，持续8秒（计入敌方受到伤害增加，合计最多+60%），每名敌人至少间隔15秒') },
  R4: { solo: N_('第7—13回合，每回合在自然出现的精英中标记1名（休整期公开），其生命增加25%；首次击倒后，在场干员各获得10点技力并回复10%最大生命。复制体、衍生物不发奖励'),
    quad: N_('第7—13回合，每名玩家原战区在自然出现的精英中标记1名（休整期公开），其生命增加25%；首次击倒后，本原战区在场干员各获得10点技力并回复10%最大生命。复制体、衍生物不发奖励') },
  R5: N_('第8—13回合，弧光镜卫、镜卫长连续5秒未受到伤害时恢复20层（约1000防御、40法术抗性）；防御被削到最低（层数叠满）后受到伤害增加20%，直到死亡（计入敌方受到伤害增加，合计最多+60%）'),
  S1: N_('需同选L2、L3或L4。第二名领袖“假想敌：铳”的【最终之罚】冷却缩短20%'),
  S2: N_('“萨米的意志”的【自然涌动】首次释放提前25%、冷却缩短约17%[Ⅱ:半血前也同时攻击2名目标]'),
  S3: N_('需同选L2、L3或L4。第二名领袖“假想敌：铳”关卡的护卫按{50%|100%}加入它所在的每个战场（每批向下取整，至少1名）；出生时间与入口沿用其关卡，L3从它登场时起算'),
  S4: N_('需同选L2、L3或L4。每30秒比较两名领袖的剩余生命百分比：相差超过15个百分点时，较高者受到伤害降低25%，持续10秒（计入敌方受到伤害降低，合计最多−50%）；不超过15个百分点时，两名领袖受到伤害增加15%，持续8秒（计入敌方受到伤害增加，合计最多+60%）。一名领袖死亡后停止；L3从第二名领袖登场后开始'),
  S5: N_('需同选L3。第二名领袖登场时，“萨米的意志”下一个主动技能立刻就绪（每局一次）；第二名领袖每个主动技能的首次等待时间减半[Ⅱ:第二名领袖改为在主领袖生命降至60%或战斗到达30秒时登场]'),
  S6: { solo: N_('需同选L2或L3。第二名领袖首次登场时（L2为开战后第3秒），本战场所有在场干员获得20点技力（视为策略来源，受F2影响）和最大生命15%的护盾，持续10秒，只发一次；登场20秒后，两名领袖攻击速度增加10，直到其中一名死亡'),
    quad: N_('需同选L2或L3。第二名领袖首次登场时（L2为开战后第3秒），本战场所有在场干员获得20点技力（视为策略来源，受F2影响）和最大生命20%的护盾，持续10秒，只发一次；登场20秒后，两名领袖攻击速度增加10，直到其中一名死亡') },
  T1: N_('仅限战场#05 源石流发生装置：每场战斗从第{40|25}秒起，每{40|25}秒全部源石流发生装置反向10秒；反向期间顺风干员变为逆风（攻击+30%变为−30%），敌人的移速加减同样翻转'),
  T2: N_('仅限战场#07 排气格栅：每场战斗从第{40|25}秒起，每{40|25}秒烟雾消散8秒；消散期间，原本在烟雾中的干员可以被远程敌人选为目标'),
  T3: N_('仅限战场#08 涨潮控制：每场战斗从第{40|30}秒起，每{40|30}秒退潮{10|12}秒；退潮期间，深水对敌人的伤害、攻速、移速效果全部失效'),
  T4: { solo: N_('第{10|8}—13回合，当回合特殊类敌人中最后30%（向上取整）改为在第30秒从两个公开入口同时出生，总数不变[Ⅱ:另追加2名当回合精英位敌人，不提供奖励]'),
    quad: N_('第{10|8}—13回合，当回合特殊类敌人中最后30%（向上取整）改为在第30秒从两个公开入口同时出生，总数不变[Ⅱ:每名玩家原战区另追加1名当回合精英位敌人，不提供奖励]') },
  T5: N_('所有地图的盟约寒风{触发间隔延长50%|停用}'),
  U1: N_('第7—13回合，每回合选1名玩家为承压位（休整开始时公开；不连续两回合，每人最多2次），其原战区在第20秒追加2名当回合精英位敌人，不提供奖励'),
  U2: N_('终局突袭从第20秒起，每30秒轮流让一个拼场进入压制（先b1、后b2）：该拼场的领袖和护卫攻击速度增加20，持续12秒'),
  U3: N_('联防战开始后，承接人的干员延迟4秒入场，原有生命、技力、站位保留；被援护者的干员不受影响'),
  U4: N_('转入联防战的敌人生命增加20%；联防战零漏怪完成时，承接人的在场干员在下一场常规战斗开始时各获得10点技力，被援护者在下一场常规战斗前10秒受到伤害降低10%（每名玩家每回合最多1份）'),
};

export const CRISIS_ROUTES = Object.freeze(Object.fromEntries([...ROWS.map(([id, name, solo, quad, tiers, more = {}]) => [id, Object.freeze({
  id, g: id[0], name, risk: Object.freeze({ solo: solo && Object.freeze(solo), quad: quad && Object.freeze(quad) }),
  needs: more.needs ? Object.freeze(more.needs.slice()) : null,
  targets: more.targets ? Object.freeze(more.targets) : null,
  params(mode, tier) {
    const t = typeof tiers === 'function' ? tiers(mode) : tiers;
    return { ...(Array.isArray(t) ? t[tier - 1] : t) };
  },
})]), ...Object.entries(ARC_ROUTES)]));

/** Is a selection (checked or not) one of 弧光作战? */
export const isArcCrisis = (sel) => !!sel && typeof sel === 'object' && sel.season === 'arc';
/** The rules id of a selection: 'arc1' for 弧光作战, else this board's (CRISIS_RULES). */
export const crisisRulesOf = (sel) => (isArcCrisis(sel) ? ARC_SEASON.id : CRISIS_RULES);

const TAG_RE = /^([A-U][1-9])-([1-3])$/;

/** A tag id of a mode: { id, route, tier, lv } or null when the route / tier is not offered there. */
export function crisisTag(mode, id) {
  const m = typeof id === 'string' ? TAG_RE.exec(id) : null;
  const route = m ? CRISIS_ROUTES[m[1]] : null;
  const risks = route && CRISIS_MODES.includes(mode) ? route.risk[mode] : null;
  const tier = m ? Number(m[2]) : 0;
  if (!risks || tier < 1 || tier > risks.length) return null;
  return { id, route, tier, lv: risks[tier - 1] };
}

/** Two tags that cannot be picked together (a route's own tiers; two leader schemes). */
export function crisisConflict(a, b) {
  if (!a || !b || a.id === b.id) return false;
  return a.route === b.route || (CRISIS_SCHEMES.includes(a.route.id) && CRISIS_SCHEMES.includes(b.route.id))
    || (a.route.g === b.route.g && CRISIS_EXCLUSIVE.includes(a.route.g));
}

/** A route's `needs` against the picked route ids: null when met (or none), else the ids it waits for. */
export function crisisNeeds(route, pickedIds) {
  if (!route || !route.needs) return null;
  return route.needs.some((id) => pickedIds.includes(id)) ? null : route.needs.slice();
}

/**
 * The checked form of a selection, or null when it is malformed, names a tag the mode does not offer, repeats one,
 * holds a conflict or a route without the scheme it needs. Tags come back sorted; `total` = Σ risk.
 * @returns {{ mode: 'solo'|'quad', tags: string[], total: number } | null}
 */
export function checkCrisis(sel) {
  if (!sel || typeof sel !== 'object' || Array.isArray(sel)) return null;
  if (isArcCrisis(sel)) return checkArc(sel);
  const { mode, tags } = sel;
  if (!CRISIS_MODES.includes(mode) || !Array.isArray(tags) || tags.length > ROWS.length) return null;
  const picked = [];
  for (const id of tags) {
    const t = crisisTag(mode, id);
    if (!t || picked.some((p) => p.id === id || crisisConflict(p, t))) return null;
    picked.push(t);
  }
  const ids = picked.map((t) => t.route.id);
  if (picked.some((t) => crisisNeeds(t.route, ids))) return null;
  picked.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { mode, tags: picked.map((t) => t.id), total: picked.reduce((n, t) => n + t.lv, 0), ...(ids.includes('O3') ? { o3Rules: 2 } : {}) };
}

/** Wire check of room.create's `crisis` field (shared/protocol.js): the shape only — checkCrisis decides. */
export function isCrisisSelection(v) {
  if (isArcCrisis(v)) return isArcSelection(v);
  return !!v && typeof v === 'object' && !Array.isArray(v) && CRISIS_MODES.includes(v.mode) && Array.isArray(v.tags)
    && v.tags.length <= ROWS.length && v.tags.every((t) => typeof t === 'string' && TAG_RE.test(t));
}

/** A 32-bit 开局种子 (1 … 2³²−1; 0 means "none"). */
export const isCrisisSeed = (v) => Number.isInteger(v) && v > 0 && v <= 0xffffffff;

/**
 * How many rounds of a seed's schedule hold a route's enemy targets. `preview` = { stageId, picks } (picks[r] =
 * { key, normal, elite } of round r, server/crisis-rn1-20261026.mjs crisisPreview). Map routes: 1 when the map is theirs.
 */
export function crisisTargetCount(route, preview) {
  const tg = route && route.targets;
  if (!tg) return Infinity;
  if (!preview || typeof preview !== 'object') return 0;
  if (tg.stages) return tg.stages.includes(preview.stageId) ? 1 : 0;
  const picks = Array.isArray(preview.picks) ? preview.picks : [];
  const has = (p) => !!p && tg.keys.some((k) => k === p.key || k === p.normal || k === p.elite);
  let n = 0;
  for (let r = tg.from; r <= tg.to; r++) if (has(picks[r])) n++;
  if (tg.r14 && picks[14] && picks[14].elite === tg.r14) n = Math.max(n, tg.min);
  return Math.max(n, enemyTargetRounds(route, preview.seed).length);
}

/** The rounds of a seed's schedule holding a route's enemy targets (14: the Final Assault's slot); [] for map routes. */
export function crisisTargetRounds(route, preview) {
  const tg = route && route.targets;
  if (!tg || tg.stages || !preview || !Array.isArray(preview.picks)) return [];
  const has = (p) => !!p && tg.keys.some((k) => k === p.key || k === p.normal || k === p.elite);
  const out = [];
  for (let r = tg.from; r <= tg.to; r++) if (has(preview.picks[r])) out.push(r);
  if (tg.r14 && preview.picks[14] && preview.picks[14].elite === tg.r14) out.push(14);
  return [...new Set([...out, ...enemyTargetRounds(route, preview.seed)])].sort((a, b) => a - b);
}

/** Does a route have its targets in this seed's match? (routes without targets always do) */
export function crisisHasTargets(route, preview) {
  const tg = route && route.targets;
  return !tg || crisisTargetCount(route, preview) >= (tg.stages ? 1 : tg.min);
}

/** The routes of a selection whose targets the seed's match lacks ([] = every tag counts). */
export function crisisMissingTargets(sel, preview) {
  const c = checkCrisis(sel);
  // 弧光作战: every enemy of the season comes in every match (shared/crisisArc.js ARC_ROSTER)
  if (!c || c.season === 'arc') return [];
  return [...new Set(c.tags.map((id) => crisisTag(c.mode, id).route))].filter((r) => !crisisHasTargets(r, preview)).map((r) => r.id);
}

/**
 * The rules of a selection: { mode, tags, total, fx } with fx[routeId] = its tier's numbers (+ `tier`), or null when
 * the selection does not check.
 */
export function crisisRules(sel) {
  if (isArcCrisis(sel)) return arcRules(sel);
  const c = checkCrisis(sel);
  if (!c) return null;
  const fx = {};
  for (const id of c.tags) {
    const t = crisisTag(c.mode, id);
    fx[t.route.id] = { ...t.route.params(c.mode, t.tier), tier: t.tier };
  }
  return { ...c, fx };
}

/** Is `r` inside an inclusive [from, to] round window (a params `rounds` pair)? */
/**
 * The routes this build actually implements, with the seam each one lands on.
 *
 * The table is the FULL official list (89 routes) and every one is offered in the picker; what is not in here
 * names an enemy, a map device or a mechanism this build does not carry yet, so picking it compiles its fx
 * (the numbers are right) but the fight does not change. The UI reads this to mark those routes, so a player
 * is never told an effect is live when it is not.
 *
 * Keep in step with server/match/match/crisisFx.js: a route is listed once applyCrisisFx (or the match layer)
 * really consumes it.
 */
export const CRISIS_IMPLEMENTED = Object.freeze({
  A1: 'hpMul', B1: 'atkMul', D1: 'atkMul', E1: 'hpMul', F1: 'spMul', Q1: 'hpMul', Q9: 'hpMul',
  A2: 'kill-after-spawnEnemy', A3: 'tick35 spawn', B2: 'rangeExtend+aspd', B3: 'enemyAttackStart+damageOutput',
  C1: 'def/res', C2: 'physTaken/artsTaken', D2: 'hit streak-damageOutput', D3: 'dmgDealtMul by half',
  D4: 'damageOutput', E2: 'healingTakenMul', E3: 'reviveNow delay', F2: 'spGain by reason',
  F3: 'startOpCooldown', F4: 'spGain time + skill damage', I1: 'layerGain', I2: 'layerGain non-main',
  J2: 'grant.dispose', J5: 'crisisEquipAtk', K3: 'manhattan adjacency atkMul', L1: 'boss pool hp',
  M3: 'crisisUniteHelpers', M4: 'dmgDealtMul helper', N1: 'speedMul', N2: 'spawn rhythm', N3: 'timeLimit',
  O1: 'income', O2: 'income', O3: 'income', P1: 'enemySpawn hp + damageOutput deathBoom', P2: 'damageOutput shield layers', P3: 'chaliceShare + death buff', Q3: 'damageOutput aura', R1: 'gamedata talents + death buff', R2: 'gamedata confinement + kill sp', R5: 'defDecay buff + damageOutput', T1: 'deviceState flow flip', T2: 'terrain:smog lift', T3: 'st.deepsea ebb', T5: 'flags.crisisColdWindMul',
  Q2: 'gamedata talents 1.damage_scale', Q4: 'gamedata auraDefup.def', Q5: 'gamedata Revive interval',
  Q6: 'gamedata projectile_range', Q7: 'gamedata ep_damage_ratio', Q8: 'gamedata traitAbility radius',
  R3: 'gamedata bat + skillEnd vuln',
  R4: 'pickCrisisMark + maxHpMul + kill reward',
  M5: 'planCrisisM5 forced unite + fixed elites + 40s',
  T4: 'crisisSpecialSpawns at 30s dual entry',
  U1: 'crisisPressure tick20',
  U2: 'crisisSuppress after+addBuff', U3: 'retreat-after-redeploy', U4: 'enemySpawn hpMul',
  G1: 'gamedata', G2: 'gamedata', G3: 'gamedata', G4: 'gamedata',
  H1: 'gamedata', H2: 'gamedata', H3: 'gamedata', H4: 'gamedata', H5: 'intents quota',
  I3: 'crisisMainBond', I4: 'gamedata', J1: 'gamedata', J3: 'gamedata', J4: 'intents quota', J6: 'intents quota',
  K1: 'gamedata', K2: 'board tileOverrides', K4: 'gamedata',
  L2: 'gamedata', L3: 'gamedata', L4: 'gamedata', L5: 'gamedata', M1: 'gamedata',
  S1: 'gamedata', S2: 'gamedata', S3: 'gamedata', S4: 'gamedata', S5: 'gamedata', S6: 'gamedata',
});

/** Is this route id really wired in this build? */
export const isCrisisImplemented = (id) => Object.prototype.hasOwnProperty.call(CRISIS_IMPLEMENTED, id);
export const inRounds = (pair, r) => Array.isArray(pair) && r >= pair[0] && r <= pair[1];

/** One route's effect text for `mode`, with `tier` (1-based) applied.
 *
 * The table uses the page's own placeholders: {a|b|c} is one value PER TIER and the picked tier is the one that
 * shows; [III]text is appended only from tier III on. Returns { text, parts } where `parts` keeps the split so a
 * caller can light the live value the way the official page does: [{ text } | { vals, on } | { from, text, on }].
 * @param {string} routeId
 * @param {'solo'|'quad'} mode
 * @param {number} [tier] 1-based; omit for tier 1
 * @returns {{ text: string, parts: Array<object> } | null} null when the route has no text for that mode
 */
export function crisisFxText(routeId, mode, tier = 1) {
  // a route lives in exactly one of the two tables: the main board (CRISIS_FX) or the 弧光作战 season (CRISIS_ARC_FX)
  const raw = CRISIS_FX[routeId] || CRISIS_ARC_FX[routeId];
  if (!raw) return null;
  // Three shapes occur: a plain string (one text for both modes), { solo, quad }, and — in the 弧光作战 table —
  // an ARRAY [text, markers] whose tail is metadata (and whose [0] may itself be { solo, quad }, e.g. XC5), so
  // unwrap the array first and only then ask for the mode.
  // loop, not a single unwrap: XC5 is [[{solo,quad}, marker]]-shaped, i.e. the array's [0] is itself an object.
  let cur = raw;
  for (let i = 0; i < 4 && cur != null && typeof cur !== 'string'; i += 1) {
    cur = Array.isArray(cur) ? cur[0] : cur[mode];
  }
  const src = typeof cur === 'string' ? cur : null;
  if (typeof src !== 'string') return null;
  const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ'];
  const on = Math.max(1, Math.min(3, Number(tier) || 1));
  const parts = src
    .split(/(\{[^}]*\}|\[[ⅠⅡⅢ]:[^\]]*\])/)
    .filter(Boolean)
    .map((s) => {
      if (s[0] === '{') return { vals: s.slice(1, -1).split('|'), on: on - 1 };
      if (s[0] === '[') return { from: ROMAN.indexOf(s[1]) + 1, text: s.slice(3, -1) };
      return { text: s };
    })
    .map((x) => (x.from ? { ...x, on: on >= x.from } : x));
  const text = parts.map((x) => (x.from ? (x.on ? '；' + x.text : '') : (x.text ?? x.vals[x.on]))).join('');
  return { text, parts };
}

/** 弧光作战 season effect text, verbatim from sh.bbsmc.cn/v024 js/ui/crisisArcTags.js FX. */
export const CRISIS_ARC_FX = {
  XA1: ['所有敌人攻击力+{20%|40%|60%}', ['enemy_atk_1', 'enemy_atk_2', 'enemy_atk_3']], /* i18n-ignore: per-tier value list */
  XA2: ['所有敌人生命值+{25%|50%|80%}（领袖血池同样提高）', ['enemy_hp_1', 'enemy_hp_2', 'enemy_hp_3']], /* i18n-ignore: per-tier value list */
  XA3: [N_('所有敌人受到的物理伤害−{20%|35%}（与其他「敌人受到伤害降低」合计最多−50%）'), ['enemy_physical_reduction_1', 'enemy_physical_reduction_2']],
  XA4: [N_('所有敌人受到的法术伤害−{20%|35%}（与其他「敌人受到伤害降低」合计最多−50%）'), ['enemy_magical_reduction_1', 'enemy_magical_reduction_2']],
  XA5: [N_('所有敌人防御力+{200|400}'), 'enemy_def_1'],
  XA6: [N_('所有敌人重量+{1|2}：顺重力冲得更快、逆重力被拖得更慢，也更难被推拉'), ['enemy_weight_1', 'enemy_weight_2']],
  XB1: [N_('我方单位攻击速度−{10|20}'), 'gx_char_attackspeed_1'],
  XB2: [N_('部署在地面的我方单位最大生命值−{20%|30%}'), ['char_lowland_attribute_mul_1', 'char_lowland_attribute_mul_2']],
  XB3: [N_('部署在高台的我方单位攻击力−{15%|25%}'), ['char_highland_attribute_mul_1', 'char_highland_attribute_mul_2']],
  XC1: [N_('作战中部署费用自然回复−{20%|35%}：倒下的干员要等更久才能再部署'), ['global_costrecovery_2', 'global_costrecovery_3']],
  XC2: [N_('每次再部署额外消耗{3|5}点部署费用（不足时扣光）'), ['extra_cost_1', 'extra_cost_2']],
  XC3: [N_('我方单位再部署时间+75%'), 'char_respawntime_1'],
  XC4: [N_('每名玩家同时在场干员最多{7|6}名'), ['global_pcharnum_1', 'global_pcharnum_2']],
  XC5: [{ solo: N_('目标生命上限变为{12|5}'), quad: N_('每名玩家目标生命上限变为{12|5}') }, 'global_lifepoint_1'],
  XD1: [N_('常规手牌区由10格减为{8|6}格'), ['global_squadnum_1', 'global_squadnum_2']],
  XD2: ['第7回合起，每回合系统基础资金−{1|2|3}', 'global_nocostrecovery_1'], /* i18n-ignore: per-tier value list */
  XD3: [N_('第4回合起，每回合主动刷新最多{8|5}次'), 'magiccircuit_env_1'],
  XD4: [N_('所有来源获得的盟约层数变为{80%|60%}'), 'global_skillrecovery_3'],
  XD5: [N_('每名玩家在场精锐干员最多{4|3}名'), 'global_psquad_1'],
  XE1: [N_('每场作战开始时两个半场的重力都已向左（敌人顺重力加速），重力按钮前15秒失灵：开战时就站在按钮上的干员不算踩下'), 'gx_ristar_3'],
  XE2: [N_('重力按钮只有阻挡数≥3的干员或重量≥3的敌人才能踩下'), 'gx_ristar_2'],
  XE3: [N_('第20秒起，每{30|20}秒，已有重力的半场重力反向一次（朝向带来的攻速加成会变成惩罚）'), 'gx_ristar_1'],
  XE4: [N_('敌人逆重力移动时的减速效果减半（重量3：36%→68%）'), 'magiccircle_slow'],
  XE5: [N_('有重力的半场里，朝上或朝下部署的干员攻击速度−15'), 'gx_char_attackspeed_2'],
  XF1: [N_('棋盘上{2|4}个固定的地面格整局不能部署（每名玩家相同）'), 'melee_forbid_1'],
  XF2: [N_('棋盘上{2|4}个固定的高台格整局不能部署（每名玩家相同）'), 'range_forbid_2'],
  XG1: [N_('商店里术师、特种干员的招募价格×2（晋升奖励等免费获得不受影响）'), 'char_cost_casterspecial_1'],
  XG2: [N_('商店里狙击、近卫干员的招募价格×2（晋升奖励等免费获得不受影响）'), 'char_cost_sniperguard_1'],
  XG3: [N_('商店里医疗、重装干员的招募价格×2（晋升奖励等免费获得不受影响）'), 'char_cost_healerdefender_1'],
  XG4: [N_('近卫干员每次部署后10秒内，每秒流失4%最大生命'), 'char_deploy_losthp'],
  XG5: [N_('重装干员每次部署后晕眩8秒'), 'char_deploy_stun'],
  XG6: [N_('医疗干员每次部署后15秒内攻击速度−40'), 'char_deploy_attribute_add_1'],
  XG7: [N_('先锋干员每次部署后10秒内攻击力−75%'), 'char_deploy_bleed_1'],
  XH1: [N_('弧光锋卫长替换弧光锋卫出战'), 'gx_cbjedi_2'],
  XH2: [N_('弧光锋卫、锋卫长重量+{1|2}（失衡掉血更少，顺重力更快）'), 'gx_cbjedi_1'],
  XH3: [N_('弧光锋卫、锋卫长攻击力+100%'), 'gx_cbjedi_3'],
  XH4: [N_('弧光锋卫、锋卫长防御力+100%，生命值+50%'), 'gx_cbjedi_4'],
  XI1: [N_('弧光镜卫、镜卫长受到伤害后降低的防御力与法术抗性减少50%'), 'gx_cbshld_1'],
  XI2: [N_('弧光镜卫、镜卫长受到的晕眩、冻结、沉睡时间减半，重量+2'), 'gx_cbshld_2'],
  XI3: [N_('弧光镜卫、镜卫长攻击力+150%'), 'gx_cbshld_3'],
  XI4: [N_('弧光镜卫、镜卫长生命值+150%'), 'gx_cbshld_4'],
  XJ1: [N_('第8回合起，每场常规作战开始时从红门额外出发2个“交通亭”量产型（不提供奖励）'), 'gx_cbterm_1'],
  XJ2: [N_('“交通亭”量产型的防御力与法术抗性最多降低70次（原110次）'), 'gx_cbterm_2'],
  XJ3: [N_('“交通亭”量产型被摧毁后的自爆伤害+50%'), 'gx_cbterm_3'],
  XJ4: [N_('“交通亭”量产型攻击力+50%'), 'gx_cbterm_4'],
  XJ5: [N_('“交通亭”量产型生命值+200%，防御力+50%'), 'gx_cbterm_5'],
  XJ6: [N_('“交通亭”量产型第一次被摧毁后，原地再弹出一个交通亭（生命50%，不再弹出，不提供奖励）'), 'gx_cbterm_7'],
  XJ7: [N_('每摧毁一个“交通亭”量产型，下一休整期+1资金；但交通亭漏进蓝门扣3点目标生命（原1点）'), 'frog_coin_1'],
  XK1: [N_('“十字路口”量产型重量+2'), 'gx_cbsisy_1'],
  XK2: [N_('第8回合起，每场常规作战开局额外出现{1|2}个“十字路口”量产型（{一个入口|上下入口各1个}，不提供奖励）'), 'gx_cbsisy_6'],
  XK3: [N_('“十字路口”量产型生命值+200%'), 'gx_cbsisy_2'],
  XK4: [N_('“十字路口”量产型防御力+100%，法术抗性+40'), 'gx_cbsisy_3'],
  XK5: [N_('“十字路口”量产型移动速度+50%'), 'gx_cbsisy_5'],
  XK6: [N_('“十字路口”量产型攻击力+300%'), 'gx_cbsisy_4'],
  XK7: [N_('“十字路口”量产型的四向射击不再只打第一个：同一行、同一列3格内的干员全部受到伤害'), 'gx_cbsisy_7'],
  XL1: [N_('每场常规作战开始时，蓝门前已有2名莱茵生命高级工程科成员驻守，30秒后走进蓝门（不提供奖励）'), 'gx_lyengs_1'],
  XL2: [N_('莱茵生命高级工程科成员攻击范围×2，攻击力+100%'), 'gx_lyengs_2'],
  XL3: [N_('莱茵生命高级工程科成员每20秒为周围2格内的量产型机械（交通亭、十字路口、肇事者）回复10%最大生命'), 'lyengs_skill1'],
  XM1: [N_('“肇事者”量产型获得隐匿（只有被阻挡时才能被选为目标）'), 'crgst_invisible'],
  XM2: [N_('“肇事者”量产型法术抗性+50'), 'gx_cbrush_1'],
  XM3: [N_('被“肇事者”量产型撞到的干员晕眩1秒'), 'gx_cbrush_2'],
  XN1: [N_('终局突袭与隐秘核心中，每40秒从红门追加1个“交通亭”量产型（不提供奖励）'), 'gx_cbterm_6'],
  XN2: [N_('转入联防的敌人移动速度+30%，生命值+20%'), 'enemy_movespeed_1'],
  XO1: [N_('第14回合领袖多萝西攻击力+{50%|100%}'), ['lydrty_atk1', 'lydrty_atk2']],
  XO2: [N_('多萝西防御力+{300|600}，法术抗性+{20|40}'), ['lydrty_def1', 'lydrty_def2']],
  XO3: [N_('多萝西【部署陷阱】冷却缩短40%，陷阱的晕眩时间+50%'), 'lydrty_skill1'],
  XO4: [N_('第15回合“唤醒”出现后，额外走出{2|4}个Dor-1号失败品（“唤醒”会把一半伤害转给它们）'), 'lysyta_hp1'],
  XO5: [N_('“唤醒”的【破碎愿景】第30秒首次施放，之后每28秒一次'), 'global_lysytc_1'],
  XO6: [N_('“唤醒”进入第二形态时额外唤起1台R-11突击动力装甲{|，所有R-11攻击力+50%}'), ['lyacpa_atk1', 'lyacpa_atk2']],
};