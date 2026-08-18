# GPUI spike — findings

Live document. Written as things land, so the decision is made against recorded
facts rather than a recollection of how it felt.

Status: **blocked on proof 1**, with its riskiest premise already verified.

---

## ✅ The pixel-buffer bridge is a pointer cast, not a copy

The premise proof 1 rests on. Checked by reading both crates, not by assuming:

| | |
|---|---|
| cidre | `cv::PixelBuf = cv::ImageBuf = cv::Buf`, and `define_cf_type!` makes `Buf` a `#[repr(transparent)]` newtype over `cf::Type`. A `&cv::PixelBuf` **is** the CF pointer. |
| core-video 0.4.3 | `CVPixelBufferRef = CVImageBufferRef = CVBufferRef = *mut __CVBuffer`; `pub struct CVPixelBuffer(CVPixelBufferRef)` with `Drop` → `CVPixelBufferRelease`. |

Both are one `CVPixelBufferRef`. The bridge is a cast plus `wrap_under_get_rule`
(which retains) — see `src/bridge.rs`. **No per-frame copy**, which was the
kill criterion. A 4K BGRA frame is ~33 MB; copying sixty a second would have
ended the idea here.

**Version pin is load-bearing.** GPUI 0.2.2 resolves `core-video v0.4.3` — not
the current 0.6.1. A different minor is a different `CVPixelBuffer` type and the
bridge does not compile. `Cargo.toml` pins `=0.4.3`.

## ✅ The compositor is reachable, and returns exactly the right type

`Compositor::render(&plan, screen, camera, at) -> Result<arc::R<cv::PixelBuf>>`.
That is the type `gpui::surface()` wants, after the bridge above. `VideoReader`
supplies the source frames via `frame_at(at)`.

Both are private modules, so the spike enables a new `spike` feature on
`prequel-render` that makes `compositor` and `reader` public. The feature is off
by default — **the crate's public surface is unchanged for every ordinary
build** — and both configurations compile.

## ⛔ Blocked: GPUI cannot be built on this machine

```
error: gpui@0.2.2: metal shader compilation failed:
xcrun: error: unable to find utility "metal", not a developer tool or in PATH
```

GPUI's build script compiles its shaders **ahead of time** with `xcrun metal`.
That tool ships only with **full Xcode**, and this machine has Command Line
Tools alone. Confirmed:

- no `metal` binary anywhere on disk; not among CLT's 136 tools
- `xcodebuild -downloadComponent MetalToolchain` is not a way out — `xcodebuild`
  itself requires Xcode

Worth noting the contrast, because it is why Prequel builds fine today:
`prequel-render` compiles its Metal **at runtime**, via
`device.new_lib_with_src_blocking(include_str!("shaders.metal"))`. No build-time
`metal` compiler, so CLT has always been enough. GPUI made the other choice.

**Unblocking needs Xcode.app (~15 GB, Apple ID).** CI is unaffected — GitHub's
`macos-15` runners ship Xcode.

---

## Still open

| Proof | State |
|---|---|
| 1 — preview path | premise verified; **runtime behaviour and frame rate need Xcode** |
| 2 — tray, global hotkey, accessory mode | not started (needs GPUI to build) |
| 3 — selection overlay window level | not started (needs GPUI to build) |
| 4 — one control, for a velocity number | not started (needs GPUI to build) |

## Buildable without Xcode

The compositor's own throughput — plan → `render()` → `CVPixelBuffer`, timed —
needs no GPUI, and answers half of proof 1's kill criterion (*"sustained 4K
playback misses 60 fps"*). Requires a `RenderPlan`, which only the TypeScript
`buildRenderPlan` produces today; the fixture in `crates/prequel-render/src/plan.rs`
(`parses a plan the editor would send`) is the cheapest source.
