import { html } from './components.js';
import { useEffect, useRef } from '../../vendor/hooks.module.js';

// A subdivided icosahedron: every vertex lies on the same sphere.
const normalize = ([x, y, z]) => {
  const radius = Math.hypot(x, y, z);
  return [x / radius, y / radius, z / radius];
};
const phi = (1 + Math.sqrt(5)) / 2;
const vertices = [
  [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
  [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
  [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
].map(normalize);
const faces = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
const midpoints = new Map();
const midpoint = (a, b) => {
  const key = [a, b].sort((x, y) => x - y).join(':');
  if (!midpoints.has(key)) {
    midpoints.set(key, vertices.length);
    vertices.push(normalize(vertices[a].map((v, i) => (v + vertices[b][i]) / 2)));
  }
  return midpoints.get(key);
};
const edgeMap = new Map();
for (const [a, b, c] of faces) {
  const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
  for (const [i, j, k] of [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]) {
    for (const [u, v] of [[i, j], [j, k], [k, i]]) {
      edgeMap.set([u, v].sort((x, y) => x - y).join(':'), [u, v]);
    }
  }
}
const edges = [...edgeMap.values()];

/** Small decorative 3D wire sphere; no WebGL context or image downloads. */
export function TitleSphere({ paused = false } = {}) {
  const svg = useRef(null);
  const suspended = useRef(paused), syncVisibility = useRef(null);
  suspended.current = paused;
  useEffect(() => { syncVisibility.current?.(); }, [paused]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const front = el.querySelector('.title-sphere-front');
    const back = el.querySelector('.title-sphere-back');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, previous = 0, angle = .35;
    const render = () => {
      const sin = Math.sin(angle), cos = Math.cos(angle);
      const tilt = -.24, st = Math.sin(tilt), ct = Math.cos(tilt);
      const points = vertices.map(([x, y, z]) => {
        const rx = x * cos + z * sin, rz = z * cos - x * sin;
        return [rx * 100, (y * ct - rz * st) * 100, y * st + rz * ct];
      });
      let near = '', far = '';
      for (const [a, b] of edges) {
        const p = points[a], q = points[b];
        const line = `M${p[0].toFixed(2)},${p[1].toFixed(2)}L${q[0].toFixed(2)},${q[1].toFixed(2)}`;
        if (p[2] + q[2] >= 0) near += line;
        else far += line;
      }
      front.setAttribute('d', near);
      back.setAttribute('d', far);
    };
    const tick = (now) => {
      if (suspended.current || document.hidden || reduced.matches) { frame = 0; previous = 0; return; }
      if (now - previous >= 1000 / 30) {
        if (previous) angle += Math.min(now - previous, 100) / 1000 * Math.PI / 28;
        previous = now;
        render();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      render();
      if (!reduced.matches && !document.hidden && !suspended.current) frame = requestAnimationFrame(tick);
    };
    syncVisibility.current = sync;
    sync();
    reduced.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      syncVisibility.current = null;
      cancelAnimationFrame(frame);
      reduced.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return html`<span class="title-network" aria-hidden="true">
    <svg ref=${svg} viewBox="-120 -120 240 240" focusable="false">
      <g fill="none" stroke="currentColor" stroke-linejoin="round">
        <path class="title-sphere-back" opacity=".24" />
        <path class="title-sphere-front" />
      </g>
    </svg>
  </span>`;
}
