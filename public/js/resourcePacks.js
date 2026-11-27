// 最小资源包查询 —— 只为让移植过来的 skinModel.js 能跑起来。
//
// 背景：离线演示版有一个完整的「分批下载资源包」系统（resources / checkResources /
// enterResources / packReady …），game 没有这套东西 —— game 的素材就是 public/assets 下的文件，
// 不存在「装了/没装」的状态。移植过来的 ui/skinModel.js 只在第 411 行问了一句
//   packReady('full') ? materializeAssets(...) : data.get('assets')
// 语义是「完整包没装就退回原始 assets」。
//
// 在 game 里素材永远在本地 ⇒ 恒返回 false，让 skinModel 走「退回原始 assets」这条分支，
// 与 game 现有的素材加载方式一致。★ 这里不做假的「已安装」判断：那会让它去
// materializeAssets 里找根本不存在的清单。

/** 资源包是否就绪。game 没有分批资源包，恒为 false（= 用本地 assets）。 */
export function packReady(name) {
  // ★ 2026-11-16：原来恒返回 false。那让 skinModel 正确退回本地 assets（game 没有分批资源包），
  // 但同时也让 hasDynamicAssistant() 永远为假 —— 因为它的判定是
  //   !!actor.dynamic && packReady('dynamic')
  // 于是主界面助理的动态立绘（spine）永远不加载，只剩一张静态图。
  //
  // dynamic 这一档语义不同：它问的不是「资源包装没装」，而是「这个角色有没有 spine 资源」。
  // game 现在带着 public/assets/local/assistant/（35 个角色、173MB），文件在就是可用，
  // 具体缺不缺由 loadAssistantSpine() 自己 fetch 失败来兜底。
  if (name === 'dynamic') return true;
  return false;
}
