/**
 * 局内顶栏胶囊 · 四态（休整 / 进入作战 / 协同作战 / BOSS）
 *
 * 取代 game.css 里那套 CSS 过场（capfx-*）画出来的胶囊内动画：换成从原版客户端与 10443
 * 复刻版提取的真实节点树 + 曲线动画（见 ./triEngine.js 与 ./bossEngine.js）。
 *
 * ★ 两套引擎各占一个容器、同一时刻只有一个在跑
 *     三态 → createTriEngine（Unity [uc]ac_n_initial.ab）
 *     BOSS → createBossEngine（10443 复刻版）
 *   数据结构不同源，硬合会互相污染（见两个引擎文件头）。
 *
 * ★ 文本一律来自项目实时数据（hud / miss / prepCapsuleLabel / bossFrac），
 *   绝不用数据文件里提取时的原值（'BOSS' / '12' / '+2'）当画面内容。
 *
 * ★ 缩放实测得来：胶囊设计空间是 482×56（BOSS 482×64），但项目里 .capsule 的高度是
 *   .5rem —— 它随视口与 --sp-ui 变化。所以先量容器高，再按 高/设计高 求 scale，
 *   宽度也跟着算。写死 px 会在别的分辨率下变形。
 *
 * ★ 动画播到末帧就停在末帧：末帧本身带着真实数字，所以「动画结束」与「静态胶囊」
 *   是同一个画面，不存在播完跳变。
 */
import { useEffect, useLayoutEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html } from '../components.js';
import { data, useData } from '../../data.js';
import { uiUrl } from '../assetUrls.js';
import { reducedMotion } from '../device.js';
import { createTriEngine, TRI_STATES, CAP_W, CAP_H } from './triEngine.js';
import { createBossEngine, BOSS_W, BOSS_H } from './bossEngine.js';

/** 节点 img 名（可能带 Unity 去重后缀）→ 清单里可寻址的 key。 */
export function spriteKey(img) {
  const base = String(img || '')
    .replace(/\.png$/, '')
    .replace(/_-?\d+$/, '')
    .replace(/-[0-9a-f]{12}$/, '');
  return 'hudPanel/' + base;
}

/**
 * 四态开关：默认开。关闭方式与 nativeTopBarEnabled 同构，便于 A/B 与回归对比。
 *   ?capsule4=0 / localStorage sp.capsule4='0' → 退回旧的 CSS 过场胶囊
 */
export function capsule4Enabled() {
  const g = globalThis;
  try {
    const q = g.location && g.location.search;
    if (q) {
      const v = new URLSearchParams(q).get('capsule4');
      if (v === '0' || v === 'false') return false;
      if (v === '1' || v === 'true') return true;
    }
  } catch { /* no location */ }
  try {
    const pref = g.localStorage?.getItem('sp.capsule4');
    if (pref === '0' || pref === 'false') return false;
    if (pref === '1' || pref === 'true') return true;
  } catch { /* private mode */ }
  return true;
}

/** 三态里「哪个 clip」由阶段决定（观感态，不是过场）。 */
const TRI_INDEX = { rest: 0, battle: 1, coop: 2 };

/** 三态文本节点路径（写在一处，供测试与喂值共用）。 */
export const TRI_TEXT = {
  restLabel: 'group_rest/root_mask/group_normal/text',
  battleTag: 'group_battle/root_mask/group_trans/root_stage2/text',
  coopTag: 'group_coop/root_mask/group_trans/root_stage2/text',
  battleCur: 'group_battle/root_mask/group_normal/num_layout/text_current',
  battleTotal: 'group_battle/root_mask/group_normal/num_layout/text_total',
  battleSplit: 'group_battle/root_mask/group_normal/num_layout/text_splitter',
  coopCur: 'group_coop/root_mask/group_normal/num_layout/text_current',
  coopTotal: 'group_coop/root_mask/group_normal/num_layout/text_total',
  coopSplit: 'group_coop/root_mask/group_normal/num_layout/text_splitter',
  missBattle: 'group_battle/tag_miss/text_num',
  missCoop: 'group_coop/tag_miss/text_num',
};

/** BOSS 文本节点路径。 */
export const BOSS_TEXT = {
  tag: 'group_boss/group_trans/root_mask/root_stage2/text',
  num: 'group_boss/group_normal/root_num/text_num',
};

/**
 * BOSS 血条填充节点。
 * ★ 原版几何（boss.js DEF）：root_bar 193x11 mask=1 裁切区；bar 194x12 = hp_bar.png 空槽外框（不动）；
 * bar_fill x=-191 w=187 h=6 anc=left pv=0 —— 无图，靠 IImage.color 上色，才是真正按血量伸缩的那层。
 * 驱动 bar_fill 才能做到「外框固定、填充随血量」，驱动 bar 是错的（会把空槽纹理一起压窄）。
 */
export const BOSS_BAR = 'group_boss/group_normal/root_hp/root_bar/bar_fill';

/**
 * @param {{
 *   tri?: 'rest'|'battle'|'coop',
 *   boss?: boolean,
 *   width?: number|null,      // null = 按容器高实测自适应
 *   text?: Record<string,string>|null,
 *   bossText?: Record<string,string>|null,
 *   hpFrac?: number|null,
 *   playKey?: string,
 * }} props
 */
export function CapsuleFourState({ tri = 'rest', boss = false, width = null, text = null, bossText = null, hpFrac = null, playKey = '', title = '', ariaLabel = '', showMiss = null, children = null }) {
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const engRef = useRef(null);
  const modeRef = useRef(null);

  const designW = boss ? BOSS_W : CAP_W;
  const designH = boss ? BOSS_H : CAP_H;

  // 实测容器高 → scale。首次渲染与每次尺寸变化（视口/--sp-ui）都重算。
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const fit = () => {
      // 高度优先取父槽（.gtop__cap）定下的可用高；拿不到就退回自身的 CSS 高
      const box = el.getBoundingClientRect();
      const h = box.height;
      if (Number.isFinite(width) && width > 0) { setScale(width / designW); return; }
      if (h > 0) setScale(h / designH);
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [designH, designW, width]);

  const boxW = Math.max(1, Math.round(designW * scale));

  const urlOf = (img) => uiUrl(data.get('assets'), spriteKey(img)) || '';

  // 订阅素材清单：它异步到达，到达后本组件要重绘才能拿到真实 URL（否则整屏是空节点）
  useData('assets');

  // ①（已合并进 ② —— 见下面「建引擎 + 播放」同一个 effect）

  // ② 播放（阶段/回合变化时重播；reduced motion 直接定格末帧）
  //
  // ★ 必须与「① 建引擎」**共用同一个 effect 顺序**（第 109 轮修）。
  //   原先 ① 依赖 [boss]、② 只依赖 [playKey]：因为 React 的 effect 里清理函数返回 undefined 时
  //   ② 仍然会在同一轮里再跑一次（依赖比较通过 ≠ 不执行），而若 ① 恰好在这一轮重建了引擎
  //   （modeRef 从 tri 变 boss 或反过来），就会出现「先对旧引擎 play 一次（count++），
  //   再对新引擎 play 一次（count++）」⇒ 实测 count 每次切阶段 +2。
  //   合并后：同一个 effect 里先确保引擎就绪，再播一次，天然只有一次。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const want = boss ? 'boss' : 'tri';
    if (modeRef.current !== want) {
      if (engRef.current?.destroy) engRef.current.destroy();
      stage.innerHTML = '';
      modeRef.current = want;
      engRef.current = boss
        ? createBossEngine(stage, urlOf, { barPath: BOSS_BAR })
        : createTriEngine(stage, urlOf);
      engRef.current.init();
    }
    const e = engRef.current;
    if (!e) return undefined;
    e.setActive(true);
    if (boss) {
      e.play();
      if (bossText) e.setText(bossText);
      e.setHp(hpFrac);
      if (reducedMotion()) e.freeze(e.state().dur);
    } else {
      e.play(TRI_INDEX[tri] ?? 0);
      // ★ 先定漏怪标签的显隐再喂文本：play() 已经 layout 过一帧，
      //   这里若晚一拍，空红框会闪一帧才消失。
      if (e.setMiss) e.setMiss(showMiss);
      if (text) e.setText(text);
      if (reducedMotion()) e.freeze(e.state().dur);
    }
    // ★ 依赖只留 playKey（第 109 轮）。
    //   tri / boss 不能单独进来：结算(SETTLE)时 capsuleModel 的 tri 会回落到 'battle'
    //   （联防 coop → 结算 battle），但 playKey 已经被冻结在上一屏 —— 若 tri 仍在依赖里，
    //   就会出现「键没变、反而重播了一次」。观感态本就是 playKey 的组成部分，由它代表即可。
    return () => {
      if (engRef.current?.destroy) engRef.current.destroy();
      engRef.current = null;
      modeRef.current = null;
    };
  }, [playKey]);

  // ③ 实时值就地更新（不重播，避免数字一变动画就从头跳）
  useEffect(() => {
    const e = engRef.current;
    if (!e) return;
    if (boss) {
      if (bossText) e.setText(bossText);
      e.setHp(hpFrac);
    } else {
      // ★ 漏怪数从 0 变 2（或反过来）只变了这一项时，playKey 不变 ⇒ 不会重播，
      //   必须在这里同步显隐，否则红框要等下一次阶段切换才出现/消失。
      if (e.setMiss) e.setMiss(showMiss);
      if (text) e.setText(text);
    }
  }, [text, bossText, hpFrac, boss, showMiss]);

  return html`<div class="cap4" ref=${wrapRef} data-capsule4=${boss ? 'boss' : tri}
    data-playkey=${playKey}
    title=${title || null} aria-label=${ariaLabel || null} role="status"
    style=${`width:${boxW}px`}>
    <div class="cap4__inner" style=${`width:${designW}px;height:${designH}px;transform:scale(${scale});transform-origin:0 0`}>
      <div class="cap4__stage" ref=${stageRef}></div>
    </div>
    ${children}
  </div>`;
}

export { TRI_STATES, CAP_W, CAP_H, BOSS_W, BOSS_H };
