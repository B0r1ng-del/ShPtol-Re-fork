/** Resolve the exact home line, respecting the same operator/global dub choices as combat. */
export function resolveAssistantSpeech(actor, line, settings = {}, personal = {}) {
  const files = line?.audioByLang || (line?.audio ? { cn: line.audio } : {});
  const own = personal?.[actor?.id] || personal?.[actor?.baseId] || settings.voiceOverrides?.[actor?.id] || settings.voiceOverrides?.[actor?.baseId];
  const preferred = own === 'alt' ? 'native' : own;
  for (const lang of [preferred, settings.voiceNative ? 'native' : null, settings.voiceLang || 'jp', 'cn', 'jp']) {
    if (lang && files[lang]) return files[lang];
  }
  return null;
}

/** Official text markup is stripped before inserting the nickname as plain text. */
export function formatAssistantText(text, nickname = '') {
  return String(text || '').replace(/<[^>]*>/g, '').replace(/\{@nickname\}/gi, () => String(nickname || ''));
}
