// Display rate cap for the field renderer (render/app.js).
//
// 设置「帧率上限」 is a PREFERENCE OF THE PAGE, not a rule of the game: it only decides how often PIXI's Ticker may
// DRAW a frame. The battle simulation runs on its own fixed clock (server/sim, 30 Hz x GAME_SPEED) and is advanced by
// the same ticker callback either way, so a capped frame rate can never change what happens in a match — it changes how
// many pictures of it you get. That is the whole reason this is allowed to live in the renderer at all.
//
// Why a ceiling at all: the browser already syncs the ticker to the display (requestAnimationFrame), so the useful
// ceilings are the ones at or below the panel refresh rate — 60 on a 60 Hz laptop saves nothing but is harmless, and
// on a 144/240 Hz panel a 60 cap is the difference between a warm GPU and a cool one. 'off' is the default because a
// ceiling above the panel rate can only lose frames, and a ceiling below it is a decision the player makes on purpose.
//
// The mapping is deliberately total: anything unrecognised (an older profile without the key, a hand-edited value, a
// future label this build does not know) resolves to 0 = no cap. A dirty settings file must never be able to freeze the
// screen, and 'no cap' is the behaviour every build before this one had. [ASSUMED the labels; settings.FRAME_RATES owns
// the values and sanitizeSettings already rejects anything outside them.]

/** The selectable ceilings, in the order the settings panel shows them. Mirrors FRAME_RATES in ui/gameLogic/settings.js. */
export const FRAME_RATE_CHOICES = Object.freeze(['60', '120', '240', 'off']);

/** PIXI Ticker.maxFPS meaning: draw as fast as the display will show me. */
export const NO_CAP = 0;

/**
 * A settings value -> PIXI Ticker.maxFPS.
 *
 * Returns NO_CAP (0) for 'off' and for every value this function does not recognise, so the failure mode of a bad
 * input is 'same as before this setting existed' rather than a stalled renderer.
 *
 * @param {unknown} rate the stored preference: '60' | '120' | '240' | 'off'
 * @returns {number} a positive integer ceiling, or 0 for no cap
 */
export function frameRateCap(rate) {
  // Membership, not parsing. The panel writes one of the four labels and nothing else, so any other string (a padded
  // ' 60 ', a decimal '59.9', hex, a label from a future build) can only come from a hand-edited profile. Parsing those
  // would be inventing a policy for inputs that cannot legitimately exist; refusing them keeps the accepted set exactly
  // equal to settings.FRAME_RATES and the same set sanitizeSettings already enforces.
  return FRAME_RATE_CHOICES.includes(rate) && rate !== 'off' ? Number(rate) : NO_CAP;
}

/**
 * Whether a settings change needs the ticker touched at all.
 *
 * setSettings runs on every settings broadcast, and most of those do not mention the frame rate. Reassigning
 * maxFPS is cheap but it is not free — PIXI validates it and may restart its timing on the next tick — so the caller
 * only writes when this says so.
 *
 * @param {unknown} incoming the value from the broadcast
 * @param {unknown} current the value the ticker was built with
 * @returns {boolean}
 */
export function frameRateChanged(incoming, current) {
  if (typeof incoming !== 'string') return false;
  return frameRateCap(incoming) !== frameRateCap(current);
}
