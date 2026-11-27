import { checkDiyPick, diyPool, diyRecord, diySlot, diySlotIds } from './diy.js';

export const DIY_DRAFT_TIERS = Object.freeze([5, 6]);
export const DIY_DRAFT_CANDIDATES = 6;
export const DIY_DRAFT_PICKS = 2;
export const DIY_DRAFT_SECONDS = 30;

export function diyDraftSlots(data, tier) {
  return diySlotIds(data).filter(id => diySlot(id, data)?.tier === tier).slice(0, DIY_DRAFT_PICKS);
}

export function normalizeDiyCandidates(raw, data, kitted) {
  const out = { 5: [], 6: [] };
  for (const tier of DIY_DRAFT_TIERS) {
    const [slot] = diyDraftSlots(data, tier);
    if (!slot || !Array.isArray(raw?.[tier])) continue;
    const allowed = new Set(diyPool(tier, { data, kitted }));
    const seen = new Set();
    for (const candidate of raw[tier].slice(0, DIY_DRAFT_CANDIDATES)) {
      if (!allowed.has(candidate?.charId) || seen.has(candidate.charId)) continue;
      const checked = checkDiyPick(slot, candidate, data);
      if (!checked.ok) continue;
      seen.add(candidate.charId);
      out[tier].push(checked.pick);
    }
  }
  return out;
}

export function selectDiyCandidates(candidates, selected, data, off) {
  const chosen = {};
  const selectedChars = new Map();
  for (const tier of DIY_DRAFT_TIERS) {
    const slots = diyDraftSlots(data, tier);
    const indices = selected?.[tier];
    if (!Array.isArray(indices) || indices.length > slots.length || new Set(indices).size !== indices.length) return null;
    for (const [index, source] of indices.entries()) {
      const pick = candidates[tier]?.[source];
      if (!pick || !Number.isSafeInteger(source) || source < 0) return null;
      const record = diyRecord(slots[index], pick, { data });
      if (!record || record.bonds?.length && record.bonds.every(id => off.has(id))) return null;
      const prototype = data.backups?.diy?.prototypes?.[tier]?.includes(pick.charId);
      if (selectedChars.has(pick.charId) && !(prototype && selectedChars.get(pick.charId))) return null;
      selectedChars.set(pick.charId, prototype);
      chosen[slots[index]] = pick;
    }
  }
  return chosen;
}
