//! What a mask actually did to the pixels in the file.
//!
//! The one test that decides whether masking a *recording* is a feature or a
//! lie. A screenshot's mask is drawn by the same compositor that drew its
//! preview, so there is one rasteriser and nothing can disagree; a recording's
//! export runs `shaders.metal` while the preview runs the GLSL mirror in
//! `webgl.ts`, and until this branch existed the Metal side had no mask mode at
//! all — a masked recording exported with the pixels it was meant to hide.
//!
//! So shape assertions are worthless here. "The export ran", "it is the right
//! length", "the item parsed" all pass on a frame with the address still
//! legible in it. What is asserted is that the *detail is gone*: a source of
//! hard one-pixel stripes has enormous local contrast, and a patch that has
//! been averaged — by a blur or by a block — cannot keep it. Outside the patch
//! the stripes must survive untouched, or the mask is covering the frame rather
//! than the rectangle it was given.
//!
//! Needs no display and no Screen Recording grant.

use std::path::{Path, PathBuf};
use std::process::Command;

use cidre::{arc, cv};
use prequel_encode::{VideoWriter, VideoWriterConfig};
use prequel_render::{
    AudioMix, CancelFlag, ExportRequest, MaskKey, MaskMode, OutputFormat, PlanItem, PlanSource,
    Rect, RectKey, RenderPlan, SegmentRef, Shape, Size, SliceMedia, SliceRender, export,
};
use prequel_session::TrackKind;

const S: u64 = 1_000_000_000;

const OUT_W: u32 = 640;
const OUT_H: u32 = 360;
const FPS: u32 = 10;

/// How wide a stripe is, in source pixels.
///
/// Two, not one. A single-pixel stripe is at the limit of what h.264 keeps even
/// unmasked, and a test that cannot see its own control is no test — at two the
/// pattern survives the round trip with full contrast outside the patch.
const STRIPE: u32 = 2;

/// The patch, as fractions of the frame. Comfortably inside it on every side,
/// so "outside the patch" has room to be sampled honestly.
const PATCH: (f64, f64, f64, f64) = (0.25, 0.25, 0.5, 0.5);

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the scratch directory");
    dir
}

/// A BGRA buffer of hard vertical stripes, black and white.
fn striped_frame(width: u32, height: u32) -> arc::R<cv::PixelBuf> {
    let mut buf = cv::PixelBuf::new(
        width as usize,
        height as usize,
        cv::PixelFormat::_32_BGRA,
        None,
    )
    .expect("allocate a pixel buffer");

    unsafe {
        buf.lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("lock");

        let stride = buf.bytes_per_row();
        let base = buf.base_address_mut().cast::<u8>();

        for y in 0..height as usize {
            for x in 0..width as usize {
                let at = y * stride + x * 4;
                let level: u8 = if (x as u32 / STRIPE).is_multiple_of(2) {
                    0
                } else {
                    255
                };
                *base.add(at) = level;
                *base.add(at + 1) = level;
                *base.add(at + 2) = level;
                *base.add(at + 3) = 255;
            }
        }

        buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("unlock");
    }

    buf
}

fn record(dir: &Path, name: &str, width: u32, height: u32, frame: &arc::R<cv::PixelBuf>) {
    let mut writer = VideoWriter::create(
        &dir.join(name),
        &VideoWriterConfig::new(width, height).offline(),
    )
    .expect("create the source writer");

    for index in 0..FPS as u64 {
        writer
            .append(frame, index * (S / FPS as u64))
            .expect("append a source frame");
    }
    writer.finish().expect("finish the source");
}

struct Frame {
    pixels: Vec<u8>,
    width: u32,
}

impl Frame {
    fn at(&self, x: u32, y: u32) -> (u8, u8, u8) {
        let index = ((y * self.width + x) * 3) as usize;
        (
            self.pixels[index],
            self.pixels[index + 1],
            self.pixels[index + 2],
        )
    }

    /// The gap between the lightest and darkest pixel along a run, which is
    /// what a stripe pattern has and an average does not.
    ///
    /// Contrast rather than "did the pixels change": a gentle blur changes
    /// every pixel in the patch and leaves the stripes perfectly countable, so
    /// a difference test would pass on a mask that hides nothing.
    fn contrast(&self, x: u32, y: u32, across: u32) -> u8 {
        let mut low = u8::MAX;
        let mut high = u8::MIN;
        for step in 0..across {
            let (r, _, _) = self.at(x + step, y);
            low = low.min(r);
            high = high.max(r);
        }
        high - low
    }

    /// The average level along a run.
    ///
    /// The companion to `contrast`, and the assertion that was missing. The
    /// fixture is half black and half white, so anything that genuinely
    /// averages what it covers lands near the middle — while a cover that
    /// sampled outside its texture and got the clamped edge back is *also*
    /// perfectly flat, at nought or 255. Contrast alone cannot tell those
    /// apart, so for a fortnight it called a flat smear a working blur.
    fn mean(&self, x: u32, y: u32, across: u32) -> u8 {
        let mut total = 0u32;
        for step in 0..across {
            let (r, _, _) = self.at(x + step, y);
            total += u32::from(r);
        }
        (total / across.max(1)) as u8
    }
}

/// Read back through `ffmpeg` rather than by decoding here — the point is to
/// see what a player sees, and a bug in our own reader would otherwise cancel
/// out a bug in our own writer.
fn first_frame(video: &Path) -> Frame {
    let out = video.with_extension("rgb");
    let _ = std::fs::remove_file(&out);

    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(video)
        .args([
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-y",
        ])
        .arg(&out)
        .status()
        .expect("ffmpeg must be installed to verify exported pixels");

    assert!(
        status.success(),
        "ffmpeg could not decode {}",
        video.display()
    );

    let pixels = std::fs::read(&out).expect("read the decoded frame");
    let _ = std::fs::remove_file(&out);
    assert_eq!(pixels.len(), (OUT_W * OUT_H * 3) as usize);

    Frame {
        pixels,
        width: OUT_W,
    }
}

fn patch_rect() -> Rect {
    let (x, y, w, h) = PATCH;
    Rect {
        x: OUT_W as f64 * x,
        y: OUT_H as f64 * y,
        width: OUT_W as f64 * w,
        height: OUT_H as f64 * h,
    }
}

/// The frame, with the stripes across all of it and `mask` over the middle.
fn plan(mask: Option<(MaskMode, f64)>) -> RenderPlan {
    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };

    let mut items = vec![PlanItem::Image {
        source: PlanSource::Screen,
        src_rect: full,
        dst_rect: full,
        shape: Shape {
            radius: 0.0,
            exponent: 2.0,
        },
        mirror: false,
        matte: false,
        blobs: Vec::new(),
        motion: Vec::new(),
        grade: None,
    }];

    if let Some((mode, reach)) = mask {
        items.push(PlanItem::Mask {
            // The picture's geometry, which is the whole frame here.
            rect: full,
            src_rect: full,
            // The patch, in the picture's own uv — which for a picture drawn
            // across the whole frame is the same fractions `PATCH` names.
            region: vec![MaskKey {
                at: 0,
                x: PATCH.0,
                y: PATCH.1,
                width: PATCH.2,
                height: PATCH.3,
            }],
            mode,
            strength: 0.6,
            reach,
            // Still, like a screenshot's. The moving case is its own test.
            motion: Vec::new(),
        });
    }

    RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items,
        filter: None,
    }
}

/// The frame, with a cover whose patch is off to the left at zero and over the
/// middle by the moment under test.
///
/// The property this pins is the one the feature is sold on: a cover follows
/// what it covers. A patch that ignored its track would leave the middle of
/// this frame sharp and blur a strip away to the left instead.
fn moving_plan() -> RenderPlan {
    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };

    let away = MaskKey {
        at: -(S as i64),
        x: PATCH.0 - 0.5,
        y: PATCH.1,
        width: PATCH.2,
        height: PATCH.3,
    };
    let there = MaskKey {
        at: 0,
        x: PATCH.0,
        y: PATCH.1,
        width: PATCH.2,
        height: PATCH.3,
    };

    RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: full,
                dst_rect: full,
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                motion: Vec::new(),
                grade: None,
            },
            PlanItem::Mask {
                rect: full,
                src_rect: full,
                region: vec![away, there],
                mode: MaskMode::Blur,
                strength: 0.6,
                reach: 32.0,
                motion: Vec::new(),
            },
        ],
        filter: None,
    }
}

fn render_plan(name: &str, plan: RenderPlan) -> (PathBuf, Frame) {
    let dir = scratch(name);
    let source = striped_frame(OUT_W, OUT_H);
    record(&dir, "screen.mp4", OUT_W, OUT_H, &source);

    let output = dir.join("export.mp4");
    let request = ExportRequest {
        session_dir: dir.clone(),
        output: output.clone(),
        width: OUT_W,
        height: OUT_H,
        fps: FPS,
        format: OutputFormat::Mp4,
        slices: vec![SliceRender {
            start: 0,
            end: S,
            plan,
            audio: AudioMix::tracks(1.0, 1.0),
            speed: 1.0,
            media: SliceMedia {
                screen: Some(SegmentRef {
                    file: TrackKind::Screen.file_name().into(),
                    offset: 0,
                }),
                camera: None,
                matte: None,
                mic: None,
                system: None,
            },
        }],
        sound: None,
    };

    export(&request, &CancelFlag::new(), &mut |_| {}).expect("export");
    let frame = first_frame(&output);
    (dir, frame)
}

fn render(name: &str, mask: Option<(MaskMode, f64)>) -> (PathBuf, Frame) {
    render_plan(name, plan(mask))
}

/// A run well inside the patch, and one well outside it, both on the same row.
fn runs() -> ((u32, u32), (u32, u32)) {
    let rect = patch_rect();
    let y = OUT_H / 2;
    let inside = ((rect.x + rect.width / 2.0) as u32, y);
    // Left of the patch, and in from the frame's own edge so the run cannot
    // reach past it.
    let outside = (8, y);
    (inside, outside)
}

/// How many pixels each run is measured across. Comfortably more than one
/// stripe pair, so an unmasked run is guaranteed to contain both levels.
const ACROSS: u32 = 16;

#[test]
fn a_mask_covers_where_its_track_says_and_not_where_it_started() {
    let (dir, frame) = render_plan("prequel-mask-moving", moving_plan());
    let ((ix, iy), (ox, oy)) = runs();

    let inside = frame.contrast(ix, iy, ACROSS);
    let outside = frame.contrast(ox, oy, ACROSS);

    assert!(
        inside < 40,
        "the cover did not follow its track — contrast {inside} where the mask should be"
    );
    assert!(
        outside > 200,
        "the frame outside the track's rectangle should be untouched, got {outside}"
    );

    let _ = std::fs::remove_dir_all(dir);
}

/// The frame leaning away, with a cover over the middle of the picture.
///
/// The case the old arrangement could not do at all. A cover laid on the
/// finished frame is an axis-aligned rectangle in output pixels, and a leaning
/// picture is a trapezium — so a rectangle over it covers the wrong corners,
/// and the further it leans the more of the thing it was hiding shows past the
/// edge.
///
/// Drawn in the picture's own quad, the lean is the vertex function's business
/// and the cover never learns it happened.
fn leaning_plan() -> RenderPlan {
    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };

    // A quad leaning back: the top edge narrower than the bottom, with the
    // projective divisor that goes with it. The same twelve numbers
    // `buildRenderPlan` emits for a tilt.
    let lean = 0.18;
    let quad = vec![
        OUT_W as f64 * lean,
        0.0,
        1.0 + lean,
        OUT_W as f64 * (1.0 - lean),
        0.0,
        1.0 + lean,
        0.0,
        OUT_H as f64,
        1.0,
        OUT_W as f64,
        OUT_H as f64,
        1.0,
    ];

    RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: full,
                dst_rect: full,
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                motion: vec![key(full, quad.clone())],
                grade: None,
            },
            PlanItem::Mask {
                rect: full,
                src_rect: full,
                region: vec![MaskKey {
                    at: 0,
                    x: PATCH.0,
                    y: PATCH.1,
                    width: PATCH.2,
                    height: PATCH.3,
                }],
                mode: MaskMode::Blur,
                strength: 0.6,
                reach: 32.0,
                // The picture's own track, verbatim — which is what carries the
                // lean into the cover's quad.
                motion: vec![key(full, quad)],
            },
        ],
        filter: None,
    }
}

fn key(rect: Rect, quad: Vec<f64>) -> RectKey {
    RectKey {
        at: 0,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        radius: 0.0,
        focus: None,
        vignette: None,
        quad,
    }
}

#[test]
fn a_cover_leans_with_the_picture() {
    let (dir, frame) = render_plan("prequel-mask-leaning", leaning_plan());

    // The middle of the picture, where the patch is, and a row near the bottom
    // outside it. A leaning picture still has the stripes everywhere the cover
    // is not.
    let inside = frame.contrast(OUT_W / 2 - ACROSS / 2, OUT_H / 2, ACROSS);
    let outside = frame.contrast(OUT_W / 2 - ACROSS / 2, OUT_H - 20, ACROSS);

    assert!(
        inside < 40,
        "the stripes survived under a leaning cover — contrast {inside}"
    );
    assert!(
        outside > 150,
        "the lean's own picture should be sharp outside the patch, got {outside}"
    );

    // And an average of the stripes rather than a flat nothing, as in the
    // unleaned cases. A projective quad is where a cover sampling the wrong
    // uv shows up worst, because the error varies across the patch.
    let level = frame.mean(OUT_W / 2 - ACROSS / 2, OUT_H / 2, ACROSS);
    assert!(
        (96..=160).contains(&level),
        "the leaning cover is flat but not an average of what it covers — level {level}"
    );

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_control_has_the_contrast_the_others_are_measured_against() {
    // Without this the two tests below prove nothing: a frame that came out
    // flat grey everywhere would pass them both.
    let (dir, frame) = render("prequel-mask-none", None);
    let ((ix, iy), (ox, oy)) = runs();

    assert!(
        frame.contrast(ix, iy, ACROSS) > 200,
        "unmasked stripes should be near full contrast, got {}",
        frame.contrast(ix, iy, ACROSS)
    );
    assert!(frame.contrast(ox, oy, ACROSS) > 200);

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_blur_destroys_the_detail_under_it_and_nothing_else() {
    // 32 output pixels of blur over a 2px stripe pattern: sixteen stripe pairs
    // inside the kernel, which no amount of luck leaves countable.
    let (dir, frame) = render("prequel-mask-blur", Some((MaskMode::Blur, 32.0)));
    let ((ix, iy), (ox, oy)) = runs();

    let inside = frame.contrast(ix, iy, ACROSS);
    let outside = frame.contrast(ox, oy, ACROSS);

    assert!(
        inside < 40,
        "the stripes survived the blur — contrast {inside} inside the patch"
    );
    assert!(
        outside > 200,
        "the blur reached outside its rectangle — contrast {outside} where the frame should be sharp"
    );

    // And it is an average of the stripes rather than a flat nothing. Half the
    // fixture is black and half white, so hiding it properly lands mid-grey;
    // a cover sampling off the edge of its texture is just as flat and either
    // nearly black or nearly white.
    let level = frame.mean(ix, iy, ACROSS);
    assert!(
        (96..=160).contains(&level),
        "the blur is flat but not an average of what it covers — level {level}, so it is \
         sampling something other than the picture"
    );

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_mosaic_destroys_the_detail_under_it_and_nothing_else() {
    // A block of 24 output pixels against a 2px stripe: each block averages a
    // dozen pairs, so it cannot come out as anything but a flat tone.
    let (dir, frame) = render("prequel-mask-pixelate", Some((MaskMode::Pixelate, 24.0)));
    let ((ix, iy), (ox, oy)) = runs();

    let inside = frame.contrast(ix, iy, ACROSS);
    let outside = frame.contrast(ox, oy, ACROSS);

    assert!(
        inside < 40,
        "the stripes survived the mosaic — contrast {inside} inside the patch"
    );
    assert!(
        outside > 200,
        "the mosaic reached outside its rectangle — contrast {outside} where the frame should be sharp"
    );

    // Each block is the mean of a tap grid over a half-black fixture, so the
    // mosaic lands mid-grey for the same reason the blur does — and fails the
    // same way if it is sampling anything but the picture.
    let level = frame.mean(ix, iy, ACROSS);
    assert!(
        (96..=160).contains(&level),
        "the mosaic is flat but not an average of what it covers — level {level}"
    );

    let _ = std::fs::remove_dir_all(dir);
}
