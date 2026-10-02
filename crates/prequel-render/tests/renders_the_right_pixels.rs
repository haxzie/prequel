//! What actually came out, pixel by pixel.
//!
//! The composite tests check shape — duration, frame count, dimensions — which
//! a wrong-looking export passes happily. These check colour at known
//! coordinates, which is the only thing that catches the two failures this file
//! was written for: a camera stretched because the crop never reached the
//! shader, and a background image that silently drew nothing because its
//! texture had been freed.
//!
//! Needs no display and no Screen Recording grant.

use std::path::{Path, PathBuf};
use std::process::Command;

use cidre::{arc, cv};
use prequel_encode::{VideoWriter, VideoWriterConfig};
use prequel_render::{
    AudioMix, BlobKey, CancelFlag, CursorPoint, CursorShadow, ExportRequest, LoupeKey,
    OutputFormat, OverlayKey, Paint, PlanItem, PlanSource, Point, Rect, RectKey, RenderPlan,
    SegmentRef, Shape, Size, SliceMedia, SliceRender, Span, export,
};
use prequel_session::{CAMERA_MATTE_FILE, TrackKind};

const S: u64 = 1_000_000_000;
const OUT_W: u32 = 320;
const OUT_H: u32 = 240;
const FPS: u32 = 10;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the scratch directory");
    dir
}

/// A BGRA buffer whose left half is one colour and right half another.
///
/// A split image rather than a flat one: a crop that is ignored shows up as
/// the wrong half filling the frame, which a single colour could never reveal.
fn split_frame(width: u32, height: u32, left: [u8; 3], right: [u8; 3]) -> arc::R<cv::PixelBuf> {
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
                let [r, g, b] = if x < width as usize / 2 { left } else { right };
                // BGRA
                *base.add(at) = b;
                *base.add(at + 1) = g;
                *base.add(at + 2) = r;
                *base.add(at + 3) = 255;
            }
        }

        buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("unlock");
    }

    buf
}

/// Writes a one-second video of `frame` into `dir`.
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

/// The exported video's first frame, as packed RGB.
///
/// Decoded whole and indexed rather than cropped per sample: one decode serves
/// every assertion, and `crop` in ffmpeg 8 rejects the sizes this needs.
///
/// Read back through `ffmpeg` rather than by decoding here — the point is to
/// see what a player sees, and a bug in our own reader would otherwise cancel
/// out a bug in our own writer.
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
}

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

    let expected = (OUT_W * OUT_H * 3) as usize;
    assert_eq!(pixels.len(), expected, "decoded frame is the wrong size");

    Frame {
        pixels,
        width: OUT_W,
    }
}

/// Roughly equal, since the frame has been through a lossy encoder.
fn near(actual: (u8, u8, u8), expected: (u8, u8, u8), what: &str) {
    let delta = |a: u8, b: u8| (a as i16 - b as i16).abs();
    let off =
        delta(actual.0, expected.0) + delta(actual.1, expected.1) + delta(actual.2, expected.2);

    assert!(
        off < 90,
        "{what}: expected about {expected:?}, got {actual:?}",
    );
}

fn slice(plan: RenderPlan) -> SliceRender {
    SliceRender {
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
            camera: Some(SegmentRef {
                file: TrackKind::Camera.file_name().into(),
                offset: 0,
            }),
            matte: Some(CAMERA_MATTE_FILE.into()),
            mic: None,
            system: None,
        },
    }
}

fn request(dir: &Path, output: &Path, slices: Vec<SliceRender>) -> ExportRequest {
    ExportRequest {
        session_dir: dir.to_path_buf(),
        output: output.to_path_buf(),
        width: OUT_W,
        height: OUT_H,
        fps: FPS,
        format: OutputFormat::Mp4,
        slices,
        sound: None,
    }
}

#[test]
fn honours_the_crop_rather_than_stretching_the_source() {
    // The camera bug: a wide source centre-cropped to a square. If the crop
    // never reaches the shader, the whole frame is sampled edge to edge and the
    // *left* half shows up on the left. With the crop honoured, the sampled
    // window sits entirely inside the right half, so both sides read red.
    let dir = scratch("prequel-pixels-crop");
    let source = split_frame(400, 200, [0, 0, 255], [255, 0, 0]);
    record(&dir, "screen.mp4", 400, 200, &source);

    let output = dir.join("export.mp4");
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![PlanItem::Image {
            source: PlanSource::Screen,
            // The right half only.
            src_rect: Rect {
                x: 200.0,
                y: 0.0,
                width: 200.0,
                height: 200.0,
            },
            dst_rect: Rect {
                x: 0.0,
                y: 0.0,
                width: OUT_W as f64,
                height: OUT_H as f64,
            },
            shape: Shape {
                radius: 0.0,
                exponent: 2.0,
            },
            mirror: false,
            matte: false,
            blobs: Vec::new(),
            grade: None,
            motion: Vec::new(),
        }],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    // Both sides come from the red half. Blue anywhere means the crop was
    // ignored and the source was stretched across the frame.
    let frame = first_frame(&output);
    near(frame.at(40, 120), (255, 0, 0), "left of the cropped frame");
    near(
        frame.at(280, 120),
        (255, 0, 0),
        "right of the cropped frame",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn mirroring_flips_the_crop_rather_than_moving_it() {
    // Mirroring is applied before the crop is mapped, so it flips *within* the
    // sampled window. Getting the order wrong samples somewhere else entirely.
    let dir = scratch("prequel-pixels-mirror");
    let source = split_frame(400, 200, [0, 0, 255], [255, 0, 0]);
    record(&dir, "screen.mp4", 400, 200, &source);

    let output = dir.join("export.mp4");
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![PlanItem::Image {
            motion: Vec::new(),
            source: PlanSource::Screen,
            src_rect: Rect {
                x: 200.0,
                y: 0.0,
                width: 200.0,
                height: 200.0,
            },
            dst_rect: Rect {
                x: 0.0,
                y: 0.0,
                width: OUT_W as f64,
                height: OUT_H as f64,
            },
            shape: Shape {
                radius: 0.0,
                exponent: 2.0,
            },
            mirror: true,
            matte: false,
            blobs: Vec::new(),
            grade: None,
        }],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    // Still entirely red: the window is inside the red half, and flipping it
    // cannot reach the blue one.
    let frame = first_frame(&output);
    near(frame.at(40, 120), (255, 0, 0), "mirrored crop");
    near(frame.at(280, 120), (255, 0, 0), "mirrored crop");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn draws_an_image_background() {
    // The background bug: the texture was created from a pixel buffer that was
    // freed the moment `add_image` returned, so it sampled nothing and the
    // background never appeared.
    let dir = scratch("prequel-pixels-background");

    // A green source, drawn small so the background shows around it.
    let source = split_frame(200, 200, [0, 255, 0], [0, 255, 0]);
    record(&dir, "screen.mp4", 200, 200, &source);

    // The background: a blue/red split PNG written with the same encoder path
    // the app uses for its wallpaper copy.
    let background = split_frame(200, 200, [0, 0, 255], [0, 0, 255]);
    write_png(&dir.join("background.png"), &background);

    let output = dir.join("export.mp4");
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Fill {
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                paint: Paint::Image {
                    path: "background.png".to_owned(),
                    blur: 0.0,
                },
            },
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 200.0,
                    height: 200.0,
                },
                // Inset, so the background is visible at the edges.
                dst_rect: Rect {
                    x: 110.0,
                    y: 80.0,
                    width: 100.0,
                    height: 80.0,
                },
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                grade: None,
                motion: Vec::new(),
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    // The corner is background; the middle is the screen on top of it.
    let frame = first_frame(&output);
    near(frame.at(20, 20), (0, 0, 255), "background corner");
    near(
        frame.at(160, 120),
        (0, 255, 0),
        "screen over the background",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_translucent_layer_lands_at_the_opacity_it_asks_for() {
    // The alpha bug: `image.rs` decodes premultiplied and the shader used to
    // hand back straight alpha into a `SrcAlpha` blend, so every translucent
    // thing drew at its own opacity squared — white at 50% arriving as 64
    // rather than 128.
    //
    // It hid for as long as it did because nothing translucent was ever
    // coloured: a background is opaque, and a shadow is black, where `0 * a * a`
    // is still 0. A caption pill is neither.
    let dir = scratch("prequel-pixels-alpha");
    let output = dir.join("export.mp4");

    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };

    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Fill {
                rect: full,
                paint: Paint::Solid {
                    color: "#000000".to_owned(),
                },
            },
            PlanItem::Fill {
                rect: full,
                paint: Paint::Solid {
                    color: "rgba(255, 255, 255, 0.5)".to_owned(),
                },
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    // Half of white over black is mid grey. Squaring the alpha gives 64, which
    // is 192 away across the three channels and well outside `near`'s tolerance.
    let frame = first_frame(&output);
    near(
        frame.at(160, 120),
        (128, 128, 128),
        "half-opacity white on black",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// One frame of the exported video, by index, as packed RGB.
///
/// `first_frame` is not enough for anything that changes over time: a pointer
/// that swapped shape would be checked only where it started.
fn frame_at(video: &Path, index: u32) -> Frame {
    let out = video.with_extension(format!("{index}.rgb"));
    let _ = std::fs::remove_file(&out);

    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(video)
        .args([
            "-vf",
            &format!("select=eq(n\\,{index})"),
            // `-fps_mode passthrough`, not the `-vsync 0` this used to say.
            // They mean the same thing — keep the frame the filter selected
            // rather than duplicating or dropping to hit a rate — but `-vsync`
            // was removed in ffmpeg 8, and the runner installs whatever brew
            // has. The failure is "Unrecognized option 'vsync'" followed by
            // this helper reporting that the frame could not be decoded, which
            // reads as the exporter having written a bad file.
            "-fps_mode",
            "passthrough",
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

    assert!(status.success(), "ffmpeg could not decode frame {index}");

    let pixels = std::fs::read(&out).expect("read the decoded frame");
    let _ = std::fs::remove_file(&out);
    assert_eq!(pixels.len(), (OUT_W * OUT_H * 3) as usize);

    Frame {
        pixels,
        width: OUT_W,
    }
}

/// A solid square, for a pointer image whose colour is the whole assertion.
fn solid(size: u32, colour: [u8; 3]) -> arc::R<cv::PixelBuf> {
    split_frame(size, size, colour, colour)
}

/// A small opaque mark in a transparent texture, so a cursor shadow test can
/// distinguish the sprite's silhouette from the padded quad around it.
fn transparent_cursor(size: u32) -> arc::R<cv::PixelBuf> {
    let mut buf = cv::PixelBuf::new(
        size as usize,
        size as usize,
        cv::PixelFormat::_32_BGRA,
        None,
    )
    .expect("allocate the transparent cursor");

    unsafe {
        buf.lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("lock");
        let stride = buf.bytes_per_row();
        let base = buf.base_address_mut().cast::<u8>();
        let inset = size / 4;
        for y in 0..size as usize {
            for x in 0..size as usize {
                let at = y * stride + x * 4;
                let marked = x >= inset as usize
                    && x < (size - inset) as usize
                    && y >= inset as usize
                    && y < (size - inset) as usize;
                let edge_probe = x == 0 && y == 0;
                // BGRA. Transparent pixels must also be black, or premultiplied
                // alpha leaves a coloured fringe when Metal samples their edge.
                *base.add(at) = 0;
                *base.add(at + 1) = 0;
                *base.add(at + 2) = if marked { 255 } else { 0 };
                *base.add(at + 3) = if marked || edge_probe { 255 } else { 0 };
            }
        }
        buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("unlock");
    }

    buf
}

#[test]
fn swaps_the_pointer_image_partway_through() {
    // The pointer becomes a hand over a link, which the plan expresses as two
    // cursor items whose visible spans do not overlap. The exporter has to hold
    // both textures and draw whichever the moment belongs to — load only the
    // first and the pointer disappears over every link, in the file and nowhere
    // in the preview, which is the worst place to find out.
    let dir = scratch("prequel-pixels-cursor-shape");

    // Black behind, so a red pointer and a blue one are unmistakable.
    let source = solid(200, [0, 0, 0]);
    record(&dir, "screen.mp4", 200, 200, &source);

    write_png(&dir.join("arrow.png"), &solid(64, [255, 0, 0]));
    write_png(&dir.join("hand.png"), &solid(64, [0, 0, 255]));

    // Both pointers land centred on the middle of the frame, so one coordinate
    // answers "which image is on screen" at any moment.
    let centre = Point { x: 0.5, y: 0.5 };
    let swap = 4 * S / 10;
    let point = |at: i64, visible: bool| CursorPoint {
        at,
        x: (OUT_W / 2) as f64,
        y: (OUT_H / 2) as f64,
        scale: 1.0,
        visible,
        quad: None,
        // Sharp. This test is about which pointer image is on screen when, and
        // a streak would soften exactly the pixels it samples to decide.
        smear_x: 0.0,
        smear_y: 0.0,
    };

    let output = dir.join("export.mp4");
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 200.0,
                    height: 200.0,
                },
                dst_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                grade: None,
                motion: Vec::new(),
            },
            PlanItem::Cursor {
                path: "arrow.png".to_owned(),
                size: 80.0,
                hotspot: centre,
                shadow: None,
                // Hands over a nanosecond before the swap, the way
                // `splitByShape` writes it.
                points: vec![
                    point(0, true),
                    point(swap as i64 - 1, true),
                    point(swap as i64, false),
                    point(S as i64, false),
                ],
            },
            PlanItem::Cursor {
                path: "hand.png".to_owned(),
                size: 80.0,
                hotspot: centre,
                shadow: None,
                points: vec![
                    point(0, false),
                    point(swap as i64 - 1, false),
                    point(swap as i64, true),
                    point(S as i64, true),
                ],
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    // Frame 0 is before the swap and frame 8 is after it.
    near(
        frame_at(&output, 0).at(OUT_W / 2, OUT_H / 2),
        (255, 0, 0),
        "the arrow before the swap",
    );
    near(
        frame_at(&output, 8).at(OUT_W / 2, OUT_H / 2),
        (0, 0, 255),
        "the hand after the swap",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn keeps_a_static_pointer_shadow_inside_its_silhouette() {
    // The moving cursor path rejects samples outside its sprite. The static
    // path used to let Metal's clamp-to-edge sampler copy the texture edge over
    // the shadow padding, which rendered a dark rectangle only when the pointer
    // stopped. This checks the export pixels where the padding must stay white.
    let dir = scratch("prequel-pixels-cursor-shadow");
    let source = solid(200, [255, 255, 255]);
    record(&dir, "screen.mp4", 200, 200, &source);
    write_png_with_alpha(&dir.join("cursor.png"), &transparent_cursor(64));

    let output = dir.join("export.mp4");
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 200.0,
                    height: 200.0,
                },
                dst_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                grade: None,
                motion: Vec::new(),
            },
            PlanItem::Cursor {
                path: "cursor.png".to_owned(),
                size: 80.0,
                hotspot: Point { x: 0.5, y: 0.5 },
                shadow: Some(CursorShadow {
                    opacity: 0.2,
                    // Zero blur exercises the sampler's no-tap path: if it
                    // clamps an outside shadow coordinate, the opaque corner
                    // probe above becomes a rectangle around the pointer.
                    blur: 0.0,
                    dy: 4.0,
                }),
                points: vec![CursorPoint {
                    at: 0,
                    x: (OUT_W / 2) as f64,
                    y: (OUT_H / 2) as f64,
                    scale: 1.0,
                    visible: true,
                    quad: None,
                    smear_x: 0.0,
                    smear_y: 0.0,
                }],
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = frame_at(&output, 0);
    near(
        frame.at(116, 76),
        (255, 255, 255),
        "the static cursor shadow padding",
    );
    near(
        frame.at(OUT_W / 2, OUT_H / 2),
        (255, 0, 0),
        "the static cursor itself",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn lays_the_pointer_on_a_tilted_picture() {
    // The compositor read a cursor's position out of `rect` and nothing else,
    // so a plan carrying the sprite's projected corners was drawn as an upright
    // square in the middle of the frame — the corners computed, serialised,
    // parsed and then dropped on the floor. Nothing but pixels catches that:
    // the plan is right, `cursor_at` hands back the right twelve numbers, and
    // every shape assertion there is passes on a picture that ignores them.
    let dir = scratch("prequel-pixels-cursor-tilt");

    let source = solid(200, [0, 0, 0]);
    record(&dir, "screen.mp4", 200, 200, &source);
    write_png(&dir.join("arrow.png"), &solid(64, [255, 255, 255]));

    let centre = Point { x: 0.5, y: 0.5 };
    const SPRITE: f64 = 40.0;

    // Well clear of where the upright square would be drawn, and leaning: the
    // right edge is nearer the eye, so it is both taller and carries the
    // smaller divisor. Written by hand rather than built from a zoom, because
    // the plan is this side's input — what is under test is whether the
    // compositor honours corners, not whether it can work them out.
    let left = (OUT_W / 2) as f64 + 60.0;
    let right = (OUT_W / 2) as f64 + 120.0;
    let middle = (OUT_H / 2) as f64;
    let quad = [
        left,
        middle - 14.0,
        1.25, // top-left, leaning away
        right,
        middle - 26.0,
        0.8, // top-right, nearer
        left,
        middle + 14.0,
        1.25, // bottom-left
        right,
        middle + 26.0,
        0.8, // bottom-right
    ];

    let point = |at: i64| CursorPoint {
        at,
        x: (OUT_W / 2) as f64,
        y: (OUT_H / 2) as f64,
        scale: 1.0,
        visible: true,
        smear_x: 0.0,
        smear_y: 0.0,
        quad: Some(quad),
    };

    let output = dir.join("export.mp4");
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 200.0,
                    height: 200.0,
                },
                dst_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                grade: None,
                motion: Vec::new(),
            },
            PlanItem::Cursor {
                path: "arrow.png".to_owned(),
                size: SPRITE,
                hotspot: centre,
                shadow: None,
                points: vec![point(0), point(S as i64)],
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = frame_at(&output, 2);
    let lit = |pixel: (u8, u8, u8)| pixel.0 as u16 + pixel.1 as u16 + pixel.2 as u16;

    // Inside the quad, and nowhere near the square `rect` describes.
    let on_plane = lit(frame.at(OUT_W / 2 + 90, OUT_H / 2));
    // Where the upright sprite used to be drawn: the middle of the frame.
    let upright = lit(frame.at(OUT_W / 2, OUT_H / 2));

    assert!(
        on_plane > 600,
        "the pointer should be drawn on its own corners, got {on_plane}"
    );
    assert!(
        upright < 30,
        "nothing should be left where the upright square was, got {upright}"
    );

    // And it leans: the right edge is taller than the left, so a point above
    // the quad's left end is outside it while the same height at the right end
    // is inside. A translation would pass the two checks above and fail these.
    assert!(
        lit(frame.at(OUT_W / 2 + 115, OUT_H / 2 - 20)) > 600,
        "the near edge should reach further from the middle"
    );
    assert!(
        lit(frame.at(OUT_W / 2 + 62, OUT_H / 2 - 20)) < 30,
        "the far edge should not"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn smears_the_pointer_along_the_way_it_is_going() {
    // The whole of motion blur is its direction, and nothing downstream can
    // catch that being wrong: the editor computes the streak once and both
    // rasterisers draw whatever vector they are handed. So this asserts the
    // pixels — a streak drawn across the path instead of along it, or one drawn
    // at the wrong end, passes every shape assertion there is.
    let dir = scratch("prequel-pixels-cursor-smear");

    let source = solid(200, [0, 0, 0]);
    record(&dir, "screen.mp4", 200, 200, &source);
    write_png(&dir.join("arrow.png"), &solid(64, [255, 255, 255]));

    let centre = Point { x: 0.5, y: 0.5 };
    // Two pointers' worth, horizontal. Drawn centred on the position, so the
    // lit run reaches SPRITE / 2 + SMEAR / 2 either side of the middle.
    const SPRITE: f64 = 40.0;
    const SMEAR: f64 = 80.0;

    let point = |at: i64| CursorPoint {
        at,
        x: (OUT_W / 2) as f64,
        y: (OUT_H / 2) as f64,
        scale: 1.0,
        visible: true,
        smear_x: SMEAR,
        smear_y: 0.0,
        quad: None,
    };

    let output = dir.join("export.mp4");
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 200.0,
                    height: 200.0,
                },
                dst_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                grade: None,
                motion: Vec::new(),
            },
            PlanItem::Cursor {
                path: "arrow.png".to_owned(),
                size: SPRITE,
                hotspot: centre,
                shadow: None,
                points: vec![point(0), point(S as i64)],
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = frame_at(&output, 2);
    let middle = (OUT_W / 2, OUT_H / 2);
    let lit = |pixel: (u8, u8, u8)| pixel.0 as u16 + pixel.1 as u16 + pixel.2 as u16;

    // Well past the sprite's own edge, along the streak. Sharp, this is black.
    let along = lit(frame.at(middle.0 + 40, middle.1));
    // The same distance across it, where nothing is travelling.
    let across = lit(frame.at(middle.0, middle.1 + 40));

    assert!(
        along > 90,
        "the streak should reach 40px along the travel, got {along}"
    );
    assert!(
        across < 30,
        "nothing should be smeared across the travel, got {across}"
    );
    // And the sprite is still the brightest thing: a smear that dimmed the
    // pointer itself as much as its tail would read as the pointer fading.
    assert!(
        lit(frame.at(middle.0, middle.1)) > along,
        "the pointer should stay brighter than its own streak"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// Writes a pixel buffer out as a PNG, so the exporter has a real file to
/// decode rather than one this test hand-rolled.
fn write_png(path: &Path, buffer: &arc::R<cv::PixelBuf>) {
    let raw = path.with_extension("rgb");
    let width = buffer.width();
    let height = buffer.height();

    let mut bytes = Vec::with_capacity(width * height * 3);
    unsafe {
        let mut buffer = buffer.clone();
        buffer
            .lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
            .result()
            .expect("lock");

        let stride = buffer.bytes_per_row();
        let base = buffer.base_address().cast::<u8>();

        for y in 0..height {
            for x in 0..width {
                let at = y * stride + x * 4;
                bytes.push(*base.add(at + 2));
                bytes.push(*base.add(at + 1));
                bytes.push(*base.add(at));
            }
        }

        buffer
            .unlock_lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
            .result()
            .expect("unlock");
    }

    std::fs::write(&raw, &bytes).expect("write the raw background");

    let status = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            &format!("{width}x{height}"),
            "-i",
        ])
        .arg(&raw)
        .arg("-y")
        .arg(path)
        .status()
        .expect("ffmpeg must be installed to build the background fixture");

    assert!(status.success(), "could not write the background PNG");
    let _ = std::fs::remove_file(&raw);
}

/// Writes a BGRA PNG without discarding alpha, which is needed for cursor
/// fixtures: flattening it to RGB would make the shadow test assert a full
/// rectangle rather than the pointer's actual silhouette.
fn write_png_with_alpha(path: &Path, buffer: &arc::R<cv::PixelBuf>) {
    let raw = path.with_extension("bgra");
    let width = buffer.width();
    let height = buffer.height();
    let mut bytes = Vec::with_capacity(width * height * 4);

    unsafe {
        let mut buffer = buffer.clone();
        buffer
            .lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
            .result()
            .expect("lock");
        let stride = buffer.bytes_per_row();
        let base = buffer.base_address().cast::<u8>();
        for y in 0..height {
            for x in 0..width {
                let at = y * stride + x * 4;
                bytes.extend_from_slice(std::slice::from_raw_parts(base.add(at), 4));
            }
        }
        buffer
            .unlock_lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
            .result()
            .expect("unlock");
    }

    std::fs::write(&raw, &bytes).expect("write the raw cursor");
    let status = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgra",
            "-s",
            &format!("{width}x{height}"),
            "-i",
        ])
        .arg(&raw)
        .args(["-frames:v", "1", "-y"])
        .arg(path)
        .status()
        .expect("ffmpeg must be installed to build the cursor PNG");
    assert!(status.success(), "could not write the cursor PNG");
    let _ = std::fs::remove_file(&raw);
}

#[test]
fn a_motion_track_moves_the_picture_over_the_clip() {
    // Every moving thing in a plan is a track of rectangles: a zoom pushing in,
    // and a camera travelling to the place the next arrangement puts it. If the
    // track never reaches the shader the picture simply sits at `dst_rect` for
    // the whole clip — an export that is a still of the opening frame, which
    // looks exactly like an export that was meant to hold still.
    //
    // So: a red picture that starts on the left of a blue frame and ends on the
    // right. Sampling both halves at both ends is what tells "it moved" apart
    // from "it was always there".
    let dir = scratch("prequel-pixels-motion");
    let source = split_frame(400, 200, [255, 0, 0], [255, 0, 0]);
    record(&dir, "screen.mp4", 400, 200, &source);

    let left = Rect {
        x: 20.0,
        y: 70.0,
        width: 100.0,
        height: 100.0,
    };
    let right = Rect { x: 200.0, ..left };

    let key = |at: i64, rect: Rect| RectKey {
        at,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        radius: 0.0,
        focus: None,
        vignette: None,
        quad: Vec::new(),
    };

    let output = dir.join("export.mp4");
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Fill {
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                paint: Paint::Solid {
                    color: "#0000ff".into(),
                },
            },
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 400.0,
                    height: 200.0,
                },
                // Where it rests, which the track overrides for the whole of the
                // move. Set to the destination so a dropped track fails this
                // test on the *first* frame rather than passing on the last.
                dst_rect: right,
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                grade: None,
                motion: vec![key(0, left), key((S / 2) as i64, right)],
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let opening = frame_at(&output, 0);
    near(opening.at(70, 120), (255, 0, 0), "the picture at the start");
    near(
        opening.at(250, 120),
        (0, 0, 255),
        "where it has not gone yet",
    );

    // Past the end of the track, which holds the last key — so this also pins
    // that a move ends where it was going and stays there.
    let settled = frame_at(&output, 9);
    near(settled.at(70, 120), (0, 0, 255), "where it came from");
    near(settled.at(250, 120), (255, 0, 0), "the picture at the end");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn draws_a_border_of_one_width_all_the_way_round() {
    // The border bug. A stroke was drawn as a band centred on the picture's
    // edge, so half of it fell outside the rectangle the quad covers — and a
    // fragment shader cannot paint outside its own geometry. Along a straight
    // edge that half was simply missing, so a 16px border drew 8px; at a corner
    // the square quad still covers the area outside the curve, so the whole
    // band survived there. Thin sides and fat corners read as corners of the
    // wrong radius, which is how it was reported.
    //
    // Pinned in pixels because every shape assertion passes on it: the item is
    // in the plan, its width is right, and the export is the right size.
    let dir = scratch("prequel-pixels-border");
    let source = split_frame(200, 200, [255, 255, 255], [255, 255, 255]);
    record(&dir, "screen.mp4", 200, 200, &source);

    // Inset far enough that the background shows all round it, with a border
    // wide enough that half of it is unmistakable.
    let picture = Rect {
        x: 40.0,
        y: 40.0,
        width: 240.0,
        height: 160.0,
    };
    let radius = 30.0;
    let width = 16.0;

    let output = dir.join("export.mp4");
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Fill {
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                paint: Paint::Solid {
                    color: "#0000ff".into(),
                },
            },
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 200.0,
                    height: 200.0,
                },
                dst_rect: picture,
                shape: Shape {
                    radius,
                    exponent: 2.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                grade: None,
                motion: Vec::new(),
            },
            PlanItem::Stroke {
                rect: picture,
                shape: Shape {
                    radius,
                    exponent: 2.0,
                },
                width,
                color: "#ff0000".into(),
                motion: Vec::new(),
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = first_frame(&output);

    // Three quarters of the way through the border on a straight edge. With
    // only the inner half drawn this is the white picture.
    near(frame.at(160, 52), (255, 0, 0), "the middle of the top edge");
    // And the picture starts where the border ends, rather than a third of the
    // way into it.
    near(frame.at(160, 62), (255, 255, 255), "inside the top edge");

    // The corner, along the diagonal from the arc's centre at (70, 70). Just
    // outside the curve is background: a border that bulges past the silhouette
    // is one the shadow no longer fits.
    near(frame.at(45, 45), (0, 0, 255), "outside the top-left corner");
    // And just inside it is border, the same as the straight edges above.
    near(frame.at(55, 55), (255, 0, 0), "inside the top-left corner");

    let _ = std::fs::remove_dir_all(&dir);
}

/// A plan that draws the camera edge to edge over a red fill.
fn camera_over_red(matte: bool) -> RenderPlan {
    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };
    RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Fill {
                rect: full,
                paint: Paint::Solid {
                    color: "#ff0000".to_owned(),
                },
            },
            PlanItem::Image {
                source: PlanSource::Camera,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 400.0,
                    height: 200.0,
                },
                dst_rect: full,
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror: false,
                matte,
                blobs: Vec::new(),
                grade: None,
                motion: Vec::new(),
            },
        ],
        filter: None,
    }
}

#[test]
fn cuts_the_camera_to_its_matte() {
    // The matte bug has two halves. One: the mask is a separate file at its
    // own size — here half the camera's on each side — and has to land on
    // the picture through the picture's coordinates, not its own. Two: the
    // picture is premultiplied, so the mask has to scale colour with alpha,
    // or the cut edge glows green over the red rather than vanishing into it.
    let dir = scratch("prequel-pixels-matte");
    record(
        &dir,
        "camera.mp4",
        400,
        200,
        &solid_wide(400, 200, [0, 255, 0]),
    );
    // White where the person is (the left), black elsewhere.
    record(
        &dir,
        "camera-matte.mp4",
        200,
        100,
        &split_frame(200, 100, [255, 255, 255], [0, 0, 0]),
    );

    let output = dir.join("export.mp4");
    export(
        &request(&dir, &output, vec![slice(camera_over_red(true))]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = first_frame(&output);
    near(
        frame.at(40, 120),
        (0, 255, 0),
        "inside the mask, the camera shows",
    );
    near(
        frame.at(280, 120),
        (255, 0, 0),
        "outside the mask, the background shows through",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn ignores_the_matte_unless_the_plan_asks() {
    // The file being there is not the decision; the plan is. Otherwise a
    // recording with a matte could never be shown whole again.
    let dir = scratch("prequel-pixels-matte-off");
    record(
        &dir,
        "camera.mp4",
        400,
        200,
        &solid_wide(400, 200, [0, 255, 0]),
    );
    record(
        &dir,
        "camera-matte.mp4",
        200,
        100,
        &split_frame(200, 100, [255, 255, 255], [0, 0, 0]),
    );

    let output = dir.join("export.mp4");
    export(
        &request(&dir, &output, vec![slice(camera_over_red(false))]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = first_frame(&output);
    near(frame.at(40, 120), (0, 255, 0), "left, un-masked");
    near(frame.at(280, 120), (0, 255, 0), "right, un-masked");

    let _ = std::fs::remove_dir_all(&dir);
}

fn solid_wide(width: u32, height: u32, colour: [u8; 3]) -> arc::R<cv::PixelBuf> {
    split_frame(width, height, colour, colour)
}

#[test]
fn a_mirrored_picture_pushed_off_the_edge_keeps_the_right_half_on_screen() {
    // The cutout bug, at the pixel level: a mirrored camera pushed half off
    // the left edge. Mirrored, the picture's right half — the part still on
    // screen — shows the *left* half of the source, which is blue. The old
    // crop handed the shader the source's right half instead, so the red
    // stayed on screen and the person appeared to stand still while their
    // box left the frame.
    let dir = scratch("prequel-pixels-mirror-cut");
    let source = split_frame(400, 200, [0, 0, 255], [255, 0, 0]);
    record(&dir, "camera.mp4", 400, 200, &source);

    let output = dir.join("export.mp4");
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![PlanItem::Image {
            source: PlanSource::Camera,
            src_rect: Rect {
                x: 0.0,
                y: 0.0,
                width: 400.0,
                height: 200.0,
            },
            // Half of it off the left edge.
            dst_rect: Rect {
                x: -(OUT_W as f64),
                y: 0.0,
                width: OUT_W as f64 * 2.0,
                height: OUT_H as f64,
            },
            shape: Shape {
                radius: 0.0,
                exponent: 2.0,
            },
            mirror: true,
            matte: false,
            blobs: Vec::new(),
            grade: None,
            motion: Vec::new(),
        }],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = first_frame(&output);
    near(
        frame.at(40, 120),
        (0, 0, 255),
        "left of the frame, from the source's left",
    );
    near(
        frame.at(280, 120),
        (0, 0, 255),
        "right of the frame, still the source's left",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_overlay_fades_in_where_its_keys_say_and_keeps_its_crop() {
    // A text unit is a crop out of a bitmap drawn along a track of keys. Two
    // things have to hold for the preview and the file to agree: the opacity
    // at a moment is the one between the keys either side, and the crop is
    // the crop — a unit cut from the left half of its bitmap draws the left
    // half, not the whole picture squeezed into the box.
    let dir = scratch("prequel-pixels-overlay");
    let output = dir.join("export.mp4");

    let source = solid(200, [0, 0, 0]);
    record(&dir, "screen.mp4", 200, 200, &source);

    // White on the left, blue on the right; the crop only ever asks for the
    // white half.
    std::fs::create_dir_all(dir.join("texts")).expect("texts dir");
    write_png(
        &dir.join("texts/field.png"),
        &split_frame(100, 50, [255, 255, 255], [0, 0, 255]),
    );

    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };
    let dst = Rect {
        x: 110.0,
        y: 95.0,
        width: 100.0,
        height: 50.0,
    };
    let key = |at: i64, opacity: f64| OverlayKey {
        at,
        x: dst.x,
        y: dst.y,
        width: dst.width,
        height: dst.height,
        opacity,
        blur: 0.0,
    };

    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Fill {
                rect: full,
                paint: Paint::Solid {
                    color: "#ff0000".to_owned(),
                },
            },
            PlanItem::Overlay {
                path: "texts/field.png".to_owned(),
                bitmap: Size {
                    width: 100.0,
                    height: 50.0,
                },
                src: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 50.0,
                    height: 50.0,
                },
                span: Span {
                    start: 0,
                    end: S as i64,
                },
                // Invisible for the first four frames, fully there from the
                // sixth; halfway between at the fifth.
                keys: vec![
                    key(3 * S as i64 / 10, 0.0),
                    key(5 * S as i64 / 10, 1.0),
                    key(9 * S as i64 / 10, 1.0),
                ],
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    // Frame 0 is before the first key, which is held: nothing but the red.
    near(
        frame_at(&output, 0).at(160, 120),
        (255, 0, 0),
        "held at opacity 0",
    );
    // Frame 4 is halfway up the ramp: half white over red.
    near(
        frame_at(&output, 4).at(160, 120),
        (255, 128, 128),
        "halfway through the fade",
    );
    // Frame 7 is on the hold, and the whole box is the white half of the
    // bitmap — the blue half was never asked for.
    let held = frame_at(&output, 7);
    near(held.at(120, 120), (255, 255, 255), "left of the crop, held");
    near(
        held.at(200, 120),
        (255, 255, 255),
        "right of the crop, held",
    );
    near(held.at(250, 120), (255, 0, 0), "beside the box");

    let _ = std::fs::remove_dir_all(&dir);
}

/// A full-frame plan drawing the screen at `size`, so a take of any dimensions
/// fills the output.
fn screen_filling(size: u32) -> RenderPlan {
    RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![PlanItem::Image {
            source: PlanSource::Screen,
            src_rect: Rect {
                x: 0.0,
                y: 0.0,
                width: size as f64,
                height: size as f64,
            },
            dst_rect: Rect {
                x: 0.0,
                y: 0.0,
                width: OUT_W as f64,
                height: OUT_H as f64,
            },
            shape: Shape {
                radius: 0.0,
                exponent: 2.0,
            },
            mirror: false,
            matte: false,
            blobs: Vec::new(),
            grade: None,
            motion: Vec::new(),
        }],
        filter: None,
    }
}

#[test]
fn renders_each_take_from_its_own_file() {
    // A recording extended with a second take: two files on one session clock,
    // a seam between them, and a slice either side.
    //
    // Pinned by colour because every shape assertion passes on an export that
    // plays the first take twice — same duration, same frame count, same
    // dimensions — and only the pixel catches a slice reading the wrong file or
    // double-counting an offset. The second take is a different size as well,
    // so a plan built against the first take's dimensions would sample the
    // wrong window of it.
    let dir = scratch("prequel-pixels-takes");
    std::fs::create_dir_all(dir.join("2")).expect("create the second take's directory");

    let first = split_frame(200, 200, [0, 0, 255], [0, 0, 255]);
    record(&dir, "screen.mp4", 200, 200, &first);

    let second = split_frame(120, 120, [0, 255, 0], [0, 255, 0]);
    record(&dir.join("2"), "screen.mp4", 120, 120, &second);

    let take_one = SliceRender {
        start: 0,
        end: S,
        plan: screen_filling(200),
        audio: AudioMix::tracks(0.0, 0.0),
        speed: 1.0,
        media: SliceMedia {
            screen: Some(SegmentRef {
                file: "screen.mp4".into(),
                offset: 0,
            }),
            ..SliceMedia::default()
        },
    };

    // The second take begins where the first ended, and its file is zero-based
    // — which is what the offset is for. Subtracting it twice would read past
    // the end of a one-second file and render nothing at all.
    let take_two = SliceRender {
        start: S,
        end: 2 * S,
        plan: screen_filling(120),
        media: SliceMedia {
            screen: Some(SegmentRef {
                file: "2/screen.mp4".into(),
                offset: S,
            }),
            ..SliceMedia::default()
        },
        ..take_one.clone()
    };

    let output = dir.join("export.mp4");
    export(
        &request(&dir, &output, vec![take_one, take_two]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    // Either side of the seam, which falls halfway through a two-second export.
    let before = frame_at(&output, FPS - 1);
    near(
        before.at(160, 120),
        (0, 0, 255),
        "the last frame of take one",
    );

    let after = frame_at(&output, FPS);
    near(
        after.at(160, 120),
        (0, 255, 0),
        "the first frame of take two",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// The camera's outline: a circle at a known place, with one lobe out to the
/// right.
///
/// `h[0]` is the `cos t` term, so a positive one pushes the curve out along
/// positive x and pulls it in along negative x by the same amount. That makes
/// the two sides of the shape tell each other apart, which is the whole point of
/// the mirror test below.
fn outlined(mirror: bool) -> RenderPlan {
    RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Fill {
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                paint: Paint::Solid {
                    color: "#0000ff".into(),
                },
            },
            PlanItem::Image {
                source: PlanSource::Camera,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 400.0,
                    height: 200.0,
                },
                dst_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                // Never read where there is an outline. A radius of zero here is
                // the whole frame, which is exactly what must *not* be drawn.
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror,
                matte: false,
                blobs: vec![BlobKey {
                    at: 0,
                    x: 160.0,
                    y: 120.0,
                    radius: 60.0,
                    h: [0.4, 0.0, 0.0, 0.0, 0.0, 0.0],
                    presence: 1.0,
                }],
                motion: Vec::new(),
                grade: None,
            },
        ],
        filter: None,
    }
}

#[test]
fn bends_the_outline_by_its_harmonics() {
    // The shape is a radius that varies with the angle, and `h[0]` is the term
    // that leans it sideways: at 0.4, the curve reaches 84 pixels to the right of
    // the centre and only 36 to the left. Both are asserted, because a shader
    // that ignored the harmonics entirely would draw a 60-pixel circle and pass
    // an assertion that only looked at the narrow side.
    let dir = scratch("prequel-pixels-blob");
    let camera = solid(400, [255, 0, 0]);
    record(&dir, "camera.mp4", 400, 200, &camera);
    record(&dir, "screen.mp4", 400, 200, &camera);

    let output = dir.join("export.mp4");
    export(
        &request(&dir, &output, vec![slice(outlined(false))]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = first_frame(&output);
    near(frame.at(160, 120), (255, 0, 0), "the middle of the shape");
    // Out to 84: inside at 75, outside at 95.
    near(frame.at(235, 120), (255, 0, 0), "inside the lobe");
    near(frame.at(255, 120), (0, 0, 255), "past the lobe");
    // In to 36: inside at 25, outside at 45.
    near(frame.at(135, 120), (255, 0, 0), "inside the narrow side");
    near(frame.at(115, 120), (0, 0, 255), "past the narrow side");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn mirrors_the_outline_with_the_picture() {
    // The camera is flipped by flipping its uv, which leaves an outline that
    // knows nothing about it facing the way the camera did while the person
    // faces the other — an asymmetric shape over the wrong shoulder. It only
    // shows on a shape that is not symmetric and on somebody who is not sitting
    // squarely in frame, which is why it survived a first pass.
    let dir = scratch("prequel-pixels-blob-mirror");
    let camera = solid(400, [255, 0, 0]);
    record(&dir, "camera.mp4", 400, 200, &camera);
    record(&dir, "screen.mp4", 400, 200, &camera);

    let output = dir.join("export.mp4");
    export(
        &request(&dir, &output, vec![slice(outlined(true))]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    // The same two points as above, the other way round.
    let frame = first_frame(&output);
    near(frame.at(85, 120), (255, 0, 0), "the lobe, now on the left");
    near(frame.at(65, 120), (0, 0, 255), "past it");
    near(
        frame.at(185, 120),
        (255, 0, 0),
        "the narrow side, now on the right",
    );
    near(frame.at(205, 120), (0, 0, 255), "past that");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn draws_nothing_where_the_outline_has_closed() {
    // Somebody who stepped out of frame. Both rasterisers scale the radius by
    // `presence` precisely so this frame discards — falling back to `shape`
    // would draw the rectangle underneath, which for this shape is the whole
    // camera picture flashed across the frame.
    let dir = scratch("prequel-pixels-blob-empty");
    let camera = solid(400, [255, 0, 0]);
    record(&dir, "camera.mp4", 400, 200, &camera);
    record(&dir, "screen.mp4", 400, 200, &camera);

    let mut plan = outlined(false);
    if let Some(PlanItem::Image { blobs, .. }) = plan.items.get_mut(1) {
        blobs[0].presence = 0.0;
    }

    let output = dir.join("export.mp4");
    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = first_frame(&output);
    near(frame.at(160, 120), (0, 0, 255), "where the shape was");
    near(frame.at(60, 60), (0, 0, 255), "and everywhere else");

    let _ = std::fs::remove_dir_all(&dir);
}

/// A lens the size of one on screen, over a boundary it has to move.
///
/// The glass sits a little to the right of where blue meets red, so the
/// magnified image puts that meeting point *further* left than the frame does —
/// twice as far from the lens's middle, at 2x. A point between the two reads
/// blue on the frame and red through the glass, which no amount of drawing a
/// circle in the right place could produce.
///
/// `curvature` is the default and `aberration` and `reflection` are off, so what
/// is being measured is the mapping rather than the dressing: the rim darkening
/// and the highlight both land well outside the point being sampled.
#[test]
fn a_lens_magnifies_what_is_under_it_and_leaves_the_rest_alone() {
    let dir = scratch("prequel-pixels-loupe");
    // Blue left, red right, so the boundary lands at the middle of the output.
    let source = split_frame(320, 240, [0, 0, 255], [255, 0, 0]);
    record(&dir, "screen.mp4", 320, 240, &source);

    let output = dir.join("export.mp4");
    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };

    // Fully down for the whole clip. Two keys with the same values, outside the
    // slice at both ends, because `loupe_at` draws nothing at or beyond them.
    let glass = |at: i64| LoupeKey {
        at,
        // A tenth of the frame to the right of the boundary at x = 160.
        x: 192.0,
        y: 120.0,
        radius: 80.0,
        magnify: 2.0,
        presence: 1.0,
        curvature: 0.34,
        aberration: 0.0,
        reflection: 0.0,
        smear_x: 0.0,
        smear_y: 0.0,
    };

    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 320.0,
                    height: 240.0,
                },
                dst_rect: full,
                shape: Shape {
                    radius: 0.0,
                    exponent: 2.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                grade: None,
                motion: Vec::new(),
            },
            PlanItem::Loupe {
                keys: vec![glass(-(S as i64)), glass(2 * S as i64)],
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = first_frame(&output);
    // Inside the glass, on the frame's blue side, past where the magnified
    // boundary sits. Blue here means the lens drew the frame at its own size.
    near(frame.at(140, 120), (255, 0, 0), "through the glass");
    // Inside the glass on the red side, which is red either way — a sanity
    // check that the lens is drawing the picture and not a flat disc.
    near(frame.at(240, 120), (255, 0, 0), "the far side of the glass");
    // Outside the quad entirely. The lens must move nothing: red here, or blue
    // anywhere past the boundary, is the picture having been dragged.
    near(frame.at(40, 120), (0, 0, 255), "well clear of the glass");
    near(frame.at(180, 8), (255, 0, 0), "above the glass");

    let _ = std::fs::remove_dir_all(&dir);
}

/// A greyscale picture, seen through the glass, comes out with colour at the rim.
///
/// The fringing control shipped doing nothing at any setting, and nothing could
/// have told you: each channel was normalised against its *own* index, so the
/// dispersion divided straight back out and the three landed on top of each
/// other. The lens still looked like a lens, so there was no artefact to notice
/// — only a slider that moved and changed no pixel.
///
/// Black and white either side, `reflection` off, so there is no colour anywhere
/// in the composition and nothing but the glass can have put any in.
#[test]
fn the_glass_splits_colour_at_its_edge() {
    let dir = scratch("prequel-pixels-fringe");
    let source = split_frame(320, 240, [0, 0, 0], [255, 255, 255]);
    record(&dir, "screen.mp4", 320, 240, &source);

    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };

    // The same lens twice, once with the fringing off and once at full.
    //
    // Placed so the black-and-white boundary falls where the glass thickens,
    // which is the only place the bend differs enough between channels to
    // separate them — and the only place it should. Over the flat middle every
    // index refracts the same, so a scan across the diameter of a lens centred
    // on the boundary finds no colour however broken the control is.
    let shot = |aberration: f64| LoupeKey {
        at: 0,
        x: 190.0,
        y: 120.0,
        radius: 80.0,
        magnify: 2.0,
        presence: 1.0,
        curvature: 0.34,
        aberration,
        // Off, or the highlight would put light of its own on the glass.
        reflection: 0.0,
        smear_x: 0.0,
        smear_y: 0.0,
    };

    // The widest any channel is from any other, straight across the middle of
    // the lens. Greyscale in, so anything above nothing is the glass.
    let split = |aberration: f64, name: &str| -> i16 {
        let output = dir.join(format!("{name}.mp4"));
        let glass = |at: i64| LoupeKey {
            at,
            ..shot(aberration)
        };
        let plan = RenderPlan {
            frame: Size {
                width: OUT_W as f64,
                height: OUT_H as f64,
            },
            items: vec![
                PlanItem::Image {
                    source: PlanSource::Screen,
                    src_rect: Rect {
                        x: 0.0,
                        y: 0.0,
                        width: 320.0,
                        height: 240.0,
                    },
                    dst_rect: full,
                    shape: Shape {
                        radius: 0.0,
                        exponent: 2.0,
                    },
                    mirror: false,
                    matte: false,
                    blobs: Vec::new(),
                    grade: None,
                    motion: Vec::new(),
                },
                PlanItem::Loupe {
                    keys: vec![glass(-(S as i64)), glass(2 * S as i64)],
                },
            ],
            filter: None,
        };

        export(
            &request(&dir, &output, vec![slice(plan)]),
            &CancelFlag::new(),
            &mut |_| {},
        )
        .expect("export");

        let frame = first_frame(&output);
        let mut widest = 0;
        for x in 111..269 {
            let (r, g, b) = frame.at(x, 120);
            let spread = (r as i16 - b as i16)
                .abs()
                .max((r as i16 - g as i16).abs())
                .max((g as i16 - b as i16).abs());
            widest = widest.max(spread);
        }
        widest
    };

    let off = split(0.0, "none");
    let full_split = split(1.0, "full");

    // The encoder is lossy and the picture has a hard edge in it, so "none" is
    // allowed a little chroma noise rather than exactly zero.
    assert!(off < 24, "a corrected lens should add no colour, got {off}");
    assert!(
        full_split > 60,
        "the fringing control should split colour, got {full_split}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// A source with real detail in it: fine vertical stripes.
fn striped(width: u32, height: u32, period: u32) -> arc::R<cv::PixelBuf> {
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
                let on = (x as u32 / period).is_multiple_of(2);
                let v = if on { 235 } else { 20 };
                let at = y * stride + x * 4;
                *base.add(at) = v;
                *base.add(at + 1) = v;
                *base.add(at + 2) = v;
                *base.add(at + 3) = 255;
            }
        }
        buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("unlock");
    }
    buf
}

/// How steep the edges are: the biggest step between neighbours.
///
/// Steepness rather than mean energy, because that is what reads as sharpness.
/// A 2x enlargement of a hard edge is a ramp, and the only question is how many
/// output pixels the ramp takes — one, and it still looks like an edge.
fn detail(frame: &Frame, x0: u32, x1: u32, y0: u32, y1: u32) -> f64 {
    let mut steepest: f64 = 0.0;
    for y in y0..y1 {
        for x in x0..x1 - 1 {
            let a = frame.at(x, y).1 as f64;
            let b = frame.at(x + 1, y).1 as f64;
            steepest = steepest.max((a - b).abs());
        }
    }
    steepest
}

#[test]
fn magnifying_a_picture_keeps_its_edges() {
    let dir = scratch("prequel-loupe-sharpness");
    // One source pixel per output pixel, which is what the Automatic frame
    // gives: the export is the recording's own size. A 2x lens has nothing left
    // to recover here and has to invent, and so does a 2x camera zoom.
    let source = striped(320, 240, 8);
    record(&dir, "screen.mp4", 320, 240, &source);

    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };
    let src_rect = Rect {
        x: 0.0,
        y: 0.0,
        width: 320.0,
        height: 240.0,
    };
    let square = Shape {
        radius: 0.0,
        exponent: 2.0,
    };

    let picture = |dst: Rect| PlanItem::Image {
        source: PlanSource::Screen,
        src_rect,
        dst_rect: dst,
        shape: square,
        mirror: false,
        matte: false,
        blobs: Vec::new(),
        grade: None,
        motion: Vec::new(),
    };

    // (a) the lens, 2x over the middle.
    let glass = |at: i64| LoupeKey {
        at,
        x: (OUT_W / 2) as f64,
        y: (OUT_H / 2) as f64,
        radius: 60.0,
        magnify: 2.0,
        presence: 1.0,
        curvature: 0.34,
        aberration: 0.0,
        reflection: 0.0,
        smear_x: 0.0,
        smear_y: 0.0,
    };
    let lens_plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            picture(full),
            PlanItem::Loupe {
                keys: vec![glass(-(S as i64)), glass(2 * S as i64)],
            },
        ],
        filter: None,
    };

    // (b) a camera zoom to the same 2x about the same point: the picture drawn
    // at twice the size, centred. This is the path that has always sampled the
    // recording directly, so it is the ceiling the lens should reach.
    let zoomed = Rect {
        x: -(OUT_W as f64) / 2.0,
        y: -(OUT_H as f64) / 2.0,
        width: OUT_W as f64 * 2.0,
        height: OUT_H as f64 * 2.0,
    };
    let zoom_plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![picture(zoomed)],
        filter: None,
    };

    let run = |plan: RenderPlan, name: &str| -> Frame {
        let output = dir.join(format!("{name}.mp4"));
        export(
            &request(&dir, &output, vec![slice(plan)]),
            &CancelFlag::new(),
            &mut |_| {},
        )
        .expect("export");
        first_frame(&output)
    };

    let lens = run(lens_plan, "lens");
    let zoom = run(zoom_plan, "zoom");

    // The flat middle of the glass, well inside the rolled edge.
    let (x0, x1) = (OUT_W / 2 - 30, OUT_W / 2 + 30);
    let (y0, y1) = (OUT_H / 2 - 25, OUT_H / 2 + 25);

    let through_glass = detail(&lens, x0, x1, y0, y1);
    let through_zoom = detail(&zoom, x0, x1, y0, y1);
    let unmagnified = detail(
        &run(
            RenderPlan {
                frame: Size {
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                items: vec![picture(full)],
                filter: None,
            },
            "flat",
        ),
        x0,
        x1,
        y0,
        y1,
    );

    // Magnified, a hard edge has to stay as steep as it was unmagnified. Plain
    // bilinear scores about half of this — it spreads the edge over as many
    // output pixels as the magnification — and a nine-tap cubic about 60%. The
    // one-tap texel snap in both shaders is what holds the full figure.
    assert!(
        through_zoom > unmagnified * 0.9,
        "a 2x camera zoom should keep its edges: {through_zoom:.0} against {unmagnified:.0}"
    );
    // And the lens has to reach the same place. It renders the composition
    // again rather than enlarging the finished frame, so it has exactly the
    // same pixels available — anything less means that second pass is losing
    // them.
    assert!(
        through_glass > through_zoom * 0.9,
        "a 2x loupe should be as sharp as a 2x zoom: {through_glass:.0} against {through_zoom:.0}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// A look lands on the camera and nowhere else.
///
/// The one thing about this that could go wrong silently. The grade is set per
/// item, and the shader applies it inside the branch that draws a picture — so
/// a uniform left set from the camera, or a grade attached to the wrong item,
/// would tint the whole recording. It would look deliberate, and it would only
/// be noticed by somebody who had chosen a look for their face and found their
/// screen warm as well.
#[test]
fn a_camera_look_leaves_the_screen_alone() {
    let dir = scratch("prequel-pixels-look");
    // Grey either side, so any colour in the output came from the grade.
    let screen = solid_wide(320, 240, [128, 128, 128]);
    record(&dir, "screen.mp4", 320, 240, &screen);
    let camera = solid_wide(160, 120, [128, 128, 128]);
    record(&dir, "camera.mp4", 160, 120, &camera);

    let output = dir.join("export.mp4");
    let square = Shape {
        radius: 0.0,
        exponent: 2.0,
    };
    let plan = RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 320.0,
                    height: 240.0,
                },
                dst_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                shape: square,
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                motion: Vec::new(),
                // Pointedly none. The screen is lit by a display, not by the
                // room, and the look is not for it.
                grade: None,
            },
            PlanItem::Image {
                source: PlanSource::Camera,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 160.0,
                    height: 120.0,
                },
                // Bottom-right, well clear of where the screen is sampled.
                dst_rect: Rect {
                    x: 180.0,
                    y: 140.0,
                    width: 120.0,
                    height: 90.0,
                },
                shape: square,
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                motion: Vec::new(),
                // Warm, hard. Red up and blue down is the one thing about a
                // temperature that is unambiguous in a pixel.
                grade: Some(prequel_render::Grade {
                    temperature: 0.3,
                    tint: 0.0,
                    contrast: 0.0,
                    saturation: 0.0,
                    vibrance: 0.0,
                    lift: 0.0,
                    shadow_hue: 0.0,
                    shadow_amount: 0.0,
                    highlight_hue: 0.0,
                    highlight_amount: 0.0,
                }),
            },
        ],
        filter: None,
    };

    export(
        &request(&dir, &output, vec![slice(plan)]),
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("export");

    let frame = first_frame(&output);

    // The screen, untouched: still the grey it was recorded as.
    let (r, g, b) = frame.at(60, 60);
    assert!(
        (r as i16 - b as i16).abs() < 12,
        "the screen should carry no colour, got {r},{g},{b}"
    );

    // The camera, warmed. A temperature of 0.3 is red up and blue down by
    // 0.32 * 0.3, so mid grey should come apart by about 128 * 0.192 — call it
    // 24, and assert well under it so the encoder has room.
    let (r, g, b) = frame.at(240, 185);
    assert!(
        r as i16 - b as i16 > 15,
        "the camera should be warmed, got {r},{g},{b}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// A travelling lens softens what is inside it, and a still one does not.
///
/// The streak arrives finished, in output pixels, so nothing here knows a speed
/// — which is the whole reason the preview and the export cannot disagree about
/// how far a lens smears. What this covers is that the number is *read*: a
/// uniform never bound, or bound in the wrong units, draws a perfectly sharp
/// lens and nothing anywhere says so.
#[test]
fn a_travelling_lens_smears_what_is_inside_it() {
    let dir = scratch("prequel-pixels-lens-smear");
    // A hard edge down the middle, which is the only thing a blur can be
    // measured against.
    let source = split_frame(320, 240, [10, 10, 10], [245, 245, 245]);
    record(&dir, "screen.mp4", 320, 240, &source);

    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };
    let square = Shape {
        radius: 0.0,
        exponent: 2.0,
    };

    let edges = |smear: f64, name: &str| -> f64 {
        let glass = |at: i64| LoupeKey {
            at,
            x: 160.0,
            y: 120.0,
            radius: 70.0,
            magnify: 2.0,
            presence: 1.0,
            curvature: 0.4,
            // Both off: a fringe and a highlight would both put their own
            // gradients across the edge being measured.
            aberration: 0.0,
            reflection: 0.0,
            // Across the edge, which is the direction that blurs it.
            smear_x: smear,
            smear_y: 0.0,
        };
        let plan = RenderPlan {
            frame: Size {
                width: OUT_W as f64,
                height: OUT_H as f64,
            },
            items: vec![
                PlanItem::Image {
                    source: PlanSource::Screen,
                    src_rect: Rect {
                        x: 0.0,
                        y: 0.0,
                        width: 320.0,
                        height: 240.0,
                    },
                    dst_rect: full,
                    shape: square,
                    mirror: false,
                    matte: false,
                    blobs: Vec::new(),
                    motion: Vec::new(),
                    grade: None,
                },
                PlanItem::Loupe {
                    keys: vec![glass(-(S as i64)), glass(2 * S as i64)],
                },
            ],
            filter: None,
        };

        let output = dir.join(format!("{name}.mp4"));
        export(
            &request(&dir, &output, vec![slice(plan)]),
            &CancelFlag::new(),
            &mut |_| {},
        )
        .expect("export");

        // Straight across the flat middle of the glass, where the edge is.
        detail(&first_frame(&output), 130, 190, 110, 130)
    };

    let still = edges(0.0, "still");
    let moving = edges(26.0, "moving");

    assert!(
        still > 150.0,
        "a still lens should keep the edge, got {still:.0}"
    );
    assert!(
        moving < still * 0.6,
        "a travelling lens should soften it: {moving:.0} against {still:.0}"
    );
}
