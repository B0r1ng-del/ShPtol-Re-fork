/** Unity portraits use Y-up. Reflect the display container, not the rig: mirrored
 * world transforms corrupt NoRotationOrReflection face controls (Angelina alter).
 * Scope the setting synchronously so combat Spine instances keep their own convention.
 */
export function withAssistantCoordinates(P, fn) {
  const previous = P.spine.settings.yDown;
  P.spine.settings.yDown = false;
  try { return fn(); } finally { P.spine.settings.yDown = previous; }
}

export function createAssistantSpine(P, data) {
  const sp = withAssistantCoordinates(P, () => new P.spine.Spine(data));
  const update = sp.update;
  sp.update = function (dt) {
    return withAssistantCoordinates(P, () => update.call(this, dt));
  };
  return sp;
}

/** A transient fetch failure must not remain cached as a broken portrait. */
export async function loadAssistantSpine(P, src, alive = () => true) {
  const load = url => P.Assets.load({src:url,data:{spineAtlasFile:url.replace(/\.(?:skel|json)(?=\?|$)/,'.atlas')}});
  try { return await load(src); }
  catch (error) {
    if (!alive()) return null;
    if (!/Failed to fetch|NetworkError|ERR_NETWORK/.test(String(error))) throw error;
    return load(src + (src.includes('?') ? '&' : '?') + 'retry=1');
  }
}
