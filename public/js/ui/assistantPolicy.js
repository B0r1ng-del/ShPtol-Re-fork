// Skin assistants explicitly removed by the owner on 2026-10-25. Base operators stay available.
export const REMOVED_ASSISTANTS=Object.freeze([
  "char_1012_skadi2@iteration#2",
  "char_1016_agoat2@epoque#34",
  "char_1016_agoat2@epoque#57",
  "char_1032_excu2@sale#12",
  "char_1035_wisdel@sale#14",
  "char_1038_whitw2@sale#15",
  "char_1041_angel2@iteration#6",
  "char_113_cqbw@epoque#7",
  "char_2023_ling@nian#12",
  "char_2024_chyue@cfa#1",
  "char_245_cello@sale#12",
  "char_249_mlyss@boc#8",
  "char_4064_mlynar@epoque#28",
  "char_4134_cetsyr@epoque#50",
  "char_472_pasngr@epoque#17"
]);
const removed=new Set(REMOVED_ASSISTANTS);
export const assistantAllowed=actor=>!removed.has(actor.id);
export const normalizeAssistant=id=>removed.has(id)?id.split('@')[0]:id;
