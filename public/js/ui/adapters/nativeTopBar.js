// ui/adapters/nativeTopBar.js — 局内顶栏的**原生布局渲染器**（第 28 轮移植）。
//
// ══════════════════════════════════════════════════════════════════════════════════
// 为什么走这条路线（有完整证据，不是猜）
// ══════════════════════════════════════════════════════════════════════════════════
// 线上顶栏不是 DOM，而是一个 Unity 原生 HUD：
//   `.native-hud-center` 实测 800×156 设计尺寸，scale = 视口高/720（914/1.26944 = 720.0）。
//
// 直接引线上 `regulationBattleThemeHud20261110.js` 的代价（用闭包脚本实测）：
//   闭包 104 文件、本地缺 46 个 —— 含整条音频链（12+）、媒体链、Spine、Three.js 开场特效。
//   其中 `Picker` 拖进 `regulationThemeAudio`、`ClosurOpeningStars` 拖进 `regulationNativeIntroWebGL`。
//   而「画顶栏」根本不需要音频与开场特效。
//
// ★ 关键发现：真正的 UI 定义在 **`ac_n_initial.json`（203KB packet）** 里，它是自描述的：
//   · `viewport: {width:800, height:156}` —— 与实测完全吻合
//   · `nodes`：145 个节点，每个自带完整 RectTransform（anchor/pivot/anchoredPos/sizeDelta/scale/rotation）
//   · 每个 image 自带 `sprite.url` + 九宫格 `border` + sha256
//   · `scriptBindings`：24 条数据绑定（回合数、生命值、敌人计数、boss 血条…）
//   · `statuses`：7 种状态（rest/battle/coop/boss × settled）
//   · `root` 单根可遍历出 **145/145** 节点，无孤儿
//   ⇒ **只需「packet + 47 张 sprite + 本渲染器」，不需要那 46 个 JS。**
//
// ══════════════════════════════════════════════════════════════════════════════════
// 边界（严格遵守用户要求）
// ══════════════════════════════════════════════════════════════════════════════════
// · 只读本地 packet；只读 store 已有的 pub 数据；不改任何游戏状态与协议
// · 不碰 game.css / theme.css / components.js；样式全部内联在这一个模块里
// · 不改 bountySkin.js（已验收），不碰悬赏界面
// · 数据缺失时显式返回 null / 分支回退，**绝不编造数值**

import { html } from '../components.js';
import { useRef, useState, useEffect } from '../../../vendor/hooks.module.js';
import { Sprite } from '../gameComponents.js';
import { t } from '../../../../shared/i18n.js';
// 第 105 轮：胶囊内容槽换成原版四态动画（休整 / 作战 / 协同 / BOSS）。
// ★ 只替换 group_mid_screen 这一层的内容，root_frame（482×56 外框）与两侧圆环仍由 packet 画。
import { CapsuleFourState, TRI_TEXT, BOSS_TEXT, BOSS_BAR } from '../capsule/CapsuleFourState.js';

/** 阶段常量（与 shared/constants.js 的 PHASE 逐字同值，已核对）。只用于判场景，不 import 以免循环依赖。 */
const P_ROUND_START = 'ROUND_START';
const P_COMBAT = 'COMBAT';
const P_UNITE = 'UNITE';
const P_PREP = 'PREP';
const P_SP_DRAFT = 'SP_DRAFT';
const P_RESULT = 'RESULT';

/**
 * 该播哪个胶囊场景 —— 与 hud.js 的 `capsuleFxKind` **逐条同义**（那边是旧顶栏用的）。
 * 不直接 import 那个函数：hud.js 已经 import 了本文件，反向 import 会形成循环依赖。
 * @param {string|null|undefined} phase @param {string|null|undefined} prev
 * @returns {'wait'|'rest'|'clash'|'unite'|'enter'|null}
 */
function sceneKind(phase, prev) {
  if (!phase || phase === P_RESULT) return null;
  if (phase === P_ROUND_START) return 'wait';
  if (phase === P_COMBAT) return 'clash';
  if (phase === P_UNITE) return 'unite';
  // 休整期：回合开始之后进入休整 —— 三个水壶向上飞走
  if (prev === P_ROUND_START && (phase === P_PREP || phase === P_SP_DRAFT)) return 'rest';
  return 'enter';
}


/**
 * 胶囊场景动画（官方 `hudPanel/trans_*` 精灵）。
 *
 * ★ 为什么在这里重建而不是 import hud.js 的那个：
 *   `CapsuleScene` 是 hud.js 的内部函数（未导出），且它渲染出的 DOM 依赖 `.gtop__cap` 那套作用域；
 *   原生顶栏的容器是 `.native-hud-center`，拿不到那些选择器。
 *   这里按**同一份精灵、同一套 CSS 类名（capfx*）**重建，视觉与旧顶栏完全一致，
 *   区别只是把作用域从 `.gtop__cap` 扩展到了 `.nth-capfx-scene`（见 topbar-reference.css）。
 *
 *   四种场景（与 capsuleFxKind 的语义逐条对齐）：
 *     wait   回合开始 —— 三个水壶（trans_cup）依次落下一个并晃动
 *     rest   休整期 —— 三个水壶向上飞走
 *     clash  作战 —— 机器人持剑落下、怪物从右侧跳入，相遇处双剑交叉、弹出「开始作战」
 *     unite  联防 —— 同上但橙色，且机器人变成两张联防脸
 */
function CapScene({ kind }) {
  const trans = (n, cls) => html`<${Sprite} k=${`hudPanel/trans_${n}`} class=${cls} />`;
  if (kind === 'wait' || kind === 'rest') {
    return html`<span class=${`capfx capfx--${kind}`} aria-hidden="true">
      ${[0, 1, 2].map((i) => html`<span key=${i} class="capfx__k" style=${`--i:${i}`}>${trans('cup')}</span>`)}
    </span>`;
  }
  const unite = kind === 'unite';
  const c = unite ? 'coop' : 'batte';
  return html`<span class=${`capfx capfx--${kind}`} aria-hidden="true">
    <span class="capfx__meet">
      <span class="capfx__us">
        <span class="capfx__bot">${trans(`${c}2`, 'capfx__sword')}${trans(`${c}1`, 'capfx__body')}</span>
        ${unite ? html`<span class="capfx__faces">${trans('coop4', 'capfx__face')}${trans('coop3', 'capfx__face')}</span>` : null}
      </span>
      <span class="capfx__foe">${trans(unite ? 'worm2' : 'worm1')}</span>
    </span>
    <span class="capfx__clash">
      <span class="capfx__swords">${trans(`${c}2`, 'capfx__x')}${trans(`${c}2`, 'capfx__x capfx__x--flip')}</span>
      <b class="capfx__word">${unite ? t('联防开始') : t('开始作战')}</b>
    </span>
  </span>`;
}


/**
 * 由 status 合成完整 patches —— **内置，不依赖调用方拼装**。
 *
 * 踩过的坑：最初让调用方自己拼 patches，漏了 statuses 里的 active:false 与 colorChannel，
 * 结果 `hud_rest` 下 boss 血条没有被隐藏，顶栏露出红色条。
 * 现在统一在这里合成，调用方只需给 status。
 *
 * 同一 nodeId 可能有多条 patch（如 root_icon 出现两次），按出现顺序合并。
 * @param {any} packet @param {string} status
 */
export function buildPatches(packet, status) {
  const rows = packet?.statuses?.[status] || [];
  const out = {};
  for (const row of rows) {
    const patch = row?.patch;
    if (!patch) continue;
    const cur = out[row.nodeId] || {};
    const next = { ...cur, ...patch };
    // colorChannel 是 ['a', 0] 形式，折叠成 colorChannels.a
    if (Array.isArray(patch.colorChannel)) {
      const [axis, v] = patch.colorChannel;
      next.colorChannels = { ...(cur.colorChannels || {}), [axis]: v };
      delete next.colorChannel;
    }
    if (Array.isArray(patch.rectChannel)) {
      const [field, axis, v] = patch.rectChannel;
      next.rectChannels = { ...(cur.rectChannels || {}), [field]: { ...(cur.rectChannels?.[field] || {}), [axis]: v } };
      delete next.rectChannel;
    }
    if (Array.isArray(patch.rectObjects)) {
      const [field, v] = patch.rectObjects;
      next.rectObjects = { ...(cur.rectObjects || {}), [field]: { ...v } };
      delete next.rectObjects;
    }
    out[row.nodeId] = next;
  }

  // ★ 隐藏要**沿父子链传播**：packet 里同一面板有大量同名节点
  //   （group_normal ×5、icon ×9、bg_trans ×7，分属 group_boss / root_mask / root_frame 等不同父级），
  //   statuses 只关掉其中一个 id，其余兄弟仍会画出来 —— 这是胶囊重影的真正来源。
  //   按 name/size 广播会误伤别面板的同名节点（已试过，行不通），必须按子树传播。
  const hideSubtree = (id) => {
    const n = packet?.nodes?.[id];
    if (!n) return;
    for (const c of n.children || []) {
      const cid = typeof c === 'string' ? c : c.id;
      out[cid] = { ...(out[cid] || {}), active: false };
      hideSubtree(cid);
    }
  };
  for (const [id, p] of Object.entries(out)) {
    if (p.active === false) hideSubtree(id);
  }
  return out;
}

/** packet 的公开路径（与线上同源命名，便于对照）。 */

/**
 * 应用 rectChannel / rectObjects 补丁到 Unity rect（与线上 regulationNativeRectStyle20261110 同义）。
 * patch 形如 rectChannel: ['m_AnchoredPosition','x',22] 或 rectObjects: ['m_SizeDelta',{x,y}]。
 * @param {any} rect @param {any} patch
 */
export function applyRectPatch(rect, patch) {
  if (!rect) return rect;
  const out = { ...rect };
  // buildPatches 折叠后的复数形式
  // ★ patch 里给的是 **Unity 原始坐标**（y 向上为正），直接替换原值即可；
  //   y 轴反转由 rectStyle 的 `-v.y` 统一负责 —— 这里再反一次就重复了（会导致上下颠倒）。
  if (patch?.rectChannels) {
    for (const [field, axes] of Object.entries(patch.rectChannels)) {
      if (!out[field]) continue;
      out[field] = { ...out[field], ...axes };
    }
  }
  if (patch?.rectObjects) {
    for (const [field, v] of Object.entries(patch.rectObjects)) {
      out[field] = { ...(out[field] || {}), ...v };
    }
  }
  if (Array.isArray(patch?.rectChannel)) {
    const [field, axis, v] = patch.rectChannel;
    if (out[field] && axis in out[field]) out[field] = { ...out[field], [axis]: v };
  }
  if (Array.isArray(patch?.rectObjects)) {
    const [field, v] = patch.rectObjects;
    out[field] = { ...(out[field] || {}), ...v };
  }
  return out;
}


/** 主题字体（与线上同名）：从 packet 的 text.family 来，缺字体时字宽/字重会明显不同。 */
const FONT_FAMILY = 'Novecentowide-Medium';
const FONT_URL = '/assets/regulation-ui-20261110/battle-themes/fonts/Novecentowide-Bold.ttf';
const FONT_STYLE_ID = 'native-topbar-font';

/**
 * 注入 @font-face（幂等）。**只在原生顶栏真正渲染时调用**，不放到模块顶层，
 * 避免任何 import 到本模块的页面都去下字体。
 */
export function installTopBarFont() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FONT_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = FONT_STYLE_ID;
  st.textContent = `@font-face{font-family:'${FONT_FAMILY}';src:url('${FONT_URL}') format('truetype');font-weight:400 800;font-style:normal;font-display:swap}`;
  document.head.append(st);
}

export const PACKET_URL = '/assets/regulation-ui-20261110/battle-themes/ac_n_initial.json';

/**
 * Unity RectTransform → CSS 绝对定位。
 *
 * 与线上 `regulationNativeRectStyle20261110` 同一套公式（我从镜像源码抄的算法，非猜测）：
 *   left   = anchorMin.x*100% + (anchoredPos.x - pivot.x*sizeDelta.x)
 *   top    = (1-anchorMax.y)*100% + (-anchoredPos.y - (1-pivot.y)*sizeDelta.y)
 *   width  = (anchorMax.x-anchorMin.x)*100% + sizeDelta.x
 *   height = (anchorMax.y-anchorMin.y)*100% + sizeDelta.y
 *
 * @param {any} rect packet 节点里的 rect
 * @returns {object|null} CSS 样式；rect 不完整时返回 null（调用方跳过该节点，不猜）
 */
export function rectStyle(rect) {
  const a = rect?.m_AnchorMin, b = rect?.m_AnchorMax, p = rect?.m_Pivot;
  const d = rect?.m_SizeDelta, v = rect?.m_AnchoredPosition;
  if (!a || !b || !p || !d || !v) return null;
  const s = rect.m_LocalScale || { x: 1, y: 1 };
  const q = rect.m_LocalRotation || { z: 0, w: 1 };
  const rot = -2 * Math.atan2(q.z, q.w) * 180 / Math.PI;
  return {
    position: 'absolute',
    left: `calc(${a.x * 100}% + ${v.x - p.x * d.x}px)`,
    top: `calc(${(1 - b.y) * 100}% + ${-v.y - (1 - p.y) * d.y}px)`,
    width: `calc(${(b.x - a.x) * 100}% + ${d.x}px)`,
    height: `calc(${(b.y - a.y) * 100}% + ${d.y}px)`,
    transformOrigin: `${p.x * 100}% ${(1 - p.y) * 100}%`,
    transform: `rotate(${rot}deg) scale(${s.x}, ${s.y})`,
    boxSizing: 'border-box',
  };
}

/** 9-slice 用 border-image 还原（sprite 自带 border，缺失时退回普通背景图）。 */
function imageStyle(sprite, alpha) {
  if (!sprite?.url) return null;
  const b = sprite.border;
  const hasSlice = b && (b.x || b.y || b.z || b.w);
  // border 全 0 时走背景图拉伸分支：这张图（如 bg_round 35×18）本身就是圆角的，
  // 直接 background-size:100% 100% 会把它拉成直角块。用 9 宫格等分拉伸能保住圆角。

  const style = { opacity: alpha ?? 1 };
  if (hasSlice) {
    // ★ 顺序必须转：Unity border = {left:x, bottom:y, right:z, top:w}
    //   CSS border-image-slice / -width 的顺序 = top right bottom left。
    //   之前直接写 `${b.x} ${b.z} ${b.y} ${b.w}`（left right bottom top），
    //   结果上下边被塞了 5px 的切片、左右反而没有 —— 九宫格边缘的亮像素被拉满整块，
    //   表现就是「黑色背景偏亮 / 有多余边线」。
    const bTop = b.w || 0, bRight = b.z || 0, bBottom = b.y || 0, bLeft = b.x || 0;
    style.borderImageSource = `url("${sprite.url}")`;
    style.borderImageSlice = `${bTop} ${bRight} ${bBottom} ${bLeft} fill`;
    style.borderImageWidth = `${bTop}px ${bRight}px ${bBottom}px ${bLeft}px`;
    style.borderImageRepeat = 'stretch';
    style.borderWidth = `${bTop}px ${bRight}px ${bBottom}px ${bLeft}px`;
    // ★ border-image 必须配合非 none 的 border-style 才会绘制（CSS 硬性要求）。
    //   漏了这一条 ⇒ 九宫格边框完全不可见，整条顶栏只剩文字（接入后第一版就是这个症状）。
    style.borderStyle = 'solid';
    style.borderColor = 'transparent';
  } else {
    // ★ border 全 0 的图（如 bg_round 35×18、bg_rest 157×45）本身带圆角，
    //   直接 background-size:100% 100% 会把圆角糊成直角块，所以用九宫格 slice 保住圆角。
    //
    //   ⚠ 切边不能简单取「图宽/3、图高/3」：
    //     对小图（35×18 → 11×6）还行，对大图是灾难 ——
    //     bg_rest 是 157×45 ⇒ slice 变成 15 52，左右各切 52px 只剩 53px 中间带，
    //     整张底板几乎被切空。这正是「场景动画后面没有背景」的直接原因。
    //   修法：切边按**圆角半径**取，并把上限压到短边 1/4 以内，小图仍走原来的比例（保持已验收的外观不变）。
    const sw = sprite.w || 0, sh = sprite.h || 0;
    if (sw >= 9 && sh >= 9) {
      const minSide = Math.min(sw, sh);
      // 只有**极小图**（短边 < 20，如 bg_round 35×18、血条 193×11）保留 1/3 比例；
      // 其余一律用固定圆角半径 8px —— 按比例切大图会把主体切空（见上面的说明）。
      const inset = minSide < 20 ? Math.round(minSide / 3) : Math.max(2, Math.min(8, Math.floor(minSide / 4)));
      style.borderImageSource = `url("${sprite.url}")`;
      style.borderImageSlice = `${inset} ${inset} fill`;
      style.borderImageWidth = `${inset}px`;
      style.borderImageRepeat = 'stretch';
      style.borderWidth = `${inset}px`;
      style.borderStyle = 'solid';
      style.borderColor = 'transparent';
    } else {
      style.backgroundImage = `url("${sprite.url}")`;
      style.backgroundSize = '100% 100%';
      style.backgroundRepeat = 'no-repeat';
    }
  }
  return style;
}

/**
 * 形状内省：遍历 packet，统计每个节点的可渲染要素。
 * 用于**先验证数据完整性再渲染**，避免"看起来渲染了其实全是空 div"。
 * @param {any} packet
 */
export function inspectPacket(packet) {
  if (!packet?.nodes || !packet.root) return null;
  let nodes = 0, withImage = 0, withText = 0, hidden = 0, rectFail = 0;
  const walk = (id) => {
    const n = packet.nodes[id];
    if (!n) return;
    nodes++;
    if (!rectStyle(n.rect)) rectFail++;
    if (n.image?.sprite?.url) withImage++;
    if (typeof n.text === 'string' && n.text) withText++;
    if (n.active === false) hidden++;
    for (const c of n.children || []) walk(typeof c === 'string' ? c : c.id);
  };
  walk(packet.root);
  return {
    nodes,
    withImage,
    withText,
    hidden,
    rectFail,
    bindings: (packet.scriptBindings || []).length,
    statuses: Object.keys(packet.statuses || {}),
    viewport: packet.viewport,
  };
}

/** 状态选择：与线上 `regulationNativeHudStatus20261110` 同名同义（我抄的规则，非臆造）。 */
export function hudStatus(phase, settled = false) {
  const P = {
    COMBAT: 'COMBAT', SETTLE: 'SETTLE', UNITE: 'UNITE',
    FINAL_ASSAULT: 'FINAL_ASSAULT', HIDDEN_CORE: 'HIDDEN_CORE', PREP: 'PREP',
  };
  const isBoss = [P.FINAL_ASSAULT, P.HIDDEN_CORE].includes(phase);
  const isBattle = [P.COMBAT, P.SETTLE].includes(phase);
  const key = isBoss ? 'hud_boss' : phase === P.UNITE ? 'hud_coop' : isBattle ? 'hud_battle' : 'hud_rest';
  return settled ? `${key}_settled` : key;
}

/** 主题 packet 缓存（一次取回，多次渲染共用）。 */
let cache = null;
let pending = null;

/**
 * 取 packet。失败时**显式返回 null**，调用方回退到本地 DOM 顶栏 ——
 * 不做"假装渲染成功"，也不在失败时用假数据填充。
 */
export function loadPacket() {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch(PACKET_URL, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j?.nodes && j?.root) { cache = j; return j; } return null; })
    .catch(() => null)
    .finally(() => { pending = null; });
  return pending;
}

/** 测试/热重载用：丢掉缓存。 */
export function resetPacketCache() { cache = null; pending = null; }

/**
 * 渲染一个节点子树为 Preact 树。
 * 缺失 rect 的节点整体跳过（宁可少画，也不叠错位）。
 */
function renderNode(packet, id, patches, keyPrefix, inFlex = false, onNodeClick = null, fxSeq = 0, capSlot = null, parentName = '') {
  const n = packet.nodes[id];
  if (!n) return null;

  // ★ 胶囊内容槽（第 105 轮）：group_mid_screen 是 482×56（= 引擎设计空间），
  //   原先由 packet 画旧的三组（rest/battle/coop 各 157×45）。现在这一层的**内容**交给四态引擎，
  //   节点本身仍保留（它是定位盒：设计坐标 L159 T46 482×56，已在 800×156 画布内按 scale 缩放）。
  //   只换内容、不换盒子 —— 位置/尺寸/缩放链路一个字都不用改。
  if (capSlot && n.name === 'group_mid_screen') {
    const slotBase = rectStyle(n.rect);
    if (!slotBase) return null;
    return html`<div key=${keyPrefix + id} class="nth-node nth-capslot" data-nid="group_mid_screen" style=${slotBase}>
      <${CapsuleFourState} boss=${capSlot.boss} tri=${capSlot.tri} width=${capSlot.w}
        title=${capSlot.title} ariaLabel=${capSlot.ariaLabel} playKey=${capSlot.playKey}
        text=${capSlot.text} bossText=${capSlot.bossText} hpFrac=${capSlot.hpFrac}
        showMiss=${capSlot.showMiss}>${capSlot.semantics}<//>
    </div>`;
  }

  // ★ 不再让位（第 109 轮纠正）—— root_frame/group_normal/mid 不是「静态胶囊底衬」，
  //   它就是用户报的「胶囊外上下方的两根连接线」。
  //   实测证据（frame_mid_normal.png，183×34 RGBA 逐像素 alpha）：
  //     y=0..2   有上半条带（最宽 85/183）、y=32..33 有下半条带（146/183）、
  //     **y=17..23 完全透明**（中间镂空）；全图无一个全不透明像素。
  //     → 它是上下两根横线，不是实心底块；RGB 纯白靠 group_normal 的 m_Color 染色。
  //   几何闭环：left 149.5 + mid 183 + right 149.5 = 482 = root_frame 整宽 —— 三段拼成同一条线。
  //   第 105 轮把 mid 整格 return null 属于误伤（当时要消除的「多套动画」是 .nth-scene 的旧 CapScene，
  //   已由 NativeTopBar 里 `playScene && !capSlot` 那一行彻底关掉）。frame_mid_boss.png 同理（同样中间透明、也是线）。

  // ★ 可见性判定（两处坑都踩过）：
  //   packet 里节点的 `active` 是**导出时的初始状态**，很多组（如 group_rest）初始是 false，
  //   要靠 statuses 的 patch `{active:true}` 在运行时打开。
  //   所以：先看 patch.active（明确指定优先），没指定才回退到 n.active。
  //   —— 之前写成 `if (n.active === false) return null`，把一个本该显示的组直接丢掉了。
  const patch = patches?.[id] || null;
  const wantActive = patch && typeof patch.active === 'boolean' ? patch.active : n.active !== false;
  if (!wantActive) return null;

  // 先套用 rectChannel（改尺寸/位置，单位是 Unity 像素）
  // ⚠ 这里必须同时认 rectChannels（buildPatches 折叠后的复数）与 rectChannel/rectObjects（原始单数）三处。
  //   之前只判 rectChannel/rectObjects，而 buildPatches 输出的是 rectChannels ⇒ applyRectPatch 从未被调用，
  //   所有 rect 补丁（cup 的上移、icon 的 x 位移…）全部失效 —— 这是「胶囊里多出三条浅色杯子」的根因。
  const hasRectPatch = !!(patch?.rectChannels || patch?.rectChannel || patch?.rectObjects);
  const rect = hasRectPatch ? applyRectPatch(n.rect, patch) : n.rect;
  const base = rectStyle(rect);
  if (!base) return null;
  // 在 flex 父容器里时改为静态流式定位（保留尺寸，去掉坐标）
  if (inFlex) {
    // 去掉绝对坐标，改流式；但**保留 sizeDelta 算出的尺寸** ——
    // Unity 里子节点的 sizeDelta 就是它的实际宽高（root_hp 那种 0 宽是靠 fitter 撑开的例外）。
    const d = n.rect?.m_SizeDelta;
    for (const k of ['position', 'left', 'top']) delete base[k];
    base.position = 'relative';
    base.flex = '0 0 auto';
    base.margin = '0';
    // ★ sizeDelta.x === 0 的真实含义：宽度由**内容**决定（Unity m_ChildControlWidth:1）。
    //   · 有 sprite  → 取 sprite 的原始 w/h（icon_hp 是 12×19）
    //   · 有文本    → 交给文字自然宽度（white-space:nowrap 已保证不换行）
    //   之前把它当 0 宽写死，才导致「11 旁边的生命图标消失」。
    const sp = n.image?.sprite;
    if (d && d.x > 0) base.width = `${d.x}px`;
    else if (sp && sp.w > 0) base.width = `${sp.w}px`;
    else if (n.text) { base.width = 'auto'; base.minWidth = '0'; }  // 纯文本：由文字撑开
    if (d && d.y > 0) base.height = `${d.y}px`;
    else if (sp && sp.h > 0) base.height = `${sp.h}px`;
  }

  const style = { ...base };
  // ★ Unity LayoutGroup 支持（packet 里 5 个节点全是 HorizontalLayoutGroup）。
  //   这些节点自身 sizeDelta.x 常为 0（宽度由布局算出），若仍用绝对定位会把子节点压成 0 宽 ——
  //   这正是「11 旁边的图标不见了」的根因。改成 flex 行，由内容撑开宽度。
  const lay = n.layout && n.layout.type === 'HorizontalLayoutGroup' ? n.layout : null;
  if (lay) {
    const pad = lay.m_Padding || {};
    style.display = 'flex';
    style.flexDirection = 'row';
    style.alignItems = 'center';
    style.gap = `${lay.m_Spacing || 0}px`;
    // ★ Unity 的 m_ChildAlignment 必须映射到 justify-content，否则内容靠左排、整体偏移。
    //   0 左上 1 上 2 右上 3 左 4 中 5 右 6 左下 7 下 8 右下（水平分量看 al%3）
    const ca = lay.m_ChildAlignment;
    if (Number.isInteger(ca)) {
      style.justifyContent = ca % 3 === 0 ? 'flex-start' : (ca % 3 === 2 ? 'flex-end' : 'center');
    }
    style.padding = `${pad.m_Top || 0}px ${pad.m_Right || 0}px ${pad.m_Bottom || 0}px ${pad.m_Left || 0}px`;
    // ★ ContentSizeFitter m_HorizontalFit:2（preferredSize）：宽度由内容撑开。
    //   线上用的是 `width: max-content` + `translateX(-50%)` 组合 ——
    //   容器先按内容定宽，再以**自身宽度的一半**回退居中。
    //   之前只写了 width:auto，缺少 translateX(-50%) 的补偿，
    //   导致「回合」整组比线上右移约 41px。
    if (n.fitter?.m_HorizontalFit === 2) {
      style.width = 'max-content';
      style.minWidth = 0;
      const t = style.transform || '';
      style.transform = `translateX(-50%) ${t}`.trim();
    }
  }
  // ★ Unity Mask/RectMask：`clip:true` 的节点要把超出自身矩形的内容裁掉。
  //   胶囊里的 icon 是 44×71，而胶囊只有 46 高 —— 没有裁剪时它会拖出一根青色竖条，
  //   表现为「绿色小人被拉出胶囊底部」。线上靠 root_mask 的 clip 遮住。
  if (n.clip === true) {
    style.overflow = 'hidden';
    // showMaskGraphic:true 表示遮罩自身可见（有背景图时照常画）；false 则只做裁剪不显示
    if (n.showMaskGraphic === false) style.background = 'none';
  }

  // 套用 colorChannel：'a' 就是整体不透明度，其它通道先按 alpha 处理
  // ★ alpha 要作用在**节点本身**，不能只塞给图片层。
  //   packet 用 `alpha:0` 隐藏整组（如 group_trans 隐藏三个叠加杯子），
  //   之前只把 alpha 传给 imageStyle，没有 sprite 的组就完全不受影响 ⇒ 杯子全露出来、与文字叠成重影。
  const colorAlpha = patch?.colorChannels?.a;
  const effAlpha = colorAlpha != null ? colorAlpha : (patch?.alpha ?? n.alpha);
  if (effAlpha != null && effAlpha !== 1) style.opacity = effAlpha;
  if (effAlpha === 0) style.visibility = 'hidden';
  const img = imageStyle(n.image?.sprite, effAlpha);
  if (img) Object.assign(style, img);

  // ★★ Boss 血条填充（第 36 轮）。
  //   packet 里 `hp_slider`（193×11）的 Fill 子节点是 Unity 的 **Image type=Filled**
  //   （实测 Fill 的 sizeDelta = 0×0、sprite 是纯白 white_sprite），靠 fillAmount 控制可见宽度。
  //   之前渲染端**完全没有实现 sliderFill** ⇒ 数据算得再对，血条也一像素不动
  //   —— 这就是「Boss 血量显示不正常」的直接原因。
  //   实现：把 Fill 的宽度设成 slider 的 ratio（direction 0 = 从左往右）。
  //   ⚠ 百分比要相对**父级 slider** 算，所以这里显式 left/top 归零并铺满高度，
  //     避免 rectStyle 给出的 0×0 sizeDelta 把元素压成不可见。
  if (patch?.sliderFill && typeof patch.sliderFill === 'object') {
    const { ratio = 0, direction = 0 } = patch.sliderFill;
    const r = Math.max(0, Math.min(1, Number(ratio) || 0));
    style.position = 'absolute';
    style.top = '0';
    style.height = '100%';
    if (direction === 1) {
      style.right = '0';
      style.left = 'auto';
    } else {
      style.left = '0';
      style.right = 'auto';
    }
    style.width = `${(r * 100).toFixed(3)}%`;
  }

  // ★ 关键区分：Unity 的 HorizontalLayoutGroup **只排布 anchorMin.x===0 的"流内"子节点**；
  //   锚在 0.5 / 1 的是装饰层或右对齐层（light_mask、glow、root_lost_hp），它们仍叠在绝对位置。
  //   之前把所有子节点都塞进 flex，导致 212 宽的 light_mask 把整行撑到 501，把「11」挤成 0 宽。
  const inFlow = (child) => {
    if (!lay) return false;
    const a = child?.rect?.m_AnchorMin;
    return !!a && a.x === 0 && a.y === 0;
  };
  const kids = (n.children || []).map((c) => {
    const cid = typeof c === 'string' ? c : c.id;
    return renderNode(packet, cid, patches, keyPrefix, inFlow(packet.nodes[cid]), onNodeClick, fxSeq, capSlot, n.name);
  }).filter(Boolean);

  // ★ 显示文本：优先用数据绑定得到的 patch.text；否则回退到节点**自带的静态文本**。
  //   packet 里 `text.value` 就是原始文案（如「回合」），而 `textId` 是可选的 i18n 键。
  //   之前只认 patch.text，导致所有静态文案（回合标签、休息胶囊文字）全部消失 —— 顶栏只剩数字。
  const staticText = n.text && typeof n.text === 'object' ? n.text.value : null;
  const label = patch?.text ?? (staticText != null && staticText !== '' ? staticText : null);

  // 文本样式取自 packet 节点自带的 text 描述（字号/对齐/颜色/字体族），不是硬编码 ——
  // 此前用固定居中样式，导致「3」「11」叠在框中央而非落在原生文本位置。
  const t = n.text || null;
  // Unity 的 m_FontSize 是**设计像素**；容器已整体 scale(视口高/720)，故这里直接用原值，
  // 不能再乘系数（之前乘 0.6 导致「休息一下」被算错，撑满整个胶囊）。
  const fs = t?.font?.m_FontSize || 20;
  const al = t?.font?.m_Alignment;
  // Unity TextAnchor: 0 左上 1 上 2 右上 3 左 4 中 5 右 6 左下 7 下 8 右下
  const justify = al === 1 || al === 4 || al === 7 || al == null ? 'center' : (al === 2 || al === 5 || al === 8 ? 'flex-end' : 'flex-start');
  // Unity TextAnchor: 0 左上 1 上 2 右上 / 3 左 4 中 5 右 / 6 左下 7 下 8 右下
  const align = al === 0 || al === 1 || al === 2 ? 'flex-start' : (al === 6 || al === 7 || al === 8 ? 'flex-end' : 'center');
  const rgb = t?.color
    ? `rgba(${Math.round(t.color.r * 255)}, ${Math.round(t.color.g * 255)}, ${Math.round(t.color.b * 255)}, ${t.color.a ?? 1})`
    : '#e8f6f1';

  // ★ 行盒高度按**文本框高度**撑开，不是按字号。
  //   Unity 里 Text 的 `m_SizeDelta.y` 就是文本框高度（text_hp 是 30），
  //   文字按 `m_Alignment`（4=MiddleCenter）在该框内**垂直居中**；
  //   浏览器等价做法是 `line-height = 框高`，行盒居中后字形自然落在正确基线。
  //
  //   坑：之前写死 `line-height: 1`，行盒 = 字号 20px，而 `.nth-text` 在 inFlex 分支是
  //   `display:block` ⇒ 块级行盒紧贴容器**顶部**，字形比正确位置高出 (h - fs)/2。
  //   text_hp 框高 30、字号 20 ⇒ 高出 5 设计像素（×1.26944 ≈ 6.35 屏幕像素），
  //   实测线上文字层高 38.1、本地只有 25.4，差值 12.7 的一半正是这 6.35 ——
  //   就是用户反复指出的「剩余生命数有点往上」。
  const textBoxH = n.rect?.m_SizeDelta?.y > 0 ? n.rect.m_SizeDelta.y : fs;
  // 仅当文本框本身没有额外布局（无 HorizontalLayoutGroup）时才用框高做行盒，
  // 否则会把整行撑高、破坏 flex 排版。
  const lineHeight = lay ? fs : Math.max(fs, textBoxH);

  // ★ 按钮交互：packet 的 buttons 指向的节点子树（含 hotspot）才是可点区域。
  //   交互元数据不在 packet 里，所以由调用方传入「节点 id → handler」映射；
  //   只有映射里出现过的节点才加 pointer-events，避免挡住整个顶栏的穿透。
  const hit = onNodeClick && onNodeClick[id] ? onNodeClick[id] : null;
  if (hit) {
    style.pointerEvents = 'auto';
    style.cursor = 'pointer';
  }
  // ★ 点击动效（第 72 轮，用户要求：给顶栏左右上角的两个放大镜加点击动效）。
  //   这两个按钮是 .nth-node 透明命中盒，美术来自内联 border-image，动效只能挂在盒子上；
  //   :active 的按下反馈纯 CSS 就够，但「松手后回弹一拍」需要一次性的类名 —— 那必须由 JS 打。
  //   只在 pointerup 时给节点加 .is-tapped，动画跑完（260ms）自己摘掉，不做状态、不进 packet。
  //   用 animationend + 定时兜底两条路：prefers-reduced-motion 下没有 animationend，
  //   定时器保证类名不会永久留在节点上。
  const tapFx = hit && (n.name === 'btn_check_player' || n.name === 'btn_check_enemy')
    ? (e) => {
      const el = e.currentTarget;
      if (!el || el.classList.contains('is-tapped')) return;
      el.classList.add('is-tapped');
      const clear = () => el.classList.remove('is-tapped');
      el.addEventListener('animationend', clear, { once: true });
      setTimeout(clear, 400);
    }
    : null;

  // ★ 胶囊组切换的过渡（第 35 轮 / 按 motion-design 定参）。
  //   packet 的 statuses 只把 group_rest / group_battle 的 `active` 一开一关，Unity 里是**瞬时硬切**——
  //   这就是「休息一下」切到敌人数量时没有过渡的原因。线上靠 native 动画补，本地 DOM 顶栏用 .capfx。
  //   这里给两个组挂上专用类，关键帧写在 topbar-reference.css（复用本地既有 capfx 的风格与缓动）。
  //   参数：同槽位状态切换 = icon transition 级别 150–250ms；进场 ease-out（decelerate），
  //         离场 ease-in 且短 30% ⇒ 进 220ms / 出 150ms；位移只走 45%（组高）× 1/3 以内的 8px，避免大位移。
  const capFx = n.name === 'group_rest' ? 'nth-capfx nth-capfx--rest'
    : (n.name === 'group_battle' ? 'nth-capfx nth-capfx--battle' : '');
  // ★ key 带上 fxSeq：胶囊组切换时强制重新挂载该 DOM，CSS 动画才会从头播放。
  //   （Preact 复用节点时 animation 不会重启 —— 这是「加了类却没动画」最常见的坑。）
  const nodeKey = capFx ? `${keyPrefix}${id}#${fxSeq}` : `${keyPrefix}${id}`;
  return html`<div key=${nodeKey} class=${`nth-node ${capFx}`.trim()} data-nid=${n.name || ''} style=${style}
      onClick=${hit || undefined} onPointerUp=${tapFx || undefined}>
    ${label != null ? html`<span class="nth-text" style=${inFlex
      ? { position: 'relative', display: 'block', fontSize: `${fs}px`, lineHeight: `${lineHeight}px`, color: rgb, fontFamily: `"${FONT_FAMILY}", sans-serif`, fontWeight: '700', whiteSpace: 'nowrap' }
      : { position: 'absolute', inset: '0', display: 'flex', alignItems: align, justifyContent: justify, fontSize: `${fs}px`, lineHeight: `${lineHeight}px`, color: rgb, fontFamily: `"${FONT_FAMILY}", sans-serif`, fontWeight: '700', whiteSpace: 'nowrap' }}>${label}</span>` : null}
    ${kids}
  </div>`;
}

/**
 * 顶栏原生渲染器。
 *
 * `pub` 必须是本地真实 `m.public`；缺字段时**不补假值**，该位置保持原生静态内容。
 * `scale` 由调用方按 视口高/720 计算（与线上一致）。
 *
 * @param {{ packet:any, pub:any, status?:string, scale?:number, patches?:object }} props
 */
export function NativeTopBar({ packet, pub, status = 'hud_rest', scale = 1, patches = null, onNodeClick = null, phase = null, capSlot = null }) {
  // ⚠ 所有 Hooks 必须在**任何提前 return 之前**调用。
  //   packet 是异步 loadPacket() 拿到的：首帧 null（直接 return）→ 次帧有值。
  //   只要有一个 hook 落在 `if (!packet?.nodes) return null;` 之后，
  //   两次渲染的 hook 数量就不同，Preact 会抛 "Rendered fewer hooks than expected"。
  const fxRef = useRef({ group: null, seq: 0, phase: null });
  const [scene, setScene] = useState(null);   // { kind, seq } | null
  const sceneRef = useRef({ phase: null, seq: 0, timer: null });

  // 阶段变化时才判定并起播（放在 effect 里，避免渲染期产生副作用）
  useEffect(() => {
    if (!phase) return;
    const st = sceneRef.current;
    if (st.phase === phase) return;
    const prev = st.phase;
    st.phase = phase;
    const kind = sceneKind(phase, prev);
    if (!kind) return;
    // ★ 'enter'（其它阶段）表示「没有专属场景」—— 此时必须把残留的 wait 收掉，
    //   否则万一路径跳过了 rest（如回合开始直接进结算/其它），水壶会一直挂在那里。
    if (kind === 'enter') {
      if (st.timer) { clearTimeout(st.timer); st.timer = null; }
      setScene(null);
      return;
    }
    const seq = (st.seq += 1);
    // ★★ wait → rest 必须**连成一段**（用户要求）：
    //   回合开始播 wait（三个水壶落下并持续晃动），紧接着的休整期播 rest（水壶向上飞走）。
    //   如果 wait 播完就清空场景，胶囊的内容（绿小人 + 「休息一下」）会在这两段之间**重新露出来**，
    //   视觉上是「水壶 → 小人 → 水壶飞走」，中间闪一下 —— 那是错的。
    //   所以 wait **不自动清除**，让它保持到 rest 接手；只有 rest 播完才一起消失。
    //   清除点：rest(400ms) / clash(1950ms) / unite(2850ms)；wait 由 0（= 不清除）表示常驻。
    const life = kind === 'clash' ? 1950 : kind === 'unite' ? 2850 : kind === 'rest' ? 400 : 0;
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    setScene({ kind, seq });
    if (life > 0) {
      st.timer = setTimeout(() => { setScene(null); st.timer = null; }, life);
    }
  }, [phase]);

  // 卸载时清掉定时器，避免对已卸载组件 setState
  useEffect(() => () => { if (sceneRef.current.timer) clearTimeout(sceneRef.current.timer); }, []);

  if (!packet?.nodes || !packet.root) return null;
  // ★ 内置合成：status → patches（active / colorChannel / rectChannel 全覆盖）。
  //   调用方传的 patches 只用于额外覆盖（如数据绑定），不会把内置的丢掉。
  const built = buildPatches(packet, status);
  const merged = patches ? { ...built, ...patches } : built;
  // ★★ 胶囊组切换的过渡动画（第 35 轮 · 按 /motion-design 定参）。
  //   packet 的 statuses 只把 group_rest / group_battle 的 `active` 一开一关 —— Unity 里是**瞬时硬切**，
  //   这就是「休息一下」切成敌人数量时没有过渡的原因。线上靠 native 动画补足，本地 DOM 顶栏用 .capfx。
  //   这里给容器一个**随组切换递增**的 data-fx-seq：CSS 用属性选择器无法重启动画，
  //   所以配合 key 让 Preact 重新挂载该组节点，动画自然从头播放（见 renderNode 的 nth-capfx 类）。
  const curGroup = status === 'hud_rest' || status === 'hud_rest_settled' ? 'rest'
    : (status === 'hud_battle' || status === 'hud_battle_settled' ? 'battle' : null);
  if (fxRef.current.group !== curGroup) {
    fxRef.current.group = curGroup;
    fxRef.current.seq += 1;
  }
  const fxSeq = fxRef.current.seq;

  // ★★ 胶囊场景动画（第 36 轮）。
  //   线上/旧顶栏在**阶段切换**时会在胶囊上播一段场景：
  //     休整期 → 作战期：「人和怪物撞在一起开始攻击」（clash）
  //     回合开始 → 休整期：「三个小水壶」（wait 落下 / rest 向上飞走）
  //   原生顶栏此前完全没有这段 —— 这里按同一套精灵与 CSS 类补上。
  //
  //   ⚠ 关键坑（第一版没动画的真因）：如果把「该播哪个场景」算成**局部变量**，
  //     它只在阶段变化的那一次渲染里存在；而 HUD 每次 `b.snap`（战斗中几乎每帧）都会重渲染，
  //     场景层下一帧就消失了 —— 肉眼看就是「根本没有动画」。
  //     所以用 state 记住当前场景，定时器到点再清掉。
  //   时长取旧顶栏 CSS 的实际值：clash ≈ 1950ms（含 1800ms 起的淡出）、unite ≈ 2850ms、
  //     wait ≈ 700ms（3 个水壶 220+2×70 落完并晃动）、rest ≈ 400ms。
  //   （state 与 effect 已提到组件顶部，与其它 hooks 一起，避免提前 return 破坏 hook 顺序。）

  // 容器：800×156 设计尺寸 + 居中 + 按 scale 缩放。
  // ★ 与线上 `.native-hud-center` 逐项对齐（实测 cn.zuoyeyuanche.online 1912×914）：
  //     position: absolute; left: 50%; top: 0;
  //     transform: translateX(-50%) scale(1.26944);  transform-origin: 400px 0  （= 50% 0）
  //     margin: 0
  //   ⇒ 画布中心落在视口中心（1912/2=956），缩放绕自身中心展开，最终 rect = x448.22 y0 1015.56×198.03。
  //   ⚠ 之前用 `position:relative; margin:0 auto`，靠 flex 父级居中 ——
  //     父级只有 1016 宽时 left/auto margin 只按父级算，画布被推到 x=507.8（比线上右 59.5px）。
  // 当前该播的场景（由上面的 effect 维护；null = 不叠场景层）
  const playScene = scene ? scene.kind : null;
  const sceneSeq = scene ? scene.seq : 0;
  const style = {
    position: 'absolute',
    left: '50%',
    top: '0',
    width: packet.viewport?.width ? `${packet.viewport.width}px` : '800px',
    height: packet.viewport?.height ? `${packet.viewport.height}px` : '156px',
    transform: `translateX(-50%) scale(${scale})`,
    transformOrigin: '50% 0',
    margin: '0',
    pointerEvents: 'none',
    // ⚠ 层级：这个容器现在挂在 `.gtop`（祖先 `.gm__hud` 的 z-index 只有 3）里，
    //   子级 z-index 再高也压不过形成层叠上下文的祖先之外的战场层 ⇒ 接入后整体发暗/被压。
    //   保持一个**低于**旧顶栏弹层、但足以覆盖战场 canvas 的值即可；
    //   真正的层级由 `.gm__hud` 决定，这里不越权。
    zIndex: 2,
    isolation: 'isolate',
  };
  return html`<div class="nth-root native-hud-center regulation-native-hud20261110" data-native-hud-theme=${packet.themeId || ''} data-native-hud-status=${status} data-fx-seq=${fxSeq} data-scene=${playScene || ''} style=${style}>
    ${renderNode(packet, packet.root, merged, '', false, onNodeClick, fxSeq, capSlot)}
    ${/* 场景层：叠在胶囊（group_mid_screen 482×56，居中）之上；key 带 sceneSeq ⇒ 每次换阶段重新挂载并重播 */''}
    ${/* ★ 四态接管时**必须关掉这一层**（第 105 轮续）：「多套动画」的真因就在这里。
         CapScene 是旧版过场（capfx 类 + 水壶/机器人/怪物精灵），叠在胶囊之上；
         而四态引擎自己也带 trans_rest / trans_battle / trans_coop 过场 ——
         两套同时播，屏幕上是两套动画。capSlot 非 null 表示四态已接管，这里让位。 */ ''}
    ${playScene && !capSlot ? html`<span key=${`scene-${sceneSeq}`} class="nth-scene"><${CapScene} kind=${playScene} /></span>` : null}
  </div>`;
}
