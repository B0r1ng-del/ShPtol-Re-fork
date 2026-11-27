// Workbook alliance rules shared by match preparation and deterministic combat.
export const COLUMBIA = 'columbiaShip';
export const COLUMBIA_ARMOR = Object.freeze({
  heavy: 'token_workbook_columbia_r31a',
  assault: 'token_workbook_columbia_r11a',
});
export const WORKBOOK_SOURCE = 'workbook-20261114';
export const COLUMBIA_DESCRIPTION = '【哥伦比亚】干员攻击力+(20+0.9×层数)%，生命值+(10+0.6×层数)%。本局游戏每消耗20资金获得1层军备。每叠加10层军备，后续每层所需资金增加10。每场战斗开始时召唤等于军备层数的R-31a重型动力装甲。每20层盟约获得一件盟约之币。\n<在场6名不同【哥伦比亚】干员>半数重型动力装甲升级为R-11a突击动力装甲。装甲享受所有已激活盟约的加成，哥伦比亚对装甲的加成翻倍。';

export function columbiaArmaments(spent) {
  let remaining = Number.isSafeInteger(spent) && spent > 0 ? spent : 0;
  let blocks = 0;
  for (let cost = 20; remaining >= cost * 10; cost += 10) {
    remaining -= cost * 10;
    blocks++;
  }
  const nextCost = 20 + 10 * blocks;
  const partial = Math.floor(remaining / nextCost);
  return { count: 10 * blocks + partial, nextCost, progress: remaining - partial * nextCost };
}

export function columbiaArmorCounts(armaments, six) {
  const count = Number.isSafeInteger(armaments) && armaments > 0 ? armaments : 0;
  // [ASSUMED] Round down the upgraded half. Every paid layer still yields one armor.
  const assault = six ? Math.floor(count / 2) : 0;
  return { heavy: count - assault, assault };
}

export function columbiaAttributes(layers, scale = 1) {
  return { atk: scale * (0.20 + 0.009 * layers), hp: scale * (0.10 + 0.006 * layers) };
}
