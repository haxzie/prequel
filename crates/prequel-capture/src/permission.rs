//! Screen Recording and Input Monitoring permissions.
//!
//! Both are TCC grants, not entitlements — there is no codesign flag that
//! turns either on. These CoreGraphics and IOKit calls are the only supported
//! way to read and request them.
//!
//! We go direct rather than through Electron's
//! `systemPreferences.getMediaAccessStatus('screen')`, which is known to return
//! a stale value until the app restarts (electron#36722). Electron has no API
//! for Input Monitoring at all.
//!
//! Input Monitoring is the grant the keyboard needs. Since macOS 10.15 a
//! listen-only event tap is handed *mouse* events under the Accessibility
//! grant but keyboard events only under this one — and nothing fails when it
//! is missing: the tap is created, the clicks arrive, and every key-down is
//! withheld without a word. That is how the typing spans came to be empty on
//! every recording for a month while the click counts looked healthy.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionStatus {
    Granted,
    Denied,
}

impl PermissionStatus {
    pub fn is_granted(self) -> bool {
        matches!(self, Self::Granted)
    }
}

/// Reads the current grant without showing a prompt.
pub fn screen_access_status() -> PermissionStatus {
    if unsafe { CGPreflightScreenCaptureAccess() } {
        PermissionStatus::Granted
    } else {
        PermissionStatus::Denied
    }
}

/// Asks macOS to show the Screen Recording prompt.
///
/// Returns whether access is granted *right now*. macOS only ever shows this
/// prompt once per app; after the first denial it silently returns false and
/// the user has to go to System Settings themselves. It also does not take
/// effect for the running process — the app must be restarted — so treat a
/// `false` here as "tell the user to restart", not "retry".
pub fn request_screen_access() -> PermissionStatus {
    if unsafe { CGRequestScreenCaptureAccess() } {
        PermissionStatus::Granted
    } else {
        PermissionStatus::Denied
    }
}

/// Reads the Input Monitoring grant without showing a prompt.
///
/// `kIOHIDAccessTypeUnknown` — never asked — reads as denied: the tap gets no
/// keys either way, and the answer that matters is whether to ask.
pub fn input_monitoring_status() -> PermissionStatus {
    if unsafe { IOHIDCheckAccess(IOHID_REQUEST_LISTEN_EVENT) } == IOHID_ACCESS_GRANTED {
        PermissionStatus::Granted
    } else {
        PermissionStatus::Denied
    }
}

/// Asks macOS to show the Input Monitoring prompt, which also lists the app in
/// the pane so it can be switched on there.
///
/// Like the Screen Recording prompt: shown at most once, and a grant does not
/// reach a running process — the tap has to be made again by a process that
/// started after it. Treat a `Denied` as "open Settings and restart".
pub fn request_input_monitoring() -> PermissionStatus {
    if unsafe { IOHIDRequestAccess(IOHID_REQUEST_LISTEN_EVENT) } {
        PermissionStatus::Granted
    } else {
        PermissionStatus::Denied
    }
}

/// `kIOHIDRequestTypeListenEvent`: observing input, as an event tap does. The
/// other value, `PostEvent`, is for synthesising it, which nothing here does.
const IOHID_REQUEST_LISTEN_EVENT: u32 = 1;
/// `kIOHIDAccessTypeGranted`. `Denied` is 1 and `Unknown` 2.
const IOHID_ACCESS_GRANTED: u32 = 0;

unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOHIDCheckAccess(request: u32) -> u32;
    fn IOHIDRequestAccess(request: u32) -> bool;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preflight_does_not_panic_and_is_stable() {
        // Can't assert the value — it depends on whether the test runner's
        // parent process holds the grant. It must not crash or flap, though.
        let a = screen_access_status();
        let b = screen_access_status();
        assert_eq!(a, b);
    }
}
