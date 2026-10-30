//! The music bed, mixed into the export.
//!
//! The fourth source in the export's audio, and the only one measured on the
//! *finished video's* clock rather than the recording's. A bed is a thing laid
//! under the whole edit — it starts a few seconds in, it runs for as long as it
//! runs, and it crosses every cut underneath it without noticing — so it is
//! mixed by where the writer has got to rather than by which slice is being
//! drawn.
//!
//! That is also what makes it easy: the audio stream's own position in
//! interleaved samples *is* project time, so no mapping is needed at all.
//!
//! **A hand-kept mirror of `apps/desktop/src/shared/music.ts`.** The preview
//! places these files with a WebAudio gain node and this multiplies the same
//! numbers into the same samples; the two have to agree, or somebody's music
//! fades differently in the file from the way it did on screen — and that is
//! only ever noticed after the video is written. `gain_at` and `musicGain` are
//! the same arithmetic with the same clamps, and the test below carries the
//! same numbers as `music.test.ts`. Filters are kept in step the same way, for
//! the same reason.

use std::path::{Path, PathBuf};

use prequel_session::MediaTime;

use crate::library::resolve_asset;
use crate::mixer::{self, CHANNELS, Gain};
use crate::reader::AudioReader;

const NS_PER_SECOND: f64 = 1_000_000_000.0;

/**
How far a reader is asked to read, where the end is not known.

A day. `AudioReader::open` turns a range into a `CMTime` built from an `i64`,
and `u64::MAX` overflows it into a negative duration the reader accepts and
then reads nothing from — the trap `open_whole` exists for. AVFoundation clamps
this to the asset's own end, so a day is simply "to the last sample".
*/
const TO_THE_END: MediaTime = 24 * 60 * 60 * 1_000_000_000;

/// One bed on the music row, in project time throughout.
#[derive(Debug, Clone, PartialEq)]
pub struct MusicBed {
    /// Relative to the session directory, as a slice's media is.
    pub file: PathBuf,
    /// Project time it begins at. Included.
    pub start: MediaTime,
    /// Project time it ends at. Not included.
    pub end: MediaTime,
    /// Nanoseconds into the file that `start` plays.
    pub offset: MediaTime,
    pub volume: f32,
    pub fade_in: MediaTime,
    pub fade_out: MediaTime,
    /// Whether the file starts again when it runs out.
    pub repeat: bool,
}

/// What a bed at its own full level is worth in the mix.
///
/// The mirror of `MUSIC_TRIM` in `shared/music.ts`, which carries the
/// reasoning: a mastered song mixed in at unity buries speech recorded off a
/// laptop, because the two are twenty-odd dB apart before either is touched.
/// The two constants must hold the same number or the preview and the file
/// disagree about how loud the song is.
const MUSIC_TRIM: f32 = 0.25;

impl MusicBed {
    /// How loud the bed is at project time `at` — the level, shaped by its
    /// fades. Zero outside the bed, so any moment may be asked about.
    ///
    /// The mirror of `musicGain`. Both fades are held to half the bed each:
    /// at a bed shorter than its two fades the ramps would otherwise cross and
    /// it would be louder in the middle than its own level.
    pub fn gain_at(&self, at: MediaTime) -> f32 {
        if self.volume <= 0.0 || at < self.start || at >= self.end {
            return 0.0;
        }

        let length = self.end.saturating_sub(self.start) as f64;
        if length <= 0.0 {
            return 0.0;
        }

        let into = (at - self.start) as f64;
        let left = length - into;
        let half = length / 2.0;

        let up = (self.fade_in as f64).min(half);
        let down = (self.fade_out as f64).min(half);

        // Linear, on both ends. An equal-power curve would sound better and
        // would be a second thing to keep in step with the TypeScript for a
        // difference nobody has asked about.
        let rising = if up > 0.0 { (into / up).min(1.0) } else { 1.0 };
        let falling = if down > 0.0 { (left / down).min(1.0) } else { 1.0 };

        MUSIC_TRIM * self.volume * rising.min(falling) as f32
    }
}

/// The music row, ready to mix.
///
/// Holds one reader at a time, because beds never overlap — the editor's row
/// is one lane and `sanitiseProject` drops anything that collides. Two beds at
/// once is two songs at once, which no control in the editor could put right.
pub(crate) struct MusicTrack {
    /// Sorted by `start`, with anything empty or silent already dropped.
    beds: Vec<MusicBed>,
    sample_rate: f64,
    /// The bed being mixed.
    slot: usize,
    reader: Option<AudioReader>,
    /// Where the open reader was asked to begin, in project time.
    ///
    /// Held so a chunk boundary inside a bed does not reopen the file: the
    /// reader is already exactly where the next chunk starts, and seeking to
    /// prove it would flush the decoder every quarter of a second.
    at: MediaTime,
}

impl MusicTrack {
    /// Prepares the row, or `None` where there is nothing to mix.
    ///
    /// A bed whose file is not on disk is dropped here rather than opened and
    /// failed per chunk: a file that was moved or never downloaded mixes as
    /// silence, which is a quiet export rather than a failed one — the same
    /// answer `open_slot` gives a missing track.
    pub fn prepare(
        beds: &[MusicBed],
        dir: &Path,
        library: Option<&Path>,
        sample_rate: f64,
    ) -> Option<Self> {
        let mut usable: Vec<MusicBed> = beds
            .iter()
            .filter(|bed| bed.end > bed.start && bed.volume > 0.0)
            .filter(|bed| {
                // Under whichever root owns it: a track of ours lives in the
                // library and an imported one in the recording — see
                // [`crate::library`].
                let path = resolve_asset(dir, library, &bed.file);
                if path.exists() {
                    return true;
                }
                tracing::warn!("music: {} is not there", path.display());
                false
            })
            .map(|bed| MusicBed {
                // The same resolution the check above ran, not a fresh join:
                // this is the path the reader opens, and a bed that passed the
                // check on the shelf and was then handed `<recording>/@library/
                // music/…` is a track that exists, is accepted, and plays
                // nothing — a silent export with the bar still on the
                // timeline. That is exactly what shipped.
                file: resolve_asset(dir, library, &bed.file),
                ..bed.clone()
            })
            .collect();

        if usable.is_empty() {
            return None;
        }

        usable.sort_by_key(|bed| bed.start);

        Some(Self {
            beds: usable,
            sample_rate,
            slot: 0,
            reader: None,
            at: 0,
        })
    }

    /// Mixes whatever of the row falls inside this chunk.
    ///
    /// `from` is the output frame the chunk begins at, which is project time:
    /// the audio stream has written exactly that many frames of the finished
    /// video. `chunk` is interleaved and as long as the frames it holds.
    ///
    /// `scratch` is the caller's, so a long export allocates once rather than
    /// per chunk — the same bargain the slice readers are given.
    pub fn fill(&mut self, from: usize, chunk: &mut [f32], scratch: &mut Vec<f32>) {
        let frames = chunk.len() / CHANNELS;
        let mut done = 0;

        while done < frames {
            let at = self.time_of(from + done);

            // Past the end of the bed being mixed, and perhaps of several: a
            // chunk is a quarter of a second and a bed can be shorter.
            while self.slot < self.beds.len() && at >= self.beds[self.slot].end {
                self.slot += 1;
                self.reader = None;
            }

            // Copied out rather than borrowed. The body below replaces
            // `self.reader`, and a reference into `self.beds` held across that
            // is a borrow the compiler refuses — correctly, since `prepare`
            // is free to reorder the list.
            let Some(&MusicBed {
                start,
                end,
                offset,
                repeat,
                ..
            }) = self.beds.get(self.slot)
            else {
                return;
            };

            // Silence until it begins. Skipped rather than written: the chunk
            // arrives holding whatever the tracks mixed into it, and zeroing it
            // here would erase them.
            if at < start {
                done += self.frames_until(from + done, start);
                continue;
            }

            // Where in the file this moment is. Only opened when the reader is
            // not already there — see `at`.
            if self.reader.is_none() || self.at != at {
                let path = self.beds[self.slot].file.clone();
                self.reader = open(&path, offset + (at - start), self.sample_rate);
                self.at = at;
            }

            let run = self.frames_until(from + done, end).min(frames - done);

            scratch.clear();
            scratch.resize(run * CHANNELS, 0.0);
            let Some(reader) = self.reader.as_mut() else {
                // Would not open. Treated as a bed that has run out, so the
                // loop moves on rather than retrying the same file every
                // quarter of a second for the length of the export.
                done += run;
                self.at = self.time_of(from + done);
                continue;
            };
            let got = reader.read(scratch);

            // The file ran out inside the bed. With `repeat` it starts again
            // from its own beginning — not from the offset, which is where the
            // *trim* begins and would make every pass after the first start
            // somewhere the first one never did. Without it, the rest of the
            // bed is silence rather than the last sample held.
            if got < scratch.len() {
                if repeat {
                    let path = self.beds[self.slot].file.clone();
                    self.reader = open(&path, 0, self.sample_rate);
                    if let Some(reader) = self.reader.as_mut() {
                        reader.read(&mut scratch[got..]);
                    }
                } else {
                    scratch.truncate(got);
                }
            }

            // Per frame, because the envelope moves inside the chunk. Both
            // channels of a frame share a gain: a fade is a change in level,
            // not in balance.
            let bed = &self.beds[self.slot];
            for (index, frame) in scratch.chunks(CHANNELS).enumerate() {
                let gain = bed.gain_at(self.time_of(from + done + index));
                let into = (done + index) * CHANNELS;
                mixer::mix_into(&mut chunk[into..into + frame.len()], frame, Gain(gain));
            }

            done += run;
            self.at = self.time_of(from + done);
        }
    }

    /// Project time of one output frame.
    fn time_of(&self, frame: usize) -> MediaTime {
        (frame as f64 / self.sample_rate * NS_PER_SECOND) as MediaTime
    }

    /// How many frames from `frame` until project time `until`, at least one.
    ///
    /// At least one so the caller always advances: a bed whose end rounds onto
    /// the frame being asked about would otherwise return zero and spin.
    fn frames_until(&self, frame: usize, until: MediaTime) -> usize {
        let at = self.time_of(frame);
        if until <= at {
            return 1;
        }
        let seconds = (until - at) as f64 / NS_PER_SECOND;
        ((seconds * self.sample_rate).ceil() as usize).max(1)
    }
}

/// Opens one bed's file from `into`, or `None` with a warning.
fn open(path: &Path, into: MediaTime, sample_rate: f64) -> Option<AudioReader> {
    match AudioReader::open(path, into, into.saturating_add(TO_THE_END), sample_rate) {
        Ok(reader) => Some(reader),
        Err(err) => {
            tracing::warn!("music: could not read {}: {err}", path.display());
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: MediaTime = 1_000_000_000;

    fn bed() -> MusicBed {
        MusicBed {
            file: PathBuf::from("music-test.m4a"),
            start: 2 * S,
            end: 12 * S,
            offset: 0,
            volume: 1.0,
            fade_in: 2 * S,
            fade_out: 2 * S,
            repeat: false,
        }
    }

    #[test]
    fn opens_a_library_track_on_the_shelf_rather_than_in_the_recording() {
        // The bug this is here for shipped: `prepare` checked the file on the
        // shelf, accepted the bed, and then handed the reader
        // `<recording>/@library/music/…`. The bed was in the mix, the bar was
        // on the timeline, and the export came out silent.
        let root = std::env::temp_dir().join("prequel-music-library-test");
        let shelf = root.join("library").join("music");
        std::fs::create_dir_all(&shelf).expect("shelf");
        std::fs::write(shelf.join("slow-wander.m4a"), b"not really audio").expect("track");

        let session = root.join("recording");
        std::fs::create_dir_all(&session).expect("recording");

        let shelved = MusicBed {
            file: PathBuf::from("@library/music/slow-wander.m4a"),
            ..bed()
        };
        let track = MusicTrack::prepare(
            std::slice::from_ref(&shelved),
            &session,
            Some(&root.join("library")),
            48_000.0,
        )
        .expect("the bed is on the shelf, so it is usable");

        assert_eq!(track.beds[0].file, shelf.join("slow-wander.m4a"));

        // And a recording's own file still resolves against the recording.
        let imported = MusicTrack::prepare(&[bed()], &session, Some(&root.join("library")), 48_000.0);
        assert!(imported.is_none(), "the recording does not hold that one");

        std::fs::write(session.join("music-test.m4a"), b"not really audio").expect("import");
        let imported = MusicTrack::prepare(&[bed()], &session, Some(&root.join("library")), 48_000.0)
            .expect("now it does");
        assert_eq!(imported.beds[0].file, session.join("music-test.m4a"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn is_silent_outside_itself() {
        let bed = bed();
        assert_eq!(bed.gain_at(0), 0.0);
        assert_eq!(bed.gain_at(2 * S - 1), 0.0);
        // Half-open, like every other span in this crate: the end is not in it.
        assert_eq!(bed.gain_at(12 * S), 0.0);
    }

    #[test]
    fn rises_over_the_fade_in() {
        let bed = bed();
        // Against the trim rather than against one: a bed at its own full
        // level is `MUSIC_TRIM` in the mix. The same numbers as the
        // TypeScript's, which is what keeps the preview and the file agreeing.
        assert_eq!(bed.gain_at(2 * S), 0.0);
        assert!((bed.gain_at(3 * S) - MUSIC_TRIM / 2.0).abs() < 1e-6);
        assert!((bed.gain_at(4 * S) - MUSIC_TRIM).abs() < 1e-6);
    }

    #[test]
    fn falls_over_the_fade_out() {
        let bed = bed();
        assert!((bed.gain_at(11 * S) - MUSIC_TRIM / 2.0).abs() < 1e-6);
        assert!((bed.gain_at(10 * S) - MUSIC_TRIM).abs() < 1e-6);
    }

    #[test]
    fn holds_the_level_in_the_middle() {
        let bed = bed();
        assert!((bed.gain_at(7 * S) - MUSIC_TRIM).abs() < 1e-6);
    }

    #[test]
    fn carries_the_volume_through() {
        let bed = MusicBed {
            volume: 0.5,
            ..bed()
        };
        assert!((bed.gain_at(7 * S) - MUSIC_TRIM * 0.5).abs() < 1e-6);
        assert!((bed.gain_at(3 * S) - MUSIC_TRIM * 0.25).abs() < 1e-6);
    }

    #[test]
    fn never_exceeds_its_level_on_a_bed_shorter_than_its_fades() {
        // The case the clamp to half exists for. Two four-second fades on a
        // two-second bed: without it the two ramps cross and the middle of the
        // bed is twice as loud as the bed is.
        let bed = MusicBed {
            start: 0,
            end: 2 * S,
            fade_in: 4 * S,
            fade_out: 4 * S,
            ..bed()
        };

        for step in 0..=20 {
            let at = step * 2 * S / 20;
            assert!(
                bed.gain_at(at) <= MUSIC_TRIM + 1e-6,
                "{at} was louder than the bed"
            );
        }
        // And it still reaches its level exactly once, in the middle.
        assert!((bed.gain_at(S) - MUSIC_TRIM).abs() < 1e-6);
    }
}
