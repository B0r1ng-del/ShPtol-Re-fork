// 危机合约 · T4 特殊类敌人延迟双入口 —— 当回合「特殊类」敌人中最后 30%（向上取整）改为第 30 秒
// 从两个公开入口同时出生，总数不变。
//
// 官方文案：第{10|8}—13回合，当回合特殊类敌人中最后30%（向上取整）改为在第30秒从两个公开入口同时出生，
// 总数不变[Ⅱ:另追加2名当回合精英位敌人，不提供奖励]。
//
// 规则拆解：
//   * 「特殊类」= 敌人数据的 acType === 'SPECIAL'（数据里 35 个，含 acTypes 同时带 INVISIBLE 的 3 个）；
//   * 「最后 30%」= 按 spawn 的 time 排序后，取尾部 ceil(n*0.3) 个**单位**（不是 spawn 项）；
//   * 「两个公开入口」= 波次模板 routes 的前两个（routeIndex 0 / 1），每个入口分一半，向上取整给第一个；
//   * 「总数不变」= 只改 time 与 routeIndex，count 之和不变；
//   * Ⅱ 档另追加 2 名当回合精英位敌人（不提供奖励）。
//
// 只改 spawn 列表，不动引擎 —— 与 A1/B1 的合约倍率同一个接缝。

/** 一个 spawn 项代表多少个单位（count 缺省 1）。 */
const countOf = (s) => (Number.isFinite(s && s.count) && s.count > 0 ? Math.trunc(s.count) : 1);

/**
 * 把当回合的特殊类敌人重排成「第 30 秒双入口」。
 * @param {any} gd GameData
 * @param {object[]} spawns the round's spawn list (not mutated)
 * @param {object} t4 fx.T4 ({ rounds:[from,to], at:30, ratio:0.3, extra:0 })
 * @param {number} round the round number
 * @returns {object[]} a new list (the same list when T4 does not apply)
 */
export function crisisSpecialSpawns(gd, spawns, t4, round) {
  if (!Array.isArray(spawns) || !t4 || typeof t4 !== 'object') return spawns;
  const rounds = Array.isArray(t4.rounds) ? t4.rounds : [10, 13];
  if (!Number.isFinite(round) || round < rounds[0] || round > rounds[1]) return spawns;
  const at = Number.isFinite(t4.at) && t4.at > 0 ? t4.at : 30;
  // 官方参数的字段名是 share（crisisTag('quad','T4-1') => { rounds:[10,13], share:0.3, at:30 }）
  const ratio = Number.isFinite(t4.share) && t4.share > 0 && t4.share <= 1 ? t4.share : 0.3;
  const isSpecial = (k) => {
    const d = gd.enemyAny ? gd.enemyAny(k) : gd.enemy(k);
    return !!d && (d.acType === 'SPECIAL' || (Array.isArray(d.acTypes) && d.acTypes.includes('SPECIAL')));
  };
  // 展开成单位序列（保留原 spawn 的顺序与字段），只挑特殊类
  const units = [];
  spawns.forEach((s, si) => {
    const k = s && (s.key || s.enemyKey);
    if (!k || !isSpecial(k)) return;
    const n = countOf(s);
    for (let i = 0; i < n; i++) units.push({ si, order: units.length, time: Number.isFinite(s.time) ? s.time : 0 });
  });
  if (!units.length) return spawns;
  // 「最后」= time 大的在后面；同 time 保持原顺序（稳定）
  units.sort((a, b) => (a.time - b.time) || (a.order - b.order));
  const take = Math.ceil(units.length * ratio);
  if (take <= 0) return spawns;
  const tail = units.slice(units.length - take);
  const movedBySi = new Map(); // si -> 要搬走的单位数
  for (const u of tail) movedBySi.set(u.si, (movedBySi.get(u.si) || 0) + 1);
  const out = [];
  spawns.forEach((s, si) => {
    const k = s && (s.key || s.enemyKey);
    const moved = movedBySi.get(si) || 0;
    if (!k || !isSpecial(k) || moved === 0) { out.push(s); return; }
    const n = countOf(s);
    const keep = n - moved;
    if (keep > 0) out.push({ ...s, count: keep });
  });
  // 两个公开入口：routes 的前两个；只有一个入口时都放它（数量不变）
  const routeCount = Math.min(2, Math.max(1, (t4.routes || [0, 1]).length));
  const idxs = Array.isArray(t4.routes) ? t4.routes.slice(0, routeCount) : [0, 1].slice(0, routeCount);
  const perRoute = Math.ceil(take / idxs.length);
  const template = spawns.find((s) => {
    const k = s && (s.key || s.enemyKey);
    return k && isSpecial(k);
  });
  if (!template) return out;
  idxs.forEach((routeIndex, i) => {
    const n = i === idxs.length - 1 ? take - perRoute * (idxs.length - 1) : perRoute;
    if (n <= 0) return;
    out.push({ ...template, time: at, count: n, interval: 0, routeIndex });
  });
  // Ⅱ 档：另追加 extra 名当回合精英位敌人（不提供奖励）—— 取当回合已出现的第一个 ELITE 作模板
  const extra = Number.isFinite(t4.extra) && t4.extra > 0 ? Math.trunc(t4.extra) : 0;
  if (extra > 0) {
    const elite = spawns.find((s) => {
      const k = s && (s.key || s.enemyKey);
      const d = k ? (gd.enemyAny ? gd.enemyAny(k) : gd.enemy(k)) : null;
      return !!d && d.rank === 'ELITE';
    });
    if (elite) {
      idxs.forEach((routeIndex, i) => {
        const n = i === 0 ? extra : 0;
        if (n <= 0) return;
        out.push({ ...elite, time: at, count: n, interval: 0, routeIndex, noReward: true });
      });
    }
  }
  return out;
}
