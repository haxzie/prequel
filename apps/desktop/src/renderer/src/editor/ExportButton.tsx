import { ExportIcon } from "./icons";

/**
 * The way into an export.
 *
 * Only a button: the options, the progress and the finished file all live in
 * `ExportDialog`. It reported progress here too for a while, which meant an
 * export had two places to be watched and they had to agree — and the title bar
 * is the wrong one of the two, because it has no room for the file at the end.
 *
 * Closing the dialog mid-render still leaves the export running; pressing this
 * again brings it back with its progress where it left off.
 */
export function ExportButton({ onOpen }: { onOpen: () => void }) {
  return (
    // Green, and the only colour in the title bar: this is the button the whole
    // window exists to lead to, and it should be findable without being read.
    // White on it rather than the panel's near-black, which on a mid-green is
    // the pair that fails contrast.
    <button
      type="button"
      className="no-drag flex items-center gap-1.5 rounded-lg bg-export px-3 py-1.5 text-[11px] font-medium text-white hover:brightness-110 [&_svg]:size-3.5"
      onClick={onOpen}
    >
      <ExportIcon />
      Export
    </button>
  );
}
