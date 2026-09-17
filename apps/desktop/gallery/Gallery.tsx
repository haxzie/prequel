import { Suspense, useEffect, useState, type ReactNode } from "react";

import {
  DOCK_HEADROOM,
  PANEL_HEIGHT,
  PANEL_INSET,
  TELEPROMPTER_WIDTHS,
  teleprompterHeight,
} from "../src/shared/contract";
import { TooltipLayer } from "../src/renderer/src/components/Tooltip";
import { assetUrl } from "./media-url";
import { SHOTS, type Shot, type ShotFrameKind } from "./shots";

/**
 * The gallery's two views: a list of every shot, and one shot on its own.
 *
 * Hash routes, like the renderer's own `Root`: `#/` lists, `#/shot/<id>`
 * renders one. The capture script only ever opens the second; the first is for
 * a person checking a shot in a normal browser before automating it.
 */
export function Gallery() {
  const route = useHash();
  const match = /^#\/shot\/([^/]+)$/.exec(route);

  if (!match) return <Index />;

  const shot = SHOTS.find((candidate) => candidate.id === match[1]);
  if (!shot) return <p className="p-6 text-white">Unknown shot: {match[1]}</p>;

  return <ShotView key={shot.id} shot={shot} />;
}

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function Index() {
  return (
    <div className="min-h-full bg-[#101114] p-8 text-white">
      <h1 className="text-lg font-medium">Prequel gallery</h1>
      <p className="mt-1 text-sm text-white/60">
        Each link renders one shot the way <code>scripts/shoot-docs.mjs</code> captures it.
      </p>
      <ul className="mt-6 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {SHOTS.map((shot) => (
          <li key={shot.id}>
            <a
              href={`#/shot/${shot.id}`}
              className="block rounded-md px-3 py-2 font-mono text-[13px] text-white/80 hover:bg-white/10"
            >
              {shot.id}
              <span className="ml-2 text-white/40">{shot.frame}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The sizes of the app's windows, from `src/main/windows/*.ts`.
 *
 * A screenshot of a window is a screenshot of a window *at its size*: the
 * editor lays out its panel and timeline for these numbers, and a shot taken
 * at the browser's size would show a shape the app never has.
 */
const WINDOW: Record<Exclude<ShotFrameKind, "dock" | "dock-transparent" | "bare" | "island">, { width: number; height: number }> = {
  workspace: { width: 1280, height: 820 },
  welcome: { width: 720, height: 520 },
};

function ShotView({ shot }: { shot: Shot }) {
  // A fresh bridge per shot: the shot's own fixtures, and no listeners left
  // over from the last one. Installed before anything below renders — the
  // first hook in any of these components calls `window.prequel` on mount.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void shot.install().then(() => setReady(true));
  }, [shot]);

  if (!ready) return null;

  return (
    <ShotFrame kind={shot.frame}>
      <Suspense fallback={null}>{shot.render()}</Suspense>
      <TooltipLayer />
    </ShotFrame>
  );
}

/**
 * What macOS puts around a window, drawn here because there is no macOS.
 *
 * Three of the app's surfaces are vibrant — `bg-editor-glass` at 0.75 alpha
 * over an `NSVisualEffectView` — and against a bare page they read as
 * washed-out grey. A wallpaper behind them gives the material something to be
 * made of. The dock and the camera bubble are transparent windows with a
 * shadow cast into a margin, which the column here reproduces with the same
 * constants `main.tsx` publishes.
 */
function ShotFrame({ kind, children }: { kind: ShotFrameKind; children: ReactNode }) {
  if (kind === "bare") {
    return <div className="grid min-h-full place-items-center p-10">{children}</div>;
  }

  const wallpaper = { backgroundImage: `url(${assetUrl("monterey.jpg")})` };

  if (kind === "island") {
    // The top of a 14" MacBook Pro display: the wallpaper, the menu bar's
    // band, and the notch cut out of the top edge — the bezel the island is
    // drawn to merge with. The column is the island's window, as main sizes
    // it: the panel plus its inset on the sides and the bottom, flush at the
    // top.
    const notch = { height: 37, width: 200 };
    return (
      <div className="relative overflow-hidden bg-cover bg-top" style={{ ...wallpaper, width: 900, height: 300 }}>
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-[10px] bg-black"
          style={{ width: notch.width, height: notch.height }}
        />
        <div
          data-shot-frame
          className="absolute top-0 left-1/2 -translate-x-1/2"
          style={{
            width: TELEPROMPTER_WIDTHS.normal + PANEL_INSET * 2,
            height: teleprompterHeight("medium", notch.height) + PANEL_INSET,
          }}
        >
          {children}
        </div>
      </div>
    );
  }

  if (kind === "dock" || kind === "dock-transparent") {
    return (
      <div
        className={kind === "dock" ? "grid min-h-full place-items-center bg-cover bg-center p-16" : "grid place-items-start"}
        style={kind === "dock" ? wallpaper : undefined}
      >
        {/* `#root` in the app is a flex column the panel takes `flex-1` of;
            the height here is the window's, so the pill comes out at
            `PANEL_HEIGHT`. `w-max` because the setup row is sized to its
            contents and reports that to main; there is no main to resize the
            window, so the column simply is as wide as the row. */}
        <div
          data-shot-frame
          className="flex w-max flex-col"
          style={{ height: PANEL_HEIGHT + DOCK_HEADROOM + PANEL_INSET }}
        >
          {children}
        </div>
      </div>
    );
  }

  const size = WINDOW[kind];
  return (
    <div className="grid min-h-full place-items-center bg-cover bg-center p-16" style={wallpaper}>
      <div
        data-shot-frame
        className="relative flex flex-col overflow-hidden rounded-[10px] shadow-[0_30px_80px_rgba(0,0,0,0.45)] ring-1 ring-white/10"
        style={{ width: size.width, height: size.height }}
      >
        {/* Traffic lights, in the space the app's own header leaves for them
            (`titleBarStyle: hidden` puts the real ones here). */}
        <div className="pointer-events-none absolute top-[14px] left-[14px] z-50 flex gap-2">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        {children}
      </div>
    </div>
  );
}
