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
