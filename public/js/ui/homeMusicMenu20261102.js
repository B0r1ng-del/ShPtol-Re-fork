import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { portal as Portal } from './portalLite.js';
import { t } from '../../../shared/i18n.js';
import { homeMusic } from '../homeMusic.js';
import { musicById } from '../musicLibrary.js';
import { useSettings } from './settings.js';
import { HomeMusicPlayer } from './homeMusicPlayer.js';

/** UI lifetime only: never starts/stops audio, changes a track or seeks when opening/closing. */
export function HomeMusicMenu() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(homeMusic.get());
  const host = useRef(null), trigger = useRef(null), popup = useRef(null);
  const [anchor, setAnchor] = useState({left:16, top:56});
  const settings = useSettings();
  useEffect(() => homeMusic.subscribe(setState), []);
  useLayoutEffect(() => {
    if (!open) return;
    const outside = e => { if (!host.current?.contains(e.target) && !popup.current?.contains(e.target)) setOpen(false); };
    const place = () => {
      const bar = host.current?.closest('.home-top')?.getBoundingClientRect();
      if (bar) {
        const menu = host.current?.closest('.lobby-home')?.querySelector('.home-menu')?.getBoundingClientRect();
        const left = Math.max(8,bar.left), viewportWidth = window.visualViewport?.width || innerWidth;
        const available = Math.max(160,(menu?.left ?? viewportWidth-16)-left-12);
        setAnchor({left,top:bar.bottom+8,width:Math.max(0,Math.min(390,available,viewportWidth-left-8))});
      }
    };
    place();
    const key = e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open]);
  const current = musicById(state.id);
  const silent = state.paused || settings.muted || settings.bgm === 0;
  return html`<div class="home-music-menu" ref=${host}>
    <button ref=${trigger} type="button" class="home-tool home-music-toggle" title=${current?.title || t('主界面音乐')}
      aria-label=${t('主界面音乐')} aria-expanded=${open} aria-controls="home-music-popover" onClick=${() => setOpen(v => !v)}>
      <span class="home-music-toggle__state" aria-hidden="true">${silent ? 'Ⅱ' : '♫'}</span>
      <span class="home-music-toggle__name">${current?.title || t('主界面音乐')}</span>
      <span class="home-music-toggle__arrow" aria-hidden="true">${open ? '⌃' : '⌄'}</span>
    </button>
    ${open ? html`<${Portal}><div ref=${popup} id="home-music-popover" class="home-music-popover" role="region" aria-label=${t('主界面音乐')} style=${{left:anchor.left+'px',top:anchor.top+'px',width:anchor.width?anchor.width+'px':undefined,'--music-top':anchor.top+'px'}}>
      <button type="button" class="home-music-popover__close" aria-label=${t('关闭')} onClick=${() => { setOpen(false); trigger.current?.focus(); }}><${Icon} name="close" /></button>
      <${HomeMusicPlayer} lazyLibrary=${true} />
    </div><//>` : null}
  </div>`;
}
