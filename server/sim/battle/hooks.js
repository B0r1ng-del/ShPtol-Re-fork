// server/sim/battle/hooks.js — Battle methods: the hook bus (on / off / offOwner / emit, the MAX_HOOK_DEPTH guard and
// its chain diagnostics), the timers (after / every, run at the start of each tick) and the isolation of content
// callbacks (_safe, _handlerError: a failing handler is skipped and counted; repeated engine errors end the battle as a
// timeout).
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { TICK, MAX_INTERNAL_ERRORS, MAX_HOOK_DEPTH } from '../constants.js';
import { captureKazdelCallback } from '../kazdelOrigin.js';
import { packCallAllowed, callBudgetOwner } from '../../../shared/callBudget.js';

let hookSeq = 0;

let schedSeq = 0;

export class BattleHooks {
  // =============================================================================================================
  // 调用预算（`pack.json.callBudget`, DESIGN §35.52）

  /**
   * 当前正在跑的是哪个包的 install(battle)（`installContent` 在调用它之前压、之后弹）。
   *
   * 为什么需要这一段作用域：包装进来的那一刻，它 `on` / `every` / `addBuff` 挂的东西**本来没有身份** —— 它们只是
   * 「某个回调」。预算要按**插件**记账（「每局每插件 8000 次」），回滚要撤掉**这个包**的全部 hook / 计时器 / buff，
   * 所以这两个身份都必须在**注册的那一刻**就烙上去，而不是事后从调用栈里猜。
   * @type {{ id: string, max: number, owner: string } | null}
   */
  _packScope = null;
  /** 包 id → 已用次数。只有声明过 `callBudget` 的包才在这本账上（`installContent` 只对它们开口子）。 */
  _packCalls = null;

  /**
   * 在 `fn` 里执行一个包的 `install(battle)`：这期间它注册的每一个 hook / 计时器都带上 `pack` 身份，`addBuff` 标的
   * buff 也带同一个标记。`max` 为 null ⇒ 这个包**没声明预算**，只烙身份、不记账（行为与从前逐字节相同）。
   *
   * 可重入（一个包的 install 里装另一个包的情形不存在，但嵌套不会破）：作用域是栈式保存的。
   * @template T
   * @param {{ id: string, callBudget?: number|null }} installer
   * @param {() => T} fn
   * @returns {T}
   */
  _withPackScope(installer, fn) {
    const prev = this._packScope;
    const id = installer && typeof installer.id === 'string' && installer.id ? installer.id : null;
    const max = installer && Number.isInteger(installer.callBudget) ? installer.callBudget : null;
    this._packScope = id ? { id, max, owner: callBudgetOwner(id) } : null;
    if (id) {
      this._packScopes ??= new Map();
      this._packScopes.set(id, { id, max, owner: callBudgetOwner(id) });
    }
    try { return fn(); } finally { this._packScope = prev; }
  }

  /**
   * 花掉一次预算。返回 false = **这次不许跑**（预算耗尽），调用方必须跳过这次回调。
   *
   * 记账规则（DESIGN §35.52）：`max` 是可用次数 —— 第 `max` 次仍放行，第 `max + 1` 次不放行并触发回滚。
   * 计数按插件聚合：它的 hook、它排的计时器、它标的 buff 的 `onTick` / `onExpire` 记在同一本账上。
   * @param {{ max: number, owner: string, id: string }} scope
   * @returns {boolean}
   */
  _spendCall(scope) {
    if (!this._packCalls) this._packCalls = new Map();
    const used = this._packCalls.get(scope.id) || 0;
    if (!packCallAllowed(used, scope.max)) {
      // 超了：回滚整个包，并记一笔**点名到插件 id** 的错（作者在日志里 grep `plugin:` 就知道是谁被停了）。
      this._rollbackPack(scope);
      return false;
    }
    this._packCalls.set(scope.id, used + 1);
    return true;
  }

  /**
   * 撤掉一个包的一切：它的 hook、它排的计时器（`after` / `every`）、它标的 buff，然后记一笔错。
   * 幂等 —— 已经回滚过的包再来一次只是再记一笔之前先查一下（`_rolledBack`）。
   * @param {{ max: number, owner: string, id: string }} scope
   */
  _rollbackPack(scope) {
    this._rolledBack ??= new Set();
    if (this._rolledBack.has(scope.id)) return;
    this._rolledBack.add(scope.id);
    this._offPack(scope.id);
    // 这个包标的 buff：标记写在 buff 对象上（`addBuff` 在包作用域里盖的 `pack` 章）。
    for (const u of this.units || []) {
      if (!u || !Array.isArray(u.buffs)) continue;
      for (let i = u.buffs.length - 1; i >= 0; i--) if (u.buffs[i] && u.buffs[i].pack === scope.id) u.buffs.splice(i, 1);
    }
    this._handlerError(scope.owner, scope.id, new Error(
      `plugin "${scope.id}" exhausted its per-battle call budget (${scope.max} calls): its hooks, timers and marked buffs were rolled back`));
  }

  /**
   * 撤掉一个包**全部**的 hook 与计时器 —— 按 `pack` 章，不按 `owner`（后者属于调用方，`offOwner` 的地盘）。
   * @param {string} id
   */
  _offPack(id) {
    for (const name of Object.keys(this._hooks)) {
      const list = this._hooks[name];
      for (let i = list.length - 1; i >= 0; i--) if (list[i].pack === id) { list[i].removed = true; list.splice(i, 1); }
      if (!list.length) delete this._hooks[name];
    }
    for (const s of this._sched) if (s.pack === id) s.cancelled = true;
  }

  // =============================================================================================================
  // hook bus

  on(name, fn, opts = {}) {
    if (typeof fn !== 'function') return null;
    const scope = this._packScope;
    // ★ `owner` 的语义一个字不动（它属于调用方：一个单位、`lpMeter`、一个引擎模块 —— `offOwner(unit)` 靠它清扫）。
    //   包的身份走**另一格** `pack`：预算记账与回滚按它来。把 owner 借给包 id 会让 `offOwner(unit)` 撤错东西。
    const h = { name, fn, priority: Number(opts.priority) || 0, owner: opts.owner ?? null, seq: ++hookSeq, removed: false, once: !!opts.once, ...(scope ? { pack: scope.id } : {}) };
    const list = this._hooks[name] ?? (this._hooks[name] = []);
    let i = list.length;
    while (i > 0 && list[i - 1].priority < h.priority) i--; // loop-cap: hook list length
    list.splice(i, 0, h);
    return h;
  }

  off(nameOrHandle, fn) {
    if (nameOrHandle && typeof nameOrHandle === 'object') {
      const h = nameOrHandle;
      h.removed = true;
      const list = this._hooks[h.name];
      if (list) {
        const i = list.indexOf(h);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) delete this._hooks[h.name];
      }
      return;
    }
    const list = this._hooks[nameOrHandle];
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) if (!fn || list[i].fn === fn) { list[i].removed = true; list.splice(i, 1); }
    if (!list.length) delete this._hooks[nameOrHandle];
  }

  /** Remove every hook and scheduled callback registered with `owner`. */
  offOwner(owner) {
    for (const name of Object.keys(this._hooks)) {
      const list = this._hooks[name];
      for (let i = list.length - 1; i >= 0; i--) if (list[i].owner === owner) { list[i].removed = true; list.splice(i, 1); }
      if (!list.length) delete this._hooks[name];
    }
    for (const s of this._sched) if (s.owner === owner) s.cancelled = true;
  }

  hasHook(name) { return !!this._hooks[name]; }

  /**
   * 一个包 id 的预算作用域（`{ id, max, owner }`），没声明过预算 ⇒ null（不记账）。
   *
   * 账本在 `_packScopes` 里：`_withPackScope` 在装机那一刻把「这个包这一局的上限」记下来，之后每个回调都按包 id
   * 取回它 —— 这样 hook / 计时器 / buff 三条路径读的是**同一个** max，不会各算一份。
   * @param {string} id
   */
  _packBudgetOf(id) {
    const s = this._packScopes?.get(id);
    return s && s.max != null ? s : null;
  }

  emit(name, ctx) {
    const list = this._hooks[name];
    if (!list) return ctx;
    // Recursion guard: handlers that re-trigger their own event (damaged → dealDamage → damaged …) would otherwise
    // recurse until a stack overflow, whose depth (and thus the outcome) depends on the machine — not deterministic.
    if (this._emitDepth >= MAX_HOOK_DEPTH) {
      this._handlerError(`hookDepth:${name}`, null, new Error(`hook nesting deeper than ${MAX_HOOK_DEPTH}; handlers skipped — ${this._chain(name)}`));
      return ctx;
    }
    const arr = list.length === 1 ? [list[0]] : list.slice();
    const d = this._emitDepth++;
    this._frameCtx[d] = ctx;
    try {
      for (const h of arr) {
        if (h.removed) continue;
        // 调用预算（`pack.json.callBudget`, DESIGN §35.52）：一个包的 hook 每被调一次就花掉一次预算。
        // 没有 `pack` 章的就是第一方内容（它们不记账，行为与从前逐字节相同）。
        // ★ 回调本身也在**包的作用域**里跑：包在 install 里往往只注册回调，真正的 buff 是第一个 tick 才标的 ——
        //   不在作用域里跑，它标的 buff 就没有包章，回滚时撤不掉（撤了 hook 却留下 buff，等于只回滚了一半）。
        const p = h.pack ? this._packBudgetOf(h.pack) : null;
        if (p && !this._spendCall(p)) continue;   // 预算耗尽 ⇒ 这次跳过，别的事件照跑
        this._frameName[d] = name;
        this._frameOwner[d] = h.owner;
        const run = () => { try { h.fn(ctx, this); } catch (e) { this._handlerError(`hook:${name}`, h.owner, e); } };
        if (p) this._withPackScope({ id: p.id, callBudget: p.max }, run); else run();
        if (h.once) this.off(h);
        if (ctx && ctx.stopPropagation) break;
      }
    } finally {
      this._emitDepth--;
    }
    return ctx;
  }

  /**
   * The open hook/callback frames (outermost first) — names the loop when the nesting guard trips, e.g.
   * "chain: hit(enemy_1430_lrrook) > damaged(chess_char_3_18_a) > hit(enemy_1430_lrrook) > … > damaged".
   */
  _chain(last) {
    const id = (u) => (u && typeof u === 'object' ? (u.defId ?? u.name ?? '?') : u == null ? '' : String(u));
    const lab = (i) => {
      const o = this._frameOwner[i];
      let who = id(o);
      const c = this._frameCtx[i];
      if (!who && c && typeof c === 'object') { // global handler: show the units of the event instead
        const a = c.source ?? c.attacker ?? c.killer ?? null, t = c.target ?? c.unit ?? c.victim ?? c.enemy ?? null;
        who = a || t ? `${id(a)}→${id(t)}` : '';
      }
      return `${this._frameName[i]}${who ? `(${who})` : ''}`;
    };
    const n = this._emitDepth;
    const parts = [];
    for (let i = 0; i < Math.min(n, 4); i++) parts.push(lab(i));
    if (n > 12) parts.push('…');
    for (let i = Math.max(4, n - 8); i < n; i++) parts.push(lab(i));
    parts.push(last);
    return `chain: ${parts.join(' > ')}`;
  }

  // =============================================================================================================
  // scheduling

  after(seconds, fn, opts = {}) {
    const scope = this._packScope;
    const s = { due: this.time + Math.max(0, Number(seconds) || 0), fn: captureKazdelCallback(this, fn), owner: opts.owner ?? null, interval: 0, seq: ++schedSeq, cancelled: false, holdsBattle: !!opts.holdsBattle, ...(scope ? { pack: scope.id } : {}) };
    s.cancel = () => { s.cancelled = true; };
    this._sched.push(s);
    return s;
  }

  every(seconds, fn, opts = {}) {
    const iv = Math.max(TICK, Number(seconds) || TICK);
    const scope = this._packScope;
    const s = { due: this.time + (opts.immediate ? 0 : iv), fn: captureKazdelCallback(this, fn), owner: opts.owner ?? null, interval: iv, seq: ++schedSeq, cancelled: false, count: 0, holdsBattle: false, ...(scope ? { pack: scope.id } : {}) };
    s.cancel = () => { s.cancelled = true; };
    this._sched.push(s);
    return s;
  }

  _runScheduled() {
    if (!this._sched.length) return;
    const now = this.time + 1e-9;
    let due = this._sched.filter((s) => !s.cancelled && s.due <= now);
    if (!due.length) { if (this._sched.some((s) => s.cancelled)) this._sched = this._sched.filter((s) => !s.cancelled); return; }
    due.sort((a, b) => a.due - b.due || a.seq - b.seq);
    for (const s of due) {
      if (s.cancelled) continue;
      // 调用预算：包排的计时器每响一次也花一次（与它的 hook 记在同一本账上，DESIGN §35.52）
      if (s.pack) {
        const p = this._packBudgetOf(s.pack);
        if (p && !this._spendCall(p)) { s.cancelled = true; continue; }
      }
      if (s.interval > 0) {
        let n = 0;
        while (s.due <= now && !s.cancelled && n++ < 8) { // loop-cap: battle.every at most 8 per tick
          s.count++;
          this._safe(() => s.fn(this, s), 'every', s.owner);
          s.due += s.interval;
        }
        if (s.due <= now) s.due = this.time + s.interval;
      } else {
        s.cancelled = true;
        this._safe(() => s.fn(this, s), 'after', s.owner);
      }
    }
    this._sched = this._sched.filter((s) => !s.cancelled);
  }

  // =============================================================================================================
  // callback isolation and errors

  /** Run a content callback (skill/buff/projectile/timer/install) isolated from errors; shares the hook depth guard. */
  _safe(fn, label, owner = null) {
    if (this._emitDepth >= MAX_HOOK_DEPTH) {
      this._handlerError(`hookDepth:${label}`, owner, new Error(`callback nesting deeper than ${MAX_HOOK_DEPTH}; skipped — ${this._chain(label)}`));
      return undefined;
    }
    const d = this._emitDepth++;
    this._frameName[d] = label;
    this._frameOwner[d] = owner;
    this._frameCtx[d] = null;
    try { return fn(); } catch (e) { this._handlerError(label, owner, e); return undefined; } finally { this._emitDepth--; }
  }

  _handlerError(label, owner, e, internal = false) {
    this.errorCount++;
    const who = owner && owner.defId ? owner.defId : (owner && owner.name) || '';
    const key = `${label}|${who}|${e && e.message}`;
    if (!this._errKeys.has(key)) {
      this._errKeys.add(key);
      if (this.errors.length < 100) this.errors.push({ label, who, message: String(e && e.message), stack: e && e.stack });
      if (this.opts.quiet !== true) this.logger.error?.(`[sim] ${label}${who ? ' (' + who + ')' : ''} failed: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    }
    // Content handler errors are isolated (the handler is skipped, the battle continues). Repeated *engine*
    // errors mean the field state is suspect: force-end it as a timeout (DESIGN §11).
    if (internal) {
      this.internalErrorCount = (this.internalErrorCount ?? 0) + 1;
      if (this.internalErrorCount > MAX_INTERNAL_ERRORS && !this.finished && !this._forcing) {
        this._forcing = true;
        try { this.forceEnd('timeout'); } catch { this._hardFinish('timeout'); }
      }
    }
  }

  _internalError(label, e) { this._handlerError('internal:' + label, null, e, true); }
}
