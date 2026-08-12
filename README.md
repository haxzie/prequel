# prequel

A macOS screen recorder and video editor. Electron shell over a native Rust
core built on ScreenCaptureKit, AVFoundation, VideoToolbox and Metal.

Record a screen, a window or a dragged region, with the webcam and both audio
sources alongside it. Stop, and an editor opens on the take: composite the
webcam over the screen against a background, cut, zoom, and export one MP4.

**Apple Silicon, macOS 14+.**

```
apps/
  desktop/    @prequel/desktop — Electron 43 + Vite 8 + React 19
  web/        @prequel/web — Next.js 16 marketing scaffold, not part of the product
packages/
  recorder/   @prequel/recorder — napi-rs addon, the only bridge from Node to Rust
  env/        @prequel/env — Zod-validated environment variables  ← edit src/env.ts
  typescript-config/  Shared tsconfig presets
crates/
  prequel-capture/    ScreenCaptureKit: permissions, targets, screen + audio recording
  prequel-camera/     AVFoundation: webcam enumeration and recording
  prequel-encode/     VideoToolbox via AVAssetWriter: H.264/HEVC and AAC to MP4
  prequel-session/    Timing, lifecycle and the manifest. No Apple frameworks.
  prequel-render/     Metal compositor and exporter
```

Every directory above has its own README describing what it owns and the traps
inside it.

## Getting started

```bash
pnpm install      # also creates .env from .env.example
pnpm build        # Rust addon first, then the apps
pnpm dev:desktop  # the recorder
```

You need the Rust toolchain (`rustup`, stable — the workspace is edition 2024
and needs 1.88+), Xcode Command Line Tools, Node 22+ and pnpm 11. `ffmpeg` and
`ffprobe` are needed only by the media tests.

Then grant Screen Recording — see below — or run with
`PREQUEL_FAKE_RECORDER=1`, which drives the whole UI with a stub recorder and
no grant at all.

| Command          | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `pnpm build`     | The Rust addon, then every app                       |
| `pnpm test`      | `cargo test --workspace`, then vitest                |
| `pnpm typecheck` | `tsc --noEmit` across both desktop tsconfig projects |
| `pnpm ship`      | Builds a `.dmg` and installs it to `/Applications`   |
| `pnpm format`    | Prettier over the repo                               |
| `pnpm clean`     | Removes build output                                 |

Turbo caches `build`, `test` and `typecheck`; `dev` is uncached and persistent.

**`cargo` is often absent from a non-interactive shell's `PATH`.** Prefix it
rather than concluding Rust is unavailable:

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test --workspace
PATH="$HOME/.cargo/bin:$PATH" cargo clippy --workspace --all-targets
```

Root `pnpm test` runs `cargo test` first and fails the same way for the same
reason.

**After changing Rust that JavaScript calls, rebuild the addon** or the change
is invisible — the committed `.node` is what Electron loads:

```bash
cd packages/recorder && PATH="$HOME/.cargo/bin:$PATH" pnpm build
```

`pnpm ship` does not do this for you. A stale `.node` is the explanation for
most "I fixed it in Rust and nothing changed" afternoons.

## Screen Recording permission

Capture needs the macOS Screen Recording grant. It is a **TCC permission, not
an entitlement** — no codesign flag turns it on, and macOS prompts at most once
per app.

In development the grant is attached to the Electron binary, so grant it once:

> System Settings ▸ Privacy & Security ▸ Screen Recording → enable **Electron**

then fully quit and relaunch. Without it, `listTargets()` fails with
`SCREEN_ACCESS_DENIED` (ScreenCaptureKit `SCStreamErrorDomain -3801`) and the
app shows a prompt to fix it.

Re-signing with a different identity silently revokes the grant, which is a
classic "it worked yesterday" bug.

Two things deliberately need **no** permission: the click tap that feeds
automatic zooms is listen-only and mouse-only, which macOS allows without Input
Monitoring; and the wallpaper is captured through the Screen Recording grant
the app already holds. Only the typing track wants Accessibility, and it is
absent rather than broken without it.

## Architecture

### Four files and a manifest, not one video

A take is `screen.mp4`, `camera.mp4`, `mic.m4a`, `system.m4a` and
`session.json`, side by side in one directory. The webcam is never composited
during capture.

That is what makes the bubble movable, resizable and reshapeable afterwards,
and it is why the layout is an editing decision rather than a recording one.
The cost is that something has to record how the four line up in time, which is
`session.json` — written by `prequel-session`, and the only place a track's
late start exists.

### Rust for capture and render, Electron for everything else

Electron's `desktopCapturer` + `MediaRecorder` cannot hit the quality bar:
software VP8/VP9 encoding, dropped frames above ~1080p60, no per-window capture
exclusion, and system-audio loopback that is broken on macOS 15+. So capture,
encode and export are Rust against the platform frameworks, and the shell is
Electron.

Everything crossing the napi boundary is plain data. Objective-C objects and
`CMSampleBuffer`s never reach JavaScript — the Node side sees descriptions of
things and commands to act on them.

### Geometry is computed once

`apps/desktop/src/shared/layout.ts` owns every position in the product.
`buildRenderPlan` emits a flat list of primitives in **absolute output pixels**;
the editor's WebGL preview draws that plan, and the Metal exporter rasterises
the same plan, deserialised through `crates/prequel-render/src/plan.rs`.

Neither side re-derives a position. Two implementations of "where does the
camera sit" is how a preview and an export come to disagree, and the
disagreement is only ever noticed after the file has been written. What can
still differ between the two rasterisers is antialiasing and gradient
interpolation — not whether the camera is in the right corner.

Animation is folded into the same idea. Cursor points, zoom motion tracks and
perspective quads are **sampled into the static plan** as keys, so both
rasterisers only interpolate numbers. Neither one knows what a zoom is.

### The export loop is driven by output frames

For each frame of the result, `prequel-render` asks what moment of the
recording belongs there and pulls each reader forward to it. Cuts, a 60 fps
screen against a 30 fps camera, frames dropped during capture and a camera that
opened late all fall out for free, and the output is constant-frame-rate —
which is what the preview assumes. Input-driven would need a resampler per
source and would still get cuts wrong.

### Audio is mixed by hand

A per-source multiply on `f32`, which is exactly what WebAudio's `GainNode`
does in the preview, so the two cannot diverge. `AVAudioMix`'s
per-asset-track model would have to be fought for per-slice gains and cuts, and
plain arithmetic is testable with two synthetic ramps and no file at all.

### Where state lives

Editor state lives in the renderer; recorder state lives in main. Not an
inconsistency: the dock is main-owned because several surfaces render it and
must never disagree. Nothing else in the app renders a slice list, and dragging
a slider is a 60 Hz stream of edits.

Values that change every frame — the playhead, the timecode, a meter level —
are written straight to the DOM and never through React state.

## Invariants that fail silently

Breaking any of these produces output that looks plausible and is wrong.

**Session media files are zero-based.** `VideoWriter` opens its session at the
first sample's PTS, so that sample becomes the origin. A track's late start —
the camera opening a few hundred ms after the screen — exists **only** in
`session.json`. Take the offset from the manifest and seek the file from zero;
subtracting a probed file start as well double-counts it. Pinned by
`crates/prequel-encode/tests/probes_a_late_track.rs`.

**Settings are flat leaves.** `cameraShape`, `cameraSize` — never a nested
`camera: {…}`. "Is this overridden?" is `key in overrides[section]`, and a
nested group would make that mean "something in this group", so every
per-control reset would silently be wrong.

**Geometry settings are fractions of the frame's shorter edge**, never pixels,
so a look survives 16:9 → 9:16.

## Testing

Test the invariant and the failure mode, not the implementation. The valuable
tests here assert properties: that a plan's geometry never leaves the frame,
that equal timestamps produce equal steps, that a cached layer's signature is
stable across frames.

Pure logic lives apart from Apple frameworks and React precisely so it can be
tested without them — `prequel-session`, `prequel-render`'s
`plan`/`timeline`/`mixer`, and the editor's `state`/`timeline`/`layout`/`fit`.

For anything visual, assert pixels. Shape assertions — duration, frame count,
dimensions — pass happily on output that looks wrong. See
`crates/prequel-render/tests/renders_the_right_pixels.rs`.

## Diagnostics

A packaged build has no console. `~/Library/Logs/Prequel/main.log` gets app
lifecycle, export progress, both `console.warn`/`console.error` from the
renderer (mirrored), and Rust `tracing` output. Reach it from the tray:
**Show Log in Finder**.

Prefer `console.warn`/`console.error` for anything a developer should also trip
over in `pnpm dev`; use `log()` for lifecycle breadcrumbs that would be noise
there.

## Environment variables

One `.env` at the repo root. Root scripts load it with `dotenv-cli` and Turbo
passes it down, so there are no per-app copies to keep in sync. Everything is
declared in **`packages/env/src/env.ts`** — see `packages/env/README.md` for
how to add one and what the validation guarantees.

## Conventions

**Every non-obvious decision carries a comment explaining the failure mode it
avoids**, usually naming the specific API or bug. Not what the code does — why
it is not the obvious thing.

```rust
// `AVAssetWriter` refuses a URL that already exists — error -11823 — rather
// than truncating. Without this, re-exporting fails every time after the
// first, which reads as a broken export rather than a stale file.
if path.exists() { std::fs::remove_file(path)?; }
```

There are **zero `TODO`/`FIXME` comments** in the tree. Comments and UI copy
use British spelling — colour, normalised, behaviour — consistently.

`AGENTS.md` at the root carries the same conventions in the form coding agents
read.
