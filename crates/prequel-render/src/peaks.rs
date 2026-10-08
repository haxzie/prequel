//! The shape of a recording's audio, for the timeline to draw.
//!
//! One number per 50 ms: the loudest sample in that slice of the file. That is
//! all a clip a few hundred pixels wide can show, and it is small — an hour is
//! 72,000 floats, under 300 KB.
//!
//! Computed here, streaming, rather than in the editor. This used to be
//! `decodeAudioData` in the renderer, which decodes the *entire* file into
//! memory at its native rate before resampling — around 4 GB of PCM for an
//! hour of stereo 48 kHz, held twice over, and once per concurrent call. An
//! hour-long recording killed the renderer on open, every time. Reading
//! through `AVAssetReader` a buffer at a time never holds more than one
//! decoder chunk and the peaks themselves, whatever the length of the take.

use std::path::Path;

use crate::Result;
use crate::reader::AudioReader;

/// Peaks per second of audio. 50 ms resolution.
///
/// The editor's `waveform.ts` carries the same number, and the two have to
/// agree: a peak index is turned back into a time on the session clock there.
pub const BUCKETS_PER_SECOND: u32 = 20;

/// What the file is decoded at.
///
/// The peaks only need enough resolution to find the loudest sample in a 50 ms
/// bucket, and 8 kHz still leaves 400 samples per bucket. Asking AVFoundation
/// for this rate makes *it* do the resample inside the decoder, so a buffer
/// that reaches here is already six times smaller than the file's own rate
/// would make it. 8 kHz is also the floor Core Audio's converter accepts
/// without complaint; lower is refused rather than clamped.
const DECODE_RATE: f64 = 8_000.0;

/// Decoder chunk, in frames. Half a second: large enough that the loop is not
/// dominated by the call into AVFoundation, small enough to be nothing.
const CHUNK_FRAMES: usize = 4_000;

/// The loudest absolute sample in each 50 ms bucket of `path`, in file order.
///
/// Raw amplitude, 0–1, not normalised: a track is normalised against its own
/// loudest moment where it is drawn, and a merge of several tracks picks the
/// loudest of them at each moment. Both are the editor's to do — see
/// `waveform.ts` — and doing either here would bake a drawing decision into a
/// cached file.
///
/// Both channels together. The timeline draws one shape per clip, and the
/// louder channel at any moment is the one the eye should find.
pub fn peaks(path: &Path) -> Result<Vec<f32>> {
    let mut reader = AudioReader::open_whole(path, DECODE_RATE)?;
    peaks_from(&mut |into| reader.read(into))
}

/// `peaks` over any source of interleaved stereo samples at [`DECODE_RATE`].
///
/// Split from the file so the bucketing can be tested against known numbers
/// without a decoder in the loop.
fn peaks_from(read: &mut dyn FnMut(&mut [f32]) -> usize) -> Result<Vec<f32>> {
    let channels = crate::mixer::CHANNELS;
    // Counted in samples rather than frames: a read is not promised to end on
    // a frame boundary, and a frame split across two reads must not shift
    // every bucket after it by one channel.
    let samples_per_bucket = (DECODE_RATE as usize / BUCKETS_PER_SECOND as usize) * channels;

    let mut out = Vec::new();
    let mut chunk = vec![0.0f32; CHUNK_FRAMES * channels];
    // Samples of the current bucket seen so far, and its loudest. A bucket
    // almost never ends on a chunk boundary, so both carry across reads.
    let mut filled = 0usize;
    let mut loudest = 0.0f32;

    loop {
        let got = read(&mut chunk);
        if got == 0 {
            break;
        }

        for sample in &chunk[..got] {
            let value = sample.abs();
            if value > loudest {
                loudest = value;
            }

            filled += 1;
            if filled == samples_per_bucket {
                out.push(loudest);
                filled = 0;
                loudest = 0.0;
            }
        }
    }

    // A last, partial bucket still counts: dropping it draws the end of every
    // recording as silence, and an eighth of a second of a clap is still a
    // clap.
    if filled > 0 {
        out.push(loudest);
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds `samples` through in uneven pieces, the way a decoder does.
    fn chunked(samples: &[f32], piece: usize) -> Vec<f32> {
        let mut at = 0;
        peaks_from(&mut |into| {
            let run = into.len().min(piece).min(samples.len() - at);
            into[..run].copy_from_slice(&samples[at..at + run]);
            at += run;
            run
        })
        .expect("bucketing cannot fail")
    }

    #[test]
    fn one_bucket_per_fifty_milliseconds_plus_the_remainder() {
        // 2.5 buckets of stereo frames.
        let frames = 400 * 2 + 200;
        let samples = vec![0.0f32; frames * 2];
        assert_eq!(chunked(&samples, 1_000).len(), 3);
    }

    #[test]
    fn a_bucket_is_its_loudest_sample_on_either_channel() {
        let mut samples = vec![0.0f32; 400 * 2 * 2];
        samples[10] = 0.25; // first bucket, left
        samples[11] = -0.75; // first bucket, right, louder and negative
        samples[800 + 3] = 0.5; // second bucket
        assert_eq!(chunked(&samples, 1_000), vec![0.75, 0.5]);
    }

    #[test]
    fn chunk_boundaries_do_not_split_a_bucket() {
        let mut samples = vec![0.0f32; 400 * 2 * 3];
        samples[799] = 0.9; // last sample of the first bucket
        samples[800] = 0.1; // first sample of the second
        // Odd pieces, so every bucket straddles a read.
        assert_eq!(chunked(&samples, 7), vec![0.9, 0.1, 0.0]);
        assert_eq!(chunked(&samples, 2_400), vec![0.9, 0.1, 0.0]);
    }

    #[test]
    fn silence_is_an_empty_shape_not_an_empty_list() {
        let samples = vec![0.0f32; 400 * 2 * 4];
        assert_eq!(chunked(&samples, 1_000), vec![0.0; 4]);
        assert!(chunked(&[], 1_000).is_empty());
    }
}
