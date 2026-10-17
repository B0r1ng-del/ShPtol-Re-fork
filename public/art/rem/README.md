# 雷姆必拓扩展图像来源

原图（用户提供的 510 × 510、21,994 字节、SHA256 `c78348ac53a2f8b35bd35c840419af94069a37d2e0ed9142af89909918a1b32e`）是一张横向排版的商业标识图，墨迹只占画布 88% × 33.5%。盟约图标画在圆形底盘里（`.bond__icon` 66% × 66%、`object-fit: contain`），方画布会让标志被压成很小一条，所以进仓库的 `bond.png` 做过一次**只关于画布**的处理：按墨迹包围盒裁掉透明留白，居中放进 1:1 正方形画布（横向满格、纵向按比例留边），再缩到 256 × 256。**墨迹本身未重绘、未变形、未改比例**（仍是横向 2.63:1 的原始字形），只去掉了原图四周的空白。

用户授权本项目使用这张图作为盟约图标；图像的原作者、权利人及再分发许可未随文件提供。提供文件及项目收录不构成对其权属或许可的确认，也不将其纳入项目代码的 GPL-3.0-or-later 授权范围。

映射由 `tools/assets/rem-plan.mjs` 的 `REM_BOND_ICON` 与 `addRemArtPlan` 提供：清单里是本地路径 `/art/rem/bond.png`，不走下载。只更新这一条时运行 `node tools/fetch-rem-assets.mjs --manifest-only` 离线生成 `data/assets.json`，保留其他素材条目；`tools/fetch-assets.mjs` 写清单前会校验本文件是完整 PNG，缺失或损坏即失败。

干员立绘、头像、技能图标与战斗 Spine 模型由现有素材下载流程获取，保存在不提交源码的 `public/assets/`。七名成员的固定素材输入来自 `tools/rem-data-source.json`，下载计划位于 `tools/assets/rem-plan.mjs`。这些游戏素材适用根目录 NOTICE 的素材权属与使用声明。
