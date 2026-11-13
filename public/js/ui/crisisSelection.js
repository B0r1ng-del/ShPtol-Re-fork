// 分享码编解码：官方 js/crisisSelection.js（SPCC1.<base64url>.<fnv1a32>）。
// ★ 只分享**指标组合**（+ 可选开局种子/BAN 地图），绝不夹带成绩或已完成的局。
// ★ rules 分季：rn1 重燃 / arc1 弧光；别季的码直接拒绝（词条规则不同）。
import { checkCrisis, isCrisisSeed } from '../../../shared/crisis.js';

const ARC_RULES = 'arc1';
const RN_RULES = 'rn1';

const checksum = (s) => {
  let n = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 0x01000193);
  return (n >>> 0).toString(16).padStart(8, '0');
};

export const cleanBans = (v) => [...new Set(Array.isArray(v) ? v.filter((id) => typeof id === 'string' && id.length <= 100) : [])].slice(0, 20).sort();

function selection(mode, tags, season = null) {
  const arc = season === 'arc';
  const checked = checkCrisis({ ...(arc ? { season: 'arc' } : {}), mode, tags });
  if (!checked) throw Error('指标组合无效：请检查模式、指标等级或冲突项');
  return { mode: checked.mode, tags: tags.slice(), total: checked.total, ...(arc ? { season: 'arc' } : {}) };
}

export function exportSelection(mode, tags, { seed = null, bans = [], season = null } = {}) {
  const c = selection(mode, tags, season);
  if (!c.tags.length) throw Error('请先选择需要分享的指标');
  const arc = c.season === 'arc';
  const extra = { ...(isCrisisSeed(seed) ? { seed } : {}), ...(!arc && cleanBans(bans).length ? { bans: cleanBans(bans) } : {}) };
  const body = btoa(JSON.stringify({ v: 1, base: 'HARD', rules: arc ? ARC_RULES : RN_RULES, mode: c.mode, tags: c.tags, ...extra }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'SPCC1.' + body + '.' + checksum(body);
}

export function importSelection(value) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('分享码过长或格式不正确');
  const code = value.replace(/\s/g, ''), m = /^SPCC1\.([A-Za-z0-9_-]+)\.([0-9a-f]{8})$/.exec(code);
  if (!m || checksum(m[1]) !== m[2]) throw Error('分享码不完整或已损坏，请重新复制');
  let d;
  try { d = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))); }
  catch { throw Error('分享码内容无法读取'); }
  if (d?.v !== 1 || d.base !== 'HARD') throw Error('不支持此版本的分享码');
  if (d.rules !== undefined && d.rules !== RN_RULES && d.rules !== ARC_RULES) throw Error('这是其他赛季的分享码，词条规则不同，无法导入');
  const arc = d.rules === ARC_RULES;
  const c = selection(d.mode, d.tags, arc ? 'arc' : null);
  if (!c.tags.length) throw Error('分享码没有选择任何指标');
  return { ...c, ...(isCrisisSeed(d.seed) ? { seed: d.seed } : {}), ...(!arc && Array.isArray(d.bans) ? { bans: cleanBans(d.bans) } : {}) };
}
