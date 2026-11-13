# 危机合约：退出按钮 / 结算页 / 弧光 BGM

## 一、结论速览

| 项 | 状态 | 结论 |
| --- | --- | --- |
| S2 选择指标页退出按钮 | **已满足，无需新增** | `.cc-x` 早已存在于 `crisisSelect.js:638`（重燃分支），实测可见可点、点击真的退出 |
| S3 作战结束页 | **已实现，无需新增** | `ui/crisisResult.js` + `css/screens/crisis-result.css`（185 行）已完整，`settle.js:659-679` 按 season 分流 |
| S4 弧光 BGM | **本次接线完成** | 两首本地 mp3 已存在且 HTTP 200；接到 `audio.setArcBgm()`，复用既有 `_bgmTrack` 机制 |
| 弧光地图预览 | **按官方纠正重写** | 撤掉格子，改为官方三件套 header + img(map-focus.webp) + p |

改动文件：

- `public/js/ui/crisisSelect.js` —— MapPreviewSheet 按官方拆两形；弧光 BGM 挂载
- `public/js/ui/crisisEventPage.js` —— 弧光 BGM 挂载 + ARC_AUDIO 常量
- `public/js/audio.js` —— 新增 `setArcBgm()` 与 `_bgmTrack` 的弧光分支
- `public/css/screens/crisis.css` —— 格子类改名 `.cs-mapview__*`（只服务重燃）

未触碰： `public/css/official/` 三个文件、`data/*.json`、`server/`。

## 二、S2 退出按钮：本来就有，实测确认

官方 `crisis-event.css:97-102` 给了完整定义。项目侧 `crisisSelect.js:638` 已渲染它，**但只在重燃分支**（`!isArc`）；弧光分支用 `.ca-back`（官方本来就这样，两赛季 chrome 不同）。

实测（重燃选择指标页）：

| 属性 | 值 |
| --- | --- |
| 存在 | 1 个 `.cc-x` |
| 位置 | (1689, 19)，36×36 渲染（28px × cc-scale 1.2694） |
| background | `rgb(241, 241, 241)`（官方 #f1f1f1） |
| position | `absolute`，`left:1218px; top:15px`（官方值） |
| cursor / border-radius | `pointer` / `50%` |
| SVG | `M5 5l10 10M15 5L5 15`（官方叉号），19×19 |
| aria-label / title | 关闭 / 关闭 |

**点击验证**：派发真实 `MouseEvent` 后 `.cs-page` 从 DOM 消失、入口页 `.cc-tab` 出现且 `cc-tab--rekindle is-on`。退出链路通。

> 踩坑：`ego_click` 的坐标点击在这颗按钮上不生效——它在 `.cc-root` 的 `scale(1.269)` 舞台里，命中框与视觉框有偏差。**用 `dispatchEvent(new MouseEvent('click',{bubbles:true}))` 才可靠**。后续测危机合约任何按钮都按这个来。

## 三、S3 作战结束页：已实现，结构对齐官方

- `public/js/ui/crisisResult.js` —— `export function CrisisResult`，时间轴 T_LAND 730 / T_EXIT 1830 / T_SMEAR 340，阶段 0→3，红带 + 数字滚动 + 小队卡。
- `public/css/screens/crisis-result.css` —— **185 行**，完整（.cr-band / .cr-mark / .cr-card / @keyframes cr-*）。
- `public/js/screens/settle.js:659-679` —— `ResultScreen` 读 `roomCrisis`，按 `season === 'arc'` 分流：弧光 → `CrisisArcResult`，重燃 → `CrisisResult`。

**结论：这一页不需要新建，已按官方结构完成并接线。** 本次未改动它。

## 四、S4 弧光 BGM：本次接线完成

### 文件与可达性（实测）

| 文件 | 大小 | HTTP |
| --- | --- | --- |
| `public/assets/local/cc4-arclight/audio/battleplan.mp3` | 8 964 524 B | **200** |
| `public/assets/local/cc4-arclight/audio/leviation.mp3` | 7 241 324 B | **200** |

### 接线方式（不自造 Audio）

复用项目已有的 `audio` 单例（`public/js/audio.js:1763` 的 `AudioManager`）。在 `_bgmTrack` 加一个优先分支：

```js
_bgmTrack(key) {
  if (key === 'lobby' && this.lobbyTrack) return { intro: null, loop: LOCAL_BGM + this.lobbyTrack.id };
  const arc = this.arcBgm && this.arcBgm[key];
  if (arc) return { intro: null, loop: arc };
  return resolveBgm(this.getManifest(), key);
}

setArcBgm(tracks) {
  this.arcBgm = tracks && typeof tracks === 'object' ? tracks : null;
  this.refreshBgm();
}
```

为什么走这条路：`playBgm` / `refreshBgm` / 淡出 / 静音 / 音量全在既有链路里，**改一处全部生效**；文件缺失时 `_startBgm` 拿不到 buffer 直接 `if (!loop) return;`（audio.js:1046），**静默跳过、不抛错**，正好满足「重燃三首缺失时静默跳过」。

挂载点两处（页面各自独立渲染）：

- `crisisEventPage.js` 的 `CrisisEventPage`：useEffect 装 `setArcBgm(ARC_AUDIO)`，卸载 `setArcBgm(null)`。
- `crisisSelect.js` 的 `CrisisSelect`：仅 `skin === 'arclight'` 时装（这一页由 `lobby.js` 直接挂，不经过入口页）。

映射（官方 `crisisMusic.js` 的 ARC_MENU / ARC_MATCH，均整曲循环）：

- `lobby` key → `battleplan.mp3`（活动页 / 选择指标页）
- `combat` key → `leviation.mp3`（对局中，买人起）

重燃三首（decree / embers / dilemma）**未接**——官网自身就没有，不请求、不报错。

## 五、弧光地图预览：按官方纠正重写

按 Lead 核实的官方 `MapPreview`，弧光**不画格子**，就是 header + img(map-focus.webp) + p 三件套；重燃才用格子（`stages.json` 的 rows 配 `fallbackTileClass`）。

| 分支 | 弹窗类 | 面板类 | 内容 |
| --- | --- | --- | --- |
| `arc` | `ca-mapview-modal` | `ca-mapview-panel` | `<img src=CC_ART+'map-focus.webp'>` |
| 重燃 | `cs-mapview-modal` | `cs-mapview-panel` | `StageThumb` 格子 |

标题：弧光 `stage?.name || t('危机合约 滞空焦点')`（官方 fallback 文案，因 `custom_cc4_focus` 在 `stages.json` 无记录）。

CSS 里格子类由 `.ca-mapview__thumb/__tile` **改名为 `.cs-mapview__thumb/__tile**，只作用于重燃选择器。

### 实测（重燃，缓存已清）

| 项 | 值 |
| --- | --- |
| 弹窗类 | `cs-sheet cs-mapview-modal` ✓ |
| 面板类 | `cs-mapview-panel` ✓ |
| 格子数 | **399 = 21 列 × 19 行** |
| 单格 | **30×30** |
| `.cs-mapview__thumb` | `display: grid` ✓ |
| 面板内有 img | 否 ✓（重燃不该有固定图） |
| 标题 | 战场#08(下半) 涨潮控制 |

## 六、验证

- `npx eslint public/js/audio.js public/js/ui/crisisEventPage.js public/js/ui/crisisSelect.js` → **0 error**，3 warning（`resolveBgm` 的 `let t = null`、`checkArc`、`ARC_SEASON` 未使用，**均为改动前既有**）。
- 两个 mp3 本地存在 + HTTP HEAD 200。
- `.cc-x`：可见、可点、点击后 `.cs-page` 消失。
- 未跑 `npm run golden`，未 commit。

## 七、未解决 / 需要知道

1. **弧光入口卡打不开**（既有问题，与本次无关）：大厅点 `.cc-card.is-arclight`（194×44、可点、无遮挡），页面**停在大厅**，`.cc-tab` / `.ca-entry` 都不出现；重燃卡正常。所以本次弧光 BGM 与弧光面板**只能靠代码路径 + 静态验证**，没能端到端跑通。
2. **`ego_click` 在危机合约的缩放舞台里不可靠**：`.cc-root` 有 `scale(1.269)`，坐标命中框偏移。测这些按钮用 dispatchEvent。
3. **`custom_cc4_focus` 仍无数据**（上一任务的缺口）：弧光预览现在显示 map-focus.webp + 固定文案，符合官方；将来要按地形真画，仍须走 `tools/build-data.mjs`。
4. **模块缓存很顽固**：改 `public/js/**` 后必须 `Network.setCacheDisabled + Page.reload(ignoreCache:true)`，否则浏览器跑旧模块（本次一度误判 isArc 传错，实际是旧代码）。
