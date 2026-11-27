/**
 * Canvas 2D frosted-glass overlay for a frozen shop card — 用户第 73 轮：「图1上面是原版游戏的冻结卡片特效，
 * 下面是你做出来的冻结卡片特效，有点简陋，尝试使用 Canvas 2D 一比一还原原版游戏效果」。
 *
 * What the official effect actually is (and the previous CSS version was not):
 *   它不是「一层蓝色半透明蒙版 + 内阴影」。原版是一张**结霜材质**：
 *     ① 边缘先冻 —— 霜从卡片四边向内爬，越靠近边角越白越厚，中心几乎透明（所以立绘还看得清）；
 *     ② 冰棱 —— 从边缘长出的细长放射状晶棱，长度随机、方向基本垂直于边；
 *     ③ 晶粒 —— 散落的六角小冰花，大小与透明度各不相同，成簇而不是均匀铺满；
 *     ④ 冷光 —— 整体极淡的青蓝色偏移，加一层很弱的白色高光斜带；
 *     ⑤ 边线 —— 霜结到卡片边框上，边框比内部明显更白。
 *
 * 全部用 Canvas 2D 程序化绘制（无外部贴图），按卡片实际的 CSS 像素尺寸渲染，DPR 自适应。
 * 随机数用固定种子，保证同一张卡每次渲染的霜纹一致（不会每帧/每次重渲染都变样）。
 */

/** Deterministic PRNG so the frost pattern is stable across re-renders (mulberry32). */
function frostRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paint the frost overlay into a 2D context sized w×h (CSS px, already DPR-scaled by the caller).
 * @param {CanvasRenderingContext2D} c
 * @param {number} w @param {number} h
 * @param {string|number} seed  per-card seed (use the chess id so each card differs but is stable)
 */
export function paintFrost(c, w, h, seed) {
  const rnd = frostRng(typeof seed === 'number' ? seed : hashStr(String(seed || 'frost')));
  c.clearRect(0, 0, w, h);

  // ---- ① 边缘冻结：四边向内衰减的白色霜层 ----------------------------------
  // ★ 必须用 source-over 且渐变末端真正归零 —— 否则整张画布被均匀覆盖，
  //   立绘透不出来，看上去就是用户说的「简陋」（第 73 轮第一版就栽在这）。
  //   四条带各画各的边缘，中心区（距边 > edge）保持完全透明。
  const edge = Math.min(w, h) * 0.46;
  c.save();
  const band = (x, y, bw, bh, vertical, fromStart) => {
    if (bw <= 0 || bh <= 0) return;
    const g = vertical
      ? c.createLinearGradient(0, y, 0, y + bh)
      : c.createLinearGradient(x, 0, x + bw, 0);
    // 渐变始终「从边缘 → 向内」，靠边的 stop 白、内侧归零
    const stops = [
      ['rgba(232,248,255,0.86)', 'rgba(230,246,255,0.82)'],
      ['rgba(205,238,252,0.52)', 'rgba(207,240,252,0.50)'],
      ['rgba(180,222,246,0.24)', 'rgba(182,224,248,0.22)'],
      ['rgba(160,205,240,0.0)', 'rgba(162,207,242,0.0)'],
    ];
    // ★ 第 73 轮六修：这里原本 `seq = stops.reverse()` **同时**反转了颜色序列和位置，
    //   双重反转 ⇒ 渐变被翻回去变成「边缘 0 / 内侧 0.86」。实测症状：
    //     top=206 left=203（fromStart=true，正确）
    //     bottom=50 right=58（fromStart=false，坏掉，跟中心一样透）
    //   修法：颜色序列**永远保持 stops 顺序**（索引 0 = 最靠边缘、最白），
    //   只把落点位置按方向翻转 —— 一条边一个方向，不再两次翻转。
    stops.forEach((pair, i) => {
      const t = i / (stops.length - 1);
      const pos = fromStart ? t : 1 - t;
      g.addColorStop(pos, vertical ? pair[0] : pair[1]);
    });
    c.fillStyle = g;
    c.fillRect(x, y, bw, bh);
  };
  band(0, 0, w, edge, true, true);            // top
  band(0, h - edge, w, edge, true, false);    // bottom
  band(0, 0, edge, h, false, true);           // left
  band(w - edge, 0, edge, h, false, false);   // right
  c.restore();

  // ---- ② 冰棱：从四边向内长出的细长晶棱 ------------------------------------
  c.save();
  c.lineCap = 'round';
  const spikes = Math.round((w + h) / 4.2);
  for (let i = 0; i < spikes; i++) {
    const side = Math.floor(rnd() * 4);
    const len = edge * (0.22 + rnd() * 0.85);
    const wid = 0.7 + rnd() * 1.8;
    const a = 0.20 + rnd() * 0.46;
    let sx, sy, ex, ey;
    if (side === 0) { sx = rnd() * w; sy = 0; ex = sx + (rnd() - 0.5) * len * 0.5; ey = len; }
    else if (side === 1) { sx = rnd() * w; sy = h; ex = sx + (rnd() - 0.5) * len * 0.5; ey = h - len; }
    else if (side === 2) { sx = 0; sy = rnd() * h; ex = len; ey = sy + (rnd() - 0.5) * len * 0.5; }
    else { sx = w; sy = rnd() * h; ex = w - len; ey = sy + (rnd() - 0.5) * len * 0.5; }
    const g = c.createLinearGradient(sx, sy, ex, ey);
    g.addColorStop(0, `rgba(238,250,255,${(a * 1.6).toFixed(3)})`);
    g.addColorStop(0.55, `rgba(190,228,248,${a.toFixed(3)})`);
    g.addColorStop(1, 'rgba(170,215,240,0)');
    c.strokeStyle = g;
    c.lineWidth = wid;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
  }
  c.restore();

  // ---- ③ 晶粒：六角小冰花，成簇散落 ----------------------------------------
  c.save();
  const flakes = Math.round((w * h) / 260);
  for (let i = 0; i < flakes; i++) {
    // 偏向边缘成簇：用两次随机取较靠边的那一侧
    let x = rnd() * w, y = rnd() * h;
    if (rnd() < 0.68) {
      const bx = rnd() < 0.5 ? rnd() * edge : w - rnd() * edge;
      const by = rnd() < 0.5 ? rnd() * edge : h - rnd() * edge;
      x = rnd() < 0.5 ? bx : x; y = rnd() < 0.5 ? by : y;
    }
    // 距边越远越淡
    const dEdge = Math.min(x, y, w - x, h - y);
    const k = Math.max(0, 1 - dEdge / (edge * 1.15));
    if (k <= 0.02) continue;
    const rad = (1.1 + rnd() * 3.4) * (0.55 + k * 0.9);
    const a = (0.22 + rnd() * 0.50) * k;
    c.translate(x, y);
    c.rotate(rnd() * Math.PI);
    c.strokeStyle = `rgba(240,251,255,${a.toFixed(3)})`;
    c.lineWidth = 0.6 + rnd() * 0.9;
    c.beginPath();
    for (let arm = 0; arm < 6; arm++) {
      const th = (arm / 6) * Math.PI * 2;
      c.moveTo(0, 0);
      c.lineTo(Math.cos(th) * rad, Math.sin(th) * rad);
      // 六角冰花的小分叉
      if (rad > 2.2) {
        const bx = Math.cos(th) * rad * 0.6, by = Math.sin(th) * rad * 0.6;
        c.moveTo(bx, by);
        c.lineTo(bx + Math.cos(th + 0.9) * rad * 0.34, by + Math.sin(th + 0.9) * rad * 0.34);
        c.moveTo(bx, by);
        c.lineTo(bx + Math.cos(th - 0.9) * rad * 0.34, by + Math.sin(th - 0.9) * rad * 0.34);
      }
    }
    c.stroke();
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  c.restore();

  // ---- ④ 冷光：整体极淡青蓝偏移 + 一道弱高光斜带 ---------------------------
  c.save();
  c.globalCompositeOperation = 'source-over';
  const cool = c.createLinearGradient(0, 0, w, h);
  cool.addColorStop(0, 'rgba(120,190,235,0.20)');
  cool.addColorStop(0.5, 'rgba(90,160,215,0.05)');
  cool.addColorStop(1, 'rgba(140,205,245,0.18)');
  c.fillStyle = cool;
  c.fillRect(0, 0, w, h);
  c.restore();

  c.save();
  c.globalCompositeOperation = 'source-over';
  const gloss = c.createLinearGradient(w * 0.1, 0, w * 0.75, h);
  gloss.addColorStop(0, 'rgba(255,255,255,0)');
  gloss.addColorStop(0.44, 'rgba(235,250,255,0.10)');
  gloss.addColorStop(0.56, 'rgba(255,255,255,0.16)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gloss;
  c.fillRect(0, 0, w, h);
  c.restore();

  // ---- ⑤ 边线：霜结在边框上，明显比内部白 --------------------------------
  c.save();
  c.globalCompositeOperation = 'source-over';
  const ring = c.createLinearGradient(0, 0, 0, h);
  ring.addColorStop(0, 'rgba(230,246,255,0.55)');
  ring.addColorStop(0.5, 'rgba(200,232,250,0.28)');
  ring.addColorStop(1, 'rgba(230,246,255,0.50)');
  c.strokeStyle = ring;
  c.lineWidth = 2;
  c.strokeRect(1, 1, w - 2, h - 2);
  c.lineWidth = 1;
  c.strokeStyle = 'rgba(255,255,255,0.34)';
  c.strokeRect(2.5, 2.5, w - 5, h - 5);
  c.restore();
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
