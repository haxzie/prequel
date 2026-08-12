//! Decoding a background image into a pixel buffer.
//!
//! Straight ImageIO and CoreGraphics rather than a cidre wrapper: cidre 0.20
//! binds `CGImageDestination` but not `CGImageSource`, so there is no bound way
//! to read a PNG back. Two externs and a bitmap context is less machinery than
//! the alternatives, and matches how `prequel-capture` reaches the TCC calls.
//!
//! Without this the exporter would quietly skip image backgrounds while the
//! preview drew them — exactly the preview/export divergence the whole plan
//! architecture exists to prevent.

use std::ffi::c_void;
use std::path::Path;

use cidre::{arc, cf, cg, cv, ns};

use crate::{Error, Result};

/// Reads an image file into a BGRA pixel buffer the compositor can sample.
pub fn decode(path: &Path) -> Result<arc::R<cv::PixelBuf>> {
    let text = path.to_str().ok_or_else(|| Error::Read {
        path: path.display().to_string(),
        reason: "path is not valid UTF-8".to_owned(),
    })?;
    let url = ns::Url::with_fs_path_str(text, false);

    // Safety: `url` outlives both calls, and each returns either a retained
    // object or null. Both are released before returning.
    let image = unsafe {
        let source =
            CGImageSourceCreateWithURL(url.as_ref() as *const _ as *const c_void, std::ptr::null());
        if source.is_null() {
            return Err(Error::Read {
                path: path.display().to_string(),
                reason: "could not be opened as an image".to_owned(),
            });
        }

        let image = CGImageSourceCreateImageAtIndex(source, 0, std::ptr::null());
        CFRelease(source);

        if image.is_null() {
            return Err(Error::Read {
                path: path.display().to_string(),
                reason: "holds no decodable image".to_owned(),
            });
        }
        image
    };

    let result = draw_into_buffer(image, path);

    // Safety: created above and not handed anywhere that retains it.
    unsafe { CFRelease(image) };

    result
}

/// Draws a decoded image into a fresh BGRA buffer.
fn draw_into_buffer(image: *mut c_void, path: &Path) -> Result<arc::R<cv::PixelBuf>> {
    // Safety: `image` is a valid CGImage for the whole of this function.
    let (width, height) = unsafe { (CGImageGetWidth(image), CGImageGetHeight(image)) };
    if width == 0 || height == 0 {
        return Err(Error::Read {
            path: path.display().to_string(),
            reason: "image has no pixels".to_owned(),
        });
    }

    // Metal-compatible and IOSurface-backed, which is not the default.
    // `CVMetalTextureCache` can only wrap a buffer whose memory the GPU can
    // see; a plain allocation is wrappable-looking and samples as nothing,
    // which shows up as a background that silently never draws.
    let attrs = cf::DictionaryOf::with_keys_values(
        &[
            cv::pixel_buffer::keys::metal_compatibility(),
            cv::pixel_buffer::keys::io_surf_props(),
        ],
        &[
            cf::Boolean::value_true().as_type_ref(),
            cf::DictionaryOf::<cf::String, cf::Type>::with_keys_values(&[], &[]).as_type_ref(),
        ],
    );

    let mut buffer = cv::PixelBuf::new(
        width,
        height,
        cv::PixelFormat::_32_BGRA,
        Some(attrs.as_ref()),
    )
    .map_err(|e| Error::Read {
        path: path.display().to_string(),
        reason: format!("could not allocate a buffer for it: {e:?}"),
    })?;

    let space = cg::ColorSpace::device_rgb().ok_or_else(|| Error::Read {
        path: path.display().to_string(),
        reason: "no device colour space".to_owned(),
    })?;

    // Safety: the buffer is locked for the whole of the draw, the context is
    // built over its base address with its real stride, and both the context
    // and the lock are released before returning.
    unsafe {
        buffer
            .lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .map_err(|e| Error::Read {
                path: path.display().to_string(),
                reason: format!("could not lock the buffer: {e:?}"),
            })?;

        let context = CGBitmapContextCreate(
            buffer.base_address_mut().cast(),
            width,
            height,
            8,
            buffer.bytes_per_row(),
            space.as_ref() as *const _ as *const c_void,
            // BGRA with premultiplied alpha, little-endian — the layout
            // `_32_BGRA` names and the one Metal samples.
            KCG_IMAGE_ALPHA_PREMULTIPLIED_FIRST | KCG_BITMAP_BYTE_ORDER_32_LITTLE,
        );

        if !context.is_null() {
            CGContextDrawImage(
                context,
                CGRect {
                    x: 0.0,
                    y: 0.0,
                    width: width as f64,
                    height: height as f64,
                },
                image,
            );
            CFRelease(context);
        }

        let _ = buffer.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT);
    }

    Ok(buffer)
}

#[repr(C)]
struct CGRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

const KCG_IMAGE_ALPHA_PREMULTIPLIED_FIRST: u32 = 2;
const KCG_BITMAP_BYTE_ORDER_32_LITTLE: u32 = 2 << 12;

#[link(name = "ImageIO", kind = "framework")]
unsafe extern "C" {
    fn CGImageSourceCreateWithURL(url: *const c_void, options: *const c_void) -> *mut c_void;
    fn CGImageSourceCreateImageAtIndex(
        source: *mut c_void,
        index: usize,
        options: *const c_void,
    ) -> *mut c_void;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGImageGetWidth(image: *mut c_void) -> usize;
    fn CGImageGetHeight(image: *mut c_void) -> usize;
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits_per_component: usize,
        bytes_per_row: usize,
        space: *const c_void,
        bitmap_info: u32,
    ) -> *mut c_void;
    fn CGContextDrawImage(context: *mut c_void, rect: CGRect, image: *mut c_void);
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *mut c_void);
}

#[cfg(test)]
mod tests {
    use super::*;
    use cidre::cv;

    /// Decoding has to produce actual pixels, not just a buffer.
    ///
    /// The failure this covers was silent: a context that failed to build left
    /// the buffer untouched, so the background drew as transparent black and
    /// looked exactly like "the image did not load".
    #[test]
    fn decodes_a_png_into_real_pixels() {
        let path = std::env::temp_dir().join("prequel-decode-probe.png");

        // A solid blue PNG, written by ffmpeg so nothing here hand-rolls one.
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x48",
                "-frames:v",
                "1",
                "-y",
            ])
            .arg(&path)
            .status()
            .expect("ffmpeg must be installed");
        assert!(status.success());

        let mut buffer = decode(&path).expect("decode the png");

        assert_eq!(buffer.width(), 64);
        assert_eq!(buffer.height(), 48);

        // Safety: locked for the read, unlocked before returning.
        let (b, g, r, a) = unsafe {
            buffer
                .lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
                .result()
                .expect("lock");
            let base = buffer.base_address().cast::<u8>();
            let sample = (*base, *base.add(1), *base.add(2), *base.add(3));
            let _ = buffer.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY);
            sample
        };

        let _ = std::fs::remove_file(&path);

        assert!(a > 0, "decoded to fully transparent — nothing was drawn");
        assert!(
            b > 200 && r < 60 && g < 60,
            "expected blue in BGRA, got b={b} g={g} r={r} a={a}",
        );
    }
}
