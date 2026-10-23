// tools/custom-content.mjs — 自定义内容（官方 act2autochess 赛季数据里没有的棋子 / 盟约）。
//
// 为什么需要它：本项目没有给「自创干员 / 自创盟约」留扩展点 —— 内容包（packs/）目前只支持 `lang` 类型，
// `data` 类型在 docs/PACKS.md 里是 "planned"（不会加载）。所以自制内容只能**在构建前注入官方数据表**，
// 让 tools/build-data.mjs 的既有管线照常生成它：属性 / 技能 / 天赋 / 模组 / 盟约阈值全部由官方代码推导，
// 这里一个数值都不手写。
//
// 注入清单（chess → effect → bond，顺序无关，都在 main() 的构建之前）：
//   棋子    act.charChessDataDict / chessNormalIdLookupDict / charShopChessDatas
//   盟约    act.bondInfoDict + ac.bondInfoDict（autoChessData）
//   效果    act.effectInfoDataDict + act.effectBuffInfoDataDict（盟约黑board，buildBonds 会读它推阈值）
//   策略    act.bandDataListDict + ac.bandDataDict + act.effectInfoDataDict / effectBuffInfoDataDict
//           （buildBands 读 effectId 的效果记录拿 buffs / desc；prep 侧行为在 server/sim/content/bands/meta.js）
//
// 加内容时同步改下面这些常量（validateAll 与 test/data.test.js、test/backups.test.js 里是硬断言）：
export const CUSTOM_VISIBLE_CHESS = 13;  // 新增「可见、非 DIY」棋子数  （112 + N；2026-10-18 雷姆必拓批次下架，13 = 东/乌萨斯批次）
export const CUSTOM_BASE_CHESS = 13;     // 新增基础棋子数（PRESET）  （133 + N；2026-10-18 雷姆必拓批次下架）
export const CUSTOM_CHESS_RECORDS = 26;  // 新增 chess 记录数（普通 + 精英）（266 + N；2026-10-18 雷姆必拓批次下架 40→26）
export const CUSTOM_BOND_COUNT = 2;      // 新增盟约数                （23  + N；【东】【乌萨斯】；雷姆必拓 2026-10-18 下架）
export const CUSTOM_CORE_BOND_COUNT = 2; // 新增「核心」盟约数        （8   + N；雷姆必拓 2026-10-18 下架）
export const CUSTOM_ITEMS = 6;           // 新增装备数（普通 + 进阶）（115 + 2N 条记录 / 56 + N 件普通 EQUIP；rim 道具 9_05/9_06 2026-10-18 随批次下架 8→6）
export const CUSTOM_BAND_COUNT = 5;      // 新增策略数                （40  + N；自制 5 条 2026-10-17；兔兔支援/独家签约 2026-10-18 下架）

/** 自制棋子。key = 基础 chessId（不带 `_a`）。 */
const CHESS = {
  'chess_char_3_99': {
    charId: 'char_289_gyuki',           // 缠丸：4★ 近卫 / 无畏者(fearless) / nationId higashi（东国）
    tier: 3,                            // 商店等级：tier 3 → price 3（2026-10-13 用户口径：从 tier 2 调到 tier 3）
    identifier: 9001,                   // 自定义段，避开官方编号
    shopSortId: 900,
    defaultSkillIndex: 1,               // 默认技能 = 第 2 个（恶鬼之力）；kit 里两个技能都写了 spec
    moduleId: 'uniequip_002_gyuki',     // DRE-Y 断竹插花作品
    bondIds: ['dongShip', 'indomShip'], // 【东】【不屈】
    garrisonIds: ['garrison_988_a', 'garrison_988_b'], // 特质（普通/精锐）：恶鬼血战
  },
  'chess_char_3_97': {
    charId: 'char_118_yuki',            // 白雪：4★ 狙击 / 炮手(aoesniper) / nationId higashi
    tier: 2,                            // 2026-10-14 用户口径：从 tier 3 改回 tier 2
    identifier: 9019,
    shopSortId: 909,
    defaultSkillIndex: 1,               // S2 凝武（签名技）
    moduleId: 'uniequip_002_yuki',      // art-y 手里剑
    bondIds: ['dongShip', 'skillfulShip'], // 【东】【灵巧】
    garrisonIds: ['garrison_990_a', 'garrison_990_b'], // 特质：武库清点
  },
  'chess_char_3_96': {
    // 2026-10-17 用户修订：吉星（char_4203_kichi）**下线**，本槽位改绑松桐；盟约由【东】【精准】换成【东】【远见】，
    // 特质 991 换成「<休整期结束时>使已激活的【东】【远见】层数+5/10」（与官方 garrison_69 同型）。
    charId: 'char_4199_makiri',         // 松桐：5★ 先锋 / 策士(counsellor) / nationId higashi
    tier: 3,
    identifier: 9021,
    shopSortId: 910,
    defaultSkillIndex: 1,               // S2 万手成局（S1 入场安排是 AUTO 技能，不能做默认技能）
    moduleId: null,                     // 松桐没有模组（build-data 会给精锐形态写一个 inactive 占位 module，同蒂比 2_13）
    bondIds: ['dongShip', 'visiShip'],  // 【东】【远见】
    garrisonIds: ['garrison_991_a', 'garrison_991_b'], // 特质：<休整期结束时>已激活的【东】【远见】+4/8（2026-10-19 三修：原 +5/10）
  },
  'chess_char_5_97': {
    charId: 'char_362_saga',            // 嵯峨：6★ 先锋 / 尖兵(pioneer) / nationId higashi
    tier: 5,
    identifier: 9023,
    shopSortId: 911,
    defaultSkillIndex: 2,               // S3 怒目（签名技）
    moduleId: 'uniequip_003_saga',      // sol-x 何处寻驮？（002 是 SOL-Y 身向云泥，未选用）
    bondIds: ['dongShip', 'swiftShip'], // 【东】【迅捷】（2026-10-17 用户修订，原【东】【坚守】）
    garrisonIds: ['garrison_989_a', 'garrison_989_b'], // 特质：同门切磋
  },
  'chess_char_6_97': {
    charId: 'char_1029_yato2',          // 麒麟R夜刀：6★ 特种 / 处决者(executor) / nationId rhodes（盟约按用户指定覆盖为东）
    tier: 6,
    identifier: 9025,
    shopSortId: 912,
    defaultSkillIndex: 1,               // S2 乱舞（2026-10-13 用户修订，原 S3 空中回旋乱舞）
    moduleId: 'uniequip_003_yato2',     // exe-y 罗德岛制式双刀
    bondIds: ['dongShip', 'raidShip', 'indomShip'], // 【东】【突袭】【不屈】
    garrisonIds: ['garrison_992_a', 'garrison_992_b'], // 特质：麒麟之魂
  },
  'chess_char_6_98': {
    charId: 'char_1051_headb2',         // 怒潮凛冬：6★ 近卫 / 撼地者(hammer) / nationId ursus（乌萨斯）
    tier: 6,                            // tier 6 → price 4（44 个 6★ 全为 6|4）
    identifier: 9003,
    shopSortId: 901,
    defaultSkillIndex: 2,               // S3 无可抵挡（6★ 惯例 18/22 用 skillIndex 2）
    moduleId: 'uniequip_002_headb2',    // ham-x 迟到的勋章
    bondIds: ['ursusShip', 'swiftShip', 'steadShip'], // 【乌萨斯】（自制核心）【迅捷】【坚守】（官方附加；2026-10-12 加坚守）
    garrisonIds: ['garrison_980_a', 'garrison_980_b'], // 特质（普通/精锐）：潮涌共鸣
  },
  'chess_char_6_99': {
    charId: 'char_197_poca',            // 早露：6★ 狙击 / 攻城手(siegesniper，professions.js 补分支) / nationId ursus，学生自治团
    tier: 6,                            // tier 6 → price 4（用户指定 t6）
    identifier: 9009,
    shopSortId: 904,
    defaultSkillIndex: 2,               // S3（tier6 惯例 index 2）
    moduleId: 'uniequip_002_poca',      // SIE-X 攻城器械训练装置
    bondIds: ['ursusShip', 'preciShip'],// 【乌萨斯】【精准】
    garrisonIds: ['garrison_983_a', 'garrison_983_b'], // 特质：雪崩攻势
  },
  'chess_char_5_98': {
    charId: 'char_4224_turdus',         // 乌啾：5★ 医疗 / 链愈师(chainhealer) / nationId ursus
    tier: 5,                            // tier 5 → price 4（用户指定 t5；tier5 惯例 price 4）
    identifier: 9011,
    shopSortId: 905,
    defaultSkillIndex: 1,               // S2 “捉迷藏！”（签名技）
    moduleId: 'uniequip_002_turdus',    // XAH-X “睡前故事”（跳跃衰减 25%→15%）
    bondIds: ['ursusShip', 'swiftShip'],// 【乌萨斯】【迅捷】
    garrisonIds: ['garrison_984_a', 'garrison_984_b'], // 特质：病床巡视
  },
  'chess_char_5_99': {
    charId: 'char_4226_veen',           // 维伊：6★ 术师 / 秘术师(mystic) / nationId ursus
    tier: 5,                            // tier 5 → price 4（用户指定 t5，非 6★ 惯例）
    identifier: 9013,
    shopSortId: 906,
    defaultSkillIndex: 2,               // S3（签名技）
    moduleId: 'uniequip_002_veen',      // MSC-Y 军械库
    bondIds: ['ursusShip', 'arcaneShip'],// 【乌萨斯】【奥术】
    garrisonIds: ['garrison_985_a', 'garrison_985_b'], // 特质：奥术共鸣
  },
  'chess_char_4_99': {
    charId: 'char_4055_bgsnow',         // 鸿雪：6★ 狙击 / 重射手(closerange) / nationId rhodes（盟约按用户指定覆盖为乌萨斯）
    tier: 4,                            // tier 4 → price 3（用户指定 t4）
    identifier: 9015,
    shopSortId: 907,
    defaultSkillIndex: 2,               // S3（签名技）
    moduleId: 'uniequip_002_bgsnow',    // ARC-Y 打字机色带
    bondIds: ['ursusShip', 'preciShip'],// 【乌萨斯】【精准】
    garrisonIds: ['garrison_986_a', 'garrison_986_b'], // 特质：休整犒赏
  },
  'chess_char_3_98': {
    charId: 'char_194_leto',            // 烈夏：5★ 近卫 / 领主(lord) / nationId ursus，学生自治团
    tier: 3,                            // tier 3 → price 3（用户指定 t3）
    identifier: 9017,
    shopSortId: 908,
    defaultSkillIndex: 1,               // S2 一呼百应（签名技）
    moduleId: 'uniequip_002_leto',      // LOR-Y 旧衣服
    bondIds: ['ursusShip'],             // 【乌萨斯】
    garrisonIds: ['garrison_987_a', 'garrison_987_b'], // 特质：学生代表
  },
  'chess_char_2_98': {
    charId: 'char_4223_botany',         // 伯塔尼：5★ 辅助 / 巫役(ritualist) / nationId ursus
    tier: 2,                            // tier 2 → price 3（5★→tier2 项目内 28 例）
    identifier: 9005,
    shopSortId: 902,
    defaultSkillIndex: 0,               // S1 谐波破坏（用户指定，非 tier2 惯例 S2）
    moduleId: 'uniequip_002_botany',    // rit-x 昨日、今日、明日
    bondIds: ['ursusShip', 'deputShip'],// 【乌萨斯】【助力】
    garrisonIds: ['garrison_981_a', 'garrison_981_b'], // 特质：乌萨斯齐鸣
  },
  'chess_char_4_98': {
    charId: 'char_188_helage',          // 赫拉格：6★ 近卫 / 武者(musha) / nationId ursus
    tier: 4,                            // tier 4 → price 3（tier4 现行惯例）
    identifier: 9007,
    shopSortId: 903,
    defaultSkillIndex: 1,               // S2 弦月（tier4 惯例 21/26 用 skillIndex 1；自带 75% 物理闪避）
    moduleId: 'uniequip_002_helage',    // sbl-x 藏锋（无特性追加；003 免死版未被选用）
    bondIds: ['ursusShip', 'visiShip'], // 【乌萨斯】【远见】（2026-10-13 用户口径：去掉【突袭】）
    garrisonIds: ['garrison_982_a', 'garrison_982_b'], // 特质：<休整期开始时>已激活的【乌萨斯】【远见】+6/12（2026-10-18 修订）
  },

};


/**
 * 官方预设棋子的盟约覆盖（乌萨斯核心盟约上线后，同势力官方棋子补归属，2026-10-12）。
 * key = 基础 chessId，value = 完整 bondIds 覆盖（_a/_b 同表）。只覆盖棋子侧：
 * 官方保留盟约（坚守/独行）在官方 chessIdList 里本就有它们；ursusShip 侧镜像由 BONDS.ursusShip.members 提供。
 */
const BOND_OVERRIDES = {
  chess_char_2_17: ['ursusShip', 'steadShip', 'soloShip'], // 折桠：乌萨斯、坚守、独行
  chess_char_1_10: ['ursusShip', 'steadShip'],             // 古米：乌萨斯、坚守
  // 【东】上线后补归属（2026-10-13，用户口径；只加不改 —— 官方 bond 的 chessIdList 原样保留）
  chess_char_1_18: ['dongShip', 'raidShip'],               // 宴：东、突袭
  chess_char_2_11: ['dongShip', 'miraShip'],               // 风丸：东、奇迹
  chess_char_4_09: ['dongShip', 'egirShip', 'soloShip'],   // 水月：东、阿戈尔、独行
  chess_char_4_17: ['yanShip', 'dongShip'],                // 星熊：炎、东
  chess_char_5_10: ['siracusaShip', 'dongShip', 'emptyShip'], // 铃兰：叙拉古、东、协防
};

/**
 * 官方盟约的 **weight 覆盖** —— 「谁会进开局禁用抽取池」+「被抽中的相对概率」（2026-10-17 用户口径）。
 *
 * `pool.js drawDisabledBonds` 消费 weight：`> 0` = 候选资格；抽取为**按 weight 的加权无放回抽样**
 * （2026-10-17 第二条起，10 = 官方「正常可抽」标尺；权重相等时等价于原均匀洗牌）。weight 0 → 10 =
 * 把这条盟约从「永不入池」改成「可被抽中禁用」；< 10 = 降低中签率，> 10 = 提高。
 *
 * 本次：**协防干员 (emptyShip) 0 → 10**（它一旦被抽中，只挂协防的干员就会被连坐禁掉；
 * 挂别的盟约的成员照旧靠那条腿存活）。**投资人 (investShip) 明确保持 0 = 永不被禁**；
 * 调和 (maniShip) / 绝技 (suntShip) 也保持 0（用户未要求改动）。
 *
 * ⚠️ `economy.fallbackBondId` 也是 emptyShip：自选编队里「无对应阵营」的干员会回落成协防，
 * 这部分**不参与禁用判定**（见 `server/match/player/diy.js` buildDiyStock 的豁免）。
 */
const BOND_WEIGHT_OVERRIDES = {
  // 2026-10-18（用户回退到 2026-10-17 第二条口径：5+5 加权抽取、远见/奇迹降权；第三条的 6+5 重权重表与
  // PR3 放回保底随【雷姆必拓】批次一起撤销）。10 = 官方「正常可抽」标尺；权重相等时等价于原均匀洗牌。
  // 自制【东】【乌萨斯】不在官方 bondInfoDict（weight 默认 1）→ 注入模板内改 10（build-data）。
  visiShip: 2.5, miraShip: 2.5,   // 远见/奇迹：0.25×（用户口径「调低概率」）
  swiftShip: 45, preciShip: 45, skillfulShip: 45, // 迅捷/精准/灵巧：4.5×（重三件套，压可用数）
  emptyShip: 10,                                   // 协防：官方 weight 0（永禁）→ 10（用户口径「协防仍可抽中」；自选池 fallback 干员的载体）
  // 其余盟约全部保持官方默认权重 10（协防 emptyShip 照旧可抽中；投资人 investShip weight 0 = 永不入池）。
};

/**
 * 官方特质的覆盖（`act.garrisonDataDict`）。盟约【东】上线后，补入【东】的官方棋子里，若宿主的特质按盟约**
 * 读层**（`attrByBond` 的 `bond_id`）并在文案里点名盟约，则文案与读层列表都要把【东】补上 —— 否则展示
 * 与实际加成不一致（2026-10-14 用户口径）。
 *
 * key = garrisonId，value = { desc, bonds }：`desc` = 覆盖后的 `garrisonDesc`（含 rich 标记，buildGarrisons
 * 的 textPair 会拆出 desc / descRaw）；`bonds` = 覆盖后的 `bond_id`（逗号分隔，stepsOf 据此读层）。_a / _b 成对。
 * 目前只有水月 garrison_07（【阿戈尔】→【阿戈尔】【东】）。星熊 garrison_65 是「自身所属盟约」不点名盟约，
 * 语义已含【东】，无需覆盖。
 */
const GARRISON_OVERRIDES = {
  garrison_07_a: { desc: '【阿戈尔】【东】每叠加3层，本干员攻击力<@ba.vup>+1%</>', bonds: 'egirShip,dongShip' },
  garrison_07_b: { desc: '【阿戈尔】【东】每叠加3层，本干员攻击力<@ba.vup>+2%</>', bonds: 'egirShip,dongShip' },
};

/**
 * 自制特质（garrisons，干员在本模式的自身效果展示）。官方条目在 `act.garrisonDataDict`；
 * buildGarrisons 只收录「棋子 garrisonIds 引用到的」条目，owners 由它反算（与棋子侧互为镜像）。
 *
 * 这三条就是三个干员的**干员自身效果**（潮涌共鸣 / 乌萨斯齐鸣 / 老将刀意）的展示文案——真正的效果
 * 写在各自的 kit 里，特质本身不带战斗数据（bb 留空、effectKey 不注册 INSTALLERS → 运行时静默跳过）。
 * 编号沿用自定义段（980-982，与官方 1-160 错开）；_a = 普通形态、_b = 精锐形态（与官方 _a/_b 配对一致）。
 * 文案风格照抄官方 ADD_BOND 特质（如 garrison_24_a「消耗子弹→已激活盟约层数+2」）。
 */
const GARRISONS = {
  'garrison_980_a': {
    garrisonDesc: '<战斗中>造成伤害时，额外附带自身生命上限75%的真实伤害',
    eventType: 'IN_BATTLE', eventTypeDesc: '作战能力', eventTypeIcon: 'icon_battle',
    effectType: 'GAIN_BUFF', battleRuneKey: 'env_gbuff_new_with_verify',
  },
  'garrison_980_b': {
    garrisonDesc: '<战斗中>造成伤害时，额外附带自身生命上限150%的真实伤害',
    eventType: 'IN_BATTLE', eventTypeDesc: '作战能力', eventTypeIcon: 'icon_battle',
    effectType: 'GAIN_BUFF', battleRuneKey: 'env_gbuff_new_with_verify',
  },
  'garrison_981_a': {
    // 伯塔尼：2026-10-17 用户修订——加层目标由【乌萨斯】【助力】收窄为仅【乌萨斯】，+2/4→+3/6、上限 8/16→12/24
    garrisonDesc: '<战斗中>每次开启技能时，攻击范围内每有1名【乌萨斯】干员，使已激活的【乌萨斯】层数+3（每场战斗最多叠加12层，需盟约已激活）',
    eventType: 'IN_BATTLE', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', battleRuneKey: 'char_dynamic_ability_new',
  },
  'garrison_981_b': {
    garrisonDesc: '<战斗中>每次开启技能时，攻击范围内每有1名【乌萨斯】干员，使已激活的【乌萨斯】层数+6（每场战斗最多叠加24层，需盟约已激活）',
    eventType: 'IN_BATTLE', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', battleRuneKey: 'char_dynamic_ability_new',
  },
  'garrison_982_a': {
    // 2026-10-18 用户二次修订：<休整期开始时>使已激活的【乌萨斯】层数+6/12、【远见】层数+6/12（同值）。初版为战斗中击杀叠层（老将刀意）。
    // 与 991（松桐）同型：SERVER_PREP_START、SERVER_ADD_BOND、bbStr.bond 列举盟约（无位置条件——文案未限定在场），
    // 处理器在 meta.js（act2autochess_gar_eff_982_a/b → bondListLayers，只加已激活的）。
    garrisonDesc: '<休整期开始时>使已激活的【乌萨斯】【远见】盟约层数+6',
    eventType: 'SERVER_PREP_START', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'SERVER_ADD_BOND', battleRuneKey: null,
    bb: { count: 6 }, bbStr: { bond: 'ursusShip,visiShip' },
  },
  'garrison_982_b': {
    garrisonDesc: '<休整期开始时>使已激活的【乌萨斯】【远见】盟约层数+12',
    eventType: 'SERVER_PREP_START', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'SERVER_ADD_BOND', battleRuneKey: null,
    bb: { count: 12 }, bbStr: { bond: 'ursusShip,visiShip' },
  },

  'garrison_983_a': {
    // 2026-10-18 用户修订：数值 1%→2%（b 版 2%→4%）；并补实装——此前只有文案无 effectKey/bb（雪崩攻势从未生效），
    // 照官方 attrByBond 形态接 garrisons/battle.js 的 installReaders（bbStr.bond_id + divide_num）。
    garrisonDesc: '<战斗中>己方已激活的【乌萨斯】与【精准】盟约层数每合计达到3层，自身攻击力+2%',
    eventType: 'IN_BATTLE', eventTypeDesc: '作战能力', eventTypeIcon: 'icon_battle',
    effectType: 'GAIN_BUFF', battleRuneKey: 'env_gbuff_new_with_verify',
    effectKey: 'act1autochess_gar_eff_attrByBond',
    bb: { atk: 0.02, divide_num: 3 }, bbStr: { bond_id: 'ursusShip,preciShip' },
  },
  'garrison_983_b': {
    garrisonDesc: '<战斗中>己方已激活的【乌萨斯】与【精准】盟约层数每合计达到3层，自身攻击力+4%',
    eventType: 'IN_BATTLE', eventTypeDesc: '作战能力', eventTypeIcon: 'icon_battle',
    effectType: 'GAIN_BUFF', battleRuneKey: 'env_gbuff_new_with_verify',
    effectKey: 'act1autochess_gar_eff_attrByBond',
    bb: { atk: 0.04, divide_num: 3 }, bbStr: { bond_id: 'ursusShip,preciShip' },
  },
  'garrison_984_a': {
    // 乌啾：2026-10-17 用户修订——+2/4→+3/6、上限 8/16→12/24（加层目标仍为【乌萨斯】【迅捷】）
    garrisonDesc: '<战斗中>每次开启技能时，攻击范围内每有1名【乌萨斯】干员，使【乌萨斯】【迅捷】层数+3（每场战斗每种最多叠加12层，需盟约已激活）',
    eventType: 'IN_BATTLE', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', battleRuneKey: 'char_dynamic_ability_new',
  },
  'garrison_984_b': {
    garrisonDesc: '<战斗中>每次开启技能时，攻击范围内每有1名【乌萨斯】干员，使【乌萨斯】【迅捷】层数+6（每场战斗每种最多叠加24层，需盟约已激活）',
    eventType: 'IN_BATTLE', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', battleRuneKey: 'char_dynamic_ability_new',
  },
  'garrison_985_a': {
    // 2026-10-13 用户修订：只统计**已激活**盟约的层数（未激活的不纳入）
    garrisonDesc: '<战斗中>己方已激活的【乌萨斯】与【奥术】盟约层数每合计达到3层，自身攻击力+1%',
    eventType: 'IN_BATTLE', eventTypeDesc: '作战能力', eventTypeIcon: 'icon_battle',
    effectType: 'GAIN_BUFF', battleRuneKey: 'env_gbuff_new_with_verify',
  },
  'garrison_985_b': {
    garrisonDesc: '<战斗中>己方已激活的【乌萨斯】与【奥术】盟约层数每合计达到3层，自身攻击力+2%',
    eventType: 'IN_BATTLE', eventTypeDesc: '作战能力', eventTypeIcon: 'icon_battle',
    effectType: 'GAIN_BUFF', battleRuneKey: 'env_gbuff_new_with_verify',
  },
  'garrison_986_a': {
    // 休整期事件走 SERVER_PREP_FIN（garrison_47 同型）；文案无限定「已激活」→ 自定义处理器按 requireActive:false 加层
    // 2026-10-16 用户修订：付与对象由「身后」改为「身前」（bbStr.dir 随之改 front；实现在 meta.js positionLayers）
    garrisonDesc: '<休整期结束时>自身和身前干员的所属盟约层数+4',
    eventType: 'SERVER_PREP_FIN', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'SERVER_ADD_BOND_POSITION', battleRuneKey: null,
    bb: { count: 4 }, bbStr: { dir: 'front', conditionkey: 'character_target_inboard' },
  },
  'garrison_986_b': {
    garrisonDesc: '<休整期结束时>自身和身前干员的所属盟约层数+8',
    eventType: 'SERVER_PREP_FIN', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'SERVER_ADD_BOND_POSITION', battleRuneKey: null,
    bb: { count: 8 }, bbStr: { dir: 'front', conditionkey: 'character_target_inboard' },
  },
  'garrison_987_a': {
    // 2026-10-18 用户修订：固定给【乌萨斯军粮】，小概率（15% [ASSUMED]）改为【冰原咆哮】——handler gainLetoItems
    garrisonDesc: '<获得干员时>获得1个【乌萨斯军粮】，小概率变为获得【冰原咆哮】',
    eventType: 'SERVER_GAIN', eventTypeDesc: '单次叠加', eventTypeIcon: 'icon_bond',
    effectType: 'GAIN_ITEM', battleRuneKey: null,
    bb: { count: 1 }, bbStr: { item: 'chess_item_9_03_e_a', rare: 'chess_item_9_04_e_a', prob: 0.15 },
  },
  'garrison_987_b': {
    garrisonDesc: '<获得干员时>获得2个【乌萨斯军粮】，小概率变为获得【冰原咆哮】',
    eventType: 'SERVER_GAIN', eventTypeDesc: '单次叠加', eventTypeIcon: 'icon_bond',
    effectType: 'GAIN_ITEM', battleRuneKey: null,
    bb: { count: 2 }, bbStr: { item: 'chess_item_9_03_e_a', rare: 'chess_item_9_04_e_a', prob: 0.15 },
  },
  // ---- 2026-10-13 【东】扩展批次（988-992）----
  'garrison_988_a': {
    // 缠丸：单血线 70%（2026-10-16 用户修订：取消按盟约分档，统一「自身已激活的盟约 +12/24」；加层目标保持**已激活**的自身盟约）
    garrisonDesc: '<战斗中>每场战斗自身生命值首次降低至70%以下时，使自身已激活的盟约+12层',
    eventType: 'IN_BATTLE', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', battleRuneKey: 'char_dynamic_ability_new',
  },
  'garrison_988_b': {
    garrisonDesc: '<战斗中>每场战斗自身生命值首次降低至70%以下时，使自身已激活的盟约+24层',
    eventType: 'IN_BATTLE', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', battleRuneKey: 'char_dynamic_ability_new',
  },
  'garrison_989_a': {
    // 嵯峨：特质授予自身与身前干员（各按其所属盟约结算，一场战斗一次；2026-10-16 用户修订：+8/16→+12/24）
    garrisonDesc: '<战斗中>自身和身前的干员获得特质：每场战斗生命值首次降低至70%以下时，使自身已激活的盟约+12层',
    eventType: 'IN_BATTLE', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', battleRuneKey: 'char_dynamic_ability_new',
  },
  'garrison_989_b': {
    garrisonDesc: '<战斗中>自身和身前的干员获得特质：每场战斗生命值首次降低至70%以下时，使自身已激活的盟约+24层',
    eventType: 'IN_BATTLE', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', battleRuneKey: 'char_dynamic_ability_new',
  },
  'garrison_990_a': {
    // 白雪：获得时（SERVER_GAIN）。2026-10-17 用户修订：「已激活的层数最高的盟约」→「自身所属盟约」
    // （不再要求已激活、不再挑层数最高者 → 见 meta.js ownLayers，与鸿雪 986 同口径），+3/6→+4/8
    garrisonDesc: '<获得干员时>自身所属盟约+4层（无需激活盟约）',
    eventType: 'SERVER_GAIN', eventTypeDesc: '单次叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', battleRuneKey: null,
    bb: { count: 4 },
  },
  'garrison_990_b': {
    garrisonDesc: '<获得干员时>自身所属盟约+8层（无需激活盟约）',
    eventType: 'SERVER_GAIN', eventTypeDesc: '单次叠加', eventTypeIcon: 'icon_bond',
    effectType: 'ADD_BOND', battleRuneKey: null,
    bb: { count: 8 },
  },
  'garrison_991_a': {
    // 松桐（2026-10-17 用户修订；吉星下线后本编号改绑；2026-10-19 三修：+5/10→+4/8）：<休整期结束时>使已激活的【东】【远见】层数+4/8。
    // 与官方 garrison_69（「<休整期结束时>使已激活的【坚守】层数+4」）完全同型：eventType SERVER_PREP_FIN、
    // bbStr.bond 列举盟约、conditionkey character_target_inboard（不在场上则不触发）。处理器在 meta.js
    // （自定义 effectKey 段 act2autochess_gar_eff_991_a/b → bondListLayers，按「已激活」加层）。
    garrisonDesc: '<休整期结束时>使已激活的【东】【远见】盟约层数+4',
    eventType: 'SERVER_PREP_FIN', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'SERVER_ADD_BOND', battleRuneKey: null,
    bb: { count: 4 }, bbStr: { bond: 'dongShip,visiShip', conditionkey: 'character_target_inboard' },
  },
  'garrison_991_b': {
    garrisonDesc: '<休整期结束时>使已激活的【东】【远见】盟约层数+8',
    eventType: 'SERVER_PREP_FIN', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
    effectType: 'SERVER_ADD_BOND', battleRuneKey: null,
    bb: { count: 8 }, bbStr: { bond: 'dongShip,visiShip', conditionkey: 'character_target_inboard' },
  },
  'garrison_992_a': {
    // 麒麟R夜刀：再部署-75% + 【狂龙症】(攻击力+50% + 90% 物理/法术减伤 + 每秒流失 100 生命) +
    // 每叠3层【东】【突袭】【不屈】加攻（真效果在 kit）
    // 2026-10-14 三次修订：检测盟约改为【东】【突袭】【不屈】——层数按已激活者合计（未激活不计入），流失 50→100
    // 2026-10-16 用户修订：再部署 -50%→-75%；新增【狂龙症】攻击力 +50%
    // 2026-10-17 用户修订：【狂龙症】不再给「等同于损失生命值2倍的屏障」，改为 90% 物理与法术伤害减免
    garrisonDesc: '<战斗中>再部署时间-75%；【东】【突袭】【不屈】每叠3层，自身攻击力+1%；部署时获得【狂龙症】：立刻失去当前生命值的50%，攻击力+50%并获得90%物理与法术减伤，但每秒失去100点生命',
    eventType: 'IN_BATTLE', eventTypeDesc: '作战能力', eventTypeIcon: 'icon_battle',
    effectType: 'GAIN_BUFF', battleRuneKey: 'env_gbuff_new_with_verify',
  },
  'garrison_992_b': {
    garrisonDesc: '<战斗中>再部署时间-75%；【东】【突袭】【不屈】每叠3层，自身攻击力+2%；部署时获得【狂龙症】：立刻失去当前生命值的50%，攻击力+50%并获得90%物理与法术减伤，但每秒失去100点生命',
    eventType: 'IN_BATTLE', eventTypeDesc: '作战能力', eventTypeIcon: 'icon_battle',
    effectType: 'GAIN_BUFF', battleRuneKey: 'env_gbuff_new_with_verify',
  },

};

/**
 * 自制盟约（【东】【乌萨斯】，均为正式实装的核心盟约 —— 效果在 server/sim/content/bonds/core.js，
 * 参数在下方 bb，数值文案用官方 {i:fmt} 占位符 + descParamBaseList/perStackList 实算）。
 */
const BONDS = {
  // 【东】= 自制核心盟约，2026-10-13 效果正式化（bonds/core.js installDong 实现，参数在此）。
  // desc（静态散文，整备区显示）与 effectDesc（占位符，局内「当前效果」按
  // formatBondEffect 实算）分离 —— 与乌萨斯同一机制（见 ursusShip 注释）。
  dongShip: {
    name: '东',
    identifier: 900,
    isCore: true,                        // 势力盟约 → 与其它 core bond 同级
    powerIdList: ['higashi'],            // 官方 nationId（东国）
    activeCount: 3,
    thresholds: [3, 6],
    // 成员 = 持有该盟约的棋子（_a）：宴/风丸/松桐/白雪/缠丸/水月/星熊/铃兰/嵯峨/麒麟R夜刀（2026-10-17 松桐换下吉星）
    members: ['chess_char_1_18_a', 'chess_char_2_11_a', 'chess_char_3_96_a', 'chess_char_3_97_a', 'chess_char_3_99_a',
      'chess_char_4_09_a', 'chess_char_4_17_a', 'chess_char_5_10_a', 'chess_char_5_97_a', 'chess_char_6_97_a'],
    effectId: 'bondeffect_dong',
    buffKey: 'act2autochess_bond_eff_dong',
    // 2026-10-14 用户修订：desc/effectDesc 贴合原版（谢拉格样式）—— desc 全定性（无公式无数值），
    // effectDesc 只显示「表达式得到的结果」（提升至129% = 1+基础+每层×层数，经 dmg_disp_* 显示键计算），
    // 已损失生命比例部分是单位动态值，按官方对不可预计算部分的定性写法处理。
    // 富文本标记按官方 bondInfoDict 惯例：数值/关键词 <@ba.vup>，「（受层数影响）」<@autochess.gray>，
    // 「<在场N名…>」的数字 <@autochess.dgreen>（2026-10-14 用户口径，样式与官方盟约一致）。
    desc: '【东】干员<@ba.vup>攻击造成的伤害</>提升，自身<@ba.vup>已损失生命比例</>越高，攻击造成伤害越高<@autochess.gray>（受层数影响）</>，并获得【死战】：战斗中首次受到<@ba.vup>致命伤害</>时不撤退，保留<@ba.vup>1</>点生命，持续<@ba.vup>4</>秒，持续时间结束后撤退\n【东】干员开启技能时，所有【东】干员失去<@ba.vup>10%</>当前生命值并转化为等量屏障\n<在场<@autochess.dgreen>6</>名不同【东】干员>【东】干员<@ba.vup>攻击力</>提升，开启技能时所有【东】干员额外失去<@ba.vup>15%</>当前生命并转化为等量屏障；当前生命低于<@ba.vup>50%</>时，<@ba.vup>攻击力</>额外提升',
    effectDesc: '【东】干员攻击造成的伤害提升至<@ba.vup>{0:0%}</>，自身<@ba.vup>已损失生命比例</>越高，攻击造成伤害越高<@autochess.gray>（受层数影响）</>，并获得【死战】：战斗中首次受到<@ba.vup>致命伤害</>时不撤退，保留<@ba.vup>1</>点生命，持续<@ba.vup>4</>秒，持续时间结束后撤退\n【东】干员开启技能时，所有【东】干员失去<@ba.vup>10%</>当前生命值并转化为等量屏障\n<在场<@autochess.dgreen>6</>名不同【东】干员>【东】干员攻击力<@ba.vup>+60%</>，开启技能时所有【东】干员额外失去<@ba.vup>15%</>当前生命并转化为等量屏障；当前生命低于<@ba.vup>50%</>时，攻击力额外<@ba.vup>+120%</>',
    bb: {
      dmg_base: 0.45,        // 伤害倍率基础（×(1+45%+…)）（2026-10-17 用户修订：公式 (1+45%+0.6%×层数)×(1+0.3%×已损失生命比例)）
      dmg_per_layer: 0.006,  // 每层盟约层数 +0.6%（2026-10-17 用户修订：0.7%→0.6%）
      dmg_disp_base: 1.45,   // 显示键：effectDesc 占位符用（1+基础）——「提升至145%+0.6%×层数」的整体结果
      dmg_disp_per: 0.006,   // 显示键：每层 +0.6%（2026-10-17 用户修订：0.7%→0.6%）
      dmg_per_lost_hp: 0.003, // 每损失 1% 生命 +0.3%（×(1+0.3%×已损失生命比例)；2026-10-17 用户修订：0.4%→0.3%）
      deathless_time: 4,     // 死战持续 4s
      hp_loss_ratio: 0.1,    // 3人：开技能时所有【东】失 10% 当前生命 → 等量屏障
      hp_loss_ratio_6: 0.15, // 6人：额外失 15%
      atk_6: 0.6,            // 6人：攻击力 +60%（直接乘算；2026-10-14 用户修订：40%→60%）
      atk_low_hp: 1.2,       // 6人：生命低于 50% 时攻击力额外 +120%（2026-10-14 用户修订：40%时+80%）
      atk_low_hp_ratio: 0.5, // （2026-10-14 用户修订：40%→50%）
    },
    descParamBaseList: ['dmg_disp_base'],
    descParamPerStackList: ['dmg_disp_per'],
  },
  // 【乌萨斯】= 第二条自制核心盟约，效果同为占位符。
  // 三名乌萨斯干员（怒潮凛冬/伯塔尼/赫拉格）的「叠层」全部是**干员自身效果**（各写在 kit 里），
  // 盟约本身不带效果 —— 与【东】同一决策。
  // 注意：members 凑满 3 人即达到 threshold[0]=3，占位效果会真实进入激活判定
  //（bb 仅含计数键，激活无数值影响）。
  ursusShip: {
    name: '乌萨斯',
    identifier: 901,
    isCore: true,
    powerIdList: ['ursus'],              // 官方 nationId（乌萨斯）
    activeCount: 3,
    thresholds: [3, 6],
    // 成员 = 持有该盟约的棋子（_a）：怒潮凛冬/伯塔尼/赫拉格（2026-10-11）+ 早露/乌啾/维伊/鸿雪/烈夏 + 官方棋子折桠/古米（2026-10-12）
    members: ['chess_char_6_98_a', 'chess_char_2_98_a', 'chess_char_4_98_a',
      'chess_char_6_99_a', 'chess_char_5_98_a', 'chess_char_5_99_a', 'chess_char_4_99_a', 'chess_char_3_98_a',
      'chess_char_2_17_a', 'chess_char_1_10_a'],
    effectId: 'bondeffect_ursus',
    buffKey: 'act2autochess_bond_eff_ursus',
    // 2026-10-13 用户修订（bonds/core.js installUrsus 实现，参数在此）。
    // desc（静态文案，整备区等处显示）与 effectDesc（局内「当前效果」）分离，与官方盟约同构：
    // effectDesc 用官方 {i:fmt} 占位符 + descParamBaseList/descParamPerStackList，局内按
    // formatBondEffect（public/js/ui/richText.js）解析为 bb[base] + bb[perStack]×层数 的实算数值，
    // 不再显示「+54%+1.2%×盟约层数」这类公式原文（与官方 炎/卡西米尔 同一机制）。
    desc: '【乌萨斯】干员周围八格的干员<@ba.vup>自然技力恢复速度</>提升（不叠加），开启技能时，其他乌萨斯干员攻击力<@ba.vup>提升</><@autochess.gray>（受层数影响）</>，直到战斗结束\n<在场<@autochess.dgreen>6</>名不同【乌萨斯】干员>【乌萨斯】干员周围八格的干员<@ba.vup>自然技力恢复速度</>进一步提升（不叠加），装备<@ba.vup>1</>个道具时，<@ba.vup>攻击造成的伤害</>提升；装备<@ba.vup>2</>个道具时，<@ba.vup>攻击造成的伤害</>进一步提升',
    effectDesc: '【乌萨斯】干员周围八格的干员自然技力恢复速度<@ba.vup>+40%</>（不叠加），开启技能时，其他乌萨斯干员攻击力<@ba.vup>+{0:0.0%}</>（至多<@ba.vup>+{1:0%}</>）<@autochess.gray>（受层数影响）</>，直到战斗结束\n<在场<@autochess.dgreen>6</>名不同【乌萨斯】干员>【乌萨斯】干员周围八格的干员自然技力恢复速度<@ba.vup>+100%</>（不叠加），装备<@ba.vup>1</>个道具时攻击造成的伤害提升至<@ba.vup>175%</>；装备<@ba.vup>2</>个道具时提升至<@ba.vup>250%</>',
    bb: {
      atk_per_start: 0.054,   // 每次开技能 +5.4%（直接乘算，叠加）（2026-10-16 用户修订：3.6%→5.4%）
      atk_per_start_per_layer: 0.0012, // 每层盟约层数每次多 +0.12%（2026-10-16 用户修订：0.06%→0.12%）
      atk_cap_base: 0.54,     // 叠层上限基础值（2026-10-16 不变）
      atk_cap_per_layer: 0.012, // 每层盟约层数上限 +1.2%（2026-10-16 用户修订：0.9%→1.2%，上限=54%+1.2%×层数）
      sp_regen: 0.4,          // 周围八格自然技力回复速度 +40%（不叠加；3人档）
      sp_regen_6: 1.0,        // 6人档：覆盖为 +100%（2026-10-17 用户修订：80%→100%；仍为覆盖不是叠加）
      damage_scale_1: 1.75,   // 6人：带 1 个道具的攻击倍率（2026-10-14 用户修订：150%→175%）
      damage_scale_2: 2.5,    // 6人：带 ≥2 个道具的攻击倍率（覆盖制，非连乘；225%→250%）
    },
    descParamBaseList: ['atk_per_start', 'atk_cap_base'],
    descParamPerStackList: ['atk_per_start_per_layer', 'atk_cap_per_layer'],
  },
};

/**
 * 自制策略（bands，2026-10-17 用户需求：5 条）。
 *
 * 结构照抄官方 bandDataListDict / autoChessData.bandDataDict / effectInfoDataDict 条目：
 *   bandDesc  = 「【效果名】正文」——buildBands 直接取它当 desc / descRaw（textPair），客户端策略卡显示的就是它；
 *   name      = 立绘上的干员名（官方同形：band name 是干员名，effectName 才是策略名）；
 *   iconId    = 本项目的 assets.json `bands` 键 → 用 bandId 本身（data/assets.json 的 bands 分支按 bandId 索引）；
 *   totalHp   = 初始目标生命值（官方 20–45，中位 26）；
 *   buffs[].key 是 bands/meta.js 的 K 表键，bb 数值 / bbStr 字符串照官方 flattenBB 同形。
 *
 * 文案里的 `<乌萨斯>` / `<东>` 是**盟约引用**（不是【】）：shared/bandBonds.js 从这里反推 bondIds，
 * 决定「本局禁用」标记与 AI 是否回避——漏写会让策略在本局禁用盟约时照样被选。
 */
const BANDS = {
  band_palico: {
    name: '泰拉大陆调查团', sortId: 41, totalHp: 22,
    effectId: 'aceffect_band_9_01', effectName: '天尊救我',
    desc: '【天尊救我】你的目标生命值损失后，下回合开始时获得1名干员：等阶为当前调度等级+1（最高VI级）；盟约为你已激活盟约中层数最高的那一个（并列时取盟约表序靠前者）',
    buffs: [{ key: 'band_lp_loss_next_round_gain_highest_bond_char', bb: { tier_add: 1, max_tier: 6 } }],
    iconChar: 'char_4077_palico',        // 策略立绘用的干员（assets 仅作记录，图标走 public/assets/band/）
  },
  band_headbr: {
    name: '凛冬', sortId: 42, totalHp: 22,
    effectId: 'aceffect_band_9_02', effectName: '雪原征召',
    desc: '【雪原征召】每回合首次刷新为特殊刷新：该次刷新必定刷新1名<乌萨斯>干员，且该名<乌萨斯>干员免费',
    buffs: [{ key: 'band_first_refresh_present_free_bond_char', bb: { count: 1 }, bbStr: { bond: 'ursusShip' } }],
    iconChar: 'char_115_headbr',
  },
  band_haruka: {
    name: '遥', sortId: 43, totalHp: 26,
    effectId: 'aceffect_band_9_03', effectName: '完美偶像',
    desc: '【完美偶像】若你在本回合的战斗中没有损失目标生命值，下回合开始时额外获得2资金',
    buffs: [{ key: 'band_no_loss_next_round_gain_coin', bb: { coin: 2 } }],
    iconChar: 'char_4202_haruka',
  },
  band_utage: {
    name: '宴', sortId: 44, totalHp: 24,
    effectId: 'aceffect_band_9_04', effectName: '以物易人',
    desc: '【以物易人】每回合每售出2名干员，获得1名等阶不高于当前调度等级的<东>干员',
    buffs: [{ key: 'band_sell_count_gain_bond_char', bb: { count: 2 }, bbStr: { bond: 'dongShip' } }],
    iconChar: 'char_337_utage',
  },
  band_ulika: {
    name: 'U-Official', sortId: 45, totalHp: 31,
    effectId: 'aceffect_band_9_05', effectName: '人形天灾',
    desc: '【人形天灾】每回合额外获得1资金，但无法刷新出含当前已激活盟约的干员',
    buffs: [{ key: 'band_round_coin_no_active_bond_shop', bb: { coin: 1 } }],
    iconChar: 'char_4091_ulika',
  },
};

/**
 * 自制装备（2026-10-13 用户需求：东×2 + 乌萨斯×2）。
 * key = 基础 item id（不带 `_a/_b`；官方形态 `chess_item_<tier>_<nn>_e`，自定义段用 9 系列）。
 * 结构照抄官方 trapChessDataDict / trapShopChessDatas / effectInfoDataDict / effectBuffInfoDataDict 条目：
 *   副装备   = 带 giveBondId（自动进同构体映射 / unitBonds，support/index.js），canGiveBond 照官方惯例 false；
 *   签名装备 = T6、无 giveBondId、效果按「若携带者为【X】盟约干员」门控 + 与该盟约副装备同带强化
 *             （官方 BOND_SIGNATURE 分类的定义口径，bbStr.other_equip 指向基础 item id）；
 *   进阶     = `_b` 记录 + 独立 effectId（eff_9g_*），数值为「→」后的那档；可合成（upgradeNum 2）。
 * 战斗实现在 server/sim/content/items/battle.js 的 BY_ITEM（by item key）；属性 buff 走官方
 * attr_common_global_buff（statMods 自动处理）。无官方图标素材（iconId 指向自制 trapId，资产缺失走占位）。
 */
const ITEMS = {
  'chess_item_9_01_e': {
    name: '东国鬼面', nameEn: 'Dong Mask',
    tier: 2, price: 2, goldenPrice: 5, identifier: 9101, shopSortId: 13,
    trapId: 'trap_9001_dongmask',
    giveBondId: 'dongShip',              // 副装备：可被同构体映射转籍
    category: 'ON_HIT', kind: 'passive_counter',
    buffKey: 'act2autochess_equip_9_01_global_buff',
    desc: '开启技能时流失<@ba.vdown>10%</>当前生命，本技能期间攻击力<@ba.vup>+30%</>',
    goldenDesc: '开启技能时流失<@ba.vdown>20%</>当前生命，本技能期间攻击力<@ba.vup>+45%</>',
    bb: { hp_loss_ratio: 0.1, atk: 0.3 },
    goldenBb: { hp_loss_ratio: 0.2, atk: 0.45 },
    flavor: '东国匠人打造的鬼面，戴上它的人会听见远方的涛声。\n“疼吗？疼就对了——刀快不快，就看这一口气。”',
    implFormula: "on skillStart: loseHp(carrier, carrier.hp × hp_loss_ratio); during that skill window ATK% += atk",
  },
  'chess_item_9_02_e': {
    name: '残心一闪', nameEn: 'Zanshin Flash',
    tier: 6, price: 4, goldenPrice: 5, identifier: 9102, shopSortId: 14,
    trapId: 'trap_9002_canyin',
    giveBondId: null,                    // 签名装备：不可被同构体映射
    category: 'BOND_SIGNATURE', kind: 'passive',
    buffKey: 'act2autochess_equip_9_02_global_buff',
    desc: '攻击力<@ba.vup>+40%</>；若携带者为【东】盟约干员：自身造成物理和法术伤害时，伤害类型转化为<$ba.weaknessatk>弱点伤害</>；与东国鬼面同带：生命值首次低于50%时，获得相当于生命上限<@ba.vup>50%</>的屏障',
    goldenDesc: '攻击力<@ba.vup>+60%</>；若携带者为【东】盟约干员：自身造成物理和法术伤害时，伤害类型转化为<$ba.weaknessatk>弱点伤害</>；与东国鬼面同带：生命值首次低于50%时，获得相当于生命上限<@ba.vup>50%</>的屏障',
    stat: { atk: 0.4 }, goldenStat: { atk: 0.6 },
    bb: { other_equip: 'chess_item_9_01_e', shield_ratio: 0.5 },
    goldenBb: { other_equip: 'chess_item_9_01_e', shield_ratio: 0.5 },
    flavor: '斩击落定之后的静止，才是剑士最锋利的瞬间。\n“残心不乱，一闪足矣。”',
    implFormula: "ATK% += atk; [【Dong】 member] each physical/arts hit retypes to 弱点伤害 (weaknessRetype); [with 东国鬼面] once per battle, first time HP < 50%: shield += shield_ratio × max HP",
  },
  'chess_item_9_03_e': {
    name: '乌萨斯军粮', nameEn: 'Ursus Ration',
    tier: 3, price: 2, goldenPrice: 5, identifier: 9103, shopSortId: 15,
    trapId: 'trap_9003_junliang',
    giveBondId: 'ursusShip',             // 副装备：可被同构体映射转籍
    category: 'SURVIVAL', kind: 'passive',
    buffKey: 'act2autochess_equip_9_03_global_buff',
    desc: '生命上限<@ba.vup>+25%</>；每5秒回复相当于生命上限<@ba.vup>4%</>的生命',
    goldenDesc: '生命上限<@ba.vup>+50%</>；每5秒回复相当于生命上限<@ba.vup>5%</>的生命',
    stat: { max_hp: 0.25 }, goldenStat: { max_hp: 0.5 },
    bb: { hp_regen_ratio: 0.04 },
    goldenBb: { hp_regen_ratio: 0.05 },
    flavor: '乌萨斯行军口粮的铁皮罐，打开时总带着一股凛冽的风。\n“吃完了，就该上路了。”',
    implFormula: "HP% += max_hp; every 5s heal carrier for hp_regen_ratio × max HP",
  },
  'chess_item_9_04_e': {
    name: '冰原咆哮', nameEn: 'Tundra Roar',
    tier: 6, price: 4, goldenPrice: 5, identifier: 9104, shopSortId: 16,
    trapId: 'trap_9004_roar',
    giveBondId: null,                    // 签名装备：不可被同构体映射
    category: 'BOND_SIGNATURE', kind: 'passive',
    buffKey: 'act2autochess_equip_9_04_global_buff',
    desc: '攻击力<@ba.vup>+45%</>；若携带者为【乌萨斯】盟约干员：场上每有1名其他【乌萨斯】盟约干员，攻击力额外<@ba.vup>+4%</>（最多<@ba.vup>+20%</>）；与乌萨斯军粮同带：上限提升至<@ba.vup>+30%</>',
    goldenDesc: '攻击力<@ba.vup>+65%</>；若携带者为【乌萨斯】盟约干员：场上每有1名其他【乌萨斯】盟约干员，攻击力额外<@ba.vup>+6%</>（最多<@ba.vup>+30%</>）；与乌萨斯军粮同带：上限提升至<@ba.vup>+45%</>',
    stat: { atk: 0.45 }, goldenStat: { atk: 0.65 },
    bb: { other_equip: 'chess_item_9_03_e', per: 0.04, cap: 0.2, cap_combo: 0.3 },
    goldenBb: { other_equip: 'chess_item_9_03_e', per: 0.06, cap: 0.3, cap_combo: 0.45 },
    flavor: '风雪吹过乌萨斯荒原的声音，被乌萨斯人称作大地的咆哮。\n“雪停之前，没有谁能让我们低头。”',
    implFormula: "ATK% += atk; [【Ursus】 member] ATK% += per × (other deployed Ursus members on the field), capped at cap (cap_combo with 乌萨斯军粮 carried)",
  },
};

/** `evolvePhase/charLevel/skillLevel/equipLevel` 的模板取自 `shopCharChessInfoData[tier]`，不手写等级。 */
const statusOf = (row) => ({
  evolvePhase: row.evolvePhase, charLevel: row.charLevel, skillLevel: row.skillLevel, favorPoint: 0, equipLevel: row.equipLevel,
});

/**
 * 把自制内容注入官方赛季数据（**必须在 buildChess / buildEffects / buildBonds 之前**）。
 * 抛错即中止构建 —— 宁可构建失败，也不要静默产出半成品。
 * @param {{ act: object, ac: object }} ctx `act` = activity.AUTOCHESS_SEASON.act2autochess；`ac` = activity.autoChessData
 */
export function injectCustomContent(ctx) {
  const { act, ac } = ctx;
  if (!act || !ac) throw new Error('[custom] build context lacks act / ac');

  // ---- 棋子 ----
  for (const [base, c] of Object.entries(CHESS)) {
    const a = `${base}_a`;
    const b = `${base}_b`;
    if (act.charChessDataDict[a] || act.charChessDataDict[b]) throw new Error(`[custom] chess ${base} collides with the official season`);
    const rows = act.shopCharChessInfoData[String(c.tier)] || [];
    const normal = rows.find((r) => !r.isGolden);
    const golden = rows.find((r) => !!r.isGolden);
    if (!normal || !golden) throw new Error(`[custom] chess ${base}: shopCharChessInfoData has no tier ${c.tier} rows`);

    act.charChessDataDict[a] = {
      chessId: a, identifier: c.identifier, isGolden: false, status: statusOf(normal),
      upgradeChessId: b, upgradeNum: 3, bondIds: [...c.bondIds], garrisonIds: c.garrisonIds[0] ? [c.garrisonIds[0]] : [],
    };
    act.charChessDataDict[b] = {
      chessId: b, identifier: c.identifier + 1, isGolden: true, status: statusOf(golden),
      upgradeChessId: null, upgradeNum: 0, bondIds: [...c.bondIds], garrisonIds: c.garrisonIds[1] ? [c.garrisonIds[1]] : [],
    };
    act.chessNormalIdLookupDict[a] = a;
    act.chessNormalIdLookupDict[b] = a;
    // 商店行按 baseId 建键（buildChess: charShopChessDatas[chessNormalIdLookupDict[chessId]]）。
    // backup* 指向自己：玩家「未持有」时不会被别的原型干员替换（与官方棋子的自指写法一致；buildBackups 会跳过它）。
    act.charShopChessDatas[a] = {
      chessId: a, goldenChessId: b, chessLevel: c.tier, shopLevelSortId: c.shopSortId, chessType: 'PRESET',
      charId: c.charId, tmplId: null,
      defaultSkillIndex: c.defaultSkillIndex, defaultUniEquipId: c.moduleId,
      backupCharId: c.charId, backupTmplId: null,
      backupCharSkillIndex: c.defaultSkillIndex, backupCharUniEquipId: c.moduleId, backupCharPotRank: 0,
      isHidden: false,
    };

    // 官方盟约的成员表也要登记：test/data.test.js 断言「棋子的 bonds 与盟约的 members 互为镜像」
    for (const bondId of c.bondIds) {
      const off = act.bondInfoDict[bondId];
      if (off && Array.isArray(off.chessIdList) && !off.chessIdList.includes(a)) off.chessIdList.push(a);
    }
  }

  // ---- 官方棋子的盟约覆盖（乌萨斯补归属）----
  for (const [base, bondIds] of Object.entries(BOND_OVERRIDES)) {
    for (const suffix of ['_a', '_b']) {
      const rec = act.charChessDataDict[base + suffix];
      if (!rec) throw new Error(`[custom] bond override ${base}: official chess missing`);
      rec.bondIds = [...bondIds];
    }
  }

  // ---- 盟约 + 效果 ----
  for (const [bondId, cfg] of Object.entries(BONDS)) {
    if (act.bondInfoDict[bondId]) throw new Error(`[custom] bond ${bondId} collides with the official season`);
    for (const m of cfg.members) if (!act.charChessDataDict[m]) throw new Error(`[custom] bond ${bondId}: member ${m} not injected`);

    // 效果黑board：buildBonds 由它推导 bb / bbStr / thresholds（BOND_COUNT_KEYS: power_bond_char_cnt / ex_bond_char_cnt）
    const bbList = [
      ...Object.entries(cfg.bb).map(([key, value]) => ({ key, value, valueStr: null })),
      { key: 'power_bond_char_cnt', value: cfg.thresholds[0], valueStr: null },
      { key: 'ex_bond_char_cnt', value: cfg.thresholds[1], valueStr: null },
      { key: 'key', value: 0, valueStr: cfg.buffKey },   // 内部 buff key（与官方 bond 效果同形）
    ];
    act.effectInfoDataDict[cfg.effectId] = {
      effectType: 'BOND', effectName: cfg.name, effectDesc: cfg.effectDesc ?? cfg.desc,
      effectCounterType: 'NONE', continuedRound: -1, effectDecoIconId: null, enemyPrice: 0,
    };
    act.effectBuffInfoDataDict[cfg.effectId] = [{ key: 'env_gbuff_new', countType: 'NONE', blackboard: bbList }];

    // 里程碑 buff：独立条目（顶层 key = cfg.milestone.key，如 bond_layer_gain_chess），照官方
    // 维多利亚 bond_layer_added_reward_equip 的形态（buff key 不经 bbStr.key，直接作为条目 key）。
    // build-data.mjs buildBonds 按 x.key === 'bond_layer_gain_chess' 派生 layerMilestones（mode 'every'）；
    // bonds/core.js payRecruits 经 S.buffParams(bondRecord, key) 读 { layer, count }。
    if (cfg.milestone) {
      act.effectBuffInfoDataDict[cfg.effectId].push({
        key: cfg.milestone.key,
        countType: 'NONE',
        blackboard: Object.entries(cfg.milestone.bb).map(([k, v]) => ({ key: k, value: v, valueStr: null })),
      });
    }

    act.bondInfoDict[bondId] = {
      bondId, name: cfg.name, identifier: cfg.identifier,
      desc: cfg.desc, iconId: `icon_${bondId}`,
      activeCount: cfg.activeCount, activeCondition: 'BOARD', activeConditionTemplate: 'count_threshold_upward',
      activeParamList: cfg.thresholds.map(String),
      effectId: cfg.effectId, activeType: 'BATTLE', weight: 10, // 10 = 官方「正常可抽」标尺（2026-10-17 抽取改加权后必须对齐，原 1）
      isActiveInDeck: false, maxInactiveBondCount: -1, noStack: false,
      descParamBaseList: [...(cfg.descParamBaseList || [])], descParamPerStackList: [...(cfg.descParamPerStackList || [])],
      chessIdList: [...cfg.members],
    };
    // autoChessData 侧：isPower → isCore，powerIdList = 势力。
    // `bondId` 必须带上：buildBackups 的 faction→bond 规则用 `Object.values(ac.bondInfoDict)…map(b => b.bondId)`
    // 推导每个自选干员的 bonds，缺了它该干员的 bonds 会变成 [undefined]（validateAll 报 "bond undefined missing"）。
    ac.bondInfoDict = ac.bondInfoDict || {};
    ac.bondInfoDict[bondId] = {
      ...(ac.bondInfoDict[bondId] || {}),
      bondId, isPower: cfg.isCore, bondType: 'SEASON', bondOrder: cfg.identifier,
      name: cfg.name, powerIdList: [...cfg.powerIdList], icon: `icon_${bondId}`,
    };
  }

  // ---- 自制 + 官方盟约的禁用池权重覆盖（见 BOND_WEIGHT_OVERRIDES；放在盟约注入之后，
  // 因为 dongShip/ursusShip 两条自制核心也在覆盖表里；【雷姆必拓】批次 2026-10-18 整体下架）----
  // buildBonds 读 `act.bondInfoDict[id].weight`，必须在这里（任何 builder 之前）改，改完 buildBonds 自然写出新值。
  for (const [bondId, w] of Object.entries(BOND_WEIGHT_OVERRIDES)) {
    const b = act.bondInfoDict[bondId];
    if (!b) throw new Error(`[custom] bond weight override ${bondId}: bond missing`);
    b.weight = w;
  }

  // ---- 策略（bands）----
  // bandDataListDict 是 buildBands 的入口（effectId → effects 记录拿 buffs / desc / effectName），
  // autoChessData.bandDataDict 提供 bandName / bandIconId（buildBands 的 name / iconId）。
  // 效果记录照官方 BAND_INITIAL 同形：黑board 里数值 → value、字符串（bond 等）→ valueStr。
  if (act.bandDataListDict && ac.bandDataDict) {
    for (const [bandId, cfg] of Object.entries(BANDS)) {
      if (act.bandDataListDict[bandId]) throw new Error(`[custom] band ${bandId} collides with the official season`);
      if (act.effectInfoDataDict[cfg.effectId]) throw new Error(`[custom] band effect ${cfg.effectId} collides with the official season`);
      act.bandDataListDict[bandId] = {
        bandId, sortId: cfg.sortId, modeTypeList: [...(cfg.modeTypeList || ['LOCAL', 'SINGLE', 'MULTI'])],
        bandDesc: cfg.desc, totalHp: cfg.totalHp, effectId: cfg.effectId,
        victorCount: cfg.victorCount ?? 3, bandRewardModulus: 1.0,
      };
      ac.bandDataDict[bandId] = { bandId, bandName: cfg.name, bandIconId: cfg.iconId || bandId, unlockDesc: null };
      act.effectInfoDataDict[cfg.effectId] = {
        effectId: cfg.effectId, effectType: 'BAND_INITIAL', effectCounterType: 'NONE', continuedRound: -1,
        effectName: cfg.effectName, effectDesc: cfg.desc, effectDecoIconId: null, enemyPrice: 0,
      };
      act.effectBuffInfoDataDict[cfg.effectId] = (cfg.buffs || []).map((b) => ({
        key: b.key, countType: 'NONE',
        blackboard: [
          ...Object.entries(b.bb || {}).map(([k, v]) => ({ key: k, value: v, valueStr: null })),
          ...Object.entries(b.bbStr || {}).map(([k, v]) => ({ key: k, value: 0, valueStr: v })),
        ],
      }));
    }
  } else {
    throw new Error('[custom] build context lacks bandDataListDict / bandDataDict');
  }

  // ---- 特质（garrisons，干员自身效果的展示条目；战斗数据留空，真实效果在各 kit 里）----
  // 结构照抄官方 garrisonDataDict 条目（garrison_24_a 等）；buildGarrisons 会从棋子 garrisonIds
  // 引用它们并反算 owners，unknown effectKey 在运行时没有 INSTALLERS → 静默跳过（纯展示）。
  if (act.garrisonDataDict) {
    for (const [id, g] of Object.entries(GARRISONS)) {
      if (act.garrisonDataDict[id]) throw new Error(`[custom] garrison ${id} collides with the official season`);
      const key = `act2autochess_gar_eff_${id.replace('garrison_', '')}`;
      // g.bbStr.key 存在时覆盖默认 effectKey（flattenBB first-wins）——火哨 994 用它路由到官方
      // attr_common_global_buff 通路（garrison_08 阿戈尔同款）；其余条目仍用自定义 key。
      const handlerKey = g.bbStr?.key ?? key;
      act.garrisonDataDict[id] = {
        garrisonDesc: g.garrisonDesc,
        eventType: g.eventType, eventTypeDesc: g.eventTypeDesc, eventTypeIcon: g.eventTypeIcon,
        eventTypeSmallIcon: null, effectType: g.effectType, charLevel: 0,
        battleRuneKey: g.battleRuneKey,
        // effectKey = bbStr.key（buildGarrisons）；bb/bbStr 供 SERVER_* 处理器读（官方 flattenBB 同形）
        blackboard: [
          { key: 'key', value: 0, valueStr: handlerKey },
          ...Object.entries(g.bb || {}).map(([k, v]) => ({ key: k, value: v, valueStr: null })),
          ...Object.entries(g.bbStr || {}).filter(([k]) => k !== 'key').map(([k, v]) => ({ key: k, value: 0, valueStr: v })),
        ],
      };
    }

    // ---- 官方特质的覆盖（补【东】等新增核心盟约）----
    // 原理见 GARRISON_OVERRIDES 的注释：改 garrisonDesc（buildGarrisons 优先读它）+ blackboard 的 bond_id。
    for (const [id, ov] of Object.entries(GARRISON_OVERRIDES)) {
      const g = act.garrisonDataDict[id];
      if (!g) throw new Error(`[custom] garrison override ${id}: official garrison missing`);
      if (ov.desc) g.garrisonDesc = ov.desc;
      if (ov.bonds) {
        const entry = (g.blackboard || []).find((e) => e.key === 'bond_id');
        if (entry) { entry.value = 0; entry.valueStr = ov.bonds; }
        else (g.blackboard = g.blackboard || []).push({ key: 'bond_id', value: 0, valueStr: ov.bonds });
      }
    }
  }

  // ---- 装备（items，普通 _a + 进阶 _b，独立 effectId）----
  // buildItems 读 trapChessDataDict（chessId → 记录）+ trapShopChessDatas（baseId → 商店行）+
  // effectInfoDataDict / effectBuffInfoDataDict（名称 / 描述 / buffs）。商店行按 _a 键（goldenItemId 指向 _b，
  // buildItems 对两者都建 shopByBase）——与官方一致（商店表没有 _b 行）。
  if (act.trapChessDataDict) {
    for (const [base, cfg] of Object.entries(ITEMS)) {
      const a = `${base}_a`, b = `${base}_b`;
      if (act.trapChessDataDict[a] || act.trapChessDataDict[b]) throw new Error(`[custom] item ${base} collides with the official season`);
      const effA = `eff_${base.replace('chess_item_', '')}`, effB = `eff_9g_${base.replace('chess_item_9_', '')}`;
      // 每条列表项 = 一个 buff：行为 buff（bbStr.key = cfg.buffKey，battle.js BY_ITEM 读）与属性 buff
      // （bbStr.key = attr_common_global_buff，installItem 的 STAT_BUFFS → statMods）必须分开两条（双模机械臂同形）。
      const buffs = (buffKey, bb, stat) => {
        const list = [{
          key: 'env_gbuff_new_with_verify', countType: 'NONE',
          blackboard: [
            { key: 'key', value: 0, valueStr: buffKey },
            // 数值 → bb（value），字符串（other_equip 等）→ bbStr（valueStr）——官方 flattenBB 同形
            ...Object.entries(bb).map(([k, v]) => ({ key: k, value: typeof v === 'string' ? 0 : v, valueStr: typeof v === 'string' ? v : null })),
          ],
        }];
        if (stat) list.push({
          key: 'env_gbuff_new_with_verify', countType: 'NONE',
          blackboard: [
            { key: 'key', value: 0, valueStr: 'attr_common_global_buff' },
            ...Object.entries(stat).map(([k, v]) => ({ key: k, value: v, valueStr: null })),
          ],
        });
        return list;
      };

      act.trapChessDataDict[a] = {
        chessId: a, identifier: cfg.identifier, charId: cfg.trapId, isGolden: false, purchasePrice: cfg.price,
        status: { evolvePhase: 'PHASE_0', trapLevel: 1, skillIndex: 0, skillLevel: 1 },
        upgradeChessId: b, upgradeNum: 2, trapDuration: -1,
        effectId: effA, giveBondId: cfg.giveBondId || null, givePowerId: null, canGiveBond: false, itemType: 'EQUIP',
      };
      act.trapChessDataDict[b] = {
        chessId: b, identifier: cfg.identifier + 5000, charId: cfg.trapId, isGolden: true, purchasePrice: cfg.goldenPrice,
        status: { evolvePhase: 'PHASE_0', trapLevel: 1, skillIndex: 0, skillLevel: 1 },
        upgradeChessId: null, upgradeNum: 0, trapDuration: 0,
        effectId: effB, giveBondId: cfg.giveBondId || null, givePowerId: null, canGiveBond: false, itemType: 'EQUIP',
      };
      act.trapShopChessDatas[a] = {
        itemId: a, goldenItemId: b, hideInShop: false, itemLevel: cfg.tier, iconLevel: 0,
        shopLevelSortId: cfg.shopSortId, itemType: 'EQUIP', trapId: cfg.trapId,
      };
      act.effectInfoDataDict[effA] = {
        effectId: effA, effectType: 'EQUIP', effectCounterType: 'NONE', continuedRound: -1,
        effectName: cfg.name, effectDesc: cfg.desc, effectDecoIconId: null, enemyPrice: 0,
      };
      act.effectInfoDataDict[effB] = {
        effectId: effB, effectType: 'EQUIP', effectCounterType: 'NONE', continuedRound: -1,
        effectName: cfg.name, effectDesc: cfg.goldenDesc, effectDecoIconId: null, enemyPrice: 0,
      };
      act.effectBuffInfoDataDict[effA] = [...buffs(cfg.buffKey, cfg.bb, cfg.stat)];
      act.effectBuffInfoDataDict[effB] = [...buffs(cfg.buffKey, cfg.goldenBb, cfg.goldenStat)];
    }
  }
}



// =====================================================================================================================
// 二.3 内容包化（需求方 2026-10-23）：上游的 Dong-Ursus-Mod 是「注入即永久生效」，装了就永远是原版+东/乌萨斯。
// 本 fork 要的是 mod 菜单里的一个开关，关掉即完全回到原版。
//
// ⚠️ 时序很重要：`injectDongUrsusPack` 跑在任何 builder **之前**（数据必须先进官方表），而 `buildChess` /
// `buildBonds` / `buildGarrisons` / `buildBands` / `buildItems` 会**重新构造**每一条记录、只挑自己认识的字段 ——
// 所以 `packId` 不能盖在 `act` 上（盖了也到不了 `data/*.json`）。真正的盖章由 `applyDongUrsusPack` 在 build
// **之后**做，与莱茵 / 卡兹戴尔 / 雷姆必拓的 overlay 同一条时序。
export const DONG_URSUS_PACK = 'packDongUrsus';

/**
 * 二.3 修订（需求方 2026-10-24）：**拆成两个开关**「东国」`packDong` 与「乌萨斯」`packUrsus`，按**盟约**切分。
 *
 * 归属判据只有一条：一条记录属于哪个包，看它**引用哪条盟约**。
 *   * `dongShip` → `packDong`；`ursusShip` → `packUrsus`；
 *   * 两条都引用的（当前没有）⇒ 数组 `['packDong','packUrsus']`，任一开关打开即可用（`packEnabled` 的数组语义）；
 *   * **一条都不引用的 ⇒ 不盖 `packId`**，即默认常驻。这正是需求方 2026-10-24 对 5 条策略的口径：
 *     「策略默认直接出现，无需开关」—— 它们只是开局配置，不带任何移植数据。
 *
 * ★ 官方记录被改的那几处（折桠/古米 → 乌萨斯；宴/风丸/水月/星熊/铃兰 → 东国）落在**它自己那条盟约**的包里：
 *   关掉那一个开关就逐字段还原，另一个开关的内容不受影响。
 */
export const DONG_PACK = 'packDong';
export const URSUS_PACK = 'packUrsus';
/** bond id → the pack switch that owns it. */
export const BOND_PACK = Object.freeze({ dongShip: DONG_PACK, ursusShip: URSUS_PACK });

/**
 * The pack(s) a record belongs to, from the bonds it names. `null` = no pack (always available).
 * @param {Iterable<string>} bondIds
 * @returns {string|string[]|null}
 */
function packForBonds(bondIds) {
  const packs = new Set();
  for (const b of bondIds || []) { const p = BOND_PACK[b]; if (p) packs.add(p); }
  if (!packs.size) return null;
  if (packs.size === 1) return [...packs][0];
  // 两个包都贡献了同一条记录 ⇒ 任一开关打开就该能用（packEnabled 的数组语义是「任一」）。
  return [...packs].sort();
}

/** The pack a garrison belongs to, by the owner chess that references it (garrison → its operator's bonds). */
function packForGarrison(garrisonId, chessByGarrison) {
  const bonds = chessByGarrison.get(garrisonId);
  return bonds ? packForBonds(bonds) : null;
}

const deepClone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

/**
 * 把东国 / 乌萨斯内容注入官方赛季表，并记下「哪些 key 是新增的、哪些官方记录被改了」，留给
 * `applyDongUrsusPack` 在 build 之后盖章 / 写 `packRestore`。
 * @param {any} ctx build context（`{ act, ac }`）
 * @returns {{ chess: Set<string>, bonds: Set<string>, bands: Set<string>, items: Set<string>,
 *   garrisons: Set<string>, restore: { chess: Map<string, any>, garrison: Map<string, any>, weight: Map<string, number> } }}
 */
export function injectDongUrsusPack(ctx) {
  const { act, ac } = ctx;
  if (!act || !ac) throw new Error('[dong-ursus] build context lacks act / ac');

  const keysOf = (o) => new Set(o && typeof o === 'object' ? Object.keys(o) : []);
  const before = {
    chess: keysOf(act.charChessDataDict),
    bonds: keysOf(act.bondInfoDict),
    bands: keysOf(act.bandDataListDict),
    items: keysOf(act.trapChessDataDict),
    garrisons: keysOf(act.garrisonDataDict),
  };
  // 被覆盖的官方记录：先记住原值
  const restore = { chess: new Map(), garrison: new Map(), weight: new Map() };
  for (const base of Object.keys(BOND_OVERRIDES)) {
    for (const suf of ['_a', '_b']) {
      const rec = act.charChessDataDict?.[base + suf];
      if (rec) restore.chess.set(base + suf, deepClone(rec));
    }
  }
  for (const id of Object.keys(GARRISON_OVERRIDES)) {
    const g = act.garrisonDataDict?.[id];
    if (g) restore.garrison.set(id, deepClone(g));
  }
  for (const id of Object.keys(BOND_WEIGHT_OVERRIDES)) {
    const b = act.bondInfoDict?.[id];
    if (b) restore.weight.set(id, b.weight);
  }

  injectCustomContent(ctx);   // 上游原样注入，数据一个字不改

  const added = (after, old) => new Set([...keysOf(after)].filter((k) => !old.has(k)));
  return {
    chess: added(act.charChessDataDict, before.chess),
    bonds: added(act.bondInfoDict, before.bonds),
    bands: added(act.bandDataListDict, before.bands),
    items: added(act.trapChessDataDict, before.items),
    garrisons: added(act.garrisonDataDict, before.garrisons),
    restore,
  };
}

/**
 * build 之后：给东国 / 乌萨斯的记录按**盟约归属**盖 `packId`（`packDong` / `packUrsus`），给被改动的官方记录写
 * `packRestore.<那个包>`。策略（bands）一条都不盖 —— 需求方 2026-10-24：**策略默认直接出现，无需开关**。
 * 关掉一个开关时 `shared/packData.js` 会把那个包的记录整个剥掉、把它改过的官方记录逐字段还原，
 * 另一个开关的内容不受影响 —— 于是「关闭即不影响原版游戏」。
 * @param {Record<string, any>} files 生成好的 data/*.json
 * @param {ReturnType<typeof injectDongUrsusPack>} injected
 */
export function applyDongUrsusPack(files, injected) {
  if (!files || !injected) return;
  /** garrison id → the bonds of the operator that references it (a garrison has no bond field of its own). */
  const chessByGarrison = new Map();
  for (const rec of Object.values(files.chess || {})) {
    if (!rec || typeof rec !== 'object') continue;
    for (const g of Array.isArray(rec.garrisonIds) ? rec.garrisonIds : []) chessByGarrison.set(g, rec.bonds || []);
  }
  const stampOne = (rec, pack) => {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec) || !pack) return;
    rec.packId = pack;
  };
  const stampByBonds = (table, ids, bondsOf) => {
    for (const id of ids) stampOne(table?.[id], packForBonds(bondsOf(table?.[id], id)));
  };
  // 棋子 / 盟约 / 装备：它们自己就写着盟约，直接按盟约判。
  // ★ 装备里的**签名装备**（残心一闪 / 冰原咆哮）没有 `giveBondId`（不可被同构体映射），但它们 `bb.other_equip`
  //   指向同一包里的那件副装备 —— 按那件判，否则它们会漏成「常驻」。
  stampByBonds(files.chess, injected.chess, (rec) => (rec ? rec.bonds : []));
  stampByBonds(files.bonds, injected.bonds, (rec, id) => (rec ? [id] : []));
  // 装备：副装备自己写着 `giveBondId`，签名装备（`giveBondId: null`）没有 —— 但四件装备的归属是固定的
  // （9_01 鬼面 / 9_02 残心一闪 → 东；9_03 军粮 / 9_04 冰原咆哮 → 乌萨斯），照 ID 映射判，别去猜 `bb`。
  const ITEM_PACK = { chess_item_9_01_e: DONG_PACK, chess_item_9_02_e: DONG_PACK, chess_item_9_03_e: URSUS_PACK, chess_item_9_04_e: URSUS_PACK };
  for (const id of injected.items) {
    const rec = files.items?.[id];
    if (!rec) continue;
    const base = String(rec.baseId || id).replace(/_[ab]$/, '');
    rec.packId = ITEM_PACK[base] || packForBonds(rec.giveBondId ? [rec.giveBondId] : []);
    if (!rec.packId) delete rec.packId;
  }
  // 特质：自己没有盟约，看**引用它的那名干员**。
  for (const id of injected.garrisons) stampOne(files.garrisons?.[id], packForGarrison(id, chessByGarrison));
  // 策略：**不盖**（默认常驻）。`injected.bands` 只用于下面的计数一致性，不参与 packId。

  // 被注入器改过的官方记录 → packRestore（关那个包时还原）
  const note = (rec, pack, fields) => {
    if (!rec || !pack || !Object.keys(fields).length) return;
    rec.packRestore = { ...(rec.packRestore && typeof rec.packRestore === 'object' ? rec.packRestore : {}), [pack]: fields };
  };
  for (const [baseId, orig] of injected.restore.chess) {
    // ★ 键是 **baseId**（`chess_char_2_17`），记录上的是 baseId 字段；charId 是另一回事（`char_4207_branch`）。
    //   第一版按 charId 匹配，永远不命中，packRestore 于是从未写出 —— 关包后官方记录仍带 `ursusShip`。
    for (const rec of Object.values(files.chess || {})) {
      if (!rec || rec.baseId !== baseId) continue;
      const fields = {};
      if (JSON.stringify(rec.bonds) !== JSON.stringify(orig.bondIds)) fields.bonds = orig.bondIds;
      // 那条官方记录归哪个包：按**它被改成的那份盟约**（注入后的 `rec.bonds`）判 —— 原值里当然没有 dongShip /
      // ursusShip，用原值判会得到 null，`packRestore` 就一条都写不出来。
      note(rec, packForBonds(rec.bonds || []), fields);
    }
  }
  for (const [id, orig] of injected.restore.garrison) {
    const now = files.garrisons?.[id];
    if (!now) continue;
    // 注入器改的是 `garrisonDesc` 与 blackboard 里的 `bond_id`；buildGarrisons 再把它们落成
    // **三处**：`desc`（富文本已剥）、`descRaw`（保留 <@ba…> 标记）、`bbStr.bond_id`。
    // 三处都要还原，漏一处关包后 JSON 里就还留着 dongShip（第一版只还原了 desc）。
    const fields = {};
    if (now.desc !== orig.garrisonDesc) fields.desc = orig.garrisonDesc;
    if (now.descRaw !== orig.garrisonDesc) fields.descRaw = orig.garrisonDesc;
    const wantBond = (orig.blackboard || []).find((e) => e && e.key === 'bond_id');
    if (wantBond && now.bbStr && now.bbStr.bond_id !== wantBond.valueStr) {
      fields.bbStr = { ...now.bbStr, bond_id: wantBond.valueStr };
    }
    const pack = packForGarrison(id, chessByGarrison) || packForBonds((orig.bonds || '').split(','));
    note(now, pack, fields);
  }
  for (const [id, w] of injected.restore.weight) {
    const now = files.bonds?.[id];
    // 权重覆盖一次动了好几条官方盟约（远见/奇迹/迅捷/精准/灵巧/协防），它们**不属于**东国或乌萨斯任何一包 ——
    // 把权重还原挂在任一开关上都不对（关「东」不该改远见的权重）。所以这里**不写 packRestore**：
    // 权重是这张数据表在「装了移植内容」前提下的既有口径，两个开关全关时也一样（与包内容无关）。
    if (!now || now.weight === w) continue;
    void w;
  }
}
