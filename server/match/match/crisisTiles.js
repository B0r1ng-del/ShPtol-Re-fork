// server/match/match/crisisTiles.js — 危机合约 K2 封锁地带的选格。
//
// 文案：「第1回合休整开始时公开1个地面格、1个高台格，整局封锁，同一局所有玩家相同，由开局种子决定；
//        开局即封锁，不会把干员移出棋盘。」
//
// ★ 不新造封锁机制：选中格子写进 PlayerState.tileOverrides（board.js:130 会把它强制成 'none'，
//   该格从此不进部署图）。选格用 deriveSeed(seed, 'crisis:K2') —— 同一局所有玩家同种子 ⇒ 同两格。
// ★ 开局即封锁：调用点在 LOBBY（Match 构造，棋盘还是空的），所以不存在"把干员移出棋盘"。

import { buildDeployMap } from '../board.js';
import { createRng, deriveSeed } from '../../sim/rng.js';

/**
 * Pick the two tiles K2 seals: one melee tile and one ranged tile of the stage's default deploy map.
 * Pure — no PlayerState is touched, so a caller can compute the answer before applying it.
 * @returns {{ tiles: string[], melee: string[], ranged: string[] }}
 */
export function pickCrisisBannedTiles(stage, seed) {
  const base = buildDeployMap(stage, {});
  const melee = [], ranged = [];
  for (const [k, cls] of base) (cls === 'melee' ? melee : ranged).push(k);
  // sorted, so the same seed always indexes the same tile (Map order is insertion order, not a contract)
  melee.sort();
  ranged.sort();
  const rng = createRng(deriveSeed(seed, 'crisis:K2'));
  const pick = (arr) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))] : null);
  const tiles = [pick(melee), pick(ranged)].filter(Boolean);
  return { tiles, melee, ranged };
}

/** Apply the K2 seals to every player of a match (all players see the same two tiles). */
export function applyCrisisBannedTiles(match, stage, seed) {
  const { tiles } = pickCrisisBannedTiles(stage, seed);
  if (!tiles.length) return [];
  for (const ps of match.order || []) {
    for (const k of tiles) ps.tileOverrides[k] = 'none';
  }
  return tiles;
}
