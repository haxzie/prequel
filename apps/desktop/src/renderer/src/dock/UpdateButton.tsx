import { useUpdate } from "../update/useUpdate";
import { UpdateIcon } from "./icons";

/**
 * The panel's one mention of a newer version.
 *
 * A menu-bar app is the app nobody quits, so the update window opens at launch
 * and then not again — and a launch was, for the sort of machine this runs on,
 * a fortnight ago. The panel is the surface the user actually opens, and until
 * this existed a version found by the check that runs when they open it had
 * nowhere to say so short of the tray menu, which nobody opens to look for
 * news.
 *
 * Absent rather than dimmed when there is nothing, the same call
 * `PermissionMenu` makes: a control that is permanently present and permanently
 * says "up to date" is one people stop reading.
 */
export function UpdateButton() {
  // `useUpdate` rather than a subscription written out here, for the reason it
  // exists: the percentage arrives many times a second while a hundred
  // megabytes come down, and a plain `useState` over the whole state would
  // re-render the panel — camera preview, level meter and all — on every chunk.
  // The refs it hands back go unused; there is no progress bar in a strip this
  // size.
  const { state } = useUpdate();

  // From the moment a version is found until it is installed. `checking` and
  // `error` are deliberately not here: neither is something the user asked for
  // from this window, and a panel that flickers a button in and out on a
  // background check is worse than one that waits until there is an answer.
  const pending =
    state.status === "available" || state.status === "downloading" || state.status === "ready";
  if (!pending) return null;

  const version = state.version ?? "A new version";

  return (
    <button
      type="button"
      // The panel is dragged by its background, so every control inside it opts
      // back out or pressing this moves the window instead.
      //
      // No divider before it, unlike every other group in the strip. Those
      // separate runs of bare icon buttons that would otherwise read as one
      // group; a filled pill with a word in it cannot be mistaken for a fourth
      // device control, and a rule beside it only adds a line to the panel.
      className={
        "no-drag flex h-[30px] flex-none items-center gap-1.5 rounded-lg bg-dock-selected px-2 " +
        "text-[11px] font-medium text-white hover:brightness-110 [&_svg]:size-[14px]"
      }
      title={
        state.status === "ready"
          ? `${version} is downloaded and installs on relaunch`
          : state.status === "downloading"
            ? `Downloading ${version}`
            : `${version} is available`
      }
      onClick={() => void window.prequel.update.open()}
    >
      <UpdateIcon />
      {/* The same word in all three states, on purpose. The panel sizes itself
          to its contents and reports that width to main, so a label that grew
          to "Downloading…" would animate the window wider and then narrower
          again while the user is trying to press something else. What each
          state actually means is in the tooltip, and in the window this
          opens. */}
      Update
    </button>
  );
}
