//! Where the pointer was pressed, and when a key was, sampled alongside the
//! video.
//!
//! A click is the strongest signal a screen recording gives about what mattered
//! and when — far stronger than where the pointer merely was, which is mostly
//! travel. It is what the editor's automatic zooms are built from. A key press
//! is what its typing sounds are built from.
//!
//! **What is kept of a key, and what is not.** A press is recorded as a moment
//! and one of five coarse classes — a letter, the space bar, Return, Delete, a
//! modifier — and nothing else. The key code is read off the event only to
//! pick the class and is not stored; the character is never read at all; and
//! key-*up* is not in the tap's mask, because how long a key is held is as
//! personal as a signature and no sound needs it. Presses are kept only while
//! the switch in Settings is on. Typing spans — the coarse record the pointer
//! hides behind — are kept regardless, from the same events.
//!
//! Passwords never arrive. macOS turns on Secure Event Input while a secure
//! text field has focus, and withholds keyboard events from every event tap in
//! the system for the duration — which is also why the sound simply stops
//! there, as a viewer would expect it to.
//!
//! Raw `extern "C"`, matching `cursor.rs` and `typing.rs`: cidre binds none of
//! Quartz's event API, and this needs seven functions.
//!
//! The tap runs its own run loop on its own thread. An event tap is delivered
//! by the window server into a run loop source, so there has to be a run loop
//! for it to be delivered into — and it cannot be the capture callback's, which
//! is ScreenCaptureKit's and is busy sixty times a second.

use std::ffi::c_void;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};

use prequel_encode::host_now;
use prequel_session::MediaTime;
pub use prequel_session::{KeyClass, KeyPress};

use crate::cursor::Region;

/// A press, as a fraction of the captured frame.
///
/// The same units the cursor and typing tracks use, and for the same reason:
/// the display's origin and the crop are known only during capture.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClickSample {
    pub at: MediaTime,
    pub x: f64,
    pub y: f64,
}

/// One press as the tap saw it: host time, and global display points.
#[derive(Debug, Clone, Copy)]
struct RawClick {
    host: u64,
    x: f64,
    y: f64,
}

/// A stretch of the recording somebody was typing through.
///
/// A span rather than the keystrokes it was made of. This is the coarse record
/// — "typing, from about here to about here" — and it is what hiding the
/// pointer needs, so it is built from every key-down whether or not presses
/// are being kept. Coalesced and rounded here, at the point of capture, so a
/// recording made with presses switched off carries nothing finer than this.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KeySpan {
    pub start: MediaTime,
    pub end: MediaTime,
}

/// Both records of the keyboard, drained together. See `key_tracks`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct KeyTracks {
    pub spans: Vec<KeySpan>,
    pub presses: Vec<KeyPress>,
}

/// One key-down as the tap saw it: host time, and which kind of key.
///
/// The class and never the code. `on_event` reads the code, classifies it and
/// drops it in the same expression, so a key code exists for as long as it
/// takes to compare against a dozen constants.
#[derive(Debug, Clone, Copy)]
struct RawKey {
    host: u64,
    class: KeyClass,
}

/// Longest quiet stretch inside one span.
///
/// A second: long enough to hold a sentence together through a pause for
/// thought, short enough that typing and then reaching for the mouse ends it.
const KEY_GAP_NS: MediaTime = 1_000_000_000;

/// What a span's ends are rounded out to.
///
/// A tenth of a second, which is coarse enough that the presses inside cannot
/// be counted back out of it and fine enough to hide a pointer on time.
const KEY_ROUNDING_NS: MediaTime = 100_000_000;

/// Fewest presses that count as typing.
///
/// A shortcut is one key and a fistful of modifiers, which are not keys and do
/// not arrive here. A word is several. Below this nothing is recorded at all,
/// so a recording of somebody hitting Cmd-S carries no trace that they did.
const KEYS_PER_SPAN: usize = 3;

/// Presses since the tap started.
///
/// A process-wide buffer rather than something threaded through the callback's
/// `user_info`: only one recording runs at a time — `RECORDER` in the napi
/// crate is a single slot — and a static sidesteps handing a raw pointer to a
/// callback that outlives the frame it was created in.
static CLICKS: Mutex<Vec<RawClick>> = Mutex::new(Vec::new());

/// Key presses since the tap started: a host time and a class each.
///
/// Every key-down lands here, because the spans need all of them. Whether the
/// presses themselves leave this buffer as anything but spans is `KEEP_PRESSES`.
static KEYS: Mutex<Vec<RawKey>> = Mutex::new(Vec::new());

/// Whether `key_tracks` hands back the presses, or only the spans.
///
/// The switch in Settings. Checked on the way *out* rather than in the
/// callback, so the callback does the same work whatever the setting and
/// timing between the two paths cannot differ.
static KEEP_PRESSES: AtomicBool = AtomicBool::new(true);

/// The tap thread's run loop, so it can be stopped from the outside.
static RUN_LOOP: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

/// The tap itself, so the callback can switch it back on.
///
/// macOS disables a tap that takes too long to answer an event, and delivers a
/// `kCGEventTapDisabledByTimeout` notification instead. Until `CGEventTapEnable`
/// is called again the tap is **dead** — it keeps its run loop source and
/// reports nothing, so there is no error anywhere and every press after that
/// moment is simply missing from the recording.
///
/// The timeout is not generous and the window server counts the whole delivery
/// chain, so a busy machine trips it on an ordinary recording. This is the first
/// thing to suspect when a take comes back with too few clicks in it.
static TAP: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

/// How many times the window server switched the tap off during a recording.
///
/// Reported at the end rather than per event, because the interesting number is
/// whether it happened at all. A take that comes back with one click and a
/// non-zero count here was losing presses; one click and a zero count means one
/// click, and the difference is otherwise unknowable after the fact.
static DISABLES: AtomicU32 = AtomicU32::new(0);

/// Starts listening for presses. Returns false if the tap could not be made.
///
/// `capture_keys` is whether individual key presses are kept — see
/// `KEEP_PRESSES`. Typing spans are kept either way.
///
/// **A successful return does not mean presses will arrive.** `CGEventTapCreate`
/// hands back a working tap to a process that has not been permitted to observe
/// input, and that tap then receives only events aimed at this process — which
/// during a recording is almost none of them. Nothing fails, nothing is logged
/// by the system, and the take comes back with one or two clicks in it.
///
/// This was documented here as needing no permission at all. It does. The
/// counter in `stop` is what makes the difference visible: a recording whose
/// `pressed` count is far below what the user actually did has not lost the
/// presses, it never saw them.
pub fn start(capture_keys: bool) -> bool {
    if let Ok(mut clicks) = CLICKS.lock() {
        clicks.clear();
    }
    if let Ok(mut keys) = KEYS.lock() {
        keys.clear();
    }
    KEEP_PRESSES.store(capture_keys, Ordering::Relaxed);
    DISABLES.store(0, Ordering::Relaxed);

    let (started, ready) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        // Safety: every reference created here is released before the thread
        // ends, and the run loop pointer is cleared before it is dropped.
        unsafe {
            let tap = CGEventTapCreate(
                SESSION_TAP,
                HEAD_INSERT,
                LISTEN_ONLY,
                (1 << EVENT_LEFT_MOUSE_DOWN)
                    | (1 << EVENT_RIGHT_MOUSE_DOWN)
                    | (1 << EVENT_KEY_DOWN),
                on_event,
                std::ptr::null_mut(),
            );
            if tap.is_null() {
                let _ = started.send(false);
                return;
            }

            let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
            if source.is_null() {
                CFRelease(tap);
                let _ = started.send(false);
                return;
            }

            let run_loop = CFRunLoopGetCurrent();
            CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);

            // Published before the loop runs, so the first notification the
            // callback sees already has something to re-enable.
            TAP.store(tap as *mut c_void, Ordering::Release);
            RUN_LOOP.store(run_loop as *mut c_void, Ordering::Release);
            let _ = started.send(true);

            // Returns when `stop` stops it.
            CFRunLoopRun();

            // Cleared before the release below: the callback reads this pointer,
            // and one that has been freed is worse than one that is missing.
            TAP.store(std::ptr::null_mut(), Ordering::Release);
            RUN_LOOP.store(std::ptr::null_mut(), Ordering::Release);
            CFRunLoopRemoveSource(run_loop, source, kCFRunLoopCommonModes);
            CFRelease(source);
            CFRelease(tap);
        }
    });

    // Waited on rather than assumed: whether the tap exists is the one thing
    // worth knowing, and knowing it late is knowing it after the recording.
    ready
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap_or(false)
}

/// Stops listening and returns what was pressed, on the session timeline.
///
/// Converted here rather than in the callback: the callback runs inside the
/// window server's delivery of every click in the system, and the less it does
/// the better. Positions outside the captured area are dropped — a click on
/// another display is not part of this recording.
pub fn stop(region: Region, to_media: impl Fn(u64) -> Option<MediaTime>) -> Vec<ClickSample> {
    // Safety: stopping a run loop from another thread is explicitly supported,
    // and a null pointer here simply means the thread already ended.
    let run_loop = RUN_LOOP.swap(std::ptr::null_mut(), Ordering::AcqRel);
    if !run_loop.is_null() {
        unsafe { CFRunLoopStop(run_loop) };
    }

    // Drained even when the region is unusable, or the next recording would
    // inherit this one's presses.
    let raw = CLICKS
        .lock()
        .map(|mut clicks| std::mem::take(&mut *clicks))
        .unwrap_or_default();

    let samples = convert(&raw, region, to_media);

    // Both numbers, because the gap between them is the other way presses go
    // missing: a press outside the captured window, or one whose host time
    // falls in a paused stretch, is dropped by `convert` without a word.
    tracing::info!(
        "captured {} clicks ({} pressed, {} tap disables)",
        samples.len(),
        raw.len(),
        DISABLES.load(Ordering::Relaxed),
    );

    samples
}

/// What the keyboard did, on the session timeline: the typing spans, and the
/// presses if they were being kept.
///
/// Drained separately from `stop` rather than returned beside the clicks, so
/// the two tracks stay two things: one is where the pointer was pressed, and
/// this one deliberately has no position in it at all. Spans and presses come
/// out of one drain because they come from one buffer — two draining
/// functions would each get whatever the other had left, depending on which
/// was called first.
pub fn key_tracks(to_media: impl Fn(u64) -> Option<MediaTime>) -> KeyTracks {
    // Drained whatever happens, or the next recording inherits this one's.
    let raw = KEYS
        .lock()
        .map(|mut keys| std::mem::take(&mut *keys))
        .unwrap_or_default();

    let hosts: Vec<u64> = raw.iter().map(|key| key.host).collect();
    let spans = coalesce(&hosts, &to_media);
    let presses = if KEEP_PRESSES.load(Ordering::Relaxed) {
        presses(&raw, &to_media)
    } else {
        Vec::new()
    };
    tracing::info!(
        "captured {} typing spans, {} key presses",
        spans.len(),
        presses.len()
    );

    KeyTracks { spans, presses }
}

/// Puts raw presses in the recording's terms, in order.
///
/// Sorted for the reason `coalesce` sorts: a host time inside a pause is
/// subtracted from, and two presses either side of one can come out the other
/// way round.
fn presses(raw: &[RawKey], to_media: impl Fn(u64) -> Option<MediaTime>) -> Vec<KeyPress> {
    let mut presses: Vec<KeyPress> = raw
        .iter()
        .filter_map(|key| {
            Some(KeyPress {
                at: to_media(key.host)?,
                class: key.class,
            })
        })
        .collect();
    presses.sort_by_key(|press| press.at);
    presses
}

/// The class of a key, from its virtual key code.
///
/// The codes are the `kVK_*` constants from `Carbon/HIToolbox/Events.h`,
/// which are positional and the same on every layout — the key to the right
/// of L is `kVK_ANSI_Semicolon` on an AZERTY board too. Only the keys that
/// *sound* different are told apart; the letters, digits, punctuation, arrows
/// and function keys are all one class, which is the point.
fn classify(keycode: i64) -> KeyClass {
    match keycode {
        // kVK_Space
        49 => KeyClass::Space,
        // kVK_Return, kVK_ANSI_KeypadEnter
        36 | 76 => KeyClass::Enter,
        // kVK_Delete, kVK_ForwardDelete
        51 | 117 => KeyClass::Backspace,
        // kVK_RightCommand, kVK_Command, kVK_Shift, kVK_CapsLock, kVK_Option,
        // kVK_Control, kVK_RightShift, kVK_RightOption, kVK_RightControl,
        // kVK_Function
        54..=63 => KeyClass::Modifier,
        _ => KeyClass::Letter,
    }
}

/// Turns key press times into the spans the manifest carries.
///
/// Split out from `key_tracks` for the reason `convert` is split out of
/// `stop`, and tested harder than it looks like it needs to be: for a
/// recording made with presses switched off, this function is the only thing
/// standing between it and a usable record of somebody's keystroke timing.
fn coalesce(raw: &[u64], to_media: impl Fn(u64) -> Option<MediaTime>) -> Vec<KeySpan> {
    // A press during a paused stretch belongs to no moment of the recording.
    let mut times: Vec<MediaTime> = raw.iter().filter_map(|host| to_media(*host)).collect();
    // The tap pushes in order, but a host time inside a pause is subtracted
    // from, and sorting is cheaper than reasoning about whether that can
    // reorder two presses either side of one.
    times.sort_unstable();

    let mut spans: Vec<KeySpan> = Vec::new();
    let mut count = 0usize;

    for at in times {
        match spans.last_mut() {
            Some(span) if at.saturating_sub(span.end) <= KEY_GAP_NS => {
                span.end = at;
                count += 1;
            }
            _ => {
                // The span that just ended is kept only if enough went into it.
                if count < KEYS_PER_SPAN {
                    spans.pop();
                }
                spans.push(KeySpan { start: at, end: at });
                count = 1;
            }
        }
    }
    if count < KEYS_PER_SPAN {
        spans.pop();
    }

    // Rounded outwards, and only now: rounding as they were collected would
    // put presses in the same bucket and leave the count recoverable from the
    // spans. Out rather than to nearest, so a span never claims to have ended
    // before the last press in it.
    for span in &mut spans {
        span.start = span.start - span.start % KEY_ROUNDING_NS;
        span.end = span.end.next_multiple_of(KEY_ROUNDING_NS);
    }

    spans
}

/// Puts raw presses in the recording's terms.
///
/// Split out from `stop` so it can be tested without the process-wide buffer —
/// two tests sharing that buffer race each other, and a test that fails only
/// when its neighbour runs is worse than no test at all.
fn convert(
    raw: &[RawClick],
    region: Region,
    to_media: impl Fn(u64) -> Option<MediaTime>,
) -> Vec<ClickSample> {
    if region.width <= 0.0 || region.height <= 0.0 {
        return Vec::new();
    }

    raw.iter()
        .filter_map(|click| {
            let at = to_media(click.host)?;
            let x = (click.x - region.x) / region.width;
            let y = (click.y - region.y) / region.height;

            // Outside the frame is outside the recording — a press on another
            // display, or outside a cropped region.
            ((0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y)).then_some(ClickSample {
                at,
                x,
                y,
            })
        })
        .collect()
}

/// The tap's callback. Kept to a timestamp, a position and a push.
///
/// Returns the event untouched: this is a listen-only tap, and the return value
/// is what is passed on to whatever was actually clicked.
extern "C" fn on_event(
    _proxy: *const c_void,
    kind: u32,
    event: *const c_void,
    _user: *mut c_void,
) -> *const c_void {
    // Not a press at all, but the window server saying it has switched the tap
    // off. Turning it back on is the entire fix, and skipping it costs every
    // click for the rest of the recording. See `TAP`.
    if kind == EVENT_TAP_DISABLED_BY_TIMEOUT || kind == EVENT_TAP_DISABLED_BY_USER_INPUT {
        DISABLES.fetch_add(1, Ordering::Relaxed);
        let tap = TAP.load(Ordering::Acquire);
        if !tap.is_null() {
            // Safety: cleared before the tap is released, so a non-null pointer
            // here is still live.
            unsafe { CGEventTapEnable(tap, true) };
        }
        return event;
    }

    // A key: a moment and a class. The code is read to pick the class and
    // goes no further; the modifier flags and the character are never read.
    if kind == EVENT_KEY_DOWN {
        // Safety: the event is owned by the caller and only read here.
        let (repeat, keycode) = unsafe {
            (
                CGEventGetIntegerValueField(event, KEYBOARD_EVENT_AUTOREPEAT),
                CGEventGetIntegerValueField(event, KEYBOARD_EVENT_KEYCODE),
            )
        };
        // A held key reports itself thirty times a second, and a real board
        // makes one sound for it. Dropped here rather than de-duplicated
        // later, because later cannot tell a repeat from fast typing.
        if repeat != 0 {
            return event;
        }
        if let Ok(mut keys) = KEYS.lock() {
            keys.push(RawKey {
                host: host_now(),
                class: classify(keycode),
            });
        }
        return event;
    }

    // The mask should mean nothing else arrives, but a notification already
    // proved otherwise, and `CGEventGetLocation` on one of those returns a
    // position that would be recorded as a click nobody made.
    if kind != EVENT_LEFT_MOUSE_DOWN && kind != EVENT_RIGHT_MOUSE_DOWN {
        return event;
    }

    // Safety: the event is owned by the caller and only read here.
    let point = unsafe { CGEventGetLocation(event) };

    if let Ok(mut clicks) = CLICKS.lock() {
        clicks.push(RawClick {
            // Stamped on arrival rather than read off the event: a tap fires
            // within microseconds, and `CGEventGetTimestamp` is in mach units
            // that would have to be converted anyway.
            host: host_now(),
            x: point.x,
            y: point.y,
        });
    }

    event
}

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}

const SESSION_TAP: u32 = 1;
const HEAD_INSERT: u32 = 0;
const LISTEN_ONLY: u32 = 1;
const EVENT_LEFT_MOUSE_DOWN: u32 = 1;
const EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
/// `kCGEventKeyDown`. Key *up* is deliberately not in the mask: a press is a
/// moment, and the time until its release is a hold — a measure of the typist,
/// not of the typing, and nothing here needs it.
const EVENT_KEY_DOWN: u32 = 10;

/// `kCGKeyboardEventAutorepeat` and `kCGKeyboardEventKeycode`, the two fields
/// of a keyboard event this reads. The flags field, which would carry the
/// modifiers, and the unicode string are deliberately not among them.
const KEYBOARD_EVENT_AUTOREPEAT: u32 = 8;
const KEYBOARD_EVENT_KEYCODE: u32 = 9;

/// `kCGEventTapDisabledByTimeout` and `kCGEventTapDisabledByUserInput`.
///
/// Delivered to the callback as event *types*, outside the mask, and the only
/// notice given that the tap has stopped working.
const EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: extern "C" fn(*const c_void, u32, *const c_void, *mut c_void) -> *const c_void,
        user_info: *mut c_void,
    ) -> *const c_void;
    fn CGEventTapEnable(tap: *const c_void, enable: bool);
    fn CGEventGetLocation(event: *const c_void) -> CGPoint;
    fn CGEventGetIntegerValueField(event: *const c_void, field: u32) -> i64;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFRunLoopCommonModes: *const c_void;

    fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: *const c_void,
        order: isize,
    ) -> *const c_void;
    fn CFRunLoopGetCurrent() -> *const c_void;
    fn CFRunLoopAddSource(loop_: *const c_void, source: *const c_void, mode: *const c_void);
    fn CFRunLoopRemoveSource(loop_: *const c_void, source: *const c_void, mode: *const c_void);
    fn CFRunLoopRun();
    fn CFRunLoopStop(loop_: *const c_void);
    fn CFRelease(cf: *const c_void);
}

#[cfg(test)]
mod tests {
    use super::*;

    const REGION: Region = Region {
        x: 0.0,
        y: 0.0,
        width: 1000.0,
        height: 500.0,
    };

    fn raw(x: f64, y: f64) -> RawClick {
        RawClick { host: 7, x, y }
    }

    #[test]
    fn stores_a_press_as_a_fraction_of_the_region() {
        assert_eq!(
            convert(&[raw(500.0, 250.0)], REGION, |host| Some(
                host as MediaTime * 2
            )),
            vec![ClickSample {
                at: 14,
                x: 0.5,
                y: 0.5
            }]
        );
    }

    #[test]
    fn drops_a_press_outside_the_captured_area() {
        // A press on another display, or outside a cropped region. It happened,
        // but not in this recording.
        assert!(convert(&[raw(4000.0, 10.0)], REGION, |_| Some(0)).is_empty());
        assert!(convert(&[raw(10.0, -50.0)], REGION, |_| Some(0)).is_empty());
    }

    #[test]
    fn drops_a_press_with_no_place_on_the_timeline() {
        // Before the first frame, so there is no media time it belongs to.
        assert!(convert(&[raw(10.0, 10.0)], REGION, |_| None).is_empty());
    }

    #[test]
    fn a_region_with_no_area_records_nothing() {
        assert!(convert(&[raw(10.0, 10.0)], Region::default(), |_| Some(0)).is_empty());
    }

    #[test]
    fn stopping_without_starting_is_harmless() {
        assert_eq!(stop(REGION, |_| Some(0)), vec![]);
        assert_eq!(key_tracks(|_| Some(0)), KeyTracks::default());
    }

    #[test]
    fn only_the_keys_that_sound_different_are_told_apart() {
        assert_eq!(classify(49), KeyClass::Space);
        assert_eq!(classify(36), KeyClass::Enter);
        assert_eq!(classify(76), KeyClass::Enter);
        assert_eq!(classify(51), KeyClass::Backspace);
        assert_eq!(classify(117), KeyClass::Backspace);
        for modifier in [54, 55, 56, 57, 58, 59, 60, 61, 62, 63] {
            assert_eq!(classify(modifier), KeyClass::Modifier);
        }
        // A, the digit 1, Tab, Escape, the left arrow, F5: all one class. Told
        // apart they would spell things.
        for letter in [0, 18, 48, 53, 123, 96] {
            assert_eq!(classify(letter), KeyClass::Letter);
        }
    }

    #[test]
    fn presses_come_out_in_order_and_never_from_a_pause() {
        let raw = [
            RawKey {
                host: 300,
                class: KeyClass::Letter,
            },
            RawKey {
                host: 100,
                class: KeyClass::Space,
            },
            RawKey {
                host: 200,
                class: KeyClass::Letter,
            },
        ];
        // 200 falls in a pause: it happened, but not in the recording.
        let kept = presses(&raw, |host| (host != 200).then_some(host * 2));
        assert_eq!(
            kept,
            vec![
                KeyPress {
                    at: 200,
                    class: KeyClass::Space
                },
                KeyPress {
                    at: 600,
                    class: KeyClass::Letter
                },
            ]
        );
    }

    /// Presses at these moments, in milliseconds, through an identity clock.
    fn typed(ms: &[u64]) -> Vec<KeySpan> {
        let raw: Vec<u64> = ms.iter().map(|at| at * 1_000_000).collect();
        coalesce(&raw, Some)
    }

    #[test]
    fn a_shortcut_leaves_no_trace_at_all() {
        // One press with modifiers on it — Cmd-S, Cmd-Tab. The modifiers are
        // not keys and never reach the tap, so this is what a shortcut looks
        // like from here, and a recording must not carry that it happened.
        assert_eq!(typed(&[500]), vec![]);
        assert_eq!(typed(&[500, 4000]), vec![]);
    }

    #[test]
    fn a_run_of_typing_becomes_one_span() {
        // Both ends land on the tenth-of-a-second grid, and a press anywhere
        // inside a bucket comes back as the bucket — which is what makes the
        // rounding a blur rather than a shift.
        assert_eq!(
            typed(&[1000, 1120, 1260, 1400]),
            vec![KeySpan {
                start: 1_000_000_000,
                end: 1_400_000_000
            }]
        );
        assert_eq!(
            typed(&[1099, 1120, 1260, 1301]),
            typed(&[1000, 1120, 1260, 1400])
        );
    }

    #[test]
    fn a_pause_long_enough_to_reach_for_the_mouse_ends_the_span() {
        let spans = typed(&[1000, 1100, 1200, 3000, 3100, 3200]);
        assert_eq!(spans.len(), 2);
        assert!(spans[0].end < spans[1].start);
    }

    #[test]
    fn the_presses_cannot_be_counted_back_out_of_the_spans() {
        // The point of the whole function. Four presses and eleven presses over
        // the same stretch have to come back as the same span, because the gaps
        // between them are enough to narrow down what was typed.
        let few = typed(&[1000, 1300, 1600, 1900]);
        let many = typed(&[
            1000, 1090, 1180, 1270, 1360, 1450, 1540, 1630, 1720, 1810, 1900,
        ]);

        assert_eq!(few, many);
        for span in few {
            assert_eq!(span.start % KEY_ROUNDING_NS, 0);
            assert_eq!(span.end % KEY_ROUNDING_NS, 0);
        }
    }

    #[test]
    fn a_span_covers_every_press_that_went_into_it() {
        // Rounded outwards, never to nearest: a span that ended before its last
        // press would show the pointer again mid-word.
        let spans = typed(&[1050, 1150, 1290]);
        assert!(spans[0].start <= 1_050_000_000);
        assert!(spans[0].end >= 1_290_000_000);
    }

    #[test]
    fn drops_presses_made_while_the_recording_was_paused() {
        // `to_media` answers None for a host time inside a paused stretch, and
        // typing through a pause is not typing that happened in the recording.
        assert_eq!(coalesce(&[1, 2, 3], |_| None), vec![]);
    }
}
