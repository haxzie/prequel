//! Handing a cidre `CVPixelBuffer` to GPUI's.
//!
//! Two Apple binding stacks meet here and there is no way around it: the app's
//! render core is built on **cidre**, GPUI is built on **core-video**. Each
//! defines its own wrapper, so to the compiler the types are unrelated — even
//! though the thing behind both is one `CVPixelBufferRef`.
//!
//! That they really are one pointer was checked in the crates rather than
//! assumed, because a copy per frame would sink the whole idea (4K BGRA is
//! ~33 MB a frame, sixty times a second):
//!
//! - cidre: `cv::PixelBuf = cv::ImageBuf = cv::Buf`, and `define_cf_type!`
//!   makes `Buf` a `#[repr(transparent)]` newtype over `cf::Type`. So a
//!   `&cv::PixelBuf` *is* the CF object pointer.
//! - core-video 0.4.3: `CVPixelBufferRef = CVImageBufferRef = CVBufferRef =
//!   *mut __CVBuffer`, and `pub struct CVPixelBuffer(CVPixelBufferRef)` with a
//!   `Drop` that calls `CVPixelBufferRelease`.
//!
//! So the bridge is a pointer cast plus a retain. The retain is the part that
//! matters: both wrappers release on drop, so handing the pointer over without
//! one gives two owners of a single buffer and a use-after-free that lands
//! later, somewhere else.
//!
//! The version pin in `Cargo.toml` is load-bearing. `core-video` at a different
//! minor is a *different* `CVPixelBuffer` type and none of this compiles.

use cidre::cv;
use core_foundation::base::TCFType;
use core_video::pixel_buffer::{CVPixelBuffer, CVPixelBufferRef};

/// Re-wraps a cidre pixel buffer as the one `gpui::surface()` takes.
///
/// Zero copy: the same `CVPixelBufferRef`, retained once for its new owner.
pub fn to_gpui(buffer: &cv::PixelBuf) -> CVPixelBuffer {
    // Safety: `cv::PixelBuf` is `#[repr(transparent)]` down to the CF pointer,
    // so this cast is the identity on the value. `wrap_under_get_rule` retains,
    // which leaves cidre's own `arc::R` free to release the count it holds.
    unsafe {
        let raw = buffer as *const cv::PixelBuf as CVPixelBufferRef;
        CVPixelBuffer::wrap_under_get_rule(raw)
    }
}
