import { HomeMusicProgress } from './homeMusicProgress.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
import { useSettings, updateSettings } from './settings.js';
import { homeMusic } from '../homeMusic.js';
import { MUSIC_LIBRARY, MUSIC_GROUPS, musicById } from '../musicLibrary.js';

export function HomeMusicPlayer({ controller = homeMusic, label = t('主界面音乐'), progress = html`<${HomeMusicProgress}/>` , lazyLibrary = false } = {}) {
  const [state, setState] = useState(controller.get());
  const settings = useSettings();
  const [query,setQuery]=useState('');
  const [libraryOpen,setLibraryOpen]=useState(false);
  const current=musicById(state.id);
  const categories=['主界面','Boss OST','悬赏 OST','阵营 OST','结算 OST','其他 OST'];
  const matches=id=>!query||musicById(id)?.title.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const songs=ids=>ids.filter(matches).map(id=>{const track=musicById(id);return html`<button type="button" key=${id} class="home-music__track" aria-pressed=${state.id===id&&!state.paused} onClick=${()=>controller.select(id)}><span>${state.id===id&&!state.paused?'♫':'▷'}</span><span>${track.title}</span></button>`;});
  useEffect(() => controller.subscribe(setState), [controller]);
  return html`<section class="home-music" aria-label=${label}>
    <header><span aria-hidden="true">♫</span><strong>${label}</strong><small>RHODES RADIO</small></header>
    <div class="home-music__now" aria-live="polite"><small>${t('当前播放')}</small><strong title=${current?.title}>${current?.title||'—'}</strong></div>
    ${progress}
    <div class="home-music__controls">
      <button type="button" title=${t('上一首')} aria-label=${t('上一首')} onClick=${() => controller.next(-1)}>◀</button>
      <button type="button" title=${state.paused ? t('播放') : t('停止')} aria-label=${state.paused ? t('播放') : t('停止')} onClick=${() => controller.togglePause()}>${state.paused ? '▶' : '■'}</button>
      <button type="button" title=${t('下一首')} aria-label=${t('下一首')} onClick=${() => controller.next(1)}>▶</button>
      <button type="button" class="home-music__shuffle" title=${t('切换播放模式')} onClick=${() => controller.cycleMode()}>${state.repeatOne ? t('单曲循环') : state.shuffle ? t('随机播放') : t('顺序播放')}</button>
      <label>${t('音量')}<input type="range" min="0" max="1" step="0.01" value=${settings.bgm} aria-label=${t('音乐音量')} onInput=${e => updateSettings({ bgm: Number(e.target.value) })}/></label>
    </div>
    <details class="home-music__library" onToggle=${e=>setLibraryOpen(e.currentTarget.open)}><summary>${t('音乐库')} <small>${MUSIC_LIBRARY.length}</small></summary>
      ${!lazyLibrary||libraryOpen?html`<input class="home-music__search" type="search" aria-label=${t('搜索曲目')} placeholder=${t('搜索曲目')} value=${query} onInput=${e=>setQuery(e.target.value)}/>
      <div class="home-music__list">
      ${categories.map(category=>{const groups=MUSIC_GROUPS.filter(g=>g.label.split('/')[0]===category&&g.tracks.some(matches));if(!groups.length)return null;return lazyLibrary?html`<${MusicSection} key=${category} label=${t(category)} count=${new Set(groups.flatMap(g=>g.tracks)).size} initialOpen=${category==='主界面'} forceOpen=${!!query} renderRows=${()=>groups.map(group=>group.label.includes('/')?html`<${MusicSection} key=${group.label} label=${group.label.split('/')[1]} forceOpen=${!!query} renderRows=${()=>songs(group.tracks)}/>`:songs(group.tracks))}/>`:html`<details key=${category} open=${category==='主界面'||!!query}><summary>${t(category)} <small>${new Set(groups.flatMap(g=>g.tracks)).size}</small></summary>
        ${groups.map(group=>group.label.includes('/')?html`<details key=${group.label} open=${!!query}><summary>${group.label.split('/')[1]}</summary>${songs(group.tracks)}</details>`:songs(group.tracks))}
      </details>`;})}
      </div>`:null}
    </details>
  </section>`;
}

/** Optional lazy library is used only by the collapsible home menu; room player defaults are unchanged. */
function MusicSection({label,count,initialOpen=false,forceOpen=false,renderRows}) {
  const [expanded,setExpanded]=useState(initialOpen);
  return html`<details open=${expanded||forceOpen} onToggle=${e=>setExpanded(e.currentTarget.open)}><summary>${label}${count!=null?html` <small>${count}</small>`:null}</summary>${expanded||forceOpen?renderRows():null}</details>`;
}
