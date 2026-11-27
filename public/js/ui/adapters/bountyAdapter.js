// ui/adapters/bountyAdapter.js — 悬赏决策界面的**只读视图适配层**（第 25 轮移植，范围仅限悬赏界面）。
//
// 这一层存在的理由：线上 0.4.3 的 choiceOverlay 直接读 `sp.mine` / `sp.groups` / `sp.turnDeadline` /
// `sp.turnSeconds` / `contractBountyCardLines`，而本地 0.3.2 的 `normalizeSp()`（ui/gameLogic/draft.js:62）
// **不产出其中任何一个**。把线上组件原样搬过来只会有两个结果：读 undefined 崩，或者显示硬编码的假数据。
//
// 本层不发明任何游戏规则，只做三件事：
//   1. 把"本组那一份"解析成一个稳定入口（本地恒等扁平 sp —— 本地没有分队语义）；
//   2. 决策顺序条的**行数据**（线上有渲染、本地 CSS 有样式，但本地 JS 从没画过）；
//   3. 原生布局皮肤的**可用性判定**（没有 manifest 时明确回退，而不是假装画出来了）。
//
// 严禁在此层改状态、发请求、造数据。所有函数都是纯函数，输入本地真实 sp，输出只供渲染。

import { SQUAD_NAMES } from '../../../../shared/constants.js';

/**
 * 本地是否有"分队机变"语义。线上 0.4.x 的 `sp.groups` / `sp.mine` 是分队后每组各一副牌；
 * 本地 `normalizeSp()` 不产出这两者，服务端 `views.js:198` 的 `v.sp` 也不含它们 —— 所以本地恒为单组。
 *
 * 保留这个函数而不是直接写 `false`：将来若本地真的实现分队，只需要改这一处，
 * 上层渲染逻辑（以及下面 resolveGroupView）自动跟上，不必重写组件。
 * @param {any} sp normalizeSp(...) 的结果
 * @returns {boolean}
 */
export function hasSquads(sp) {
  return Array.isArray(sp?.groups) && sp.groups.length > 1;
}

/**
 * 取"我要据以渲染的那一份" sp。
 *
 * 线上：`sp.mine || sp`（分队时取本组，否则扁平）。
 * 本地：恒等 `sp` —— 因为本地没有 `mine`，而 `sp` 本身就是唯一那一份。
 *
 * 不引入 `mine` 字段就等于不引入分队语义，但调用点统一走这里，
 * 以后本地补分队时组件一行不用改。
 * @param {any} sp
 * @returns {any}
 */
export function resolveGroupView(sp) {
  if (!sp) return null;
  if (!hasSquads(sp)) return sp;
  // 分队房间：本组那一份优先；取不到就退回扁平（线上同款退化，见其注释「没有 groups 时 mine 为 null」）
  return sp.mine || sp;
}

/**
 * 分队列的分组数据。
 *
 * 本地没有分队 ⇒ 恒返回 `null`，组件走"全房一串"的老路（和分组之前完全一致）。
 * 这个函数存在的唯一理由是：让组件里那个"要不要画多组"的判断有明确出处，
 * 而不是在组件里散着写 `sp?.groups`（那会让后来的人误以为本地有分队）。
 * @param {any} sp
 * @returns {null}
 */
export function squadRows(sp) {
  if (!hasSquads(sp)) return null;
  // 本地不实现分队渲染。若真出现 groups，也只按本组画一副牌，不假装支持多组。
  return null;
}

/** 分队的显示名（Alpha / Beta …）。本地 `shared/constants.js:724` 已有 SQUAD_NAMES。 */
export function squadName(id) {
  const n = Number(id);
  return Number.isFinite(n) && n >= 1 && n <= SQUAD_NAMES.length ? SQUAD_NAMES[n - 1] : String(id ?? '');
}

/**
 * 原生布局皮肤是否**真的可用**。
 *
 * `NativeChoiceLayout`（nativeAutocheUi.js:212）与 `NativeChoiceCard`（:229）在没有 manifest 时
 * 会自己回退到 DOM —— 那是它们的设计。但"回退"和"本来就没有原生外观"在验收上是两件事：
 * 前者说明资源缺失，后者说明本该如此。这个判定让调用方能把话说准，不把回退当成功。
 *
 * @param {{ m?:any, portrait?:boolean }} ui useNativeUi() 的结果 + 视口
 * @returns {{ layout:boolean, card:boolean, reason:string }}
 */
export function nativeSkinState(ui) {
  const m = ui?.m || null;
  if (!m) return { layout: false, card: false, reason: 'no-manifest' };
  if (ui?.portrait) return { layout: false, card: false, reason: 'portrait' };
  const layout = !!(m.layouts && m.layouts.autochess_battle_effect_choose_panel);
  const card = !!(m.layouts && m.layouts.card_small_item);
  return {
    layout,
    card,
    reason: layout && card ? 'ready' : !layout && !card ? 'no-layouts' : 'partial',
  };
}
