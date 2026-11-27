// ui/codexData.js — 档案(codex)的数据层:把游戏数据整理成"给人看"的分组。
//
// 纯函数,不碰 Preact / store,所以能直接对着它写测试(和 ui/presets.js 一样的做法)。UI 在 ui/codex.js。
//
// 三类内容,分类依据**全部来自数据本身**,没有一处是我编的:
//
//   盟约 data/bonds.json (23)
//     大 / 小盟约 = `isCore`。激活需求 = `thresholds` + `countMode` / `countsHand` / `maxInactiveBondCount`。
//     激活能力 = `effectDesc`(`desc` 是"这个盟约是什么",两回事)。
//
//   装备 data/items.json (115)
//     级别 = `tier`(1–6)。**这就是服务端上架用的档位**(gamedata `shopItemsByTier[it.tier]`),不是我自己分的。
//     费用 = `price`(1–5)。
//     ★ 精锐合并:56 组 `baseId` 相同、`isGolden` 不同的成对装备展开成**一条**,精锐那版作为"精锐后变为"。
//       数据里两版的描述几乎逐字相同、只有数值不同(攻击力+15% → +25%),所以并列显示就是答案。
//       (另有 3 件只有普通版、0 件只有精锐版。)
//
//   敌人 data/enemies.json (249)+ data/bosses.json (10)
//     按"**这个敌人怎么进场**"分页(owner:「按敌人类型分页」),每个敌人只落在**一页**:
//       `rank` = NORMAL / ELITE / BOSS,`acType` = SPECIAL / FLY / INVISIBLE / ELEMENT / REFLECTION / TIMES / DOT
//       · 普通 / 精英  = 无 acType 的 NORMAL / ELITE —— 它们填的是波次模板里的 **N / E 普通位**
//       · 首领          = `bosses.json` 里有独立血量池的(hidden 那 3 个**不在这里**,owner 要求去掉)
//       · 其他首领级    = `rank` = BOSS 但没有独立血量池的
//       · 飞行/隐匿/元素/反射·次数·持续 = 各自的 `acType` —— 它们填的是 **S 特殊位**
//     回合范围:波次模板里每个 spawn 的 `slot` 就是占位符(N/NF/E/EF/S/SF)。各回合用到的 slot 是数据里写死的:
//       回合 1–2: N NF      回合 3: E EF N NF      回合 4–13: E EF N NF S SF      回合 14–15: E EF
//     所以"可能出现在哪些回合"能算准,而**哪些敌人**填进 S 位是每局洗牌决定的(waves.js 的 TypeSchedule),
//     所以特殊类只报"回合 4–13 的 S 位",不假装知道具体哪一回合。

const arr = (v) => (Array.isArray(v) ? v : Object.values(v && typeof v === 'object' ? v : {}));
const str = (v) => (typeof v === 'string' && v ? v : '');
const num = (v, d = null) => (Number.isFinite(v) ? v : d);

/** 各回合用到了哪些 slot 占位符 —— 从 waves.json 的 `usedBy[].round` + `spawns[].slot` 直接读出来。 */
export function roundSlots(waves) {
  const byRound = new Map();
  for (const w of arr(waves)) {
    const rounds = [...new Set((Array.isArray(w.usedBy) ? w.usedBy : []).map((u) => u && u.round).filter(Number.isInteger))];
    if (!rounds.length) continue;
    for (const r of rounds) {
      if (!byRound.has(r)) byRound.set(r, new Set());
      for (const s of (Array.isArray(w.spawns) ? w.spawns : [])) if (s && s.slot) byRound.get(r).add(s.slot);
    }
  }
  return byRound;
}

/** 每个 slot 占位符 → 出现它的回合(升序)。`{ N: [1,2,…], E: [3,…], S: [4,…] }` */
export function slotRounds(waves) {
  const out = {};
  for (const [r, slots] of roundSlots(waves)) {
    for (const s of slots) (out[s] ||= []).push(r);
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].sort((a, b) => a - b);
  return out;
}

/** 把回合数组压成 "1–13" / "4, 9, 14" 这种短写法。 */
export function fmtRounds(list) {
  const a = [...new Set((Array.isArray(list) ? list : []).filter(Number.isInteger))].sort((x, y) => x - y);
  if (!a.length) return '';
  const out = [];
  let s = a[0], p = a[0];
  for (let i = 1; i <= a.length; i++) {
    const v = a[i];
    if (v === p + 1) { p = v; continue; }
    out.push(s === p ? String(s) : `${s}–${p}`);
    s = p = v;
  }
  return out.join(', ');
}

// ---- 盟约 --------------------------------------------------------------------------------------------------------

/**
 * 盟约条目 → 一行。
 *
 * `need` 是**激活需求**的文字:阈值 + 计数方式。数据里这三件事分开存,玩家在界面里从来看不到它们拼起来的样子,
 * 而这正是"我要凑几个才有用"的答案。
 * @param {any} b data/bonds.json 的一条
 */
export function bondEntry(b) {
  if (!b || typeof b !== 'object') return null;
  const id = str(b.bondId);
  if (!id) return null;
  const thresholds = (Array.isArray(b.thresholds) ? b.thresholds : []).filter((n) => Number.isFinite(n));
  return {
    id,
    name: str(b.name) || id,
    core: b.isCore === true,
    thresholds,
    maxCount: num(b.maxCount),
    need: bondNeedText(b, thresholds),
    desc: str(b.desc),
    descRaw: str(b.descRaw),
    // ★ 激活能力:**不是** desc。desc 讲"这个盟约是什么",effectDesc 才是它的能力。
    effect: str(b.effectDesc),
    effectRaw: str(b.effectDescRaw),
    effectName: str(b.effectName),
    milestones: (Array.isArray(b.layerMilestones) ? b.layerMilestones : []).length,
    members: Array.isArray(b.members) ? b.members.filter((m) => typeof m === 'string') : [],
    iconId: str(b.iconId) || null,
    season: b.bondType === 'SEASON',
    noStack: b.noStack === true,
  };
}

/** 「激活需求」的文字:阈值 + 范围。 */
function bondNeedText(b, thresholds) {
  if (!thresholds.length) return '';
  const golden = b.countsGoldenOnly === true;
  const hand = b.countsHand === true;
  const mode = b.countMode === 'BOARD_AND_DECK' ? '在场或整备区'
    : b.countMode === 'BOARD_ALL_CHESS' ? '场上全部棋子'
      : '在场';
  const who = golden ? '精锐干员' : '干员';
  const tail = b.maxInactiveBondCount >= 0 ? `（本局最多 ${b.maxInactiveBondCount} 个未激活）` : '';
  return `${mode}${who} ${thresholds.join(' / ')} 名${hand ? '（含整备区）' : ''}${tail}`;
}

// ---- 装备 --------------------------------------------------------------------------------------------------------

/** 装备 `category` 的中文名(数据里是英文枚举)。查不到原样显示,所以新增分类不会变成空白。 */
export const CATEGORY_NAME = Object.freeze({
  STAT: '属性', ECONOMY: '经济', BOND: '盟约', RECRUIT: '招募', ON_HIT: '受击',
  SP: '技力', SURVIVAL: '生存', SET: '套装', MAGIC: '法术', BOND_SIGNATURE: '盟约专属', BOND_GRANT: '给予盟约',
});

/** 一件装备(未合并)。 */
export function itemEntry(it) {
  if (!it || typeof it !== 'object') return null;
  const id = str(it.id);
  if (!id) return null;
  return {
    id,
    name: str(it.name) || id,
    tier: num(it.tier),
    price: num(it.price),
    category: str(it.category),
    itemType: str(it.itemType),
    desc: str(it.desc),
    descRaw: str(it.descRaw),
    // 合成链:upgradeChessId 指向高一档那件,所以列表上能画出"下一档是什么"
    upgradeId: str(it.upgradeChessId) || null,
    mergeable: it.mergeable === true,
    giveBondId: str(it.giveBondId) || null,
    givePowerId: str(it.givePowerId) || null,
    requiresBondId: str(it.requiresBondId) || null,
    iconId: str(it.iconId) || null,
    golden: it.isGolden === true,
  };
}

/**
 * 把 115 件装备压成"一件一条":同一 `baseId` 的普通版与精锐版合成一条,精锐那版放在 `golden`。
 *
 * owner:「相同装备精锐后与没精锐合并 直接增加 精锐后xxx变为 增加xxx就行了」。
 * 数据里两版描述几乎逐字相同、只有数值不同,所以两条并列就是"精锐后变为"。
 * 只有精锐、没有普通版的也保留(`hasPlain: false`),免得丢东西。
 * @param {any} items data/items.json
 * @returns {any[]} 每项形如 `{ ...普通版, base, golden: 精锐版|null, hasPlain }`
 */
export function mergeItemPairs(items) {
  const byBase = new Map();
  for (const raw of arr(items)) {
    const e = itemEntry(raw);
    if (!e) continue;
    const base = str(raw.baseId) || e.id;
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(e);
  }
  const out = [];
  for (const [base, list] of byBase) {
    const plain = list.find((x) => !x.golden) || null;
    const golden = list.find((x) => x.golden) || null;
    const main = plain || golden;
    out.push({ ...main, base, golden, hasPlain: !!plain });
  }
  return out;
}

/**
 * 装备树:级别(1–6)→ 费用(1–5)→ 条目 —— owner 要的折叠栏结构。
 *
 * 只产出**非空**的分支:某一级没有某个费用的装备时不留一个空折叠项。
 * @param {any} items data/items.json
 */
export function itemTree(items) {
  const merged = mergeItemPairs(items);
  const tiers = [...new Set(merged.map((x) => x.tier).filter(Number.isInteger))].sort((a, b) => a - b);
  const out = [];
  for (const t of tiers) {
    const inTier = merged.filter((x) => x.tier === t);
    const prices = [...new Set(inTier.map((x) => x.price).filter(Number.isInteger))].sort((a, b) => a - b);
    const costs = [];
    for (const p of prices) {
      const entries = inTier.filter((x) => x.price === p).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      if (!entries.length) continue;
      costs.push({ id: `t${t}c${p}`, name: `${p} 费装备`, micro: `COST ${p}`, price: p, entries });
    }
    if (!costs.length) continue;
    out.push({ id: `t${t}`, name: `${t} 级装备`, micro: `TIER ${t}`, tier: t, count: inTier.length, costs });
  }
  return out;
}

// ---- 敌人 --------------------------------------------------------------------------------------------------------

/**
 * 外层:**敌人档次** —— 阵营分四档,这是数据里的 `rank` + `bosses.json`。
 *
 * `slot` = 这一档的敌人填的波次占位符(见文件头),`rounds` 由 `slotRounds` 从数据算出,不写死。
 */
export const ENEMY_RANKS = Object.freeze([
  { id: 'normal', name: '普通敌人', micro: 'NORMAL', slot: 'N' },
  { id: 'elite', name: '精英敌人', micro: 'ELITE', slot: 'E' },
  { id: 'bossless', name: '其他首领级', micro: 'BOSS · NO POOL', slot: null },
  { id: 'boss', name: '首领', micro: 'BOSS', slot: null },
]);

/**
 * 内层:**特殊类型** —— 数据 `acType` 里那五种玩家真正要区分对待的。
 *
 * ⚠ 这是**正交**的第二维,不是"更强的档位":一只 `ELITE/FLY` 既是精英也是飞行,
 * 它在"精英敌人 × 飞行"这一格里。玩家查它多半是想问"这个怎么打",所以飞行是比精英更有用的索引。
 *
 * `TIMES` / `DOT` / `SPECIAL` / 无类型 全部归进 `plain`(普通)——
 * 前两个在数据里各只有 10 / 12 个、`SPECIAL` 只是"会被填进特殊位的通类",单独成页只会让玩家多点几次。
 * @type {readonly { id: string, name: string, micro: string, acType: string|null }[]}
 */
export const ENEMY_SUBS = Object.freeze([
  { id: 'plain', name: '普通', micro: 'PLAIN', acType: null },
  { id: 'fly', name: '飞行', micro: 'FLY', acType: 'FLY' },
  { id: 'element', name: '元素', micro: 'ELEMENT', acType: 'ELEMENT' },
  { id: 'invisible', name: '隐秘', micro: 'INVISIBLE', acType: 'INVISIBLE' },
  { id: 'reflection', name: '反射', micro: 'REFLECTION', acType: 'REFLECTION' },
]);

/** 一个敌人属于哪一档(外层)。 */
export function enemyRankOf(e) {
  if (e.rank !== 'BOSS') return e.rank === 'ELITE' ? 'elite' : 'normal';
  return e.pool ? 'boss' : 'bossless';
}

/** 一个敌人属于哪一型(内层)。没命中四种特殊类型的一律 `plain`。 */
export function enemySubOf(e) {
  const hit = ENEMY_SUBS.find((s) => s.acType && e.acType === s.acType);
  return hit ? hit.id : 'plain';
}

/**
 * 敌人条目 → 一行。
 * @param {any} e data/enemies.json 的一条
 * @param {Set<string>} pool 有独立血量池的首领 key(`bosses.json` 的全部)
 * @param {Set<string>} hidden 隐秘核心首领 key(`bosses.json` 里 `hidden: true`)
 */
export function enemyEntry(e, pool = null, hidden = null) {
  if (!e || typeof e !== 'object') return null;
  const key = str(e.key);
  if (!key) return null;
  const st = e.stats && typeof e.stats === 'object' ? e.stats : {};
  return {
    key,
    name: str(e.name) || key,
    rank: e.rank === 'BOSS' ? 'BOSS' : e.rank === 'ELITE' ? 'ELITE' : 'NORMAL',
    acType: str(e.acType) || null,
    desc: str(e.desc),
    descRaw: str(e.descRaw),
    /*
     * ⚠ 这里**不导出** `isFlyEnemy` 作为分类依据(以前导出成 `fly`,UI 拿它画「飞行」标记,是错的)。
     *
     * `isFlyEnemy` 是**移动方式**(server/match/waves.js:76 用它决定走空中还是地面路线),
     * `acType === 'FLY'` 是**填波次的飞行占位符**。两者不等价:全库有 12 个 `isFlyEnemy: true` 但
     * `acType: null` 的敌人(冲击式施术单元、刺胄之弹、防护背心、暴鸰、枯朽之种…)。它们按 owner 的分类表
     * 属于「普通」,拿 `fly` 画标记就会在普通档里出现一排「飞行」,读起来像重复归类。
     * 分类只用 `acType`(见 `enemySubOf`)。
     */
    /** 有独立血量池的首领(bosses.json):血量按存活人数缩放,打它才算"打首领" */
    pool: !!(pool && pool.has(key)),
    /** 隐秘核心首领(第 15 回合)。首领页**不含**它们(owner:「首领图鉴去掉隐秘核心的」)。 */
    hidden: !!(hidden && hidden.has(key)),
    stats: {
      maxHp: num(st.maxHp), atk: num(st.atk), def: num(st.def), res: num(st.res),
      moveSpeed: num(st.moveSpeed),
      // 重量:推拉能不能挪动它,只看这个
      massLevel: num(st.massLevel), blockCnt: num(st.blockCnt),
    },
  };
}

/** `bosses.json` 里全部首领的 enemyKey(= 有独立血量池那些)。 */
export function poolBossKeys(bosses) {
  const out = new Set();
  for (const b of arr(bosses)) if (b && typeof b.enemyKey === 'string' && b.enemyKey) out.add(b.enemyKey);
  return out;
}

/** `bosses.json` 里隐藏(第 15 回合)首领的 enemyKey。 */
export function hiddenBossKeys(bosses) {
  const out = new Set();
  for (const b of arr(bosses)) if (b && b.hidden === true && typeof b.enemyKey === 'string' && b.enemyKey) out.add(b.enemyKey);
  return out;
}

/** 首领的展示名(bosses.json 的 name 比 enemies.json 的更正式)。 */
export function bossNameByKey(bosses) {
  const out = new Map();
  for (const b of arr(bosses)) if (b && typeof b.enemyKey === 'string' && b.enemyKey) out.set(b.enemyKey, str(b.name) || b.enemyKey);
  return out;
}

/**
 * 敌人树:**四档 × 五型** 两层。
 *
 * owner 要的是「普通敌人 普通/飞行/元素/隐秘/反射;精英敌人 …;其他首领级 …;首领 …」。
 *
 * 每档下**五型全都产出**(即使某型是空的),因为界面上要画成一行固定的类型栏 —— 空格子显示成不可点,
 * 玩家一眼看出"这一档没有飞行敌人",而不是以为少画了一个。翻页只在**有内容的**型之间走。
 *
 * 首领档排除隐秘核心的那 3 个(owner:「首领图鉴去掉隐秘核心的」)。
 *
 * @param {any} enemies data/enemies.json @param {any} bosses data/bosses.json @param {any} waves data/waves.json
 */
export function enemyTree(enemies, bosses, waves) {
  const pool = poolBossKeys(bosses);
  const hid = hiddenBossKeys(bosses);
  const bossNames = bossNameByKey(bosses);
  const byName = (a, b) => a.name.localeCompare(b.name, 'zh');
  // 首领用 bosses.json 的名字(它才是"图鉴"口径),其余用 enemies.json 自己的
  const all = arr(enemies).map((e) => enemyEntry(e, pool, hid)).filter(Boolean);
  for (const e of all) if (e.pool && bossNames.has(e.key)) e.name = bossNames.get(e.key);

  const sr = slotRounds(waves);
  return ENEMY_RANKS.map((r) => {
    const mine = all.filter((e) => enemyRankOf(e) === r.id && !(r.id === 'boss' && e.hidden));
    const subs = ENEMY_SUBS.map((s) => {
      const entries = mine.filter((e) => enemySubOf(e) === s.id).sort(byName);
      return { ...s, entries, count: entries.length, rank: r.id };
    });
    const rounds = r.slot ? (sr[r.slot] || []) : [];
    return {
      ...r,
      count: mine.length,
      rounds,
      roundText: fmtRounds(rounds),
      subs,
      /** 这一档里有内容的型(翻页只在这些之间走) */
      filled: subs.filter((s) => s.count > 0),
    };
  }).filter((r) => r.count > 0);
}

// ---- 组装 --------------------------------------------------------------------------------------------------------

/**
 * 把一份数据切成图鉴的三棵树。
 *
 * 每组都**只保留非空的**(没有数据时不留一个空标签页),组内按名称排序 —— 数据文件是 id 序,不是给玩家看的顺序。
 *
 * @param {{ bonds?: any, items?: any, enemies?: any, bosses?: any, waves?: any }} data
 */
export function buildCodex(data = {}) {
  // ⚠ 解构**不能**写在参数位置:`buildCodex(null)` 会在解构时抛 TypeError,而"数据没加载完"正是会传 null 的时候。
  const src = data && typeof data === 'object' ? data : {};
  const { bonds, items, enemies, bosses, waves } = src;
  const byName = (a, b) => a.name.localeCompare(b.name, 'zh');

  // --- 盟约:大小两组;详情走弹窗,所以列表可以紧凑 ---
  const bt = arr(bonds).map(bondEntry).filter(Boolean);
  const bondGroups = [
    { id: 'core', name: '大盟约', micro: 'CORE', core: true },
    { id: 'sub', name: '小盟约', micro: 'SUB', core: false },
  ].map((g) => ({ ...g, entries: bt.filter((e) => e.core === g.core).sort(byName) })).filter((g) => g.entries.length);

  // --- 装备:级别 → 费用 两级折叠 ---
  const itemGroups = itemTree(items);

  // --- 敌人:四档 × 五型 两层 ---
  const enemyRanks = enemyTree(enemies, bosses, waves);

  return {
    bonds: bondGroups,
    items: itemGroups,
    enemies: enemyRanks,
    /**
     * 隐秘核心的 3 个:首领档不列,但计数里仍然算得上(所以"四档相加 + 这个数 = 249")。
     * ⚠ 这里必须用 `hiddenBossKeys(bosses)`,不能靠 `enemyEntry` 的 `hidden` 字段 —— 那个要传参才算得出来,
     * 漏传就会恒等于 0(我第一版就是这么写错的)。
     */
    hiddenCount: (() => {
      const hid = hiddenBossKeys(bosses);
      return arr(enemies).filter((e) => e && typeof e.key === 'string' && hid.has(e.key)).length;
    })(),
    counts: {
      bonds: bt.length,
      items: itemGroups.reduce((a, g) => a + g.count, 0),
      enemies: arr(enemies).length,
    },
  };
}
