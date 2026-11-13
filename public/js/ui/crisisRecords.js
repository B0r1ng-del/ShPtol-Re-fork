// 单人/四人最高纪录：官方 crisisRecords.js 的本地部分（sp.crisis.<rules>.best.<mode>）。
// 只记本机成绩，不接全服排行榜（用户明确要求不做）。
// ★ rules 分季：重燃 rn1、弧光 arc1 —— 一个赛季的成绩不推进另一个赛季的表。
const RULES = ['rn1', 'arc1'];
const modeOK = (mode) => mode === 'solo' || mode === 'quad';
const key = (mode, rules) => 'sp.crisis.' + rules + '.best.' + mode;

export function readBest(mode, rules = 'rn1') {
  if (!modeOK(mode) || !RULES.includes(rules)) return 0;
  try {
    const n = Number(localStorage.getItem(key(mode, rules)) ?? 0);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch { return 0; }
}

const listeners = new Set();
export const subscribeBest = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** 一局打完后推进纪录；返回 { mode, previous, best } 或 null。 */
export function recordBest({ mode, rules = 'rn1', total = 0, victory = false }) {
  if (!modeOK(mode) || !RULES.includes(rules)) return null;
  const previous = readBest(mode, rules);
  const best = victory === true ? Math.max(previous, total) : previous;
  if (best > previous) {
    try { localStorage.setItem(key(mode, rules), String(best)); } catch { /* private mode */ }
    for (const fn of [...listeners]) fn(mode, best, rules);
  }
  return { mode, previous, best };
}
