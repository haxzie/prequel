//! What each encoder will actually manage, per frame, with nothing else running.
//!
//! Ignored by default: it is a measurement rather than an assertion, and the
//! number it prints is a property of the machine. Run it before concluding
//! anything about where an export's time goes —
//! `prequel_render::export::StageTimes` points here for that reason.
//!
//! ```text
//! cargo test -p prequel-encode --release --test measures_the_encoder_ceiling \
//!     -- --ignored --nocapture
//! ```
//!
//! Frames are built once and appended in a ring, so no decode, no composite
//! and no allocation is inside the timed loop. They are also *filled*, and
//! filled with something like a screen recording: an untouched pool buffer is
//! uniform and compresses to almost nothing, which made VideoToolbox's own
//! software encoder read as the faster of the two until the buffers were
//! filled. Content is most of a CPU encoder's cost and almost none of the
//! hardware's, so a comparison on the wrong content inverts.

use cidre::{arc, cf, cv, ns};
use prequel_encode::{DEFAULT_CRF, Nv12, Preset, VideoWriter, VideoWriterConfig, X264};

const N: u64 = 300;
const S: u64 = 1_000_000_000;

/// IOSurface-backed and Metal-compatible, matching what the compositor hands
/// the encoder in a real export. A plain `cv::PixelBuf::new` is neither, and
/// the encoder then copies every frame before it can read it.
fn pool(width: u32, height: u32) -> arc::R<cv::PixelBufPool> {
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
    cv::PixelBufPool::new(None, Some(attrs.as_ref())).expect("create a buffer pool")
}

/// Content modelled on a screen recording: a static desktop, a pointer crossing
/// it, and a few characters appearing as if typed.
///
/// Mostly unchanged between frames, which is the whole character of the thing.
/// An earlier version moved every panel on every frame, and on that libx264
/// `ultrafast` wrote 17MB where `superfast` wrote 3.7MB — a ratio that says
/// nothing about any real recording.
fn frames(width: u32, height: u32) -> Vec<arc::R<cv::PixelBuf>> {
    let pool = pool(width, height);
    let w = width as usize;
    let h = height as usize;

    (0..8)
        .map(|index| {
            let mut buf = pool.pixel_buf().expect("take a buffer");
            let cursor_x = (index * 7) % w.saturating_sub(24).max(1);
            let cursor_y = (index * 3) % h.saturating_sub(24).max(1);
            let typed = (index / 2) % 40;

            unsafe {
                buf.lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
                    .result()
                    .expect("lock");
                let stride = buf.bytes_per_row();
                let base = buf.base_address_mut().cast::<u8>();
                for row in 0..h {
                    let line = base.add(row * stride);
                    for col in 0..w {
                        let panel = if col < w / 5 {
                            32u8
                        } else if row < h / 12 {
                            44
                        } else {
                            58
                        };
                        let body =
                            row > h / 6 && row % 21 < 9 && col > w / 4 && (col / 3) % 5 < 2;
                        let mut value = if body { 196 } else { panel };
                        if row >= h / 2
                            && row < h / 2 + 14
                            && col > w / 4
                            && (col - w / 4) / 9 < typed
                        {
                            value = 210;
                        }
                        if row >= cursor_y
                            && row < cursor_y + 18
                            && col >= cursor_x
                            && col < cursor_x + 12
                        {
                            value = 240;
                        }
                        let at = col * 4;
                        *line.add(at) = value;
                        *line.add(at + 1) = value.wrapping_add(4);
                        *line.add(at + 2) = value.wrapping_add(9);
                        *line.add(at + 3) = 255;
                    }
                }
                buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
                    .result()
                    .expect("unlock");
            }
            buf
        })
        .collect()
}

fn measure(label: &str, width: u32, height: u32) {
    let frames = frames(width, height);
    let path = std::env::temp_dir().join(format!("prequel-ceiling-{label}.mp4"));
    let mut writer = VideoWriter::create(&path, &VideoWriterConfig::new(width, height).offline())
        .expect("create the writer");

    let began = std::time::Instant::now();
    for index in 0..N {
        writer
            .append(&frames[(index % 8) as usize], index * (S / 60))
            .expect("append a frame");
    }
    let took = began.elapsed();
    writer.finish().expect("finish");
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    let megapixels = (width as f64 * height as f64) / 1e6;
    eprintln!(
        "{label:>12}: {:5.2} ms/frame  {:4.0} fps  {:5.2} MB  {:4.0} MP/s",
        took.as_secs_f64() * 1e3 / N as f64,
        N as f64 / took.as_secs_f64(),
        size as f64 / 1e6,
        megapixels * N as f64 / took.as_secs_f64(),
    );
}

/// The ceiling, by resolution.
///
/// On an M4 Pro this comes out at roughly `0.25ms + 0.45ms per megapixel`, so
/// 1080p is about 4ms a frame and 4K about 11ms. That is the hardware, not this
/// crate: `ffmpeg`'s `h264_videotoolbox` lands on the same numbers, several
/// sessions at once do not raise the total, and neither does any compression
/// property VideoToolbox accepts.
#[test]
#[ignore]
fn h264_costs_about_half_a_millisecond_per_megapixel() {
    measure("640x360", 640, 360);
    measure("720p", 1280, 720);
    measure("1080p", 1920, 1080);
    measure("1440p", 2560, 1440);
    measure("2160p", 3840, 2160);
}

/// libx264 against the media engine, on the same frames.
///
/// This is the measurement the export rests on. The hardware encoder is a fixed
/// pixel rate whatever it is asked; libx264 is several times quicker on screen
/// content *and* writes a fraction of the bytes, because flat regions and hard
/// edges are where its decisions pay and where the hardware's rate control
/// spends bits on stillness.
#[test]
#[ignore]
fn libx264_beats_the_media_engine_on_screen_content() {
    let frames = frames(1920, 1080);
    let planes: Vec<(Vec<u8>, Vec<u8>)> = frames.iter().map(nv12_of).collect();

    for preset in [
        Preset::Ultrafast,
        Preset::Superfast,
        Preset::Veryfast,
        Preset::Faster,
    ] {
        let mut encoder =
            X264::open(1920, 1080, 60, 1, preset, DEFAULT_CRF, 0).expect("open libx264");
        encoder.parameter_sets().expect("parameter sets");

        let began = std::time::Instant::now();
        let mut bytes = 0usize;
        let mut samples = 0u64;
        for index in 0..N {
            let (y, uv) = &planes[(index % 8) as usize];
            if let Some(sample) = encoder
                .encode(
                    Nv12 {
                        y,
                        y_stride: 1920,
                        uv,
                        uv_stride: 1920,
                    },
                    index as i64,
                )
                .expect("encode")
            {
                bytes += sample.payload.len();
                samples += 1;
            }
        }
        while let Some(sample) = encoder.flush().expect("flush") {
            bytes += sample.payload.len();
            samples += 1;
        }
        let took = began.elapsed();
        assert_eq!(samples, N, "every frame must come back out");

        eprintln!(
            "{:>12}: {:5.2} ms/frame  {:4.0} fps  {:5.2} MB",
            format!("{preset:?}"),
            took.as_secs_f64() * 1e3 / N as f64,
            N as f64 / took.as_secs_f64(),
            bytes as f64 / 1e6,
        );
    }

    measure("videotoolbox", 1920, 1080);
}

/// The NV12 planes of a BGRA buffer, converted here on the CPU because this is
/// a bench rather than the export — which does it on the GPU, for the reason
/// `composite_to_nv12` gives.
fn nv12_of(buffer: &arc::R<cv::PixelBuf>) -> (Vec<u8>, Vec<u8>) {
    let width = buffer.width();
    let height = buffer.height();
    let mut y = vec![0u8; width * height];
    let mut uv = vec![128u8; width * height / 2];

    let mut locked = buffer.retained();
    unsafe {
        locked
            .lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
            .result()
            .expect("lock");
        let stride = locked.bytes_per_row();
        let base = locked.base_address().cast::<u8>();
        for row in 0..height {
            for col in 0..width {
                let at = row * stride + col * 4;
                let b = *base.add(at) as f32;
                let g = *base.add(at + 1) as f32;
                let r = *base.add(at + 2) as f32;
                let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                y[row * width + col] = (16.0 + luma * 219.0 / 255.0) as u8;
                if row % 2 == 0 && col % 2 == 0 {
                    let cb = (b - luma) / 1.8556 * 224.0 / 255.0 + 128.0;
                    let cr = (r - luma) / 1.5748 * 224.0 / 255.0 + 128.0;
                    let at = row / 2 * width + col;
                    uv[at] = cb.clamp(0.0, 255.0) as u8;
                    uv[at + 1] = cr.clamp(0.0, 255.0) as u8;
                }
            }
        }
        let _ = locked.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY);
    }

    (y, uv)
}

/// Whether more sessions buy more throughput. They do not — the engine is the
/// shared resource, and splitting an export into parallel segments to encode
/// them at once is therefore not a lever. Measured before being ruled out.
#[test]
#[ignore]
fn concurrent_sessions_do_not_add_up() {
    for sessions in [1usize, 2, 4] {
        let began = std::time::Instant::now();
        std::thread::scope(|scope| {
            for session in 0..sessions {
                scope.spawn(move || measure(&format!("worker-{session}"), 1920, 1080));
            }
        });
        let took = began.elapsed();
        let total = N as f64 * sessions as f64;
        eprintln!(
            ">>> {sessions} session(s): {:4.0} fps aggregate, {:5.2} ms/frame",
            total / took.as_secs_f64(),
            took.as_secs_f64() * 1e3 / total,
        );
    }
}
