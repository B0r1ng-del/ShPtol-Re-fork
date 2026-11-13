// 危机合约 · 指标卡片图标 (official js/ui/crisisTags.js:196–278).
//
// A route's tile symbol is a hand-drawn 44x43 SVG (the video's own symbols, its level marks taken out); the enemy
// routes show their target's portrait instead. A route with tiers also carries a tag-num<N> mark.
//
// Ported verbatim: the paths ARE the artwork, so re-deriving them would just produce a different picture.
import { html } from './components.js';
import { data } from '../data.js';
import { enemyIconUrl } from './assetUrls.js';

/** The official art directory (tag-<name>.png / tag-num<N>.png). */
export const CC_TAG_UI = '/assets/local/sp-crisis-20261021-a94f75cbeb5d/ui/';
// ---- glyphs ------------------------------------------------------------------------------------------------------
// the video's symbols, its level marks taken out (art-tags.py); grid and the 纰庢櫠 never had any
const IMG = { A1: 'base-tear', B1: 'base-spike', B2: 'shardC1', B3: 'base-thorn', C1: 'shardB1', C2: 'shardA1', D1: 'base-queue',
  D2: 'base-frost', E1: 'shardD1', E2: 'base-mend', F1: 'base-void', F2: 'base-scope', K1: 'grid1', K2: 'base-ridge', L1: 'base-guard',
  N1: 'base-coil', N3: 'base-timer' };
// the rest, on the same 44脳43 box, white blocks and 3px strokes; a route with tiers keeps the lower right (x>32, y>30) clear
const S = (w = 3, more = '') => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linejoin="miter" stroke-linecap="square"${more}`;
const F = 'fill="#fff"';
const coin = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" ${S(3)}/><path d="M${x} ${y - r * 0.5}L${x + r * 0.5} ${y}L${x} ${y + r * 0.5}L${x - r * 0.5} ${y}Z" ${F}/>`;
const clock = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" ${S(2.5)}/><path d="M${x} ${y}V${y - r + 3}M${x} ${y}H${x + r - 3}" ${S(2)}/>`;
const crown = (x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 10L0 2L3.5 5.5L6 0L8.5 5.5L12 2L12 10Z" ${F}/>`;
const heart = (x, y, s, solid = true) => `<path transform="translate(${x} ${y}) scale(${s})" d="M10 18L2.5 10.5A4.6 4.6 0 0 1 10 4.5A4.6 4.6 0 0 1 17.5 10.5Z" ${solid ? F : `fill="none" stroke="#fff" stroke-width="${2.5 / s}"`}/>`;
const dia = (x, y, r, solid = true) => `<path d="M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z" ${solid ? F : S(2.5)}/>`;
const gear = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" ${S(3.5)}/>${[0, 45, 90, 135].map((a) => `<path transform="rotate(${a} ${x} ${y})" d="M${x - r - 3.5} ${y}H${x + r + 3.5}" ${S(4, ' stroke-linecap="butt"')}/>`).join('')}<rect x="${x - 2}" y="${y - 2}" width="4" height="4" ${F}/>`;
const lock = (x, y) => `<rect x="${x}" y="${y + 4}" width="12" height="10" ${F}/><path d="M${x + 2.5} ${y + 4}V${y + 1.5}A3.5 3.5 0 0 1 ${x + 9.5} ${y + 1.5}V${y + 4}" ${S(2.5)}/>`;
const shield = (x, y, s, solid = true) => `<path transform="translate(${x} ${y}) scale(${s})" d="M10 0L20 3.5V11Q20 19 10 24Q0 19 0 11V3.5Z" ${solid ? F : `fill="none" stroke="#fff" stroke-width="${2.5 / s}"`}/>`;
const layers = (y) => `<path d="M4 ${y}L17 ${y - 6}L30 ${y}L17 ${y + 6}Z" ${F}/><path d="M4 ${y + 7}L17 ${y + 13}L30 ${y + 7}" ${S(2.5)}/><path d="M4 ${y + 14}L17 ${y + 20}L30 ${y + 14}" ${S(2.5)}/>`;
const SVG = {
  A2: `<path d="M3 35L13 9L23 35H17.5L13 23L8.5 35Z" ${F}/><path d="M20 35L30 9L40 35" ${S(2.5, ' stroke-dasharray="3.5 2.5"')}/><rect x="27.5" y="2" width="5" height="3" ${F}/>`,
  A3: `<path d="M8 6H32L28 12H4Z" ${S(2)}/><path d="M8 16H32L28 22H4Z" ${S(2)}/><path d="M8 26H32L28 32H4Z" ${F}/><path d="M33 36H41M37 32V40" ${S(2.5)}/>`,
  D3: `<rect x="4" y="9" width="16" height="20" ${S(2.5)}/><rect x="24" y="9" width="16" height="20" ${F}/><path d="M10 37H32" ${S(2.5)}/><path d="M30 33L37 37L30 41Z" ${F}/><path d="M34 4H12" ${S(2.5)}/><path d="M14 0.5L7 4L14 7.5Z" ${F}/>`,
  D4: `<circle cx="10" cy="11" r="4.5" ${S(3)}/><circle cx="23" cy="28" r="4.5" ${S(3)}/><path d="M25 6L8 33" ${S(3)}/><path d="M37 3V19" ${S(3)}/><path d="M31.5 15L37 22L42.5 15Z" ${F}/>`,
  E3: `<path d="M5 5H24M5 37H24" ${S(3)}/><path d="M7.5 5L14.5 21L7.5 37M21.5 5L14.5 21L21.5 37" ${S(2.5)}/><path d="M10.5 33L14.5 27L18.5 33Z" ${F}/><path d="M33 38V15" ${S(3)}/><path d="M27 18L33 9L39 18Z" ${F}/>`,
  F3: `<path d="M20 3L8 23H17L13 39L29 17H20L24 3Z" ${F}/>${lock(30, 25)}`,
  G1: `${coin(16, 18, 12)}<path d="M33 8H42" ${S(3.5)}/>`,
  G2: `${coin(15, 18, 11)}${clock(33, 31, 8)}`,
  G3: `<rect x="4" y="5" width="12" height="12" ${S(2.5)}/><rect x="20" y="5" width="12" height="12" ${S(2.5)}/><rect x="4" y="21" width="12" height="12" ${S(2.5)}/>${coin(26, 27, 6.5)}<path d="M36 8H43M39.5 4.5V11.5" ${S(2.5)}/>`,
  G4: `${coin(16, 19, 12)}<path d="M26 32H40M29.5 25.9L36.5 38.1M29.5 38.1L36.5 25.9" ${S(2.5)}/>`,
  H1: `<path d="M6 21A13 13 0 0 1 29 12" ${S(3)}/><path d="M24 8L33 10L28 17Z" ${F}/><path d="M32 21A13 13 0 0 1 9 30" ${S(3)}/><path d="M14 34L5 32L10 25Z" ${F}/><path d="M39 3V17" ${S(3)}/>`,
  H2: `<path d="M6 23L18 11L30 23" ${S(3.5)}/><path d="M6 35L18 23L30 35" ${S(3.5)}/>${coin(36, 10, 5.5)}`,
  H3: `<path d="M10 3L15 14M24 3L19 14" ${S(3)}/><circle cx="17" cy="24" r="9.5" ${S(3)}/><path d="M17 18.5L18.6 22.2L22.6 22.5L19.6 25.1L20.6 29L17 26.8L13.4 29L14.4 25.1L11.4 22.5L15.4 22.2Z" ${F}/>${clock(35, 33, 7)}`,
  H4: `<path d="M2 4H42L40 8H4Z" ${F}/><rect x="3" y="11" width="11" height="20" ${S(2.5)}/><path d="M5.5 14L11.5 28M11.5 14L5.5 28" ${S(2)}/><rect x="17" y="11" width="11" height="20" ${F}/><rect x="31" y="11" width="11" height="20" ${F}/><path d="M2 36H42" ${S(3)}/>`,
  H5: `<path d="M5 11H27" ${S(3)}/><path d="M25 5L34 11L25 17Z" ${F}/><path d="M39 25H16" ${S(3)}/><path d="M18 19L9 25L18 31Z" ${F}/><path d="M5 36H8M11 36H14M17 36H20" ${S(2.5)}/>`,
  I1: `${layers(12)}<path d="M37 3V18" ${S(3)}/><path d="M32 15L37 22L42 15Z" ${F}/>`,
  I2: `${dia(16, 20, 13)}${dia(36, 10.5, 5.5, false)}${dia(36, 30.5, 5.5, false)}`,
  I3: `${dia(22, 9, 7)}${dia(11, 21, 7, false)}${dia(33, 21, 7)}${dia(22, 33, 7, false)}<rect x="20.5" y="31.5" width="3" height="3" ${F}/>`,
  I4: `<path d="M3 5H31" ${S(3.5)}/><path d="M3 5V10M31 5V10" ${S(2.5)}/>${layers(17)}`,
  J1: `${gear(17, 19, 8)}<path d="M36 6H42M36 12H42M36 18H42" ${S(2.5)}/>`,
  J2: `${gear(15, 17, 8)}<path d="M4 31L27 4" ${S(2.5)}/>${clock(33, 32, 8)}`,
  J3: `<path d="M5 19L17 9L29 19" ${S(4)}/><path d="M5 30L17 20L29 30" ${S(4)}/><path d="M36 2L37.8 6.2L42 6.5L38.8 9.3L39.8 13.5L36 11.2L32.2 13.5L33.2 9.3L30 6.5L34.2 6.2Z" ${F}/>`,
  J4: `<rect x="3" y="11" width="14" height="14" ${S(2.5)}/>${dia(10, 18, 4)}<rect x="27" y="11" width="14" height="14" ${S(2.5)}/>${dia(34, 18, 4)}<path d="M19.5 15.5H24.5M19.5 20.5H24.5" ${S(2.5)}/><path d="M3 34H41" ${S(2.5)}/><rect x="8" y="31" width="3" height="6" ${F}/><rect x="33" y="31" width="3" height="6" ${F}/>`,
  J5: `<path d="M3 5H12L20 25L28 5H37L23 37H17Z" ${F}/><path d="M30 33H42" ${S(3)}/>`,
  J6: `<path d="M11 4H23" ${S(3)}/><path d="M13 4V13L5 31Q4 35 8 35H26Q30 35 29 31L21 13V4" ${S(2.5)}/><path d="M9 25H25L27.5 31Q28 33 26.5 33H7.5Q6 33 6.5 31Z" ${F}/><circle cx="17" cy="19" r="2" ${F}/>`,
  K3: [[4, 4], [18, 4], [32, 4], [4, 18], [18, 18], [32, 18], [4, 32], [18, 32], [32, 32]].map(([x, y], i) => (
    [1, 4, 5].includes(i) ? `<rect x="${x}" y="${y}" width="8" height="8" ${F}/>` : `<rect x="${x + 1}" y="${y + 1}" width="6" height="6" ${S(2)}/>`)).join(''),
  K4: `<rect x="3" y="3" width="12" height="12" ${F}/><rect x="29" y="3" width="12" height="12" ${S(2.5)}/><rect x="3" y="28" width="12" height="12" ${S(2.5)}/><rect x="29" y="28" width="12" height="12" ${F}/>${dia(22, 21.5, 8)}`,
  L2: `${crown(3, 8, 1.45)}${crown(23, 8, 1.45)}<path d="M3 27H20M24 27H41" ${S(3)}/><rect x="9" y="32" width="5" height="5" ${F}/><rect x="30" y="32" width="5" height="5" ${F}/>`,
  L3: `${crown(2, 4, 1.6)}<path d="M2 23.5H21" ${S(3)}/><path d="M12 27V35H22" ${S(2.5)}/><path d="M21 31L27 35L21 39Z" ${F}/>${crown(29, 26, 1.1)}`,
  L4: `<rect x="2" y="4" width="15" height="15" ${S(2.5)}/><rect x="7" y="9" width="5" height="5" ${F}/><rect x="27" y="24" width="15" height="15" ${S(2.5)}/><rect x="32" y="29" width="5" height="5" ${F}/>
    <rect x="13" y="17" width="12" height="7" rx="3.5" transform="rotate(40 19 20.5)" ${S(2.5)}/><rect x="20" y="22" width="12" height="7" rx="3.5" transform="rotate(40 26 25.5)" ${S(2.5)}/>`,
  L5: `<path d="M6 8L33 33" ${S(3)}/><path d="M38 26V38H26Z" ${F}/><path d="M6 35L33 10" ${S(3)}/><path d="M26 5H38V17Z" ${F}/><rect x="1" y="3" width="6" height="6" ${F}/><rect x="1" y="34" width="6" height="6" ${F}/>`,
  M1: `<rect x="4" y="10" width="16" height="22" ${S(2.5)}/><rect x="10" y="5" width="16" height="22" ${F}/>${lock(29, 25)}`,
  M2: `<path d="M4 33L22 25L40 33L22 41Z" ${S(2.5)}/><path d="M22 33L14 19A9 9 0 1 1 30 19Z" ${F}/>`,
  M3: `${shield(5, 6, 1.35, false)}<path d="M15.5 15L19 12.5V31" ${S(3)}/><path d="M38 6V38" ${S(2.5)}/>`,
  M4: `${shield(14.5, 12, 0.75)}<path d="M5 22A17 17 0 0 1 30 6" ${S(2.5)}/><path d="M27 1.5L35 6L28 11Z" ${F}/><path d="M39 22A17 17 0 0 1 14 38" ${S(2.5)}/><path d="M17 42.5L9 38L16 33Z" ${F}/>`,
  M5: `${shield(2, 5, 1, false)}${shield(22, 13, 1)}<path d="M20 2V12M16 6H24" ${S(2.5)}/>`,
  N2: `<path d="M14 6L28 21L14 36" ${S(4)}/><path d="M26 6L40 21L26 36" ${S(4)}/><path d="M2 14H8M2 21H10M2 28H8" ${S(2.5)}/>`,
  O1: `${heart(6, 1, 1.6)}<path d="M3 39H41" ${S(3)}/><rect x="5" y="33" width="5" height="5" ${F}/><rect x="15" y="33" width="5" height="5" ${F}/><rect x="25" y="33" width="5" height="5" ${F}/><rect x="35" y="33" width="5" height="5" ${F}/>`,
  O2: `${heart(2, 5, 1.2)}${heart(17, 12, 1.2, false)}<path d="M6 40H38" ${S(2)}/>`,
  O3: `${heart(2, 1, 0.85)}${heart(23, 1, 0.85)}${heart(2, 22, 0.85)}${heart(23, 22, 0.85, false)}<path d="M33 25L31 30L34 32L32 37" ${S(2)}/>`,
  // ---- 涓嬪崐 (the enemy routes show their target's portrait: FACE) ----
  F4: `<path d="M17 3L5 23H14L10 39L26 17H17L21 3Z" ${F}/><path d="M36 5V14" ${S(3)}/><path d="M31 8L36 1L41 8Z" ${F}/><path d="M36 27V36" ${S(3)}/><path d="M31 33L36 40L41 33Z" ${F}/>`,
  R4: `<circle cx="20" cy="21" r="12" ${S(3)}/><circle cx="20" cy="21" r="4" ${F}/><path d="M20 2V9M20 33V40M1 21H8M32 21H39" ${S(3)}/>`,
  S3: `${shield(2, 3, 0.85, false)}${shield(22, 3, 0.85)}<path d="M5 33H24" ${S(3)}/><path d="M23 28L30 33L23 38Z" ${F}/>`,
  S4: `${crown(2, 5, 1.35)}${crown(24, 5, 1.35)}<path d="M9 27H35M9 35H35" ${S(3)}/>`,
  S5: `${crown(1, 3, 1.25)}<path d="M8 21V30H21" ${S(2.5)}/><path d="M20 25L27 30L20 35Z" ${F}/>${crown(26, 3, 1.25)}`,
  S6: `${crown(1, 3, 1.25)}${crown(25, 3, 1.25)}${shield(14, 18, 0.72)}`,
  T1: `<path d="M3 10H29" ${S(3)}/><path d="M27 4L35 10L27 16Z" ${F}/><path d="M39 25H13" ${S(3)}/><path d="M15 19L7 25L15 31Z" ${F}/>`,
  T2: `<path d="M7 25A6.5 6.5 0 0 1 11 13A9 9 0 0 1 28 11A7 7 0 0 1 33 25Z" ${S(3)}/><path d="M5 33H11M16 33H22M27 33H31" ${S(2.5)}/>`,
  T3: `<path d="M3 12Q8 6 13 12T23 12" ${S(3)}/><path d="M3 22Q8 16 13 22T23 22" ${S(3)}/><path d="M33 3V19" ${S(3)}/><path d="M28 16L33 23L38 16Z" ${F}/>`,
  T4: `<path d="M3 5L15 17" ${S(3)}/><path d="M3 33L15 21" ${S(3)}/><path d="M16 19H28" ${S(3)}/><path d="M26 14L33 19L26 24Z" ${F}/>`,
  T5: `<path d="M18 4V36M4 12L32 28M4 28L32 12" ${S(2.5)}/><path d="M3 3L31 33" ${S(3)}/>`,
  U1: `<rect x="2" y="20" width="8" height="8" ${S(2)}/><rect x="13" y="20" width="8" height="8" ${F}/><rect x="24" y="20" width="8" height="8" ${S(2)}/><rect x="35" y="20" width="8" height="8" ${S(2)}/><path d="M17 2V11" ${S(3)}/><path d="M12 9L17 16L22 9Z" ${F}/><path d="M2 36H42" ${S(2.5)}/>`,
  U2: `<rect x="3" y="7" width="16" height="16" ${F}/><rect x="25" y="7" width="16" height="16" ${S(2.5)}/><path d="M11 29A11 8 0 0 0 33 29" ${S(2.5)}/><path d="M30 25L37 30L29 34Z" ${F}/>`,
  U3: `${shield(2, 6, 1.1, false)}${clock(32, 29, 9)}`,
  U4: `${shield(3, 9, 1.05)}<path d="M28 9A15 15 0 0 1 28 33" ${S(2.5)}/><path d="M34 5A21 21 0 0 1 34 37" ${S(2.5)}/>`,
};
// the enemy routes: the target's portrait (data/assets.json enemies[key].icon 鈥?/assets/enemy/icon/<key>.png)
const FACE = { P1: 'enemy_1067_snslime', P2: 'enemy_1081_sotisd', P3: 'enemy_1430_lrrook', Q1: 'enemy_1042_frostd', Q2: 'enemy_9007_acelem',
  Q3: 'enemy_10124_uashld_2', Q4: 'enemy_1169_duphlx', Q5: 'enemy_1288_duskls', Q6: 'enemy_9006_actoxi', Q7: 'enemy_1161_tidmag',
  Q8: 'enemy_1174_duholy_2', Q9: 'enemy_1072_dlancer', R1: 'enemy_9010_acpupp', R2: 'enemy_1118_lidbox_2', R3: 'enemy_1045_hammer',
  R5: 'enemy_1329_cbshld', S1: 'enemy_9017_achunt', S2: 'enemy_9033_acdeer' };
const faceUrl = (key) => enemyIconUrl(data.get?.('assets'), key) || `/assets/enemy/icon/${key}.png`;

// ---- 弧光作战 (season arc1): the game's own crisis_v2 rune icons, one per tier ----
// Ported from the official js/ui/crisisArcTags.js FX table: route id -> CC_ART + 'rune/<name>.png'.
// 重燃 uses the hand-drawn SVGs above; 弧光 uses these rune PNGs — a different season, a different icon set.
const ARC_ICON = {
  XA1: ['enemy_atk_1', 'enemy_atk_2', 'enemy_atk_3'],
  XA2: ['enemy_hp_1', 'enemy_hp_2', 'enemy_hp_3'],
  XA3: ['enemy_physical_reduction_1', 'enemy_physical_reduction_2'],
  XA4: ['enemy_magical_reduction_1', 'enemy_magical_reduction_2'],
  XA5: 'enemy_def_1',
  XA6: ['enemy_weight_1', 'enemy_weight_2'],
  XB1: 'gx_char_attackspeed_1',
  XB2: ['char_lowland_attribute_mul_1', 'char_lowland_attribute_mul_2'],
  XB3: ['char_highland_attribute_mul_1', 'char_highland_attribute_mul_2'],
  XC1: ['global_costrecovery_2', 'global_costrecovery_3'],
  XC2: ['extra_cost_1', 'extra_cost_2'],
  XC3: 'char_respawntime_1',
  XC4: ['global_pcharnum_1', 'global_pcharnum_2'],
  XC5: 'global_lifepoint_1',
  XD1: ['global_squadnum_1', 'global_squadnum_2'],
  XD2: 'global_nocostrecovery_1',
  XD3: 'magiccircuit_env_1',
  XD4: 'global_skillrecovery_3',
  XD5: 'global_psquad_1',
  XE1: 'gx_ristar_3',
  XE2: 'gx_ristar_2',
  XE3: 'gx_ristar_1',
  XE4: 'magiccircle_slow',
  XE5: 'gx_char_attackspeed_2',
  XF1: 'melee_forbid_1',
  XF2: 'range_forbid_2',
  XG1: 'char_cost_casterspecial_1',
  XG2: 'char_cost_sniperguard_1',
  XG3: 'char_cost_healerdefender_1',
  XG4: 'char_deploy_losthp',
  XG5: 'char_deploy_stun',
  XG6: 'char_deploy_attribute_add_1',
  XG7: 'char_deploy_bleed_1',
  XH1: 'gx_cbjedi_2',
  XH2: 'gx_cbjedi_1',
  XH3: 'gx_cbjedi_3',
  XH4: 'gx_cbjedi_4',
  XI1: 'gx_cbshld_1',
  XI2: 'gx_cbshld_2',
  XI3: 'gx_cbshld_3',
  XI4: 'gx_cbshld_4',
  XJ1: 'gx_cbterm_1',
  XJ2: 'gx_cbterm_2',
  XJ3: 'gx_cbterm_3',
  XJ4: 'gx_cbterm_4',
  XJ5: 'gx_cbterm_5',
  XJ6: 'gx_cbterm_7',
  XJ7: 'frog_coin_1',
  XK1: 'gx_cbsisy_1',
  XK2: 'gx_cbsisy_6',
  XK3: 'gx_cbsisy_2',
  XK4: 'gx_cbsisy_3',
  XK5: 'gx_cbsisy_5',
  XK6: 'gx_cbsisy_4',
  XK7: 'gx_cbsisy_7',
  XL1: 'gx_lyengs_1',
  XL2: 'gx_lyengs_2',
  XL3: 'lyengs_skill1',
  XM1: 'crgst_invisible',
  XM2: 'gx_cbrush_1',
  XM3: 'gx_cbrush_2',
  XN1: 'gx_cbterm_6',
  XN2: 'enemy_movespeed_1',
  XO1: ['lydrty_atk1', 'lydrty_atk2'],
  XO2: ['lydrty_def1', 'lydrty_def2'],
  XO3: 'lydrty_skill1',
  XO4: 'lysyta_hp1',
  XO5: 'global_lysytc_1',
  XO6: ['lyacpa_atk1', 'lyacpa_atk2'],
};
/** 弧光's rune dir (official CC_ART + 'rune/'). */
export const CC_ARC_RUNE = '/assets/local/cc4-arclight/rune/';


/** A tag's tile symbol: its own art when the table names one, otherwise the drawn SVG; enemy routes show a portrait. */
export function CrisisGlyph({ tag, class: cls = '' }) {
  if (!tag || !tag.route) return null;
  const id = tag.route.id;
  // 弧光作战 first: its icons are the game's own crisis_v2 rune PNGs, one per tier (official crisisArcTags.js Glyph).
  const rune = ARC_ICON[id];
  if (rune) {
    const name = Array.isArray(rune) ? rune[Math.min(tag.tier || 1, rune.length) - 1] : rune;
    return html`<span class=${'cs-glyph is-rune ' + cls}>
      <img src=${CC_ARC_RUNE + name + '.png'} alt="" draggable=${false} />
      ${tag.tier ? html`<img class="cs-glyph__num" src=${CC_TAG_UI + 'tag-num' + tag.tier + '.png'} alt="" draggable=${false} />` : null}
    </span>`;
  }
  const face = FACE[id];
  const img = IMG[id];
  return html`<span class=${'cs-glyph ' + cls}>
    ${face ? html`<img class="cs-glyph__face" src=${faceUrl(face)} alt="" draggable=${false} />`
      : img ? html`<img src=${CC_TAG_UI + 'tag-' + img + '.png'} alt="" draggable=${false} />`
      : html`<svg class="cs-glyph__svg" viewBox="0 0 44 43" width="44" height="43" aria-hidden="true"
          dangerouslySetInnerHTML=${{ __html: SVG[id] || '' }}></svg>`}
    ${tag.tier ? html`<img class="cs-glyph__num" src=${CC_TAG_UI + 'tag-num' + tag.tier + '.png'} alt="" draggable=${false} />` : null}
  </span>`;
}
