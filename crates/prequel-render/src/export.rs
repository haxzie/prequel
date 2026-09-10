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
use crate::reader::{AudioReader, VideoReader};
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

/// Where an export's wall clock actually goes.
///
/// The loop below runs decode, composite and encode strictly one after another,
/// on three independent engines, and the obvious question is what that costs.
/// Measured, on an M-series Mac, exporting a real 31-second session to 1080p60
/// H.264 with a five-item plan: **decode 4%, render 5%, encode 85-90%**.
///
/// So: nothing. The export is encode-bound, and not by a little. `ffmpeg` given
/// the same 1800 frames through the same `h264_videotoolbox` takes 7.66s where
/// the whole export — decode, composite, mix and encode — takes 7.68s. There is
/// no headroom in this crate to find, because VideoToolbox is the wall.
///
/// Overlapping render and encode was tried and measured at **0.8%**, which is
/// what the numbers above predict: committing the frame without waiting can
/// only recover the time the GPU was idle, and that was 2-3%. It cost retained
/// source buffers, a double-buffered caption backdrop and a lifetime rule on
/// every frame in flight, so it was taken back out.
///
/// Kept rather than deleted now the question is answered, because the answer
/// moves: it is a property of the machine, the resolution and the codec, and
/// the next person to ask should read a number rather than re-derive one. The
/// thing to check first is whether encode is still the wall — if it is, the
/// only lever left is what is asked of the encoder, not how this loop is shaped.
///
/// Summed rather than sampled: the per-frame cost is tens of microseconds and a
/// timer around each stage would be a large fraction of what it measures if it
/// were reported per frame. Logged once, at the end, at `info` so it reaches
/// `main.log` in a packaged build without a rebuild.
#[derive(Default)]
struct StageTimes {
    decode: std::time::Duration,
    render: std::time::Duration,
    encode: std::time::Duration,
}

impl StageTimes {
    fn report(&self, frames: u64, total: std::time::Duration) {
        let ms = |d: std::time::Duration| d.as_secs_f64() * 1e3;
        let share = |d: std::time::Duration| {
            if total.is_zero() {
                0.0
            } else {
                d.as_secs_f64() / total.as_secs_f64() * 100.0
            }
        };

        tracing::info!(
            "export of {frames} frames took {:.0}ms — decode {:.0}ms ({:.0}%), \
             render {:.0}ms ({:.0}%), encode {:.0}ms ({:.0}%)",
            ms(total),
            ms(self.decode),
            share(self.decode),
            ms(self.render),
            share(self.render),
            ms(self.encode),
            share(self.encode),
        );
    }
}

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
    // file carries sound before it will take a single frame. Opening decodes
    // nothing — it answers that one question from which files are there, and
    // the mixing itself happens a chunk at a time inside the loop below.
    let mut audio = request
        .format
        .carries_audio()
        .then(|| AudioStream::open(request))
        .flatten();

    let mut writer = Sink::create(request, audio.is_some())?;

    // The mix's two working buffers, allocated once here rather than per chunk.
    let mut chunk: Vec<f32> = Vec::new();
    let mut scratch: Vec<f32> = Vec::new();
    let mut audio_done = false;

    let screen_path = request.session_dir.join(TrackKind::Screen.file_name());
    let camera_path = request.session_dir.join(TrackKind::Camera.file_name());

    let frame_duration = timeline.frame_duration();
    let mut current_slot = usize::MAX;
    let mut screen: Option<VideoReader> = None;
    let mut camera: Option<VideoReader> = None;
    let mut written = 0u64;

    let mut times = StageTimes::default();
    let began = std::time::Instant::now();

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

        let decoding = std::time::Instant::now();

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
        times.decode += decoding.elapsed();

        let rendering = std::time::Instant::now();
        let composited = compositor.render(&slice.plan, screen_frame, camera_frame, source)?;
        times.render += rendering.elapsed();

        let encoding = std::time::Instant::now();
        let took = writer.append(&composited, index * frame_duration)?;
        times.encode += encoding.elapsed();

        if !took {
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
        if let Some(stream) = audio.as_mut()
            && !audio_done
        {
            let upto = samples_upto(index * frame_duration + AUDIO_LEAD, stream.total());
            while stream.produced() < upto && stream.next(&mut chunk, &mut scratch) {
                writer.append_audio(&chunk)?;
            }

            // The moment the last sample is written, and not when a later call
            // happens to run out. `AVAssetWriter` holds the *video* input
            // not-ready while it waits on a sound track that still might have
            // something to say — so an audio track that is finished but never
            // said so stops the export a second before the end, which is the
            // same deadlock `AUDIO_LEAD` exists to avoid, arrived at from the
            // other side.
            if stream.produced() == stream.total() {
                writer.finish_audio();
                audio_done = true;
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

    times.report(written, began.elapsed());

    on_progress(Progress {
        stage: Stage::Finalising,
        frames_done: written,
        frames_total: total,
    });

    // Whatever is left. The frame grid rarely lands exactly on the last sample,
    // and dropping the remainder would clip the final fraction of a second.
    if let Some(stream) = audio.as_mut()
        && !audio_done
    {
        while stream.next(&mut chunk, &mut scratch) {
            if let Err(err) = writer.append_audio(&chunk) {
                tracing::warn!("could not write the last of the exported audio: {err}");
                break;
            }
        }
        writer.finish_audio();
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
                    paint: crate::plan::Paint::Image { path, .. },
                    ..
                } => push(path, &mut paths),
                crate::plan::PlanItem::Cursor { path, .. } => push(path, &mut paths),
                // One per session like the background, not one per cue like a
                // caption — so it is preloaded rather than fetched on demand.
                crate::plan::PlanItem::Watermark { path, .. } => push(path, &mut paths),
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

/// The exported soundtrack, mixed a chunk at a time as the picture is written.
///
/// This used to be one `Vec<f32>` holding the whole export, built before the
/// first frame was drawn. Interleaved stereo at 48 kHz is 384 KB a second, and
/// the buffer doubles as it grows — so the peak was nearer 1.4 MB a second than
/// 384 KB, with the old and new allocations both live across a reallocation.
///
/// Measured, exporting a real session with mic and system audio: peak RSS went
/// 165 MB at a 90-second export, 528 MB at six minutes, 1.3 GB at fifteen —
/// straight-line growth in the length of the edit. Streaming it holds flat at
/// 65-73 MB across the same range. Nothing ever needed the mix whole: the loop
/// below feeds the writer a second at a time through `samples_upto`.
///
/// What genuinely has to be known up front is only whether the file gets a
/// sound track at all, because `AVAssetWriter` refuses an input added after
/// `startWriting`. That is a question about which files exist, and answering it
/// costs nothing — see `open`.
///
/// The audio runs ahead of the picture, so this keeps its own slice cursor
/// rather than following the one driving the readers: by the time the last
/// frame of a slice is drawn, the sound of the next one has already been
/// written.
struct AudioStream<'a> {
    slices: &'a [SliceRender],
    /// Absent where the recording has no such track. Held rather than re-tested
    /// per slice, because `exists` on a missing file is a syscall a slice.
    sources: [Option<(PathBuf, MediaTime)>; 2],
    /// The slice being mixed, which is not the slice being drawn.
    slot: usize,
    readers: [Option<AudioReader>; 2],
    gains: [Gain; 2],
    /// Samples this slice owes, and how many of them have been mixed.
    owed: usize,
    done: usize,
    /// Mixed so far, across every slice — what `samples_upto` is compared to.
    produced: usize,
    /// What the finished mix will contain, known without decoding a byte of it.
    total: usize,
}

/// How much of the mix is built at once, in interleaved samples.
///
/// A quarter of a second. Small enough that the peak no longer depends on how
/// long the take was, large enough that it is hundreds of decoded buffers
/// rather than a handful — and comfortably under `AUDIO_LEAD`, so the writer is
/// never waiting on the next chunk to be mixed.
const AUDIO_CHUNK: usize = (SAMPLE_RATE as usize / 4) * CHANNELS;

impl<'a> AudioStream<'a> {
    /// Prepares the mix, or `None` where the export has no sound to write.
    ///
    /// Deliberately decodes nothing. The old `mix_audio` answered "is there a
    /// sound track?" with "is the mixed buffer non-empty?", which meant mixing
    /// the entire recording before the writer could be created. The same
    /// answer is "does either file exist, and does the edit occupy any time at
    /// all" — a pair of `exists` calls and some arithmetic.
    fn open(request: &'a ExportRequest) -> Option<Self> {
        let sources = [
            (TrackKind::Microphone, request.mic_offset),
            (TrackKind::SystemAudio, request.system_offset),
        ]
        .map(|(kind, offset)| {
            let path = request.session_dir.join(kind.file_name());
            path.exists().then_some((path, offset))
        });

        if sources.iter().all(Option::is_none) {
            return None;
        }

        let total: usize = request
            .slices
            .iter()
            .map(|slice| mixer::frames_for(slice.duration(), SAMPLE_RATE) * CHANNELS)
            .sum();

        if total == 0 {
            return None;
        }

        let mut stream = Self {
            slices: &request.slices,
            sources,
            slot: 0,
            readers: [None, None],
            gains: [Gain(0.0), Gain(0.0)],
            owed: 0,
            done: 0,
            produced: 0,
            total,
        };
        stream.open_slot();

        Some(stream)
    }

    fn total(&self) -> usize {
        self.total
    }

    fn produced(&self) -> usize {
        self.produced
    }

    /// Opens the readers for `slot` and works out what it owes.
    ///
    /// A source that will not decode leaves its reader `None`, which mixes as
    /// silence: a track that will not open is a quiet export, not a failed one
    /// — the picture is still worth having.
    fn open_slot(&mut self) {
        let slice = &self.slices[self.slot];

        self.owed = mixer::frames_for(slice.duration(), SAMPLE_RATE) * CHANNELS;
        self.done = 0;
        self.gains = [Gain(slice.audio.mic), Gain(slice.audio.system)];

        for (index, source) in self.sources.iter().enumerate() {
            let Some((path, offset)) = source else {
                self.readers[index] = None;
                continue;
            };

            // A muted source is not opened at all. Its samples would be
            // multiplied by zero and thrown away, and the decode is the
            // expensive half of that.
            if self.gains[index].is_silent() {
                self.readers[index] = None;
                continue;
            }

            let start = slice.start.saturating_sub(*offset);
            let end = slice.end.saturating_sub(*offset);
            if end <= start {
                self.readers[index] = None;
                continue;
            }

            self.readers[index] = match AudioReader::open(path, start, end, SAMPLE_RATE) {
                Ok(reader) => Some(reader),
                Err(err) => {
                    tracing::warn!("could not read {}: {err}", path.display());
                    None
                }
            };
        }
    }

    /// Mixes the next chunk into `chunk`, reusing `scratch` for each source.
    ///
    /// False once every slice has been mixed. Both buffers are the caller's so
    /// that a long export allocates them once rather than per chunk.
    fn next(&mut self, chunk: &mut Vec<f32>, scratch: &mut Vec<f32>) -> bool {
        // A slice can be shorter than one chunk, and a slice with no duration
        // owes nothing at all, so this walks forward rather than stepping once.
        while self.done == self.owed {
            if self.slot + 1 >= self.slices.len() {
                return false;
            }
            self.slot += 1;
            self.open_slot();
        }

        let run = (self.owed - self.done).min(AUDIO_CHUNK);

        // Silence to sum into. A slice whose audio is missing still occupies
        // time in the output, so it is filled rather than skipped — otherwise
        // every later slice would slide earlier and drift out of step with the
        // picture.
        chunk.clear();
        chunk.resize(run, 0.0);

        for (index, reader) in self.readers.iter_mut().enumerate() {
            let Some(reader) = reader else { continue };

            scratch.clear();
            scratch.resize(run, 0.0);
            let got = reader.read(scratch);

            mixer::mix_into(chunk, &scratch[..got], self.gains[index]);
        }

        // Per chunk rather than once over the whole mix, which is the same
        // thing: `clip` is a per-sample clamp, and every source that
        // contributes to a sample has already been summed into it by here.
        mixer::clip(chunk);

        self.done += run;
        self.produced += run;

        true
    }
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
                    blur: 0.0,
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
