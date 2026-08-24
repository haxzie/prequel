import { useEffect } from "react";

import { cn } from "../lib/cn";
import { useUpdate, type UpdateShape } from "./useUpdate";

/**
 * The window that offers a newer version.
 *
 * Opened on launch while an update is pending, and from the tray at any time.
 * See `main/update.ts` for why the feed is Prequel's own API rather than
 * GitHub, and for the one failure this window cannot prevent: a build with no
 * Developer ID signature downloads an update happily and then cannot install
 * it, because Squirrel refuses a replacement that does not match what is
 * running. That is what the error state's button is for — it opens the download
 * page, which works whatever went wrong.
 */
export function Update() {
  const { state, barRef, labelRef } = useUpdate();

  // Escape closes, like every other dialog in the app. This one is a window
  // rather than an overlay, so it closes itself rather than telling a parent.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="editor-theme flex h-screen min-h-0 flex-col bg-editor-bg text-editor-fg">
      {/* The window is frameless past the traffic lights, so this strip is what
          it is dragged by. */}
      <header className="drag h-8 flex-none" />

      <main className="flex min-h-0 flex-1 flex-col gap-4 px-7">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-medium">{headline(state)}</h1>
          <p className="text-xs text-editor-muted">{detail(state)}</p>
        </div>

        <Notes state={state} />

        {state.status === "downloading" && (
          <div className="flex flex-none items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              {/* Scaled from the left rather than sized, and written straight to
                  the node — see useUpdate. */}
              <div
                ref={barRef}
                className="h-full origin-left rounded-full bg-white"
                style={{ transform: "scaleX(0)" }}
              />
            </div>
            <span
              ref={labelRef}
              className="w-9 text-right text-[11px] tabular-nums text-editor-muted"
            >
              0%
            </span>
          </div>
        )}
      </main>

      <footer className="flex flex-none items-center justify-end gap-2 px-7 pt-5 pb-7">
        <button
          type="button"
          className="rounded-lg px-3 py-2 text-xs text-editor-muted hover:text-editor-fg"
          onClick={() => window.close()}
        >
          {state.status === "ready" ? "Later" : "Close"}
        </button>
        <Action state={state} />
      </footer>
    </div>
  );
}

/** The one button that does something, in whichever form applies. */
function Action({ state }: { state: UpdateShape }) {
  const primary =
    "rounded-lg bg-white px-4 py-2 text-xs font-medium text-editor-bg hover:bg-white/90 disabled:opacity-40";

  switch (state.status) {
    case "available":
      return (
        <button
          type="button"
          className={primary}
          onClick={() => void window.prequel.update.download()}
        >
          Download {state.version}
        </button>
      );

    case "downloading":
      return (
        <button type="button" className={primary} disabled>
          Downloading…
        </button>
      );

    case "ready":
      // `install` quits the app. Nothing after this click renders again, which
      // is why the label promises the relaunch rather than just the install.
      return (
        <button
          type="button"
          className={primary}
          onClick={() => void window.prequel.update.install()}
        >
          Install and Relaunch
        </button>
      );

    case "error":
      // Falls through to the download page in main, because the most likely
      // cause is a build Squirrel can never replace.
      return (
        <button
          type="button"
          className={primary}
          onClick={() => void window.prequel.update.install()}
        >
          Download from the site
        </button>
      );

    default:
      return (
        <button
          type="button"
          className={primary}
          disabled={state.status === "checking"}
          onClick={() => void window.prequel.update.check()}
        >
          {state.status === "checking" ? "Checking…" : "Check Again"}
        </button>
      );
  }
}

/**
 * The release body.
 *
 * Plain text in a scrolling block rather than rendered markdown: the notes are
 * written by `--generate-notes`, which produces a list of commit subjects and
 * links, and a markdown renderer here would be a dependency and an injection
 * surface for the sake of turning `-` into a bullet.
 */
function Notes({ state }: { state: UpdateShape }) {
  if (state.status === "idle" || state.status === "checking") return <div className="flex-1" />;

  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto rounded-lg border border-editor-line bg-black/20 p-3",
        "text-[11px] leading-relaxed whitespace-pre-wrap text-editor-muted",
      )}
    >
      {state.notes ?? "Release notes aren't available for this version."}
    </div>
  );
}

function headline(state: UpdateShape): string {
  switch (state.status) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Prequel ${state.version} is available`;
    case "downloading":
      return `Downloading Prequel ${state.version}`;
    case "ready":
      return `Prequel ${state.version} is ready to install`;
    case "error":
      return "The update didn't finish";
    default:
      return "Prequel is up to date";
  }
}

function detail(state: UpdateShape): string {
  if (state.status === "error") {
    return state.message ?? "Download the latest version instead.";
  }
  if (state.status === "ready") {
    return "Prequel will close and come back in the menu bar.";
  }
  return `You're on ${state.current}.`;
}
