// 危机合约 · U1 承压位 —— 每回合选 1 名玩家为承压位。
//
// 官方文案：第7—13回合，每回合选1名玩家为承压位（休整开始时公开；不连续两回合，每人最多2次），
// 其原战区在第20秒追加2名当回合精英位敌人，不提供奖励。
//
// 规则拆解：
//   * 只在 rounds 区间内选；
//   * 不与上一回合同一个人（"不连续两回合"）；
//   * 每人整局最多 2 次（"每人最多2次"）；
//   * 选择本身是确定的（按 seat 轮转），不掷骰子 —— 官方是"选"，不是随机。
//
// 状态挂在 match 上（m.crisisPressure），不进 gamedata（那是进程级共享表）。

/**
 * 为这一回合选承压位。已在 rounds 区间外、或没有可选人时返回 null。
 * @param {any} m the Match
 * @returns {string|null} the playerId chosen, or null
 */
export function pickCrisisPressure(m) {
  const fx = m && m.gd && m.gd.crisisFx;
  const u1 = fx && fx.U1;
  if (!u1 || typeof u1 !== 'object') return null;
  const rounds = Array.isArray(u1.rounds) ? u1.rounds : [7, 13];
  const round = m.round;
  if (!Number.isFinite(round) || round < rounds[0] || round > rounds[1]) return null;

  const each = Number.isFinite(u1.each) && u1.each > 0 ? u1.each : 2;
  const st = m.crisisPressure || (m.crisisPressure = { last: null, count: {} });
  const alive = m.alivePlayers().filter((ps) => !ps.eliminated);
  if (!alive.length) return null;

  // 按 seat 排序，保证确定性
  const list = alive.slice().sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  const ok = list.filter((ps) => ps.playerId !== st.last && (st.count[ps.playerId] || 0) < each);
  if (!ok.length) return null;
  // 轮转：取上一次之后的下一个（用 round 做相位，保证同一局稳定且不连续）
  const pick = ok[round % ok.length];
  st.last = pick.playerId;
  st.count[pick.playerId] = (st.count[pick.playerId] || 0) + 1;
  return pick.playerId;
}
