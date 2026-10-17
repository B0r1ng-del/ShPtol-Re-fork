// 雷姆必拓 fixed cards reuse their native operator kits; only the garrison traits differ, so each file is a thin
// re-export of the native 自选 kit under the `chess_rem_*_a` id the expansion's data layer assigns
// (`tools/rem-data.mjs` REM_ADDITIONS). Loaded through `content/index.js` like the other expansions' registries, and
// kept out of `kits/index.js` KIT_FILES so a room without the pack still resolves the same registry as before.
import aprl from './ops/chess_rem_aprl-aprl.js';
import asbest from './ops/chess_rem_asbest-asbest.js';
import glider from './ops/chess_rem_glider-glider.js';
import jcinta from './ops/chess_rem_jcinta-jcinta.js';
import ray from './ops/chess_rem_ray-ray.js';
import savage from './ops/chess_rem_savage-savage.js';
import thumpy from './ops/chess_rem_thumpy-thumpy.js';
import tmslot from './ops/chess_rem_tmslot-tmslot.js';
import warmy from './ops/chess_rem_warmy-warmy.js';

export default {
  ...aprl, ...asbest, ...glider, ...jcinta, ...ray, ...savage, ...thumpy, ...tmslot, ...warmy,
};
