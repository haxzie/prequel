# Working in this repo

A macOS screen recorder and video editor: Electron shell, native Rust capture
core (ScreenCaptureKit, AVFoundation, VideoToolbox, Metal). Apple Silicon,
macOS 14+. Plus a public site and a shared library people can send links to —
`apps/web` on Vercel, `apps/api` as a Cloudflare Worker.

`README.md` covers layout, setup, env vars and the Screen Recording grant. This
file covers what the code does not say out loud — the conventions, and the
mistakes that compile, pass review, and fail silently at runtime.

## Commands

```bash
pnpm typecheck                      # every package
pnpm --filter @prequel/desktop test  # vitest
pnpm --filter @prequel/api test      # vitest, inside workerd
pnpm --filter @prequel/desktop package   # .dmg into apps/desktop/release

PATH="$HOME/.cargo/bin:$PATH" cargo test --workspace
PATH="$HOME/.cargo/bin:$PATH" cargo clippy --workspace --all-targets
```

`cargo` is often not on `PATH` in a non-interactive shell — prefix it rather
than concluding Rust is unavailable.

The npm scripts that shell out to it already do. `napi build` runs
`cargo metadata` itself, so prefixing the command you type never reached it and
`pnpm dev` died on `Internal Error: cargo metadata failed to run` for anyone
whose shell adds `~/.cargo/bin` in `.zshrc` rather than somewhere a spawned
shell reads. `packages/recorder`'s `build` and the root `test:rust` set `PATH`
themselves for that reason. A bare `cargo` typed into a non-interactive shell
still needs the prefix.

Media tests shell out to `ffmpeg`/`ffprobe`. `PREQUEL_FAKE_RECORDER=1` drives
the whole UI with no Screen Recording grant.

After changing Rust that JavaScript calls, rebuild the addon or the change is
invisible: `cd packages/recorder && PATH="$HOME/.cargo/bin:$PATH" pnpm build`.

After changing `packages/db`, regenerate and apply the migration or D1 still has
the old schema: `pnpm --filter @prequel/db generate && pnpm --filter @prequel/api
migrate`.

## House style

**Every non-obvious decision carries a comment explaining the failure mode it
avoids**, usually naming the specific API or bug. Not what the code does — why
it is not the obvious thing.

```rust
// `AVAssetWriter` refuses a URL that already exists — error -11823 — rather
// than truncating. Without this, re-exporting fails every time after the
// first, which reads as a broken export rather than a stale file.
if path.exists() { std::fs::remove_file(path)?; }
```

Match the surrounding density. Read `dock/DeviceMenu.tsx`,
`crates/prequel-capture/src/recorder.rs` and `crates/prequel-session/src/clock.rs`
before writing much — a file without these comments reads as foreign here.

There are **zero `TODO`/`FIXME` comments** in the tree. Do not introduce the
first: either fix it or say so in your reply.

Comments and UI copy use British spelling — colour, normalised, behaviour —
consistently. Keep sentences short and state things plainly; the existing
comments do not hedge.

## Invariants that fail silently

These are the ones that cost real debugging time. Breaking any of them produces
output that looks plausible and is wrong.

**Session media files are zero-based.** `VideoWriter` opens its session at the
first sample's PTS, so that sample becomes the origin. A track's late start —
the camera opens a few hundred ms after the screen — exists **only** in
`session.json`. Take the offset from the manifest and seek the file from zero.
Subtracting a probed file start as well double-counts it. Pinned by
`crates/prequel-encode/tests/probes_a_late_track.rs`.

**Geometry is computed once, in `apps/desktop/src/shared/layout.ts`.**
`buildRenderPlan` emits absolute output pixels; the canvas preview draws that
plan and the Rust exporter rasterises the same plan. Never re-derive a position
on either side. Two implementations of "where does the camera sit" is how a
preview and an export come to disagree, and it is only ever noticed after the
file is written.

**Settings are flat leaves.** `cameraShape`, `cameraSize` — never a nested
`camera: {…}`. "Is this overridden?" is `key in overrides[section]`, and a
nested group would make that mean "something in this group", so every
per-control reset would silently be wrong.

**Geometry settings are fractions of the frame's shorter edge**, never pixels,
so a look survives 16:9 → 9:16.

**Editor state lives in the renderer; recorder state lives in main.** Not an
inconsistency: the dock is main-owned because several surfaces render it and
must never disagree. Nothing else renders a slice list, and dragging a slider is
a 60 Hz stream of edits.

## Platform traps

**asar.** `nativeImage.createFromPath` is native code and cannot read through
asar — an icon inside the archive loads empty. Empty tray image + `LSUIElement`
= no way to quit the app. Anything read by a native API needs `asarUnpack`.

**`AVAssetWriter` refuses an existing file** (-11823). Remove before writing.

**`CVMetalTextureCache`** hands back a wrapper that must outlive the
`MTLTexture`, and the texture is a _view_ onto the pixel buffer, not a copy.
Keep both alive or it samples nothing. Buffers it wraps must be created
IOSurface-backed and Metal-compatible; a plain `cv::PixelBuf::new` is not.

**cidre 0.20** has sharp edges worth knowing before reaching for an API:
no `CIFilter`, no `CGImageSource`; `ci` needs `mtl` enabled or it fails to
compile inside cidre itself; `AVAssetReader`/`set_time_range` are fully bound
and are the cut primitive.

**Quitting.** `LSUIElement: true` means no Dock icon and no app menu, and
`window-all-closed` is deliberately empty. The tray is the only quit path.
`SIGTERM`/`SIGINT` are handled in `main/index.ts`; without that, `kill -9` is
the only option and it skips teardown.

## Renderer performance

The editor runs a `requestAnimationFrame` loop driving four media elements and a
canvas. Three rules, each learned from a visible bug:

- **Use the rAF callback's timestamp, not `performance.now()`.** The argument is
  the frame's presentation time and is evenly spaced; `performance.now()` inside
  the callback is when the callback ran. Sampling on an uneven clock while
  painting on an even one is judder.
- **Animate `transform`, never `left`.** And never read `scrollWidth`/
  `clientWidth` in the loop — cache them. A layout read next to a layout write
  thrashes every frame.
- **Never size a canvas to the output resolution.** Size it to what is on screen
  × devicePixelRatio. Percentage `max-height` resolves to `none` through an
  indefinite flex/grid chain, and the canvas then lays out at its intrinsic size
  and is clipped.

Values that change per frame are written straight to the DOM — `textContent`, a
CSS custom property, `style.transform` — never through React state.

## Styling

Tailwind v4, one entry at `apps/desktop/src/renderer/src/index.css`. Tokens are
CSS variables mapped through `@theme inline`, so the existing
`prefers-color-scheme` block keeps working with no `dark:` variants and scoped
palettes (`dock-theme`, `editor-theme`) resolve at the use site.

Custom utilities exist for what Tailwind has no equivalent of: `drag`/`no-drag`
(`-webkit-app-region` — get one wrong and a control moves the window instead of
activating), `squircle`, `meter-fill`, `cursor-blade`/`cursor-erase`.

Do not name a colour token so it collides with a Tailwind namespace — `--clip-*`
would generate `bg-clip-fill`, which lives in `background-clip`'s namespace.

## Testing

Test the invariant and the failure mode, not the implementation. The valuable
tests here assert properties: that a plan's geometry never leaves the frame,
that equal timestamps produce equal steps, that a cached layer's signature is
stable across frames.

Pure logic lives apart from Apple frameworks and React precisely so it can be
tested without them — `prequel-session`, `prequel-render`'s `plan`/`timeline`/
`mixer`, and the editor's `state`/`timeline`/`layout`/`fit`.

For anything visual, assert pixels. Shape assertions — duration, frame count,
dimensions — pass happily on output that looks wrong. See
`crates/prequel-render/tests/renders_the_right_pixels.rs`.

## Diagnostics

A packaged build has no console. `~/Library/Logs/Prequel/main.log` gets app
lifecycle, export progress, and both `console.warn`/`console.error` (mirrored)
and Rust `tracing` output. Reach it from the tray: **Show Log in Finder**.

Prefer `console.warn`/`console.error` for anything a developer should also trip
over in `pnpm dev`; use `log()` for lifecycle breadcrumbs that would be noise
there.

## The three apps, and what may not cross between them

`apps/desktop` is the product. `apps/web` is the public site and the dashboard.
`apps/api` is every API either of them calls, as one Cloudflare Worker.

**`apps/web` shares no code with `apps/desktop`** — no imports across the
boundary, and in particular nothing from `shared/layout.ts`. The editor mock on
the landing page is a picture drawn in CSS, and giving the real geometry module a
marketing consumer would be a second reason for it to change.

**`apps/api` is under the same rule.** `apps/web` may import its request and
response types; the desktop app hand-rolls its small client in `main/`. A shared
contract package spanning all three would be exactly the second reason to change
`shared/` that the rule above exists to prevent. The HTTP endpoints are the
contract.

**Every remote call the desktop app makes lives in `main/`**, resolved through
`main/api.ts`. Not a convention — the renderer's CSP is
`connect-src 'self' prequel-media:`, so a window physically cannot reach the
network. A `fetch` added to a renderer file fails at runtime, in a packaged build,
with a console the user does not have.

**A bearer token never crosses to a renderer.** `auth.json` lives in main and the
renderer only ever sees a redacted `AuthState`. The same reasoning put the
install id in its own file rather than on `RecordingPreferences`, which is
broadcast to every window inside `DockState` — the note in
`main/transcribe/install-id.ts` spells it out.

### Note on `apps/web`

The site's Tailwind is v4 through **PostCSS**, not the Vite plugin desktop uses, and
`experimental.turbopackLocalPostcssConfig` is what makes Turbopack find the
config in this workspace at all. Unstyled pages and no error is that flag.
`apps/web/README.md` has the rest.

`apps/web/AGENTS.md` is generated and re-added by `next dev`. Do not hand-edit
it; committing it alongside your work is the way to keep the tree clean.
