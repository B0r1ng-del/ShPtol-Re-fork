// 大厅音乐 (from the old UI PR #643's keep list): the player's own track, kept on this device (IndexedDB — never
// uploaded), played while the lobby / room / pre-battle screens are up and faded out when the battle's own BGM starts.
//
// Why it is a module and not a component: the track has to survive route changes and re-renders, so the <audio>
// element, its WebAudio gain and the stored blob live at module scope; the button and its dialog are the only UI.
// `audio.lobbyMusicOverride` is how audio.js asks 「is a custom track playing instead of the lobby BGM?」.
//
// Nothing here touches the protocol: the track is a local preference, like the backdrop.
import { PHASE } from '../../../shared/constants.js';
import { html, Button, Modal } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { store, selectRoute } from '../store.js';
import { audio, bgmKeyFor } from '../audio.js';
import { t, N_ } from '../../../shared/i18n.js';

export const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
const listeners = new Set();
let record = null, url = null, media = null, source = null, revision = 0, installed = false, dbPromise;
// `status` is a translated string, recomputed by `statusText()` so a language switch shows the new language.
let statusKey = N_('默认大厅音乐'), busy = false, lastRoute;
const statusText = () => t(statusKey);
const notify = () => listeners.forEach(fn => fn(music.snapshot()));
let videoAudible = false;
const inMusicArea = () => { const s = store.get(), route = selectRoute(s); return ['lobby', 'room'].includes(route) || (route === 'game' && [PHASE.INFO_CHECK, PHASE.BAND_DRAFT, PHASE.BATTLE_CHECK].includes(s.match?.public?.phase)); };
let customGain = null, fadeTarget = 0, fadeTimer, handoff = false, handoffTimer;
const areaKey = () => selectRoute(store.get()) + ':' + inMusicArea();
function db() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('sp-lobby-music', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('tracks');
    req.onsuccess = () => { const result = req.result; result.onversionchange = () => result.close(); resolve(result); };
    req.onerror = () => { dbPromise = null; reject(Error(t('浏览器无法保存音乐，请检查可用空间'))); };
  });
}
async function saved(write, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('tracks', write ? 'readwrite' : 'readonly'), table = tx.objectStore('tracks');
    const req = write ? value ? table.put(value, 'lobby') : table.delete('lobby') : table.get('lobby');
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(Error(t('音乐保存失败，可能是浏览器存储空间不足')));
  });
}
async function validate(file) {
  if (!file || file.size <= 0) throw Error(t('请选择有效的音频文件'));
  if (file.size > MAX_MUSIC_BYTES) throw Error(t('音乐不能超过 20MB，请选择较小的文件'));
  if (!/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name || '') || (file.type && !file.type.startsWith('audio/') && file.type !== 'video/webm' && file.type !== 'application/ogg')) throw Error(t('请选择 MP3、M4A、OGG、WAV 等音频文件'));
  const objectUrl = URL.createObjectURL(file), probe = new Audio(); probe.preload = 'metadata';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(t('音频读取超时，请尝试其他文件'))), 10000);
      probe.onloadedmetadata = () => { clearTimeout(timer); Number.isFinite(probe.duration) && probe.duration > 0 ? resolve() : reject(Error(t('音频文件无效'))); };
      probe.onerror = () => { clearTimeout(timer); reject(Error(t('浏览器无法播放该音频，请尝试 MP3 或 M4A'))); };
      probe.src = objectUrl;
    });
  } finally { probe.onloadedmetadata = probe.onerror = null; probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(objectUrl); }
}
function replace(next) {
  if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  if (url) URL.revokeObjectURL(url);
  record = next; url = next?.blob ? URL.createObjectURL(next.blob) : null;
  if (media && url) media.src = url;
}
function fadeCustom(on, immediate = false) {
  const target = on ? 1 : 0;
  if (target === fadeTarget && !immediate) return;
  clearTimeout(fadeTimer); fadeTarget = target;
  if (!customGain || !audio.ctx || immediate) { if (!on) media?.pause(); if (customGain) customGain.gain.value = target; return; }
  const at = audio.ctx.currentTime, g = customGain.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at);
  else { g.cancelScheduledValues(at); g.setValueAtTime(g.value, at); }
  g.linearRampToValueAtTime(target, at + 0.9);
  if (!on) fadeTimer = setTimeout(() => { if (fadeTarget === 0) { media.pause(); notify(); } }, 1000);
}
function clearHandoff() { clearTimeout(handoffTimer); handoff = false; }
function sync() {
  if (!media || !record) return;
  if ((videoAudible && selectRoute(store.get()) === 'lobby') || !record.enabled || record.paused || document.hidden || audio.bgmSilent) { clearHandoff(); fadeCustom(false, true); return; }
  if (!inMusicArea()) {
    // Keep the old music while the next game's BGM buffer is loading.
    if (selectRoute(store.get()) === 'game' && !media.paused && fadeTarget > 0) {
      if (!handoff) { handoff = true; handoffTimer = setTimeout(() => { clearHandoff(); fadeCustom(false); }, 10000); }
    } else fadeCustom(false);
    return;
  }
  clearHandoff();
  if (!audio.ctx) return;
  if (!source) { source = audio.ctx.createMediaElementSource(media); customGain = audio.ctx.createGain(); customGain.gain.value = 0; source.connect(customGain); customGain.connect(audio.bgmGain); }
  fadeCustom(true);
  if (!media.paused) return;
  media.play().then(() => { statusKey = N_('正在播放 · 单曲循环'); notify(); }, () => { statusKey = N_('点击“播放”开始音乐'); notify(); });
}

function refresh() {
  const s = store.get(); audio.playBgm(bgmKeyFor(selectRoute(s), s.match?.public)); sync(); notify();
}
function install() {
  if (installed) return; installed = true;
  media = new Audio(); media.loop = true; media.preload = 'none';
  media.onerror = () => { record && (record.enabled = false); statusKey = N_('音乐播放失败，已恢复默认音乐'); refresh(); };
  audio.lobbyMusicOverride = key => {
    const override = key === 'lobby' && ((videoAudible && selectRoute(store.get()) === 'lobby') || (record?.enabled && inMusicArea()));
    sync();
    return !!override;
  };
  audio.lobbyMusicBgmStarted = () => { if (!inMusicArea()) { clearHandoff(); fadeCustom(false); } };
  window.addEventListener('sp:lobby-video-audio', e => { videoAudible = !!e.detail?.active; refresh(); });
  lastRoute = areaKey();
  store.subscribe(s => { const route = areaKey(); if (route !== lastRoute) { lastRoute = route; refresh(); } else sync(); });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pointerdown', () => { if (record?.enabled) { audio._unlock(); sync(); } }, { passive: true });
  const initialRevision = revision;
  saved(false).then(value => {
    if (revision !== initialRevision || !value?.blob || value.blob.size > MAX_MUSIC_BYTES) return;
    replace(value); statusKey = value.paused ? N_('已暂停') : N_('点击“播放”开始音乐'); refresh();
  }).catch(() => { statusKey = N_('浏览器暂不能保存音乐，可稍后重试'); notify(); });
}
export const music = {
  snapshot: () => ({ name: record?.name || '', size: record?.blob?.size || 0, enabled: !!record?.enabled, paused: !!record?.paused, playing: !!media && !media.paused, status: statusText(), busy }),
  async upload(file) {
    if (busy) return; install(); ++revision; busy = true; notify();
    try { await validate(file); const next = { blob: file, name: file.name.slice(0, 180), enabled: true, paused: false }; await saved(true, next); replace(next); statusKey = N_('已保存音乐'); audio._unlock(); refresh(); }
    catch (e) { statusKey = e.message || t('音乐导入失败'); throw e; }
    finally { busy = false; notify(); }
  },
  async toggle() {
    if (!record || busy) return; ++revision;
    const next = { ...record, enabled: true, paused: !!record.enabled && !media.paused };
    await saved(true, next); record = next; statusKey = next.paused ? N_('已暂停') : N_('正在播放 · 单曲循环'); audio._unlock(); refresh();
  },
  async reset() { if (busy) return; ++revision; await saved(true, null); replace(null); statusKey = N_('默认大厅音乐'); refresh(); },
};

/** The lobby top bar's ♫ button and its dialog. */
export function LobbyMusicButton() {
  const [open, setOpen] = useState(false), [state, setState] = useState(music.snapshot), [error, setError] = useState('');
  const input = useRef(null);
  useEffect(() => { install(); const fn = s => setState(s); listeners.add(fn); fn(music.snapshot()); return () => listeners.delete(fn); }, []);
  const action = async fn => { setError(''); try { await fn(); } catch (e) { setError(e.message || t('操作失败')); } };
  return html`<${Button} variant="secondary" size="sm" square=${true} class="hub-music-btn" title=${t('大厅音乐')} aria-label=${t('大厅音乐')}
      onClick=${() => setOpen(true)}><span class="hub-music-btn__note" aria-hidden="true">♫</span><//>
    <${Modal} class="lobby-music-panel" open=${open} title=${t('大厅音乐')} micro="LOBBY MUSIC" width="min(26rem, calc(100vw - 2rem))" onClose=${() => setOpen(false)}
      actions=${html`<${Button} variant="secondary" onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <div class="music-panel">
        <p class="music-panel__hint">${t('选择你喜欢的大厅音乐，每首最大 20MB。保存在当前浏览器，无需上传服务器；房间、战前信息和选人时继续播放，进入战场淡出并切换游戏音乐。')}</p>
        <div class="music-panel__now">
          <strong class="music-panel__name">${state.name || t('默认大厅音乐')}</strong>
          <small class="music-panel__status">${state.status}${state.size ? ` · ${(state.size / 1024 / 1024).toFixed(1)} MB` : ''}</small>
        </div>
        <input ref=${input} type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.aac,.flac,.webm" hidden
          onChange=${e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) action(() => music.upload(file)); }} />
        <div class="music-panel__row">
          <${Button} disabled=${state.busy} onClick=${() => input.current?.click()}>${state.busy ? t('正在导入…') : t('上传音乐')}<//>
          <${Button} disabled=${!state.name || state.busy} onClick=${() => action(() => music.toggle())}>${state.playing ? t('暂停') : t('播放')}<//>
          <${Button} disabled=${!state.name || state.busy} variant="secondary" onClick=${() => action(() => music.reset())}>${t('恢复默认')}<//>
        </div>
        <small class="music-panel__foot">${t('音量和静音沿用游戏设置。刷新后保留；清理浏览器数据会删除音乐。')}</small>
        ${error ? html`<p class="music-panel__error" role="alert">${error}</p>` : null}
      </div>
    <//>`;
}
