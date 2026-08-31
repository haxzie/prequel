//! Where the pointer was pressed, sampled alongside the video.
//!
//! A click is the strongest signal a screen recording gives about what mattered
//! and when — far stronger than where the pointer merely was, which is mostly
//! travel. It is what the editor's automatic zooms are built from.
//!
//! **Buttons only.** A listen-only tap on mouse-down carries no key codes and
//! no modifiers, and nothing here reads what was pressed beyond *that* it was
//! and where. A keyboard tap would be a different thing entirely — and would
//! need Input Monitoring, which this does not.
//!
//! Raw `extern "C"`, matching `cursor.rs` and `typing.rs`: cidre binds none of
//! Quartz's event API, and this needs six functions.
//!
//! The tap runs its own run loop on its own thread. An event tap is delivered
//! by the window server into a run loop source, so there has to be a run loop
//! for it to be delivered into — and it cannot be the capture callback's, which
//! is ScreenCaptureKit's and is busy sixty times a second.

use std::ffi::c_void;
use std::sync::Mutex;
use std::sync::atomic::{AtomicPtr, AtomicU32, Ordering};

use prequel_encode::host_now;
use prequel_session::MediaTime;

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
/// A span rather than the keystrokes it was made of, and that is the whole
/// design. What every layer of this manifest promises is that a recording never
/// carries what was typed, and per-keystroke timing is a weaker promise than it
/// sounds: the gaps between presses are enough to narrow down what the presses
/// were. Coalesced and rounded here, at the point of capture, so the finer
/// timing never reaches a file at all — what survives is "typing, from about
/// here to about here", which is exactly what hiding the pointer needs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KeySpan {
    pub start: MediaTime,
    pub end: MediaTime,
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

/// Host times of key presses since the tap started.
///
/// Times and nothing else — no key code, no modifiers, and never the character.
/// Even these do not outlive the recording: `key_spans` coalesces them on the
/// way out and only the spans are written.
static KEYS: Mutex<Vec<u64>> = Mutex::new(Vec::new());

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
pub fn start() -> bool {
    if let Ok(mut clicks) = CLICKS.lock() {
        clicks.clear();
    }
    if let Ok(mut keys) = KEYS.lock() {
        keys.clear();
    }
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

/// Stretches of the recording somebody was typing through, on the session
/// timeline.
///
/// Drained separately from `stop` rather than returned beside the clicks, so
/// the two tracks stay two things: one is where the pointer was pressed, and
/// this one deliberately has no position in it at all.
pub fn key_spans(to_media: impl Fn(u64) -> Option<MediaTime>) -> Vec<KeySpan> {
    // Drained whatever happens, or the next recording inherits this one's.
    let raw = KEYS
        .lock()
        .map(|mut keys| std::mem::take(&mut *keys))
        .unwrap_or_default();

    let spans = coalesce(&raw, to_media);
    tracing::info!("captured {} typing spans", spans.len());

    spans
}

/// Turns key press times into the spans the manifest carries.
///
/// Split out from `key_spans` for the reason `convert` is split out of `stop`,
/// and tested harder than it looks like it needs to be: this function is the
/// only thing standing between a recording and a usable record of somebody's
/// keystroke timing.
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

    // A key, which is recorded as a moment and nothing else. The event is not
    // read at all — not the code, not the modifiers — so there is nothing here
    // that could become what somebody typed.
    if kind == EVENT_KEY_DOWN {
        if let Ok(mut keys) = KEYS.lock() {
            keys.push(host_now());
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
/// moment, and two events per key would only be twice as much to throw away.
const EVENT_KEY_DOWN: u32 = 10;

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
