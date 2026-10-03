//! Finding cameras.

// cidre's `define_obj_type!` expands to a transmute clippy flags. It is inside
// the macro, not in code written here.
#![allow(clippy::useless_transmute)]

use cidre::{arc, av, ns};

/// A camera the user can pick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CameraDevice {
    /// `AVCaptureDevice.uniqueID`. Stable across launches and reconnections.
    pub id: String,
    /// `AVCaptureDevice.localizedName`.
    ///
    /// Worth carrying because it is also what Chromium reports as
    /// `MediaDeviceInfo.label` — and Chromium's `deviceId` is salted per
    /// origin, so a name is the only thing the browser-side picker and this
    /// side can both recognise.
    pub name: String,
}

/// Camera types worth offering.
///
/// Deliberately not every `AVCaptureDeviceType`: depth and LiDAR devices are
/// listed by the discovery session but are not things anyone wants in the
/// corner of a screen recording.
fn camera_types() -> arc::R<ns::Array<av::CaptureDeviceType>> {
    ns::Array::from_slice(&[
        av::CaptureDeviceType::built_in_wide_angle_camera(),
        av::CaptureDeviceType::external(),
        av::CaptureDeviceType::continuity_camera(),
        av::CaptureDeviceType::desk_view_camera(),
    ])
}

/// Every camera currently attached.
///
/// Does not prompt for permission and does not open any device — an unauthorised
/// app still sees the list, just not the pixels.
pub fn list_cameras() -> Vec<CameraDevice> {
    let session = av::CaptureDeviceDiscoverySession::with_device_types_media_and_pos(
        &camera_types(),
        Some(av::MediaType::video()),
        av::CaptureDevicePos::Unspecified,
    );

    session
        .devices()
        .iter()
        .map(|device| CameraDevice {
            id: device.unique_id().to_string(),
            name: device.localized_name().to_string(),
        })
        .collect()
}

/// An audio input the Mac can hear.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioDevice {
    /// `AVCaptureDevice.uniqueID`.
    pub id: String,
    /// `AVCaptureDevice.localizedName`.
    pub name: String,
    /// Whether macOS treats this as the input to use.
    ///
    /// Worth carrying because a take records the *default* input rather than a
    /// chosen one — ScreenCaptureKit captures the microphone, not a device the
    /// app opened — so a list without this would read as a choice the recorder
    /// does not offer.
    pub is_default: bool,
}

/// Every audio input currently attached.
///
/// `AVCaptureDeviceType::microphone()` covers the built-in, USB interfaces and
/// anything Core Audio aggregates, which is what the Sound pane lists. Like
/// `list_cameras`, this prompts for nothing and opens nothing: an unauthorised
/// app still sees the names.
pub fn list_microphones() -> Vec<AudioDevice> {
    let default = av::CaptureDevice::default_with_media(av::MediaType::audio())
        .map(|device| device.unique_id().to_string());

    let session = av::CaptureDeviceDiscoverySession::with_device_types_media_and_pos(
        &ns::Array::from_slice(&[av::CaptureDeviceType::microphone()]),
        Some(av::MediaType::audio()),
        av::CaptureDevicePos::Unspecified,
    );

    session
        .devices()
        .iter()
        .map(|device| {
            let id = device.unique_id().to_string();
            AudioDevice {
                is_default: default.as_deref() == Some(id.as_str()),
                id,
                name: device.localized_name().to_string(),
            }
        })
        .collect()
}

/// Resolves what the shell asked for to an actual device.
///
/// Accepts either a `uniqueID` or a `localizedName`, because the two sides of
/// the app know a camera by different names: the panel's drop-up is populated
/// from `navigator.mediaDevices`, whose ids are salted per origin and mean
/// nothing here, while its labels come straight from `localizedName`.
///
/// The id is tried first — it is unambiguous — and the name only as a fallback.
pub(crate) fn find(reference: &str) -> Option<arc::R<av::CaptureDevice>> {
    if let Some(device) = av::CaptureDevice::with_unique_id(&ns::String::with_str(reference)) {
        return Some(device);
    }

    let session = av::CaptureDeviceDiscoverySession::with_device_types_media_and_pos(
        &camera_types(),
        Some(av::MediaType::video()),
        av::CaptureDevicePos::Unspecified,
    );

    session
        .devices()
        .iter()
        .find(|device| device.localized_name().to_string() == reference)
        .map(|device| device.retained())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listing_cameras_does_not_panic_without_a_camera() {
        // CI has no camera at all; the contract is an empty list, not a crash.
        let cameras = list_cameras();
        for camera in &cameras {
            assert!(!camera.id.is_empty(), "a camera must have a unique id");
            assert!(!camera.name.is_empty(), "a camera must have a name");
        }
    }

    #[test]
    fn listing_microphones_does_not_panic_without_one() {
        // Same contract as the cameras: a machine with no input is an empty
        // list. At most one may claim to be the default, or the shell has two
        // answers to which device a take will record.
        let microphones = list_microphones();
        let defaults = microphones.iter().filter(|m| m.is_default).count();
        assert!(defaults <= 1, "more than one microphone claimed to be the default");
        for microphone in &microphones {
            assert!(!microphone.id.is_empty(), "a microphone must have a unique id");
            assert!(!microphone.name.is_empty(), "a microphone must have a name");
        }
    }

    #[test]
    fn camera_ids_are_unique() {
        // The shell stores one of these as a preference; a collision would make
        // the stored choice ambiguous.
        let mut ids: Vec<_> = list_cameras().into_iter().map(|c| c.id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count);
    }

    #[test]
    fn an_unknown_reference_resolves_to_nothing() {
        assert!(find("no-such-camera-4a1f").is_none());
    }

    #[test]
    fn a_listed_camera_can_be_found_by_id_and_by_name() {
        // The name path is the one the shell actually uses, since Chromium's
        // device ids cannot be resolved here.
        let Some(camera) = list_cameras().into_iter().next() else {
            eprintln!("SKIP: no camera attached");
            return;
        };

        assert!(find(&camera.id).is_some(), "id lookup failed");
        assert!(find(&camera.name).is_some(), "name lookup failed");
    }
}
