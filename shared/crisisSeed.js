import { t } from './i18n.js';
// 危机合约 · 开局种子码。
//
// A match draws all its randomness from one 32-bit seed, and a player reads it as an 8-character code so it can be
// typed back in or pasted into chat: 7 Crockford base-32 digits (no I L O U) plus 1 check digit, shown XXXX-XXXX.
// Same seed + same 指标 + same BAN 地图 ⇒ the same map, leaders and first shop. Typed codes accept any case, an
// optional dash, and the usual confusions (I/L read as 1, O as 0).
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const check = (v) => v.reduce((s, x, i) => (s + x * (2 * (i % 8) + 1)) % 32, 7);

/** 2914847301 → '2PVT-2J51' ('' for anything that is not a seed). */
export function seedCode(seed) {
  if (!Number.isInteger(seed) || seed <= 0 || seed > 0xffffffff) return '';
  const v = [];
  for (let i = 6; i >= 0; i--) v.push(Math.floor(seed / 2 ** (5 * i)) % 32);
  v.push(check(v));
  const s = v.map((x) => B32[x]).join('');
  return s.slice(0, 4) + '-' + s.slice(4);
}

/** A typed code (any case, with or without the dash; I/L read as 1, O as 0) → { seed } or { error }. */
export function parseSeedCode(text) {
  const s = String(text ?? '').toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[\s-]/g, '');
  if (!s) return { error: t('请输入 8 位种子码') };
  if (s.length !== 8) return { error: t('种子码是 8 位，例如 2PVT-2J51') };
  const v = [...s].map((c) => B32.indexOf(c));
  if (v.some((x) => x < 0)) return { error: t('种子码含有无效字符') };
  if (check(v.slice(0, 7)) !== v[7]) return { error: t('校验位不对，可能抄错了一位') };
  const seed = v.slice(0, 7).reduce((n, x) => n * 32 + x, 0);
  return seed > 0 ? { seed } : { error: t('超出种子范围') };
}

/**
 * A fresh non-zero seed.
 * `crypto` is the Web Crypto global (a browser and Node 18+ both have it), reached through globalThis so jsconfig's
 * lib:["ES2022"] — deliberately without DOM — still typechecks this file (its `crypto` is a real defect report, not noise).
 */
export function randomSeed() {
  const a = new Uint32Array(1);
  const webcrypto = /** @type {{ crypto: { getRandomValues(a: Uint32Array): Uint32Array } }} */ (/** @type {unknown} */ (globalThis)).crypto;
  do webcrypto.getRandomValues(a); while (!a[0]);
  return a[0];
}
