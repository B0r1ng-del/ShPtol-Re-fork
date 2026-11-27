/* 移植自 _sp-卫戍协议终端胶囊-四态整合/02-数据/nodemat.js —— 原文数据，未改数值。脚本转 ESM（export const）。 */
/* 卫戍协议终端 · 顶栏胶囊 —— Image 材质绑定（自 MonoBehaviour.m_Material 解析出的 Material.m_Name）
   ★ 只有这 5 个节点挂了非默认材质（原 7 个，2 个属 BOSS 态已删），全部是加法类：
     m_add     → _SrcBlend=1(One) / _DstBlend=1(One)  ⇒ **加法混合**
     m_repeat  → 同为加法
   其余节点 m_Material 为空 ⇒ Unity 用默认 UI/Default（Normal alpha 混合）。
   CSS 对应：加法用 mix-blend-mode:plus-lighter，普通用 normal。
   ★ 不做区分的后果：fx_trans 的 trans_glow 会被当成不透明实心色块盖住胶囊，
     这正是用户报的「休整绿成一片」。 */
export const DEF_MAT = {"group_battle/fx_trans":"m_add","group_battle/tag_miss/add":"m_add","group_coop/fx_trans":"m_add","group_coop/tag_miss/add":"m_add","group_rest/fx_trans":"m_add"};
