//! The waveform's peaks for one audio file, from JavaScript.
//!
//! An `AsyncTask`, the shape `voice.rs` uses: the pass is a streaming read
//! that finishes in a second or two for an hour of audio, with nothing worth
//! reporting in the middle. The result crosses as one `Float32Array`, which is
//! what the editor's `waveform.ts` already works in.

use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi_derive::napi;

pub struct Peaks {
    path: PathBuf,
}

impl Task for Peaks {
    type Output = Vec<f32>;
    type JsValue = Float32Array;

    fn compute(&mut self) -> Result<Self::Output> {
        prequel_render::peaks::peaks(&self.path)
            .map_err(|err| Error::from_reason(format!("PEAKS_FAILED: {err}")))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(Float32Array::new(output))
    }
}

/// The loudest sample in each 50 ms of `path`, as raw 0–1 amplitude.
///
/// Twenty a second, in file order — `prequel_render::peaks::BUCKETS_PER_SECOND`,
/// which `waveform.ts` has to match to turn an index back into a time.
#[napi(ts_return_type = "Promise<Float32Array>")]
pub fn audio_peaks(path: String) -> AsyncTask<Peaks> {
    AsyncTask::new(Peaks {
        path: PathBuf::from(path),
    })
}
