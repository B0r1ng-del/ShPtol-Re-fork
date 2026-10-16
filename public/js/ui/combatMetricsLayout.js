// Local combat meter, now docked BELOW the top bar's tool row (需求方 2026-10-17: the 作战统计 button moved up into
// `.gm__tools` beside ⚙ / 📖 / ⛶). A short viewport must not squeeze the ranking out: cap the panel to the space that
// is actually left between the row's bottom edge and the viewport's own bottom (safe areas excluded).
export function combatMetricsLayout({
  cornerBottom, viewportHeight, viewportTop = 0, rem = 40, safeTop = 0, safeBottom = 0,
}) {
  const gap = Math.max(.1 * rem, 8);
  const viewportSpace = Math.max(0, viewportHeight - safeTop - safeBottom - 12);
  const availableHeight = Math.max(0, Math.min(viewportSpace,
    viewportTop + viewportHeight - safeBottom - cornerBottom - gap));
  return { availableHeight, viewportSpace };
}
