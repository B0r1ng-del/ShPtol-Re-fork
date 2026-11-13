/**
 * 契约专用敌人（本季 randomEnemyAttributeDict 里有、但波次 / 特训条目 / 首领 / 模板 / 赏金都不引用）。
 *
 * 这份名单**冻结**：它的用途是让 waves.js 的随机抽取把这些 key 排除，既有对局的抽取结果因此逐字节不变。
 * 新增敌人进 data/enemies.json 时**不要**往这里加 —— 只有「确实不属于本季波次」的才在。
 * 判定依据是改动前的 data/enemies.json（249 条）与现在的差集，一次性算好写死，与文件状态无关，可重复。
 */
export const CRISIS_POOL_EXTRAS = Object.freeze([
  'enemy_10026_vtzepl', 'enemy_10026_vtzepl_2', 'enemy_1002_nsabr', 'enemy_10031_cnvsld_2',
  'enemy_10034_cnvsax_2', 'enemy_10035_cnvdnc', 'enemy_10035_cnvdnc_2', 'enemy_10067_ftsjc_2',
  'enemy_10070_ftkbtt', 'enemy_10078_mprein', 'enemy_10078_mprein_2', 'enemy_10084_hlegle_2',
  'enemy_10085_hllevi', 'enemy_1008_ghost', 'enemy_10094_crstf_2', 'enemy_10099_crvln_2',
  'enemy_10122_uacann', 'enemy_10124_uashld', 'enemy_10151_nspace_2', 'enemy_1025_reveng_2',
  'enemy_1069_icebrk', 'enemy_1071_dftman_2', 'enemy_1092_mdgint_2', 'enemy_1093_ccsbr',
  'enemy_1093_ccsbr_2', 'enemy_1098_cchmpn', 'enemy_1098_cchmpn_2', 'enemy_1118_lidbox',
  'enemy_1119_vofsd_2', 'enemy_1147_dshond', 'enemy_1151_dslntc', 'enemy_1151_dslntc_2',
  'enemy_1153_dsexcu', 'enemy_1162_magmot_2', 'enemy_1175_dushdo', 'enemy_1199_sfjin_2',
  'enemy_1201_sfzhi', 'enemy_1201_sfzhi_2', 'enemy_1221_dzomg', 'enemy_1221_dzomg_2',
  'enemy_1224_dsuply', 'enemy_1224_dsuply_2', 'enemy_1225_dkmage', 'enemy_1225_dkmage_2',
  'enemy_1233_dsshtr', 'enemy_1233_dsshtr_2', 'enemy_1249_lysdb', 'enemy_1252_lysytb',
  'enemy_1253_lysytc', 'enemy_1253_lysytc_2', 'enemy_1254_lypa', 'enemy_1266_nhapos',
  'enemy_1269_nhfly_2', 'enemy_1275_dwlock', 'enemy_1292_duskld_2', 'enemy_1307_mhrhcr',
  'enemy_1320_wdrrl', 'enemy_1321_wdarft_2', 'enemy_1328_cbjedi_2', 'enemy_1373_ltnhor_2',
  'enemy_1376_ltndru', 'enemy_1387_winshd_2', 'enemy_1389_winbab', 'enemy_1401_pogpro',
  'enemy_1401_pogpro_2', 'enemy_1402_tgshd', 'enemy_1404_msnip_2', 'enemy_1406_chghmr',
  'enemy_1406_chghmr_2', 'enemy_1407_hummbd_2', 'enemy_1409_bdguad', 'enemy_1409_bdguad_2',
  'enemy_1419_mmcike', 'enemy_1423_lrfkkt', 'enemy_1423_lrfkkt_2', 'enemy_1430_lrrook_2',
  'enemy_2011_csppt',
  // ★ 弧光作战（2026-11-05 季）专属的 6 个敌人。它们由 build-data.mjs 的 `collectEnemyKeys`
  // 按 shared/crisisArc.js 的 ARC_KEYS 显式补进 data/enemies.json（当前季的活动数据既不在
  // randomEnemyAttributeDict 池里、也不被本季任何模板引用），因此必须同时进这份排除名单 ——
  // 否则 waves.js 的随机抽取会开始抽到它们，既有对局的 RNG 序列整体漂移（实测 37+ 个 golden
  // scenario 的 rngDraws 全变）。加进这里后抽取逐字节不变。
  'enemy_1326_cbagen', 'enemy_1333_cbbgen', 'enemy_1250_lyengs_2',
  'enemy_1330_cbrush', 'enemy_1331_cbsisy', 'enemy_1332_cbterm',
]);