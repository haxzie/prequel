/**
 * The wallpaper each demo stands its composition on.
 *
 * The app's own backgrounds — `monterey.jpg` and `sequoia.jpg`, two of the
 * wallpapers the picker ships — rather than a gradient invented for the site.
 * What the animations claim is that this is what the editor does to a
 * recording, and a stage nothing in the app can produce undercuts that in the
 * one place someone is deciding whether to download it.
 *
 * **One each, deliberately.** The two demos sit a screen apart and are read as
 * a pair, and on the same ground they read as one recording shown twice — which
 * is the opposite of the point, because the background is a choice from a
 * catalogue and two of them say so without a word of copy. They were the same
 * three-layer gradient literal written out twice before, which was both.
 *
 * Copies under `public/` rather than the hosted catalogue the app fetches: the
 * demos are decorative and below the fold, and pointing them at R2 puts part of
 * the landing page's paint behind a third-party request. Each is cut to
 * 2000×1125 and re-encoded — around a hundred kilobytes, and twice the widest
 * the card is ever drawn, which is what the zoom demo's supersample asks for.
 *
 * Not `next/image`: these are CSS backgrounds under animated elements, not
 * content, and both demos need one to cover a box whose shape their keyframes
 * change.
 */

/** Blue and orange, so the dark window floating on it has something to sit on. */
export const ZOOM_STAGE = "/sequoia.jpg";

/** The app's default background, under the two pictures as they re-frame. */
export const LAYOUT_STAGE = "/monterey.jpg";
