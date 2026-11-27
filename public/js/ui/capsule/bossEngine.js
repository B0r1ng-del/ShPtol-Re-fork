/**
 * 顶栏胶囊 · BOSS 态引擎（trans_boss）
 *
 * 忠实移植自 _sp-卫戍协议终端胶囊-四态整合/动画预览.html 的 BossEngine（10443 网页复刻版的
 * 正确 boss 实现）。用户裁定：「10443版本的boss胶囊动画是正确的」，故 BOSS 一律以此为准。
 *
 * ★ 与三态引擎**完全独立**、不能硬合：数据结构不同源
 *     三态：节点树 + 锚点内联 amn + 文本宽 0 运行时估算
 *     BOSS：扁平 DEF + 独立 ANC/PIV 表 + 文本宽写死
 *   硬合会互相污染 ⇒ 两套各跑各的 layout()、各占一个容器。
 *
 * ★ 三个易错点
 *   1. 拉伸锚点（amax>amin）时 sizeDelta 是**增量**：真实宽 = (amax-amin)*父宽 + sizeDelta。
 *      BOSS 有 5 个这种节点，只按 sizeDelta 取尺寸会塌成 0×0。
 *   2. trans_boss 共 61 条曲线，其中 17 条指向 root_frame/* 与 root_hp（无 group_boss 前缀），
 *      10443 原版对它们也是 if(!DEF[p])continue 直接跳过 —— 本实现保持一致，**不额外补全**。
 *   3. 血条 bar 宽 194 超出 root_bar 的 193，靠 root_bar 的 overflow:hidden 裁掉溢出。
 */
import { BOSS_DATA } from './boss.js';

const D = BOSS_DATA;
const DEF = D.DEF;
const ANC = D.ANC;
const PIV = D.PIV;
const CLIP = D.CLIP;

/** BOSS 顶层组尺寸（就是胶囊设计的 482×56）。 */
export const BOSS_W = D.GROUP.w;
export const BOSS_H = D.GROUP.h;

/** 曲线采样：支持标量与数组（向量）两种关键帧值。 */
export function sampleBoss(keys, t) {
  if (!keys || !keys.length) return null;
  if (t <= keys[0][0]) return keys[0][1];
  const n = keys.length;
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const span = b[0] - a[0], u = span > 0 ? (t - a[0]) / span : 0;
      const va = a[1], vb = b[1];
      if (typeof va === 'number' && typeof vb === 'number') return va + (vb - va) * u;
      if (Array.isArray(va) && Array.isArray(vb)) return va.map((x, j) => x + ((vb[j] !== undefined ? vb[j] : x) - x) * u);
      return u < 1 ? va : vb;
    }
  }
  return keys[n - 1][1];
}

/** 父容器尺寸表：BOSS 只有一个顶层组 482×56。 */
const PW = {}, PH = {};
for (const p of Object.keys(DEF)) {
  const pp = p.split('/').slice(0, -1).join('/');
  if (!pp) continue;
  if (DEF[pp]) { PW[p] = Math.abs(DEF[pp].w); PH[p] = Math.abs(DEF[pp].h); }
  else { PW[p] = D.GROUP.w; PH[p] = D.GROUP.h; }
}

/**
 * @param {HTMLElement} host 引擎根容器（必须正好 BOSS_W × BOSS_H，position:relative）
 * @param {(img:string)=>string} urlOf 节点 img 名（含 .png）→ 可加载的 URL
 * @param {{barPath?:string}} [opts] barPath：血条填充节点路径，按 frac 覆盖 width
 */
export function createBossEngine(host, urlOf, opts = {}) {
  const NODES = {};
  const GEO = {};
  const dur = CLIP.dur;
  const barPath = opts.barPath || null;
  let tAcc = 0;
  let raf = null;
  let last = 0;
  let active = true;
  let playing = false;
  /** 外部实时血量（0..1）；null = 未取到，走「满条 + 敌方领袖」态。 */
  let hpFrac = null;
  /** 外部喂的文本：{ 路径: 字符串 } */
  const textMap = {};

  function build() {
    host.innerHTML = '';
    for (const k of Object.keys(NODES)) delete NODES[k];

    const root = document.createElement('div');
    root.className = 'cap4__n';
    root.dataset.path = 'group_boss';
    host.appendChild(root);
    NODES.group_boss = root;

    const ensure = (p) => {
      if (NODES[p]) return NODES[p];
      const seg = p.split('/');
      const parent = ensure(seg.slice(0, -1).join('/'));
      const e = document.createElement('div');
      e.className = 'cap4__n';
      e.dataset.path = p;
      parent.appendChild(e);
      NODES[p] = e;
      return e;
    };

    const paths = Object.keys(DEF).sort((a, b) => a.split('/').length - b.split('/').length);
    for (const p of paths) {
      if (p === 'group_boss') continue;
      const d = DEF[p];
      const e = document.createElement('div');
      e.className = 'cap4__n';
      if (d.mask) e.classList.add('cap4__n--mask');
      // bar_fill 在原版是无图节点，靠 IImage.color 上色。颜色直接内联，避免依赖某个页面是否引入了
      // game.css（截图页/验收页都没引）——同 setText 的 color 做法一致。
      if (p === 'group_boss/group_normal/root_hp/root_bar/bar_fill') {
        e.classList.add('cap4__n--fill');
        e.style.background = 'linear-gradient(90deg, #b8340d, var(--orange-hi, #ff8a3d))';
        e.style.boxShadow = '0 0 .1rem rgba(255, 110, 40, .8)';
      }
      if (d.img) {
        const im = document.createElement('img');
        im.src = urlOf(d.img);
        im.alt = '';
        im.draggable = false;
        e.appendChild(im);
      }
      // 数据里的 text 是提取时的原值（'BOSS' / '12'）；这里只当「这是个文本节点」的标记，
      // 内容一律由 setText() 外部喂实时值，绝不把提取值写死进画面。
      if (typeof d.text === 'string') {
        e.classList.add('cap4__n--txt');
        e.style.fontSize = (d.size || 20) + 'px';
        e.style.color = d.color || '#fff';
        e.style.letterSpacing = '0.08em';
        const sp = document.createElement('span');
        sp.textContent = '';
        e.appendChild(sp);
        e._span = sp;
      }
      e.dataset.path = p;
      NODES[p] = e;
      const pp = p.split('/').slice(0, -1).join('/');
      (NODES[pp] || ensure(pp)).appendChild(e);
    }
  }

  function layout(t) {
    const own = {}, sizeX = {}, sizeY = {}, posX = {}, posY = {};
    for (const q of Object.keys(DEF)) own[q] = 1;

    for (const c of CLIP.curves) {
      const seg = c.path.split('/');
      const gi = seg.indexOf('group_boss');
      if (gi < 0) continue;                       // 17 条 root_frame/* / root_hp：原版同样跳过
      const rel = seg.slice(gi + 1).join('/');
      const p = rel ? 'group_boss/' + rel : 'group_boss';
      if (!DEF[p]) continue;
      const v = sampleBoss(c.keys, t);
      if (v === null || v === undefined) continue;
      const f = Array.isArray(v) ? v[0] : v;
      if (typeof f !== 'number') continue;
      if (c.attr === 'm_Alpha') own[p] = f;
      else if (c.attr === 'm_Color.a') own[p] = (own[p] === undefined ? 1 : own[p]) * f;
      else if (c.attr === 'm_AnchoredPosition.x') posX[p] = f;
      else if (c.attr === 'm_AnchoredPosition.y') posY[p] = f;
      else if (c.attr === 'm_SizeDelta.x') sizeX[p] = Math.abs(f);
      else if (c.attr === 'm_SizeDelta.y') sizeY[p] = Math.abs(f);
      else if (c.type === 'scale' || c.attr === 'm_LocalScale.x') {
        const s = Array.isArray(v) ? v : [f, f, f];
        DEF[p]._sc = [s[0], s[1], s[2]];
      } else if (c.type === 'rot') {
        const qv = Array.isArray(v) ? v : [0, 0, 0, 1];
        DEF[p]._rot = 2 * Math.atan2(qv[2], qv[3]) * 180 / Math.PI;
      }
    }

    // 顶层组居中
    const ge = NODES.group_boss;
    if (ge) {
      ge.style.width = BOSS_W + 'px';
      ge.style.height = BOSS_H + 'px';
      ge.style.left = 'calc(50% + ' + (-BOSS_W / 2) + 'px)';
      ge.style.top = 'calc(50% + ' + (-BOSS_H / 2) + 'px)';
    }

    for (const p of Object.keys(DEF)) {
      const d = DEF[p], e = NODES[p];
      if (!e) continue;
      let w = sizeX[p] !== undefined ? sizeX[p] : Math.abs(d.w);
      let h = sizeY[p] !== undefined ? sizeY[p] : Math.abs(d.h);
      const x = posX[p] !== undefined ? posX[p] : d.x;
      const y = posY[p] !== undefined ? posY[p] : d.y;
      const pw = PW[p], ph = PH[p];
      const a = ANC[p];
      const pv = PIV[p];
      const pxv = pv ? pv.px : 0.5, pyv = pv ? pv.py : 0.5;
      let aw = w, ah = h, offX, offY;
      if (a) {
        // 拉伸锚点：sizeDelta 是增量
        if (a.amaxx > a.aminx) aw = (a.amaxx - a.aminx) * pw + w;
        if (a.amaxy > a.aminy) ah = (a.amaxy - a.aminy) * ph + h;
        offX = (a.aminx - 0.5) * pw + x - pxv * w;
        offY = (0.5 - a.aminy) * ph - y - (1 - pyv) * h;
      } else {
        offX = x - pxv * w;
        offY = -y - (1 - pyv) * h;
      }
      // 血条实时驱动：只改填充宽度，其余几何照曲线走
      if (barPath && p === barPath && hpFrac != null) {
        const bd = DEF[barPath];
        const baseW = bd && bd.w ? Math.abs(bd.w) : aw;
        aw = baseW * Math.max(0, Math.min(1, hpFrac));
      }
      e.style.width = aw + 'px';
      e.style.height = ah + 'px';
      e.style.left = 'calc(50% + ' + offX + 'px)';
      e.style.top = 'calc(50% + ' + offY + 'px)';
      const sc = d._sc || [1, 1, 1], rot = d._rot || 0;
      let tf = '';
      if (sc[0] !== 1 || sc[1] !== 1) tf += 'scale(' + sc[0] + ',' + sc[1] + ')';
      if (rot) tf += ' rotate(' + rot.toFixed(2) + 'deg)';
      e.style.transform = tf;
      GEO[p] = { offX, offY, w: aw, h: ah };
    }

    // 层级 alpha 继承（父组 alpha 要乘到每个子孙）
    const eff = (p) => {
      const seg = p.split('/');
      let a = 1;
      for (let i = 1; i <= seg.length; i++) {
        const q = seg.slice(0, i).join('/');
        if (own[q] !== undefined) a *= own[q];
      }
      return Math.max(0, Math.min(1, a));
    };
    for (const p of Object.keys(NODES)) {
      const a = eff(p);
      NODES[p].style.opacity = a;
      NODES[p].style.visibility = a < 0.005 ? 'hidden' : 'visible';
    }
  }

  function tick(now) {
    if (!last) last = now;
    const dt = (now - last) / 1000;
    last = now;
    if (playing && active) {
      tAcc = tAcc + dt;
      if (tAcc >= dur) { tAcc = dur; playing = false; }   // 播完停在末帧，不再逐帧布局
      layout(tAcc);
    }
    raf = requestAnimationFrame(tick);
  }

  return {
    init() {
      build();
      layout(0);
      if (!raf) raf = requestAnimationFrame(tick);
    },
    play() {
      tAcc = 0;
      playing = true;
      last = 0;
      for (const p of Object.keys(DEF)) { delete DEF[p]._sc; delete DEF[p]._rot; }
      layout(0);
    },
    freeze(t) {
      playing = false;
      tAcc = Math.min(Math.max(0, t), dur);
      layout(tAcc);
      return tAcc;
    },
    setActive(v) { active = !!v; if (active) last = 0; },
    /** 实时血量：0..1，null 表示未取到（满条）。 */
    setHp(frac) {
      hpFrac = frac == null || !Number.isFinite(frac) ? null : Math.max(0, Math.min(1, frac));
      layout(tAcc);
    },
    /** 外部喂文本：{ 路径: 字符串 }。 */
    setText(map) {
      let changed = false;
      for (const p of Object.keys(map)) {
        const e = NODES[p];
        if (!e || !e._span) continue;
        const v = map[p] == null ? '' : String(map[p]);
        if (e._span.textContent !== v) { e._span.textContent = v; changed = true; }
        textMap[p] = v;
      }
      if (changed) layout(tAcc);
    },
    state() { return { t: tAcc, dur, curves: CLIP.curves.length, nodes: Object.keys(DEF).length }; },
    nodes() { return NODES; },
    geo() { return GEO; },
    destroy() { if (raf) cancelAnimationFrame(raf); raf = null; host.innerHTML = ''; },
  };
}
