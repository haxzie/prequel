//! Reading a finished session back off disk.
//!
//! The manifest describes what the recorder believed it wrote; this reports
//! what the files actually contain, so the editor can lay out against real
//! dimensions and real durations.
//!
//! Synchronisation is *not* what this answers. Every session file is written
//! zero-based, so a track's late start lives only in `session.json` — see
//! `prequel_encode::probe` and its tests.

use napi::bindgen_prelude::*;
use napi_derive::napi;

use prequel_session::TrackKind;

/// Where one track's samples actually begin, on its own file timeline.
#[napi(object)]
#[derive(Debug)]
pub struct TrackProbe {
    /// `"screen"`, `"camera"`, `"microphone"` or `"system_audio"`.
    pub kind: String,
    pub file_name: String,
    /// Presentation time of the first sample, in nanoseconds.
    ///
    /// Zero for everything this app writes. Reported so that a file which is
    /// not zero-based is visible rather than silently mis-seeked.
    pub start: f64,
    /// Duration of the track, in nanoseconds.
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub frame_rate: Option<f64>,
}

/// Probes every track present in a session directory.
///
/// Files that are absent are skipped rather than reported as errors: a silent
/// microphone produces no file at all, and that is a normal recording.
#[napi(ts_return_type = "Promise<TrackProbe[]>")]
pub fn probe_session(dir: String) -> AsyncTask<ProbeSession> {
    AsyncTask::new(ProbeSession { dir })
}

pub struct ProbeSession {
    dir: String,
}

impl Task for ProbeSession {
    type Output = Vec<TrackProbe>;
    type JsValue = Vec<TrackProbe>;

    fn compute(&mut self) -> Result<Self::Output> {
        // Tracks only. The camera's matte sidecar is deliberately not probed:
        // nothing lays out against its size — both rasterisers sample it with
        // the picture's normalised coordinates — and the `<video>` that plays
        // it reports its own dimensions.
        const KINDS: [TrackKind; 4] = [
            TrackKind::Screen,
            TrackKind::Camera,
            TrackKind::Microphone,
            TrackKind::SystemAudio,
        ];

        let root = std::path::Path::new(&self.dir);
        let mut probes = Vec::new();

        for kind in KINDS {
            let file_name = kind.file_name();
            let path = root.join(file_name);
            if !path.exists() {
                continue;
            }

            match prequel_encode::probe_file(&path) {
                Ok(probe) => probes.push(TrackProbe {
                    kind: kind_name(kind).to_owned(),
                    file_name: file_name.to_owned(),
                    start: probe.start as f64,
                    duration: probe.duration as f64,
                    width: probe.width,
                    height: probe.height,
                    frame_rate: probe.frame_rate.map(f64::from),
                }),
                // A file that exists but will not open is worth saying out
                // loud, but not worth failing the whole session over — the
                // other tracks are still editable without it.
                Err(err) => {
                    tracing::warn!("could not probe {}: {err}", path.display());
                }
            }
        }

        Ok(probes)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// What a file from outside the app holds.
///
/// Not `TrackProbe`: an imported video has two tracks where a session file has
/// one, and whether it has a sound track at all is the answer the import needs
/// most — a manifest that claims audio the file does not have exports as a
/// failure rather than as a silent clip.
#[napi(object)]
#[derive(Debug)]
pub struct MediaProbe {
    /// Longest of the tracks, in nanoseconds — what the clip will run for.
    pub duration: f64,
    pub has_video: bool,
    pub has_audio: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub frame_rate: Option<f64>,
}

/// Probes one media file, by path, for what an import needs to know.
#[napi(ts_return_type = "Promise<MediaProbe>")]
pub fn probe_media(path: String) -> AsyncTask<ProbeMedia> {
    AsyncTask::new(ProbeMedia { path })
}

pub struct ProbeMedia {
    path: String,
}

impl Task for ProbeMedia {
    type Output = MediaProbe;
    type JsValue = MediaProbe;

    fn compute(&mut self) -> Result<Self::Output> {
        let probe = prequel_encode::probe_media(std::path::Path::new(&self.path))
            .map_err(|err| Error::from_reason(format!("PROBE: {err}")))?;

        let video = probe.video;
        let audio = probe.audio;

        Ok(MediaProbe {
            // The longer of the two, because they need not agree: a file whose
            // sound runs a beat past its last frame is still that long, and a
            // clip cut to the picture would drop the end of a sentence.
            duration: video
                .map(|track| track.duration)
                .unwrap_or(0)
                .max(audio.map(|track| track.duration).unwrap_or(0)) as f64,
            has_video: video.is_some(),
            has_audio: audio.is_some(),
            width: video.and_then(|track| track.width),
            height: video.and_then(|track| track.height),
            frame_rate: video.and_then(|track| track.frame_rate).map(f64::from),
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Screenshots the current desktop picture to `path`, as a PNG.
///
/// A screenshot rather than a file lookup: on macOS 14+ the wallpaper store
/// does not reliably name a file, and a dynamic or video wallpaper has no still
/// image to name at all. Prequel already holds the Screen Recording grant this
/// needs, so it costs no new permission.
#[napi(ts_return_type = "Promise<void>")]
pub fn capture_wallpaper(display_id: u32, path: String) -> AsyncTask<CaptureWallpaper> {
    AsyncTask::new(CaptureWallpaper { display_id, path })
}

pub struct CaptureWallpaper {
    display_id: u32,
    path: String,
}

impl Task for CaptureWallpaper {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        prequel_capture::capture_wallpaper(self.display_id, std::path::Path::new(&self.path))
            .map_err(|err| Error::from_reason(format!("WALLPAPER: {err}")))
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

/// The same spelling serde writes into the manifest, so both sides agree.
fn kind_name(kind: TrackKind) -> &'static str {
    match kind {
        TrackKind::Screen => "screen",
        TrackKind::Camera => "camera",
        TrackKind::Microphone => "microphone",
        TrackKind::SystemAudio => "system_audio",
    }
}
