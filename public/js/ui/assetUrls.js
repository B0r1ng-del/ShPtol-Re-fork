import { customAvatarUrl } from '../../../shared/avatars.js';


// Asset URL resolution against data/assets.json (docs/ASSETS.md). Pure: every function takes the
// manifest object (or null) and returns a URL string or null — callers draw their own fallback
// (glyph, CSS shape) when null. Only URLs present in the manifest are ever returned, so the client
// never requests files the asset pipeline did not produce (no 404 noise in the console).

const str = (v) => (typeof v === 'string' && v ? v : null);
const obj = (v) => (v && typeof v === 'object' ? v : null);

/** Skin pictures belong to the effective operator, never the original chess of a stand-in / DIY slot. */
function skinPicture(m, chess, skinId, field) {
  if (!skinId) return null;
  const id = chess?.charId || str(chess?.assets?.[field])?.replace(/_[12]$/, '');
  const skin = m?.chars?.[id]?.skins?.[skinId];
  const elite = chess?.isGolden || /_2$/.test(chess?.assets?.[field] || '');
  return str(elite && skin?.[`${field}E2`]) || str(skin?.[field]) || (field === 'portrait' ? str(skin?.illust) : null);
}

/** @param {any} m manifest @param {string} key 'group/key' */
export function uiUrl(m, key) {
  return str(obj(obj(m)?.ui)?.[key]);
}

/** 六.E 本局收藏品 (packRelic): the original collectible art the asset pipeline downloads (`manifest.relics`). */
export function relicIconUrl(m, id) {
  return str(obj(obj(m)?.relics)?.[str(id)]);
}

/**
 * Operator avatar for a chess record (golden → E2 art when present).
 * @param {any} m manifest
 * @param {any} chess chess.json record (or { assets: { avatar } })
 */
export function chessAvatarUrl(m, chess, { skin = null } = {}) {
  const picture = skinPicture(m, chess, skin, 'avatar');
  if (picture) return picture;
  const chars = obj(obj(m)?.chars);
  const id = str(chess?.assets?.avatar) || str(chess?.charId);
  if (!chars || !id) return null;
  if (id.endsWith('_2') && !chars[id]) {
    const base = chars[id.slice(0, -2)];
    return str(base?.avatarE2) || str(base?.avatar);
  }
  // A golden piece whose avatar id is the character key uses that entry's E2 art when it has one.
  // Official ids are `charId` or `charId_2` (the suffix branch above). Model and voice have no E2
  // field on the character entry: the composed `spine` / `voice` id is already the form's.
  const entry = chars[id];
  if (entry && chess?.isGolden && str(entry.avatarE2)) return str(entry.avatarE2);
  return str(entry?.avatar) || (chess?.charId ? str(chars[chess.charId]?.avatar) : null);
}

/**
 * Half-body portrait (180×360) for a chess record (golden → E2 portrait when present).
 * @param {any} m
 * @param {any} chess
 */
export function chessPortraitUrl(m, chess, { skin = null } = {}) {
  const picture = skinPicture(m, chess, skin, 'portrait');
  if (picture) return picture;
  const chars = obj(obj(m)?.chars);
  const id = str(chess?.assets?.portrait);
  if (!chars) return null;
  if (id) {
    // A golden piece whose portrait id is the character key uses portraitE2 when the entry has one.
    // An entry with only `portrait` (a custom golden URL included) keeps that URL. Official ids are
    // `charId_1` / `charId_2` and are not character keys, so they stay on the suffix branches below.
    if (chars[id]) return (chess?.isGolden ? str(chars[id].portraitE2) : null) || str(chars[id].portrait);
    if (id.endsWith('_2')) {
      const base = chars[id.slice(0, -2)];
      if (base) return str(base.portraitE2) || str(base.portrait);
    }
    if (id.endsWith('_1')) {
      const base = chars[id.slice(0, -2)];
      if (base) return str(base.portrait);
    }
  }
  const byChar = chess?.charId ? chars[chess.charId] : null;
  if (!byChar) return null;
  return (chess?.isGolden ? str(byChar.portraitE2) : null) || str(byChar.portrait);
}

/**
 * The operator's OWN 立绘 of a chess record: `e2` asks for the 精英二 one (`_2`), which falls back to the 原始 one
 * when the operator has no E2 art (1★/2★ have none) — that fallback is why the picker can offer the tile at all.
 * @param {any} m manifest @param {any} chess chess record @param {boolean} [e2]
 */
export function chessOwnPortraitUrl(m, chess, e2 = false) {
  const chars = obj(obj(m)?.chars);
  const rec = obj(chars?.[str(chess?.charId)]);
  if (!rec) return null;
  return (e2 ? str(rec.portraitE2) || str(rec.portrait) : str(rec.portrait)) || null;
}

/**
 * 商店立绘 (docs/SKINS.md): the 180×360 art the shop card and the operator detail card draw for `chess` under this
 * browser's choice —
 *   * absent / `''` → the operator's own portrait, exactly as before the feature (`chessPortraitUrl`: E2 for an
 *     elite chess, which is what the card has always shown);
 *   * `PORTRAIT_E2`  → the 精英二 立绘 explicitly, even for a chess that is not elite;
 *   * a skinId      → that skin's 立绘.
 * Anything unknown (a skin this install does not have, a stale id) falls back to the operator's own portrait, so a
 * choice can never leave a card blank.
 * @param {any} m manifest @param {any} chess chess record @param {string|null|undefined} choice
 */
export function shopPortraitUrl(m, chess, choice) {
  const pick = str(choice);
  if (!pick) return chessPortraitUrl(m, chess);
  if (pick === PORTRAIT_E2) return chessOwnPortraitUrl(m, chess, true) || chessPortraitUrl(m, chess);
  return skinPortraitUrl(m, chess, pick) || chessPortraitUrl(m, chess);
}

/**
 * The 精英二 立绘 choice's value in the local 商店立绘 map (ui/skins.js). Every real skinId starts with `char_`
 * (data/skins.json — `isSkinId` in shared/protocol.js is looser), so this cannot collide with one; and even a
 * collision would only fall back to the operator's own portrait (`shopPortraitUrl`).
 */
export const PORTRAIT_E2 = 'e2';

/**
 * 干员皮肤 (docs/SKINS.md): the tall 立绘 (180×360 — the same frame `chessPortraitUrl` fills) of a chosen skin, or
 * null when nothing is chosen / this install has no 立绘 for that skin. The skin is looked up through the operator
 * (`chars[charId].skins[skinId]`), so a portrait chosen for one chess shows for every chess of that operator.
 * @param {any} m manifest @param {any} chess chess record @param {string|null} skinId
 */
export function skinPortraitUrl(m, chess, skinId) {
  const id = str(skinId);
  const charId = str(chess?.charId);
  if (!id || !charId) return null;
  const skins = obj(obj(obj(m)?.chars)?.[charId])?.skins;
  return str(obj(obj(skins)?.[id])?.portrait);
}

/** Skill icon of a chess record (manifest `skills[iconId]`, else the empty skill sprite). */
export function skillIconUrl(m, chess) {
  const skills = obj(obj(m)?.skills);
  const id = str(chess?.assets?.skillIcon) || str(chess?.skill?.iconId) || str(chess?.skill?.skillId);
  if (skills && id && skills[id]) return str(skills[id]);
  const byId = obj(obj(m)?.skillsById);
  const alt = byId && chess?.skill?.skillId ? byId[chess.skill.skillId] : null;
  if (skills && alt && skills[alt]) return str(skills[alt]);
  return uiUrl(m, 'skillIcon/empty');
}

/**
 * Skill icon of one skill record (DESIGN §16 `skills[]`: iconId / skillId), else the empty skill sprite — or null with
 * `{ empty: false }` (the asset manifest only carries the default skills' icons: callers then draw a lettered S1–S3
 * tile instead of a blank square).
 */
export function skillRecordIconUrl(m, skill, { empty = true } = {}) {
  const skills = obj(obj(m)?.skills);
  for (const id of [str(skill?.iconId), str(skill?.skillId)]) if (skills && id && skills[id]) return str(skills[id]);
  const byId = obj(obj(m)?.skillsById);
  const alt = byId && skill?.skillId ? byId[skill.skillId] : null;
  if (skills && alt && skills[alt]) return str(skills[alt]);
  return empty ? uiUrl(m, 'skillIcon/empty') : null;
}

const PROF_KEY = {
  PIONEER: 'pioneer', WARRIOR: 'warrior', TANK: 'tank', SNIPER: 'sniper', CASTER: 'caster', MEDIC: 'medic',
  SUPPORT: 'support', SPECIAL: 'special',
};

/** Profession icon (small white glyph). */
export function profIconUrl(m, profession) {
  const k = PROF_KEY[String(profession || '').toUpperCase()];
  return k ? str(obj(obj(obj(m)?.prof)?.icon)?.[k]) : null;
}

/** Square profession glyph (manifest `prof.large`: a black glyph on white, drawn as a white one by loadout.css). */
export function profGlyphUrl(m, profession) {
  const v = obj(obj(obj(m)?.prof)?.large)?.[String(profession || '').toLowerCase()];
  return str(v);
}

/** Sub-profession icon from a chess record (`assets.subProfIcon` = 'sub_<id>_icon'). */
export function subProfIconUrl(m, chess) {
  const sub = obj(obj(obj(m)?.prof)?.sub);
  if (!sub) return null;
  const raw = str(chess?.assets?.subProfIcon);
  const id = raw ? raw.replace(/^sub_/, '').replace(/_icon$/, '') : str(chess?.subProfessionId);
  return id ? str(sub[id]) : null;
}

/** Bond glyph (white; tint in CSS). */
export function bondIconUrl(m, bondId) {
  return bondId ? str(obj(obj(m)?.bonds)?.[bondId]) : null;
}

/** Band (strategy) icon. */
/**
 * 少数策略用专属立绘（不是通用剪影）—— 移植自离线演示版 assetUrls.js:220。
 * 只影响 CSS 类名，三行逻辑，没有依赖。
 * @param {string} bandId @returns {string}
 */
export function bandPortraitClass(bandId) {
  return ['band_shu', 'band_closur', 'band_tulip'].includes(bandId) ? 'strategy-portrait--custom' : '';
}

export function bandIconUrl(m, bandId) {
  return bandId ? str(obj(obj(m)?.bands)?.[bandId]) : null;
}

/** Item icon for an items.json record (by trapId / iconId) or a raw trap id. */
export function itemIconUrl(m, item) {
  const items = obj(obj(m)?.items);
  if (!items) return null;
  if (typeof item === 'string') return str(items[item]);
  return str(items[item?.iconId]) || str(items[item?.trapId]);
}

/** Enemy icon (manifest keeps fallbacks resolved). */
export function enemyIconUrl(m, enemyKey) {
  const e = enemyKey ? obj(obj(obj(m)?.enemies)?.[enemyKey]) : null;
  if (e?.icon) return str(e.icon);
  // `_2` / `_3` variants fall back to their base enemy
  const base = typeof enemyKey === 'string' ? enemyKey.replace(/_\d+$/, '') : null;
  return base && base !== enemyKey ? str(obj(obj(obj(m)?.enemies)?.[base])?.icon) : null;
}

/** Token avatar, falling back to its owner operator's avatar. */
export function tokenAvatarUrl(m, tokenId) {
  const tokens = obj(obj(m)?.tokens);
  const t = tokenId ? obj(tokens?.[tokenId]) : null;
  if (t?.avatar) return str(t.avatar);
  if (t?.owner) return str(obj(obj(obj(m)?.chars)?.[t.owner])?.avatar);
  return null;
}

/** Faction (特训敌人 type) icon: `enemyTypeIcon/<icon>`. */
export function factionIconUrl(m, iconId) {
  return iconId ? uiUrl(m, `enemyTypeIcon/${iconId}`) : null;
}

/** Title (评语) icon: `titleIcon/<picId>`. */
export function titleIconUrl(m, picId) {
  return picId ? uiUrl(m, `titleIcon/${picId}`) : null;
}

/** Greek type letters of some modules (ISW-α, …) → the Latin letter of the client's icon file names (isw-a). */
const GREEK = { 'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'Δ': 'd' };
/** Lower-cased key → path index of a local `groups.module` object (built once per manifest object). */
const moduleIconIndex = new WeakMap();

/**
 * Official module (uniequip) TYPE icon from the local-client art (DESIGN §13 / §16): `data/local-assets.json`
 * `groups.module[<type>]`, matched case-insensitively against the module's typeName ('MAR-X' → key 'mar-x', 'PRI-X' →
 * key 'PRI-X' — the client's file names are mixed case). null when the manifest, the group or the entry is missing
 * (callers draw the lettered tile / type text instead).
 * @param {any} local the local-art manifest (`data.get('local')`) or null
 * @param {string} typeName e.g. 'MAR-X'
 */
export function moduleTypeIconUrl(local, typeName) {
  const g = obj(obj(obj(local)?.groups)?.module);
  const t = str(typeName)?.trim();
  if (!g || !t) return null;
  const exact = str(obj(g[t])?.path);
  if (exact) return exact;
  let idx = moduleIconIndex.get(g);
  if (!idx) {
    idx = new Map();
    for (const [k, v] of Object.entries(g)) {
      const p = str(obj(v)?.path);
      if (p && !idx.has(k.toLowerCase())) idx.set(k.toLowerCase(), p);
    }
    moduleIconIndex.set(g, idx);
  }
  const key = t.replace(/[αβγδΔ]/g, (c) => GREEK[c]).toLowerCase();
  return idx.get(key) || null;
}

/**
 * Icon for an m.private.effects entry: { iconKind: 'band'|'choice'|'team'|'item'|'garrison', iconId }.
 * @param {any} m
 * @param {{ iconKind?: string, iconId?: string }} eff
 */
export function effectIconUrl(m, eff) {
  const kind = eff?.iconKind;
  const id = str(eff?.iconId);
  if (kind === 'band') return bandIconUrl(m, id) || (id && id.startsWith('icon_') ? bandIconUrl(m, `band_${id.slice(5)}`) : null);
  if (kind === 'item') return itemIconUrl(m, id);
  if (kind === 'garrison') return uiUrl(m, `garrisonTypeIcon/${id || 's_icon_bond'}`) || uiUrl(m, 'garrisonTypeIcon/s_icon_bond');
  if (kind === 'team') return uiUrl(m, `buffIcon/${id && id.startsWith('icon_') ? id : 'icon_team_buff'}`);
  if (kind === 'choice') return uiUrl(m, `buffIcon/${id && id.startsWith('icon_') ? id : 'icon_player_buff'}`);
  return id ? uiUrl(m, `buffIcon/${id}`) : null;
}


/* ==== 演示版 assetUrls.js 的 5 个导出（game 原本没有；演示版 loadout.js 需要） ==== */
/*
 * ★ 2026-11-17（第 6 轮·测试基线）：这 5 个函数从演示版整段搬过来时，**把它们的两个依赖漏掉了** ——
 *   `data`（全局数据源）和 `avatarCatalogues`（模块级缓存）在 game 的 assetUrls.js 里根本不存在。
 *   本文件的设计是「每个函数收 manifest m 当参数」（见文件头 4-6 行），没有全局数据源。
 *   结果：installedAvatarChoices() / avatarSrc() 一被调用就抛 ReferenceError（no-undef ×9）。
 *   本轮实测：全仓暂无外部调用方，所以还没炸；但演示版的 loadout.js 一旦接上就是必崩。
 *   修法：补一个模块级缓存，并让这两个函数接受 manifest 参数（与文件其余函数一致）。
 */
const avatarCatalogues = new WeakMap();
export function chessForAvatar(id, data) {
  if (!id || typeof id !== 'string') return null;
  const list = (typeof data?.list === 'function' ? data.list('chess') : null) || [];
  const hit = list.find((c) => c && (c.chessId === id || c.charId === id));
  if (hit) return hit;
  // A 自选编队 pick is stored as a bare charId and has NO chess record (it is a slot the player filled, not an entry
  // of the mode's own list). It has a portrait like any other operator, so a minimal record is returned when the id
  // names a manifest charId -- that is all chessAvatarUrl reads. Without this the picker took the click and the
  // avatar then drew nothing, because avatarSrc returns null on an unresolvable id.
  const manifest = obj(typeof data?.get === 'function' ? data.get('assets') : data);
  const chars = obj(manifest?.chars);
  return chars && chars[id] ? { charId: id } : null;
}
export function skinAvatarId(charId, skinId) {
  const normalized = 'skin_' + skinId.replace(/[^A-Za-z0-9_]/g, '_');
  if (normalized.length <= 48) return normalized;
  let hash = 2166136261;
  for (const ch of charId + ':' + skinId) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return normalized.slice(0, 39) + '_' + (hash >>> 0).toString(16).padStart(8, '0');
}
export function installedAvatarChoices(m) {
  if (!m || typeof m !== 'object') return [];
  if (avatarCatalogues.has(m)) return avatarCatalogues.get(m).rows;
  const entries = new Map();
  for (const entry of Object.values(m.profileAvatars || {})) {
    if (entry && /^[A-Za-z0-9_]{1,48}$/.test(entry.id) && typeof entry.name === 'string' && typeof entry.url === 'string' && entry.url.startsWith('/assets/')) entries.set(entry.id, entry);
  }
  for (const [charId, rec] of Object.entries(m.chars || {})) for (const [skinId, skin] of Object.entries(rec.skins || {})) {
    const url = str(skin.avatar) || str(skin.portrait) || str(skin.illust);
    if (url) {
      const id = skinAvatarId(charId, skinId);
      entries.set(id, { id, charId, skinId, name: skin.name || skinId, url, group: skin.group || '' });
    }
  }
  const rows = [...entries.values()];
  avatarCatalogues.set(m, { rows, byId: entries });
  return rows;
}
export function avatarSrc(id, m) {
  /*
   * ⚠ **自定义头像先判** (shared/avatars.js, owner 2026-10-15「让只有我能用」)。
   *
   *   它的 id 带 `custom:` 前缀,而 `chessForAvatar` 只认 chessId —— 不先判的话会走到
   *   "解不出的 id → 返回 null → 调用方画默认图标",表现就是**选了专属头像却显示不出来**。
   *
   *   认不出来(清单里没有 / 形状不对)时也返回 null,和官方 id 解不出时同一条退路。
   */
  const custom = customAvatarUrl(id);
  if (custom) return custom;
  installedAvatarChoices(m);
  const installed = m && avatarCatalogues.get(m)?.byId.get(id);
  if (installed) return installed.url;
  const c = chessForAvatar(id, m);
  if (!c) return null;
  return chessAvatarUrl(m, c) || null;
}

export function loadoutIllustrationUrl(m, charId, skinId = null, { elite = true, local = null } = {}) {
  const rec = m?.chars?.[charId];
  const skins = skinId ? [rec?.skins?.[skinId], m?.skins?.[skinId]] : [];
  const illustration = skins.map(skin => str(skin?.illust)).find(Boolean)
    || (skins.some(Boolean) ? str(local?.chars?.[charId]?.skins?.[skinId]?.illust) : null);
  if (illustration) return illustration;
  const portrait = skins.map(skin => str(skin?.portrait)).find(Boolean);
  if (portrait) return portrait;
  return (elite ? str(rec?.illustE2) : null) || str(rec?.illust)
    || (elite ? str(rec?.portraitE2) : null) || str(rec?.portrait) || str(rec?.avatar);
}

/** Skill icon of a chess record (manifest `skills[iconId]`, else the empty skill sprite). */
