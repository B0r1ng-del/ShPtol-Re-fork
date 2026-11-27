import { COLUMBIA, COLUMBIA_DESCRIPTION } from '../../../shared/workbookAlliance20261114.js';

// These are the proposed members, including operators not yet in the ordinary shop.
const roster = [
  ['chess_char_1_05_a', 'char_290_vigna', '红豆', 1],
  ['chess_regulation_2_19_a', 'char_274_astesi', '星极', 2],
  ['chess_regulation_2_11_a', 'char_4165_ctrail', '云迹', 2],
  ['chess_char_2_19_a', 'char_4151_tinman', '锡人', 2],
  ['chess_regulation_3_19_a', 'char_484_robrta', '罗比菈塔', 3],
  ['chess_char_4_21_a', 'char_128_plosis', '白面鸮', 3],
  ['chess_regulation_4_18_a', 'char_4027_heyak', '霍尔海雅', 4],
  ['chess_char_6_16_a', 'char_1047_halo2', '溯光星源', 5],
  ['chess_char_5_11_a', 'char_202_demkni', '塞雷娅', 5],
  ['chess_workbook_aphris_a', 'char_4229_aphris', '谬因', 6],
];

export const columbiaSweepIcon = '/assets/ui/campLogo/logo_columbia.png';
export const columbiaSweepPreview = Object.freeze({
  bondId: COLUMBIA, name: '哥伦比亚', isCore: true, identifier: 42006,
  activeCount: 3, thresholds: Object.freeze([3, 6]), desc: COLUMBIA_DESCRIPTION,
});

export function columbiaSweepMembers(chessData) {
  return roster.map(([chessId, charId, name, tier]) => {
    const existing = chessData?.[chessId];
    return { ...(existing?.charId === charId ? existing : {}), chessId, charId, name, tier };
  }).sort((a, b) => b.tier - a.tier);
}
