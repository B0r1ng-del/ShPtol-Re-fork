# 雷姆必拓扩展图像来源

`bond.png` 是雷姆必拓盟约图标的原始 PNG，由用户（项目所有者）于 2026-10-17 提供并指定使用。项目逐字节保存原图：510 × 510 像素、8-bit RGBA、文件大小 21,994 字节；SHA256 为 `c78348ac53a2f8b35bd35c840419af94069a37d2e0ed9142af89909918a1b32e`。未重绘、裁剪或改写像素，界面展示保留原图比例与透明度。

用户授权本项目使用这张图作为盟约图标；图像的原作者、权利人及再分发许可未随文件提供。提供文件及项目收录不构成对其权属或许可的确认，也不将其纳入项目代码的 GPL-3.0-or-later 授权范围。

映射由 `tools/assets/rem-plan.mjs` 的 `REM_BOND_ICON` 与 `addRemArtPlan` 提供：清单里是本地路径 `/art/rem/bond.png`，不走下载。只更新这一条时运行 `node tools/fetch-rem-assets.mjs --manifest-only` 离线生成 `data/assets.json`，保留其他素材条目；`tools/fetch-assets.mjs` 写清单前会校验本文件是完整 PNG，缺失或损坏即失败。

干员立绘、头像、技能图标与战斗 Spine 模型由现有素材下载流程获取，保存在不提交源码的 `public/assets/`。七名成员的固定素材输入来自 `tools/rem-data-source.json`，下载计划位于 `tools/assets/rem-plan.mjs`。这些游戏素材适用根目录 NOTICE 的素材权属与使用声明。
