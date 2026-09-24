//! Typing and click sounds, placed into the mix.
//!
//! The third source in the export's audio, and the one with no file behind
//! it. `prequel-keysound` decides *what* plays and *when* — a plan of cues and
//! a bank of voices — and this module only lays the voices into the chunk
//! being mixed, the way the WebAudio preview lays the same voices into its
//! graph. Nothing here chooses a variant, a level or a moment; if it did,
//! the preview and the export would be two opinions about the same press.
//!
//! Pure arithmetic over slices of `f32`, so it is tested with an impulse bank
//! and no file at all.

use std::collections::HashMap;
use std::ops::Range;

use prequel_keysound::{Bank, ClickProfile, Cue, CueKind, KeyProfile};
use prequel_session::MediaTime;

use crate::mixer::{CHANNELS, frames_for};
use crate::timeline::SliceRender;

/// The sound plan for a recording: every cue, on the recording's timeline.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SoundPlan {
    pub cues: Vec<Cue>,
}

/// The longest a voice can be, in nanoseconds. Bounds the cues a chunk has
/// to look at: a cue this long before a chunk cannot reach into it.
const VOICE_REACH: MediaTime = 300_000_000;

/// The synthetic source, ready to mix.
pub(crate) struct SoundTrack {
    /// Sorted by `at`.
    cues: Vec<Cue>,
    sample_rate: f64,
    /// Only the banks some slice actually asks for. A bank is a few
    /// milliseconds to render, but a keyboard nobody chose is a keyboard
    /// nobody needs in memory.
    key_banks: HashMap<KeyProfile, Bank>,
    click_banks: HashMap<ClickProfile, Bank>,
}

impl SoundTrack {
    /// Renders the banks the slices need, or `None` when no slice would make
    /// a sound: no cues, or every profile off, or every level at zero.
    pub fn prepare(
        plan: Option<&SoundPlan>,
        slices: &[SliceRender],
        sample_rate: f64,
    ) -> Option<Self> {
        let plan = plan?;
        if plan.cues.is_empty() {
            return None;
        }

        let has_keys = plan.cues.iter().any(|cue| cue.kind != CueKind::Click);
        let has_clicks = plan.cues.iter().any(|cue| cue.kind == CueKind::Click);

        let mut key_banks = HashMap::new();
        let mut click_banks = HashMap::new();
        for slice in slices {
            if has_keys
                && slice.audio.keys > 0.0
                && let Some(profile) = slice.audio.key_profile
            {
                key_banks
                    .entry(profile)
                    .or_insert_with(|| Bank::keys(profile));
            }
            if has_clicks
                && slice.audio.clicks > 0.0
                && let Some(profile) = slice.audio.click_profile
            {
                click_banks
                    .entry(profile)
                    .or_insert_with(|| Bank::clicks(profile));
            }
        }
        if key_banks.is_empty() && click_banks.is_empty() {
            return None;
        }

        // The bank is rendered at one fixed rate and this mixer runs at one
        // fixed rate. They are the same number in two crates, and if they ever
        // stopped being, every sound would play pitch-shifted — which sounds
        // like a design choice rather than a bug. Refused here instead.
        for bank in key_banks.values().chain(click_banks.values()) {
            assert_eq!(
                f64::from(bank.sample_rate()),
                sample_rate,
                "the sound bank and the mixer disagree about the sample rate"
            );
        }

        let mut cues = plan.cues.clone();
        cues.sort_by_key(|cue| cue.at);

        Some(Self {
            cues,
            sample_rate,
            key_banks,
            click_banks,
        })
    }

    /// The cues that belong to a slice: `start <= at < end`.
    ///
    /// A cut is a cut. A press two milliseconds before a slice begins is not
    /// heard in it, even though its voice would have reached in — and a press
    /// inside the slice is heard even if the cut takes its tail off. Judging by
    /// the moment rather than the sound is what the preview does too.
    pub fn range_for(&self, slice: &SliceRender) -> Range<usize> {
        let from = self.cues.partition_point(|cue| cue.at < slice.start);
        let to = self.cues.partition_point(|cue| cue.at < slice.end);
        from..to
    }

    /// Adds the slice's sounds into `into`, for slice frames
    /// `from_frame..from_frame + frames`.
    ///
    /// `into` is interleaved stereo and already holds whatever the tracks
    /// contributed; this sums on top and clips nothing — the caller clips
    /// once, after every source. Consecutive calls over adjacent frame windows
    /// produce the same samples as one call over both, so a voice that
    /// straddles a chunk boundary is continuous across it.
    pub fn fill(
        &self,
        slice: &SliceRender,
        range: Range<usize>,
        from_frame: usize,
        frames: usize,
        into: &mut [f32],
    ) {
        debug_assert!(into.len() >= frames * CHANNELS);
        let cues = &self.cues[range];

        // Only the cues that can reach this window: those from a voice's
        // length before it to a touch lead past it. Without this a slice with
        // thousands of presses walks all of them for every quarter second.
        let window_start = slice.start + self.time_of(from_frame);
        let window_end = slice.start + self.time_of(from_frame + frames);
        let first = cues.partition_point(|cue| cue.at + VOICE_REACH < window_start);
        let last = cues.partition_point(|cue| cue.at < window_end + VOICE_REACH);

        for cue in &cues[first..last] {
            let (bank, level) = match cue.kind {
                CueKind::Click => (
                    slice
                        .audio
                        .click_profile
                        .and_then(|profile| self.click_banks.get(&profile)),
                    slice.audio.clicks,
                ),
                _ => (
                    slice
                        .audio
                        .key_profile
                        .and_then(|profile| self.key_banks.get(&profile)),
                    slice.audio.keys,
                ),
            };
            let Some(bank) = bank else { continue };
            if level <= 0.0 {
                continue;
            }
            let Some(voice) = bank.voice(cue.kind, cue.variant) else {
                continue;
            };

            // Where the voice's onset lands, in slice frames; its first sample
            // is `onset` frames before that, which can be before the slice.
            let onset_frame = frames_for(cue.at - slice.start, self.sample_rate) as i64;
            let voice_start = onset_frame - bank.onset() as i64;
            let voice_end = voice_start + voice.len() as i64;

            let low = voice_start.max(from_frame as i64);
            let high = voice_end.min((from_frame + frames) as i64);
            if high <= low {
                continue;
            }

            // WebAudio's `StereoPannerNode` law for a mono input, not the
            // textbook equal-power one: they differ by up to 0.4 dB off
            // centre, and the preview uses the browser's. Same law, same mix.
            let x = (f64::from(cue.pan) + 1.0) / 2.0 * std::f64::consts::FRAC_PI_2;
            let left = (x.cos() as f32) * cue.gain * level;
            let right = (x.sin() as f32) * cue.gain * level;

            for frame in low..high {
                let sample = voice[(frame - voice_start) as usize];
                let slot = (frame as usize - from_frame) * CHANNELS;
                into[slot] += sample * left;
                into[slot + 1] += sample * right;
            }
        }
    }

    /// Nanoseconds of `frames` at the mixer's rate.
    fn time_of(&self, frames: usize) -> MediaTime {
        (frames as f64 / self.sample_rate * 1_000_000_000.0).round() as MediaTime
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::{RenderPlan, Size};
    use crate::timeline::AudioMix;

    const RATE: f64 = 48_000.0;
    const S: MediaTime = 1_000_000_000;

    fn slice(start: MediaTime, end: MediaTime, audio: AudioMix) -> SliceRender {
        SliceRender {
            start,
            end,
            plan: RenderPlan {
                frame: Size {
                    width: 16.0,
                    height: 9.0,
                },
                items: Vec::new(),
            },
            audio,
            speed: 1.0,
            media: crate::timeline::SliceMedia::default(),
        }
    }

    fn sounds_on() -> AudioMix {
        AudioMix {
            keys: 1.0,
            key_profile: Some(KeyProfile::Linear),
            clicks: 1.0,
            click_profile: Some(ClickProfile::Soft),
            ..AudioMix::tracks(1.0, 1.0)
        }
    }

    fn cue(at: MediaTime, kind: CueKind) -> Cue {
        Cue {
            at,
            kind,
            variant: 0,
            gain: 1.0,
            pan: 0.0,
        }
    }

    fn plan(cues: Vec<Cue>) -> SoundPlan {
        SoundPlan { cues }
    }

    /// Mixes a whole slice in `chunk`-frame steps and returns the left channel.
    fn render(track: &SoundTrack, slice: &SliceRender, chunk: usize) -> Vec<f32> {
        let frames = frames_for(slice.duration(), RATE);
        let range = track.range_for(slice);
        let mut out = vec![0.0f32; frames * CHANNELS];
        let mut from = 0;
        while from < frames {
            let run = chunk.min(frames - from);
            track.fill(
                slice,
                range.clone(),
                from,
                run,
                &mut out[from * CHANNELS..(from + run) * CHANNELS],
            );
            from += run;
        }
        out.iter().step_by(CHANNELS).copied().collect()
    }

    /// The first frame with any energy.
    fn first_sound(left: &[f32]) -> Option<usize> {
        left.iter().position(|s| s.abs() > 1e-6)
    }

    /// Where the voice's onset lands: the sample of the loudest peak in the
    /// bank's voice, relative to its onset, is fixed, so the offset from the
    /// peak in the mix back to the press is knowable.
    fn onset_offset(bank: &Bank, kind: CueKind) -> (usize, usize) {
        let voice = bank.voice(kind, 0).unwrap();
        let peak = voice
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
            .unwrap()
            .0;
        (bank.onset(), peak)
    }

    #[test]
    fn a_press_lands_on_its_moment_in_the_slice() {
        let track = SoundTrack::prepare(
            Some(&plan(vec![cue(S / 2, CueKind::Letter)])),
            &[slice(0, S, sounds_on())],
            RATE,
        )
        .unwrap();
        let bank = &track.key_banks[&KeyProfile::Linear];
        let (onset, peak) = onset_offset(bank, CueKind::Letter);

        let left = render(&track, &slice(0, S, sounds_on()), 12_000);
        let loudest = left
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
            .unwrap()
            .0;
        // The press is at 0.5 s = frame 24 000; the peak sits `peak - onset`
        // frames after the press.
        assert_eq!(loudest, 24_000 + peak - onset);
        // And the touch lead starts before the press, not on it.
        assert!(first_sound(&left).unwrap() < 24_000);
    }

    #[test]
    fn a_slice_that_starts_later_hears_the_press_earlier() {
        let plan = plan(vec![cue(S / 2, CueKind::Letter)]);
        let whole = slice(0, S, sounds_on());
        let later = slice(S / 4, S, sounds_on());
        let track =
            SoundTrack::prepare(Some(&plan), &[whole.clone(), later.clone()], RATE).unwrap();

        let a = render(&track, &whole, 12_000);
        let b = render(&track, &later, 12_000);
        // The same voice, 12 000 frames earlier.
        assert_eq!(
            &a[24_000 - 1_000..24_000 + 5_000],
            &b[12_000 - 1_000..12_000 + 5_000]
        );
    }

    #[test]
    fn a_press_before_the_cut_is_not_heard_after_it() {
        // A press 20 ms before the slice starts: its voice would reach in, but
        // the moment is on the other side of the cut.
        let track = SoundTrack::prepare(
            Some(&plan(vec![cue(S / 2 - 20_000_000, CueKind::Letter)])),
            &[slice(S / 2, S, sounds_on())],
            RATE,
        )
        .unwrap();
        let left = render(&track, &slice(S / 2, S, sounds_on()), 12_000);
        assert_eq!(first_sound(&left), None);
    }

    #[test]
    fn a_voice_is_cut_off_at_the_end_of_its_slice() {
        // A press 2 ms before the end: only 96 frames of it fit.
        let s = slice(0, S, sounds_on());
        let track = SoundTrack::prepare(
            Some(&plan(vec![cue(S - 2_000_000, CueKind::Letter)])),
            std::slice::from_ref(&s),
            RATE,
        )
        .unwrap();
        let left = render(&track, &s, 12_000);
        assert_eq!(left.len(), 48_000);
        assert!(left[47_999].abs() > 0.0 || left[47_990..].iter().any(|v| v.abs() > 0.0));
    }

    #[test]
    fn chunking_does_not_change_the_mix() {
        let s = slice(0, S, sounds_on());
        let cues: Vec<Cue> = (0..20)
            .map(|i| {
                cue(
                    50_000_000 + i * 45_000_000,
                    if i % 4 == 3 {
                        CueKind::Click
                    } else {
                        CueKind::Space
                    },
                )
            })
            .collect();
        let track = SoundTrack::prepare(Some(&plan(cues)), std::slice::from_ref(&s), RATE).unwrap();
        // Awkward chunk sizes on purpose: neither divides a voice or the slice.
        assert_eq!(render(&track, &s, 48_000), render(&track, &s, 1_001));
        assert_eq!(render(&track, &s, 48_000), render(&track, &s, 7));
    }

    #[test]
    fn a_keyboard_switched_off_silences_the_keys_but_not_the_clicks() {
        let mut audio = sounds_on();
        audio.key_profile = None;
        let s = slice(0, S, audio);
        let track = SoundTrack::prepare(
            Some(&plan(vec![
                cue(S / 4, CueKind::Letter),
                cue(S / 2, CueKind::Click),
            ])),
            std::slice::from_ref(&s),
            RATE,
        )
        .unwrap();
        let left = render(&track, &s, 12_000);
        assert!(first_sound(&left).unwrap() >= 24_000 - 1_000);

        // Level zero is off too, whatever the profile says.
        let mut audio = sounds_on();
        audio.clicks = 0.0;
        let s = slice(0, S, audio);
        let track = SoundTrack::prepare(
            Some(&plan(vec![cue(S / 2, CueKind::Click)])),
            std::slice::from_ref(&s),
            RATE,
        );
        assert!(track.is_none());
    }

    #[test]
    fn nothing_to_play_is_no_track_at_all() {
        let quiet = AudioMix::tracks(1.0, 1.0);
        assert!(SoundTrack::prepare(None, &[slice(0, S, sounds_on())], RATE).is_none());
        assert!(
            SoundTrack::prepare(Some(&plan(vec![])), &[slice(0, S, sounds_on())], RATE).is_none()
        );
        assert!(
            SoundTrack::prepare(
                Some(&plan(vec![cue(S / 2, CueKind::Letter)])),
                &[slice(0, S, quiet)],
                RATE
            )
            .is_none()
        );
    }

    #[test]
    fn panning_hard_right_leaves_the_left_channel_empty() {
        let s = slice(0, S, sounds_on());
        let mut hard = cue(S / 2, CueKind::Letter);
        hard.pan = 1.0;
        let track =
            SoundTrack::prepare(Some(&plan(vec![hard])), std::slice::from_ref(&s), RATE).unwrap();
        let frames = 48_000;
        let mut out = vec![0.0f32; frames * CHANNELS];
        track.fill(&s, track.range_for(&s), 0, frames, &mut out);
        let left: f32 = out.iter().step_by(2).map(|v| v.abs()).sum();
        let right: f32 = out.iter().skip(1).step_by(2).map(|v| v.abs()).sum();
        assert!(left < 1e-3, "{left}");
        assert!(right > 1.0);
    }
}
