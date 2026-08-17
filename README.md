# prequel

A macOS screen recorder and video editor. Electron shell over a native Rust
core built on ScreenCaptureKit, AVFoundation, VideoToolbox and Metal.

Record a screen, a window or a dragged region, with the webcam and both audio
sources alongside it. Stop, and an editor opens on the take: composite the
webcam over the screen against a background, cut, zoom, and export an MP4 or a
GIF.

**Apple Silicon, macOS 14+.**

```
apps/
  desktop/    @prequel/desktop — Electron 43 + Vite 8 + React 19
  web/        @prequel/web — Next.js 16 + Tailwind v4, the public site
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

The app asks for this itself: a launch with no Screen Recording grant opens the
welcome window (`renderer/src/welcome/`) instead of the panel, which walks
through all four permissions one at a time. It opens on a first run, and on any
run where the grant is still missing — a recorder that produces nothing reads as
broken rather than as unpermitted. `main/permissions.ts` is where the four are
asked for, and why two of them can only be granted in System Settings.

In development the grant is attached to the Electron binary, so grant it once:

> System Settings ▸ Privacy & Security ▸ Screen Recording → enable **Electron**

then fully quit and relaunch. Without it, `listTargets()` fails with
`SCREEN_ACCESS_DENIED` (ScreenCaptureKit `SCStreamErrorDomain -3801`) and the
app shows a prompt to fix it.

Re-signing with a different identity silently revokes the grant, which is a
classic "it worked yesterday" bug.

The wallpaper is captured through the Screen Recording grant the app already
holds, and needs nothing of its own.

**The click tap does need a grant**, which this said for a long time that it did
not. `CGEventTapCreate` succeeds for an untrusted process and hands back a tap
that only ever sees events aimed at Prequel itself — so a recording comes back
with one or two clicks instead of none, nothing is logged by the system, and the
automatic zooms are simply thin. Grant **Accessibility** and **Input
Monitoring** alongside Screen Recording. The recorder now warns when it starts a
tap it does not expect to receive anything, and `stop` logs
`captured N clicks (M pressed, K tap disables)` — an `M` far below what you
actually did is this, not a bug in the editor.

The typing track wants Accessibility too, and is absent rather than broken
without it.

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

One loop writes every format. MP4 goes to `AVAssetWriter` and GIF to a CPU
quantiser, but both take the same composited frame from the same loop —
splitting them would mean two copies of the reader handling, the cut handling
and the cancellation checks, and the moment those drift an edit exports
correctly as one format and wrongly as the other.

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

## Continuous integration and releases

Two workflows, both on `macos-15` for the parts that need it — the capture core
is ScreenCaptureKit, AVFoundation and Metal, so nothing but the formatting check
builds anywhere else.

**`.github/workflows/ci.yml`** runs on every push to `main` and every pull
request: `format:check` on Linux for a fast failure, then build, typecheck,
`vitest` and `cargo test`/`cargo clippy` on macOS. Two things about it are worth
knowing rather than discovering:

- The live capture tests are turned off with `PREQUEL_NO_LIVE_CAPTURE`. A hosted
  runner does hold the Screen Recording grant and does offer a display, so they
  do not skip on their own — they run against a paravirtualised 1024px display
  that is not Retina and cannot sustain a frame rate, and fail on both. The Metal
  golden-pixel renders do get a GPU there and run normally.
- Clippy runs **without** `-D warnings`, because two warnings already stand in
  `prequel-capture` — two `extern` declarations that disagree with the SDK's own
  signatures. Fix those and the flag becomes worth adding.

**`.github/workflows/build.yml`** packages the app. It runs on pushes to `main`,
on `v*` tags, and on demand from the Actions tab — deliberately **not** on pull
requests, where a 100 MB disk image per push buys nothing the checks do not
already cover. Every run uploads the `.dmg` and `.zip` as an artifact kept for
two weeks, so a build of `main` can be downloaded without cutting a release.

### Cutting a release

The version comes from `apps/desktop/package.json`, not from the tag — so the
order matters:

```bash
# 1. Bump the version and commit it.
npm --prefix apps/desktop version 0.2.0 --no-git-tag-version
git commit -am "Release 0.2.0"

# 2. Tag that commit and push both.
git tag v0.2.0
git push origin main --follow-tags
```

The workflow refuses a tag whose version disagrees with the package, because the
alternative is a release full of files named after the _previous_ version — which
looks exactly like the wrong build was published and cannot be told apart from
one. It then creates the GitHub release with notes generated from the commits
since the last tag.

**Nothing CI publishes is signed.** The config asks for a signed, notarised build
— `hardenedRuntime: true`, `notarize: true`, and no pinned `identity` so
electron-builder finds whichever Developer ID is in the keychain — but a runner
holds no certificate, and `build.yml` sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so
it does not go looking. Its artifacts are ad-hoc signed, which macOS quarantines
on anyone else's machine.

A machine with no certificate is not a broken build: electron-builder logs
`skipped macOS application code signing … 0 identities found` and produces an
unsigned `.dmg` anyway.

### Signing locally

Needs an Apple Developer Program membership and a **Developer ID Application**
certificate — not "Apple Development", which only runs locally, and not "Mac App
Distribution", which is App Store only. Xcode → Settings → Accounts → Manage
Certificates → **+** installs one into the login keychain. Check it took:

```bash
security find-identity -v -p codesigning   # want: Developer ID Application: … (TEAMID)
```

Notarisation needs separate credentials. Create an App Store Connect API key
(Users and Access → Integrations → Keys) and keep the `.p8` outside the repo:

```bash
export APPLE_API_KEY=~/keys/AuthKey_XXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

pnpm --filter @prequel/desktop package     # slow: notarisation is a round trip to Apple
```

`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` works too, and
`APPLE_KEYCHAIN`/`APPLE_KEYCHAIN_PROFILE` if the credentials are already stored by
`notarytool`. Then check the result, where the ticket is the part signing alone
does not give you:

```bash
APP=apps/desktop/release/mac-arm64/Prequel.app
codesign -dv --verbose=4 "$APP"   # Authority: Developer ID Application, flags include runtime
xcrun stapler validate "$APP"     # the notarisation ticket
spctl -a -vvv -t install "$APP"   # accepted, source=Notarized Developer ID
```

One side effect worth having: TCC keys the Screen Recording grant to the bundle's
signature, and an ad-hoc signature changes on every build — which is why macOS
asks again after each `pnpm ship`. A stable Developer ID makes it ask once.

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
