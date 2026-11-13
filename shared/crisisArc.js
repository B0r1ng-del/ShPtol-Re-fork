import { N_ } from './i18n.js';
// shared/crisisArc.js — 危机合约「弧光作战」(season `arc1`, 2026-11-05; design: 弧光作战-指标设计.md): the contract's tags
// as rules, its enemy schedule and its fixed map. Pure ESM (server + browser). shared/crisis.js hands every selection
// with `season: 'arc'` to this file (checkCrisis / crisisRules / isCrisisSelection), so the lobby, the match and the event
// page read one table; the page (js/ui/crisisArcTags.js) keeps the texts and the icons.
//
// A selection is { season: 'arc', mode: 'solo' | 'quad', tags: ['XA1-2', …] } — a route id (X + group letter + digit) and
// a 1-based tier. Every tag is worth 1, 2 or 3 (its risk); anything that does not conflict stacks, and the only conflict
// is two tiers of one route. Every enemy of the season appears in every match (ARC_ROSTER), so no route needs targets.
//
// crisisRules compiles a selection into `fx`: a route that reuses a mechanic of 重燃作战 writes that route's key
// (`use: 'B1'` → fx.B1 = { atk }: the match and the battle already act on it), a new one writes `fx.arc[name]`
// (`use: 'arc.weight'` → fx.arc.weight = { add }) for server/match-twenty-20261023/crisisArc.js and server/sim/crisisArc.js.
//
// The seed (开局种子) decides the enemy schedule only (arcSchedule: which group each round brings, and the leader); the
// match's own seed — shops, 机变, strategies, banned bonds, every reward — is drawn fresh for every match (the owner,
// 2026-11-05: 「种子只影响当前对局的出怪顺序，不影响商店和策略随机带来的奖励」).

// ★ stage 是官方弧光作战的专属战场 id（custom_cc4_focus），本项目**没有这份地图数据**（data/stages.json 里
//   只有 act1/act2autochess_m*），所以 gd.stage(ARC_SEASON.stage) 恒为 falsy。这不是错误：官方 UI 同样把它
//   当占位，地图名一律走 stageName 兜底（public/js/ui/crisisSelect.js:225「危机合约 滞空焦点」）。
export const ARC_SEASON = Object.freeze({
  id: 'arc1', key: 'arc', name: N_('弧光作战'),
  stage: 'custom_cc4_focus', stageName: N_('危机合约 滞空焦点'),
});
export const ARC_MODES = Object.freeze(['solo', 'quad']);
/**
 * 弧光作战的两个**固定**领袖（data/bosses.json 的 id）：第 14 回合多萝西、第 15 回合“唤醒”（打赢 14 必定进入）。
 * 它们由 tools/fork-arc-leaders.mjs 经 FORK_APPLIERS 写入 —— 官方 autoChessData.bossInfoDict 只有 boss_1..boss_10，
 * 这两个是危机合约 #4 独有的内容。server/match/waves.js 的 arcWaves 用它们，**不走 bossWeights 的加权随机**。
 */
export const ARC_LEADER_ID = 'boss_arc1';
export const ARC_HIDDEN_ID = 'boss_arc2';
export const ARC_GROUPS = Object.freeze({
  A: N_('源石环境'), B: N_('应变'), C: N_('调遣'), D: N_('洞察'), E: N_('重力调控'), F: N_('场地管制'), G: N_('应急合约'),
  H: N_('弧光锋卫'), I: N_('弧光镜卫'), J: N_('“交通亭”量产型'), K: N_('“十字路口”量产型'), L: N_('莱茵生命高级工程科成员'), M: N_('“肇事者”量产型'), N: N_('终局与联防'),
  O: N_('多萝西与“唤醒”'),
});

/** Enemy keys (data/enemies.json). */
export const ARC_KEYS = Object.freeze({
  hound: 'enemy_1325_cbgpro', hound2: 'enemy_1325_cbgpro_2', guard: 'enemy_1326_cbagen', police: 'enemy_1333_cbbgen',
  jedi: 'enemy_1328_cbjedi', jedi2: 'enemy_1328_cbjedi_2', shld: 'enemy_1329_cbshld', shld2: 'enemy_1329_cbshld_2',
  eng: 'enemy_1250_lyengs_2', rush: 'enemy_1330_cbrush', sisy: 'enemy_1331_cbsisy', term: 'enemy_1332_cbterm',
});
const K = ARC_KEYS;
/** 量产型机械 (技术支援 repairs them). */
export const ARC_MACHINES = Object.freeze([K.term, K.sisy, K.rush]);

/**
 * The season's enemy groups: a round brings one — its feature (special slot), a normal and an elite. Early groups fill
 * rounds 1–7 (each at least once, two more drawn, never the same twice running), late groups rounds 8–13 (each once);
 * the leader rounds' escorts (14, 15) come from the late groups.
 */
export const ARC_ROSTER = Object.freeze({
  early: Object.freeze([
    { id: 'patrol', name: N_('巡逻队'), key: K.guard, normal: K.hound, elite: K.jedi },
    { id: 'hounds', name: N_('猎犬'), key: K.hound2, normal: K.hound, elite: K.guard },
    { id: 'blades', name: N_('锋卫'), key: K.jedi, normal: K.guard, elite: K.shld },
    { id: 'traffic', name: N_('交警'), key: K.police, normal: K.guard, elite: K.jedi },
    { id: 'rhine', name: N_('技术支援'), key: K.eng, normal: K.hound, elite: K.shld },
  ].map(Object.freeze)),
  late: Object.freeze([
    { id: 'mirror', name: N_('镜卫'), key: K.shld, normal: K.hound2, elite: K.jedi2 },
    { id: 'rush', name: N_('肇事者'), key: K.rush, normal: K.guard, elite: K.shld },
    { id: 'term', name: N_('交通亭'), key: K.term, normal: K.police, elite: K.jedi2 },
    { id: 'cross', name: N_('十字路口'), key: K.sisy, normal: K.hound2, elite: K.eng },
    { id: 'mirror2', name: N_('镜卫长'), key: K.shld2, normal: K.guard, elite: K.rush },
    { id: 'blade2', name: N_('锋卫长'), key: K.jedi2, normal: K.police, elite: K.shld2 },
  ].map(Object.freeze)),
});

/** 32-bit PRNG of the schedule (mulberry32; shared by the lobby preview and the match, nothing else draws from it). */
function scheduleRng(seed) {
  let a = (Number(seed) >>> 0) ^ 0x5a17c4e1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (rng, list) => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };

/**
 * The enemy schedule of a seed: picks[r] = { type: 'SPECIAL', key, normal, elite, fly: false, group, name } for r = 1 … 15
 * (index 0 empty), the same shape as server/match waves.js setupMatchWaves' picks. `leader` = an index into the mode's
 * leader list (the match draws its leader with it).
 */
export function arcSchedule(seed) {
  const rng = scheduleRng(seed);
  const early = shuffle(rng, ARC_ROSTER.early.slice());
  while (early.length < 7) {
    const last = early[early.length - 1];
    const options = ARC_ROSTER.early.filter((g) => g !== last);
    early.push(options[Math.floor(rng() * options.length)]);
  }
  // the two extra early groups go somewhere inside the first seven rounds, never next to the same group
  for (let tries = 0; tries < 20; tries++) {
    shuffle(rng, early);
    if (early.every((g, i) => i === 0 || early[i - 1] !== g)) break;
  }
  const late = shuffle(rng, ARC_ROSTER.late.slice());
  const escort = shuffle(rng, ARC_ROSTER.late.slice());
  const pick = (g) => Object.freeze({ type: 'SPECIAL', key: g.key, normal: g.normal, elite: g.elite, fly: false, group: g.id, name: g.name });
  const picks = [null, ...early.map(pick), ...late.map(pick), pick(escort[0]), pick(escort[1])];
  return { picks, leader: rng(), hidden: rng() };
}

/** A weighted pick by a schedule draw `u` ∈ [0, 1): pairs [[id, weight], …] (the match's leader lists). */
export function arcWeighted(pairs, u) {
  const list = (Array.isArray(pairs) ? pairs : []).filter((p) => Array.isArray(p) && Number(p[1]) > 0);
  const sum = list.reduce((n, p) => n + Number(p[1]), 0);
  let x = Math.max(0, Math.min(0.999999, Number(u) || 0)) * sum;
  for (const [id, w] of list) { x -= Number(w); if (x < 0) return id; }
  return list.length ? list[list.length - 1][0] : null;
}

/**
 * Fixed tiles of 气密检修 / 磁性约束 on the 滞空焦点 board ([row, col], a player's own field — rows 9–13): the
 * crossing of both lanes and the shared corridor first, then the lanes' middles (ground); the high tiles between the
 * lanes first (high).
 */
export const ARC_SEALS = Object.freeze({
  ground: Object.freeze([[11, 9], [11, 3], [10, 6], [12, 6]]),
  high: Object.freeze([[11, 7], [13, 5], [11, 6], [9, 4]]),
});

/** 值守口令: the engineers' posts on a normal field (the last tiles of both lanes before the blue gate) and the gate. */
export const ARC_POSTS = Object.freeze({ tiles: Object.freeze([[11, 2], [10, 3]]), end: Object.freeze([9, 1]) });

const t2 = (a, b) => [a, b];
const t3 = (a, b, c) => [a, b, c];
/** 应急合约's profession pairs (the pairs of the game's own icons: char_cost_casterspecial / sniperguard / healerdefender). */
const PROF = Object.freeze({ cs: ['CASTER', 'SPECIAL'], sg: ['SNIPER', 'WARRIOR'], mt: ['MEDIC', 'TANK'] });

/**
 * Routes: [id, name, solo risks | null, quad risks | null, tiers (one params object per tier; a single object = every
 * tier; a function (mode) => params), use (the fx key it writes)].
 */
const ROWS = [
  // 一、源石环境（敌方）
  ['XA1', N_('刺激'), [1, 2, 3], [1, 2, 3], t3({ atk: 0.2 }, { atk: 0.4 }, { atk: 0.6 }), 'B1'],
  ['XA2', N_('活性'), [1, 2, 3], [1, 2, 3], t3({ hp: 0.25 }, { hp: 0.5 }, { hp: 0.8 }), 'A1'],
  ['XA3', N_('硬化'), [1, 2], [1, 2], t2({ cut: 0.2 }, { cut: 0.35 }), 'arc.physGuard'],
  ['XA4', N_('干扰'), [1, 2], [1, 2], t2({ cut: 0.2 }, { cut: 0.35 }), 'arc.artsGuard'],
  ['XA5', N_('反装甲'), [1, 2], [1, 2], t2({ def: 200, res: 0 }, { def: 400, res: 0 }), 'C1'],
  ['XA6', N_('超重'), [1, 2], [1, 2], t2({ add: 1 }, { add: 2 }), 'arc.weight'],
  // 二、应变（我方）
  ['XB1', N_('阻力'), [1, 2], [1, 2], t2({ aspd: 10 }, { aspd: 20 }), 'arc.drag'],
  ['XB2', N_('萎缩'), [1, 2], [1, 2], t2({ hp: 0.2 }, { hp: 0.3 }), 'arc.atrophy'],
  ['XB3', N_('偏向力'), [1, 2], [1, 2], t2({ atk: 0.15 }, { atk: 0.25 }), 'arc.deflect'],
  // 三、调遣（作战中的部署）
  ['XC1', N_('深度渗透'), [1, 2], [1, 2], t2({ cut: 0.2 }, { cut: 0.35 }), 'arc.dpRegen'],
  ['XC2', N_('泄压准备'), [1, 2], [1, 2], t2({ dp: 3 }, { dp: 5 }), 'arc.deployTax'],
  ['XC3', N_('效率低下'), [1], [1], { mul: 1.75 }, 'arc.redeploy'],
  ['XC4', N_('交战区'), [2, 3], [2, 3], t2({ cap: 7 }, { cap: 6 }), 'K1'],
  ['XC5', N_('最后防线'), [1, 3], [1, 3], t2({ cap: 12 }, { cap: 5 }), 'O1'],
  // 四、洞察（休整期）
  ['XD1', N_('隐秘行动'), [1, 2], [1, 2], t2({ hand: 8 }, { hand: 6 }), 'M1'],
  ['XD2', N_('预算削减'), [1, 2, 3], [1, 2, 3], t3({ from: 7, cut: 1 }, { from: 7, cut: 2 }, { from: 7, cut: 3 }), 'G1'],
  ['XD3', N_('频率限制'), [1, 2], [1, 2], t2({ from: 4, cap: 8 }, { from: 4, cap: 5 }), 'H1'],
  ['XD4', N_('成长迟滞'), [1, 2], [1, 2], t2({ mul: 0.8 }, { mul: 0.6 }), 'I1'],
  ['XD5', N_('精锐限额'), [2, 3], [2, 3], t2({ cap: 4 }, { cap: 3 }), 'J3'],
  // 五、重力调控（滞空焦点）
  ['XE1', N_('初始重力'), [1], [1], { side: 'LEFT', lock: 15 }, 'arc.gravStart'],
  ['XE2', N_('漂浮'), [2], [2], { ally: 3, enemy: 3 }, 'arc.gravFloat'],
  ['XE3', N_('重力紊乱'), [1, 2], [1, 2], t2({ from: 20, every: 30 }, { from: 20, every: 20 }), 'arc.gravFlip'],
  ['XE4', N_('惯性阻尼'), [2], [2], { k: 0.5 }, 'arc.gravDamp'],
  ['XE5', N_('失重偏转'), [1], [1], { aspd: 15 }, 'arc.gravSkew'],
  // 六、场地管制
  ['XF1', N_('气密检修'), [1, 2], [1, 2], t2({ n: 2 }, { n: 4 }), 'arc.sealGround'],
  ['XF2', N_('磁性约束'), [1, 2], [1, 2], t2({ n: 2 }, { n: 4 }), 'arc.sealHigh'],
  // 七、应急合约（职业）
  ['XG1', N_('术特加急'), [1], [1], { profs: PROF.cs, mul: 2 }, 'arc.priceSpecial'],
  ['XG2', N_('狙卫加急'), [2], [2], { profs: PROF.sg, mul: 2 }, 'arc.priceCs'],
  ['XG3', N_('医重加急'), [2], [2], { profs: PROF.mt, mul: 2 }, 'arc.priceWt'],
  ['XG4', N_('骨质流失'), [1], [1], { prof: 'WARRIOR', dur: 10, loss: 0.04 }, 'arc.boneLoss'],
  ['XG5', N_('负荷超限'), [1], [1], { prof: 'TANK', stun: 8 }, 'arc.overload'],
  ['XG6', N_('免疫减退'), [1], [1], { prof: 'MEDIC', dur: 15, aspd: 40 }, 'arc.immune'],
  ['XG7', N_('血运阻塞'), [1], [1], { prof: 'PIONEER', dur: 10, atk: 0.75 }, 'arc.blood'],
  // 八、弧光锋卫
  ['XH1', N_('晋升'), [1], [1], {}, 'arc.jediPromote'],
  ['XH2', N_('配重'), [1, 2], [1, 2], t2({ weight: 1 }, { weight: 2 }), 'arc.jediWeight'],
  ['XH3', N_('激进'), [1], [1], { atk: 1 }, 'arc.jediAtk'],
  ['XH4', N_('稳固'), [1], [1], { def: 1, hp: 0.5 }, 'arc.jediTough'],
  // 九、弧光镜卫
  ['XI1', N_('内稳态'), [1], [1], { keep: 0.5 }, 'arc.shldHomeo'],
  ['XI2', N_('神经活跃'), [1], [1], { cut: 0.5, weight: 2 }, 'arc.shldNerve'],
  ['XI3', N_('激进'), [1], [1], { atk: 1.5 }, 'arc.shldAtk'],
  ['XI4', N_('稳固'), [1], [1], { hp: 1.5 }, 'arc.shldHp'],
  // 十、“交通亭”量产型
  ['XJ1', N_('交通管制'), [2], [2], { from: 8, n: 2 }, 'arc.termPark'],
  ['XJ2', N_('出厂标准'), [1], [1], { max: 70 }, 'arc.termSpec'],
  ['XJ3', N_('计划报废'), [1], [1], { mul: 1.5 }, 'arc.termBoom'],
  ['XJ4', N_('火控升级'), [1], [1], { atk: 0.5 }, 'arc.termAtk'],
  ['XJ5', N_('稳固装甲'), [2], [2], { hp: 2, def: 0.5 }, 'arc.termArmor'],
  ['XJ6', N_('固件更新'), [2], [2], { hp: 0.5 }, 'arc.termReboot'],
  ['XJ7', N_('违章清障'), [1], [1], { coins: 1, lp: 3 }, 'arc.termBounty'],
  // 十一、“十字路口”量产型
  ['XK1', N_('磁性底座'), [1], [1], { weight: 2 }, 'arc.sisyWeight'],
  ['XK2', N_('南北管制'), [1, 2], [1, 2], t2({ from: 8, gates: ['low'] }, { from: 8, gates: ['low', 'high'] }), 'arc.sisyPatrol'],
  ['XK3', N_('稳固内核'), [1], [1], { hp: 2 }, 'arc.sisyCore'],
  ['XK4', N_('稳固外壳'), [2], [2], { def: 1, res: 40 }, 'arc.sisyShell'],
  ['XK5', N_('阻力优化'), [1], [1], { move: 0.5 }, 'arc.sisyMove'],
  ['XK6', N_('充能激光'), [2], [2], { atk: 3 }, 'arc.sisyAtk'],
  ['XK7', N_('全向信号'), [2], [2], { range: 3 }, 'arc.sisyBeam'],
  // 十二、莱茵生命高级工程科成员
  ['XL1', N_('值守口令'), [1], [1], { n: 2, hold: 30 }, 'arc.engGuard'],
  ['XL2', N_('开火口令'), [2], [2], { range: 2, atk: 1 }, 'arc.engFire'],
  ['XL3', N_('技术支援'), [1], [1], { every: 20, radius: 2, heal: 0.1 }, 'arc.engRepair'],
  // 十三、“肇事者”量产型
  ['XM1', N_('伪装防护'), [1], [1], {}, 'arc.rushStealth'],
  ['XM2', N_('术能隔离'), [1], [1], { res: 50 }, 'arc.rushRes'],
  ['XM3', N_('连环事故'), [2], [2], { stun: 1 }, 'arc.rushStun'],
  // 十四、终局与联防
  ['XN1', N_('终局管制'), [2], [2], { every: 40 }, 'arc.finalTerm'],
  ['XN2', N_('拥堵外溢'), null, [2], { move: 0.3, hp: 0.2 }, 'arc.uniteRush'],
  // 十五、多萝西与“唤醒”（第 14 / 15 回合的领袖，2026-11-06；server/sim/content/bosses.js kitDorothy / kitWake 读这些）
  ['XO1', N_('理想之力'), [1, 2], [1, 2], t2({ atk: 0.5 }, { atk: 1 }), 'arc.dorAtk'],
  ['XO2', N_('坚定意志'), [1, 2], [1, 2], t2({ def: 300, res: 20 }, { def: 600, res: 40 }), 'arc.dorDef'],
  ['XO3', N_('精密布置'), [2], [2], { cd: 0.6, stun: 1.5 }, 'arc.dorTrap'],
  ['XO4', N_('共同梦境'), [1, 2], [1, 2], t2({ n: 2 }, { n: 4 }), 'arc.wakeBodies'],
  ['XO5', N_('破碎愿景'), [2], [2], { icd: 30, cd: 28 }, 'arc.wakeVision'],
  ['XO6', N_('R系列激活'), [1, 2], [1, 2], t2({ n: 1, atk: 0 }, { n: 1, atk: 0.5 }), 'arc.wakeArmour'],
];

/** id → { id, g, name, risk: { solo, quad }, use, params(mode, tier) } */
export const ARC_ROUTES = Object.freeze(Object.fromEntries(ROWS.map(([id, name, solo, quad, tiers, use]) => [id, Object.freeze({
  id, g: id[1], name, risk: Object.freeze({ solo: solo && Object.freeze(solo), quad: quad && Object.freeze(quad) }), use,
  needs: null, targets: null,
  params(mode, tier) {
    const t = typeof tiers === 'function' ? tiers(mode) : tiers;
    return { ...(Array.isArray(t) ? t[tier - 1] : t) };
  },
})])));

const ARC_TAG_RE = /^(X[A-O][1-9])-([1-3])$/;
export const isArcTagId = (id) => typeof id === 'string' && ARC_TAG_RE.test(id);

/** A tag id of a mode: { id, route, tier, lv } or null when the route / tier is not offered there. */
export function arcTag(mode, id) {
  const m = typeof id === 'string' ? ARC_TAG_RE.exec(id) : null;
  const route = m ? ARC_ROUTES[m[1]] : null;
  const risks = route && ARC_MODES.includes(mode) ? route.risk[mode] : null;
  const tier = m ? Number(m[2]) : 0;
  if (!risks || tier < 1 || tier > risks.length) return null;
  return { id, route, tier, lv: risks[tier - 1] };
}

/** Two tags that cannot be picked together: two tiers of one route. */
export const arcConflict = (a, b) => !!a && !!b && a.id !== b.id && a.route === b.route;

/** A 32-bit 开局种子 (1 … 2³²−1). */
const isSeed = (v) => Number.isInteger(v) && v > 0 && v <= 0xffffffff;

/**
 * The checked form of an arc selection, or null when it is malformed, names a tag the mode does not offer, repeats one or
 * holds a conflict. Tags come back sorted; `total` = Σ risk; a `waveSeed` (the room's seed, set by the lobby when the
 * match starts) is kept.
 * @returns {{ season: 'arc', mode: 'solo'|'quad', tags: string[], total: number, waveSeed?: number } | null}
 */
export function checkArc(sel) {
  if (!sel || typeof sel !== 'object' || Array.isArray(sel) || sel.season !== 'arc') return null;
  const { mode, tags } = sel;
  if (!ARC_MODES.includes(mode) || !Array.isArray(tags) || tags.length > ROWS.length) return null;
  const picked = [];
  for (const id of tags) {
    const t = arcTag(mode, id);
    if (!t || picked.some((p) => p.id === id || arcConflict(p, t))) return null;
    picked.push(t);
  }
  picked.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { season: 'arc', mode, tags: picked.map((t) => t.id), total: picked.reduce((n, t) => n + t.lv, 0),
    ...(isSeed(sel.waveSeed) ? { waveSeed: sel.waveSeed } : {}) };
}

/** Wire check of room.create's `crisis` field for the season (shared/protocol.js via shared/crisis.js). */
export function isArcSelection(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && v.season === 'arc' && ARC_MODES.includes(v.mode)
    && Array.isArray(v.tags) && v.tags.length <= ROWS.length && v.tags.every(isArcTagId)
    && (v.seed == null || isSeed(v.seed)) && (v.waveSeed == null || isSeed(v.waveSeed));
}

/**
 * The rules of an arc selection: { season, mode, tags, total, waveSeed?, fx } — fx[key] = a reused route's numbers,
 * fx.arc[name] = a new mechanic's numbers (+ `tier` each) — or null when the selection does not check.
 */
export function arcRules(sel) {
  const c = checkArc(sel);
  if (!c) return null;
  const fx = { arc: {} };
  for (const id of c.tags) {
    const t = arcTag(c.mode, id);
    const p = { ...t.route.params(c.mode, t.tier), tier: t.tier, route: t.route.id };
    if (t.route.use.startsWith('arc.')) fx.arc[t.route.use.slice(4)] = p;
    else fx[t.route.use] = p;
  }
  return { ...c, fx };
}

/** Max total of a mode (every route at its top tier). */
export function arcMaxTotal(mode) {
  return Object.values(ARC_ROUTES).reduce((n, r) => n + (r.risk[mode] ? r.risk[mode][r.risk[mode].length - 1] : 0), 0);
}
