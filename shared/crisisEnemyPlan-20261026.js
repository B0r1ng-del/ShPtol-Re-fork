// A route's guaranteed rounds depend only on the seed and route, so adding a
// second tag cannot move the first tag's enemies. No gameplay RNG is consumed.
export function enemyTargetRounds(route, seed) {
  const t = route?.targets;
  if (!t?.keys?.length) return [];
  let hash = Number(seed) >>> 0;
  for (const c of route.id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  const n = t.to - t.from + 1, count = Math.min(n, t.min || 2), out = [];
  for (let i = 0; i < count; i++) out.push(t.from + ((hash % n + Math.floor(i * n / count)) % n));
  return out.sort((a, b) => a - b);
}
