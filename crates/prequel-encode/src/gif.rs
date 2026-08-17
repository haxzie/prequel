//! Writing an animated GIF, frame by frame.
//!
//! Nothing here is hardware-accelerated, and it cannot be: GIF is a 256-colour
//! palette format with LZW compression, which VideoToolbox has no concept of.
//! Every frame is quantised on the CPU, so a GIF export is several times slower
//! per frame than the same edit to MP4 — which is why the editor keeps GIF to
//! small frames and low rates rather than offering it as an equal to MP4.
//!
//! Takes the same `cv::PixelBuf` the compositor already produces, so the export
//! loop is identical either way and the two outputs cannot come from different
//! pictures.

use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

use cidre::cv;

use crate::{Error, Result};

/// How hard the quantiser looks for a good palette, on `gif`'s 1–30 scale where
/// 1 is best and 30 is fastest.
///
/// 10 is the crate's own documented middle. Screen recordings are mostly flat
/// UI colour, which quantises well at any setting; the difference at 1 is not
/// visible here and costs roughly ten times the time per frame.
const QUANTISE_SPEED: i32 = 10;

/// The shortest delay a GIF can express, in centiseconds.
///
/// Browsers and Preview both clamp anything under 2cs up to ~10cs rather than
/// playing it, so a "50 fps" GIF written as 1cs plays at a fifth of its
/// intended speed. Clamping here means the file says what it will actually do.
const MIN_DELAY: u16 = 2;

/// Writes composited frames to an animated GIF.
pub struct GifWriter {
    encoder: gif::Encoder<BufWriter<File>>,
    width: u16,
    height: u16,
    delay: u16,
    /// Reused across frames: a 1080p RGBA frame is 8 MB, and reallocating one
    /// per frame is pure churn for an encode that is already CPU-bound.
    rgba: Vec<u8>,
    frames: u64,
}

impl GifWriter {
    /// Opens a GIF for writing at a fixed frame rate.
    ///
    /// `fps` becomes a per-frame delay in centiseconds, which is the only unit
    /// GIF has. Rates that do not divide 100 — 30, 60 — are rounded, so the
    /// file runs slightly fast or slow; the editor only offers rates that
    /// divide cleanly for that reason.
    pub fn create(path: &Path, width: u32, height: u32, fps: u32) -> Result<Self> {
        if width == 0 || height == 0 {
            return Err(Error::EmptyDimensions { width, height });
        }

        // GIF counts pixels in 16 bits. Beyond that the header simply cannot
        // describe the image, so this is a refusal rather than a clamp.
        if width > u16::MAX as u32 || height > u16::MAX as u32 {
            return Err(Error::EmptyDimensions { width, height });
        }

        // Unlike `AVAssetWriter`, `File::create` truncates happily — but the
        // two outputs are removed on failure together, and leaving one path
        // that behaves differently is how a retry comes to append to a stale
        // file.
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| Error::CreateWriter {
                path: path.display().to_string(),
                reason: format!("could not replace the existing file: {e}"),
            })?;
        }

        let file = File::create(path).map_err(|e| Error::CreateWriter {
            path: path.display().to_string(),
            reason: e.to_string(),
        })?;

        let width = width as u16;
        let height = height as u16;

        // No global palette: every frame carries its own, because a screen
        // recording's colours change completely between a light document and a
        // dark terminal and one shared 256-entry table would band both.
        let mut encoder = gif::Encoder::new(BufWriter::new(file), width, height, &[])
            .map_err(|e| Error::Write(e.to_string()))?;

        encoder
            .set_repeat(gif::Repeat::Infinite)
            .map_err(|e| Error::Write(e.to_string()))?;

        Ok(Self {
            encoder,
            width,
            height,
            delay: delay_for(fps),
            rgba: Vec::new(),
            frames: 0,
        })
    }

    /// Quantises one composited frame and appends it.
    pub fn append(&mut self, image: &cv::PixelBuf) -> Result<()> {
        self.read_bgra(image)?;

        // `from_rgba_speed` runs NeuQuant over this frame alone and rewrites
        // the buffer in place as palette indices, which is why `rgba` is passed
        // mutably and cannot be shared with anything else.
        let mut frame =
            gif::Frame::from_rgba_speed(self.width, self.height, &mut self.rgba, QUANTISE_SPEED);
        frame.delay = self.delay;

        self.encoder
            .write_frame(&frame)
            .map_err(|e| Error::Write(e.to_string()))?;

        self.frames += 1;
        Ok(())
    }

    /// Flushes the trailer. Dropping without this leaves a truncated file.
    pub fn finish(self) -> Result<u64> {
        let frames = self.frames;
        // `gif::Encoder` writes the trailer in its own `Drop`, but the
        // `BufWriter` underneath it is flushed by *its* Drop, which runs after
        // — and a flush failure there has nowhere to be reported. Dropping in
        // a scope we control at least keeps the ordering explicit.
        drop(self.encoder);
        Ok(frames)
    }

    /// Copies a 32BGRA pixel buffer into `self.rgba` as tightly packed RGBA.
    ///
    /// The row stride is almost never `width * 4` — CoreVideo pads rows for
    /// alignment — so this cannot be a single memcpy, and reading the buffer as
    /// one flat block is how the picture comes out sheared.
    fn read_bgra(&mut self, image: &cv::PixelBuf) -> Result<()> {
        let width = self.width as usize;
        let height = self.height as usize;

        if image.width() < width || image.height() < height {
            return Err(Error::EmptyDimensions {
                width: image.width() as u32,
                height: image.height() as u32,
            });
        }

        self.rgba.clear();
        self.rgba.reserve(width * height * 4);

        // Cloned to get a mutable handle: locking is a mutation as far as cidre
        // is concerned, and the clone is a retain on the same buffer rather
        // than a copy of the pixels.
        let mut locked = image.retained();

        unsafe {
            locked
                .lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
                .result()
                .map_err(|e| Error::Write(format!("could not lock the frame: {e:?}")))?;

            let stride = locked.bytes_per_row();
            let base = locked.base_address().cast::<u8>();

            for y in 0..height {
                let row = base.add(y * stride);
                for x in 0..width {
                    let at = row.add(x * 4);
                    self.rgba.push(*at.add(2));
                    self.rgba.push(*at.add(1));
                    self.rgba.push(*at);
                    // Opaque regardless of what the compositor left in the
                    // alpha channel: GIF transparency is a single palette
                    // index, and a partially transparent frame quantises to
                    // hard-edged holes rather than to a blend.
                    self.rgba.push(255);
                }
            }

            locked
                .unlock_lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
                .result()
                .map_err(|e| Error::Write(format!("could not unlock the frame: {e:?}")))?;
        }

        Ok(())
    }
}

/// Frames per second to a GIF frame delay in centiseconds.
fn delay_for(fps: u32) -> u16 {
    if fps == 0 {
        return MIN_DELAY.max(10);
    }

    let centiseconds = (100.0 / fps as f64).round() as u16;
    centiseconds.max(MIN_DELAY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_rates_land_on_exact_delays() {
        // The rates the editor offers for GIF, chosen because they divide 100
        // and so play at the speed they were rendered at.
        assert_eq!(delay_for(10), 10);
        assert_eq!(delay_for(20), 5);
        assert_eq!(delay_for(25), 4);
    }

    #[test]
    fn a_rate_too_fast_to_express_is_clamped_not_rounded_to_zero() {
        // 200 fps rounds to a 0cs delay, which players read as "as fast as
        // possible" and clamp to a tenth of a second — five times slower than
        // the file claims rather than faster.
        assert_eq!(delay_for(200), MIN_DELAY);
        assert_eq!(delay_for(0), 10);
    }
}
