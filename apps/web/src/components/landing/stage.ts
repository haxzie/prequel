/**
 * The wallpaper each demo stands its composition on.
 *
 * The app's own backgrounds, three of the wallpapers the picker ships, rather
 * than a gradient invented for the site.
 * What the animations claim is that this is what the editor does to a
 * recording, and a stage nothing in the app can produce undercuts that in the
 * one place someone is deciding whether to download it.
 *
 * **One each, deliberately.** The demos sit a screen apart and are read as a
 * run, and on the same ground they read as one recording shown three times, which
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

/** A cut-glass facet, under the two pictures as they re-frame. */
export const LAYOUT_STAGE = "/facet.jpg";

/**
 * A soft peony, under the words.
 *
 * The captions demo puts a line of text across the bottom of its frame, which
 * is the one place a stage has to earn its keep here: the second beat is a
 * plate arriving behind the words, and a plate is only a visible change of
 * setting where there is something behind it to cover.
 */
export const CAPTIONS_STAGE = "/peony.jpg";

/**
 * The recording each demo is showing, as a picture rather than a drawing.
 *
 * The layouts demo and the captions demo both re-frame a screen recording, and
 * both drew a generic application window in CSS to stand in for one. A drawn
 * window is a diagram: it says "a screen recording would go here" where a real
 * capture says "this is what the tool does to your work".
 *
 * Two different captures, for the reason the two demos stand on two different
 * wallpapers. The layouts demo re-frames a stream, where a camera beside the
 * screen is the whole point, and the captions demo puts words under a checkout
 * somebody is walking through.
 *
 * 1400px wide, which is twice the widest either box is drawn at. Neither demo
 * magnifies its picture the way the zoom demo does, so there is nothing here
 * for the extra pixels of a 2000px asset to buy.
 */
export const LAYOUT_SCREEN = "/screen-stream.jpg";
export const CAPTIONS_SCREEN = "/screen-checkout.jpg";
