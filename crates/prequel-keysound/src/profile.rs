//! What each keyboard sounds like, as a table.
//!
//! A profile is numbers, not code: a new keyboard is a new row, and the synth
//! never asks which one it has. Every figure here is a starting point taken
//! from how the community measures switches (see the crate doc) and then tuned
//! by ear; the tests in `synth.rs` pin the orderings that must survive tuning —
//! thock darker than linear, linear darker than clicky, a space bar deeper than
//! a letter — rather than the numbers themselves.

use prequel_session::KeyClass;

/// Which voice a cue plays. The five key classes, and a mouse click.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CueKind {
    Letter,
    Space,
    Enter,
    Backspace,
    Modifier,
    Click,
}

impl CueKind {
    /// In index order: what crosses the napi boundary as a `u8`, and how a
    /// bank lays its voices out. The order is part of the contract with the
    /// renderer; `Click` last so the keyboard kinds are a prefix.
    pub const ALL: [CueKind; 6] = [
        CueKind::Letter,
        CueKind::Space,
        CueKind::Enter,
        CueKind::Backspace,
        CueKind::Modifier,
        CueKind::Click,
    ];

    pub const KEYS: [CueKind; 5] = [
        CueKind::Letter,
        CueKind::Space,
        CueKind::Enter,
        CueKind::Backspace,
        CueKind::Modifier,
    ];

    pub fn index(self) -> u8 {
        self as u8
    }

    pub fn from_index(index: u8) -> Option<Self> {
        Self::ALL.get(usize::from(index)).copied()
    }

    /// A key on stabilisers — a wider cap on a wire, which sounds bigger and
    /// rattles once more after the hit.
    pub fn is_long_key(self) -> bool {
        matches!(self, CueKind::Space | CueKind::Enter | CueKind::Backspace)
    }
}

impl From<KeyClass> for CueKind {
    fn from(class: KeyClass) -> Self {
        match class {
            KeyClass::Letter => CueKind::Letter,
            KeyClass::Space => CueKind::Space,
            KeyClass::Enter => CueKind::Enter,
            KeyClass::Backspace => CueKind::Backspace,
            KeyClass::Modifier => CueKind::Modifier,
        }
    }
}

/// One resonance of the struck object: a damped sinusoid.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mode {
    pub hz: f32,
    /// Where `hz` has arrived by the end of the mode's T60. Equal to `hz` for
    /// everything struck, which is nearly everything: a rigid body cannot
    /// change pitch while it rings, and a table that let one would be
    /// describing something other than an impact. Set it apart from `hz` and
    /// the mode stops being a resonance and becomes a played tone — see
    /// `synth::strike`, which renders the two differently.
    pub to_hz: f32,
    /// Time to fall 60 dB, in milliseconds — the acoustician's decay figure.
    pub t60_ms: f32,
    /// Relative level, linear. For a struck mode this is scaled by how hard
    /// the contact drives that frequency; for a glided one it is the tone's
    /// own amplitude, because nothing is driving it.
    pub gain: f32,
}

const fn mode(hz: f32, t60_ms: f32, gain: f32) -> Mode {
    Mode {
        hz,
        to_hz: hz,
        t60_ms,
        gain,
    }
}

/// A tone that bends from `hz` to `to_hz` as it fades.
///
/// Only two things here need it, and neither is a body being hit: a bubble
/// rises as it collapses (Minnaert), and a duck's quack falls as the bird runs
/// out of breath. Modelling either as a struck resonance gets a bell.
const fn glide(hz: f32, to_hz: f32, t60_ms: f32, gain: f32) -> Mode {
    Mode {
        hz,
        to_hz,
        t60_ms,
        gain,
    }
}

/// Whether the profile is a keyboard or a mouse — which sub-events a press has.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mechanism {
    /// Touch, bottom-out, release; a stabiliser tick on long keys.
    Keyboard,
    /// Press and release, nothing else. A microswitch has no travel to speak of.
    Mouse,
    /// One strike and nothing else: glass has no travel and no release, and a
    /// phone plays one sound per key. No stabiliser tick on long keys either;
    /// a long key is only a slightly lower strike.
    Tap,
}

/// A held tone's end: it sustains until `hold_ms` past the press, then dies
/// with time constant `release_ms`. What a sample-based sound has and a
/// struck body does not — the phone's Delete is a note, not a knock.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Gate {
    pub hold_ms: f32,
    pub release_ms: f32,
}

/// A different sound for one class of key.
///
/// Where a mechanical board's long keys are the same switch under a bigger
/// cap — `long_key_ratio` — a phone plays a *different file* for Delete and
/// for the modifiers. An override replaces the body wholesale for its kind;
/// nothing is scaled.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClassSound {
    pub kind: CueKind,
    pub modes: &'static [Mode],
    pub gate: Option<Gate>,
    /// Level against the letter, in dB, after the scheduler has had its say.
    ///
    /// The plan gives a long key +2.5 dB and a modifier −4 dB, which is right
    /// for a board and is decided before the keyboard is known. A phone's
    /// three files peak alike, so its overrides undo that here.
    pub trim_db: f32,
}

/// The table for one keyboard or mouse.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Profile {
    pub mechanism: Mechanism,
    /// How long the contact noise lasts, in milliseconds. A harder contact is
    /// a shorter burst and a brighter sound; this is the "manner of contact"
    /// knob in the impact literature.
    pub excite_tau_ms: f32,
    /// Where the contact noise rolls off. Foam, thick caps and lube all act as
    /// a lowpass on the impact, which is most of what "thock" is.
    pub contact_lowpass_hz: f32,
    /// The body — case, keycap, housing, plate.
    pub modes: &'static [Mode],
    /// A spring or leaf ringing after the release, or none where the switch
    /// is lubed. High-Q, quiet, and the thing that makes a stock switch sound
    /// cheap.
    pub ping: Option<Mode>,
    /// The click jacket or bar of a clicky switch: a separate, very short,
    /// bright impact at the moment of actuation, on the way down only (the
    /// MX Blue mechanism; a box-bar switch would click both ways).
    pub jacket: Option<&'static [Mode]>,
    /// The finger landing on the cap, relative to the hit. Soft and quiet.
    pub touch_db: f32,
    /// The slider topping out, relative to the hit.
    pub release_db: f32,
    /// How long after the hit the release lands, in milliseconds. Drawn per
    /// variant — twelve variants are twelve hold times.
    pub release_delay_ms: (f32, f32),
    /// How much lower a long key's body rings than a letter's.
    pub long_key_ratio: f32,
    /// Classes that are a different sound altogether. Empty for a board where
    /// every key is the same switch.
    pub overrides: &'static [ClassSound],
}

/// Keyboards the editor offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum KeyProfile {
    Linear,
    Tactile,
    Clicky,
    Thock,
    Phone,
}

impl KeyProfile {
    pub const ALL: [KeyProfile; 5] = [
        KeyProfile::Linear,
        KeyProfile::Tactile,
        KeyProfile::Clicky,
        KeyProfile::Thock,
        KeyProfile::Phone,
    ];

    /// The id a project stores and the napi boundary carries.
    pub fn id(self) -> &'static str {
        match self {
            KeyProfile::Linear => "linear",
            KeyProfile::Tactile => "tactile",
            KeyProfile::Clicky => "clicky",
            KeyProfile::Thock => "thock",
            KeyProfile::Phone => "phone",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|profile| profile.id() == id)
    }

    pub fn table(self) -> &'static Profile {
        match self {
            KeyProfile::Linear => &LINEAR,
            KeyProfile::Tactile => &TACTILE,
            KeyProfile::Clicky => &CLICKY,
            KeyProfile::Thock => &THOCK,
            KeyProfile::Phone => &PHONE,
        }
    }
}

/// Click sounds the editor offers.
///
/// Ten, and the spread matters more than the count: a click is heard a couple
/// of hundred times in a three-minute recording, under a voice, and a viewer
/// cannot turn it down separately from the narration. So most of these sit low
/// or sit brief — energy between 1 and 4 kHz is where consonants live and is
/// the expensive place to put a sound that repeats. `Hush` through `Walnut`
/// are the ones to leave on while talking; `Tink` and `Pebble` are short
/// enough not to matter; `Pop` and `Quack` are not for a serious recording and
/// are not pretending to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClickProfile {
    Soft,
    Mechanical,
    Hush,
    Walnut,
    Beige,
    Tok,
    Pebble,
    Tink,
    Pop,
    Quack,
}

impl ClickProfile {
    pub const ALL: [ClickProfile; 10] = [
        ClickProfile::Soft,
        ClickProfile::Mechanical,
        ClickProfile::Hush,
        ClickProfile::Walnut,
        ClickProfile::Beige,
        ClickProfile::Tok,
        ClickProfile::Pebble,
        ClickProfile::Tink,
        ClickProfile::Pop,
        ClickProfile::Quack,
    ];

    pub fn id(self) -> &'static str {
        match self {
            ClickProfile::Soft => "soft",
            ClickProfile::Mechanical => "mechanical",
            ClickProfile::Hush => "hush",
            ClickProfile::Walnut => "walnut",
            ClickProfile::Beige => "beige",
            ClickProfile::Tok => "tok",
            ClickProfile::Pebble => "pebble",
            ClickProfile::Tink => "tink",
            ClickProfile::Pop => "pop",
            ClickProfile::Quack => "quack",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|profile| profile.id() == id)
    }

    pub fn table(self) -> &'static Profile {
        match self {
            ClickProfile::Soft => &CLICK_SOFT,
            ClickProfile::Mechanical => &CLICK_MECHANICAL,
            ClickProfile::Hush => &CLICK_HUSH,
            ClickProfile::Walnut => &CLICK_WALNUT,
            ClickProfile::Beige => &CLICK_BEIGE,
            ClickProfile::Tok => &CLICK_TOK,
            ClickProfile::Pebble => &CLICK_PEBBLE,
            ClickProfile::Tink => &CLICK_TINK,
            ClickProfile::Pop => &CLICK_POP,
            ClickProfile::Quack => &CLICK_QUACK,
        }
    }
}

/// A stock linear — MX Red, Gateron Yellow — in a plastic case. Mid-bright
/// plastic, and a faint spring ping on the way back up.
static LINEAR: Profile = Profile {
    mechanism: Mechanism::Keyboard,
    excite_tau_ms: 1.2,
    contact_lowpass_hz: 8_000.0,
    modes: &[
        mode(320.0, 35.0, 0.5),
        mode(900.0, 20.0, 0.6),
        mode(2_600.0, 10.0, 1.0),
        mode(4_200.0, 6.0, 0.7),
    ],
    ping: Some(mode(3_600.0, 120.0, 0.08)),
    jacket: None,
    touch_db: -18.0,
    release_db: -8.0,
    release_delay_ms: (60.0, 140.0),
    long_key_ratio: 0.75,
    overrides: &[],
};

/// A tactile — MX Brown, Holy Panda. The bump slows the stem before it lands,
/// so the hit is a little duller and the body a little fuller.
static TACTILE: Profile = Profile {
    mechanism: Mechanism::Keyboard,
    excite_tau_ms: 1.6,
    contact_lowpass_hz: 6_500.0,
    modes: &[
        mode(300.0, 40.0, 0.6),
        mode(750.0, 25.0, 0.8),
        mode(2_200.0, 9.0, 0.8),
        mode(3_800.0, 5.0, 0.5),
    ],
    ping: Some(mode(3_400.0, 90.0, 0.05)),
    jacket: None,
    touch_db: -18.0,
    release_db: -8.0,
    release_delay_ms: (60.0, 140.0),
    long_key_ratio: 0.75,
    overrides: &[],
};

/// A clicky — MX Blue. The click jacket collapsing is its own impact, bright
/// and very short, on top of an ordinary plastic bottom-out.
static CLICKY: Profile = Profile {
    mechanism: Mechanism::Keyboard,
    excite_tau_ms: 1.0,
    contact_lowpass_hz: 9_000.0,
    modes: &[
        mode(340.0, 30.0, 0.4),
        mode(1_000.0, 15.0, 0.6),
        mode(3_000.0, 8.0, 1.0),
        mode(5_000.0, 5.0, 0.9),
    ],
    ping: Some(mode(4_200.0, 110.0, 0.1)),
    jacket: Some(&[
        mode(3_600.0, 4.0, 0.8),
        mode(5_400.0, 3.0, 1.0),
        mode(7_200.0, 2.0, 0.6),
    ]),
    touch_db: -18.0,
    release_db: -8.0,
    release_delay_ms: (60.0, 140.0),
    long_key_ratio: 0.75,
    overrides: &[],
};

/// Lubed linears in a foam-filled aluminium case under thick PBT. Everything
/// above 3 kHz is gone, the case rings low and long, and there is no spring
/// to ping.
static THOCK: Profile = Profile {
    mechanism: Mechanism::Keyboard,
    excite_tau_ms: 2.5,
    contact_lowpass_hz: 3_200.0,
    modes: &[
        mode(210.0, 70.0, 1.0),
        mode(420.0, 45.0, 0.9),
        mode(800.0, 20.0, 0.5),
        mode(1_900.0, 6.0, 0.25),
    ],
    ping: None,
    jacket: None,
    touch_db: -20.0,
    release_db: -9.0,
    release_delay_ms: (60.0, 140.0),
    long_key_ratio: 0.75,
    overrides: &[],
};

/// The iPhone's keyboard, iOS 10 onwards — three sounds, measured from the
/// system's own files (`keyboard_press_normal`, `_delete`, `_clear`).
///
/// A letter is a 4 ms tick at 350 Hz with a partial at 1 kHz, then, fifteen
/// decibels quieter, a 340 Hz ring that fades over 150 ms: nothing above
/// 1.5 kHz, 95 % of the energy below 500 Hz. Delete is a 440 Hz tone — A4 —
/// with a brighter 5 ms attack, held 80 ms and released with a 4 ms time
/// constant. The "clear" sound, which UIKit plays for its modifier keys —
/// shift, 123, and Return — is the same tone with a 1.32 kHz partial 13 dB
/// under it, held 85 ms. The space bar is a letter: it plays the normal
/// sound, which is easy to hear on the phone and was got wrong here once.
/// (The clear file also
/// carries two quieter lead-in steps up to 190 ms before its loud part; they
/// are left out, since a sound that lands 190 ms after the key would read as
/// late.) None of these is the 2–3 kHz "Tock" of iOS 6 and earlier, which is
/// what most recordings labelled "iPhone click" on the internet are.
///
/// The low, soft character is the point: this is what people mean when they
/// call a phone's keyboard "bubbly".
static PHONE: Profile = Profile {
    mechanism: Mechanism::Tap,
    excite_tau_ms: 1.0,
    contact_lowpass_hz: 2_500.0,
    modes: &NORMAL,
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: 0.0,
    release_delay_ms: (0.0, 0.0),
    long_key_ratio: 1.0,
    overrides: &[
        ClassSound {
            kind: CueKind::Backspace,
            modes: &[mode(450.0, 10.0, 1.6), mode(440.0, 3_000.0, 0.63)],
            gate: Some(Gate {
                hold_ms: 80.0,
                release_ms: 4.0,
            }),
            trim_db: -2.5,
        },
        // The space bar. On the phone it plays the letter's file; here it is
        // the letter dropped to seven tenths of its pitch with more of the
        // low ring, because a space bar that sounds like a letter reads as a
        // letter, and the bar's own weight is the one thing a listener misses
        // from the real board. The scheduler's long-key boost is left in.
        ClassSound {
            kind: CueKind::Space,
            modes: &SPACE,
            gate: None,
            trim_db: 0.0,
        },
        ClassSound {
            kind: CueKind::Enter,
            modes: &CLEAR,
            gate: Some(CLEAR_GATE),
            trim_db: -2.5,
        },
        ClassSound {
            kind: CueKind::Modifier,
            modes: &CLEAR,
            gate: Some(CLEAR_GATE),
            trim_db: 4.0,
        },
    ],
};

/// The phone's space bar: the letter, lower and heavier.
static SPACE: [Mode; 4] = [
    mode(245.0, 18.0, 1.0),
    mode(700.0, 10.0, 1.4),
    mode(238.0, 190.0, 0.5),
    mode(690.0, 120.0, 0.15),
];

/// The phone's letter.
static NORMAL: [Mode; 4] = [
    mode(350.0, 16.0, 1.0),
    mode(1_000.0, 10.0, 2.2),
    mode(340.0, 170.0, 0.32),
    mode(980.0, 120.0, 0.2),
];

/// The phone's "clear" sound: the Delete tone with a partial, held a little
/// longer. The partial's gain looks large against the tone's because the
/// contact pulse hands a 1.3 kHz mode a tenth of what it hands 440 Hz.
static CLEAR: [Mode; 3] = [
    mode(460.0, 8.0, 1.6),
    mode(440.0, 3_000.0, 0.56),
    mode(1_320.0, 150.0, 5.0),
];
const CLEAR_GATE: Gate = Gate {
    hold_ms: 85.0,
    release_ms: 4.0,
};

/// A crisp microswitch under a hard shell.
static CLICK_MECHANICAL: Profile = Profile {
    mechanism: Mechanism::Mouse,
    excite_tau_ms: 0.6,
    contact_lowpass_hz: 10_000.0,
    modes: &[
        mode(1_800.0, 6.0, 0.7),
        mode(3_200.0, 5.0, 1.0),
        mode(4_800.0, 3.0, 0.6),
    ],
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: -4.0,
    release_delay_ms: (70.0, 90.0),
    long_key_ratio: 1.0,
    overrides: &[],
};

/// A dull tap — a silent-switch mouse, or a trackpad.
static CLICK_SOFT: Profile = Profile {
    mechanism: Mechanism::Mouse,
    excite_tau_ms: 1.4,
    contact_lowpass_hz: 5_000.0,
    modes: &[mode(900.0, 10.0, 0.8), mode(2_000.0, 6.0, 0.6)],
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: -4.0,
    release_delay_ms: (70.0, 90.0),
    long_key_ratio: 1.0,
    overrides: &[],
};

/// `CLICK_SOFT` with the lid shut: a silenced switch through a soft shell,
/// almost nothing above 2 kHz. The one to leave on under a voiceover — it
/// reads as a click without competing with a consonant.
static CLICK_HUSH: Profile = Profile {
    mechanism: Mechanism::Mouse,
    excite_tau_ms: 2.2,
    contact_lowpass_hz: 2_200.0,
    modes: &[mode(560.0, 12.0, 1.0), mode(1_250.0, 7.0, 0.45)],
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: -5.0,
    release_delay_ms: (70.0, 90.0),
    long_key_ratio: 1.0,
    overrides: &[],
};

/// A switch in a small hardwood shell. Wood is light and stiff and loses much
/// less per cycle than ABS, so the body rings four times longer than the
/// plastic ones here and does it low — a warm knock rather than a tick.
static CLICK_WALNUT: Profile = Profile {
    mechanism: Mechanism::Mouse,
    excite_tau_ms: 1.9,
    contact_lowpass_hz: 3_000.0,
    modes: &[
        mode(300.0, 45.0, 1.0),
        mode(680.0, 28.0, 0.45),
        mode(1_450.0, 14.0, 0.18),
        mode(2_600.0, 7.0, 0.06),
    ],
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: -4.0,
    release_delay_ms: (70.0, 90.0),
    long_key_ratio: 1.0,
    overrides: &[],
};

/// A beige office mouse, twenty years old. A thin hollow ABS shell over a cheap
/// switch: boxy and mid-forward, with the highs still on it because there is no
/// foam, no lube and no mass anywhere in it.
///
/// The fundamental is deliberately weak. A shell that thin has very little
/// surface to move air with at 800 Hz, and giving it a strong low mode put this
/// within a few per cent of `Soft` on both brightness and length — two names for
/// one sound, which is a longer menu and not a wider choice.
static CLICK_BEIGE: Profile = Profile {
    mechanism: Mechanism::Mouse,
    excite_tau_ms: 1.0,
    contact_lowpass_hz: 7_500.0,
    modes: &[
        mode(820.0, 18.0, 0.35),
        mode(1_750.0, 16.0, 1.0),
        mode(3_250.0, 9.0, 0.8),
        mode(5_400.0, 5.0, 0.35),
    ],
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: -4.0,
    release_delay_ms: (70.0, 90.0),
    long_key_ratio: 1.0,
    overrides: &[],
};

/// A knock on a short closed tube. The second mode is twice the first because
/// that is what a tube does, and a clear octave above the fundamental is what
/// makes this one read as a pitch rather than a noise.
static CLICK_TOK: Profile = Profile {
    mechanism: Mechanism::Mouse,
    excite_tau_ms: 1.3,
    contact_lowpass_hz: 4_200.0,
    modes: &[
        mode(640.0, 30.0, 1.0),
        mode(1_280.0, 16.0, 0.5),
        mode(2_450.0, 8.0, 0.2),
    ],
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: -4.0,
    release_delay_ms: (70.0, 90.0),
    long_key_ratio: 1.0,
    overrides: &[],
};

/// Two small stones. Dense and tiny: high modes that are gone in a few
/// milliseconds, which is how it stays out of the way despite being bright.
static CLICK_PEBBLE: Profile = Profile {
    mechanism: Mechanism::Mouse,
    excite_tau_ms: 0.55,
    contact_lowpass_hz: 10_500.0,
    modes: &[
        mode(3_100.0, 5.0, 0.5),
        mode(5_000.0, 2.5, 1.0),
        mode(7_600.0, 1.5, 0.4),
    ],
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: -4.0,
    release_delay_ms: (70.0, 90.0),
    long_key_ratio: 1.0,
    overrides: &[],
};

/// A pin on a steel plate. One high-Q mode doing almost all of it — steel at a
/// T60 of 55 ms against plastic's 10 — over a tiny body thud for the contact
/// itself. The brightest of the ten.
///
/// Steel would happily ring three times this long, and at 5 kHz it was held
/// against a voice for 190 ms, which is sibilance territory and the one place a
/// repeating sound must not sit. Damped to where it still reads as metal.
static CLICK_TINK: Profile = Profile {
    mechanism: Mechanism::Mouse,
    excite_tau_ms: 0.5,
    contact_lowpass_hz: 11_000.0,
    modes: &[
        mode(1_900.0, 5.0, 0.25),
        mode(5_200.0, 55.0, 1.0),
        mode(7_800.0, 22.0, 0.3),
    ],
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: -4.0,
    release_delay_ms: (70.0, 90.0),
    long_key_ratio: 1.0,
    overrides: &[],
};

/// A bubble surfacing.
///
/// A bubble's frequency *rises* as it collapses — Minnaert's result, pitch
/// going as the inverse of the radius — which is the whole character of the
/// sound and why this is a glide and not a struck mode. `Tap` because a bubble
/// has no release: there is no slider to come back up.
static CLICK_POP: Profile = Profile {
    mechanism: Mechanism::Tap,
    excite_tau_ms: 0.8,
    contact_lowpass_hz: 4_000.0,
    modes: &[
        glide(420.0, 1_250.0, 55.0, 1.0),
        glide(840.0, 2_500.0, 25.0, 0.18),
    ],
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: 0.0,
    release_delay_ms: (0.0, 0.0),
    long_key_ratio: 1.0,
    overrides: &[],
};

/// A duck.
///
/// Not a struck body at all: a quack is voiced, which means a buzzy harmonic
/// stack rather than a handful of unrelated resonances. Ten harmonics of one
/// fundamental, all falling by the same ratio — a mallard hen's quack drops as
/// she runs out of breath, and a stack that held its pitch would read as a car
/// horn.
///
/// **Every partial carries the same T60.** `bend` sweeps each mode over its own
/// T60, so partials given different decay times finish their sweeps at
/// different moments and the stack is only harmonic on the first sample. That
/// matters more than it sounds: harmonics of one fundamental stay phase-locked,
/// which is what makes the sum a pulse train and a pulse train is what "voiced"
/// means. Let them drift and it is ten sliding sines — a kazoo. The earlier
/// table tapered the decays to kill the upper partials first, and by 40 ms it
/// had nothing left above 2 kHz and was a hum sliding downwards.
///
/// So the taper is in the gains instead, a fixed shape peaking on the fourth
/// partial: that 2 kHz emphasis is the nasal formant, and half the energy sits
/// above it for the sound's whole length. That rasp is the duck.
///
/// `contact_lowpass_hz` does nothing here — a gliding mode is not driven by the
/// burst — and is left at a sane figure rather than removed, since `Profile`
/// asks every table for one.
///
/// `Tap`, for the same reason as `Pop`, and because `Tap` drives its modes with
/// a clean pulse rather than noise. `excite_tau_ms` is the attack, and it is
/// long here on purpose: a quack swells over its first 20 ms, where 1 ms would
/// put ten phase-aligned partials at full level on sample zero and add a click
/// in front of the bird.
static CLICK_QUACK: Profile = Profile {
    mechanism: Mechanism::Tap,
    excite_tau_ms: 9.0,
    contact_lowpass_hz: 5_000.0,
    modes: &[
        glide(520.0, 330.0, 220.0, 0.30),
        glide(1_040.0, 660.0, 220.0, 0.55),
        glide(1_560.0, 990.0, 220.0, 0.90),
        glide(2_080.0, 1_320.0, 220.0, 1.00),
        glide(2_600.0, 1_650.0, 220.0, 0.88),
        glide(3_120.0, 1_980.0, 220.0, 0.70),
        glide(3_640.0, 2_310.0, 220.0, 0.52),
        glide(4_160.0, 2_640.0, 220.0, 0.36),
        glide(4_680.0, 2_970.0, 220.0, 0.24),
        glide(5_200.0, 3_300.0, 220.0, 0.15),
    ],
    ping: None,
    jacket: None,
    touch_db: 0.0,
    release_db: 0.0,
    release_delay_ms: (0.0, 0.0),
    long_key_ratio: 1.0,
    overrides: &[],
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_round_trip() {
        for profile in KeyProfile::ALL {
            assert_eq!(KeyProfile::from_id(profile.id()), Some(profile));
        }
        for profile in ClickProfile::ALL {
            assert_eq!(ClickProfile::from_id(profile.id()), Some(profile));
        }
        assert_eq!(KeyProfile::from_id("off"), None);
        assert_eq!(ClickProfile::from_id(""), None);
    }

    /// What makes a quack a quack rather than a horn or a hum: the partials are
    /// harmonics of one fundamental, they all fall by the same ratio so they
    /// stay harmonics, and the loudest of them is not the first.
    #[test]
    fn the_quack_is_a_falling_harmonic_stack() {
        let modes = CLICK_QUACK.modes;
        let (f0, to0) = (modes[0].hz, modes[0].to_hz);
        assert!(to0 < f0, "a quack falls");

        for (index, mode) in modes.iter().enumerate() {
            let harmonic = (index + 1) as f32;
            assert!(
                (mode.hz - f0 * harmonic).abs() < 1.0,
                "partial {harmonic} starts at {} not {}",
                mode.hz,
                f0 * harmonic
            );
            // The same ratio at every partial. Bending them by different
            // amounts would pull the stack inharmonic part way through, which
            // is a sound no bird makes.
            assert!(
                (mode.to_hz - to0 * harmonic).abs() < 1.0,
                "partial {harmonic} lands on {} not {}",
                mode.to_hz,
                to0 * harmonic
            );
            // And one T60 for the lot. `bend` sweeps a mode over its own T60,
            // so a partial with a shorter one arrives early and the stack is
            // harmonic on the first sample and nowhere after it.
            assert!(
                (mode.t60_ms - modes[0].t60_ms).abs() < f32::EPSILON,
                "partial {harmonic} decays over {} ms, not {}",
                mode.t60_ms,
                modes[0].t60_ms
            );
        }

        let loudest = modes
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.gain.total_cmp(&b.1.gain))
            .map(|(index, _)| index)
            .unwrap();
        assert!(loudest > 0, "the nasal formant is not the fundamental");
    }

    /// Everything else is struck, and a struck body holds its pitch. A stray
    /// `to_hz` is the easy mistake here — it turns a resonance into a tone with
    /// nothing in the table to say so.
    #[test]
    fn only_the_bending_sounds_bend() {
        let bending = [ClickProfile::Pop.id(), ClickProfile::Quack.id()];
        let tables = KeyProfile::ALL
            .into_iter()
            .map(|p| (p.id(), p.table()))
            .chain(ClickProfile::ALL.into_iter().map(|p| (p.id(), p.table())));

        for (id, profile) in tables {
            let every_mode = profile
                .modes
                .iter()
                .chain(profile.ping.iter())
                .chain(profile.jacket.unwrap_or(&[]))
                .chain(profile.overrides.iter().flat_map(|sound| sound.modes));
            for mode in every_mode {
                let bends = mode.hz != mode.to_hz;
                assert_eq!(
                    bends,
                    bending.contains(&id),
                    "{id} at {} Hz: bends = {bends}",
                    mode.hz
                );
            }
        }
    }

    #[test]
    fn cue_kinds_index_in_declaration_order() {
        for (index, kind) in CueKind::ALL.into_iter().enumerate() {
            assert_eq!(usize::from(kind.index()), index);
            assert_eq!(CueKind::from_index(index as u8), Some(kind));
        }
        assert_eq!(CueKind::from_index(6), None);
        for class in KeyClass::ALL {
            assert_ne!(CueKind::from(class), CueKind::Click);
        }
    }
}
