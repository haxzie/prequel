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
use std::sync::atomic::{AtomicPtr, Ordering};

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

/// Presses since the tap started.
///
/// A process-wide buffer rather than something threaded through the callback's
/// `user_info`: only one recording runs at a time — `RECORDER` in the napi
/// crate is a single slot — and a static sidesteps handing a raw pointer to a
/// callback that outlives the frame it was created in.
static CLICKS: Mutex<Vec<RawClick>> = Mutex::new(Vec::new());

/// The tap thread's run loop, so it can be stopped from the outside.
static RUN_LOOP: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

/// Starts listening for presses. Returns false if the tap could not be made.
///
/// Needs no permission of its own: a listen-only *mouse* tap is created even
/// with Accessibility switched off, unlike a keyboard tap, which needs Input
/// Monitoring. Verified rather than assumed — `CGEventTapCreate` returns null
/// when it is refused, which is what this reports.
pub fn start() -> bool {
    if let Ok(mut clicks) = CLICKS.lock() {
        clicks.clear();
    }

    let (started, ready) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        // Safety: every reference created here is released before the thread
        // ends, and the run loop pointer is cleared before it is dropped.
        unsafe {
            let tap = CGEventTapCreate(
                SESSION_TAP,
                HEAD_INSERT,
                LISTEN_ONLY,
                (1 << EVENT_LEFT_MOUSE_DOWN) | (1 << EVENT_RIGHT_MOUSE_DOWN),
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

            RUN_LOOP.store(run_loop as *mut c_void, Ordering::Release);
            let _ = started.send(true);

            // Returns when `stop` stops it.
            CFRunLoopRun();

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

    convert(&raw, region, to_media)
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
    _kind: u32,
    event: *const c_void,
    _user: *mut c_void,
) -> *const c_void {
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
}
