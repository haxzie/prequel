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
    /// Motion blur on the pointer: the streak as a vector in the quad's own uv,
    /// how much of the quad on each side is padding, and non-zero to enable it.
    ///
    /// Beside `focus` for the reason `src` above is beside `rect`: both are
    /// `float4`, MSL aligns them to 16 bytes, and every field after them stays
    /// naturally aligned. Appending it after the `u32`s would silently shift
    /// the whole tail.
    smear: [f32; 4],
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
    /// A flat blur across the whole quad, in the sampled image's own texels.
    ///
    /// Unlike `focus` it does not vary across the quad — a caption word
    /// arriving out of focus is uniformly soft. In the last four bytes of the
    /// tail padding, for the reason `vignette` above is: the struct is 16-byte
    /// aligned and both sides round its size up to the same 224 either way, so
    /// no field moves.
    soften: f32,
    /// Non-zero to colour the quad against what is already drawn under it.
    ///
    /// After `soften`, because that is the order `shaders.metal` declares them
    /// in and the two layouts have to agree field for field. The pair fills the
    /// eight bytes of tail padding the struct already carried, so nothing above
    /// moved and both sides are 224 long.
    adapt: f32,
    /// How opaque a still image is drawn, 0 to 1. Everything else passes 1.
    ///
    /// The first field to need the struct to *grow*: the eight bytes `vignette`
    /// and `soften` were fitted into are spent, and `adapt` took the last four.
    /// MSL rounds a struct up to its largest member's alignment, so one more
    /// `float` takes both sides from 224 to 240 — and Rust aligns `[f32; 4]` to
    /// 4 rather than 16, so it will not add that itself. Hence the padding
    /// below, written out for the reason `_align` above is.
    alpha: f32,
    /// Padding to 240, which is where MSL puts the end of this struct.
    _tail: [f32; 3],
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
    /// A copy of the frame under the caption being drawn. See `grab_backdrop`.
    backdrop: Option<arc::R<mtl::Texture>>,
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
            backdrop: None,
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

            // Touched in place where the entry already exists. `insert` with an
            // owned key allocates a `String` per caption per frame, and a cue
            // that is on screen for three seconds is on screen for a hundred and
            // eighty frames — the allocation was for the first of them and
            // wasted on the rest.
            if let Some(seen) = self.caption_use.get_mut(path) {
                *seen = now;
            } else {
                self.caption_use.insert(path.clone(), now);
            }

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

        let mut cmd = self
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

        // The region the backdrop copy currently holds, so a line of words
        // splits the pass once rather than once per word.
        let mut copied: Option<Rect> = None;

        for item in &plan.items {
            // A caption coloured against what is behind it needs to *see* what
            // is behind it, and Metal cannot sample the texture it is drawing
            // into. So the pass ends here, the region under the caption is
            // blitted out, and a second pass loads what was already drawn and
            // carries on. Captions are last in a plan and a line's words all
            // share one box, so in practice this happens once a frame.
            if let PlanItem::Caption {
                dst_rect,
                tint: Some(_),
                ..
            } = item
                && copied != Some(*dst_rect)
            {
                unsafe { encoder.end_encoding() };
                self.grab_backdrop(&mut cmd, &target.texture, dst_rect, plan.frame)?;
                copied = Some(*dst_rect);

                let descriptor = mtl::RenderPassDesc::new();
                let attachments = descriptor.color_attaches();
                let mut attachment = attachments.get(0);
                attachment.set_texture(Some(&target.texture));
                // Load, not clear: everything drawn so far is the frame.
                attachment.set_load_action(mtl::LoadAction::Load);
                attachment.set_store_action(mtl::StoreAction::Store);

                encoder = cmd
                    .new_render_cmd_enc(&descriptor)
                    .ok_or_else(|| Error::Metal("could not create a render encoder".to_owned()))?;
                encoder.set_render_ps(&self.pipeline);
            }

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
            // Bound for every draw, not only the ones that read it: a fragment
            // function declares its textures whatever the uniforms say, and
            // leaving slot 1 empty is a validation error rather than an unused
            // binding. Only `adapt` decides whether it is sampled.
            encoder.set_fragment_texture_at(self.backdrop.as_deref().or(texture), 1);

            encoder.draw_primitives(mtl::Primitive::TriangleStrip, 0, 4);
        }

        // Safety: no further commands are encoded after this, and the encoder
        // is dropped immediately below.
        unsafe { encoder.end_encoding() };
        cmd.commit();
        // Waited on rather than pipelined, which is what makes holding the
        // textures until here sufficient.
        //
        // This used to say an export is "throughput-bound on the decoder". It
        // is not: measured over 300 frames of 1080p from a real session, decode
        // is 6-9% of the wall clock, this render is 27-35%, and the encode that
        // follows it is 52-63%. Decode, Metal and VideoToolbox are three
        // independent engines and the loop drives them one at a time, so
        // overlapping render and encode is worth roughly 1.5×. It is not done
        // here because a frame in flight has to keep its textures alive past
        // this point — see `alive` below — and that is a real change rather
        // than a smaller wait.
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
            // Off. Only the pointer ever turns it on.
            smear: [0.0; 4],
            texel: [0.0; 2],
            // Opaque unless a watermark says otherwise — the one item that
            // draws a picture at less than its own alpha.
            alpha: 1.0,
            _tail: [0.0; 3],
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
            // Sharp unless the item asks otherwise, which only a caption does.
            soften: 0.0,
            // Drawn in its own colour unless the item asks otherwise, which
            // only a caption with nothing behind its glyphs does.
            adapt: 0.0,
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
                Paint::Image { path, blur } => {
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
                            //
                            src: cover(rect, held.texture.width(), held.texture.height()),
                            mode: MODE_IMAGE,
                            // Without this the blur does nothing at all: `base`
                            // leaves `texel` at zero, every tap offset
                            // multiplies out to zero, and all sixteen land on
                            // the same point. The captions carry the same note.
                            texel: [
                                1.0 / held.texture.width().max(1) as f32,
                                1.0 / held.texture.height().max(1) as f32,
                            ],
                            // The same tap loop the captions use — and, like it,
                            // measured in the *sampled image's* texels rather
                            // than in output pixels. A wallpaper is drawn well
                            // under its own resolution, so the setting's radius
                            // has to be converted or it reaches barely a pixel
                            // of a 3200-wide picture.
                            soften: (*blur
                                * source_per_output(
                                    cover(rect, held.texture.width(), held.texture.height()),
                                    rect,
                                    held.texture.width(),
                                ))
                                as f32,
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

            PlanItem::Watermark {
                path,
                dst_rect,
                opacity,
            } => {
                let Some(held) = self.images.get(path) else {
                    // Not loaded, or missing. Skipped rather than filled with
                    // anything, for the reason a missing background is: a solid
                    // rectangle where a logo should be looks like a fault, and
                    // no logo looks like no logo.
                    return Ok(None);
                };
                Some((
                    Uniforms {
                        rect: rect_of(dst_rect),
                        // The whole picture, undistorted. A watermark is placed
                        // at a size somebody chose rather than fitted to a box,
                        // so there is no crop to take — `cover` here would
                        // silently trim a wide logo to a square.
                        src: [0.0, 0.0, 1.0, 1.0],
                        // Square: a logo carries its own shape in its alpha, and
                        // rounding the quad would cut the corners off one drawn
                        // to the edges of its file.
                        shape: [0.0, 2.0],
                        mode: MODE_IMAGE,
                        alpha: *opacity as f32,
                        ..base
                    },
                    // Already held by `self.images`, so it needs no entry in
                    // this frame's keep-alive list.
                    Some(held.texture.as_ref()),
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

                // The streak needs room, so the quad is grown around the
                // sprite and the shader maps back off the padding. Half the
                // streak each side, because it is drawn centred on the
                // position. Mirrors the same three lines in `webgl.ts`.
                let streak = point.smear_x.hypot(point.smear_y);
                let pad = streak * 0.5;
                let grown = size + pad * 2.0;

                Some((
                    Uniforms {
                        // The sprite's own corners on a tilted picture, so it
                        // lies on the screen rather than standing upright in
                        // front of it. All zero without a tilt, which is what
                        // the vertex function reads as "use the rectangle".
                        // `dy` is the shadow's drop and means nothing here.
                        quad: corners_of(point.quad.as_ref().map_or(&[][..], |q| &q[..]), 0.0),
                        // The hotspot is the point that lands on the position:
                        // for an arrow that is its tip, not its middle, so the
                        // image is offset rather than centred.
                        //
                        // Still the drawn box when the corners above replace it
                        // as the pointer's position: the fragment function
                        // measures its one-pixel edge feather against this
                        // size, and `layout.ts` builds those corners from
                        // exactly this box divided back onto the picture.
                        rect: [
                            (point.x - hotspot.x * size - pad) as f32,
                            (point.y - hotspot.y * size - pad) as f32,
                            grown as f32,
                            grown as f32,
                        ],
                        // In the grown quad's own uv, which is what the shader
                        // works in. Off entirely below a pixel: a streak that
                        // short is not visible, and the taps cost the same
                        // whether they move or not.
                        smear: [
                            (point.smear_x / grown) as f32,
                            (point.smear_y / grown) as f32,
                            (pad / grown) as f32,
                            if streak >= 1.0 { 1.0 } else { 0.0 },
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
                tint,
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
                        // The two colours the shader mixes between, in the
                        // slots the image mode does not otherwise read.
                        color_a: tint.as_ref().map(|t| rgba(&t.on_dark)).unwrap_or([0.0; 4]),
                        color_b: tint.as_ref().map(|t| rgba(&t.on_light)).unwrap_or([0.0; 4]),
                        adapt: if tint.is_some() { 1.0 } else { 0.0 },
                        soften: draw.blur as f32,
                        // Against the texture's real size for the same reason
                        // the crop is. Without it the radius above has no unit
                        // and every tap lands on the same texel, which draws
                        // the word sharp on the export and soft in the
                        // preview.
                        texel: [
                            1.0 / held.texture.width().max(1) as f32,
                            1.0 / held.texture.height().max(1) as f32,
                        ],
                        ..base
                    },
                    Some(held.texture.as_ref()),
                ))
            }
        })
    }

    /// Copies what has been drawn under a rectangle out of the frame.
    ///
    /// The blit is the only way to read the target: Metal refuses to sample a
    /// texture that is attached to the pass drawing into it, so the caller ends
    /// the pass, calls this, and starts another that loads what was there.
    ///
    /// Mirrors `grabBackdrop` in `apps/desktop/src/renderer/src/editor/webgl.ts`
    /// — the same region, so the sixteen taps the shader takes across it land
    /// on the same picture in both.
    fn grab_backdrop(
        &mut self,
        cmd: &mut mtl::CmdBuf,
        target: &mtl::Texture,
        rect: &Rect,
        frame: Size,
    ) -> Result<()> {
        // Clamped into the frame: a caption at the very edge would otherwise
        // ask for pixels the texture does not have, which is a blit error
        // rather than a black stripe.
        let x = rect.x.max(0.0).round() as usize;
        let y = rect.y.max(0.0).round() as usize;
        let width = (rect.width.round() as usize)
            .min(target.width().saturating_sub(x))
            .max(1);
        let height = (rect.height.round() as usize)
            .min(target.height().saturating_sub(y))
            .max(1);
        if x >= target.width() || y >= target.height() {
            return Ok(());
        }
        let _ = frame;

        // Reallocated only when the size changes, which across a recording is
        // never: the caption box is the same shape for every cue.
        let stale = self
            .backdrop
            .as_ref()
            .is_none_or(|texture| texture.width() != width || texture.height() != height);
        if stale {
            let mut desc =
                mtl::TextureDesc::new_2d(mtl::PixelFormat::Bgra8UNorm, width, height, false);
            desc.set_usage(mtl::TextureUsage::SHADER_READ);
            self.backdrop = Some(
                self.device
                    .new_texture(&desc)
                    .ok_or_else(|| Error::Metal("could not make a backdrop texture".to_owned()))?,
            );
        }

        let Some(backdrop) = self.backdrop.as_mut() else {
            return Ok(());
        };

        cmd.blit(|blit| {
            blit.copy_texture(
                target,
                0,
                0,
                mtl::Origin { x, y, z: 0 },
                mtl::Size::_2d(width, height),
                backdrop,
                0,
                0,
                mtl::Origin::zero(),
            );
        });

        Ok(())
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

/// How many of the sampled image's own pixels one output pixel covers.
///
/// The twin of `sourcePerOutput` in `webgl.ts`. What turns a blur measured
/// against the frame into one the sampler can use: a wallpaper is drawn well
/// under its own resolution — 3200 pixels of picture across 1920 of frame — so
/// a radius handed straight to `soften` would reach a fraction of what the
/// setting asked for.
fn source_per_output(src: [f32; 4], rect: &Rect, width: usize) -> f64 {
    if rect.width <= 0.0 {
        return 0.0;
    }
    src[2] as f64 * width as f64 / rect.width
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
        // `focus` and `smear` are `float4`s, so both go on 16-byte boundaries
        // and the three `float2`s follow them. `smear` was added here rather
        // than at the end precisely so this block stays readable: every offset
        // below it moved by exactly 16, and none of them changed shape.
        assert_eq!(offset_of!(Uniforms, focus), 96);
        assert_eq!(offset_of!(Uniforms, smear), 112);
        assert_eq!(offset_of!(Uniforms, texel), 128);
        assert_eq!(offset_of!(Uniforms, shape), 136);
        assert_eq!(offset_of!(Uniforms, frame), 144);
        assert_eq!(offset_of!(Uniforms, color_a), 160);
        assert_eq!(offset_of!(Uniforms, color_b), 176);
        assert_eq!(offset_of!(Uniforms, gradient), 192);
        assert_eq!(offset_of!(Uniforms, mode), 200);
        assert_eq!(offset_of!(Uniforms, weight), 204);
        assert_eq!(offset_of!(Uniforms, mirror), 208);
        // The tail. Both are plain `float`s on 4-byte boundaries, and both sit
        // in padding the struct already carried — MSL rounds the whole thing up
        // to 224 either way, so adding one moved nothing above it.
        assert_eq!(offset_of!(Uniforms, vignette), 212);
        assert_eq!(offset_of!(Uniforms, soften), 216);
        assert_eq!(offset_of!(Uniforms, adapt), 220);

        // The first field that made the struct grow rather than filling padding
        // it already carried. MSL rounds to the next 16, so both sides are 240
        // and the tail is written out here because Rust would not add it.
        assert_eq!(offset_of!(Uniforms, alpha), 224);
        assert_eq!(align_of::<Uniforms>(), 4);
        assert_eq!(size_of::<Uniforms>(), 240);
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
