# 地图预览修复 + stages 资源盘点

## 一、结论

「地图预览」原本能打开面板，但**面板里没有地图**——`.ca-mapview__thumb` / `.ca-mapview__tile` 这两个类在项目全部 CSS 里**零定义**，格子 `<i>` 的 width 塌成 0，面板只剩 header 和一段说明文字。补两条规则后，格子按 `stages.json` 的 rows 正常绘制。

改动只有一个文件、一个 hunk：`public/css/screens/crisis.css`（+18 行）。`public/css/official/` 三个文件、`data/*.json`、`server/` 均未触碰。

## 二、修复前实测（DOM 断言，非截图）

在 http://localhost:3000 走完 昵称 → 开始 → 重燃测试作战 → `.cc-record .cc-go` → 选择指标页，点 `.cs-mapview`：

| 项 | 修复前 |
| --- | --- |
| 遮罩 `.ca-mapview-modal` | 1910 × 914（全屏，存在） |
| 面板 `.ca-mapview-panel` | 1117 × **223**（只剩 header + 说明） |
| `.ca-mapview__thumb` | 1115 × **25**，`display: block`、`grid-template-columns: none` |
| `.ca-mapview__tile` 数量 | 399（21 × 19，DOM 里**是存在的**） |
| 单个格子 | **width: 0**，height 25.4 → 全部塌成零宽 |
| 面板可见文字 | 只有标题「CRISIS CONTRACT · MAP / 战场#05(下半) 源石流发生装置」+ 一段重力说明 |

即：**JS 渲染是对的，CSS 从来没给过格子尺寸**。现象就是「点了地图预览什么也看不到」。

## 三、修复后实测（同一路径，同一断言）

| 项 | 修复后 |
| --- | --- |
| 面板 `.ca-mapview-panel` | **1117 × 810** |
| `.ca-mapview__thumb` | **1115 × 612**，`display: grid` |
| `grid-template-columns` | 24px × 21（21 列） |
| `grid-auto-rows` / `gap` | 24px / 1px |
| `.ca-mapview__tile` 数量 | **399 = 21 列 × 19 行** |
| 单个格子实测尺寸 | **30 × 30**（24px × 舞台缩放 1.2694） |
| 首格 / 末格坐标 | (622, 153) → (1257, 724)，网格铺满、无重叠 |
| 面板标题 | 战场#05(下半) 源石流发生装置 |

19 行与 `stages.json` 每张图的 rows.length === 19 完全一致。

格子类型分布（该局抽到的图）：`ff-tile--void 223 / ff-tile--floor 58 / ff-tile--high 57 / ff-tile--lane 52 / ff-tile--gate 6 / ff-tile--goal 3`（mire 12 出现在另一局抽到的「沼泽控制」上，说明地形类走的是 `fallbackTileClass`，颜色来自 `game.css` 已有的 `.ff-tile--*` 规则。）

## 四、改动内容

`public/css/screens/crisis.css` 末尾追加：

```css
.ca-mapview__thumb {
  display: grid;
  grid-template-columns: repeat(var(--cols), 24px);
  grid-auto-rows: 24px;
  justify-content: center;
  gap: 1px;
  padding: 0 20px 8px;
}
.ca-mapview__thumb.is-empty { min-height: 120px; }
.ca-mapview__tile {
  display: block;
  border-radius: 1px;
  background: #2b322f;
}
```

- `--cols` / `--rows` 是 `StageThumb` 已有的内联变量（实测 `--cols: 21; --rows: 19`），直接复用，不改 JS。
- 定宽 24px 的理由：19 行 × 24 = 456px，加 header（96px）+ 说明（60px）≈ 612px，仍在 `.cs-sheet > section` 的 `max-height: 92vh`（此处 840px）预算内，不出现滚动条。
- 颜色沿用 `.ff-tile--*`（`public/css/screens/game.css:1049-1058`），不新增调色板。

**已 grep 确认**：`.cs-map-panel`、`.cs-mapview`、`.ca-mapview`、`.ca-mapview-panel` 都在 `public/css/official/crisis-event.css`（759 行 / 898-911 行）；缺的只有 `__thumb` / `__tile` 两个修饰类。

## 五、stages 资源盘点

`data/stages.json` 共 **13** 张图，**全部 rows = 19**：

| # | key | active | weight | rows | name |
| --- | --- | --- | --- | --- | --- |
| 1 | `act1autochess_m01` | true | 50 | 19 | 战场#01 |
| 2 | `act1autochess_m02` | true | 50 | 19 | 战场#02 |
| 3 | `act1autochess_m03` | true | 50 | 19 | 战场#03 |
| 4 | `act1autochess_m04` | true | 50 | 19 | 战场#04 活性源石 |
| 5 | `act1autochess_m05` | **false** | **0** | 19 | 战场#05(上半) 涨潮/特制水上平台 |
| 6 | `act1autochess_m06` | **false** | **0** | 19 | 战场#06(上半) 沙尘暴/土石结构 |
| 7 | `act1autochess_m07` | **false** | **0** | 19 | 战场#07(上半) 树丛 |
| 8 | `act2autochess_m01` | true | 50 | 19 | 战场#05(下半) 源石流发生装置 |
| 9 | `act2autochess_m02` | true | 50 | 19 | 战场#06(下半) 沼泽控制 |
| 10 | `act2autochess_m03` | true | 50 | 19 | 战场#07(下半) 排气格栅 |
| 11 | `act2autochess_m04` | true | 50 | 19 | 战场#08(下半) 涨潮控制 |
| 12 | `act1autochess_escaped_single` | **false** | **0** | 19 | 联防阵地（1名玩家） |
| 13 | `act1autochess_escaped_multi` | **false** | **0** | 19 | 联防阵地（2名玩家） |

**可用池 = 8 张**（active && weight > 0）：m01–m04 + act2 的 m01–m04。其余 5 张（act1 m05/m06/m07 + 两张 escaped）active:false / weight:0，不进入 BAN 池也不被抽中。

## 六、弧光作战 .ca-mapview 现状

- 按钮实测：`.ca-mapview` 位于 (564, 823)，尺寸 **239 × 53**，可见。
- 按钮里的图：`/assets/local/cc4-arclight/map-focus.webp`，文件**存在，119208 字节**。
- 点开面板：与重燃共用 `MapPreviewSheet`，修复后同样显示 **399 格 / 21×19 / 30×30**，面板 1117 × 810。

### 缺口：custom_cc4_focus 不存在

- 声明处唯一：`shared/crisisArc.js:18`
  `export const ARC_SEASON = Object.freeze({ id: 'arc1', key: 'arc', name: '弧光作战', stage: 'custom_cc4_focus' });`
- 全仓库 grep（public / server / shared / tools / data 的 js/mjs/json/css）：**只有这一处**，没有任何代码读取 `ARC_SEASON.stage`，`data/stages.json` 里也没有这个 key。
- 因此弧光的预览卡实际走的是 `data.lookup('stages', preview.stageId)`，而 `preview.stageId` 来自 `server/match/waves.js:187 setupMatchWaves()` 从**重燃那 8 张池子里随机抽**的一张（`server/lobby.js:2037 preview = { seed, stageId: setup.stageId, ... }`）。
- 实测证据：弧光页点开地图预览，标题显示的是 **「战场#05(下半) 源石流发生装置」**（`act2autochess_m01`），而不是「危机合约 滞空焦点」。**这是内容层缺口，不是样式缺口**——样式修好后它照样能显示格子，但显示的是错的地图。

修这个需要新增一张 `custom_cc4_focus` 的 stage 记录（rows/tiles），并且必须走 `tools/build-data.mjs` 重新生成 `data/stages.json`，不能手改。**本次未做**（超出本任务范围，且需要滞空焦点的官方地形数据）。同时 `shared/crisisArc.js` 的 `stage` 字段需要被 `waves.js` 或 `lobby.js` 真正消费，否则加了数据也不会被选中。

## 七、验证

- `npx eslint public/js/ui/crisisSelect.js` → **0 error**，3 warning（checkArc / ARC_SEASON / mode 未使用，均为改动前既有，本次未改 JS）。
- `npx eslint public/css/screens/crisis.css` → 0 error（CSS 不在 eslint 配置范围，仅有 ignore warning）。
- 回归：地图预览关闭正常（`.ca-mapview-panel` 消失）；种子码弹窗仍能打开且有内容（`.cs-seed-panel` 787 × 796，文本非空）。
- 未跑 `npm run golden`（任务禁止），未 commit。

## 八、未解决 / 后续

1. **弧光固定地图缺失**（见第六节）：需要 `custom_cc4_focus` 的 stage 数据 + 让 `ARC_SEASON.stage` 被服务端消费，走 `tools/build-data.mjs`。
2. 种子码弹窗位置偏高（实测 top: -328，部分越出视口上方）——既有问题，与本次改动无关，未处理。
