// ui/adapters/nativeTopBarBindings.js — 把**本地真实数据**映射到原生顶栏的绑定字段（第 28 轮）。
//
// 边界（严格遵守用户要求）：
//   · 只读 `m.public` / `m.private` 里**已经存在**的字段；不改状态、不发请求、不改协议
//   · 数据缺失时**显式隐藏该组节点**，绝不填 0 或占位符（用户明令：禁止假数据）
//   · 不引入线上任何 JS 依赖；只读 packet 的 scriptBindings 结构
//
// 线上原点（镜像 `regulationBattleThemeStaticModel20261110.js`，我照抄其语义，非臆造）：
//   AutoChessStylizedHUDStagePanel
//     _roundText       ← pub.round
//     _playerHpText    ← lp（生命值）+ 护盾 → "50+2"
//     _loseHpGrp       ← active: 有损失才显示
//     _lostHpText      ← 损失量
//   AutoChessStylizedHUDNormalBattleSubPanel
//     _enemyCurCountText / _enemyTotalCountText ← hud.resolved / hud.total
//     _lostEnemyGrp    ← active: 有漏怪才显示
//     _lostEnemyText   ← 漏怪数
//   AutoChessStylizedHUDBossBattleSubPanel
//     _bossHpSlider    ← boss.hp / boss.max 比例

/**
 * 从 packet 里按 class 取字段 → nodeId 的映射。
 *
 * ★ 同名 class 会**出现多次**（实测 `AutoChessStylizedHUDNormalBattleSubPanel` 有 2 条：
 *   一条挂 `group_battle`、一条挂 `group_coop`，两套面板各有自己的 text_current/text_total）。
 *   之前用 `out.set(cls, map)` 直接覆盖 ⇒ 只剩最后一条（coop），
 *   战斗面板的节点永远收不到 patch，界面上一直显示 packet 的静态占位值 "120"
 *   —— 这就是「敌人数量显示错误」的根因。
 *   现在把同名 class 合并为**同一个 map 的 nodeId 数组**，由调用方对每个节点都下发 patch。
 *
 * @param {any} packet
 * @returns {Map<string, Record<string, string|string[]>>} class → { fieldName: nodeId | nodeId[] }
 */
export function bindingIndex(packet) {
  const out = new Map();
  const push = (map, k, id) => {
    const prev = map[k];
    if (prev == null) { map[k] = id; return; }
    if (Array.isArray(prev)) { if (!prev.includes(id)) prev.push(id); return; }
    if (prev !== id) map[k] = [prev, id];
  };
  for (const b of packet?.scriptBindings || []) {
    const cls = Array.isArray(b.class) ? b.class[1] : b.class;
    if (!cls || !b.fields) continue;
    const map = out.get(cls) || {};
    for (const [k, v] of Object.entries(b.fields)) {
      if (v?.nodeId) push(map, k, v.nodeId);
    }
    out.set(cls, map);
  }
  return out;
}

/**
 * 生成本地数据 → 原生顶栏 patches。
 *
 * ★ 所有取值都先判 `Number.isFinite`；不满足就**不产生 patch**（保持该节点原生静态状态），
 *   而不是塞一个 0 —— 那会在界面上显示成真实的 "0 生命"。
 *
 * @param {any} packet
 * @param {{ pub:any, priv?:any, lp?:number, shield?:number, hud?:any, loss?:number, miss?:number }} src
 * @returns {Record<string, any>} nodeId → patch
 */
export function buildDataPatches(packet, src = {}) {
  const idx = bindingIndex(packet);
  const patches = {};
  // nodeId 可能是数组（同名 class 的多个面板，见 bindingIndex）：逐个下发，不能只取一个。
  const patch = (nodeId, value) => {
    if (nodeId == null) return;
    const ids = Array.isArray(nodeId) ? nodeId : [nodeId];
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      patches[id] = { ...(patches[id] || {}), ...value };
    }
  };
  const field = (cls, name) => idx.get(cls)?.[name];
  // ★ 必须排除 null / '' / undefined 再判有限性：`Number(null) === 0`、`Number('') === 0`，
  //   否则「没有数据」会被渲染成真实的 "0"（敌人总数 0、生命 0），比不显示更误导。
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.trunc(n)) : null;
  };

  const { pub, lp, shield = 0, hud, loss = 0, miss = 0, inBattle = false } = src;

  // ★★ 作战期隐藏左右两个放大镜（第 36 轮，用户明确要求）。
  //   packet 里 `btn_check_player` / `btn_check_enemy` 的 `active` **恒为 true**，
  //   7 个 status 全都没有控制它们（实测逐条确认）⇒ 从准备期到作战期一直显示。
  //   线上同样如此（用户说「这个 bug 连线上网站都有」，但只要求修本地）。
  //   这里在战斗期把这两个按钮组关掉 —— 显示条件与顶栏自身一致：COMBAT / SETTLE / 联防 / boss 战。
  const magnifier = src.hideMagnifier === true;
  if (magnifier) {
    const nodes = packet?.nodes || {};
    for (const [id, n] of Object.entries(nodes)) {
      if (n?.name === 'btn_check_player' || n?.name === 'btn_check_enemy') {
        patch(id, { active: false });
      }
    }
  }

  // ── 关卡面板：回合数、生命值、扣血组 ──────────────────────────────
  const stage = 'AutoChessStylizedHUDStagePanel';
  const roundText = num(pub?.round);
  // ★ 同上：text_num 的静态值是 "2"，缺数据时也要清空，不能留占位。
  patch(field(stage, '_roundText'), { text: roundText ?? '' });

  // 同上：`Number(null) === 0`，不能把「没有生命值数据」画成 0 血。
  const lpTxt = num(lp);
  const lpNum = lpTxt == null ? null : Number(lpTxt);
  const sh = Math.max(0, Math.trunc(Number(shield) || 0));
  patch(field(stage, '_playerHpText'), {
    text: lpNum == null ? '' : (sh > 0 ? `${lpNum}+${sh}` : String(lpNum)),
  });

  // 扣血组：只有真的有损失才显示；无损失显式 false（这就是那条红色残留条）
  const hasLoss = Number.isFinite(Number(loss)) && Number(loss) > 0;
  patch(field(stage, '_loseHpGrp'), { active: hasLoss });
  patch(field(stage, '_lostHpText'), { text: hasLoss ? `-${num(loss) ?? ''}` : '' });

  // ── 普通战：敌人计数、漏怪组 ────────────────────────────────────
  // ★ packet 里这些 Text 的**静态 value 是导出时的示例数据**（实测 text_current / text_total 都是 "120"，
  //   漏怪 text_num 是 "2"）。之前只在有数据时才下发 patch ⇒ 没数据时节点保留 "120"，
  //   界面上就是「敌人数量显示错误」。所以**必须**在缺少数据时显式清空，不能让它留在占位值。
  const normal = 'AutoChessStylizedHUDNormalBattleSubPanel';
  const cur = num(hud?.resolved ?? hud?.killed);
  const total = num(hud?.total);
  patch(field(normal, '_enemyCurCountText'), { text: cur ?? '' });
  patch(field(normal, '_enemyTotalCountText'), { text: total ?? '' });

  const hasMiss = Number.isFinite(Number(miss)) && Number(miss) > 0;
  patch(field(normal, '_lostEnemyGrp'), { active: hasMiss });
  patch(field(normal, '_lostEnemyText'), { text: hasMiss ? (num(miss) ?? '') : '' });

  // ── Boss 战：敌人计数 + 血条 ────────────────────────────────────
  // ★ Boss 面板是**独立的一整套**节点（`AutoChessStylizedHUDBossBattleSubPanel`，在 group_boss 下），
  //   与普通战/联防的面板互不共用。之前只给普通战面板下发 patch ⇒ Boss 回合里那一套
  //   一直显示 packet 的静态占位 "120"，这就是「进入 boss 回合后敌人数量还是显示不正常」。
  const bossPanel = 'AutoChessStylizedHUDBossBattleSubPanel';
  patch(field(bossPanel, '_enemyCurCountText'), { text: cur ?? '' });
  patch(field(bossPanel, '_enemyTotalCountText'), { text: total ?? '' });

  // ★ 血量滑块：`scriptBindings._bossHpSlider.nodeId` 就是 `sliderBindings` 的 **key**
  //   （实测两边都是 -7599482776633538456）。之前拿 `field()` 的返回值当 sliderBindings 的 key 去查，
  //   字段名 ≠ nodeId ⇒ 永远查不到 ⇒ Boss 血条不动（这就是「Boss 血量显示不正常」）。
  //   正确做法：把 `field()` 拿到的 nodeId 直接当 sliderBindings 的键。
  const sliderId = field(bossPanel, '_bossHpSlider');
  const sliderIds = Array.isArray(sliderId) ? sliderId : (sliderId ? [sliderId] : []);
  const boss = hud?.boss || pub?.bossHp;
  const bossMax = Number(boss?.max ?? boss?.maxHp);
  const bossHp = Number(boss?.hp);
  if (sliderIds.length && Number.isFinite(bossHp) && Number.isFinite(bossMax) && bossMax > 0) {
    const ratio = Math.max(0, Math.min(1, bossHp / bossMax));
    for (const sid of sliderIds) {
      const sliderNode = packet?.sliderBindings?.[sid];
      const fillNode = sliderNode?.fillNodeId;
      if (fillNode) patch(fillNode, { sliderFill: { ratio, direction: sliderNode.direction } });
    }
  }

  return patches;
}

/**
 * 本地 `m.private` 里生命值/护盾的实际字段名，随版本可能不同 ——
 * 这里做一次**只读探测**并返回命中的字段名，便于在报告里写清"数据从哪来"。
 * 找不到就返回 null（调用方据此隐藏，而不是显示 0）。
 * @param {any} priv
 */
export function detectLpFields(priv) {
  if (!priv || typeof priv !== 'object') return { lp: null, shield: null };
  const lpKey = ['lp', 'health', 'hp', 'life'].find((k) => Number.isFinite(Number(priv[k])));
  const shieldKey = ['shield', 'lpShield', 'shieldHp'].find((k) => Number.isFinite(Number(priv[k])));
  return { lp: lpKey ? { key: lpKey, value: priv[lpKey] } : null, shield: shieldKey ? { key: shieldKey, value: priv[shieldKey] } : null };
}
