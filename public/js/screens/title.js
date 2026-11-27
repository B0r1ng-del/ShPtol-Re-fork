// Title screen: season-style backdrop, big title 卫戍协议：盟约, remembered nickname, 开始, the language menu
// (中文 | English | every pack in public/i18n/, ui/lang.js; a title in an alphabetic script — English — is the big one and
// the small wordmark above it hides).
//
// Pressing 开始 validates the nickname (1..NAME_MAX_LEN chars, no control characters), stores it,
// marks this tab as "entered" (so reloads skip the title) and hands the name to net.js, which
// sends `hello` (now, or as soon as the socket is open). The router then shows the lobby.
//
// Backdrop art: if data/assets.json lists a UI backdrop (`ui.titleBackdrop`, or one of the
// entry/loading illustration names) it is layered under the CSS art; otherwise the screen is
// pure CSS/SVG (radar, ridgelines, glow), so it never issues a request that can 404.
//
// The full art, under the login box: 下载完整素材 (ui/assetDownload.js — its dialog downloads from this server) and
// 导入素材包 (ui/assetImport.js — the player's own folder or zip, no server download) side by side, so an import never
// opens the download (docs/history/0.3.0.md §32.14.39).
//
// Plugins (DESIGN §32 P1a, the design study's §7.4): when the server has unofficial plugins (content.plugins of /healthz or
// welcome — content.js installedCount), the footer says 「本服务器安装了 N 个插件」 — a button that loads the list
// (ui/pluginPanel.js InstalledPlugins, which fetches the catalogue when it opens); nothing on a server without any, which
// the page never asks for its catalogue — and the title page loads none of the panel's code.

import { ResumeMatchButton } from '../ui/resumeMatch.js';
import { AssetDownloadButton } from '../ui/assetDownload.js';
import { AssetImportButton } from '../ui/assetImport.js';
import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { NAME_MAX_LEN, APP_VERSION, DEV_BUILD } from '../../../shared/constants.js';
import { html, Button, Icon, MicroLabel, TextField, PingPill } from '../ui/components.js';
import { GuideButton } from '../ui/guide.js';
import { openStats } from './stats.js';
import { toast } from '../ui/toasts.js';
import { net, identity } from '../net.js';
import { store, useStore, shallowEqual } from '../store.js';
import { data, useData } from '../data.js';
import { FullscreenButton, PwaInstallButton, detectFeatures } from '../ui/device.js';
import { LangToggle, useLang } from '../ui/lang.js';
import { t, N_ } from '../../../shared/i18n.js';
import { scriptOf } from '../../../shared/i18nPacks.js';
import { GIcon } from '../ui/gameComponents.js';
import { SettingsModal } from '../ui/settings.js';
import { installedCount } from '../content.js';
import { NoticesButton } from '../ui/notices.js';
import { sanitizeName, isValidName } from '../ui/playerName.js';
// 标题页视觉层（移植自离线演示版 title.js，2026-11-16）：球体 / 丝线 / 入场 / 登录到达。
// 演示版的逻辑层还牵着 startupSession（资源引导）与 access.js 的令牌，那些 game 有自己的实现，
// 所以只搬渲染，不搬那两条链路。
import { useRef } from '../../vendor/hooks.module.js';
import { TitleSphere } from '../ui/titleSphere.js';
import { TitleFilaments } from '../ui/titleFilaments.js';
import { useTitleEntrance } from '../ui/titleEntrance20261102.js';
import { useEntryViewport } from '../ui/entryViewport20261102.js';
import { LoginArrival, useLoginArrival } from '../ui/loginArrival20261102.js';

export { stripLoneSurrogates, sanitizeName, isValidName } from '../ui/playerName.js';

/**
 * Enter the game shell with a nickname (title → lobby).
 * @param {string} rawName
 * @returns {boolean} false when the name is invalid
 */
export function enterSession(rawName) {
  const name = sanitizeName(rawName);
  if (!name) return false;
  identity.saveName(name);
  identity.setEntered(true);
  store.set((s) => ({ me: { ...s.me, name }, session: { ...s.session, entered: true } }));
  net.setName(name);
  return true;
}

// data/assets.json `ui` keys are 'group/key' (docs/ASSETS.md).
const BACKDROP_KEYS = ['titleBackdrop', 'entry/bkg_01', 'entry/bkg_02'];
const RIDGE_KEYS = ['titleRidges', 'entry/bg_mountains_tiled'];

/**
 * Find a UI image URL in data/assets.json (tolerant of a few plausible shapes).
 * @param {any} assets
 * @param {string[]} names
 * @returns {string|null}
 */
export function findUiAsset(assets, names) {
  if (!assets || typeof assets !== 'object') return null;
  const asUrl = (v) => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return v.url || v.path || v.src || null;
    return null;
  };
  const ui = assets.ui;
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    for (const n of names) {
      const u = asUrl(ui[n]);
      if (u) return u;
    }
  }
  const lists = [Array.isArray(ui) ? ui : null, Array.isArray(assets.files) ? assets.files : null].filter(Boolean);
  for (const list of lists) {
    for (const n of names) {
      const hit = list.map(asUrl).find((u) => typeof u === 'string' && u.includes('/ui/') && u.toLowerCase().split('/').pop().startsWith(n.toLowerCase()));
      if (hit) return hit;
    }
  }
  return null;
}

// Dot-matrix watchtower emblem (13×14 bitmap; dots grow toward the base for depth).
const EMBLEM = [
  'XXX..XXX..XXX',
  'XXX..XXX..XXX',
  'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXX.XXXX..',
  '..XXXX.XXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '.XXXXXXXXXXX.',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
];

export function Emblem({ class: cls }) {
  const dots = useMemo(() => {
    const out = [];
    EMBLEM.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch !== 'X') return;
        const rad = 0.2 + (r / (EMBLEM.length - 1)) * 0.2;
        const accent = (r === 6 || r === 7) && (c === 5 || c === 7);
        out.push({ cx: c + 0.5, cy: r + 0.5, r: rad, accent });
      });
    });
    return out;
  }, []);
  return html`<div class=${cls ? `emblem ${cls}` : 'emblem'} aria-hidden="true">
    <span class="emblem__bracket emblem__bracket--l"></span>
    <svg class="emblem__svg" viewBox="-0.5 -0.5 14 15">
      ${dots.map((d, i) => html`<circle key=${i} cx=${d.cx} cy=${d.cy} r=${d.r} class=${d.accent ? 'is-accent' : ''} />`)}
    </svg>
    <span class="emblem__bracket emblem__bracket--r"></span>
  </div>`;
}

function Ridges() {
  return html`<svg class="title-bg__ridges" viewBox="0 0 1920 420" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="ridge-far" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#16231f" /><stop offset="1" stop-color="#0a0e0d" />
      </linearGradient>
      <linearGradient id="ridge-near" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0f1714" /><stop offset=".6" stop-color="#080b0a" />
      </linearGradient>
      <linearGradient id="ridge-edge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#17f9b7" stop-opacity="0" />
        <stop offset=".3" stop-color="#17f9b7" stop-opacity=".55" />
        <stop offset=".7" stop-color="#17f9b7" stop-opacity=".55" />
        <stop offset="1" stop-color="#17f9b7" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path class="ridge ridge--far" fill="url(#ridge-far)" stroke="url(#ridge-edge)"
      d="M0 420V250l120-40 90 30 90-70 60 20 80-70 80 55 80-25 90 70 90-20 80 50 100-15 90 25 90-55 90-55 70-55 70 45 80-20 90 65 80-20 100 55 100-20 100 40v180z" />
    <path class="ridge ridge--near" fill="url(#ridge-near)" stroke="url(#ridge-edge)"
      d="M0 420V322l160-32 100 20 120-50 90 40 130-20 120 50 140-30 140 35 120-35 140 20 140-50 120 30 120-20 120 40 160-20v147z" />
  </svg>`;
}

const STATUS_TEXT = {
  idle: N_('准备连接'), connecting: N_('正在连接服务器'), connected: N_('已连接服务器'), handshaking: N_('正在验证身份'),
  online: N_('已连接服务器'), reconnecting: N_('连接中断，正在重连'), closed: N_('连接已关闭'),
};

/** Title screen component. */
export function TitleScreen() {
  // 视觉层的三个 hook：球体/丝线/入场动画 + 登录到达幕（演示版同名 hook，逻辑无关）。
  const surface = useRef(null);
  useTitleEntrance(surface);
  useEntryViewport(surface);
  const arrivalScene = useLoginArrival(surface);
  const conn = useStore((s) => s.connection, shallowEqual);
  const pendingJoin = useStore((s) => s.ui.pendingJoin);
  useLang(); // re-render on a language switch
  const currentName = useStore((s) => s.me.name);
  const [name, setName] = useState(() => currentName || identity.loadName() || '');
  // An import may restore the current name while this screen remains behind the stats overlay.
  useEffect(() => {
    if (currentName) setName((draft) => draft || currentName);
  }, [currentName]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // the list of the server's plugins once loaded (ui/pluginPanel.js — a component in state: set through an updater)
  const [Installed, setInstalled] = useState(null);
  const openPlugins = () => {
    import('../ui/pluginPanel.js').then((m) => setInstalled(() => m.InstalledPlugins), (err) => console.warn('[plugins] the list did not load', err));
  };
  const installed = useStore(installedCount);
  const assetsSettled = useData('assets');
  const assets = data.get('assets');
  const backdrop = findUiAsset(assets, BACKDROP_KEYS);
  const ridges = findUiAsset(assets, RIDGE_KEYS);
  // Track load/fail per URL (not as booleans reset in effects: an image can load before an effect runs).
  const [bgLoadedUrl, setBgLoadedUrl] = useState(null);
  const [ridgesLoadedUrl, setRidgesLoadedUrl] = useState(null);
  const [ridgesFailedUrl, setRidgesFailedUrl] = useState(null);
  const bgLoaded = !!backdrop && bgLoadedUrl === backdrop;
  const ridgesLoaded = !!ridges && ridgesLoadedUrl === ridges;
  const ridgesFailed = !!ridges && ridgesFailedUrl === ridges;
  // CSS ridgelines only when there is no ridge art (avoids a swap flash when the art arrives).
  const cssRidges = assetsSettled && (!ridges || ridgesFailed);

  const valid = isValidName(name);
  const start = () => {
    if (!valid) { toast(t('请输入博士代号'), 'warn'); return; }
    enterSession(name);
  };

  const online = conn.status === 'online' || conn.status === 'connected';
  const dotClass = online ? 'is-on' : conn.status === 'reconnecting' || conn.status === 'connecting' || conn.status === 'handshaking' ? 'is-warn' : 'is-bad';

  // touch screens: no autofocus (it would pop the on-screen keyboard over a landscape phone's whole view)
  const touchUi = useMemo(() => detectFeatures().coarse, []);
  // a title in an alphabetic script (English, French …) is the big one in the display face and the wordmark above it
  // hides; a CJK / kana / Hangul title keeps the Chinese layout (shared/i18nPacks.js scriptOf — a pack needs no flag)
  const alphabetic = scriptOf(t('卫戍协议')) === 'alphabetic';
  return html`<div ref=${surface} class="screen login-rebuild" data-flow-paused=${settingsOpen ? true : undefined}>
    <div class="login-rebuild__scene" aria-hidden="true">
      <div class="login-rebuild__sphere"><${TitleSphere} paused=${!!settingsOpen} /></div>
      <div class="login-rebuild__plane login-rebuild__plane--back"></div>
      <div class="login-rebuild__plane login-rebuild__plane--front"></div>
      <div class="login-rebuild__flow"><${TitleFilaments} tone="light" paused=${!!settingsOpen} /></div>
      <div class="login-rebuild__axis"></div>
    </div>
    <div class="login-rebuild__reveal" aria-hidden="true"><i></i><i></i><span></span></div>
    ${arrivalScene.active ? html`<${LoginArrival} onDismiss=${arrivalScene.dismiss} />` : null}
    <header class="login-rebuild__top">
      <span class="login-rebuild__signature">RHODES ISLAND <i>/</i> STRONGHOLD PROTOCOL</span>
      <div class="login-rebuild__tools">
        <${LangToggle} class="title-lang login-rebuild__lang" />
        <${Button} class="title-settings fsbtn tapx" square=${true}
          title=${t('设置')} aria-label=${t('设置')} onClick=${() => setSettingsOpen(true)}><${GIcon} name="gear" /><//>
        <${FullscreenButton} class="title-fs" />
        <${NoticesButton} />
      </div>
    </header>
    <main class="login-rebuild__main">
      <section class="login-rebuild__brand">
        <div class="login-rebuild__brandline">
          <span class="login-rebuild__seal"><img src="/startup/login-rebuild-20261102/season_logo.png" alt="" /></span>
          <span>STRONGHOLD<br />PROTOCOL</span>
        </div>
        <h1 data-testid="title-wordmark" class=${'login-rebuild__title' + (alphabetic ? ' is-latin' : '')}>${t('卫戍协议')}</h1>
        <div class="login-rebuild__season"><strong>${t('盟约')}</strong><span>ALLIANCE</span><i></i></div>
        <p class="login-rebuild__description">${t('调配资金与干员，与同伴协同布防，抵御多波次进攻，直至击败敌方领袖。')}</p>
        <span class="login-rebuild__edition">${t('非官方同人作品')} <i>/</i> ${APP_VERSION}</span>
      </section>
      <section class="login-rebuild__form" data-testid="login-form" aria-label=${t('开始模拟')}>
        <div class="login-rebuild__form-art" aria-hidden="true"></div>
        <header class="login-rebuild__form-head">
          <div><small>STRONGHOLD PROTOCOL</small><h2>${t('开始模拟')}</h2></div>
          <img src="/startup/login-rebuild-20261102/start_forward.png" alt="" />
        </header>
        ${pendingJoin ? html`<div class="login-rebuild__invite"><${Icon} name="key" /><span>${t('收到同盟邀请')} <b>${pendingJoin}</b></span></div>` : null}
        <${TextField} label=${t('博士代号')} micro="CALLSIGN" size="lg" icon="user" value=${name} maxLength=${NAME_MAX_LEN}
          placeholder=${t('输入你的代号（最多 {NAME_MAX_LEN} 字）', { NAME_MAX_LEN })} autoFocus=${!touchUi}
          onInput=${setName} onEnter=${start} />
        ${/* 演示版这里还有一个「登录令牌」输入框（access.js），那是演示版自己的准入限制；
             game 没有 access.js，也没有令牌机制，故不画 —— 否则会引用未定义变量直接崩。 */''}
        <${Button} class="login-rebuild__start" data-testid="title-start" variant="primary" size="xl" block=${true}
          iconRight="chevrons" disabled=${!valid} onClick=${start}>${t('开始')}<//>
      </section>
    </main>
    <footer class="login-rebuild__bottom">
      <div class="login-rebuild__connection">
        <span class=${'status-dot ' + dotClass}></span>
        <span>${STATUS_TEXT[conn.status] ? t(STATUS_TEXT[conn.status]) : conn.status}</span>
        ${conn.status === 'online' ? html`<${PingPill} ms=${conn.ping} />` : null}
      </div>
      <nav class="login-rebuild__utilities" aria-label=${t('设置')}>
        <${AssetDownloadButton} />
        <${AssetImportButton} />
        <${GuideButton} label=${t('玩法说明')} />
        <${PwaInstallButton} />
        <${FullscreenButton} />
      </nav>
      <span class="login-rebuild__copyright">${t('非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有')}</span>
      <${ResumeMatchButton} />
      ${installed ? html`<button type="button" class="login-rebuild__plugins" onClick=${openPlugins}>${t('本服务器安装了 {n} 个插件', { n: installed })}</button>` : null}
      ${DEV_BUILD ? html`<span role="note">${t('开发版 · 不稳定，请勿用于公开服务器')}</span>` : null}
    </footer>
    <${SettingsModal} open=${settingsOpen} onClose=${() => setSettingsOpen(false)} />
    ${Installed ? html`<${Installed} open=${true} onClose=${() => setInstalled(null)} />` : null}
  </div>`;
}
