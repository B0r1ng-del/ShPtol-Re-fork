// render/board3d/scenery.js — an official scene around a hand-made board (stage.board3d.scenery / .models: e.g.
// 「滞空焦点」 in the 危机合约 #4 airship). The scene is exported one object per chunk (scenes.py export_scene `split`:
// `part` = object name, `origin`); here
//   · its surroundings are copied to the view's `places` (shift, optional mirror); an object that covers a built tile of
//     the board (the enemy pen aside) is left out whole, the rest loses only the triangles over built pen tiles;
//   · the board's own tiles may be built from its tile objects (`models`: kit → [{ part, at, lift?, fitTop? }], the
//     instance nearest `at` copied onto every tile whose kit it is — layout.js `t.kit`).
//
//   scenery = { field: [place…], unite: [place…], boss: [place…], skip: ['^S_playground', …] }
//   place = { dx, dy, mirror?, minX?, maxX? }: x' = mirror ? dx − x : dx + x, y' = y + dy (minX / maxX: a clip)

import { parsePenRect, PEN_RECT } from '../pen.js';

/** How deep under a built tile scene triangles are still cut (the board's own cliffs reach 0.75 down). */
export const CUT_DEPTH = 1.2;

/** Name of a scene object (a chunk's `part` without its renderer id); '' for a merged scene. */
export const partName = (c) => (typeof c?.part === 'string' ? c.part.split('#')[0] : '');

/** The places of the current view: 'boss' when the areas reach the boss rows, 'unite' when one spans both halves. */
export function sceneryPlaces(scenery, areas) {
  if (!scenery || typeof scenery !== 'object') return [];
  const list = Array.isArray(areas) ? areas : [];
  const kind = list.some((a) => a.r1 <= 6) ? 'boss' : list.some((a) => a.c1 >= 20 && a.r0 <= 9) ? 'unite' : 'field';
  const places = Array.isArray(scenery[kind]) ? scenery[kind] : [];
  return places.filter((p) => p && typeof p === 'object').map((p) => ({
    dx: Number(p.dx) || 0, dy: Number(p.dy) || 0, mirror: !!p.mirror,
    minX: Number.isFinite(p.minX) ? p.minX : -Infinity, maxX: Number.isFinite(p.maxX) ? p.maxX : Infinity,
  }));
}

/** Does a scene triangle (centroid x, y, z in board space) of `place` stay: inside its clip, not over a built tile? */
export function sceneryKeeps(grid, place, x, y, z) {
  if (x < place.minX || x > place.maxX) return false;
  const t = grid?.[Math.round(y)]?.[Math.round(x)];
  return !(t && t.drawn && z > -CUT_DEPTH);
}

/** Do the bounds of object chunk `c`, copied to `place`, cover a built tile outside the enemy pen `pen`? */
export function objectOverlaps(grid, place, c, pen = null) {
  const b = c?.bounds;
  if (!Array.isArray(b) || b.length < 6 || b[5] < -0.7) return false; // wholly under the board's cliffs: harmless
  const xa = place.mirror ? place.dx - b[3] : place.dx + b[0], xb = place.mirror ? place.dx - b[0] : place.dx + b[3];
  const ya = b[1] + place.dy, yb = b[4] + place.dy;
  const E = 0.08; // touching a tile's edge (a railing between tiles) is not covering it
  for (let r = Math.ceil(ya + E - 0.5); r <= Math.floor(yb - E + 0.5); r++) {
    for (let col = Math.ceil(xa + E - 0.5); col <= Math.floor(xb - E + 0.5); col++) {
      const t = grid?.[r]?.[col];
      if (!t || !t.drawn) continue;
      if (pen && r >= pen.r0 && r <= pen.r1 && col >= pen.c0 && col <= pen.c1) continue;
      return true;
    }
  }
  return false;
}

/**
 * A scene chunk (load.js loadScenePack) copied to `place`, keeping the triangles `keep(x, y, z)` accepts (centroids);
 * null when none is left. A mirrored copy flips its normals' x and its triangles' winding. `place.zScale` stretches
 * what stands above the ground (a tile model up to the board's height), `place.lift` raises the copy.
 */
export function placeSceneChunk(c, place, keep = null) {
  const n = c.position.length / 3;
  const mirror = !!place.mirror, dx = place.dx || 0, dy = place.dy || 0;
  const zs = Number.isFinite(place.zScale) ? place.zScale : 1, lift = place.lift || 0;
  const position = new Float32Array(n * 3);
  const normal = new Int8Array(c.normal);
  for (let i = 0; i < n; i++) {
    const x = c.position[i * 3], z = c.position[i * 3 + 2];
    position[i * 3] = mirror ? dx - x : dx + x;
    position[i * 3 + 1] = c.position[i * 3 + 1] + dy;
    position[i * 3 + 2] = (z > 0 ? z * zs : z) + lift;
    if (mirror) normal[i * 4] = Math.min(127, -c.normal[i * 4]);
  }
  const src = c.index, out = [];
  for (let t = 0; t + 2 < src.length; t += 3) {
    const a = src[t], b = src[t + 1], d = src[t + 2];
    if (keep) {
      const cx = (position[a * 3] + position[b * 3] + position[d * 3]) / 3;
      const cy = (position[a * 3 + 1] + position[b * 3 + 1] + position[d * 3 + 1]) / 3;
      const cz = (position[a * 3 + 2] + position[b * 3 + 2] + position[d * 3 + 2]) / 3;
      if (!keep(cx, cy, cz)) continue;
    }
    if (mirror) out.push(a, d, b); else out.push(a, b, d);
  }
  if (!out.length) return null;
  const index = src instanceof Uint32Array || n > 65535 ? Uint32Array.from(out) : Uint16Array.from(out);
  return { ...c, position, normal, index, bounds: null };
}

// neighbour bits of a tile: +x 1, −x 2, +y 4, −y 8
const NB = [[1, 0, 1], [-1, 0, 2], [0, 1, 4], [0, -1, 8]];
const bitCount = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

/**
 * Tile models (stage.board3d.models): per exemplar chunk, the places of its copies — one per built tile whose `kit`
 * it is. The exemplar is an object (all its chunks) whose name starts with `part`: the one whose origin is nearest
 * `at` (inside `within`, when given), or with `match` per tile the one whose neighbours of its own kind sit on the same sides (a 2×2 panel's
 * quarters, a strip's ends; ties → nearest `at`). `fitTop` stretches it to the tile's height, `lift` raises it.
 */
export function kitPlaces(chunks, models, grid) {
  const out = new Map();
  if (!models || typeof models !== 'object' || !Array.isArray(chunks)) return out;
  for (const [kit, specs] of Object.entries(models)) {
    if (!Array.isArray(specs)) continue;
    const cells = [];
    for (const row of grid || []) for (const t of row) if (t.kit === kit && t.drawn) cells.push(t);
    if (!cells.length) continue;
    const mine = (r, c) => { const n = grid?.[r]?.[c]; return !!(n && n.drawn && n.kit === kit); };
    for (const s of specs) {
      if (s && Array.isArray(s.cells)) { cellCopies(chunks, s, cells, out); continue; }
      if (!s || typeof s.part !== 'string') continue;
      // the instances: object name → its chunks, origin, neighbour bits among the instances
      const inst = new Map();
      for (const c of chunks) {
        if (!partName(c).startsWith(s.part) || !Array.isArray(c.origin)) continue;
        const w = s.within; // [x0, y0, x1, y1]: only instances on the official board (not the hidden spare ones around it)
        if (Array.isArray(w) && (c.origin[0] < w[0] - 0.01 || c.origin[1] < w[1] - 0.01 || c.origin[0] > w[2] + 0.01 || c.origin[1] > w[3] + 0.01)) continue;
        const e = inst.get(c.part) || { part: c.part, origin: c.origin, chunks: [] };
        e.chunks.push(c);
        inst.set(c.part, e);
      }
      if (!inst.size) continue;
      const at = new Set([...inst.values()].map((e) => `${Math.round(e.origin[0])},${Math.round(e.origin[1])}`));
      for (const e of inst.values()) {
        const x = Math.round(e.origin[0]), y = Math.round(e.origin[1]);
        e.mask = NB.reduce((m, [dx, dy, b]) => (at.has(`${x + dx},${y + dy}`) ? m | b : m), 0);
        e.dist = Array.isArray(s.at) ? Math.hypot(e.origin[0] - s.at[0], e.origin[1] - s.at[1]) : 0;
        e.top = Math.max(...e.chunks.map((c) => (Array.isArray(c.bounds) ? c.bounds[5] : 0)));
      }
      const list = [...inst.values()].sort((a, b) => a.dist - b.dist || (a.part < b.part ? -1 : 1));
      for (const t of cells) {
        let e = list[0];
        if (s.match) {
          const m = NB.reduce((acc, [dx, dy, b]) => (mine(t.r + dy, t.c + dx) ? acc | b : acc), 0);
          let bd = Infinity;
          for (const x of list) { const d = bitCount(x.mask ^ m); if (d < bd) { bd = d; e = x; } }
        }
        for (const c of e.chunks) {
          const pl = out.get(c) || [];
          pl.push({ dx: t.c - e.origin[0], dy: t.r - e.origin[1], lift: Number(s.lift) || 0,
            zScale: s.fitTop && e.top > 0.05 ? t.h / e.top : 1, minX: -Infinity, maxX: Infinity });
          out.set(c, pl);
        }
      }
    }
  }
  return out;
}

/**
 * A kit of whole official cells (`cells`: [[x, y], …], e.g. the decorated blocks around the official board): every
 * object standing inside one of those cells is copied onto the kit's tiles, the cells taken in turn by a fixed hash of
 * the tile (the same board always looks the same). `skip` (RegExp sources) leaves out objects by name.
 */
function cellCopies(chunks, s, tiles, out) {
  const skip = (Array.isArray(s.skip) ? s.skip : []).map((x) => { try { return new RegExp(x); } catch { return null; } }).filter(Boolean);
  const sets = [];
  for (const cell of s.cells) {
    if (!Array.isArray(cell) || cell.length < 2) continue;
    const [x, y] = cell.map(Number);
    const own = chunks.filter((c) => {
      const b = c.bounds;
      if (!Array.isArray(b) || b.length < 6 || b[5] <= 0) return false; // under the floor (the beams below the glass)
      if (skip.some((re) => re.test(partName(c)))) return false;
      return b[0] >= x - 0.56 && b[3] <= x + 0.56 && b[1] >= y - 0.56 && b[4] <= y + 0.56;
    });
    if (own.length) sets.push({ x, y, own });
  }
  if (!sets.length) return;
  for (const t of tiles) {
    const e = sets[((t.r * 7 + t.c * 13) % sets.length + sets.length) % sets.length];
    for (const c of e.own) {
      const pl = out.get(c) || [];
      pl.push({ dx: t.c - e.x, dy: t.r - e.y, lift: Number(s.lift) || 0, zScale: 1, minX: -Infinity, maxX: Infinity });
      out.set(c, pl);
    }
  }
}

/** Everything `sceneryChunks` needs for one build of a stage's board (scene.js setStage). */
export function sceneryPlan(stage, chunks, areas, grid) {
  const sc = stage?.board3d?.scenery;
  const skip = (Array.isArray(sc?.skip) ? sc.skip : []).map((x) => { try { return new RegExp(x); } catch { return null; } }).filter(Boolean);
  return {
    places: sceneryPlaces(sc, areas), grid, skip,
    pen: parsePenRect(stage?.config?.enemy_place_rect) || PEN_RECT,
    kits: kitPlaces(chunks, stage?.board3d?.models, grid),
  };
}

/** The copies of scene chunk `c` a hand-made board draws: its tile-model copies, then its surroundings copies. */
export function sceneryChunks(c, plan) {
  const out = [];
  for (const p of plan.kits?.get(c) || []) { const pc = placeSceneChunk(c, p); if (pc) out.push(pc); }
  const name = partName(c);
  if (name && plan.skip.some((re) => re.test(name))) return out;
  for (const p of plan.places) {
    if (name && objectOverlaps(plan.grid, p, c, plan.pen)) continue;
    const pc = placeSceneChunk(c, p, (x, y, z) => sceneryKeeps(plan.grid, p, x, y, z));
    if (pc) out.push(pc);
  }
  return out;
}