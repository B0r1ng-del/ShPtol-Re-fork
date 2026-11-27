// ui/presets.js — 预设 (owner:「给干员调配 干员持有 自选编队 都增加预设功能 … 迅速转换策略 切换预设
// 还有导出导入功能将皮肤和语音都带上」).
//
// 一个预设 = **一套完整的个人配置快照**:
//
//   loadout    干员调配   棋子的技能 / 模组选择
//   notOwned   干员持有   标记为"未持有"的棋子
//   diy        自选编队   四个槽位填了谁(技能 / 模组)
//   ops        潜能 / 练度  每个干员的 潜能 1–6 与 练度 0–3 (0.2.2; keyed by charId)
//   skins      皮肤       每个棋子的皮肤选择
//   voicePrefs 语音       每个干员钉的配音语言
//
// 为什么要六样一起:「迅速转换策略」的动机是**这一局的盟约被 ban 了** —— 那时候要换的不只是技能,而是整
// 套打法(带谁、自选谁、用什么皮肤)。只换一半等于把玩家留在半旧半新的状态,比不换更难理解。
// `ops` 尤其如此:它直接改数值(练度 ×ATK/×DEF/×HP),漏掉它会让"换了预设"看起来生效了、实际战力没变。
//
// 这一层是**纯数据**:读写 localStorage、快照、比对、序列化。UI 在 ui/presetPanel.js。
// 刻意不 import 任何 Preact / store 单例,所以能直接对着它写测试。

import { loadPref, savePref } from '../store.js';

/** 预设清单的存储键。 */
export const PRESETS_PREF = 'presets';
/** 快照格式版本:以后改结构时靠它决定还能不能读旧数据。 */
export const PRESET_VERSION = 1;
/** 一份分享码的上限(防止粘贴进来的东西把 localStorage 撑爆)。 */
export const PRESET_MAX_BYTES = 64 * 1024;
/** 预设名上限。 */
export const PRESET_NAME_MAX = 24;
/** 最多存多少个预设。 */
export const PRESET_MAX = 24;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** 名字清洗:去控制字符、压空白、截断。空名返回 null(调用方据此拒绝)。 */
export function cleanPresetName(name) {
  const s = [...String(name ?? '')]
    .filter((c) => { const n = c.codePointAt(0); return n >= 32 && n !== 127; })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.slice(0, PRESET_NAME_MAX) : null;
}

/** 一个能当 id 用的短串。不用 crypto.randomUUID:老 Safari 上它不存在。 */
function newId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  } catch { /* ignore */ }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}


/**
 * 把一份快照洗成**只含合法形状**的:所有键都是字符串,值是对象/数组。
 *
 * 不过滤内容(某个棋子存不存在是数据层的事,由调用方配合 lookup 决定),只保证**形状**可用 ——
 * 一个结构错乱的 preset 不该让整个面板崩掉。
 *
 * `ops` 缺省为 `{}`:0.2.2 之前存的预设(或别的构建导出的文件)没有这个键,读进来就是"没有养成设置",
 * 而不是让整份快照作废。
 * @param {any} snap
 */
export function sanitizeSnapshot(snap) {
  const s = isObj(snap) ? snap : {};
  const obj = (v) => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => typeof k === 'string' && k)) : {});
  return {
    loadout: obj(s.loadout),
    notOwned: Array.isArray(s.notOwned) ? s.notOwned.filter((x) => typeof x === 'string' && x) : [],
    diy: obj(s.diy),
    ops: obj(s.ops),
    skins: obj(s.skins),
    voicePrefs: obj(s.voicePrefs),
  };
}

/**
 * 读预设清单。读不出来就给空清单 —— 一个坏掉的 localStorage 不该让界面打不开。
 * @returns {{ id: string, name: string, at: number, snap: any }[]}
 */
export function readPresets() {
  let raw = null;
  try { raw = loadPref(PRESETS_PREF, null); } catch { return []; }
  const list = Array.isArray(raw?.list) ? raw.list : (Array.isArray(raw) ? raw : []);
  const out = [];
  for (const p of list) {
    if (!isObj(p)) continue;
    const name = cleanPresetName(p.name);
    if (!name) continue;
    out.push({
      id: typeof p.id === 'string' && p.id ? p.id : newId(),
      name,
      at: Number.isFinite(p.at) ? p.at : 0,
      snap: sanitizeSnapshot(p.snap),
    });
    if (out.length >= PRESET_MAX) break;
  }
  return out;
}

/** 写预设清单。写失败(配额 / 隐私模式)返回 false,调用方据此提示。 */
export function writePresets(list) {
  /*
   * 非对象条目直接丢掉再处理。之前这里直接 `p.id`,于是一个 `null` 混进数组就抛 TypeError ——
   * 而"写清单"是保存/删除预设的必经之路,它炸了等于整个预设功能不可用。
   * 清理函数的入口不该假定调用方给的是干净的。
   */
  const src = (Array.isArray(list) ? list : []).filter(isObj);
  const clean = src.slice(0, PRESET_MAX).map((p) => ({
    id: String(p.id || newId()).slice(0, 32),
    name: cleanPresetName(p.name) || '未命名',
    at: Number.isFinite(p.at) ? p.at : 0,
    snap: sanitizeSnapshot(p.snap),
  }));
  try { savePref(PRESETS_PREF, { v: PRESET_VERSION, list: clean }); return true; } catch { return false; }
}

/**
 * 一份快照里"有内容"的项。用来把"这个预设是空的"和"这个预设改了 3 项"区分开 ——
 * 保存一个空预设没有意义,界面上要能说清楚。
 * @param {any} snap
 * @returns {{ loadout: number, notOwned: number, diy: number, ops: number, skins: number, voicePrefs: number, total: number }}
 */
export function snapshotCounts(snap) {
  const s = sanitizeSnapshot(snap);
  const c = {
    loadout: Object.keys(s.loadout).length,
    notOwned: s.notOwned.length,
    diy: Object.keys(s.diy).length,
    ops: Object.keys(s.ops).length,
    skins: Object.keys(s.skins).length,
    voicePrefs: Object.keys(s.voicePrefs).length,
  };
  return { ...c, total: c.loadout + c.notOwned + c.diy + c.ops + c.skins + c.voicePrefs };
}

/**
 * 两个快照是否相同(用于"当前配置 = 某个预设"的高亮)。
 * 逐项深比较:这些值都是小对象/字符串,JSON 比较在这里既够快又不会漏。
 * @param {any} a @param {any} b
 */
export function sameSnapshot(a, b) {
  const x = sanitizeSnapshot(a);
  const y = sanitizeSnapshot(b);
  const key = (v) => JSON.stringify(Object.entries(v).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)));
  return key(x.loadout) === key(y.loadout)
    && JSON.stringify(x.notOwned.slice().sort()) === JSON.stringify(y.notOwned.slice().sort())
    && key(x.diy) === key(y.diy)
    && key(x.ops) === key(y.ops)
    && key(x.skins) === key(y.skins)
    && key(x.voicePrefs) === key(y.voicePrefs);
}

// ---------------------------------------------------------------------------------------------------
// 分享码:整份预设 → 一个可粘贴的字符串
// ---------------------------------------------------------------------------------------------------

/** `sp1:` + base64url(JSON)。前缀让"这串东西是什么"一眼可辨,也留了换格式的余地。 */
const SHARE_PREFIX = 'sp1:';

/** UTF-8 → base64url(不用 btoa(JSON.stringify()):非 ASCII 的预设名会把它炸掉)。 */
function toB64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * 导出成一个分享码。
 * @param {{ name?: string, snap: any }} preset
 * @returns {string}
 */
export function serializePreset(preset) {
  const payload = {
    v: PRESET_VERSION,
    n: cleanPresetName(preset?.name) || '未命名',
    s: sanitizeSnapshot(preset?.snap),
  };
  return SHARE_PREFIX + toB64Url(JSON.stringify(payload));
}

/**
 * 解析一个分享码。
 * @param {string} input
 * @returns {{ ok: true, name: string, snap: any, counts: any } | { ok: false, error: string }}
 */
export function parsePreset(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'empty' };
  if (raw.length > PRESET_MAX_BYTES) return { ok: false, error: 'too large' };
  if (!raw.startsWith(SHARE_PREFIX)) return { ok: false, error: 'not a preset code' };
  let json = null;
  try { json = fromB64Url(raw.slice(SHARE_PREFIX.length)); } catch { return { ok: false, error: 'bad encoding' }; }
  let obj = null;
  try { obj = JSON.parse(json); } catch { return { ok: false, error: 'bad json' }; }
  if (!isObj(obj)) return { ok: false, error: 'bad payload' };
  if (obj.v !== PRESET_VERSION) return { ok: false, error: 'version ' + String(obj.v) };
  const name = cleanPresetName(obj.n);
  if (!name) return { ok: false, error: 'no name' };
  const snap = sanitizeSnapshot(obj.s);
  const counts = snapshotCounts(snap);
  // 一个什么都没有的码:与其导入一个空预设,不如直接说清楚
  if (!counts.total) return { ok: false, error: 'empty preset' };
  return { ok: true, name, snap, counts };
}

/**
 * 取一个预设的完整导出载荷(给 JSON 文件下载用 —— 分享码是给人贴的,文件是给人备份的)。
 * @param {{ name: string, at?: number, snap: any }} preset
 */
export function presetFilePayload(preset) {
  return {
    kind: 'stronghold-preset',
    v: PRESET_VERSION,
    name: cleanPresetName(preset?.name) || '未命名',
    at: Number.isFinite(preset?.at) ? preset.at : Date.now(),
    snap: sanitizeSnapshot(preset?.snap),
  };
}

/**
 * 从文件载荷里读一个预设(接受 `presetFilePayload` 的形状,也接受裸快照)。
 * @param {any} obj
 * @returns {{ ok: true, name: string, snap: any } | { ok: false, error: string }}
 */
export function parsePresetFile(obj) {
  if (!isObj(obj)) return { ok: false, error: 'bad payload' };
  // 也接受分享码字符串(有人把码存进 .txt 再拖进来)
  if (typeof obj === 'string') return parsePreset(obj);
  if (obj.kind !== 'stronghold-preset') return { ok: false, error: 'not a preset file' };
  if (obj.v !== PRESET_VERSION) return { ok: false, error: 'version ' + String(obj.v) };
  const name = cleanPresetName(obj.name) || '导入的预设';
  return { ok: true, name, snap: sanitizeSnapshot(obj.snap) };
}

/** 文件名:stronghold-preset-<名字>-<日期>.json(名字里的路径字符要清掉)。 */
export function presetFilename(name, now = new Date()) {
  const safe = String(cleanPresetName(name) || 'preset').replace(/[\\/:*?"<>|]/g, '');
  const p = (n) => String(n).padStart(2, '0');
  return `stronghold-preset-${safe}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}
