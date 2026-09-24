/**
 * Whether the preview has everything it draws with.
 *
 * Apart from the component because of the failure it exists to prevent. Every
 * clause here is a wait, and a wait that cannot end badly is not a wait but a
 * hang: a camera track that will not demux, or a background that is not on
 * disk, used to leave the editor on "Loading the recording…" for the life of
 * the window — timeline, panel and export all working, and the one thing the
 * user opened the app for never arriving, with nothing in any log to say why.
 *
 * So the inputs are *settled*, not *arrived*. Whoever reports them has to
 * report a failure as settled too — see `markDecoded` and `onSettled` in
 * `Editor.tsx`, which are called from `onError` as well as from `onLoadedData`
 * and `onload`.
 */
export interface ReadyInputs {
  /**
   * The video elements to wait for, by media key.
   *
   * The first take's only. Every take's elements are in the DOM at once, and a
   * recording extended twice would otherwise sit behind the loading screen
   * until footage nobody has scrolled to had buffered.
   */
  videoKinds: readonly string[];
  /** Whether the camera came with a person matte, which is a video of its own. */
  matte: boolean;
  /** Elements that have settled, whether they decoded or failed. */
  decoded: ReadonlySet<string>;
  /** Image paths the plan names. */
  wanted: readonly string[];
  /** Image paths that have settled, whether they loaded or failed for good. */
  settled: ReadonlySet<string>;
}

export function previewReady({
  videoKinds,
  matte,
  decoded,
  wanted,
  settled,
}: ReadyInputs): boolean {
  if (!videoKinds.every((kind) => decoded.has(kind))) return false;
  // Revealed before the mask has decoded, a cutout shows one frame of the
  // person as a bare rectangle.
  if (matte && !decoded.has("camera_matte:0")) return false;

  return wanted.every((path) => settled.has(path));
}
