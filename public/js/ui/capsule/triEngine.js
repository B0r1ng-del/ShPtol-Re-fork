/**
 * 顶栏胶囊 · 三态引擎（休整 trans_rest / 进入作战 trans_battle / 协同作战 trans_coop）
 *
 * 忠实移植自 _sp-卫戍协议终端胶囊-四态整合/动画预览.html 的 TriEngine（Unity 客户端
 * [uc]ac_n_initial.ab 原始数据）。运算与几何一字未改，只做了三件事：
 *   ① 闭包改成模块，容器与取图由参数注入（不再读 document.getElementById / 全局 RES）；
 *   ② 文本内容由 setText() 外部喂入（原版运行时填 m_Text，本地提取是空的）；
 *   ③ 去掉控制台 HUD 与键盘绑定，只留 init/play/freeze/resume/state。
 *
 * ★ 三个易错点（照抄原实现，别重新推导）
 *   1. offY 必须用 (1 - pivot.y)，写成 pivot.y 会让节点整体下移一个身位；
 *   2. m_Color 是线性空间值，必须 lin2srgb 才能与贴图正确相乘；
 *   3. DOM 顺序 = 绘制顺序，必须按 ZORDER（Unity m_Children 下标）重排，
 *      否则 bg_trans 会盖到底图上（休整态绿成一片）、剑会压在小人脸上。
 */
import { DEF_NODES, DEF_CLIPS } from './data.js';
import { ZORDER } from './zorder.js';
import { DEF_SCALE, DEF_ROT } from './scalerot.js';
import { DEF_MAT } from './nodemat.js';

/** 引擎设计的胶囊尺寸（Unity prefab 原始单位）。容器必须正好是这个尺寸。 */
export const CAP_W = 482;
export const CAP_H = 56;

/** 三个状态：clip 名 → 顶层组。顺序即参考页 1/2/3 键。 */
export const TRI_STATES = [
  { key: 'trans_rest', en: 'REST', cn: '休整', grp: 'group_rest' },
  { key: 'trans_battle', en: 'NORMAL_BATTLE', cn: '进入作战', grp: 'group_battle' },
  { key: 'trans_coop', en: 'HELP_BATTLE', cn: '协同作战', grp: 'group_coop' },
];

/** RectMask2D 等价：只有这些节点裁切子级（三态各一个）。 */
const MASK = {
  'group_rest/root_mask': 1,
  'group_battle/root_mask': 1,
  'group_coop/root_mask': 1,
};

/** Unity 序列化的 Color 是线性空间值；转到 sRGB 才能与贴图正确相乘。 */
function lin2srgb(v) {
  const x = Math.max(0, Math.min(1, v));
  const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

const topSeg = (p) => { const i = p.indexOf('/'); return i < 0 ? p : p.slice(0, i); };

/** 原版一次只激活一个状态面板，其余 GameObject.SetActive(false)。 */
function visibleIn(path, grp) {
  const t = topSeg(path);
  if (t === 'group_rest' || t === 'group_battle' || t === 'group_coop') return t === grp;
  return true;
}

/**
 * 漏怪标签（tag_miss）的两个节点路径。
 * ★ 原版 trans_battle 的 m_Alpha 末帧是 1（[[2.3333,0],[2.4333,1]]）——
 *   也就是说**动画播完这组一定显现**，与「有没有漏怪」无关。原版运行时靠 SetActive 控制，
 *   本地提取的数据里 act 恒为 true，于是漏怪 0 也常驻一个空红框（用户报的 bug）。
 *   这里按调用方给的 shouldShowMiss 把它整组压掉（底图 bg_miss_enemy 自带 ×，
 *   只切文字会剩一个空框，所以必须整组）。
 */
const MISS_PATHS = new Set(['group_battle/tag_miss', 'group_coop/tag_miss']);

/** 该路径是否属于漏怪标签整组（含其子节点 text_num / add）。 */
function inMissTag(path) {
  const segs = path.split('/');
  if (segs.length < 2) return false;
  return MISS_PATHS.has(segs[0] + '/' + segs[1]);
}

/** 曲线采样（线性插值，端点外取端点值）。 */
export function sample(keys, t) {
  if (!keys || !keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  const n = keys.length;
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const span = b[0] - a[0];
      if (span <= 1e-9) return b[1];
      return a[1] + (b[1] - a[1]) * ((t - a[0]) / span);
    }
  }
  return keys[n - 1][1];
}

/** 按字号估算单行文本宽度（中文≈1.0em，数字≈0.56em，斜杠≈0.32em）。 */
export function estimateTextWidth(txt, fs) {
  if (!txt) return 0;
  let w = 0;
  for (let i = 0; i < txt.length; i++) {
    const c = txt.charCodeAt(i);
    if (c > 255) w += 1.0;
    else if (c >= 48 && c <= 57) w += 0.56;
    else if (c === 47) w += 0.32;
    else w += 0.55;
  }
  return Math.round(w * fs);
}

/**
 * @param {HTMLElement} host 引擎根容器（必须正好 CAP_W × CAP_H，position:relative）
 * @param {(img:string)=>string} urlOf 节点 img 名 → 可加载的图片 URL
 */
export function createTriEngine(host, urlOf) {
  const NODES = DEF_NODES;
  const CLIPS = DEF_CLIPS;
  const els = {};
  let order = [];
  let parentSize = {};
  let curKey = null;
  let curGrp = 'group_rest';
  let tAcc = 0;
  let dur = 0;
  let raf = null;
  let last = 0;
  let active = true;
  /** freeze() 置 true：定格后 rAF 不再推进时间，直到下一次 play()。 */
  let paused = false;
  /** 漏怪标签是否整体显示（null = 未指定，沿用原版曲线；false = 整组压掉）。 */
  let showMiss = null;

  /** 建 DOM：按路径深度升序挂载，再按 ZORDER 重排每个父节点下的子节点。 */
  function build() {
    host.innerHTML = '';
    for (const k of Object.keys(els)) delete els[k];
    order = [];

    const keys = Object.keys(NODES).filter((k) => k !== '__root__');
    keys.sort((a, b) => {
      const da = a.split('/').length, db = b.split('/').length;
      return da - db || (a < b ? -1 : a > b ? 1 : 0);
    });

    for (const path of keys) {
      const d = NODES[path];
      if (!d) continue;
      const el = document.createElement('div');
      el.className = 'cap4__n';
      el.dataset.path = path;

      if (d.img) {
        const im = document.createElement('img');
        im.src = urlOf(d.img);
        im.alt = '';
        im.draggable = false;
        el.appendChild(im);
      }
      if (d.isText) {
        el.classList.add('cap4__n--txt');
        if (d.size) el.style.fontSize = d.size + 'px';
        if (d.tcol) {
          el.style.color = 'rgb(' + lin2srgb(d.tcol[0]) + ',' + lin2srgb(d.tcol[1]) + ',' + lin2srgb(d.tcol[2]) + ')';
        }
        const sp = document.createElement('span');
        sp.textContent = '';
        el.appendChild(sp);
        el._span = sp;
      }
      if (MASK[path]) el.classList.add('cap4__n--mask');

      const segs = path.split('/');
      const par = segs.length > 1 ? segs.slice(0, -1).join('/') : null;
      const parent = par && els[par] ? els[par] : host;
      parent.appendChild(el);

      els[path] = el;
      order.push(path);
    }

    // DOM 顺序 = 绘制顺序：严格按 Unity m_Children 下标重排
    const byParent = {};
    for (const path of order) {
      const segs = path.split('/');
      const par = segs.length > 1 ? segs.slice(0, -1).join('/') : '';
      (byParent[par] = byParent[par] || []).push(path);
    }
    for (const par of Object.keys(byParent)) {
      const parent = par && els[par] ? els[par] : host;
      const kids = byParent[par].slice().sort((a, b) => {
        const za = Object.prototype.hasOwnProperty.call(ZORDER, a) ? ZORDER[a] : 999;
        const zb = Object.prototype.hasOwnProperty.call(ZORDER, b) ? ZORDER[b] : 999;
        return za - zb;
      });
      for (const p of kids) parent.appendChild(els[p]);
    }

    parentSize = {};
    for (const path of order) parentSize[path] = { w: Math.abs(NODES[path].s[0]), h: Math.abs(NODES[path].s[1]) };
  }

  /** 单帧布局：基础几何 → 叠加曲线 → 缩放/旋转 → 写样式（含染色与加法混合）。 */
  function layout(key, t) {
    const clip = CLIPS[key];
    if (!clip) return;
    const grp = curGrp;

    // 1. 基础几何
    for (const path of order) {
      const d = NODES[path], el = els[path];
      el._x = d.p[0]; el._y = d.p[1];
      el._w = d.s[0]; el._h = d.s[1];
      el._a = 1;
      el._col = d.col ? d.col.slice() : null;
      el._mat = DEF_MAT[path] || '';
      el._act = d.act;
      // prefab 里三个组是 act=false（编辑态关闭）；选中态必须强制激活
      if (path === grp) el._act = true;
    }

    // 2. 叠加 m_FloatCurves
    const touched = {};
    for (const c of clip.c) {
      const path = c.p;
      if (!path || !NODES[path]) continue;
      if (!touched[path]) touched[path] = {};
      const T = touched[path];
      const v = sample(c.k, t), a = c.a;
      if (a === 'm_AnchoredPosition.x') T.x = v;
      else if (a === 'm_AnchoredPosition.y') T.y = v;
      else if (a === 'm_SizeDelta.x') T.w = v;
      else if (a === 'm_SizeDelta.y') T.h = v;
      else if (a === 'm_Alpha') T.a = v;
      else if (a.indexOf('m_Color.') === 0) {
        // 必须从 prefab 的 m_Color 初值继承，否则 RGB 被默认白覆盖
        if (!T.col) {
          const c0 = NODES[path].col;
          T.col = c0 ? [c0[0], c0[1], c0[2], c0.length > 3 ? c0[3] : 1] : [1, 1, 1, 1];
        }
        const idx = a === 'm_Color.r' ? 0 : a === 'm_Color.g' ? 1 : a === 'm_Color.b' ? 2 : 3;
        T.col[idx] = v;
      } else if (a === 'm_IsActive' || a === 'm_Enabled') T.act = v > 0.5;
    }
    for (const path of Object.keys(touched)) {
      const T = touched[path], el = els[path];
      if (T.x !== undefined) el._x = T.x;
      if (T.y !== undefined) el._y = T.y;
      if (T.w !== undefined) el._w = T.w;
      if (T.h !== undefined) el._h = T.h;
      if (T.a !== undefined) el._a = T.a;
      if (T.col) el._col = T.col;
      if (T.act !== undefined) el._act = T.act;
    }

    // 2b. 缩放 / 旋转曲线（在 m_ScaleCurves / m_RotationCurves，不在 m_FloatCurves）
    const scaled = {};
    for (const path of Object.keys(DEF_SCALE)) {
      const arr = DEF_SCALE[path];
      if (!arr || !els[path]) continue;
      for (const it of arr) {
        if (it.clip !== key) continue;
        const ks = it.k;
        if (!ks || !ks.length) continue;
        scaled[path] = {
          sx: sample(ks.map((k) => [k[0], k[1]]), t),
          sy: sample(ks.map((k) => [k[0], k[2]]), t),
        };
        break;
      }
    }
    const rotated = {};
    for (const path of Object.keys(DEF_ROT)) {
      const arr = DEF_ROT[path];
      if (!arr || !els[path]) continue;
      for (const it of arr) {
        if (it.clip !== key) continue;
        const ks = it.k;
        if (!ks || !ks.length) continue;
        rotated[path] = sample(ks.map((k) => [k[0], k[3]]), t);
        break;
      }
    }

    // 3. 写样式
    for (const path of order) {
      const d = NODES[path], el = els[path];
      const segs = path.split('/');
      const par = segs.length > 1 ? segs.slice(0, -1).join('/') : null;
      const pw = par && parentSize[par] ? parentSize[par].w : CAP_W;
      const ph = par && parentSize[par] ? parentSize[par].h : CAP_H;

      const w = Math.abs(el._w), h = Math.abs(el._h);
      const pvx = d.pv[0], pvy = d.pv[1];
      // offY 必须 (1-pvy)；三态没有拉伸锚点，所以不需要 sizeDelta 增量处理
      const offX = (d.amn[0] - 0.5) * pw + el._x - pvx * w;
      const offY = (0.5 - d.amn[1]) * ph - el._y - (1 - pvy) * h;

      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.left = 'calc(50% + ' + offX + 'px)';
      el.style.top = 'calc(50% + ' + offY + 'px)';

      // 缩放/旋转以 pivot 为中心，必须改 transform-origin
      const sc = scaled[path];
      const ro = rotated[path];
      if (sc || ro !== undefined) {
        el.style.transformOrigin = (pvx * 100) + '% ' + ((1 - pvy) * 100) + '%';
        let tf = '';
        if (sc && (Math.abs(sc.sx - 1) > 1e-4 || Math.abs(sc.sy - 1) > 1e-4)) {
          tf += ' scale(' + sc.sx.toFixed(5) + ',' + sc.sy.toFixed(5) + ')';
        }
        if (ro !== undefined && Math.abs(ro) > 1e-6) tf += ' rotate(' + (-ro * 180 / Math.PI).toFixed(4) + 'deg)';
        el.style.transform = tf || '';
      } else if (el.style.transform) {
        el.style.transform = '';
      }

      let op = el._a;
      if (el._col && el._col.length > 3) op *= Math.max(0, Math.min(1, el._col[3]));
      if (el._act === false) op = 0;
      if (!visibleIn(path, grp)) op = 0;
      // ★ 漏怪标签：没有漏怪时整组压掉（底图自带 ×，只切文字会剩空框）。
      //   放在曲线之后 —— trans_battle/tag_miss 的 m_Alpha 末帧是 1，压在上面才有效。
      if (showMiss === false && inMissTag(path)) op = 0;
      el.style.opacity = Math.max(0, Math.min(1, op));
      el.style.display = el.style.opacity === '0' ? 'none' : '';

      // Unity Image.color 是相乘：最终RGB = 贴图RGB × srgb(m_Color.rgb)。
      // 带 col 的节点贴图全是纯白 ⇒ 用「单层染色 + mask-image 承载贴图 alpha」，
      // 原 <img> 隐藏（留两层会叠亮）。m_add 材质额外 plus-lighter 复现加法混合。
      const imgEl = el.querySelector(':scope > img');
      const colObj = el._col && imgEl && d.img;
      if (colObj) {
        const c = el._col;
        const r = lin2srgb(c[0]), g = lin2srgb(c[1]), b = lin2srgb(c[2]);
        if (!el._tint) {
          const tn = document.createElement('div');
          tn.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
          tn.style.zIndex = '0';
          el.appendChild(tn);
          el._tint = tn;
        }
        const murl = urlOf(d.img);
        const isGlow = /glow/i.test(d.img);
        el._tint.style.mixBlendMode = /add/i.test(el._mat) ? 'plus-lighter' : 'normal';
        el._tint.style.background = 'rgb(' + r + ',' + g + ',' + b + ')';
        // trans_glow 是整块半透明矩形，不叠径向衰减会把画面糊成一片
        const maskImg = isGlow
          ? 'radial-gradient(ellipse 78% 130% at 50% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.15) 38%, rgba(0,0,0,0.85) 72%, #000 100%), url("' + murl + '")'
          : 'url("' + murl + '")';
        el._tint.style.webkitMaskImage = maskImg;
        el._tint.style.maskImage = maskImg;
        const maskSize = isGlow ? '100% 100%, 100% 100%' : '100% 100%';
        el._tint.style.webkitMaskSize = maskSize;
        el._tint.style.maskSize = maskSize;
        el._tint.style.webkitMaskRepeat = isGlow ? 'no-repeat, no-repeat' : 'no-repeat';
        el._tint.style.maskRepeat = el._tint.style.webkitMaskRepeat;
        el._tint.style.webkitMaskComposite = isGlow ? 'source-in' : '';
        el._tint.style.maskComposite = isGlow ? 'intersect' : '';
        el._tint.style.opacity = '1';
        el._tint.style.display = 'block';
        imgEl.style.visibility = 'hidden';
      } else if (el._tint) {
        el._tint.style.display = 'none';
        if (imgEl) imgEl.style.visibility = '';
      }
    }

    autoLayoutText();
  }

  /** 文本自动排布：同一父节点下的多个文本按内容宽水平居中排列（原版 HorizontalLayoutGroup）。 */
  function autoLayoutText() {
    const groups = {};
    for (const path of order) {
      const d = NODES[path], el = els[path];
      if (!d || !d.isText) continue;
      if (el.style.display === 'none') continue;
      const segs = path.split('/');
      const pp = segs.slice(0, -1).join('/');
      (groups[pp] = groups[pp] || []).push(path);
    }
    for (const pp of Object.keys(groups)) {
      const kids = groups[pp];
      if (kids.length < 2) continue;
      const pd = NODES[pp];
      if (!pd) continue;
      const pw = Math.abs(pd.s ? pd.s[0] : 0);
      if (pw <= 0) continue;

      // ★ 字宽优先用**实测**（span 已挂载，scrollWidth 是真实排版宽），估算只作兜底。
      //   估算 estimateTextWidth 把数字记 0.56em、"/" 记 0.32em，而实际渲染的数字约 0.59em、
      //   "/" 约 0.39em ⇒ 三个字加起来少算 4px，于是 cur / splitter / total 互相压住
      //   （实测 0: 右缘 261.8 vs "/" 左缘 258 = 重叠 3.8px，就是用户说的「数字排版太挤」）。
      const widths = [];
      let total = 0;
      for (const p of kids) {
        const el = els[p], span = el.querySelector('span');
        const fs = NODES[p].fs || 20;
        const txt = span ? span.textContent : '';
        // scrollWidth 含小数被取整，多给 1px 余量；空串仍走 0
        const measured = span && txt ? Math.ceil(span.scrollWidth) : 0;
        const wd = measured > 0 ? measured : estimateTextWidth(txt, fs);
        widths.push(wd);
        total += wd;
      }
      if (total <= 0) continue;

      // ★ 垂直基准：同一个父节点下所有文本必须共用同一条基线。
      //   原版 HorizontalLayoutGroup 只负责横向，纵向由各自 RectTransform 决定；
      //   但协同态的 text_current / text_total 是 width=0 的零宽锚点，layout() 里
      //   (1-pvy)*h 在 h 被 autoLayout 改写前后不一致，会把数字顶到胶囊外面
      //   （实测 text_current 底边 60.23 > 胶囊 56，被 root_mask 裁掉一半 = 用户报的 bug）。
      //   这里统一按父节点几何重算一次纵向，保持横向结果不变。
      const pdOffY = (0.5 - pd.amn[1]) * Math.abs(pd.s ? pd.s[1] : CAP_H) - (pd.p ? pd.p[1] : 0);
      // ★ 字距：原版这三个文本的 m_Spacing = 0，但 span 的 ink 边界比字形框窄，
      //   实测 scrollWidth 相加后仍会贴在一起（0 与 / 之间只剩 0.6px）。给 1px 视觉间隙，
      //   视觉上与原版一致，且彻底消除重叠。
      const GAP = kids.length > 1 ? 1 : 0;
      const spanW = total + GAP * (kids.length - 1);
      let cursor = (pw - spanW) / 2;
      kids.forEach((p, i) => {
        const el = els[p], wd = widths[i], nd = NODES[p];
        // ★ `left` 是**左边缘**（layout() 里写的是 offX = ... - pvx*w，pivot 已扣掉），
        //   所以这里必须用 cursor - pw/2；原先写成 cursor + wd/2 - pw/2 等于把每个元素
        //   再右推自己半个宽 ⇒ 相邻两字必然重叠 (wd2-wd)/2。
        //   实测 0/8：cur 宽 12、split 宽 8 ⇒ 重叠 (8-12)/2 + GAP = -1px，
        //   与「数字排版太挤」完全吻合。
        el.style.left = 'calc(50% + ' + (cursor - pw / 2) + 'px)';
        el.style.width = wd + 'px';
        // 纵向：零宽/零高锚点的节点按父节点基准对齐，其余保持 layout() 已算好的值
        if (!(Math.abs(nd.s[0]) > 0)) {
          const hh = Math.abs(nd.s[1]) || 34.45;
          el.style.height = hh + 'px';
          el.style.top = 'calc(50% + ' + (pdOffY - (1 - nd.pv[1]) * hh) + 'px)';
        }
        cursor += wd + GAP;
      });
    }
  }

  function startClip(key, grp) {
    curKey = key;
    curGrp = grp;
    const clip = CLIPS[key];
    dur = 0;
    if (clip) for (const c of clip.c) if (c.k.length) dur = Math.max(dur, c.k[c.k.length - 1][0]);
    tAcc = 0;
    last = 0;
    paused = false;
  }

  function tick(ts) {
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    // 定格（freeze）后不得再推进：否则外部想对比某一帧时会被 rAF 冲掉
    if (active && curKey && !paused && tAcc < dur) {
      tAcc = Math.min(tAcc + dt, dur);
      layout(curKey, tAcc);
    }
    raf = requestAnimationFrame(tick);
  }

  return {
    /** 建 DOM 并开 rAF（不播放，等 play）。 */
    init() {
      build();
      layout('trans_rest', 0);
      if (!raf) raf = requestAnimationFrame(tick);
    },
    /** 切到第 i 态并从头播放。 */
    play(i) {
      const st = TRI_STATES[i];
      if (!st) return;
      startClip(st.key, st.grp);
      layout(st.key, 0);
    },
    /** 停播并定格到 t。 */
    freeze(t) {
      if (!curKey) return 0;
      paused = true;
      tAcc = Math.min(Math.max(0, t), dur);
      layout(curKey, tAcc);
      return tAcc;
    },
    /** 只让本引擎跑 rAF（另一个引擎静默，避免空转）。 */
    setActive(v) { active = !!v; if (active) last = 0; },
    /**
     * 漏怪标签（tag_miss）整组的显示开关。
     * ★ 不给（或给 null）= 沿用原版曲线（trans_battle 末帧 m_Alpha = 1，即永显）。
     *   给 false = 整组压掉，连底图一起 —— 这就是「漏了才显示」。
     *   true 与 null 画面完全一致，保留 true 只是为了调用方语义清楚。
     * @param {boolean|null} v
     */
    setMiss(v) {
      const next = v === false ? false : null;
      if (showMiss === next) return;
      showMiss = next;
      if (curKey) layout(curKey, tAcc);
    },
    /** 外部喂文本：{ 节点路径: 字符串 }，只改有变化的，避免每帧写 DOM。 */
    setText(map) {
      for (const path of Object.keys(map)) {
        const el = els[path];
        if (!el || !el._span) continue;
        const v = map[path] == null ? '' : String(map[path]);
        if (el._span.textContent !== v) el._span.textContent = v;
      }
      if (curKey) layout(curKey, tAcc);
    },
    /** 只重新排一次（文本宽变了但不想推进时间时用）。 */
    relayout() { if (curKey) layout(curKey, tAcc); },
    state() { return { key: curKey, grp: curGrp, t: tAcc, dur, nodes: order.length, curves: curClipCount(curKey) }; },
    nodes() { return els; },
    destroy() { if (raf) cancelAnimationFrame(raf); raf = null; host.innerHTML = ''; },
  };

  function curClipCount(key) {
    const clip = CLIPS[key];
    return clip && clip.c ? clip.c.length : 0;
  }
}
