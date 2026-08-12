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
use prequel_encode::{VideoCodec, VideoWriter, VideoWriterConfig};
use prequel_render::{
    AudioMix, CancelFlag, ExportRequest, Paint, PlanItem, PlanSource, Rect, RenderPlan, Shape,
    Size, SliceRender, export,
};

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
        audio: AudioMix {
            mic: 1.0,
            system: 1.0,
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
        codec: VideoCodec::H264,
        slices,
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 0,
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
            motion: Vec::new(),
        }],
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
        }],
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
                motion: Vec::new(),
            },
        ],
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
