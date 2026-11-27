import {canonicalRegulationStrategyId} from './regulationStrategyAliases20261110.js';
// Exact current actor/native-proof whitelist. This is not an effect-ID alias registry.
export const REGULATION_STRATEGY_REPLACEMENTS=Object.freeze({
 band_kazimier:{nativeBandId:'band_kazimier',nativeEffectId:'aceffect_band_62',name:'焰尾',iconId:'icon_flamtl',operatorId:'char_420_flamtl',bondId:'kazimierzShip'},
 band_narant:{nativeBandId:'band_sargon',nativeEffectId:'aceffect_band_69',name:'娜仁图亚',iconId:'icon_narant',operatorId:'char_4138_narant',bondId:'sargonShip'},
 band_regulation_victoria:{nativeBandId:'band_victoria',nativeEffectId:'aceffect_band_66',name:'洛洛',iconId:'icon_rockr',operatorId:'char_4040_rockr',bondId:'victoriaShip'},
 band_regulation_kjerag2:{nativeBandId:'band_kjerag2',nativeEffectId:'aceffect_band_104',name:'耶拉',iconId:'icon_kjera',operatorId:'char_4013_kjera',bondId:'kjeragShip'},
 band_regulation_siracusa:{nativeBandId:'band_siracusa',nativeEffectId:'aceffect_band_65',name:'裁度',iconId:'icon_talr',operatorId:'char_4155_talr',bondId:'siracusaShip'},
});
export function regulationStrategyReplacementId(id){const canonical=canonicalRegulationStrategyId(id);return canonical==='band_regulation_sargon'?'band_narant':canonical;}
export function regulationStrategyReplacementScope(id,record){
 const canonical=regulationStrategyReplacementId(id),s=REGULATION_STRATEGY_REPLACEMENTS[canonical];
 if(!s||record?.regulationCatalog20261110!==true||record?.regulationStrategyReplacement20261110!==true||(record.bandId!==canonical&&record.bandId!==id)||record.name!==s.name||record.iconId!==s.iconId)return null;
 const native=record.regulationSource;
 return native?.nativeBandId===s.nativeBandId&&native.nativeEffectId===s.nativeEffectId&&Array.isArray(native.nativeCharacterIds)&&native.nativeCharacterIds.includes(s.operatorId)?{...s,canonicalBandId:canonical}:null;
}
