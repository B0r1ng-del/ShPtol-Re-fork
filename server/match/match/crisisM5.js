// 危机合约 · M5 强制拼场 —— 第 6、10 回合正常作战结束后强制两两拼场，40 秒援护战。
//
// 官方文案：第6、10回合正常作战及联防结束后，强制两两拼场进行40秒援护战。每名玩家追加1名固定重甲精英、
// 1名固定术师精英；继承当前状态，不叠层、不发资金；存活人数为奇数时，多出的一名玩家不参加。
//
// 规则拆解：
//   * 只在 rounds 区间内（默认 [6, 10]）；
//   * 无论本回合有没有漏怪，都要拼场（引擎的 planUnite 要求 leakers 非空，所以这里自己造 plan）；
//   * 两两配对：按 seat 顺序两两成组，奇数时最后一人不参加；
//   * 每名参加者追加 1 重甲精英 + 1 术师精英（固定 key，见 M5_ADD）；
//   * 时长 40 秒（fx.M5.dur），不叠层、不发资金 —— 由调用方保证（不进 settle）。
//
// 状态挂在 match 上（m.crisisM5Round），不进 gamedata。

/** M5 每名参加者追加的两名固定精英（重甲 / 术师各一）。 */
export const M5_ADD = Object.freeze(['enemy_1045_hammer_2', 'enemy_1041_lazerd_2']);

/**
 * 本回合是否要强制拼场；要的话返回一个 planUnite 同形的 plan，否则 null。
 * @param {any} m the Match
 * @returns {null | { helpers: any[], leakers: any[], leaked: object[], notReentered: Map<string, number>, forced: true }}
 */
export function planCrisisM5(m) {
  const fx = m && m.gd && m.gd.crisisFx;
  const m5 = fx && fx.M5;
  if (!m5 || typeof m5 !== 'object') return null;
  const rounds = Array.isArray(m5.rounds) ? m5.rounds : [6, 10];
  const round = m.round;
  if (!Number.isFinite(round) || !rounds.includes(round)) return null;
  if (m.isSolo) return null; // 单人没有拼场
  const alive = m.alivePlayers().filter((ps) => !ps.eliminated);
  if (alive.length < 2) return null;
  // 按 seat 两两配对，奇数时最后一人不参加（官方：多出的一名玩家不参加）
  const list = alive.slice().sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  const pairs = [];
  for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  if (!pairs.length) return null;
  const helpers = pairs.map((p) => p[0]);
  const leakers = pairs.map((p) => p[1]);
  // 每名参加者（helper 与被援护者）追加两名固定精英；来源记在 sourcePlayerId 上，便于计分与归属
  const leaked = [];
  for (const ps of [...helpers, ...leakers]) {
    for (const key of M5_ADD) {
      // 用 enemy() 而不是 enemyAny()：拼场波次 buildUniteWave 只认主表（waves.js:672），
      // 放在 enemies-crisis.json 里的 key 会被静默跳过 —— 那等于契约没生效。
      if (!m.gd.enemy(key)) continue;
      leaked.push({ enemyKey: key, mods: null, lpr: 1, sourcePlayerId: ps.playerId, tag: 'crisisM5', bounty: null });
    }
  }
  return { helpers, leakers, leaked, notReentered: new Map(), forced: true };
}
