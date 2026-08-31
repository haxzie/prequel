//! Rasterising a plan onto the GPU.
//!
//! Metal rather than Core Image: cidre 0.20 binds no `CIFilter` at all and its
//! `ci::Context` exposes only PNG writing, so Core Image here would mean
//! hand-rolled `objc_msgSend`. Metal is fully bound, and one shader covers
//! every primitive the plan can contain.
//!
//! Output buffers come from a pool. 4K BGRA at 60 fps is about 2 GB/s of
//! allocation if each frame is fresh, and the allocator becomes the bottleneck
//! long before the encoder does.

use std::collections::HashMap;
use std::path::Path;

use cidre::{arc, cf, cv, mtl, ns};

use prequel_session::MediaTime;

use crate::plan::{
    Paint, PlanItem, PlanSource, Rect, RenderPlan, Rgba, Size, caption_at, crop_to_frame,
    cursor_at, rect_at,
};
use crate::{Error, Result};

/// Mirrors `Uniforms` in `shaders.metal`. Field order and padding must match.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct Uniforms {
    /// Four tilted corners as `x, y, w, _`, or all zero when nothing is tilted.
    ///
    /// First in the struct on purpose: `float4[4]` is 16-byte aligned and 64
    /// bytes long, so putting it here leaves every field after it at exactly
    /// the offset it had before.
    quad: [[f32; 4]; 4],
    rect: [f32; 4],
    /// Region of the source texture, normalised as (x, y, w, h).
    ///
    /// Placed here rather than appended: both are `float4`, which MSL aligns to
    /// 16 bytes, and every field after them stays naturally aligned. Appending
    /// it after the `u32`s would silently shift the whole tail.
    src: [f32; 4],
    /// Depth of field: what stays sharp in output pixels, how far around it,
    /// and the widest blur beyond. A strength of 0 softens nothing.
    focus: [f32; 4],
    /// One texel of the sampled image, so a blur is measured in its own pixels.
    texel: [f32; 2],
    shape: [f32; 2],
    frame: [f32; 2],
    /// Padding to the next 16-byte boundary.
    ///
    /// Three `float2`s in a row leave the following `float4` at 136, and MSL
    /// puts it at 144 — a mismatch that compiles, runs, and renders the wrong
    /// colour. Rust aligns `[f32; 4]` to 4 bytes and will not insert this
    /// itself.
    _align: [f32; 2],
    color_a: [f32; 4],
    color_b: [f32; 4],
    gradient: [f32; 2],
    mode: u32,
    weight: f32,
    mirror: u32,
    /// How hard the frame darkens towards its edges, 0 to 1. 0 darkens nothing.
    ///
    /// In place of the tail padding this struct already carried, so the layout
    /// is byte-for-byte what it was and the MSL side needs no re-alignment.
    vignette: f32,
}

const MODE_FILL: u32 = 0;
const MODE_GRADIENT: u32 = 1;
const MODE_IMAGE: u32 = 2;
const MODE_SHADOW: u32 = 3;
const MODE_STROKE: u32 = 4;

/**
 * A texture and everything that has to outlive it.
 *
 * `CVMetalTextureCache` hands back a wrapper around the `MTLTexture`, and
 * releasing that wrapper can invalidate the texture — which then samples as
 * nothing. The pixel buffer matters for the same reason: the texture is a view
 * onto its memory, not a copy of it. Dropping either is the difference between
 * an image that renders and one that silently does not.
 */
struct Held {
    texture: arc::R<mtl::Texture>,
    _wrapper: arc::R<cv::MetalTexture>,
    _buffer: Option<arc::R<cv::PixelBuf>>,
}

pub struct Compositor {
    device: arc::R<mtl::Device>,
    queue: arc::R<mtl::CmdQueue>,
    pipeline: arc::R<mtl::RenderPipelineState>,
    textures: arc::R<cv::MetalTextureCache>,
    pool: arc::R<cv::PixelBufPool>,
    /// Background images, decoded once and reused for every frame that uses
    /// them — a wallpaper re-uploaded per frame would dominate the export.
    images: HashMap<String, Held>,
    /// How recently each caption bitmap was wanted, for the eviction below.
    /// Counted rather than timed: the export loop is monotonic in time and a
    /// counter cannot go backwards over a paused machine.
    caption_use: HashMap<String, u64>,
    caption_clock: u64,
}

/// How many caption bitmaps to keep decoded at once.
///
/// Captions deliberately do *not* go through the preload that backgrounds and
/// the pointer use. There are a handful of those and every slice names the same
/// one; there is one caption bitmap per cue, and a five-minute take at 4K is
/// around 300 of them — about 1.2 GB of wired IOSurface memory if they were all
/// decoded up front. Only one cue is on screen at a time, so a very small cache
/// costs one decode per cue across the whole export and bounds the memory flat.
const CAPTION_CACHE: usize = 4;

impl Compositor {
    pub fn new(width: u32, height: u32) -> Result<Self> {
        let device =
            mtl::Device::sys_default().ok_or_else(|| Error::Metal("no Metal device".to_owned()))?;

        let source = ns::String::with_str(include_str!("shaders.metal"));
        let library = device
            .new_lib_with_src_blocking(&source, Some(&mtl::CompileOpts::new()))
            .map_err(|e| Error::Metal(format!("{e:?}")))?;

        let vertex = library
            .new_fn(&ns::String::with_str("composite_vertex"))
            .ok_or_else(|| Error::Metal("composite_vertex missing".to_owned()))?;
        let fragment = library
            .new_fn(&ns::String::with_str("composite_fragment"))
            .ok_or_else(|| Error::Metal("composite_fragment missing".to_owned()))?;

        let mut descriptor = mtl::RenderPipelineDesc::new();
        descriptor.set_vertex_fn(Some(&vertex));
        descriptor.set_fragment_fn(Some(&fragment));

        let attachments = descriptor.color_attaches();
        let mut attachment = attachments.get(0);
        attachment.set_pixel_format(mtl::PixelFormat::Bgra8UNorm);
        // Source-over on *premultiplied* colour: every primitive is drawn back
        // to front, and the shader has already folded its alpha into the RGB.
        //
        // `SrcAlpha` here would multiply a second time. That is invisible on
        // what the plan used to hold — an opaque background, and a shadow whose
        // colour is black, where `0 * a * a` is still 0 — and plainly wrong on
        // anything translucent and coloured: a caption pill set to 60% draws at
        // 36%, and an antialiased glyph edge erodes. `webgl.ts` is configured
        // the same way, deliberately, so the two cannot drift apart.
        attachment.set_blending_enabled(true);
        attachment.set_src_rgb_blend_factor(mtl::BlendFactor::One);
        attachment.set_dst_rgb_blend_factor(mtl::BlendFactor::OneMinusSrcAlpha);
        attachment.set_src_alpha_blend_factor(mtl::BlendFactor::One);
        attachment.set_dst_alpha_blend_factor(mtl::BlendFactor::OneMinusSrcAlpha);

        let pipeline = device
            .new_render_ps(&descriptor)
            .map_err(|e| Error::Metal(format!("{e:?}")))?;

        let queue = device
            .new_cmd_queue()
            .ok_or_else(|| Error::Metal("could not create a command queue".to_owned()))?;

        let textures = cv::MetalTextureCache::create(None, &device, None)
            .map_err(|e| Error::Metal(format!("{e:?}")))?;

        let pool = output_pool(width, height)?;

        Ok(Self {
            device,
            queue,
            pipeline,
            textures,
            pool,
            images: HashMap::new(),
            caption_use: HashMap::new(),
            caption_clock: 0,
        })
    }

    /// Registers a decoded background image under the path the plan names it by.
    ///
    /// Takes the buffer rather than borrowing it: the texture is a view onto
    /// that memory and stays valid only while it is alive.
    pub fn add_image(&mut self, path: &str, buffer: arc::R<cv::PixelBuf>) -> Result<()> {
        let held = self.texture_for(&buffer, Some(buffer.clone()))?;
        self.images.insert(path.to_owned(), held);
        Ok(())
    }

    /// Makes sure every caption bitmap this plan needs at this moment is
    /// decoded, and drops the ones it does not.
    ///
    /// Called immediately before `render`, never during it: `Held`'s wrapper
    /// must outlive the `MTLTexture`, and the texture is a *view* onto the
    /// pixel buffer rather than a copy. Evicting between two draws of the same
    /// frame would hand the GPU memory that had already been freed. Between
    /// frames is safe — `render` ends by waiting on its command buffer.
    ///
    /// A bitmap that will not decode is skipped, not fatal. The rest of the
    /// frame is still worth rendering, and a missing caption is a plainer video
    /// where a failed export is lost footage.
    pub fn load_captions(&mut self, dir: &Path, plan: &RenderPlan, at: MediaTime) {
        self.caption_clock += 1;
        let now = self.caption_clock;
        let at = at as i64;

        for item in &plan.items {
            let PlanItem::Caption { path, span, .. } = item else {
                continue;
            };
            // The same half-open test `caption_at` makes, so a bitmap is never
            // decoded for a frame that would not draw it.
            if path.is_empty() || at < span.start || at >= span.end {
                continue;
            }

            self.caption_use.insert(path.clone(), now);
            if self.images.contains_key(path) {
                continue;
            }

            match crate::image::decode(&dir.join(path))
                .and_then(|buffer| self.add_image(path, buffer))
            {
                Ok(()) => tracing::debug!("loaded caption {path}"),
                Err(err) => tracing::warn!("could not load caption {path}: {err}"),
            }
        }

        // Only ever the caption entries: `caption_use` holds nothing else, so a
        // background can never be evicted out from under a later frame.
        while self.caption_use.len() > CAPTION_CACHE {
            let Some(stalest) = self
                .caption_use
                .iter()
                .filter(|(_, seen)| **seen < now)
                .min_by_key(|(_, seen)| **seen)
                .map(|(path, _)| path.clone())
            else {
                // Everything left is in use this frame. More cues on screen at
                // once than the cache holds is not a reason to thrash.
                break;
            };

            self.caption_use.remove(&stalest);
            self.images.remove(&stalest);
        }
    }

    /// Draws one plan into a fresh output buffer.
    pub fn render(
        &mut self,
        plan: &RenderPlan,
        screen: Option<&cv::PixelBuf>,
        camera: Option<&cv::PixelBuf>,
        // Source time, for the one item in a plan that moves.
        at: MediaTime,
    ) -> Result<arc::R<cv::PixelBuf>> {
        let output = self
            .pool
            .pixel_buf()
            .map_err(|e| Error::Metal(format!("could not take an output buffer: {e:?}")))?;

        // Held until after the command buffer completes: the texture is only
        // valid while its wrapper is alive, and this one is being drawn into.
        let target = self.texture_for(&output, None)?;

        let descriptor = mtl::RenderPassDesc::new();
        let attachments = descriptor.color_attaches();
        let mut attachment = attachments.get(0);
        attachment.set_texture(Some(&target.texture));
        attachment.set_load_action(mtl::LoadAction::Clear);
        attachment.set_store_action(mtl::StoreAction::Store);
        attachment.set_clear_color(mtl::ClearColor::clear());

        let cmd = self
            .queue
            .new_cmd_buf()
            .ok_or_else(|| Error::Metal("could not create a command buffer".to_owned()))?;
        let mut encoder = cmd
            .new_render_cmd_enc(&descriptor)
            .ok_or_else(|| Error::Metal("could not create a render encoder".to_owned()))?;

        encoder.set_render_ps(&self.pipeline);

        let frame = [plan.frame.width as f32, plan.frame.height as f32];
        // Every texture drawn this frame, kept alive until the GPU is done with
        // it. Dropping one mid-flight leaves the draw sampling freed memory.
        let mut alive: Vec<Held> = Vec::new();

        for item in &plan.items {
            // Sources are resolved by the caller; `None` means the track had no
            // frame for this moment — before the camera opened, say — and the
            // item is skipped rather than drawn from nothing.
            let (uniforms, texture) =
                match self.uniforms_for(item, frame, screen, camera, at, &mut alive)? {
                    Some(pair) => pair,
                    None => continue,
                };

            // Through a buffer rather than `setBytes:`, which cidre does not
            // bind on a render encoder. One small allocation per primitive,
            // and a plan holds a handful of them.
            let buffer = self
                .device
                .new_buf_with_slice(&[uniforms], mtl::ResOpts::default())
                .ok_or_else(|| Error::Metal("could not allocate uniforms".to_owned()))?;

            encoder.set_vertex_buf_at(Some(&buffer), 0, 0);
            encoder.set_fragment_buf_at(Some(&buffer), 0, 0);
            encoder.set_fragment_texture_at(texture, 0);

            encoder.draw_primitives(mtl::Primitive::TriangleStrip, 0, 4);
        }

        // Safety: no further commands are encoded after this, and the encoder
        // is dropped immediately below.
        unsafe { encoder.end_encoding() };
        cmd.commit();
        // Waited on rather than pipelined: the next step hands this buffer
        // straight to the encoder, and an export is throughput-bound on the
        // decoder rather than on GPU latency. It is also what makes holding the
        // textures until here sufficient.
        cmd.wait_until_completed();
        drop(alive);
        drop(target);

        Ok(output)
    }

    /// Builds the uniform block for one primitive, and the texture it samples.
    fn uniforms_for<'a>(
        &'a self,
        item: &PlanItem,
        frame: [f32; 2],
        screen: Option<&cv::PixelBuf>,
        camera: Option<&cv::PixelBuf>,
        at: MediaTime,
        alive: &'a mut Vec<Held>,
    ) -> Result<Option<(Uniforms, Option<&'a mtl::Texture>)>> {
        let base = Uniforms {
            quad: [[0.0; 4]; 4],
            rect: [0.0; 4],
            // The whole texture, which is right for everything but a cropped
            // image — those override it below.
            src: [0.0, 0.0, 1.0, 1.0],
            focus: [0.0, 0.0, 1.0, 0.0],
            texel: [0.0; 2],
            shape: [0.0, 2.0],
            frame,
            _align: [0.0; 2],
            color_a: [0.0; 4],
            color_b: [0.0; 4],
            gradient: [0.0, 1.0],
            mode: MODE_FILL,
            weight: 0.0,
            mirror: 0,
            // No vignette unless the item being drawn asks for one, which only a
            // zoomed picture does.
            vignette: 0.0,
        };

        Ok(match item {
            PlanItem::Fill { rect, paint } => match paint {
                Paint::Solid { color } => Some((
                    Uniforms {
                        rect: rect_of(rect),
                        color_a: rgba(color),
                        ..base
                    },
                    None,
                )),
                Paint::Gradient { from, to, angle } => {
                    // Measured clockwise from straight up, matching CSS, so a
                    // value copied from a design reads the same in both.
                    let radians = (angle - 90.0).to_radians() as f32;
                    Some((
                        Uniforms {
                            rect: rect_of(rect),
                            color_a: rgba(from),
                            color_b: rgba(to),
                            gradient: [radians.cos(), radians.sin()],
                            mode: MODE_GRADIENT,
                            ..base
                        },
                        None,
                    ))
                }
                Paint::Image { path } => {
                    let Some(held) = self.images.get(path) else {
                        // Not loaded, or missing. Skipped rather than filled
                        // with black, which would look like a rendering fault.
                        return Ok(None);
                    };
                    Some((
                        Uniforms {
                            rect: rect_of(rect),
                            // Centred and scaled to cover, matching what the
                            // canvas does with the same image. Sampling the
                            // whole texture across the rect instead — which is
                            // what the default `src` does — stretches a 16:9
                            // wallpaper to fill a vertical frame, and the
                            // preview and the export then disagree about the
                            // one thing behind everything else.
                            src: cover(rect, held.texture.width(), held.texture.height()),
                            mode: MODE_IMAGE,
                            ..base
                        },
                        // Already held by `self.images`, so it needs no entry
                        // in this frame's keep-alive list.
                        Some(held.texture.as_ref()),
                    ))
                }
            },

            PlanItem::Shadow {
                rect,
                shape,
                blur,
                dy,
                color,
                motion,
            } => {
                let now = rect_at(motion, at as i64, *rect, shape.radius);
                Some((
                    Uniforms {
                        rect: [
                            now.rect.x as f32,
                            (now.rect.y + dy) as f32,
                            now.rect.width as f32,
                            now.rect.height as f32,
                        ],
                        // Dropped by `dy` with the picture, or a tilted frame's
                        // shadow stays flat underneath and gives it away.
                        quad: corners_of(&now.quad, *dy),
                        shape: [now.radius as f32, shape.exponent as f32],
                        color_a: rgba(color),
                        mode: MODE_SHADOW,
                        weight: *blur as f32,
                        ..base
                    },
                    None,
                ))
            }

            PlanItem::Image {
                source,
                src_rect,
                motion,
                dst_rect,
                shape,
                mirror,
            } => {
                let buffer = match source {
                    PlanSource::Screen => screen,
                    PlanSource::Camera => camera,
                };
                let Some(buffer) = buffer else {
                    return Ok(None);
                };

                alive.push(self.texture_for(buffer, None)?);
                // A zoom moves, scales and tilts the whole picture over time.
                let now = rect_at(motion, at as i64, *dst_rect, shape.radius);
                // Cut to the frame, with the source cropped to match, so a zoom
                // that scales the picture past every edge still draws its
                // rounded corners. The same arithmetic the preview runs.
                let (cut, crop) = crop_to_frame(
                    now.rect,
                    *src_rect,
                    Size {
                        width: frame[0] as f64,
                        height: frame[1] as f64,
                    },
                    !now.quad.is_empty(),
                );

                Some((
                    Uniforms {
                        rect: rect_of(&cut),
                        quad: corners_of(&now.quad, 0.0),
                        // Normalised against the source's real size, which is
                        // the whole point: a 16:9 camera cropped to a square
                        // and then sampled edge-to-edge comes out stretched.
                        src: normalised(&crop, buffer.width(), buffer.height()),
                        vignette: now.vignette as f32,
                        focus: now.focus.map_or([0.0, 0.0, 1.0, 0.0], |f| {
                            [f.x as f32, f.y as f32, f.safe as f32, f.strength as f32]
                        }),
                        // In the source's own texels, so a given strength looks
                        // the same whatever resolution was recorded.
                        texel: [
                            1.0 / buffer.width().max(1) as f32,
                            1.0 / buffer.height().max(1) as f32,
                        ],
                        shape: [now.radius as f32, shape.exponent as f32],
                        mode: MODE_IMAGE,
                        mirror: u32::from(*mirror),
                        ..base
                    },
                    Some(alive.last().unwrap().texture.as_ref()),
                ))
            }

            PlanItem::Stroke {
                rect,
                shape,
                width,
                color,
                motion,
            } => {
                let now = rect_at(motion, at as i64, *rect, shape.radius);
                Some((
                    Uniforms {
                        rect: rect_of(&now.rect),
                        quad: corners_of(&now.quad, 0.0),
                        shape: [now.radius as f32, shape.exponent as f32],
                        color_a: rgba(color),
                        mode: MODE_STROKE,
                        weight: *width as f32,
                        ..base
                    },
                    None,
                ))
            }

            PlanItem::Cursor {
                path,
                size,
                hotspot,
                points,
            } => {
                let Some(held) = self.images.get(path) else {
                    // No pointer image loaded. Skipped rather than drawn as a
                    // black square, which is what an unloaded texture is.
                    return Ok(None);
                };
                // Off the recorded area at this moment. Not an error — the
                // preview draws nothing here too.
                let Some(point) = cursor_at(points, at as i64) else {
                    return Ok(None);
                };

                // Sized by where it sits on the picture, so a tilted frame's
                // pointer grows towards the near edge with everything on it.
                let size = size * point.scale;

                Some((
                    Uniforms {
                        // The hotspot is the point that lands on the position:
                        // for an arrow that is its tip, not its middle, so the
                        // image is offset rather than centred.
                        rect: [
                            (point.x - hotspot.x * size) as f32,
                            (point.y - hotspot.y * size) as f32,
                            size as f32,
                            size as f32,
                        ],
                        mode: MODE_IMAGE,
                        ..base
                    },
                    Some(held.texture.as_ref()),
                ))
            }

            PlanItem::Caption {
                path,
                bitmap,
                dst_rect,
                span,
                words,
            } => {
                let Some(held) = self.images.get(path) else {
                    // No bitmap loaded. Skipped rather than drawn as a black
                    // rectangle, which is what an unloaded texture is.
                    return Ok(None);
                };
                // Off screen at this moment, or between two words on the lit
                // layer. Not an error — the preview draws nothing here too.
                let Some(draw) = caption_at(*bitmap, *dst_rect, *span, words, at as i64) else {
                    return Ok(None);
                };

                Some((
                    Uniforms {
                        rect: rect_of(&draw.dst),
                        // Normalised against the texture's real size rather
                        // than the plan's `bitmap`. They agree — the same file
                        // produced both — and if a stale PNG ever made them
                        // disagree, this keeps the crop inside the texture
                        // instead of sampling past its edge.
                        src: normalised(&draw.src, held.texture.width(), held.texture.height()),
                        mode: MODE_IMAGE,
                        ..base
                    },
                    Some(held.texture.as_ref()),
                ))
            }
        })
    }

    /// Wraps a pixel buffer as a Metal texture, without copying it.
    fn texture_for(
        &self,
        buffer: &cv::PixelBuf,
        own: Option<arc::R<cv::PixelBuf>>,
    ) -> Result<Held> {
        let width = buffer.width();
        let height = buffer.height();

        let wrapper = self
            .textures
            .texture(buffer, None, mtl::PixelFormat::Bgra8UNorm, width, height, 0)
            .map_err(|e| Error::Metal(format!("could not wrap a frame as a texture: {e:?}")))?;

        let texture = wrapper
            .texture()
            .map(|texture| texture.retained())
            .ok_or_else(|| Error::Metal("texture cache returned nothing".to_owned()))?;

        Ok(Held {
            texture,
            _wrapper: wrapper,
            _buffer: own,
        })
    }
}

/// Pooled output buffers, rather than one allocation per frame.
fn output_pool(width: u32, height: u32) -> Result<arc::R<cv::PixelBufPool>> {
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
            ns::Number::with_u32(cv::PixelFormat::_32_BGRA.0).as_ref(),
            ns::Number::with_bool(true).as_ref(),
        ],
    );

    cv::PixelBufPool::new(None, Some(attrs.as_ref()))
        .map_err(|e| Error::Metal(format!("could not create a buffer pool: {e:?}")))
}

fn rect_of(rect: &Rect) -> [f32; 4] {
    [
        rect.x as f32,
        rect.y as f32,
        rect.width as f32,
        rect.height as f32,
    ]
}

/// A source rectangle in pixels, as a 0-1 fraction of the texture.
///
/// Clamped, because a crop that runs a hair outside the source would otherwise
/// sample the clamped edge and smear it — visible as a stripe down one side.
/// A plan's twelve corner numbers as the shader's four `float4`s.
///
/// All zero when there is no tilt: the vertex function reads a `w` of zero as
/// "use the rectangle", so an untilted primitive needs nothing set.
fn corners_of(quad: &[f64], dy: f64) -> [[f32; 4]; 4] {
    let mut out = [[0.0f32; 4]; 4];
    if quad.len() != 12 {
        return out;
    }

    for (index, corner) in out.iter_mut().enumerate() {
        corner[0] = quad[index * 3] as f32;
        corner[1] = (quad[index * 3 + 1] + dy) as f32;
        corner[2] = quad[index * 3 + 2] as f32;
    }

    out
}

/// The part of an image a `cover` fill shows, in normalised texture space.
///
/// The largest centred region with the destination's shape. Mirrors the
/// transform `paintStyle` builds in `apps/desktop/src/renderer/src/editor/
/// canvas.ts`; a background is the one thing on screen with no edge of its own
/// to give the difference away, so the two have to agree by construction.
fn cover(rect: &Rect, width: usize, height: usize) -> [f32; 4] {
    if width == 0 || height == 0 || rect.width <= 0.0 || rect.height <= 0.0 {
        return [0.0, 0.0, 1.0, 1.0];
    }

    let w = width as f64;
    let h = height as f64;
    let scale = (rect.width / w).max(rect.height / h);

    // In texture pixels, then normalised. Never more than the texture holds:
    // an image already the right shape shows all of itself.
    let visible_w = (rect.width / scale).min(w);
    let visible_h = (rect.height / scale).min(h);

    [
        ((w - visible_w) / 2.0 / w) as f32,
        ((h - visible_h) / 2.0 / h) as f32,
        (visible_w / w) as f32,
        (visible_h / h) as f32,
    ]
}

fn normalised(rect: &Rect, width: usize, height: usize) -> [f32; 4] {
    if width == 0 || height == 0 {
        return [0.0, 0.0, 1.0, 1.0];
    }

    let w = width as f64;
    let h = height as f64;

    let x = (rect.x / w).clamp(0.0, 1.0);
    let y = (rect.y / h).clamp(0.0, 1.0);

    [
        x as f32,
        y as f32,
        ((rect.width / w).min(1.0 - x)) as f32,
        ((rect.height / h).min(1.0 - y)) as f32,
    ]
}

fn rgba(color: &str) -> [f32; 4] {
    let parsed = Rgba::parse(color);
    [parsed.r, parsed.g, parsed.b, parsed.a]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The uniform block is memcpy'd straight into a Metal buffer, so its
    /// layout has to match `Uniforms` in `shaders.metal` byte for byte. A
    /// mismatch does not fail to compile — it renders garbage, or renders the
    /// right thing with the wrong colour, which is far harder to trace back.
    #[test]
    fn the_uniform_block_matches_the_shader() {
        use std::mem::{align_of, offset_of, size_of};

        // Every `float4` sits on a 16-byte boundary, as MSL requires. The
        // corner array leads, and is 64 bytes, so everything after it keeps the
        // offset it had before perspective existed.
        assert_eq!(offset_of!(Uniforms, quad), 0);
        assert_eq!(offset_of!(Uniforms, rect), 64);
        assert_eq!(offset_of!(Uniforms, src), 80);
        // `focus` is a `float4`, so it goes on a 16-byte boundary and the two
        // `float2`s follow it.
        assert_eq!(offset_of!(Uniforms, focus), 96);
        assert_eq!(offset_of!(Uniforms, texel), 112);
        assert_eq!(offset_of!(Uniforms, shape), 120);
        assert_eq!(offset_of!(Uniforms, frame), 128);
        assert_eq!(offset_of!(Uniforms, color_a), 144);
        assert_eq!(offset_of!(Uniforms, color_b), 160);
        assert_eq!(offset_of!(Uniforms, gradient), 176);
        assert_eq!(offset_of!(Uniforms, mode), 184);
        assert_eq!(offset_of!(Uniforms, weight), 188);
        assert_eq!(offset_of!(Uniforms, mirror), 192);

        assert_eq!(align_of::<Uniforms>(), 4);
        assert_eq!(size_of::<Uniforms>(), 200);
    }

    #[test]
    fn a_full_frame_crop_normalises_to_the_whole_texture() {
        let rect = Rect {
            x: 0.0,
            y: 0.0,
            width: 1280.0,
            height: 720.0,
        };
        assert_eq!(normalised(&rect, 1280, 720), [0.0, 0.0, 1.0, 1.0]);
    }

    #[test]
    fn a_centre_square_crop_keeps_the_camera_from_stretching() {
        // The bug this exists for: a 16:9 camera centre-cropped to a square,
        // then sampled edge to edge, comes out squashed into the bubble. The
        // crop has to reach the shader as a fraction of the source.
        let rect = Rect {
            x: 280.0,
            y: 0.0,
            width: 720.0,
            height: 720.0,
        };
        let src = normalised(&rect, 1280, 720);

        assert!((src[0] - 280.0 / 1280.0).abs() < 1e-6);
        assert_eq!(src[1], 0.0);
        assert!((src[2] - 720.0 / 1280.0).abs() < 1e-6);
        assert_eq!(src[3], 1.0);
    }

    #[test]
    fn a_crop_never_runs_off_the_source() {
        // Sampling past the edge smears the clamped pixel into a stripe.
        let rect = Rect {
            x: 900.0,
            y: 0.0,
            width: 900.0,
            height: 720.0,
        };
        let src = normalised(&rect, 1280, 720);

        assert!(src[0] + src[2] <= 1.0 + 1e-6);
        assert!(src[1] + src[3] <= 1.0 + 1e-6);
    }

    #[test]
    fn a_source_with_no_pixels_falls_back_to_the_whole_texture() {
        let rect = Rect {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        };
        assert_eq!(normalised(&rect, 0, 0), [0.0, 0.0, 1.0, 1.0]);
    }
}
