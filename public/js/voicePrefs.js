// Browser-local dub preferences. Every variant of an operator shares its charId; absent entries follow the global dub.
// Global settings.voiceLang is one of VOICE_LANGS. A per-operator override may also be 'native' (the operator's
// own-language dub, audio.voiceNative). audio.js re-exports VOICE_TREES and plays the tree voiceLangFor picks.

export const VOICE_LANGS = Object.freeze(['cn', 'jp', 'en', 'kr']);
/** Values a per-operator override may store. 'native' is not a global voiceLang. */
export const VOICE_PICKS = Object.freeze([...VOICE_LANGS, 'native']);
/** Manifest tree of each non-Chinese dub. Chinese is audio.voice. */
export const VOICE_TREES = Object.freeze({ jp: 'voiceJp', en: 'voiceEn', kr: 'voiceKr', native: 'voiceNative' });

const TREE = Object.freeze({ cn: 'voice', ...VOICE_TREES });

/**
 * 一个**干员 id 能不能当配音覆盖表的键**——这句话只有一处真相：设置库（本文件）、C 层面板注入面
 * （`ui/extensions.js` 的 `VOICE_CHAR_ID_RE`）与落盘清洗都读这一条。`char_` + 1..64 位 A-Za-z0-9_。
 */
export const VOICE_CHAR_ID_RE = /^char_[A-Za-z0-9_]{1,64}$/;
/** 覆盖表最多记多少条（键是干员 id）：**只有引擎知道**的这一条上限，写到第 N+1 条要**具名拒绝**，不静默吞掉。 */
export const VOICE_OVERRIDE_MAX = 400;

export function sanitizeVoiceOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, lang] of Object.entries(raw).slice(0, VOICE_OVERRIDE_MAX)) {
    if (VOICE_CHAR_ID_RE.test(id) && VOICE_PICKS.includes(lang)) out[id] = lang;
  }
  return out;
}

/** This server's manifest lists at least one line of `charId` in `lang`. */
function hasTree(audio, charId, lang) {
  const slots = audio?.[TREE[lang]]?.[charId];
  return !!slots && typeof slots === 'object' && !Array.isArray(slots) && Object.keys(slots).length > 0;
}

/**
 * The dub `charId` speaks.
 * Without `opts.audio` (tests and callers from before the extra dubs) the 0.2.3 rule stands: an own 'cn' or 'jp'
 * wins, otherwise the global language is 'jp' or 'cn'. 'en' / 'kr' / 'native' are not applied on that path.
 * With `audio` (including an empty object): the operator's own choice when this server has that tree, else the
 * own-language dub when `opts.native` is on and the operator has one, else the global language when that tree is
 * present (中文 always), else 'cn'.
 * @param {string} charId
 * @param {string} globalLang
 * @param {Record<string, string>|null|undefined} overrides
 * @param {{ native?: boolean, audio?: any }|null} [opts]
 * @returns {'cn'|'jp'|'en'|'kr'|'native'}
 */
export function voiceLangFor(charId, globalLang, overrides, opts) {
  const own = Object.hasOwn(overrides || {}, charId) ? overrides[charId] : null;
  const audio = opts?.audio;
  if (audio == null) return (own === 'cn' || own === 'jp') ? own : globalLang === 'jp' ? 'jp' : 'cn';
  if (VOICE_PICKS.includes(own) && hasTree(audio, charId, own)) return own;
  if (opts.native === true && hasTree(audio, charId, 'native')) return 'native';
  const global = VOICE_LANGS.includes(globalLang) ? globalLang : 'cn';
  if (global === 'cn' || hasTree(audio, charId, global)) return global;
  return 'cn';
}
