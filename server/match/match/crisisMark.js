// 危机合约 · R4 精英标记 —— 每回合在自然出现的精英中标记 1 名。
//
// 官方文案：第7—13回合，每回合在自然出现的精英中标记1名（休整期公开），其生命增加25%；
// 首次击倒后，在场干员各获得10点技力并回复10%最大生命。复制体、衍生物不发奖励。
//
// 规则拆解：
//   * 只在 rounds 区间内标记；
//   * 只从**本回合波次里真实存在**的 ELITE 里选（`gd.enemy(key).rank === 'ELITE'`），不凭猜造 key；
//   * 选择是确定的（按 round 做相位），不掷骰子 —— 与 U1 同一条理由；
//   * 标记结果在休整期就写进 ps 视图（公开），战斗侧只读 flag。
//
// 状态挂在 match 上（m.crisisMark），不进 gamedata（那是进程级共享表）。

/**
 * 为这一回合标记一名精英。区间外、或波次里没有 ELITE 时返回 null。
 * @param {any} m the Match
 * @returns {string|null} the marked enemy key, or null
 */
export function pickCrisisMark(m) {
  const fx = m && m.gd && m.gd.crisisFx;
  const r4 = fx && fx.R4;
  if (!r4 || typeof r4 !== 'object') return null;
  const rounds = Array.isArray(r4.rounds) ? r4.rounds : [7, 13];
  const round = m.round;
  if (!Number.isFinite(round) || round < rounds[0] || round > rounds[1]) return null;
  const wave = m.wave;
  if (!wave || !Array.isArray(wave.spawns)) return null;
  // 只认波次里真实存在的 ELITE，且同一 key 只算一次（保持波次顺序 => 确定性）
  const keys = [];
  for (const s of wave.spawns) {
    const k = s && (s.enemyKey || s.key);
    if (typeof k !== 'string' || keys.includes(k)) continue;
    const def = m.gd.enemyAny ? m.gd.enemyAny(k) : m.gd.enemy(k);
    if (!def || def.rank !== 'ELITE') continue;
    // 复制体 / 衍生物不发奖励：它们不在波次的自然出现里，靠 spawn 的 token / summon 标记排除
    if (s.tokenOnly || s.summon || s.copy) continue;
    keys.push(k);
  }
  if (!keys.length) return null;
  const key = keys[round % keys.length];
  m.crisisMark = key;
  return key;
}
