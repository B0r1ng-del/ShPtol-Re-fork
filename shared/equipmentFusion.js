/** A reciprocal recipe in the active equipment catalogue. The result has its own identity. */
export function equipmentFusion(id, getItem) {
  const item = getItem(id);
  if (!item?.fuseWith || !item.fuseResult || item.isGolden || item.id === item.fuseWith) return null;
  const other = getItem(item.fuseWith);
  const result = getItem(item.fuseResult);
  if (other?.fuseWith !== id || other.fuseResult !== item.fuseResult || other.isGolden ||
      !result?.isGolden || !Array.isArray(result.fusionComponents) || result.fusionComponents.length !== 2 ||
      !result.fusionComponents.includes(id) || !result.fusionComponents.includes(other.id)) return null;
  return { partnerId: other.id, resultId: result.id };
}
