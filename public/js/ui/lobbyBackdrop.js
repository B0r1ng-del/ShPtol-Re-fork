// 大厅背景替换 + 干员立绘（移植自离线演示版 ui/lobbyScene.js，2026-11-16）。
//
// 为什么不直接搬演示版的 lobbyScene.js：它 161 行里有一半是动态 Spine 立绘
// （dynamicAssistant / assistantSpine / assistantEffects / resourcePacks），
// 而 dynamic 资源包（public/assets/dynamic）在演示版里**根本不存在**
// ⇒ hasDynamicAssistant() 恒为 false，DynamicAssistant 一进 !available 就 return，一行都不画。
// ⇒ 这里只保留用户实际要的两件事：**换背景**、**选干员立绘**，静态图（webp）显示。
//    目录读 /assets/lobby/catalog.json（41 背景 / 418 干员），选择存 localStorage。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from './components.js';
import { loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';

const PREF_SCENE = 'lobby.scene';
const PREF_ACTOR = 'lobby.actor';
const PREF_POS = 'lobby.assistantPosition';
const DEFAULT_SCENE = '69_g1_rivercrossing';
const DEFAULT_ACTOR = 'char_1023_ghost2';

let catalogCache = null;

/** catalog.json 只取一次；失败返回 null（调用方按空表渲染，不炸）。 */
export function useLobbyCatalog() {
  const [catalog, setCatalog] = useState(catalogCache);
  useEffect(() => {
    if (catalogCache) return undefined;
    let live = true;
    fetch('/assets/lobby/catalog.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !live) return;
        catalogCache = { backgrounds: j.backgrounds || [], actors: j.actors || [] };
        setCatalog(catalogCache);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return catalog;
}

export const lobbyScenePrefs = () => ({
  scene: loadPref(PREF_SCENE, DEFAULT_SCENE),
  actor: loadPref(PREF_ACTOR, DEFAULT_ACTOR),
  position: loadPref(PREF_POS, { x: 29, y: 2, scale: 1 }),
});

/** 背景层 + 立绘层。放大厅最底下，aria-hidden，不吃指针。 */
export function LobbyBackdrop({ catalog, paused = false }) {
  const [scene, setScene] = useState(() => lobbyScenePrefs().scene);
  const [actorId, setActorId] = useState(() => lobbyScenePrefs().actor);
  const [position] = useState(() => lobbyScenePrefs().position);

  useEffect(() => {
    const onPick = () => {
      const p = lobbyScenePrefs();
      setScene(p.scene); setActorId(p.actor);
    };
    window.addEventListener('lobby-backdrop-change', onPick);
    return () => window.removeEventListener('lobby-backdrop-change', onPick);
  }, []);

  const bg = (catalog?.backgrounds || []).find((s) => s.id === scene) || (catalog?.backgrounds || [])[0] || null;
  const actor = (catalog?.actors || []).find((a) => a.id === actorId) || null;
  const imgStyle = bg ? { backgroundImage: 'url("' + bg.image + '")' } : undefined;
  const actorStyle = {
    left: position.x + '%',
    top: position.y + '%',
    height: (104 * position.scale) + '%',
    transform: 'translateY(-8%)',
  };

  return html`<div class=${'lobby-backdrop' + (bg && bg.category === 'cg' ? ' is-cg' : '')}
      aria-hidden="true" style=${paused ? { visibility: 'hidden' } : undefined}>
    <div class="lobby-backdrop__image" style=${imgStyle}></div>
    <div class="lobby-backdrop__wash"></div>
    ${actor ? html`<img class="lobby-backdrop__actor" src=${actor.image} alt="" decoding="async" style=${actorStyle} />` : null}
  </div>`;
}

/** 背景替换弹窗：两个 tab（背景 / 主界面助理），点选即时保存并广播。 */
export function BackgroundPicker({ open, onClose }) {
  const catalog = useLobbyCatalog();
  const [tab, setTab] = useState('background');
  const [category, setCategory] = useState('scene');
  const [query, setQuery] = useState('');
  const [scene, setScene] = useState(() => lobbyScenePrefs().scene);
  const [actorId, setActorId] = useState(() => lobbyScenePrefs().actor);

  const commit = (next) => {
    if (next.scene !== undefined) { setScene(next.scene); savePref(PREF_SCENE, next.scene); }
    if (next.actor !== undefined) { setActorId(next.actor); savePref(PREF_ACTOR, next.actor); }
    window.dispatchEvent(new Event('lobby-backdrop-change'));
  };

  const scenes = (catalog?.backgrounds || []).filter((s) => s.category === category);
  const actors = (catalog?.actors || []).filter((a) => !query || a.name.toLowerCase().includes(query.toLowerCase()));

  return html`<${Modal} open=${open} onClose=${onClose} title=${t('背景替换')} class="background-picker"
      veilClass="background-picker-veil" closeOnBackdrop=${false}
      actions=${html`<${Button} onClick=${onClose}>${t('完成')}<//>`}>
    <nav class="background-picker__tabs" role="tablist">
      <button type="button" role="tab" aria-selected=${tab === 'background'} onClick=${() => setTab('background')}>${t('背景替换')}</button>
      <button type="button" role="tab" aria-selected=${tab === 'assistant'} onClick=${() => setTab('assistant')}>${t('主界面助理')}</button>
    </nav>
    ${tab === 'background' ? html`<div class="background-picker__panel">
      <div class="background-picker__categories">
        ${[['scene', '场景'], ['cg', '人物CG']].map(([id, label]) => html`<button type="button"
          class=${category === id ? 'is-on' : ''} aria-pressed=${category === id}
          onClick=${() => setCategory(id)}>${t(label)}</button>`)}
      </div>
      <div class="background-picker__grid">
        ${scenes.map((s) => html`<button type="button" key=${s.id} class=${s.id === scene ? 'is-on' : ''}
          data-scene-id=${s.id} aria-pressed=${s.id === scene} onClick=${() => commit({ scene: s.id })}>
          <img src=${s.thumb || s.image} alt="" loading="lazy" decoding="async" />
          <span>${s.name}</span>
        </button>`)}
      </div>
    </div>` : html`<div class="background-picker__panel">
      <input class="background-picker__search" type="search" value=${query} placeholder=${t('搜索干员')}
        onInput=${(e) => setQuery(e.currentTarget.value)} />
      <div class="background-picker__grid is-actors">
        <button type="button" class=${!actorId ? 'is-on' : ''} aria-pressed=${!actorId}
          data-assistant-id="" onClick=${() => commit({ actor: '' })}>${t('隐藏角色')}</button>
        ${actors.map((a) => html`<button type="button" key=${a.id} class=${a.id === actorId ? 'is-on' : ''}
          data-assistant-id=${a.id} aria-pressed=${a.id === actorId} onClick=${() => commit({ actor: a.id })}>
          <img src=${a.image} alt="" loading="lazy" decoding="async" /><span>${a.name}</span>
        </button>`)}
      </div>
    </div>`}
  <//>`;
}
