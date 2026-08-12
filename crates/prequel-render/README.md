# prequel-render

Baking an edit down to one MP4. `AVAssetReader` to decode, Metal to composite,
`prequel-encode` to write.

The recorder writes four separate files so the webcam can be moved and the mix
changed afterwards. This is the other end of that bargain.

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test -p prequel-render
```

`plan`, `timeline` and `mixer` are pure and need no GPU, display or CoreAudio.
The two integration tests need both, and shell out to `ffprobe`.

```
plan.rs        serde mirror of the editor's RenderPlan — pure
timeline.rs    output frame index → slice → source time — pure
mixer.rs       per-source gain on f32 PCM — pure
reader.rs      AVAssetReader: one file plus a time range → (pts, PixelBuf)
compositor.rs  Metal device, pipeline, texture cache, pixel buffer pool
shaders.metal  MSL, compiled at runtime from source
image.rs       background images
export.rs      the orchestrator: progress and cancellation
```

## Three decisions shape everything

**The loop is driven by output frames, not input frames.** For each frame of
the result it asks what moment of the recording belongs there and pulls each
reader forward to it. Cuts, a 60 fps screen against a 30 fps camera, frames
dropped during capture and a camera that opened late all fall out for free, and
the output is constant-frame-rate — which is what the preview assumes.
Input-driven would need a resampler per source and would still get cuts wrong.

**Geometry is not recomputed.** The editor sends a `RenderPlan` in absolute
output pixels and this rasterises it. Two implementations of "where does the
camera sit" is how a preview and an export come to disagree, and the
disagreement is only ever noticed after the file has been written. What can
still differ between the two rasterisers is antialiasing and gradient
interpolation — not whether the camera is in the right corner.

Zooms, perspective tilt and cursor motion arrive already sampled into the plan
as keys. Nothing here knows what a zoom is; it interpolates numbers.

**Audio is mixed by hand.** A per-source multiply on `f32`, which is exactly
what WebAudio's `GainNode` does in the preview, so the two cannot diverge.
`AVAudioMix`'s per-asset-track model would have to be fought for per-slice
gains and cuts, and plain arithmetic is testable with two synthetic ramps and
no file at all.

## Traps

**One `AVAssetReader` per file per slice.** A reader cannot seek backwards and
slices can be reordered, so a single long-lived reader is not an option.

**`CVMetalTextureCache` hands back a wrapper that must outlive the
`MTLTexture`, and the texture is a _view_ onto the pixel buffer, not a copy.**
Keep both alive or it samples nothing. Buffers it wraps must be created
IOSurface-backed and Metal-compatible; a plain `cv::PixelBuf::new` is not.

**Output buffers come from a pool.** 4K BGRA at 60 fps is about 2 GB/s of
allocation otherwise.

**The uniform block must match the shader byte for byte.** MSL aligns `float4`
to 16 bytes; Rust's `repr(C)` does not insert the same padding, so three
consecutive `float2`s leave the next `float4` at the wrong offset and the
render comes out subtly wrong rather than failing.
`the_uniform_block_matches_the_shader` asserts every offset — keep it passing
rather than debugging the picture.

## Testing

`renders_the_right_pixels.rs` reads back pixels at known coordinates from a
known plan. This is the test that catches drift between the Metal and WebGL
rasterisers.

Shape assertions — duration, frame count, dimensions — pass happily on output
that looks wrong, so `exports_the_composite.rs` covers the plumbing and the
pixel test covers the picture.
