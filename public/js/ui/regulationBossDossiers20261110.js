// i18n-ignore-file: Original-language enemy handbook records, like the generated enemy catalogue.
// Current PC boss info SHA-256 5c7ba639bc4b89d614be7220ab513a1786f75b4e646b2c76f18afd338c0406d3.
// Current handbook projection SHA-256 ffcdba61a29c02a3a16315681be7de8011325c8613136f98a7ec947d57626558.
// Only handbook text is projected here. Runtime stats, rewards and encounter scheduling use separate data.
export const regulationBossDossiers20261110 = [
  {
    enemyKey: 'enemy_9029_acfnc', coreEnemyKey: 'enemy_9029_acfnc_2', handbookIndex: 'SP28', name: '假想敌：械',
    description: '由源石构建出的巨型自行机甲，是根据源石灾难在全泰拉爆发的想象而设计的假想敌之一。源石在大地上蔓延，一切过去的荣光与牺牲，在此刻化作无上的暴力与痛苦，在人们的眼前轰鸣不止。',
    leaderAbilities: [
      '攻击命中时，在目标位置或周围可通行地块召唤<量变之械>',
      '生命值低于50%时，召唤<冲击之械>；受到来自<冲击之械>方向的伤害降低',
      '【洪流攻势】选择场上阻挡数最高的我方单位，在其周围召唤<量变之械>',
    ],
    coreAbilities: [
      '在模拟中达成特定条件并进入隐秘核心回合时，<假想敌：械>将获得强化，攻击会在多个目标间跳跃，每次跳跃伤害降低；登场时召唤<冲击之械>',
      '【威光冲击】使<冲击之械>向两侧飞出并在经过数个我方单位或到达最远处时砸下，造成大量物理伤害；两个<冲击之械>之间的我方单位攻击速度大幅降低；<冲击之械>受到伤害时缓慢反向移动，若撞击<假想敌：械>，则销毁场上所有<冲击之械>',
      '【衰颓与复兴】销毁并重新召唤<冲击之械>',
    ],
  },
  {
    enemyKey: 'enemy_9035_acspider', coreEnemyKey: 'enemy_9035_acspider_2', handbookIndex: 'SP29', name: '假想敌：茧',
    description: '受源石侵蚀而巨化的荒漠昆虫，是根据源石灾难在全泰拉爆发的想象而设计的假想敌之一。源石在大地上蔓延，生存机理所设定的成长路径被它强行扭曲，从而制造出恐惧与贪欲的代表物。',
    leaderAbilities: [
      '对每个场地上当前生命值最高的3个我方单位造成远程物理伤害',
      '每损失一定生命值时，进入伪装状态并获得物理和法术闪避',
      '【淤困捕食】在若干我方单位所在地块召唤<淤困之茧>，捆绑目标（使其无法攻击、阻挡和开启技能）',
    ],
    coreAbilities: [
      '在模拟中达成特定条件并进入隐秘核心回合时，<假想敌：茧>将获得强化，普通攻击附加中毒并额外选择每个场地一名我方单位，【淤困捕食】目标数增加',
      '【悲惨之雨】释放酸雨覆盖一片场地，使场地上所有我方单位攻击速度下降并持续受到真实伤害',
    ],
  },
  {
    enemyKey: 'enemy_9037_aceel', coreEnemyKey: 'enemy_9037_aceel_2', handbookIndex: 'SP31', name: '假想敌：鳍',
    description: '受源石侵蚀而产生突变进化的恐鱼，是根据源石灾难在全泰拉爆发的想象而设计的假想敌之一。源石的污染渗透进生物的本质，将合理从进化的过程中剥离，诞生出虚妄的生命。',
    leaderAbilities: [
      '攻击附带<$ba.dt.neural>神经损伤</>',
      '未被阻挡时获得特殊护盾，使自身受到的物理与法术伤害降低；被阻挡时消耗特殊护盾，并使下次攻击造成的伤害提升',
      '【离子环波】对范围内所有我方单位造成法术伤害并附带<$ba.dt.neural>神经损伤</>',
    ],
    coreAbilities: [
      '在模拟中达成特定条件并进入隐秘核心回合时，<假想敌：鳍>将获得强化，攻击会在多个我方单位间跳跃，每次跳跃伤害降低',
      '连续攻击同一目标时提升该次攻击造成的伤害，并增加跳跃次数',
      '在场时变为雷暴天气，周期性雷击站位密集的我方单位',
    ],
  },
  {
    enemyKey: 'enemy_2124_dyjsfg', handbookIndex: 'JU', name: '矩兽',
    description: '溯合制序，止攻泯灾，刚而难曲，以矩名之。',
    leaderAbilities: [
      '【明力】<$ba.stun>晕眩</>、<$ba.cold>寒冷</>、<$ba.frozen>冻结</>等<$ba.debuff>异常状态</>的持续时间大幅降低，受到的物理与法术伤害大幅降低，被阻挡或停止移动时伤害降低效果减少',
      '【尚同】持续对周围造成物理伤害，每次被阻挡时对周围额外造成一次高额物理伤害',
      '【非命】生命值首次低于50%时，自身占用阻挡数、攻击力与移动速度提升',
      '【兼爱】自身被击倒或退场时，使场上除<后兽>以外的所有敌人退场，对场上所有友方单位造成一次无视<$ba.invisible>隐匿</>的高额物理伤害',
    ],
  },
];
