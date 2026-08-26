# @prequel/desktop

The Electron application: the recorder dock, the selection overlays, the camera
bubble and the video editor.

```bash
pnpm --filter @prequel/desktop dev        # electron-vite dev, HMR in every window
pnpm --filter @prequel/desktop test       # vitest
pnpm --filter @prequel/desktop typecheck  # both tsconfig projects
pnpm --filter @prequel/desktop package    # .dmg into ./release
pnpm --filter @prequel/desktop ship       # package, then install to /Applications
```

## Layout

```
src/
  main/       Electron main: windows, IPC, the capture flow, projects, export
  preload/    The contextBridge surface. The only thing the renderer can call.
  renderer/   React. Four views, one bundle.
  shared/     Pure modules imported by both sides. No electron, no node, no DOM.
```

`src/shared` is the load-bearing directory. `layout.ts`, `project.ts`,
`presets.ts`, `manifest.ts` and `autoedit.ts` are pure TypeScript with no
imports from `electron` or `node:`, which is what lets Vitest run them under
the node environment with no harness at all.

### Windows

Every window loads the same bundle and picks its view from the location hash —
one entry point keeps electron-vite's dev server and HMR working identically
for all four.

| Route        | Window                                                           |
| ------------ | ---------------------------------------------------------------- |
| `/dock`      | The floating recorder panel. Main owns its state.                |
| `/selection` | One transparent overlay per display, for picking what to record. |
| `/camera`    | The webcam bubble, shown while recording.                        |
| `/editor`    | The editor. One window per recording directory.                  |

`LSUIElement: true` — no Dock icon and no app menu while only the recorder is
open, and `window-all-closed` is deliberately empty. **The tray is the only
quit path.** `SIGTERM`/`SIGINT` are handled in `main/index.ts`; without that,
`kill -9` is the only option and it skips teardown. The Dock icon is shown for
the first editor window and hidden again with the last, or Cmd-Tab is wrong.

### Media in the renderer

Recordings are read through the `prequel-media://` privileged scheme,
registered at module scope **before** `whenReady` — a hard requirement of
`registerSchemesAsPrivileged`. `stream: true` is the privilege that matters:
without it Chromium issues no range requests and `<video>` cannot seek.

`main/media-protocol.ts` resolves every path against the recordings directory
and rejects anything outside it. The URL is fully renderer-controlled, so the
traversal guard is not decoration.

It also sets CORS headers, and every media element and image sets
`crossOrigin="anonymous"`. Without that pair, `createMediaElementSource` yields
silence and WebGL throws `SecurityError` on `texImage2D` — both of which look
like something else entirely.

## The editor

`editor/webgl.ts` composites the preview; it mirrors
`crates/prequel-render/src/shaders.metal` uniform for uniform. Both consume the
`RenderPlan` that `shared/layout.ts` produces, in absolute output pixels.
Neither re-derives a position — see the architecture section of the root
README for why that is the central rule of this codebase.

`editor/canvas.ts` is the earlier 2D rasteriser of the same plan. WebGL
replaced it because tilt and progressive blur have no canvas equivalent; it is
kept as a third independent reading of the plan to check the other two against.

### Renderer performance

The editor runs a `requestAnimationFrame` loop driving four media elements and
a canvas. Three rules, each learned from a visible bug:

- **Use the rAF callback's timestamp, not `performance.now()`.** The argument
  is the frame's presentation time and is evenly spaced; `performance.now()`
  inside the callback is when the callback ran. Sampling on an uneven clock
  while painting on an even one is judder.
- **Animate `transform`, never `left`.** And never read
  `scrollWidth`/`clientWidth` in the loop — cache them. A layout read next to a
  layout write thrashes every frame.
- **Never size a canvas to the output resolution.** Size it to what is on
  screen × `devicePixelRatio`. A percentage `max-height` resolves to `none`
  through an indefinite flex/grid chain, and the canvas then lays out at its
  intrinsic size and is clipped.

Values that change per frame are written straight to the DOM — `textContent`, a
CSS custom property, `style.transform` — never through React state.

## Styling

Tailwind v4, one entry at `src/renderer/src/index.css`. Tokens are CSS
variables mapped through `@theme inline`, so the existing `prefers-color-scheme`
block keeps working with no `dark:` variants, and scoped palettes
(`dock-theme`, `editor-theme`) resolve at the use site.

Custom utilities exist for what Tailwind has no equivalent of: `drag`/`no-drag`
(`-webkit-app-region` — get one wrong and a control moves the window instead of
activating), `squircle`, `meter-fill`, `cursor-blade`/`cursor-erase`.

Do not name a colour token so it collides with a Tailwind namespace —
`--clip-*` would generate `bg-clip-fill`, which lives in `background-clip`'s
namespace.

## Packaging

`asar` is the trap. `nativeImage.createFromPath` is native code and cannot read
through the archive, so an icon inside it loads empty — and an empty tray image
under `LSUIElement` leaves no way to quit the app. **Anything read by a native
API needs `asarUnpack`.**

`scripts/` generates the assets that ship: `make-app-icon.mjs` (full-bleed, no
macOS-added padding), `make-tray-icons.mjs` and `make-cursor.mjs` (the pointer
styles, each with its own hotspot).
