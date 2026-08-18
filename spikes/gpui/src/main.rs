//! Proof 1 of the GPUI spike: the preview path.
//!
//! Plays a real recording through the **existing** Metal `Compositor` — the one
//! the exporter uses, not a copy of it — into a GPUI window, and reports what it
//! costs per frame.
//!
//! This is the whole question the spike exists to answer. Today the same
//! composite is written twice: GLSL in `editor/webgl.ts` for what you see while
//! editing, MSL in `shaders.metal` for the file you export. If one compositor
//! can feed both, the duplication goes away — and with it the class of bug where
//! a preview and an export disagree and nobody finds out until the file is
//! written.
//!
//! Run it:
//!
//! ```text
//! cargo run -- "~/Movies/Prequel/<a session>" [output width]
//! ```

mod bridge;
mod yuv;

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context as _, Result, anyhow, bail};
use core_video::pixel_buffer::CVPixelBuffer;
use gpui::{
    App, Application, Bounds, Context, Window, WindowBounds, WindowOptions, div, prelude::*, px,
    rgb, size, surface,
};
use prequel_render::compositor::Compositor;
use prequel_render::plan::RectKey;
use prequel_render::reader::VideoReader;
use prequel_render::{
    Paint, PlanItem, PlanSource, Rect as PlanRect, RenderPlan, Shape, Size as PlanSize,
};
use prequel_session::{Manifest, TrackKind};
use yuv::Yuv;

/// What the recording is being composited into.
///
/// Not the source resolution: an export is an arbitrary size, and the point of
/// the measurement is what a *frame of output* costs. Defaults to 1920 wide,
/// with the height taken from the recording so nothing is letterboxed.
const DEFAULT_OUTPUT_WIDTH: u32 = 1920;

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let dir = args
        .next()
        .ok_or_else(|| anyhow!("usage: gpui-spike <session directory> [output width]"))?;
    let dir = PathBuf::from(shellexpand(&dir));
    let width: u32 = match args.next() {
        Some(text) => text.parse().context("output width must be a number")?,
        None => DEFAULT_OUTPUT_WIDTH,
    };

    let verify = args.next().as_deref() == Some("--verify");

    let source = Source::open(&dir, width)?;
    println!(
        "{}: {}×{} source → {}×{} output, {:.1}s",
        source.name,
        source.source_width,
        source.source_height,
        source.width,
        source.height,
        source.duration as f64 / 1e9
    );

    if verify {
        return check_pixels(source);
    }

    Application::new().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1280.), px(860.)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| cx.new(|_| Preview::new(source)),
        )
        .expect("could not open a window");
        cx.activate(true);
    });

    Ok(())
}

/// `~` only. Enough for a path typed at a shell that did not expand it, and not
/// worth a dependency for.
fn shellexpand(path: &str) -> String {
    match path.strip_prefix("~/") {
        Some(rest) => format!("{}/{rest}", std::env::var("HOME").unwrap_or_default()),
        None => path.to_owned(),
    }
}

/// Everything the window needs about the recording, resolved once.
struct Source {
    name: String,
    file: PathBuf,
    duration: u64,
    source_width: u32,
    source_height: u32,
    width: u32,
    height: u32,
}

impl Source {
    fn open(dir: &Path, width: u32) -> Result<Self> {
        let text = std::fs::read_to_string(dir.join("session.json"))
            .with_context(|| format!("no session.json in {}", dir.display()))?;
        let manifest = Manifest::from_json(&text).map_err(|e| anyhow!("{e}"))?;

        let screen = manifest
            .track(TrackKind::Screen)
            .ok_or_else(|| anyhow!("the session has no screen track"))?;
        let (Some(source_width), Some(source_height)) = (screen.width, screen.height) else {
            bail!("the screen track carries no dimensions");
        };

        // Height from the source aspect, rounded to even. An odd dimension is
        // legal for a texture and not for most encoders, and matching what an
        // export would do keeps the measurement honest.
        let height =
            ((width as f64 * source_height as f64 / source_width as f64) / 2.0).round() as u32 * 2;

        Ok(Self {
            name: manifest.id.clone(),
            file: dir.join(&screen.file_name),
            duration: screen.duration(),
            source_width,
            source_height,
            width,
            height,
        })
    }
}

struct Preview {
    source: Source,
    reader: VideoReader,
    compositor: Compositor,
    /// `gpui::surface()` only accepts bi-planar YUV — see `yuv`.
    yuv: Yuv,
    plan: RenderPlan,

    /// The composited frame, held while GPUI draws it.
    ///
    /// It has to outlive the paint: `paint_surface` takes the buffer and the
    /// window samples it later in the frame. Dropping it here would return it to
    /// the compositor's pool to be drawn into again.
    frame: Option<CVPixelBuffer>,

    started: Instant,
    /// Where the last frame was taken from, to notice the loop wrapping.
    at: u64,
    last_frame: Option<Instant>,

    frames: u64,
    /// Time inside `Compositor::render`, which commits and waits for the GPU.
    composite_ms: f64,
    /// Wall time between frames reaching the window — what the eye actually sees.
    present_ms: f64,
    worst_ms: f64,
}

impl Preview {
    fn new(source: Source) -> Self {
        let reader = VideoReader::open(&source.file, 0, source.duration)
            .expect("could not open the screen track");
        let compositor =
            Compositor::new(source.width, source.height).expect("could not start Metal");
        let yuv = Yuv::new(source.width, source.height).expect("could not build the YUV pass");
        let plan = build_plan(&source);

        Self {
            source,
            reader,
            compositor,
            yuv,
            plan,
            frame: None,
            started: Instant::now(),
            at: 0,
            last_frame: None,
            frames: 0,
            composite_ms: 0.0,
            present_ms: 0.0,
            worst_ms: 0.0,
        }
    }

    /// Pulls the recording to wherever the clock is and composites that moment.
    fn advance(&mut self) {
        let elapsed = self.started.elapsed().as_nanos() as u64;
        let at = if self.source.duration > 0 {
            elapsed % self.source.duration
        } else {
            0
        };

        // `VideoReader` only ever pulls forward — it is built for an export,
        // which never goes back. Looping means opening it again. Worth noticing
        // rather than hiding: an editor scrubbing backwards pays this too, and
        // what it costs is part of proof 1's answer.
        if at < self.at {
            match VideoReader::open(&self.source.file, 0, self.source.duration) {
                Ok(reader) => self.reader = reader,
                Err(e) => eprintln!("could not reopen the recording: {e}"),
            }
        }
        self.at = at;

        let composite = Instant::now();
        let composited = {
            // Split borrows: `frame_at` hands back a reference that borrows the
            // reader, and the compositor needs its own mutable borrow at the
            // same time. Through `self` those would be one borrow of the whole
            // struct and would not compile.
            let Self {
                reader,
                compositor,
                yuv,
                plan,
                ..
            } = self;
            let screen = reader.frame_at(at);
            compositor
                .render(plan, screen, None, at)
                .map_err(anyhow::Error::from)
                .and_then(|frame| yuv.convert(&frame))
        };
        let composite_ms = composite.elapsed().as_secs_f64() * 1000.0;

        match composited {
            // The bridge. If this line ever needs a copy, proof 1 has failed —
            // 4K BGRA is ~33 MB a frame, sixty times a second.
            Ok(buffer) => self.frame = Some(bridge::to_gpui(&buffer)),
            Err(e) => eprintln!("composite failed at {at}: {e}"),
        }

        let now = Instant::now();
        if let Some(last) = self.last_frame {
            let present_ms = now.duration_since(last).as_secs_f64() * 1000.0;
            // Smoothed, because a single frame's number is unreadable at 60 Hz.
            // The worst case is kept raw next to it — an average that hides a
            // 40 ms hitch is the wrong measurement for judging playback.
            self.present_ms = ease(self.present_ms, present_ms);
            if self.frames > 10 {
                self.worst_ms = self.worst_ms.max(present_ms);
            }
        }
        self.last_frame = Some(now);
        self.composite_ms = ease(self.composite_ms, composite_ms);
        self.frames += 1;

        // Also to stdout, so a run can be measured without reading a window —
        // and so the numbers in FINDINGS.md are copied from output rather than
        // from memory of what the status bar looked like.
        if self.frames.is_multiple_of(120) {
            println!(
                "{:>5.1}s  {:>6} frames  ({:>4.0} fps overall)  composite {:>5.1} ms  frame {:>5.1} ms ({:>4.0} fps)  worst {:>5.1} ms",
                self.started.elapsed().as_secs_f64(),
                self.frames,
                self.frames as f64 / self.started.elapsed().as_secs_f64(),
                self.composite_ms,
                self.present_ms,
                1000.0 / self.present_ms,
                self.worst_ms
            );
        }
    }
}

/// Exponential smoothing, weighted so a hitch still moves the number visibly.
fn ease(current: f64, sample: f64) -> f64 {
    if current == 0.0 {
        sample
    } else {
        current * 0.9 + sample * 0.1
    }
}

/// A plan roughly like one the editor would send: a background, the recording
/// inset and rounded, and a zoom that comes and goes.
///
/// Hand-built rather than read from `project.json`, because the plan is
/// assembled in TypeScript today — `buildRenderPlan` in `shared/layout.ts` — and
/// porting that is not what proof 1 is testing.
fn build_plan(source: &Source) -> RenderPlan {
    let frame = PlanSize {
        width: source.width as f64,
        height: source.height as f64,
    };

    // The inset the app's default padding produces, near enough for a picture.
    let margin = frame.width * 0.055;
    let base = PlanRect {
        x: margin,
        y: margin,
        width: frame.width - margin * 2.0,
        height: frame.height - margin * 2.0,
    };

    let radius = frame.width * 0.012;
    let shape = Shape {
        radius,
        // The superellipse the UI draws everywhere; 4 is a squircle rather than
        // a rounded rectangle.
        exponent: 4.0,
    };

    // A 1.7× zoom held towards the upper left, which is where a cursor usually
    // is in a window recording.
    let zoom = 1.7;
    let focus = (0.38, 0.42);
    let zoomed = PlanRect {
        x: base.x - (base.width * (zoom - 1.0)) * focus.0,
        y: base.y - (base.height * (zoom - 1.0)) * focus.1,
        width: base.width * zoom,
        height: base.height * zoom,
    };

    let key = |at: i64, rect: &PlanRect, radius: f64| RectKey {
        at,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        radius,
        focus: None,
        vignette: None,
        quad: Vec::new(),
    };

    // Keys are linear between each other by design — the easing lives in where
    // the editor places them, which is what keeps a zoom from being implemented
    // twice. So a straight in/out here reads as a constant-speed push, not as
    // the app's motion. Enough to prove the moving path is live.
    let second = 1_000_000_000i64;
    let motion = vec![
        key(0, &base, radius),
        key(2 * second, &base, radius),
        key(4 * second, &zoomed, radius * zoom),
        key(8 * second, &zoomed, radius * zoom),
        key(10 * second, &base, radius),
    ];

    RenderPlan {
        frame,
        items: vec![
            PlanItem::Fill {
                rect: PlanRect {
                    x: 0.0,
                    y: 0.0,
                    width: frame.width,
                    height: frame.height,
                },
                paint: Paint::Gradient {
                    from: "#2a1e3d".to_owned(),
                    to: "#0d1220".to_owned(),
                    angle: 135.0,
                },
            },
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: PlanRect {
                    x: 0.0,
                    y: 0.0,
                    width: source.source_width as f64,
                    height: source.source_height as f64,
                },
                motion,
                dst_rect: base,
                shape,
                mirror: false,
            },
        ],
    }
}

/// Composites one frame and checks the conversion round-trips.
///
/// Headless on purpose: it answers "is the picture right", which a frame rate
/// cannot, and it can run without a window in the way.
fn check_pixels(source: Source) -> Result<()> {
    let mut reader = VideoReader::open(&source.file, 0, source.duration)?;
    let mut compositor = Compositor::new(source.width, source.height)?;
    let mut yuv = Yuv::new(source.width, source.height)?;
    let plan = build_plan(&source);

    // A second in, so the recording has certainly produced a frame and the zoom
    // has not started — the picture is the plain inset composite.
    let at = source.duration.min(1_000_000_000);
    let mut composited = compositor.render(&plan, reader.frame_at(at), None, at)?;
    let mut converted = yuv.convert(&composited)?;

    // Spread across the frame: the gradient background at two corners, and two
    // points inside the recording itself.
    let points = [
        (8, 8),
        (source.width as usize - 8, source.height as usize - 8),
        (source.width as usize / 2, source.height as usize / 2),
        (source.width as usize / 3, source.height as usize / 3),
    ];

    let mut worst = 0.0f64;
    for (x, y) in points {
        let sample = yuv::compare(&mut composited, &mut converted, x, y);
        println!(
            "({x:>5},{y:>5})  composite {:.3} {:.3} {:.3}  →  through YUV {:.3} {:.3} {:.3}  Δ {:.4}",
            sample.source[0],
            sample.source[1],
            sample.source[2],
            sample.through_yuv[0],
            sample.through_yuv[1],
            sample.through_yuv[2],
            sample.error()
        );
        worst = worst.max(sample.error());
    }

    // 4:2:0 throws away three quarters of the colour, so a difference is
    // expected and only its size is informative. Anything past a few percent is
    // a wrong matrix rather than chroma subsampling.
    println!("worst channel error {worst:.4}");
    if worst > 0.05 {
        bail!("the conversion is not round-tripping: {worst:.4}");
    }
    Ok(())
}

impl Render for Preview {
    fn render(&mut self, window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        self.advance();
        // Keeps the window redrawing with nothing else changing — GPUI is
        // otherwise entirely demand-driven and would draw one frame and stop.
        window.request_animation_frame();

        let fps = if self.present_ms > 0.0 {
            1000.0 / self.present_ms
        } else {
            0.0
        };

        div()
            .flex()
            .flex_col()
            .size_full()
            .bg(rgb(0x0b0d12))
            .child(
                div().flex_1().child(
                    self.frame
                        .clone()
                        .map(|buffer| surface(buffer).size_full().into_any_element())
                        .unwrap_or_else(|| div().size_full().into_any_element()),
                ),
            )
            .child(
                div()
                    .flex()
                    .gap_4()
                    .px_4()
                    .py_2()
                    .text_sm()
                    .text_color(rgb(0x9aa4b8))
                    .bg(rgb(0x141821))
                    .child(format!("{}×{}", self.source.width, self.source.height))
                    .child(format!("{:.1}s", self.at as f64 / 1e9))
                    .child(format!("composite {:.1} ms", self.composite_ms))
                    .child(format!("frame {:.1} ms ({fps:.0} fps)", self.present_ms))
                    .child(format!("worst {:.1} ms", self.worst_ms))
                    .child(format!("{} frames", self.frames)),
            )
    }
}
