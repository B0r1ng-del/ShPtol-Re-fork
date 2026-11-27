// Explicit actor-proven preview alias only; never infer identity fromeffectId.
export const REGULATION_STRATEGY_PREVIEW_ALIASES=Object.freeze({"band_regulation_sargon":"band_narant","band_regulation_substitute":"band_vodfox","band_regulation_copy":"band_dusk","band_regulation_upgrade":"band_mlyss","band_regulation_weakness":"band_chen","band_regulation_takecare":"band_bldsk","band_regulation_kjerag":"band_sciurus","band_regulation_bond":"band_chiave"});
export function canonicalRegulationStrategyId(id){return Object.hasOwn(REGULATION_STRATEGY_PREVIEW_ALIASES,id)?REGULATION_STRATEGY_PREVIEW_ALIASES[id]:id;}
/** Caller supplies a known strategyID string orJSONpreference with its bandId.
 * No recursion/fieldpruning: skillIndex0, explicitnone, DIY and otherprefs survive.
 */
export function migrateRegulationStrategyPreference(value){
 const old=typeof value==='string'?value:value&&typeof value==='object'&&!Array.isArray(value)?value.bandId:undefined,canonical=canonicalRegulationStrategyId(old);
 if(old===canonical)return{value,changed:false,migration:null};
 return{value:typeof value==='string'?canonical:{...value,bandId:canonical},changed:true,migration:{from:old,to:canonical,reason:'actor-verified-preview-strategy-alias'}};
}
