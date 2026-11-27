// The original battle-shop bundle's asset manifest: keys the shop's CSS/components ask for, pointing at the pack's
// own copies under resources/ (garrisonTypeIcon, hudPanel, native-autochess). Mirrors the online build's manifest so
// the ported stylesheet and the native layout JSON resolve the same files the official UI did.
const BASE = '/css/battle-shop-ui/20261030-r1/resources/assets/ui/';

const KEYS = {
  garrisonTypeIcon: ['icon_battle', 'icon_bond', 'icon_gold', 'icon_support', 's_icon_battle', 's_icon_bond', 's_icon_gold', 's_icon_support'],
  hudPanel: [
    'battle_repeatline', 'bg_battle', 'bg_board', 'bg_boss', 'bg_check_btn', 'bg_circle_left', 'bg_coop', 'bg_lose_hp',
    'bg_miss_enemy', 'bg_rest', 'bg_right', 'bg_round', 'boss_bg', 'boss_frame', 'btn_check_enemy',
    'btn_check_enemy_unfold', 'btn_check_player_back', 'btn_check_player_normal', 'btn_check_player_unfold',
    'btn_close', 'btn_open', 'btn_open_arrow', 'frame_deco_box', 'frame_deco_txt1', 'frame_deco_txt2', 'frame_deco_txt3',
    'frame_left', 'frame_mid_boss', 'frame_mid_normal', 'hp_bar', 'icon_battle', 'icon_boss', 'icon_boss_num',
    'icon_coop', 'icon_hp', 'icon_rest', 'icon_sword_red', 'icon_sword_yellow', 'icon_trans_boss', 'icon_warn', 'mask',
    'matte', 'matte_pause', 'text_matte', 'trans_batte1', 'trans_batte2', 'trans_coop1', 'trans_coop2', 'trans_coop3',
    'trans_coop4', 'trans_cup', 'trans_glow', 'trans_worm1', 'trans_worm2', 'white_sprite',
  ],
};

const MANIFEST = Object.create(null);
for (const [group, names] of Object.entries(KEYS)) {
  for (const name of names) MANIFEST[`${group}/${name}`] = `${BASE}${group}/${name}.png`;
}

export const UI_ASSETS = Object.freeze(MANIFEST);
