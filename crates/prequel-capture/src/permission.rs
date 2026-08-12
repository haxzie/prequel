//! Screen Recording permission.
//!
//! Screen Recording is a TCC grant, not an entitlement — there is no codesign
//! flag that turns it on. These CoreGraphics calls are the only supported way
//! to read and request it.
//!
//! We go direct rather than through Electron's
//! `systemPreferences.getMediaAccessStatus('screen')`, which is known to return
//! a stale value until the app restarts (electron#36722).

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

unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
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
