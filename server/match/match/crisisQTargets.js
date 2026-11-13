
// 危机合约 · Q 敌群异变 — which enemy a route names, and what it does to that enemy.
//
// Every Q route's official text names its targets explicitly (js/ui/crisisTags.js FX table), so the mapping is DATA,
// not a guess: `enemyKey` here are real keys from data/enemies.json (verified against that file, 249 records).
//
// Only the routes whose numbers can be expressed as this engine's per-spawn multipliers are installed; the rest name a
// radius, an aura amplitude, a revive cadence or a spawn pattern that a multiplier cannot carry, and are reported as
// gaps by crisisFx (never faked).

/** Q route → the enemy keys it names, plus what the number means. */
export const CRISIS_Q_TARGETS = Object.freeze({
  // Q1 寒潮编队: 寒霜生命增加30% — hpMul (the aura radius / aspd amplitude are that unit's own content fields)
  Q1: { keys: ['enemy_1042_frostd'], mul: 'hpMul', field: 'hp' },
  // Q9 穿刺突进: 生命增加20% (二档起) — hpMul
  Q9: { keys: ['enemy_1072_dlancer'], mul: 'hpMul', field: 'hp' },
});

/**
 * The per-spawn multipliers a contract puts on the enemies it NAMES BY KEY (the Q group).
 *
 * A Q route applies only to its own enemy types, unlike A1/B1 which hit every enemy — so this is keyed off the spawn's
 * own `enemyKey`, and a spawn that is not named keeps its untouched `mods`.
 *
 * @param {Record<string, any>|null|undefined} fx
 * @param {string} enemyKey
 * @returns {{ hpMul?: number }} the multipliers for THIS enemy (empty when no Q route names it)
 */
export function crisisNamedEnemyMul(fx, enemyKey) {
  if (!fx || typeof fx !== 'object' || typeof enemyKey !== 'string') return {};
  const out = {};
  for (const [id, rule] of Object.entries(CRISIS_Q_TARGETS)) {
    const e = fx[id];
    if (!e || typeof e !== 'object' || !rule.keys.includes(enemyKey)) continue;
    const v = e[rule.field];
    if (!Number.isFinite(v)) continue;
    out[rule.mul] = (out[rule.mul] ?? 1) * (1 + v);
  }
  return out;
}
