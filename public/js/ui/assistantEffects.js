import { FxLibrary } from '../render/vfx/library.js';
import { Effect, compileEffect } from '../render/vfx/effect.js';
import { FxGL } from '../render/vfx/gl.js';
import { FrameData, cameraBasis } from '../render/vfx/geom.js';
import { resetPixi } from '../render/vfx/system.js';

const RENDERERS = ['particleSystem','particleSystemRenderer','meshRenderer','meshFilter','skinnedMeshRenderer','trailRenderer','lineRenderer'];

// A one-particle mask/glow is a continuous surface, not expendable decoration.
export function isPortraitSurface(ps) {
  const rate=ps?.raw?.EmissionModule?.rateOverTime, life=ps?.raw?.InitialModule?.startLifetime;
  return !!ps?.looping && typeof rate==='number' && typeof life==='number' && rate>0 && rate*life<=2;
}

export function budgetPortraitSystems(def,budget=Infinity) {
 const systems=def.ps.filter(Boolean),cap=Math.max(1,Math.floor(budget/Math.max(1,systems.length)));
 for(const ps of systems){
  const surface=isPortraitSurface(ps);
  if(Number.isFinite(budget)){ps.maxParticles=Math.min(ps.maxParticles,Math.max(surface?2:1,cap));if(!surface)ps.prewarm=false;}
  // Allow the replacement quad while float32 age retirement is one tick behind.
  if(surface)ps.maxParticles=Math.max(2,ps.maxParticles);
 }
}

/** Select authored action roots; keep transforms for children and bone followers. */
export function portraitActionDescriptor(source, action) {
  const desc = structuredClone(source);
  // The food sheet also contains a cactus. Use its authored pastry tile for
  // the held snack while preserving the native dissolve and movement.
  if (desc.key === 'char_1041_angel2') {
    for (const n of desc.nodes) if (n.name === 'Food_lizi_01' && n.particleSystem?.UVModule) {
      n.particleSystem.UVModule.frameOverTime = 0;
      n.particleSystem.UVModule.startFrame = 0;
    }
  }
  const roots = new Map();
  for (const n of desc.nodes) for (const b of n.behaviours || []) {
    for (const row of b.fields?._particles || []) if (row.particle?.node != null) roots.set(row.particle.node, row.action);
  }
  const owner = [];
  for (const n of desc.nodes) {
    owner[n.id] = roots.has(n.id) ? roots.get(n.id) : owner[n.parent];
    // Unregistered content is the always-on backdrop. Do not duplicate it on interaction.
    const keep = owner[n.id] === action || (action === 0 && owner[n.id] == null);
    if (!keep) for (const key of RENDERERS) delete n[key];
    if (roots.has(n.id) && keep) n.active = true;
    if ((n.behaviours || []).some(b => b.class === 'BoneFollower' && b.fields?.followXYPosition)) n.parent = 0;
  }
  // Editor placement is unrelated to the user's chosen assistant placement.
  desc.nodes[0].pos = [0, 0, 0];
  desc.nodes[0].rot = [0, 0, 0, 1];
  desc.nodes[0].scale = [1, 1, 1];
  return desc;
}

/** Authored portrait effects share the assistant's GL context and draw on both sides of Spine. */
export class AssistantEffects {
  constructor(P, app, spine, key, { lite = false, particleBudget = Infinity } = {}) {
    this.P = P; this.app = app; this.spine = spine; this.key = key; this.lite = lite;
    this.particleBudget = particleBudget;
    this.lib = new FxLibrary({ listUrl: '/assets/lobby/native/files.json?v=held1' });
    this.dead = false; this.effects = []; this.defs = new Map(); this.frame = 0; this.time = 0;
    this.fd = new FrameData(); this.vp = new Float32Array(16); this.items = [[], []];
    this.glr = null; this.layers = []; this.prepared = -1;
  }
  async init() {
    if (this.app.renderer.context.webGLVersion !== 2) return false;
    await this.lib.init();
    const source = await this.lib.descriptor(this.key);
    if (!source || this.dead) return false;
    await Promise.all(source.meshes.map(k => this.lib.loadMesh(k)));
    if (this.dead) return false;
    for (const action of [0, 3]) {
      const def = compileEffect(portraitActionDescriptor(source, action), this.lib);
      budgetPortraitSystems(def,this.particleBudget);
      def.isLoop = action === 0;
      this.defs.set(action, def);
    }
    this.followers = source.nodes.flatMap(n => (n.behaviours || []).filter(b => b.class === 'BoneFollower').map(b => ({ node: n.id, ...b.fields, bone:this.spine.skeleton.findBone(b.fields.boneName) })));
    const owner = this;
    class Layer extends this.P.Container { constructor(pass) { super(); this.pass = pass; } _render(renderer) { owner.render(this.pass, renderer); } }
    this.layers = [new Layer(0), new Layer(1)];
    this.app.stage.addChildAt(this.layers[0], 0); this.app.stage.addChild(this.layers[1]);
    this.play(0);
    this.tick = () => {
      const dt = Math.min(.05, this.app.ticker.deltaMS / 1000);
      this.time += dt; this.frame++;
      for (const fx of this.effects) fx.update(dt);
      this.effects = this.effects.filter(fx => !fx.done);
    };
    this.app.ticker.add(this.tick);
    return true;
  }
  play(action) {
    const def = this.defs.get(action);
    if (!def || this.dead) return;
    if (action === 3) {
      for (const fx of this.effects) if (fx.data === 3) fx.kill();
    }
    const fx = new Effect(def, { lib: this.lib, lite: this.lite, seed: 109 });
    for(const system of fx.sys) if(system&&isPortraitSurface(system.def)) system.emissionScale=1;
    fx.data = action;
    if (action === 3) fx.ttl = this.spine.spineData.animations.find(a => /^interact$/i.test(a.name))?.duration || 10;
    fx.track = () => {
      for (const follow of this.followers) {
        const bone = follow.bone;
        if (!bone) continue;
        const o = follow.node * 10, m = bone.matrix;
        // BoneFollower nodes are authored under the illustration root.
        // Parent-local transforms are preserved for other node types.
        if (def.parent[follow.node] !== 0) continue;
        if (follow.followXYPosition) { fx.loc[o] = m.tx * .01; fx.loc[o + 1] = m.ty * .01; }
        if (follow.followBoneRotation) {
          const angle = Math.atan2(m.b, m.a) / 2;
          fx.loc[o + 3] = 0; fx.loc[o + 4] = 0; fx.loc[o + 5] = Math.sin(angle); fx.loc[o + 6] = Math.cos(angle);
        }
      }
    };
    fx.update(0); this.effects.push(fx); this.prepared = -1;
  }
  render(pass, renderer) {
    if (this.dead || !this.effects.length) return;
    renderer.batch.flush();
    try {
      this.glr ||= new FxGL(renderer.gl, this.lib);
      if (this.prepared !== this.frame) {
        const w = renderer.screen.width, h = renderer.screen.height, scale = this.spine.scale.x * 100;
        const vp = this.vp; vp.fill(0); vp[0] = 2 * scale / w; vp[5] = 2 * scale / h; vp[10] = -.01; vp[15] = 1;
        vp[12] = this.spine.x * 2 / w - 1; vp[13] = 1 - this.spine.y * 2 / h;
        const cam = cameraBasis(0, [0, 0, -100], h, 2 * Math.atan(h / (200 * scale)));
        this.fd.reset(); this.items[0].length = this.items[1].length = 0;
        for (const fx of this.effects) fx.collect(cam, this.fd, item => {
          const z = fx.world[item.node]?.[14] || 0;
          this.items[item.order < 0 || (item.order === 0 && z >= 0) ? 0 : 1].push(item);
        }, this.frame);
        for (const items of this.items) items.sort((a,b) => a.layer-b.layer || a.order-b.order || a.queue-b.queue || b.dist-a.dist);
        this.glr.upload(this.fd); this.prepared = this.frame;
      }
      this.glr.draw(this.items[pass], { vp: this.vp, cam: [0, 0, -100], time: this.time, half: this.lite, pass: this.frame * 2 + pass });
    } catch (error) {
      if (!this.failed) console.warn('[assistant effects]', error);
      this.failed = true;
      this.effects.forEach(fx => fx.kill()); this.effects = [];
    } finally { resetPixi(renderer); }
  }
  stopInteraction() {
    for(const fx of this.effects)if(fx.data===3)fx.kill();
    this.effects=this.effects.filter(fx=>fx.data!==3);this.prepared=-1;
  }
  destroy() {
    this.dead = true;
    if (this.tick) this.app.ticker.remove(this.tick);
    for (const fx of this.effects) fx.kill();
    this.effects = [];
    for (const layer of this.layers) { layer.parent?.removeChild(layer); layer.destroy(); }
    this.layers=[];
    this.glr?.destroy(); this.lib.dropImages();
  }
}
