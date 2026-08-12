use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The user has not granted Screen Recording in System Settings.
    ///
    /// Worth distinguishing from a generic failure: it is the single most
    /// common reason capture fails, and the only fix is a trip to System
    /// Settings followed by an app restart.
    #[error(
        "screen recording permission denied — grant Prequel access in \
         System Settings ▸ Privacy & Security ▸ Screen Recording, then restart the app"
    )]
    ScreenAccessDenied,

    /// ScreenCaptureKit returned an NSError.
    #[error("ScreenCaptureKit error: {0}")]
    ScreenCaptureKit(String),

    /// A ScreenCaptureKit callback never fired.
    #[error("timed out after {0:?} waiting for ScreenCaptureKit")]
    Timeout(std::time::Duration),

    #[error("encoder: {0}")]
    Encode(String),

    #[error("could not prepare {path}: {reason}")]
    Output { path: String, reason: String },

    #[error("capture region is empty: {width}×{height} points")]
    EmptyRegion { width: f64, height: f64 },

    #[error("no display found with id {0}")]
    DisplayNotFound(u32),

    /// The display exists but is asleep, so ScreenCaptureKit will not offer it.
    #[error("display {0} is asleep — wake the screen and try again")]
    DisplayAsleep(u32),

    #[error("no window found with id {0}")]
    WindowNotFound(u32),
}

impl Error {
    /// Maps an `SCStreamErrorDomain` NSError onto our error type.
    ///
    /// Code -3801 is SCK's "user declined TCC" — surfaced as
    /// [`Error::ScreenAccessDenied`] so callers can route the user to System
    /// Settings instead of showing a raw Objective-C error string.
    pub(crate) fn from_ns_error(err: &impl fmt::Debug) -> Self {
        let text = format!("{err:?}");
        if text.contains("-3801") || text.contains("declined TCC") {
            Self::ScreenAccessDenied
        } else {
            Self::ScreenCaptureKit(text)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tcc_denial_maps_to_permission_error() {
        let err = Error::from_ns_error(
            &"Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3801 \
              \"The user declined TCCs for application, window, display capture\"",
        );
        assert!(matches!(err, Error::ScreenAccessDenied));
    }

    #[test]
    fn other_errors_pass_through() {
        let err = Error::from_ns_error(&"Code=-3802 something else");
        assert!(matches!(err, Error::ScreenCaptureKit(_)));
    }
}
