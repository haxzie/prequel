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
    /// Time to fall 60 dB, in milliseconds — the acoustician's decay figure.
    pub t60_ms: f32,
    /// Relative level, linear.
    pub gain: f32,
}

const fn mode(hz: f32, t60_ms: f32, gain: f32) -> Mode {
    Mode { hz, t60_ms, gain }
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

/// Mice the editor offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClickProfile {
    Soft,
    Mechanical,
}

impl ClickProfile {
    pub const ALL: [ClickProfile; 2] = [ClickProfile::Soft, ClickProfile::Mechanical];

    pub fn id(self) -> &'static str {
        match self {
            ClickProfile::Soft => "soft",
            ClickProfile::Mechanical => "mechanical",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|profile| profile.id() == id)
    }

    pub fn table(self) -> &'static Profile {
        match self {
            ClickProfile::Soft => &CLICK_SOFT,
            ClickProfile::Mechanical => &CLICK_MECHANICAL,
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
/// constant. The "clear" sound, which UIKit plays for its modifier keys and,
/// as best as could be told, for the space bar and Return, is the same tone
/// with a 1.32 kHz partial 20 dB under it, held 85 ms. (The clear file also
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
    modes: &[
        mode(350.0, 16.0, 1.0),
        mode(1_000.0, 10.0, 2.2),
        mode(340.0, 170.0, 0.32),
        mode(980.0, 120.0, 0.2),
    ],
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
        ClassSound {
            kind: CueKind::Space,
            modes: &CLEAR,
            gate: Some(CLEAR_GATE),
            trim_db: -2.5,
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

/// The phone's "clear" sound: the Delete tone with a partial, held a little longer.
static CLEAR: [Mode; 3] = [
    mode(460.0, 8.0, 1.6),
    mode(440.0, 3_000.0, 0.56),
    mode(1_320.0, 60.0, 1.5),
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
