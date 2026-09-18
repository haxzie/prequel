//! Typing and click sounds, made from nothing but the moments they happened.
//!
//! A screen recording of somebody typing is usually silent, and a room mic
//! makes a laptop keyboard sound like rain on a bin. This crate synthesises the
//! keystrokes instead — procedurally, from a table of numbers per keyboard, so
//! there is no sample library to ship, license or keep in sync between the
//! preview and the export.
//!
//! **The sound plan is computed once, here.** The editor's geometry rule
//! applies to sound for the same reason: `schedule::cues` decides which voice
//! plays when and how loud, `Bank` renders the voices, and both the WebAudio
//! preview and the Rust export mixer only *place* those samples. Two
//! implementations of "which variant does this press get" is how a preview
//! and an export come to differ, and it is only ever noticed after the file is
//! written.
//!
//! What a keystroke is, acoustically, and where the numbers come from: a
//! recorded press shows a small *touch* peak as the finger lands, a larger
//! *hit* peak within tens of milliseconds as the stem bottoms out, and a
//! *release* peak about 100 ms later at roughly half the height as the slider
//! tops out (Zhuang, Zhou & Tygar, "Keyboard Acoustic Emanations Revisited",
//! CCS 2005, fig. 3). Each of those is an impact — a short burst of contact
//! noise ringing a handful of resonances in the keycap, the housing and the
//! case — which is the standard modal model of a struck rigid body. "Thock"
//! is those resonances sitting below 500 Hz with the highs damped; "clack" is
//! hard plastic on plastic above 2 kHz; the metallic ring on a cheap switch is
//! a spring mode at 2–5 kHz that decays slowly and mostly on the way back up.
//! `profile.rs` is those observations as a table.

mod bank;
mod profile;
mod rng;
mod schedule;
mod synth;

pub use bank::{Bank, Flat, VARIANTS};
pub use profile::{ClickProfile, CueKind, KeyProfile, Mode, Profile};
pub use schedule::{Cue, MIN_SAME_KIND_GAP, cues};
pub use synth::{Voice, render_voice};

/// The rate every bank is rendered at.
///
/// The export mixes at 48 kHz (`prequel-render`'s `SAMPLE_RATE`), and WebAudio
/// resamples an `AudioBuffer` whose rate differs from the context's, so one
/// bank at this rate serves both players. The exporter asserts the two agree
/// rather than resampling: a bank at the wrong rate would play every sound
/// pitch-shifted, which is the kind of wrong that sounds deliberate.
pub const SAMPLE_RATE: u32 = 48_000;
