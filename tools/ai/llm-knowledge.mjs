// §35.15. [ASSUMED] System-prompt view of an sp-knowledge/1 pack. The pack itself is unchanged:
// strategyCandidates still reads the full local playbook. Third-party agents still receive the full hello pack.
const capsOf = (op, byId) => {
  const row = byId.get(op.id) || byId.get(op.baseId);
  const c = row?.capabilities;
  return { air: !!c?.air, block: !!c?.block, sustain: !!c?.sustain, elementRecovery: !!c?.elementRecovery };
};

const size = (o) => JSON.stringify(o).length;
const dropEffects = (v) => ({ ...v,
  items: v.items.map(({ effect, ...rest }) => rest),
  bonds: v.bonds.map(({ effect, ...rest }) => rest),
});

export function slimKnowledge(pack, { maxChars = Infinity } = {}) {
  const view = slimView(pack);
  // [ASSUMED] Compact enemies stay while the example system text fits in 200000 characters.
  // Translated catalogues (English funny) exceed that; the round's upcoming list still names those enemies.
  if (!view.enemies.length) return view;
  if (size(view) <= maxChars) return view;
  // ★ 2026-11-08: the budget used to be all-or-nothing on `enemies`, so the Chinese hard pack lost its whole
  // 249-enemy catalogue over a 1 095-character overflow (201 095 vs 200 000) — one added operator could silently
  // empty the list. Once i18n translated the catalogue to 100 % the ENGLISH packs no longer fit even with enemies
  // gone (227 487 vs 191 483), because the translation lengthened operators / playbook / items.
  // Trim in rising cost order, cheapest loss first, and stop at the first view that fits:
  //   1 keep as many compact enemies as fit (the pack's own order, so the early tiers survive);
  //   2 drop the long prose of items.effect / bonds.effect — the ids, names, costs and thresholds stay,
  //     so the model can still plan; it loses only the flavour text (the maintainer's choice, 2026-11-08);
  //   3 shorten each operator's trait line to 60 characters — the caps / skill / bonds are what planning uses.
  // ★ 2026-11-13: the ladder used to skip from 150 to 100, and the 危机合约 #4 pack (two arc leaders + their four
  //   wave templates + four enemies) pushed the Chinese hard view just past 150 ⇒ it fell all the way to 100, which is
  //   the threshold the example prompt is asserted against. A finer ladder keeps the catalogue proportional to the budget
  //   instead of halving it.
  for (const keep of [200, 180, 160, 150, 130, 110, 100, 60, 30, 12]) {
    if (keep >= view.enemies.length) continue;
    const trimmed = { ...view, enemies: view.enemies.slice(0, keep) };
    if (size(trimmed) <= maxChars) return trimmed;
  }
  const noEnemies = { ...view, enemies: [] };
  if (size(noEnemies) <= maxChars) return noEnemies;
  const lean = dropEffects(noEnemies);
  if (size(lean) <= maxChars) return lean;
  return { ...lean, operators: lean.operators.map((o) => ({ ...o, trait: (o.trait || '').slice(0, 60) })) };
}

function slimView(pack) {
  const pb = pack.playbook || {};
  const byId = new Map((pb.operators || []).map(o => [o.id, o]));
  const fly = new Map((pb.enemies || []).map(e => [e.id, !!e.fly]));
  const insights = new Map((pb.bands || []).map(b => [b.id, b.insights || []]));
  const trait = op => String(Array.isArray(op.traits) ? op.traits[0] || '' : '').slice(0, 120);
  return {
    schema: pack.schema, version: pack.version, language: pack.language, modeId: pack.modeId,
    rulesSummary: pack.rulesSummary, economy: pack.economy,
    bonds: (pack.bonds || []).map(b => ({ id: b.id, name: b.name, kind: b.core ? 'core' : 'class', thresholds: b.thresholds, countMode: b.countMode,
      countsGoldenOnly: b.countsGoldenOnly, effect: b.effect })),
    operators: (pack.operators || []).map(o => ({ id: o.id, name: o.name, tier: o.tier, cost: o.cost, class: o.class,
      bonds: o.bonds || [], caps: capsOf(o, byId), trait: trait(o), skill: o.skill?.name || '' })),
    items: (pack.items || []).map(i => ({ id: i.id, name: i.name, cost: i.cost, effect: i.effect })),
    bands: (pack.bands || []).map(b => ({ id: b.id, name: b.name, lp: b.lp, effect: b.effect, carriesFunds: b.carriesFunds,
      insights: insights.get(b.id) || [] })),
    bosses: (pack.bosses || []).map(b => ({ id: b.id, name: b.name, enemyKey: b.enemyKey, hpByDifficulty: b.hpByDifficulty,
      // Pack notes stay ability objects (sp-knowledge/1). The prompt view keeps their readable text only.
      notes: Array.isArray(b.notes) ? b.notes.map(n => typeof n === 'string' ? n : (n && (n.text || n.desc)) || '').filter(Boolean).join(' ').slice(0, 240) : '' })),
    enemies: (pack.enemies || []).map(e => ({ id: e.id, name: e.name, hp: e.stats?.maxHp || 0, def: e.stats?.def || 0,
      res: e.stats?.res || 0, motion: e.stats?.motion || '', fly: fly.get(e.id) || e.stats?.motion === 'FLY' })),
    playbook: {
      schema: pb.schema, policy: pb.policy, inactiveBonds: pb.inactiveBonds, maxShopLevel: pb.maxShopLevel,
      community: pb.community, cycles: pb.cycles, graph: pb.graph,
      pairings: (pb.bonds || []).map(b => ({ id: b.id, pairings: b.pairings || [] })),
      schedule: pb.schedule, recommendedSchedule: pb.recommendedSchedule, legacyReference: pb.legacyReference,
      bandInsights: (pb.bands || []).map(b => ({ id: b.id, insights: b.insights || [] })),
      warnings: pb.warnings, lateRule: pb.lateRule, leaderHitLimit: pb.leaderHitLimit,
    },
  };
}
