//! The export loop.
//!
//! Output-frame driven: for each frame of the result, work out which moment of
//! the recording belongs there, pull every reader forward to it, composite, and
//! append. See [`crate::timeline`] for why that direction is the one that makes
//! cuts and mismatched frame rates fall out for free.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use cidre::cv;
use prequel_encode::{AudioWriterConfig, GifWriter, VideoCodec, VideoWriter, VideoWriterConfig};
use prequel_session::{MediaTime, TrackKind};

use crate::compositor::Compositor;
use crate::mixer::{self, CHANNELS, Gain};
use crate::reader::{VideoReader, read_audio};
use crate::timeline::{SliceRender, Timeline};
use crate::{Error, Result};

/// What the exporter writes audio at. Every source is resampled to it on read,
/// so the mixer never has to reconcile two rates.
const SAMPLE_RATE: f64 = 48_000.0;

/// How far ahead of the picture the sound is written.
///
/// See the append in `run`: this is what keeps the writer's two inputs from
/// waiting on each other.
const AUDIO_LEAD: MediaTime = 1_000_000_000;

/// How often progress is reported.
///
/// Throttled here rather than in JavaScript: a per-frame callback for a
/// five-minute export at 60 fps is eighteen thousand hops through the main
/// thread, which is a cost paid purely to redraw a progress bar nobody can read
/// that fast.
const PROGRESS_EVERY: u64 = 6;

/// What the export is written as.
///
/// A format rather than a codec, because GIF is not one: it carries no audio,
/// it is encoded on the CPU, and its frame timing is centiseconds rather than
/// a presentation timestamp. Treating it as a third codec would have every one
/// of those differences appear as a special case somewhere further down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OutputFormat {
    #[default]
    Mp4,
    /// H.265 in an MP4. Smaller at the same quality, less widely playable.
    Mp4Hevc,
    Gif,
}

impl OutputFormat {
    fn codec(self) -> VideoCodec {
        match self {
            Self::Mp4Hevc => VideoCodec::Hevc,
            _ => VideoCodec::H264,
        }
    }

    /// Whether a mixed audio track is written beside the picture.
    fn carries_audio(self) -> bool {
        !matches!(self, Self::Gif)
    }
}

#[derive(Debug, Clone)]
pub struct ExportRequest {
    pub session_dir: PathBuf,
    pub output: PathBuf,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub format: OutputFormat,
    pub slices: Vec<SliceRender>,
    /// Per-track offsets from the manifest, in nanoseconds.
    ///
    /// The only place a late start is recorded — every session file is written
    /// zero-based, so the media cannot say when its own track began.
    pub screen_offset: MediaTime,
    pub camera_offset: MediaTime,
    pub mic_offset: MediaTime,
    pub system_offset: MediaTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    Preparing,
    Rendering,
    Finalising,
}

#[derive(Debug, Clone, Copy)]
pub struct Progress {
    pub stage: Stage,
    pub frames_done: u64,
    pub frames_total: u64,
}

#[derive(Debug, Clone)]
pub struct ExportSummary {
    pub frames: u64,
    pub duration: MediaTime,
    pub output: PathBuf,
}

/// A flag the caller flips to stop an export in progress.
#[derive(Debug, Clone, Default)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

/// Renders an edit to a single MP4.
///
/// A failure leaves nothing behind. Half a video on disk is worse than none:
/// `AVAssetWriter` refuses to write to a path that already exists, so a partial
/// file from a failed run makes every retry fail too — which reads as a broken
/// exporter rather than as one bad attempt.
pub fn export(
    request: &ExportRequest,
    cancel: &CancelFlag,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<ExportSummary> {
    let result = run(request, cancel, on_progress);

    if result.is_err() {
        let _ = std::fs::remove_file(&request.output);
    }

    result
}

fn run(
    request: &ExportRequest,
    cancel: &CancelFlag,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<ExportSummary> {
    if request.slices.is_empty() {
        return Err(Error::Empty);
    }

    let timeline = Timeline::new(&request.slices, request.fps);
    let total = timeline.frame_count();

    on_progress(Progress {
        stage: Stage::Preparing,
        frames_done: 0,
        frames_total: total,
    });

    let mut compositor = Compositor::new(request.width, request.height)?;

    // Loaded once, before the loop: a background re-decoded and re-uploaded per
    // frame would dominate the export, and every slice tends to name the same
    // one. A missing image is skipped rather than fatal — the rest of the frame
    // is still worth rendering.
    for path in plan_images(&request.slices) {
        let full = request.session_dir.join(&path);

        // Never fatal, at either step. A background that will not load is a
        // plainer video; failing the export instead would throw away the
        // footage as well, which is the part that cannot be remade.
        match crate::image::decode(&full).and_then(|buffer| compositor.add_image(&path, buffer)) {
            Ok(()) => tracing::debug!("loaded background {}", full.display()),
            Err(err) => tracing::warn!("could not load {}: {err}", full.display()),
        }
    }
    // Before the writer exists, because the writer has to be told whether the
    // file carries sound before it will take a single frame. A mix that fails is
    // a silent export rather than a lost one: the footage is the part that cannot
    // be remade.
    let mixed = if request.format.carries_audio() {
        mix_audio(request).unwrap_or_else(|err| {
            tracing::warn!("could not mix the exported audio: {err}");
            Vec::new()
        })
    } else {
        Vec::new()
    };

    let mut writer = Sink::create(request, !mixed.is_empty())?;

    let screen_path = request.session_dir.join(TrackKind::Screen.file_name());
    let camera_path = request.session_dir.join(TrackKind::Camera.file_name());

    let frame_duration = timeline.frame_duration();
    let mut current_slot = usize::MAX;
    let mut screen: Option<VideoReader> = None;
    let mut camera: Option<VideoReader> = None;
    let mut written = 0u64;
    // How much of the mix has reached the writer, as an index into it.
    let mut sent = 0usize;

    for index in 0..total {
        if cancel.is_cancelled() {
            writer.cancel();
            return Err(Error::Cancelled);
        }

        let Some((slot, source)) = timeline.locate(index, &request.slices) else {
            break;
        };
        let slice = &request.slices[slot];

        // A cut means every reader is now somewhere else entirely, so each
        // slice gets its own: `AVAssetReader` cannot seek backwards, and slices
        // can be reordered.
        if slot != current_slot {
            current_slot = slot;
            screen = open_reader(&screen_path, slice, request.screen_offset);
            camera = open_reader(&camera_path, slice, request.camera_offset);
        }

        let screen_frame = screen
            .as_mut()
            .zip(file_time(source, request.screen_offset))
            .and_then(|(reader, at)| reader.frame_at(at));

        // Deliberately nothing before the camera opened: holding its first
        // frame across the gap would show something that was never recorded,
        // and the preview draws nothing there for the same reason.
        let camera_frame = camera
            .as_mut()
            .zip(file_time(source, request.camera_offset))
            .and_then(|(reader, at)| reader.frame_at(at));

        // Immediately before the render and never inside it — see
        // `load_captions`. Caption bitmaps are decoded on demand rather than
        // preloaded, because there is one per cue rather than one per session.
        compositor.load_captions(&request.session_dir, &slice.plan, source);

        let composited = compositor.render(&slice.plan, screen_frame, camera_frame, source)?;
        if !writer.append(&composited, index * frame_duration)? {
            return Err(Error::Write {
                path: request.output.display().to_string(),
                reason: format!(
                    "the encoder would not take the frame at {}ns",
                    index * frame_duration
                ),
            });
        }
        written += 1;

        // Kept *ahead* of the picture, not level with it. `AVAssetWriter` holds an
        // input not-ready until the others catch up, and this loop sleeps while
        // waiting for the video input — so it never reaches the audio append that
        // would release it. Video waits on audio, audio waits on video, and the
        // export stops. Running the sound a second in front means the video input
        // is never the one waiting.
        if !mixed.is_empty() {
            let upto = samples_upto(index * frame_duration + AUDIO_LEAD, mixed.len());
            if upto > sent {
                writer.append_audio(&mixed[sent..upto])?;
                sent = upto;
            }
            if sent == mixed.len() {
                writer.finish_audio();
            }
        }

        if index % PROGRESS_EVERY == 0 {
            on_progress(Progress {
                stage: Stage::Rendering,
                frames_done: index,
                frames_total: total,
            });
        }
    }

    on_progress(Progress {
        stage: Stage::Finalising,
        frames_done: written,
        frames_total: total,
    });

    // Whatever is left. The frame grid rarely lands exactly on the last sample,
    // and dropping the remainder would clip the final fraction of a second.
    if sent < mixed.len()
        && let Err(err) = writer.append_audio(&mixed[sent..])
    {
        tracing::warn!("could not write the last of the exported audio: {err}");
    }

    // Ended a frame past the last one, so the final frame has a duration rather
    // than being a zero-length blip the player skips.
    writer.finish_at(written.saturating_sub(1) * frame_duration + frame_duration)?;

    Ok(ExportSummary {
        frames: written,
        duration: timeline.duration(),
        output: request.output.clone(),
    })
}

/// Where composited frames go, whichever format was asked for.
///
/// One loop writes both. Splitting the export into a video path and a GIF path
/// would mean two copies of the reader handling, the cut handling and the
/// cancellation checks — and the moment those drift, an edit exports correctly
/// as one format and wrongly as the other.
enum Sink {
    Video(VideoWriter),
    /// Boxed: `GifWriter` carries a reusable megabytes-wide scratch buffer, and
    /// an enum is as large as its largest variant everywhere it is moved.
    Gif(Box<GifWriter>),
}

impl Sink {
    /// `has_audio` decides whether the file gets a sound track at all, and has
    /// to be known here: `AVAssetWriter` accepts inputs only before it starts
    /// writing. That is why the mix happens before the first frame is drawn.
    fn create(request: &ExportRequest, has_audio: bool) -> Result<Self> {
        Ok(match request.format {
            OutputFormat::Gif => Self::Gif(Box::new(GifWriter::create(
                &request.output,
                request.width,
                request.height,
                request.fps,
            )?)),
            format => Self::Video(VideoWriter::create(
                &request.output,
                // Offline: no frame may be dropped. Frames come from a file, so
                // the writer waits for the encoder rather than skipping ahead.
                &{
                    let config = VideoWriterConfig::new(request.width, request.height)
                        .with_codec(format.codec())
                        .offline();
                    if has_audio {
                        // Offline here too: a busy encoder must not silently drop
                        // a buffer and leave a hole in the sound.
                        config.with_audio(
                            AudioWriterConfig::new(SAMPLE_RATE, CHANNELS as i32).offline(),
                        )
                    } else {
                        config
                    }
                },
            )?),
        })
    }

    /// Appends one frame.
    ///
    /// The timestamp is ignored by GIF, which has no concept of one — every
    /// frame carries the same fixed delay instead, set when the file was
    /// opened. That is only correct because the export loop emits frames on an
    /// even grid; a variable-rate writer would need the delay per frame.
    /// Appends one frame, reporting whether the encoder took it.
    ///
    /// Offline, so "busy" is not a normal outcome — the writer waits rather than
    /// skipping. `false` means it waited out its timeout and gave up, and the
    /// caller must not ignore it: swallowing it writes a video shorter than the
    /// edit with nothing anywhere to say why.
    fn append(&mut self, image: &cv::PixelBuf, pts: MediaTime) -> Result<bool> {
        Ok(match self {
            Self::Video(writer) => writer.append(image, pts)?,
            Self::Gif(writer) => {
                writer.append(image)?;
                true
            }
        })
    }

    /// Writes the next run of the mixed track.
    ///
    /// A GIF has no sound, so there is nothing to write and nothing to warn
    /// about — the caller does not ask.
    fn finish_audio(&mut self) {
        if let Self::Video(writer) = self {
            writer.finish_audio();
        }
    }

    fn append_audio(&mut self, mixed: &[f32]) -> Result<()> {
        match self {
            Self::Video(writer) => writer.append_audio(mixed, SAMPLE_RATE)?,
            Self::Gif(_) => {}
        }
        Ok(())
    }

    fn finish_at(self, pts: MediaTime) -> Result<()> {
        match self {
            Self::Video(writer) => {
                writer.finish_at(pts)?;
            }
            Self::Gif(writer) => {
                writer.finish()?;
            }
        }
        Ok(())
    }

    fn cancel(self) {
        match self {
            Self::Video(writer) => writer.cancel(),
            // Nothing to tell the encoder: the half-written file is removed by
            // `export` along with every other failure's leftovers.
            Self::Gif(_) => {}
        }
    }
}

/// Every distinct background image a plan names, in order of first use.
/// Every image a plan names, whatever it names it for.
///
/// Backgrounds *and* the pointer. Collecting only backgrounds is how the
/// pointer came to be missing from exports for a while: an image the
/// compositor was never given is skipped rather than drawn, which is right —
/// a black rectangle would be worse — but it means a gap here shows up as
/// something quietly absent from the video and nowhere else.
fn plan_images(slices: &[SliceRender]) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    let push = |path: &String, paths: &mut Vec<String>| {
        if !path.is_empty() && !paths.contains(path) {
            paths.push(path.clone());
        }
    };

    for slice in slices {
        for item in &slice.plan.items {
            match item {
                crate::plan::PlanItem::Fill {
                    paint: crate::plan::Paint::Image { path },
                    ..
                } => push(path, &mut paths),
                crate::plan::PlanItem::Cursor { path, .. } => push(path, &mut paths),
                // Captions are deliberately not here. They are decoded on
                // demand by `Compositor::load_captions`, because there is one
                // per cue rather than one per session and preloading a long
                // take's worth at 4K is over a gigabyte of wired memory.
                _ => {}
            }
        }
    }

    paths
}

/// Opens a reader for one slice's span of a file, if the file exists.
fn open_reader(path: &Path, slice: &SliceRender, offset: MediaTime) -> Option<VideoReader> {
    if !path.exists() {
        return None;
    }

    // The slice's source range, moved onto this file's own zero-based timeline.
    let start = slice.start.saturating_sub(offset);
    let end = slice.end.saturating_sub(offset);
    if end <= start {
        return None;
    }

    match VideoReader::open(path, start, end) {
        Ok(reader) => Some(reader),
        Err(err) => {
            // A track that will not open leaves a hole in the picture rather
            // than failing the whole export — the other tracks are still worth
            // rendering.
            tracing::warn!("could not read {}: {err}", path.display());
            None
        }
    }
}

/// Source time to a position inside one track's file, or None before it began.
/// How much of a gap at a track's start is closed by holding its first frame.
///
/// Mirrored by `EDGE_TOLERANCE` in the editor's `timeline.ts`.
const EDGE_TOLERANCE: MediaTime = 500_000_000;

fn file_time(source: MediaTime, offset: MediaTime) -> Option<MediaTime> {
    if source >= offset {
        return Some(source - offset);
    }

    // Before the track opened. Held at its first frame across a short gap
    // rather than left empty: the camera routinely opens a couple of hundred
    // milliseconds after the screen, and a hole at the head of every export is
    // what reads as the camera arriving late. Mirrors `toFileTime` in
    // `apps/desktop/src/renderer/src/editor/timeline.ts`, so the preview and
    // the export show it over the same span.
    (offset - source <= EDGE_TOLERANCE).then_some(0)
}

/// Where a moment falls in the interleaved mix, as an index into it.
///
/// Rounded to a whole audio frame and clamped to what was mixed: a run that
/// began mid-frame would interleave the channels the wrong way round from there
/// on, which is heard as the stereo image collapsing rather than as an error.
fn samples_upto(at: MediaTime, len: usize) -> usize {
    let frames = (at as f64 / 1e9 * SAMPLE_RATE).round() as usize;
    (frames * CHANNELS).min(len - len % CHANNELS)
}

/// Mixes the audio track down to interleaved samples.
///
/// Mixing and writing are separate because the writer has to be told about the
/// sound track before it starts taking frames — `AVAssetWriter` refuses an input
/// added after `startWriting`. So this runs first, and its result decides whether
/// the file gets an audio track at all.
///
/// Empty when the recording had no sound, every source was muted, or nothing
/// would decode. The caller then writes a silent video, which is the honest
/// outcome and was always the intent.
fn mix_audio(request: &ExportRequest) -> Result<Vec<f32>> {
    let mic_path = request.session_dir.join(TrackKind::Microphone.file_name());
    let system_path = request.session_dir.join(TrackKind::SystemAudio.file_name());

    if !mic_path.exists() && !system_path.exists() {
        return Ok(Vec::new());
    }

    let mut mixed: Vec<f32> = Vec::new();

    for slice in &request.slices {
        let mut span = mixer::silence(slice.duration(), SAMPLE_RATE);

        for (path, offset, gain) in [
            (&mic_path, request.mic_offset, Gain(slice.audio.mic)),
            (
                &system_path,
                request.system_offset,
                Gain(slice.audio.system),
            ),
        ] {
            if !path.exists() || gain.is_silent() {
                continue;
            }

            let start = slice.start.saturating_sub(offset);
            let end = slice.end.saturating_sub(offset);
            if end <= start {
                continue;
            }

            match read_audio(path, start, end, SAMPLE_RATE) {
                Ok(samples) => mixer::mix_into(&mut span, &samples, gain),
                // A track that will not decode is a quiet export, not a failed
                // one — the picture is still worth having.
                Err(err) => tracing::warn!("could not read {}: {err}", path.display()),
            }
        }

        mixed.extend_from_slice(&span);
    }

    // Clipped once, after everything is summed: clamping each source first
    // would distort a track that is only loud because another sits under it.
    mixer::clip(&mut mixed);

    Ok(mixed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::{Paint, PlanItem, Point, Rect, RenderPlan, Size};
    use crate::timeline::AudioMix;

    fn slice_with(items: Vec<PlanItem>) -> SliceRender {
        SliceRender {
            start: 0,
            end: 1,
            plan: RenderPlan {
                frame: Size {
                    width: 1920.0,
                    height: 1080.0,
                },
                items,
            },
            audio: AudioMix {
                mic: 1.0,
                system: 1.0,
            },
        }
    }

    #[test]
    fn gathers_the_pointer_as_well_as_the_background() {
        // The pointer was missing from exports because this collected only
        // backgrounds. An image the compositor is never given is skipped
        // rather than drawn, so the symptom was a video with no pointer in it
        // and nothing logged anywhere.
        let paths = plan_images(&[slice_with(vec![
            PlanItem::Fill {
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 1920.0,
                    height: 1080.0,
                },
                paint: Paint::Image {
                    path: "background.png".to_owned(),
                },
            },
            PlanItem::Cursor {
                path: "cursor.png".to_owned(),
                size: 38.0,
                hotspot: Point { x: 0.055, y: 0.055 },
                points: Vec::new(),
            },
        ])]);

        assert!(paths.contains(&"background.png".to_owned()));
        assert!(paths.contains(&"cursor.png".to_owned()));
    }

    #[test]
    fn names_both_pointer_images_when_one_changes_shape() {
        // A pointer that becomes a hand over a link is two items, one per
        // image. Loading only the first would show as an export whose pointer
        // vanishes over every link while the preview drew it — the preview
        // loads its own images and would not agree.
        let paths = plan_images(&[slice_with(vec![
            PlanItem::Cursor {
                path: "cursor-black.png".to_owned(),
                size: 38.0,
                hotspot: Point { x: 0.055, y: 0.055 },
                points: Vec::new(),
            },
            PlanItem::Cursor {
                path: "cursor-black-hand.png".to_owned(),
                size: 38.0,
                hotspot: Point {
                    x: 0.3754,
                    y: 0.055,
                },
                points: Vec::new(),
            },
        ])]);

        assert_eq!(
            paths,
            vec![
                "cursor-black.png".to_owned(),
                "cursor-black-hand.png".to_owned()
            ]
        );
    }

    #[test]
    fn names_each_image_once_however_many_slices_use_it() {
        // Every slice carries the same pointer image; decoding it per slice
        // would be pure waste.
        let cursor = || PlanItem::Cursor {
            path: "cursor.png".to_owned(),
            size: 38.0,
            hotspot: Point { x: 0.0, y: 0.0 },
            points: Vec::new(),
        };

        assert_eq!(
            plan_images(&[slice_with(vec![cursor()]), slice_with(vec![cursor()])]),
            vec!["cursor.png".to_owned()]
        );
    }
}
