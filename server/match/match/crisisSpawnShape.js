// 危机合约 · spawn 列表整形（Q4 方阵成队 / Q9 穿刺手成对）
//
// 这两条的 II 档都只改**出生节奏**，不动引擎、不动单位属性：
//   Q4 II：同一出生点的方阵成员出生间隔缩短 50%（总数不变），成队行进
//   Q9 II：同一出生点两名一组出生（总数不变）
//
// 接缝与 T4 / N2 相同：在 match 层的 spawn 列表上做整形，battle 只读结果。
// 没装对应合约时原样返回**同一个数组引用**，普通房间逐字节不变。

/** Q4 的目标敌人（深池方阵步兵 / 方阵指挥官），取自 crisisTag('quad','Q4-1').route.targets.keys。 */
export const Q4_KEYS = Object.freeze(['enemy_1169_duphlx', 'enemy_1169_duphlx_2']);

/** Q9 的目标敌人（萨卡兹穿刺手）。 */
export const Q9_KEYS = Object.freeze(['enemy_1072_dlancer']);

/** 两条契约的生效回合窗口（route.targets.from / to）。 */
export const Q4_WINDOW = Object.freeze({ from: 4, to: 13 });
export const Q9_WINDOW = Object.freeze({ from: 8, to: 13 });
export const Q8_WINDOW = Object.freeze({ from: 8, to: 13 });

/** Q8 的卫队 / 影刃 key（crisisTag('quad','Q8-1').route.targets.keys）。 */
export const Q8_GUARD_KEYS = Object.freeze(['enemy_1174_duholy_2']);
export const Q8_BLADE_KEYS = Object.freeze(['enemy_1175_dushdo_2']);

/** 一条 spawn 代表多少个单位（count 缺省 1）。 */
const countOf = (s) => (Number.isFinite(s && s.count) && s.count > 0 ? Math.trunc(s.count) : 1);

/** 取这条 spawn 的敌人 key（两种字段名都认）。 */
const keyOf = (s) => (s && (s.key || s.enemyKey)) || null;

/**
 * 回合是否落在契约窗口内。
 * 窗口来自 route.targets 的 from/to（不是 fx 参数 —— fx 只有效果参数），
 * 由调用方通过 WINDOW 传入，缺省不限制。
 */
const inWindow = (win, round) => {
  if (!win || typeof win !== 'object') return true;
  const from = Number.isFinite(win.from) ? win.from : 0;
  const to = Number.isFinite(win.to) ? win.to : 99;
  return Number.isFinite(round) && round >= from && round <= to;
};

/**
 * Q4 方阵 II 档：把目标敌人按**出生点（routeIndex）分组**，同组内的出生间隔乘 `squad`（默认 0.5）。
 * 总数不变 —— 只压 interval。
 * @param {object[]} spawns
 * @param {object} q4 fx.Q4 ({ def, squad })
 * @param {string[]} keys 目标敌人 key
 * @param {number} round
 * @returns {object[]}
 */
export function crisisSquadSpawns(spawns, q4, keys, round, window = null) {
  if (!Array.isArray(spawns) || !q4 || typeof q4 !== 'object') return spawns;
  const mul = Number.isFinite(q4.squad) && q4.squad > 0 && q4.squad < 1 ? q4.squad : 0;
  if (mul <= 0) return spawns; // I 档没有 squad 字段 => 原样
  if (!inWindow(window, round)) return spawns;
  const want = new Set(Array.isArray(keys) ? keys : []);
  if (!want.size) return spawns;
  let touched = false;
  const out = spawns.map((s) => {
    if (!want.has(keyOf(s))) return s;
    if (!Number.isFinite(s.interval) || s.interval <= 0) return s;
    touched = true;
    return { ...s, interval: s.interval * mul };
  });
  return touched ? out : spawns;
}

/**
 * Q9 穿刺手 II 档：生命 +20%（走 spawn 的 mods，和 A1/B1 同一通道）+ 同一出生点两名一组出生。
 * 「两名一组」= 把一条 count=N 的 spawn 拆成 ceil(N/2) 条、每条 count=2（末条可能是 1），
 * interval 按组数重算，使**总时长不变**；总数严格不变。
 * @param {object[]} spawns
 * @param {object} q9 fx.Q9 ({ move, hp, pairs })
 * @param {string[]} keys 目标敌人 key
 * @param {number} round
 * @returns {object[]}
 */
export function crisisPairSpawns(spawns, q9, keys, round, window = null) {
  if (!Array.isArray(spawns) || !q9 || typeof q9 !== 'object') return spawns;
  const hpMul = Number.isFinite(q9.hp) && q9.hp > 0 ? 1 + q9.hp : 0;
  const pairs = q9.pairs === true;
  if (!pairs && hpMul <= 0) return spawns;
  if (!inWindow(window, round)) return spawns;
  const want = new Set(Array.isArray(keys) ? keys : []);
  if (!want.size) return spawns;
  let touched = false;
  const out = [];
  for (const s of spawns) {
    if (!want.has(keyOf(s))) { out.push(s); continue; }
    const n = countOf(s);
    // 生命 +20%：走 mods.maxHpMul（spawns.js 已支持的通道）
    const mods = hpMul > 0 ? { ...(s.mods || {}), maxHpMul: (s.mods && Number.isFinite(s.mods.maxHpMul) ? s.mods.maxHpMul : 1) * hpMul } : s.mods;
    if (!pairs || n <= 2) { out.push(mods === s.mods ? s : { ...s, mods }); touched = touched || mods !== s.mods; continue; }
    // 两名一组：拆成 ceil(n/2) 条，每条 2 个（末条 1 个）；interval 按组数重算，总时长不变
    touched = true;
    const groups = Math.ceil(n / 2);
    const totalSpan = (Number.isFinite(s.interval) ? s.interval : 0) * Math.max(0, n - 1);
    const step = groups > 1 ? totalSpan / (groups - 1) : 0;
    const t0 = Number.isFinite(s.time) ? s.time : 0;
    for (let gi = 0; gi < groups; gi++) {
      const c = gi === groups - 1 && n % 2 === 1 ? 1 : 2;
      out.push({ ...s, mods, time: t0 + step * gi, count: c, interval: 0 });
    }
  }
  return touched ? out : spawns;
}

/**
 * Q8 Ⅱ 档：精英位的卫队与影刃**同点、同时**出生。
 * 做法：找出每条影刃 spawn，把它对齐到**同出生点上最近的卫队 spawn**的 time / routeIndex；
 * 找不到配对卫队时原样保留（不编造）。总数不变。
 * @param {object[]} spawns
 * @param {object} q8 fx.Q8 ({ radius, cut, together })
 * @param {string[]} guardKeys 卫队 key
 * @param {string[]} bladeKeys 影刃 key
 * @param {number} round
 * @param {object|null} window
 * @returns {object[]}
 */
export function crisisTogetherSpawns(spawns, q8, guardKeys, bladeKeys, round, window = null) {
  if (!Array.isArray(spawns) || !q8 || q8.together !== true) return spawns;
  if (!inWindow(window, round)) return spawns;
  const guards = new Set(Array.isArray(guardKeys) ? guardKeys : []);
  const blades = new Set(Array.isArray(bladeKeys) ? bladeKeys : []);
  if (!guards.size || !blades.size) return spawns;
  // 同出生点上的卫队锚点：{ routeIndex, time }
  const anchors = spawns
    .filter((s) => guards.has(keyOf(s)) && !s.tokenOnly && !s.summon)
    .map((s) => ({ routeIndex: s.routeIndex, time: Number.isFinite(s.time) ? s.time : 0 }));
  if (!anchors.length) return spawns;
  let touched = false;
  const out = spawns.map((s) => {
    if (!blades.has(keyOf(s))) return s;
    // 优先同 routeIndex 的锚点，其次全局最近的锚点
    const same = anchors.filter((a) => a.routeIndex === s.routeIndex);
    const pool = same.length ? same : anchors;
    const t = Number.isFinite(s.time) ? s.time : 0;
    let best = pool[0];
    for (const a of pool) { if (Math.abs(a.time - t) < Math.abs(best.time - t)) best = a; }
    if (s.time === best.time && s.routeIndex === best.routeIndex) return s;
    touched = true;
    return { ...s, time: best.time, routeIndex: best.routeIndex };
  });
  return touched ? out : spawns;
}
