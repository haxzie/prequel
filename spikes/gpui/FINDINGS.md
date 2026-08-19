# GPUI spike — findings

Live document. Written as things land, so the decision is made against recorded
facts rather than a recollection of how it felt.

Status: **proof 1 passes.** One compositor can feed both the preview and the
export, at 4K, with no per-frame copy — but `gpui::surface()` needed a format
adapter that upstream does not provide.

---

## ✅ The pixel-buffer bridge is a pointer cast, not a copy

The premise proof 1 rests on. Checked by reading both crates, then by compiling:

|                  |                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cidre            | `cv::PixelBuf = cv::ImageBuf = cv::Buf`, and `define_cf_type!` makes `Buf` a `#[repr(transparent)]` newtype over `cf::Type`. A `&cv::PixelBuf` **is** the CF pointer. |
| core-video 0.4.3 | `CVPixelBufferRef = CVImageBufferRef = CVBufferRef = *mut __CVBuffer`; `pub struct CVPixelBuffer(CVPixelBufferRef)` with `Drop` → `CVPixelBufferRelease`.             |

Both are one `CVPixelBufferRef`. The bridge is a cast plus `wrap_under_get_rule`
(which retains) — see `src/bridge.rs`. **No per-frame copy**, which was the
kill criterion. A 4K BGRA frame is ~33 MB; copying sixty a second would have
ended the idea here.

**Version pin is load-bearing.** GPUI 0.2.2 resolves `core-video v0.4.3` — not
the current 0.6.1. A different minor is a different `CVPixelBuffer` type and the
bridge does not compile. `Cargo.toml` pins `=0.4.3`.

## ⚠️ `gpui::surface()` only accepts bi-planar YUV

The one real surprise, and it aborts the process rather than failing softly:

```
thread 'main' panicked at gpui-0.2.2/src/platform/mac/metal_renderer.rs:1085
assertion `left == right` failed
  left: 1111970369   // 'BGRA'
 right: 875704422    // '420f'
```

`surface()` looks like a general "hand me a pixel buffer" door and is not.
`metal_renderer.rs` asserts `kCVPixelFormatType_420YpCbCr8BiPlanarFullRange`,
builds an R8 luma texture and an RG8 chroma texture from planes 0 and 1, and
converts in its own fragment shader. Prequel's compositor renders `_32_BGRA`.

That is Zed's screen-share heritage showing: every frame the element was built
for arrives from a capture device already in 420f. **Nothing about it is
generic** — there is no BGRA path to select.

**Resolved with a GPU compute pass** (`src/yuv.rs`): one thread per 2×2 block,
reading the composited frame and writing both planes in one dispatch. Still no
CPU copy, and the shared rasteriser is still doing all the actual drawing — this
is a format adapter bolted to its output, not a second compositor.

The conversion matrix is full-range BT.601, the inverse of the one in GPUI's
`surface_fragment`. Getting it wrong does not fail, it shifts every colour —
exactly the preview-versus-export mismatch this spike exists to design out — so
it is checked rather than trusted (below).

**Cost if this goes ahead:** either the app grows a YUV output mode, or GPUI is
forked for a single-plane BGRA path. Neither is large; both are real, and the
fork option means carrying a patch against a pre-1.0 dependency.

## ✅ Proof 1 — the preview path

`cargo run -- "<session>" [output width]`. A real 22.6 s / 2880×1800 window
recording, through the **existing** `Compositor` and `VideoReader`, into a GPUI
window, with a zoom animating.

Measured on this machine (M4, 120 Hz display), debug build:

| Output    | Overall                            | Composite + convert | Frame interval | Worst   |
| --------- | ---------------------------------- | ------------------- | -------------- | ------- |
| 1920×1200 | ~120 fps                           | 1.2–3.3 ms          | 8.3 ms         | 15.0 ms |
| 3840×2400 | **119 fps** (2400 frames / 20.1 s) | 2.2–3.3 ms          | 8.3 ms         | 33.5 ms |

Frame interval is pinned to the 120 Hz display, so **the ceiling here is the
refresh rate, not the pipeline.** 4K costs roughly half a millisecond more than
1080p. The kill criterion was _"sustained 4K playback misses 60 fps"_ — it
clears it with room to spare, in a **debug** build, and the composite includes
`wait_until_completed()`, so that figure is real GPU time and not encode time.

Release build, same 4K output: composite 2.2–3.1 ms, frame interval 8.3 ms,
worst 16 ms. Optimisation barely moves it, which is the expected shape — the
work is on the GPU and the Rust side is only building a plan and issuing draws.

Read the numbers with three caveats:

- **`Compositor::render` is synchronous.** It commits and blocks. Nothing is
  pipelined against the next frame, so the measurement is honest but the
  headroom is larger than it looks.
- **The worst-case column is the reader, not the renderer.** The 33.5 ms outlier
  is `VideoReader::open` when playback loops. See below.
- **The first run after a build stalls for about a second.** Measured once at
  1154 ms and never again: two warm runs of the same binary peak at 16 ms. That
  is Metal's pipeline cache being cold, paid once per built binary, and it is
  worth knowing before reading a single cold run as a performance problem.

## ✅ The picture is right, not merely fast

Speed proves nothing about colour. A transposed matrix, Cb and Cr swapped, or a
plane index off by one all render at the same frame rate.

`cargo run -- "<session>" 1920 --verify` composites one frame, converts it, then
reads the same pixel out of both buffers and takes the YUV back to RGB using
GPUI's shader matrix verbatim:

```
(    8,    8)  composite 0.165 0.118 0.239  →  through YUV 0.164 0.117 0.239  Δ 0.0006
( 1912, 1192)  composite 0.051 0.071 0.125  →  through YUV 0.051 0.070 0.123  Δ 0.0028
(  960,  600)  composite 0.984 0.988 0.984  →  through YUV 0.985 0.990 0.985  Δ 0.0021
(  640,  400)  composite 0.941 0.941 0.949  →  through YUV 0.938 0.941 0.952  Δ 0.0027
worst channel error 0.0028
```

Two things land here. The round-trip is accurate to **0.3%**, which is 8-bit
quantisation plus 4:2:0 chroma subsampling and nothing else. And the top-left
pixel is `0.165, 0.118, 0.239` — exactly `#2a1e3d`, the gradient colour the plan
asked for, so the shared compositor is drawing the plan correctly and not merely
drawing something.

## Driving it

`cargo run --release` with no arguments plays the newest recording in
`~/Movies/Prequel`. A session path and an output width are optional positional
arguments; `--verify` runs the pixel check headlessly instead of opening a
window.

Dragging anywhere in the window scrubs, rather than a thin bar along the bottom
— the interesting part of the gesture is dragging _backwards_, and a 4 px target
makes that awkward to try.

## ⚠️ `VideoReader` cannot go backwards

Built for an export, which never seeks back. Playing a loop means reopening the
file, which is the 33.5 ms outlier above.

This matters more than it looks, because **scrubbing is the reason to want this
architecture at all.** The pitch against `HTMLVideoElement` is frame-accuracy
without `readyState` guesswork — but a reader that only pulls forward gives
frame-accurate _playback_ and pays a file reopen for every backwards scrub.
`AVAssetReader` cannot seek; `set_time_range` is set at open. A real editor
would need either a reader pool with overlapping ranges or a decoded-frame
cache. **Not spiked, and it is the largest unmeasured piece of proof 1.**

---

## ✅ Xcode was the blocker, and it is worth recording why

```
error: gpui@0.2.2: metal shader compilation failed:
xcrun: error: unable to find utility "metal", not a developer tool or in PATH
```

GPUI compiles its shaders **ahead of time** with `xcrun metal`, which ships only
with full Xcode. `prequel-render` compiles its Metal **at runtime**, via
`new_lib_with_src_blocking(include_str!("shaders.metal"))` — which is precisely
why Prequel has always built on Command Line Tools alone.

On Xcode 16+ the compiler is not even in the app bundle: the in-bundle `metal`
is a stub, and the real toolchain arrives as a separate downloadable component
(`xcodebuild -downloadComponent MetalToolchain`, mounted under
`com.apple.MobileAsset.MetalToolchain`).

**Adopting GPUI makes full Xcode a hard build requirement.** CI is unaffected —
GitHub's `macos-15` runners ship it — but it is a new cost for any contributor.

---

## Still open

| Proof                                   | State                                                                |
| --------------------------------------- | -------------------------------------------------------------------- |
| 1 — preview path                        | ✅ **passes**, with the YUV adapter and the backwards-seek gap noted |
| 2 — tray, global hotkey, accessory mode | not started                                                          |
| 3 — selection overlay window level      | not started                                                          |
| 4 — one control, for a velocity number  | not started                                                          |

Proof 1 was the one that could end the spike, and it did not. The compositor
unification is real: one plan, one shader, one geometry pass, feeding a live
window at 4K without a copy.
