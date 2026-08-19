//! BGRA → bi-planar YUV, on the GPU.
//!
//! Needed because `gpui::surface()` is not the general "hand me a pixel buffer"
//! door it looks like. `metal_renderer.rs` asserts the buffer is
//! `kCVPixelFormatType_420YpCbCr8BiPlanarFullRange` — it builds an R8 luma
//! texture and an RG8 chroma texture and converts in its own fragment shader.
//! Prequel's compositor renders into `_32_BGRA`, so handing it straight over
//! aborts the process:
//!
//! ```text
//! assertion `left == right` failed
//!   left: 1111970369   // 'BGRA'
//!  right: 875704422    // '420f'
//! ```
//!
//! That is Zed's screen-share heritage showing: every frame `surface` was built
//! for arrives from a capture device already in 420f. Nothing about the element
//! is generic.
//!
//! So the spike converts. A compute pass rather than a copy: one thread per 2×2
//! block, reading the composited frame and writing both planes in one dispatch,
//! entirely on the GPU. The composite itself is untouched — the *shared*
//! rasteriser this spike exists to prove is still doing all the drawing, and
//! this is a format adapter bolted to its output.
//!
//! Deliberately here and not in `prequel-render`: the spike modifies nothing
//! outside `spikes/`, and whether the app should grow a YUV output at all is a
//! decision for after the spike, not during it.

use anyhow::{Result, anyhow};
use cidre::{arc, cf, cv, mtl, ns};

/// Full-range BT.601, matching the inverse in GPUI's `surface_fragment` — the
/// same 1.4020 / 0.3441 / 0.7141 / 1.7720 matrix, solved the other way. Getting
/// this wrong does not fail, it just shifts every colour, which is exactly the
/// class of bug a preview-versus-export mismatch produces.
const KERNEL: &str = r#"
#include <metal_stdlib>
using namespace metal;

kernel void bgra_to_420f(texture2d<float, access::read> source [[texture(0)]],
                         texture2d<float, access::write> luma [[texture(1)]],
                         texture2d<float, access::write> chroma [[texture(2)]],
                         uint2 gid [[thread_position_in_grid]]) {
  if (gid.x >= chroma.get_width() || gid.y >= chroma.get_height()) {
    return;
  }

  // One thread covers the 2x2 luma block that shares a chroma sample. Luma is
  // written per pixel; chroma is the average of the four, which is what a
  // box-filtered 4:2:0 downsample is.
  uint2 base = gid * 2;
  uint2 last = uint2(source.get_width() - 1, source.get_height() - 1);
  float3 total = float3(0.0);

  for (uint dy = 0; dy < 2; ++dy) {
    for (uint dx = 0; dx < 2; ++dx) {
      uint2 at = min(base + uint2(dx, dy), last);
      float3 rgb = source.read(at).rgb;
      luma.write(float4(dot(rgb, float3(0.299, 0.587, 0.114))), at);
      total += rgb;
    }
  }

  float3 rgb = total * 0.25;
  float cb = dot(rgb, float3(-0.168736, -0.331264, 0.5)) + 0.5;
  float cr = dot(rgb, float3(0.5, -0.418688, -0.081312)) + 0.5;
  chroma.write(float4(cb, cr, 0.0, 1.0), gid);
}
"#;

pub struct Yuv {
    queue: arc::R<mtl::CmdQueue>,
    pipeline: arc::R<mtl::ComputePipelineState>,
    textures: arc::R<cv::MetalTextureCache>,
    pool: arc::R<cv::PixelBufPool>,
    width: usize,
    height: usize,
}

impl Yuv {
    pub fn new(width: u32, height: u32) -> Result<Self> {
        let device = mtl::Device::sys_default().ok_or_else(|| anyhow!("no Metal device"))?;

        // Compiled at runtime, like `Compositor::new` does — which is the reason
        // the app has never needed Xcode, and why GPUI's ahead-of-time shader
        // build was the thing that blocked this spike.
        let source = ns::String::with_str(KERNEL);
        let library = device
            .new_lib_with_src_blocking(&source, Some(&mtl::CompileOpts::new()))
            .map_err(|e| anyhow!("could not compile the conversion kernel: {e:?}"))?;
        let function = library
            .new_fn(&ns::String::with_str("bgra_to_420f"))
            .ok_or_else(|| anyhow!("bgra_to_420f missing"))?;
        let pipeline = device
            .new_compute_ps_with_fn(&function)
            .map_err(|e| anyhow!("could not build the conversion pipeline: {e:?}"))?;

        let queue = device
            .new_cmd_queue()
            .ok_or_else(|| anyhow!("could not create a command queue"))?;

        // Textures out of this cache are written to, not only sampled. Without
        // the usage flag the writes are undefined — Metal validation catches it,
        // a release build silently produces green.
        let usage = cf::DictionaryOf::with_keys_values(
            &[cv::metal::texture_cache::keys::texture_usage()],
            &[ns::Number::with_i32(
                (mtl::TextureUsage::SHADER_READ.0 | mtl::TextureUsage::SHADER_WRITE.0) as i32,
            )
            .as_ref()],
        );
        let textures = cv::MetalTextureCache::create(None, &device, Some(usage.as_ref()))
            .map_err(|e| anyhow!("could not create a texture cache: {e:?}"))?;

        let attrs = cf::DictionaryOf::with_keys_values(
            &[
                cv::pixel_buffer::keys::width(),
                cv::pixel_buffer::keys::height(),
                cv::pixel_buffer::keys::pixel_format(),
                cv::pixel_buffer::keys::metal_compatibility(),
            ],
            &[
                ns::Number::with_u32(width).as_ref(),
                ns::Number::with_u32(height).as_ref(),
                ns::Number::with_u32(cv::PixelFormat::_420F.0).as_ref(),
                ns::Number::with_bool(true).as_ref(),
            ],
        );
        let pool = cv::PixelBufPool::new(None, Some(attrs.as_ref()))
            .map_err(|e| anyhow!("could not create a YUV pool: {e:?}"))?;

        Ok(Self {
            queue,
            pipeline,
            textures,
            pool,
            width: width as usize,
            height: height as usize,
        })
    }

    /// Converts one composited frame. The result is what `gpui::surface()` takes.
    pub fn convert(&mut self, source: &cv::PixelBuf) -> Result<arc::R<cv::PixelBuf>> {
        let output = self
            .pool
            .pixel_buf()
            .map_err(|e| anyhow!("could not take a YUV buffer: {e:?}"))?;

        // Each wrapper must outlive the texture it hands back — the texture is a
        // view onto the pixel buffer, not a copy — and all three have to survive
        // until the GPU is finished, which is why they are named rather than
        // used inline.
        let source_wrapper = self
            .textures
            .texture(
                source,
                None,
                mtl::PixelFormat::Bgra8UNorm,
                self.width,
                self.height,
                0,
            )
            .map_err(|e| anyhow!("could not wrap the composite: {e:?}"))?;
        let luma_wrapper = self
            .textures
            .texture(
                &output,
                None,
                mtl::PixelFormat::R8UNorm,
                self.width,
                self.height,
                0,
            )
            .map_err(|e| anyhow!("could not wrap the luma plane: {e:?}"))?;
        let chroma_wrapper = self
            .textures
            .texture(
                &output,
                None,
                mtl::PixelFormat::Rg8UNorm,
                self.width / 2,
                self.height / 2,
                1,
            )
            .map_err(|e| anyhow!("could not wrap the chroma plane: {e:?}"))?;

        let (Some(source_texture), Some(luma), Some(chroma)) = (
            source_wrapper.texture(),
            luma_wrapper.texture(),
            chroma_wrapper.texture(),
        ) else {
            return Err(anyhow!("the texture cache returned nothing"));
        };

        let cmd = self
            .queue
            .new_cmd_buf()
            .ok_or_else(|| anyhow!("could not create a command buffer"))?;
        let mut encoder = cmd
            .new_compute_cmd_enc()
            .ok_or_else(|| anyhow!("could not create a compute encoder"))?;

        encoder.set_compute_ps(&self.pipeline);
        encoder.set_texture_at(Some(source_texture), 0);
        encoder.set_texture_at(Some(luma), 1);
        encoder.set_texture_at(Some(chroma), 2);

        // Dispatched over the chroma plane, since that is what one thread
        // produces. `dispatch_threads` handles a grid that is not a whole number
        // of threadgroups, so no padding branch is needed beyond the bounds
        // check the kernel already does.
        encoder.dispatch_threads(
            mtl::Size {
                width: self.width / 2,
                height: self.height / 2,
                depth: 1,
            },
            mtl::Size {
                width: 16,
                height: 16,
                depth: 1,
            },
        );
        encoder.end();

        cmd.commit();
        cmd.wait_until_completed();

        Ok(output)
    }
}

/// One pixel read back off the GPU, as the `--verify` mode compares them.
pub struct Sample {
    pub source: [f64; 3],
    pub through_yuv: [f64; 3],
}

impl Sample {
    /// Largest per-channel difference, 0-1.
    pub fn error(&self) -> f64 {
        (0..3)
            .map(|i| (self.source[i] - self.through_yuv[i]).abs())
            .fold(0.0, f64::max)
    }
}

/// Reads one pixel out of the BGRA composite and the same pixel out of the
/// converted planes, taking the YUV back to RGB the way GPUI's shader does.
///
/// Speed proves nothing about whether the picture is right. A transposed matrix,
/// Cb and Cr the wrong way round, or a plane index off by one all render at the
/// same frame rate and produce a differently coloured image — and "the export
/// and the preview disagree" is precisely the bug this whole spike is trying to
/// design out.
pub fn compare(bgra: &mut cv::PixelBuf, yuv: &mut cv::PixelBuf, x: usize, y: usize) -> Sample {
    // `BaseAddrLockGuard` keeps its buffer private, so the raw lock is the only
    // way to reach the bytes from outside cidre. Both unlocks below are paired
    // with their lock on every path — nothing between them can return early.
    let flags = cv::pixel_buffer::LockFlags::READ_ONLY;

    let source = unsafe {
        bgra.lock_base_addr(flags)
            .result()
            .expect("could not lock the composite");
        let stride = bgra.bytes_per_row();
        // Non-planar, so the plain base address rather than plane 0 —
        // `CVPixelBufferGetBaseAddressOfPlane` is documented to return null for
        // a buffer that has no planes.
        let base = bgra.base_address() as *const u8;
        // 32BGRA: blue, green, red, alpha, in memory order.
        let px = std::slice::from_raw_parts(base.add(y * stride + x * 4), 4);
        let rgb = [
            px[2] as f64 / 255.0,
            px[1] as f64 / 255.0,
            px[0] as f64 / 255.0,
        ];
        bgra.unlock_lock_base_addr(flags).result().ok();
        rgb
    };

    let through_yuv = unsafe {
        yuv.lock_base_addr(flags)
            .result()
            .expect("could not lock the converted frame");

        let luma_stride = yuv.plane_bytes_per_row(0);
        let luma = *yuv.plane_base_address(0).add(y * luma_stride + x) as f64 / 255.0;

        // Chroma is half resolution in both directions, so one sample covers the
        // 2x2 block this pixel belongs to.
        let chroma_stride = yuv.plane_bytes_per_row(1);
        let at = yuv
            .plane_base_address(1)
            .add((y / 2) * chroma_stride + (x / 2) * 2);
        let pair = std::slice::from_raw_parts(at, 2);
        let cb = pair[0] as f64 / 255.0 - 0.5;
        let cr = pair[1] as f64 / 255.0 - 0.5;

        yuv.unlock_lock_base_addr(flags).result().ok();

        // GPUI's `surface_fragment`, verbatim.
        [
            luma + 1.4020 * cr,
            luma - 0.3441 * cb - 0.7141 * cr,
            luma + 1.7720 * cb,
        ]
    };

    Sample {
        source,
        through_yuv,
    }
}
