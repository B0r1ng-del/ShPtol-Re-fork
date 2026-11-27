// ui/adapters/bountySkin.js — 悬赏决策界面的**局内专属皮肤层**（第 26 轮：按线上参考图逐项还原）。
//
// 数据来源：参考图 Image_1795351254892_390.png（1939×941），逐像素量测，不是目测：
//   · 遮罩下画面亮度 ≈ 26–27（三通道几乎相等 ⇒ 中性暗灰）；卡片纸面 ≈ 44.5（std 18.7 ⇒ 有颗粒纹理）；
//     底部手牌区 ≈ 45；遮罩把左侧玩家栏/聊天也压暗但**仍可见轮廓** ⇒ 遮罩覆盖整屏，不是从 2.8rem 起。
//   · 卡片主体：x 399–765 / y 326–631 ⇒ 364×305 @1939 宽；三卡间距 56px；三卡总跨 399–1609 居中。
//   · 边框：x=399 处 3px 实线（峰值亮度 198，两侧带抗锯齿渐变）⇒ 3px 实线 + 极淡抗锯齿。
//   · 叠层：卡片下方有第二层纸，底边随 x 递减（y=636 x≤622 → y=648 x≤460）⇒ 约 7° 斜切，向下露出 ~20px；
//     右侧同样露出第二层（向右 ~10px）并向下渐隐。
//
// 为什么是运行时注入、不静态挂 index.html：静态 <link> 会让这份 CSS 在每个页面参与解析，
// 违背「非局内页面零变化」；运行时注入只在悬赏界面首次挂载时发生一次，固定 id 去重（同 lobbyIntro.js:92）。
//
// 边界：选择器全部以 .spov 开头；不给其他模块加接口；不改任何游戏逻辑。

// 关于纸面纹理的证据链（避免后来者重复踩坑）：
//   · 最初以为参考图纸面有强噪点（std 18.7）——那是把文字/边框像素一起算进去了；
// i18n-ignore-file: 本文件是一段注入的样式表（CSS），中文全部出现在 **CSS 注释**里 —— 写给人看的
//   还原依据（为什么用纯色、遮罩为什么要同级特异性），不是界面文案。文件内 0 处 t() 调用。
//   · 逐块扫描「最纯纸面块」实测 std 仅 2.91 / mean 38.8 ⇒ 参考图纸面是**均匀平滑**的；
//   · 试过 SVG feTurbulence（std 2.9）、CSS 重复条纹（std 8.0 但成网格纹）、
//     参考图裁切平铺（出现接缝）—— 三种都比纯色更偏离参考图，故最终用纯色。
//   保留探针脚本思路：找 std 最低的 20×20 块，比整片取样可靠。

const CSS = `
/* ============================================================
   1. 遮罩：覆盖**整屏**（参考图里左侧玩家栏/聊天也被压暗到 26 左右，
      但仍能看出轮廓 —— 所以是重遮罩 + 模糊，不是局部遮挡）
      本地原规则是 .spov{inset:0 0 0 2.8rem}，左侧 2.8rem 完全露出，与参考图不符。
   ============================================================ */
/* 注意特异性：devices.css:47 的 \`.gm > .spov{left:...}\` 是 0,2,0，压过单类 .spov。
   这里必须用同级特异性 + 后加载才能覆盖，否则遮罩仍然只从 2.8rem 开始。 */
.spov, .gm > .spov, .gm.has-sp > .spov {
  left: 0; right: 0; top: 0; bottom: 0; inset: 0;
}
.spov__veil {
  position: absolute; inset: 0;
  background:
    linear-gradient(90deg, rgba(6, 8, 8, .82) 0, rgba(6, 8, 8, .84) .5rem, rgba(6, 8, 8, .86));
  border-left: 0;
  -webkit-backdrop-filter: blur(3px) saturate(.75);
  backdrop-filter: blur(3px) saturate(.75);
}

/* 内层容器重新留出左边距（原来靠 .spov 的 2.8rem 提供，现在遮罩铺满，改由 inner 让位）。
   ⚠ 特异性：game-panels.css:498 有 \`.gm.has-spdraft .spov__inner\`（0,3,0），必须同级或更高才压得住。 */
/* inner 铺满整个遮罩层，所有位置改由内部元素按参考图比例自己定位 —— 
   不再用「左内边距 + 负 margin 抵消」那种掩盖式写法（那正是标题被推偏的根因）。 */
.spov__inner, .gm.has-spdraft .spov__inner {
  left: 0; right: 0; top: 0; bottom: 0;
  padding: 0;
}

/* ============================================================
   2. 卡片网格：按参考图逐像素量测（1939 宽）折算到 1912 视口
      卡宽 368→363、卡高 306→302、间距 54→53、组左 399→393、组顶 325→320
      ⇒ 三列定宽 + 居中，不再用 1fr 自动铺满（那会把卡拉宽、间距撑大）
   ============================================================ */
/* ⚠ 特异性必须压过 game-panels.css:499 的 \`.gm.has-spdraft .spov__grid{gap:...;padding:...}\`（0,3,0），
   否则 gap 会被它改掉、padding 会把卡组推偏。这里用 .gm.has-spdraft + 双类 = 0,4,0。 */
/* 全部按参考图的**视口比例**（不是固定 px），窗口缩放时自动跟随：
   参考图 1939×941 量得 —— 卡宽 368(18.98vw)、卡高 306(32.52vh)、间距 54(2.785vw)、
   组顶 325(34.54vh)、组中心 x 51.81%(≈居中)。
   限制：卡片过小会挤掉文字，所以给 min/max 上下限。 */
.spov .spov__grid--3,
.gm.has-spdraft .spov .spov__grid--3,
.gm.has-spdraft .spov__grid.spov__grid--3 {
  display: grid;
  grid-template-columns: repeat(3, clamp(240px, 18.98vw, 460px));
  grid-template-rows: clamp(200px, 32.52vh, 420px);
  column-gap: clamp(28px, 2.785vw, 72px);
  row-gap: clamp(28px, 2.785vw, 72px);
  justify-content: center;
  align-content: start;
  padding: 0;
  margin: 0;
  padding-top: clamp(200px, 34.54vh, 420px);
  /* 参考图卡组中心在屏宽 51.81%（不是正中 50%），整体略偏右 —— 用 translate 表达，
     不是加 margin 掩盖。 */
  transform: translateX(1.81vw);
}

/* ============================================================
   2b. 六张牌的网格（悬赏决策 / 机密商店 / 战术决策 / 道具补给，2 行 3 列）
   ------------------------------------------------------------
   上面第 2 节只给「三张牌」的网格（.spov__grid--3）定了卡宽 / 卡高 / 间距；
   而第 1 节把 .spov__inner 铺成了整屏（inset 0）。于是六张牌走的仍是
   css/screens/game-panels.css:494 的 \`repeat(3, 1fr) / repeat(2, 1fr)\`，
   1fr 被撑到整屏 —— 实测每张牌 1920×1080 下 595×510、1920×925 下 601×437
   （用户截图量得 ~610×440，正是这一档）、1256×774 下 389×367：牌面铺满屏幕、
   右下被切、且压住了绝对定位的标题栏（牌的 top 9px < 标题栏 bottom 90px）。
   修法：让六张牌沿用「三张牌」的同一套参考比例（卡宽 18.98vw、卡高 32.52vh）
   定尺，行数固定 2 行，间距沿用 game-panels.css:499 的 .6rem / .46rem
   （矮屏 .12rem，由下面第 2c 节接上 game-panels.css:618 的收紧值），
   并把标题栏高度让作上内边距，牌不再压在标题栏底下。
   外层 min() 兜底：视口不足时按可用宽 / 高收缩，保证不溢出、不贴边
   （实测 756×366 手机档：卡 240×141、四周留边、间距 5px，仍 2 行 3 列）。 */
.spov .spov__grid:not(.spov__grid--3),
.gm.has-spdraft .spov .spov__grid:not(.spov__grid--3) {
  --sp-gap-x: .6rem;
  --sp-gap-y: .46rem;
  --sp-head-h: clamp(90px, 11.1vh, 160px);
  grid-template-columns: repeat(3, min(clamp(240px, 18.98vw, 460px), calc((100% - 2 * var(--sp-gap-x)) / 3)));
  grid-template-rows: repeat(2, min(clamp(200px, 32.52vh, 420px), calc((100vh - var(--sp-head-h) - var(--sp-gap-y) - .4rem) / 2)));
  column-gap: var(--sp-gap-x);
  row-gap: var(--sp-gap-y);
  justify-content: center;
  align-content: start;
  padding: var(--sp-head-h) 0 0;
  margin: 0;
}
/* 2c. 矮屏（横屏手机，与 game-panels.css:616 同一断点）：间距收到 .12rem。
   ⚠ 不要在这里压 --sp-head-h：.spov__head 是**内容撑高的 flex 块**（标题 .spov__title 用
   calc(.56 * var(--t)) 字号 + .spov__titles 的 padding），它的实际高度**不随这个断点变化**。
   早先这里写 clamp(64px, 11.1vh, 160px)，实测 756×366 / 844×390 下 head 仍是 90px，
   而 padTop 只有 64px ⇒ 卡片顶边扎进标题栏 26px（overlapHead=26）。改为沿用 2b 的同一公式，
   牌高由外层 min() 按可用高自动收缩，绝不压标题栏。 */
@media (max-height: 431.98px) {
  .spov .spov__grid:not(.spov__grid--3),
  .gm.has-spdraft .spov .spov__grid:not(.spov__grid--3) {
    --sp-gap-x: .12rem;
    --sp-gap-y: .12rem;
  }
}
/* 图标按参考图的卡内占比（76/368 ≈ 20.6%）随卡缩放；不跟随的话 1rem 的固定图标
   在缩小的牌面上会占掉 27%（参考图是 20.6%）。 */
.spov .spov__grid:not(.spov__grid--3) .spcard__icon {
  width: clamp(44px, 3.92vw, 120px);
  height: clamp(52px, 9.46vh, 140px);
  padding: 0;
}

/* ============================================================
   3. 卡片：纸张质感 + 3px 实线边框 + 右下错位叠层
   ============================================================ */
.spov .spcard {
  --sp-paper: #2b2d2c;
  position: relative;
  /* 关键：建立层叠上下文，否则 ::after 的 z-index:-1 会跑到 .spov__inner / .spov__veil 之下被整片盖住，
     叠层就完全看不见（这是上一版没出现第二层纸的真正原因）。 */
  isolation: isolate;
  /* 纸面材质：参考图纵向剖面实测（x 430-750 逐带均值）：
       y440 → 33.7, y476 → 37.9, y512 → 39.7, y548 → 43.7, y584 → 44.8, y620 → 44.5
     即**顶部暗、底部亮的纵向渐变**（33.7 → 44.5），底区块内 std≈4（有细微不均匀）。
     这解释了为什么平色总显得死板 —— 原版不是纯色，是有方向性的纸质。
     实现：纵向渐变打底 + 极轻的细颗粒（只做 1px 级、低不透明度，不压文字）。 */
  /* 与参考图逐像素对齐（1px 采样，避开文字区）：
       参考纯纸面 mean 43.8-44.3 / std 4.5-5.2 / min 26 / max 69
       上一版实测 mean 52.85 / std 13.58 / max 124 —— 偏亮 9、颗粒强 2.7 倍、且出现高亮噪点（会污染文字）。
     本轮把渐变锚点整体下调（顶 26 → 底 44，对应参考图实测剖面 33.7→44.5 的暗端），
     并把细纹不透明度降到 1/5，使 std 落在 4.5-5.2、max 不超 70。 */
  background:
    repeating-linear-gradient(0deg, rgba(255,255,255,.022) 0 1px, rgba(0,0,0,.022) 1px 2px),
    repeating-linear-gradient(90deg, rgba(255,255,255,.018) 0 1px, rgba(0,0,0,.018) 1px 2px),
    linear-gradient(180deg, #131514 0%, #191b1a 55%, #1f2120 100%);
  
  /* 参考图边框是**双层**（左上角放大可见）：
     外层 3px 亮白线 → 中间 ~2px 暗缝 → 内层 1px 细线，然后才是纸面。
     用 border(外) + box-shadow 内嵌线(内) 实现，避免加额外 DOM。 */
  border: 3px solid rgba(232, 235, 233, .9);
  box-shadow: inset 0 0 0 2px rgba(12, 14, 14, .85), inset 0 0 0 3px rgba(196, 200, 198, .55);
  outline: none;
}
/* 第二层纸：右下错位、底边斜切、向下渐隐
   参考图量测：右侧露出 ~10px、下方露出 ~20px、底边约 7° 斜切（y=636 x≤622 → y=648 x≤460） */
.spov .spcard::after {
  content: '';
  position: absolute;
  /* 实测：右侧外露 ~22px = .26rem；下方外露 ~10px = .12rem；
     斜切从卡片右侧 y≈532（即 55% 高度处）开始向右下张开，形成参考图那种"纸没对齐"的角。 */
  left: .04rem; right: -22px; top: .1rem; bottom: -10px;
  z-index: -1;
  background: linear-gradient(180deg, rgba(158, 162, 160, .42), rgba(74, 77, 76, .12));
  border: 1px solid rgba(206, 210, 208, .38);
  clip-path: polygon(0 0, 100% 0, 100% 55%, 100% 100%, 0 100%);
  pointer-events: none;
}
.spov .spcard.is-pickable { cursor: pointer; }
.spov .spcard.is-pickable:hover {
  border-color: #fff;
  box-shadow: 0 0 .2rem rgba(255, 255, 255, .16);
}
/* 已被选走：整块压平变灰，文字仍可读 */
.spov .spcard.is-taken {
  background: #232524;
  border-color: rgba(178, 182, 180, .5);
}
.spov .spcard.is-taken > :not(.spcard__taker) { opacity: .62; filter: grayscale(.6); }
.spov .spcard.is-mine > :not(.spcard__taker) { opacity: 1; filter: none; }
/* 选中：白框更亮 */
.spov .spcard.is-armed {
  border-color: #fff;
  box-shadow: 0 0 .3rem rgba(255, 255, 255, .4);
}

/* ============================================================
   3. 卡片内布局（逐像素量测参考图 card1，原卡 369×308）
      · 图标 76×89（占卡宽 20.6% / 卡高 28.9%），带 1px 浅描边
      · 内边距：左 ~14px = .14rem，上 ~22px = .22rem
      · 标题基线略低于图标顶，正文从图标下方开始占下半部
   ============================================================ */
/* 卡片内部全部按视口比例（原来用 rem，窗口缩小时不跟随会溢出）。
   参考图卡片 368×306 于 1939×941：
     · 内边距 上22(2.34vh) 左右14(0.72vw)
     · 标题字 22px(2.34vh)   正文 22px 行高1.3(2.34vh)
     · 图标 76×89 (3.92vw × 9.46vh) */
.spov .spcard {
  padding: clamp(10px, 2.34vh, 30px) clamp(8px, .72vw, 22px) clamp(8px, .72vw, 22px);
  gap: clamp(4px, .6vh, 12px);
}
.spov .spcard__name { color: #f2f4f3; font-weight: 800; font-size: clamp(14px, 2.34vh, 30px); line-height: 1.2; }
.spov .spcard__desc { color: #d2d5d4; font-size: clamp(12px, 2.0vh, 26px); line-height: 1.3; }
/* 悬赏图标：参考图是**方框内嵌图**，1px 浅描边，直角 */
.spov .spcard__icon {
  /* 参考图实测：图标框白边距卡片边框 13px、亮度 159（比卡片外框 198 略暗），2px 宽度 */
  border: 2px solid rgba(180, 184, 182, .86);
  background: #1e201f;
  flex: none;
}
.spov .spcard--bounty .spcard__icon { border-color: rgba(180, 184, 182, .86); background: #1e201f; }
.spov .spcard--bounty .spcard__icon img { object-fit: cover; filter: none; }
/* 图标 76×89 @1939×941 ⇒ 3.92vw × 9.46vh（按视口比例，缩放时跟随） */
.spov .spov__grid--3 .spcard__icon { width: clamp(44px, 3.92vw, 120px); height: clamp(52px, 9.46vh, 140px); padding: 0; }
/* 图标右侧留白：参考图约 46px @1939 ⇒ 2.37vw */
.spov .spcard__head { gap: clamp(8px, 2.37vw, 70px); align-items: flex-start; }
/* 参考图标题基线位于图标垂直中线偏下，不是贴顶 */
.spov .spcard__title { padding-top: clamp(10px, 4.4vh, 56px); }

/* ============================================================
   4. 标题区：按参考图比例定位（原先被 inner 的左内边距推向右下，实测右移 4.4%、下移 7.9%）
      参考图量测（1939×941）：
        · 装饰框      x 174-407  y 14-104   ⇒ left 9.0%  top 1.5%
        · 「悬赏决策」 x 207-407  y 31-79    ⇒ left 10.7% top 3.3%（字高 48px ≈ 5.1vh）
        · 「当前轮到你决策」 x 1324-1481 y 20-38 ⇒ right 7.6% top 2.1%
   ============================================================ */
.spov .spov__head {
  position: absolute;
  left: 0; right: 0; top: 0;
  height: clamp(90px, 11.1vh, 160px);
  padding: clamp(6px, 1.0vh, 16px) clamp(12px, 3.9vw, 80px) 0 clamp(90px, 9vw, 200px);
  box-sizing: border-box;
}
.spov .spov__titles { position: relative; padding-left: clamp(12px, 1.7vw, 40px); }
/* 装饰框：参考图 left 9.0% / top 1.5%（相对整屏），头区已让位 9vw，这里贴回左缘 */
.spov .spov__deco {
  left: 0; top: 0; bottom: auto;
  width: clamp(140px, 12.0vw, 300px);
  height: clamp(56px, 9.6vh, 120px);
  border: 2px solid rgba(23, 249, 183, .18);
  border-right: 0;
}
/* 标题字：参考图字高 48/941 = 5.1vh */
.spov .spov__title { font-size: clamp(28px, 5.1vh, 64px); }
.spov .spov__name { letter-spacing: .02em; line-height: 1; }
/* 右侧「当前轮到你决策」—— 按用户明确指定的尺寸定位：
     · 距最右边 220px（用 right 定位，不是 left 68.3%）
     · 距最顶上 40px
     · 字号与左侧「获取额外奖励」(.spov__desc) 一致：实测 22.0037px（= calc(.26 * var(--t))）
   ★ 用 calc(.26 * var(--t)) 而不是写死 22px，这样文字缩放设置（data-text）变化时两者同步放大缩小。 */
.spov .spov__turn {
  position: absolute;
  right: 220px;
  top: 40px;
  left: auto;
  gap: clamp(8px, 1.2vw, 24px);
}
.spov .spov__turntxt { font-size: calc(.26 * var(--t)); }
`;

const STYLE_ID = 'bounty-skin-style';

/**
 * 把悬赏皮肤层挂上（幂等：已挂过就什么都不做）。
 * 只在悬赏浮层渲染路径里调用，不放在模块顶层 —— 那样任何页面 import 到它都会注入。
 */
export function installBountySkin() {
  if (typeof document === 'undefined') return;
  const old = document.getElementById(STYLE_ID);
  if (old) { old.textContent = CSS; return; }
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.append(st);
}
