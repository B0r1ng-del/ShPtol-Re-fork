// render/bench.js — the hand / temp bench rows of the board (stage rows 'a' / 'A').
//
// The official board keeps ten 手牌 pads on row 7 and five 临时格 on row 8 (cols 4..8); GEO.HAND_SIZE is the configured
// hand size and may be larger, in which case the extra pads sit in the free corners of the bench rows. board3d/layout.js
// asks benchGlyph() per tile, so an expanded hand still draws as bench pads instead of bare floor.
//
// Copied from the reference implementation's render/bench.js (the crisis-contract fork draws the same board).
import { GEO } from '../../../shared/constants.js';

/** Tile of hand slot `idx` → { row, col }. */
export function handTile(idx, geo = GEO) {
  const extra = Math.max(0, geo.HAND_SIZE - 10);
  return idx < extra ? { row: geo.TEMP_ROW, col: idx } : { row: geo.HAND_ROW, col: idx - extra };
}

/** Inverse of handTile: `null` when (row, col) is not a hand pad. */
export function handIndex(row, col, geo = GEO) {
  const extra = Math.max(0, geo.HAND_SIZE - 10);
  if (row === geo.HAND_ROW && col >= 0 && col < Math.min(10, geo.HAND_SIZE)) return col + extra;
  if (row === geo.TEMP_ROW && col >= 0 && col < extra) return col;
  return null;
}

/**
 * The bench glyph the expanded hand adds at (row, col), or null. Only when HAND_SIZE > 10 (the official ten pads are
 * already in the stage rows); the extra pads go to the temp row and to the corners of row 1 beside the equipment bench.
 */
export function benchGlyph(rows, row, col) {
  const extra = Math.max(0, GEO.HAND_SIZE - 10);
  if (!extra) return null;
  if (row === GEO.TEMP_ROW && col >= 0 && col < extra && rows[GEO.HAND_ROW]?.includes('a')) return 'a';
  if (row === 1 && rows[0]?.includes('a') && ((col >= 0 && col < extra) || (col > 20 - extra && col <= 20))) return 'a';
  return null;
}

/** Board point of a hand unit (`{ area: 'hand', x, y }`), or null. */
export function handUnitPoint(unit, side = null) {
  if (unit?.area !== 'hand') return null;
  if (unit.y === GEO.HAND_ROW) { const p = handTile(unit.x); return { x: p.col, y: p.row }; }
  if (unit.y === 0 && (side === 'L' || side === 'R')) {
    const p = handTile(side === 'R' ? 20 - unit.x : unit.x);
    return { x: side === 'R' ? 20 - p.col : p.col, y: p.row - 7 };
  }
  return null;
}
