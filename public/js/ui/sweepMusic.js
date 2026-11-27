import { useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { audio, resolveBgm } from '../audio.js';
import { factionMusicOptions, MUSIC_LIBRARY, BOUNTY_PLAYLISTS, ENEMY_PLAYLISTS } from '../musicLibrary.js';
import { FACTION_THEMES } from '../../../shared/bossFactions.js';
import { themeOfEnemy } from '../../../shared/bgmTheme.js';
import { unhashedUrl } from '../../../shared/assetPaths.js';
import { t } from '../../../shared/i18n.js';

/** Use the combat music catalogue, never invent a preparation track from a battle-only song. */
export function sweepMusicTracks({ bossId = null, enemyKey = null, faction = null }, manifest, enemies) {
  const theme = FACTION_THEMES[faction] || (!bossId && enemyKey ? themeOfEnemy(enemyKey, enemies) : null);
  return Object.fromEntries(['prep','battle'].map(phase => {
    const key = bossId ? `${phase === 'prep' ? 'bossPrep' : 'boss'}:${bossId}` : BOUNTY_PLAYLISTS[enemyKey] ? `${phase==='prep'?'bountyPrep':'bounty'}:${enemyKey}` : ENEMY_PLAYLISTS[enemyKey] ? `${phase==='prep'?'enemyPrep':'enemy'}:${enemyKey}` : theme ? `theme:${theme}${phase === 'prep' ? '@prep' : ''}` : null;
    const first = key && resolveBgm(manifest, key);
    const options = key ? [...(first ? [first] : []), ...factionMusicOptions(key, manifest)] : [];
    const unique = [...new Map(options.filter(row=>typeof row.loop==='string').map(row=>[unhashedUrl(row.loop),row])).values()];
    return [phase, unique.map(row => ({ url: row.loop, key: 'playlist:' + encodeURIComponent(row.loop),
      title: MUSIC_LIBRARY.find(track => unhashedUrl(track.url) === unhashedUrl(row.loop))?.title || null }))];
  }));
}

export function SweepMusic({ bossId = null, enemyKey = null, faction = null, manifest, enemies }) {
  const owner = useRef({}), sequence = useRef(0);
  const [selected, setSelected] = useState({}), [playing, setPlaying] = useState(null), [loading, setLoading] = useState(false), [note, setNote] = useState('');
  const tracks = sweepMusicTracks({bossId,enemyKey,faction},manifest,enemies);
  const stop = () => { sequence.current++; audio.stopBgmPreview(owner.current); setPlaying(null); setLoading(false); };
  useLayoutEffect(() => () => { sequence.current++; audio.stopBgmPreview(owner.current); }, []);
  const play = async (phase, track) => {
    if (playing === phase) { stop(); return; }
    if (audio.bgmSilent) { setNote(t('请在声音设置中开启背景音乐')); return; }
    const token = ++sequence.current; setPlaying(phase); setLoading(true); setNote('');
    const started = await audio.previewBgm(track.key, owner.current);
    if (token !== sequence.current) return;
    setLoading(false);
    if (!started) { stop(); setNote(t('音乐暂时无法播放，请检查资源是否已安装')); }
  };
  return html`<section class="sw-music" aria-label=${t('专属家族音乐')}>
    <h4><span aria-hidden="true">♫</span>${t('专属家族音乐')}</h4>
    ${['prep','battle'].map(phase=>{
      const options=tracks[phase],track=options.find(row=>row.url===selected[phase])||options[0];
      return html`<div key=${phase} class="sw-music__row"><label>${phase==='prep'?t('休息期'):t('战斗期')}
        <select aria-label=${phase==='prep'?t('休息期音乐'):t('战斗期音乐')} disabled=${!options.length} value=${track?.url||''} onChange=${event=>{stop();setNote('');setSelected({...selected,[phase]:event.target.value});}}>
          ${options.length?options.map((row,index)=>html`<option key=${row.url} value=${row.url}>${row.title||t('专属音乐 {n}',{n:index+1})}</option>`):html`<option value="">${t('暂无该阶段专属音乐')}</option>`}
        </select></label><button type="button" disabled=${!track} aria-pressed=${playing===phase} onClick=${()=>play(phase,track)}>${playing===phase?(loading?t('载入中…'):t('停止试听')):t('试听')}</button></div>`;
    })}
    ${note?html`<p role="status">${note}</p>`:null}
  </section>`;
}
