//! The camera's person matte: segmentation → grayscale NV12 → `camera-matte.mp4`.
//!
//! Computed while recording rather than afterwards. The frames are already
//! decoded and in memory, the Neural Engine is idle during a capture, and a
//! small grayscale stream costs the encoder almost nothing — whereas a pass
//! over the finished `camera.mp4` is decode-bound and asks the user to wait a
//! minute for every ten of camera. Preview and export then only *read* the
//! matte, so removing the background in the editor is instant and reversible.
//!
//! The segmenter sits behind [`Segmenter`] so the model is a detail: Vision's
//! person segmentation today (nothing to ship, runs on the Neural Engine), a
//! bundled matting network later if edges need to be better.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, SyncSender, TrySendError, sync_channel};
use std::thread::JoinHandle;

use cidre::{arc, cf, cv, ns, objc, vn};
use prequel_encode::{VideoCodec, VideoWriter, VideoWriterConfig};
use prequel_session::MediaTime;

use crate::{Error, Result};

/// Anything that turns a camera frame into a person mask.
pub trait Segmenter {
    /// A mask for `frame`: one 8-bit channel, 255 where the person is, at
    /// whatever size the model works in. Nothing downstream lays out against
    /// that size — both rasterisers sample the mask with the picture's
    /// normalised coordinates.
    fn matte(&mut self, frame: &cv::PixelBuf) -> Result<arc::R<cv::PixelBuf>>;
}

/// Apple's person segmentation, via Vision.
pub struct VisionSegmenter {
    handler: arc::R<vn::SequenceRequestHandler>,
    request: arc::R<vn::GenPersonSegmentationRequest>,
    /// Built once: `perform` takes an array, and building one per frame is a
    /// needless allocation on a path that runs thirty times a second.
    requests: arc::R<ns::Array<vn::Request>>,
}

impl VisionSegmenter {
    pub fn new() -> Self {
        let mut request = vn::GenPersonSegmentationRequest::new();
        // Balanced rather than accurate: accurate costs several times more
        // per frame for edges the bubble's size never shows, and fast gives a
        // mask coarse enough that the outline visibly steps. The default
        // output format is one 8-bit component, which is what the copy into
        // the luma plane expects.
        request.set_quality_level(vn::GenPersonSegmentationRequestQualityLevel::Balanced);

        let base: &vn::Request = &request;
        let requests = ns::Array::from_slice(&[base]);

        Self {
            // The sequence handler, not the image one: it is the handler
            // Vision documents for consecutive frames of the same footage.
            handler: vn::SequenceRequestHandler::new(),
            request,
            requests,
        }
    }
}

impl Default for VisionSegmenter {
    fn default() -> Self {
        Self::new()
    }
}

impl Segmenter for VisionSegmenter {
    fn matte(&mut self, frame: &cv::PixelBuf) -> Result<arc::R<cv::PixelBuf>> {
        self.handler
            .perform_on_cv_pixel_buf(&self.requests, frame)
            .map_err(|e| Error::Matte(format!("{e:?}")))?;

        let results = self
            .request
            .results()
            .ok_or_else(|| Error::Matte("segmentation produced no result".to_owned()))?;
        let observation = results
            .first()
            .ok_or_else(|| Error::Matte("segmentation produced no mask".to_owned()))?;

        Ok(observation.pixel_buffer().retained())
    }
}

/// What the matte worker wrote, for the manifest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MatteSummary {
    pub frames: u64,
    /// Camera frames with no mask of their own: offered while the segmenter
    /// was still busy with the previous one, refused by the encoder, or
    /// failed by the segmenter. The previous mask stands in for each.
    pub dropped: u64,
    pub width: u32,
    pub height: u32,
}

/// One camera frame waiting to be segmented.
struct Job {
    frame: arc::R<cv::PixelBuf>,
    pts: MediaTime,
}

// SAFETY: a `CVPixelBuffer` is reference-counted atomically and is not touched
// by the delegate once it has been sent; AVFoundation itself delivers these
// buffers across queues.
unsafe impl Send for Job {}

/// Segments camera frames on its own thread and writes the masks to a file.
///
/// Its own thread rather than the delegate queue, because the callback must
/// never wait on the segmenter: a matte frame that is skipped is invisible —
/// the previous mask holds for 33 ms — but a camera frame that is dropped
/// is a stutter in the recording. Hence a bounded channel and `try_send`:
/// when the segmenter is behind, the frame is skipped, and at most a couple
/// of capture buffers are ever retained. Holding more would starve
/// `AVCaptureVideoDataOutput`, whose pool is small.
pub struct MatteWorker {
    tx: Option<SyncSender<Job>>,
    /// Frames `offer` could not queue. Counted here rather than on the worker
    /// because the worker never saw them.
    skipped: u64,
    thread: Option<JoinHandle<Option<MatteSummary>>>,
}

/// How many frames may wait for the segmenter.
///
/// Two: one being processed and one queued is enough to absorb a slow frame
/// without ever retaining more than three capture buffers.
const QUEUE_DEPTH: usize = 2;

impl MatteWorker {
    /// Starts the worker; `make` builds the segmenter on the worker's own
    /// thread, so it needs to be neither `Send` nor built before the thread.
    pub fn spawn(
        path: PathBuf,
        make: impl FnOnce() -> Box<dyn Segmenter> + Send + 'static,
    ) -> Result<Self> {
        let (tx, rx) = sync_channel(QUEUE_DEPTH);
        let thread = std::thread::Builder::new()
            .name("prequel-matte".to_owned())
            .spawn(move || run(rx, &path, make))
            .map_err(|e| Error::Matte(format!("could not start the matte thread: {e}")))?;

        Ok(Self {
            tx: Some(tx),
            skipped: 0,
            thread: Some(thread),
        })
    }

    /// Queues a frame if the segmenter has room, otherwise skips it.
    ///
    /// Returns `false` once the worker has given up, so the caller can stop
    /// offering.
    pub fn offer(&mut self, frame: &cv::PixelBuf, pts: MediaTime) -> bool {
        let Some(tx) = self.tx.as_ref() else {
            return false;
        };
        match tx.try_send(Job {
            frame: frame.retained(),
            pts,
        }) {
            Ok(()) => true,
            Err(TrySendError::Full(_)) => {
                self.skipped += 1;
                true
            }
            Err(TrySendError::Disconnected(_)) => {
                self.tx = None;
                false
            }
        }
    }

    /// Closes the queue, waits for the last frame, and finishes the file.
    ///
    /// `None` when nothing was written — the segmenter was unavailable, or the
    /// recording ended before the first mask. There is no file in that case.
    pub fn stop(mut self) -> Option<MatteSummary> {
        // Dropping the sender is what ends the worker's loop.
        drop(self.tx.take());
        let thread = self.thread.take()?;
        match thread.join() {
            Ok(Some(mut summary)) => {
                summary.dropped += self.skipped;
                Some(summary)
            }
            Ok(None) => None,
            Err(_) => {
                tracing::warn!("the matte thread panicked; the camera has no matte");
                None
            }
        }
    }
}

/// The file being written, opened on the first mask.
struct Sink {
    pool: arc::R<cv::PixelBufPool>,
    writer: VideoWriter,
    width: u32,
    height: u32,
}

impl Sink {
    /// Deferred until the first mask, because only the model knows the size
    /// it works in. The file is written at that size rather than the
    /// camera's: it keeps the sidecar tiny, and the shader's normalised
    /// sampling makes the mismatch free — an upscale here would cost a full
    /// frame's worth of work per mask for nothing.
    fn open(path: &Path, mask: &cv::PixelBuf, origin: MediaTime) -> Result<Self> {
        // Even, because the writer rounds down to even and would otherwise
        // rescale every mask by a pixel.
        let width = (mask.width() as u32) & !1;
        let height = (mask.height() as u32) & !1;

        let attrs = cf::DictionaryOf::with_keys_values(
            &[
                cv::pixel_buffer::keys::width(),
                cv::pixel_buffer::keys::height(),
                cv::pixel_buffer::keys::pixel_format(),
                cv::pixel_buffer::keys::io_surf_props(),
            ],
            &[
                cf::Number::from_i32(width as i32).as_type_ref(),
                cf::Number::from_i32(height as i32).as_type_ref(),
                cf::Number::from_i32(cv::PixelFormat::_420V.0 as i32).as_type_ref(),
                // IOSurface-backed, so VideoToolbox takes the buffer as it is
                // instead of copying it into one it can reach.
                cf::DictionaryOf::<cf::String, cf::Type>::with_keys_values(&[], &[]).as_type_ref(),
            ],
        );
        let pool = cv::PixelBufPool::new(None, Some(attrs.as_ref()))
            .map_err(|e| Error::Matte(format!("could not create a buffer pool: {e:?}")))?;

        let mut writer = VideoWriter::create(
            path,
            &VideoWriterConfig {
                width,
                height,
                codec: VideoCodec::H264,
                // Live, like the camera: a saturated encoder drops the mask
                // rather than stalling the segmenter behind it.
                realtime: true,
                audio: None,
            },
        )?;
        // The matte's zero must be the camera's zero, not its own first
        // mask's, or the two files disagree by however long the segmenter
        // took to warm up.
        writer.start_session_at(origin);

        Ok(Self {
            pool,
            writer,
            width,
            height,
        })
    }
}

fn run(
    rx: Receiver<Job>,
    path: &Path,
    make: impl FnOnce() -> Box<dyn Segmenter>,
) -> Option<MatteSummary> {
    let mut segmenter = make();
    let mut sink: Option<Sink> = None;
    let mut origin: Option<MediaTime> = None;
    let mut dropped = 0u64;

    for job in rx {
        // The first frame offered is the camera's first frame — the queue is
        // empty at that point — so its pts is the origin both files share.
        let origin = *origin.get_or_insert(job.pts);

        // A pool per frame: Vision's result array is autoreleased, and a
        // plain thread has no pool, so without this every frame leaks it.
        let step = objc::ar_pool(|| step(segmenter.as_mut(), &mut sink, path, origin, &job));

        match step {
            Ok(true) => {}
            Ok(false) => dropped += 1,
            Err(reason) if sink.is_none() => {
                // Nothing has been written, so this is the model refusing the
                // camera outright rather than one bad frame. Give up quietly:
                // the camera records as it always has, just without a matte.
                tracing::warn!(
                    "person segmentation is unavailable ({reason}); the camera records without a matte"
                );
                return None;
            }
            Err(reason) => {
                tracing::debug!("a camera frame has no mask: {reason}");
                dropped += 1;
            }
        }
    }

    let sink = sink?;
    match sink.writer.finish() {
        Ok(summary) => Some(MatteSummary {
            frames: summary.frames,
            dropped,
            width: sink.width,
            height: sink.height,
        }),
        Err(e) => {
            tracing::warn!("the camera matte could not be finished: {e}");
            None
        }
    }
}

/// One frame: segment, convert, append. `Ok(false)` when the encoder was busy.
fn step(
    segmenter: &mut dyn Segmenter,
    sink: &mut Option<Sink>,
    path: &Path,
    origin: MediaTime,
    job: &Job,
) -> std::result::Result<bool, String> {
    let mut mask = segmenter.matte(&job.frame).map_err(|e| e.to_string())?;

    let sink = match sink {
        Some(sink) => sink,
        None => sink.insert(Sink::open(path, &mask, origin).map_err(|e| e.to_string())?),
    };

    let mut nv12 = sink
        .pool
        .pixel_buf()
        .map_err(|e| format!("could not take a buffer from the pool: {e:?}"))?;
    copy_mask_into_luma(&mut mask, &mut nv12).map_err(|e| e.to_string())?;

    sink.writer
        .append(&nv12, job.pts)
        .map_err(|e| e.to_string())
}

/// Writes a one-component mask into the luma plane of an NV12 buffer, with
/// neutral chroma, so a video encoder can take it.
///
/// Row by row rather than one `memcpy`: CoreVideo pads rows to its own
/// alignment on both sides, and the two strides differ, so a flat copy shears
/// the mask into diagonal stripes. Chroma is set to 128, the neutral value —
/// anything else tints a stream whose colour nothing ever reads, and a
/// decoder's clamping of it can bleed into the luma.
pub(crate) fn copy_mask_into_luma(mask: &mut cv::PixelBuf, nv12: &mut cv::PixelBuf) -> Result<()> {
    use cv::pixel_buffer::LockFlags;

    // Lock the mask read-only: Vision owns it, and the observation may hand
    // the same buffer to a later request.
    unsafe {
        mask.lock_base_addr(LockFlags::READ_ONLY)
            .result()
            .map_err(|e| Error::Matte(format!("could not lock the mask: {e:?}")))?;
    }
    let locked = unsafe { nv12.lock_base_addr(LockFlags::DEFAULT).result() };
    if let Err(e) = locked {
        unsafe {
            let _ = mask.unlock_lock_base_addr(LockFlags::READ_ONLY);
        }
        return Err(Error::Matte(format!("could not lock the buffer: {e:?}")));
    }

    let rows = mask.height().min(nv12.plane_height(0));
    let cols = mask.width().min(nv12.plane_width(0));
    let src_stride = mask.bytes_per_row();
    let dst_stride = nv12.plane_bytes_per_row(0);
    let chroma_len = nv12.plane_bytes_per_row(1) * nv12.plane_height(1);

    // SAFETY: both buffers are locked for the duration; every offset stays
    // inside the row it addresses because `cols` is the smaller width and the
    // strides are each buffer's own.
    unsafe {
        let src = mask.base_address().cast::<u8>();
        let luma = nv12.plane_base_address(0).cast_mut();
        for y in 0..rows {
            std::ptr::copy_nonoverlapping(src.add(y * src_stride), luma.add(y * dst_stride), cols);
        }
        let chroma = nv12.plane_base_address(1).cast_mut();
        std::ptr::write_bytes(chroma, 128, chroma_len);

        let _ = nv12.unlock_lock_base_addr(LockFlags::DEFAULT);
        let _ = mask.unlock_lock_base_addr(LockFlags::READ_ONLY);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A one-component buffer with a pattern that tells rows and columns apart.
    fn mask(width: usize, height: usize) -> arc::R<cv::PixelBuf> {
        let mut buf = cv::PixelBuf::new(width, height, cv::PixelFormat::ONE_COMPONENT_8, None)
            .expect("allocate a mask");
        unsafe {
            buf.lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
                .result()
                .expect("lock");
            let stride = buf.bytes_per_row();
            let base = buf.base_address_mut().cast::<u8>();
            for y in 0..height {
                for x in 0..width {
                    *base.add(y * stride + x) = pattern(x, y);
                }
            }
            buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
                .result()
                .expect("unlock");
        }
        buf
    }

    fn pattern(x: usize, y: usize) -> u8 {
        ((x * 7 + y * 13) % 251) as u8
    }

    #[test]
    fn lands_every_mask_pixel_on_its_own_luma_pixel() {
        // A width CoreVideo pads: the bug this guards against only exists when
        // the strides differ from the widths, so make sure they do.
        let (width, height) = (100, 6);
        let mut mask = mask(width, height);
        assert!(
            mask.bytes_per_row() > width,
            "CoreVideo did not pad the mask; the test cannot see the bug"
        );

        let mut nv12 = cv::PixelBuf::new(width, height, cv::PixelFormat::_420V, None)
            .expect("allocate an NV12 buffer");
        copy_mask_into_luma(&mut mask, &mut nv12).expect("copy");

        unsafe {
            nv12.lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
                .result()
                .expect("lock");
            let stride = nv12.plane_bytes_per_row(0);
            let luma = nv12.plane_base_address(0);
            for y in 0..height {
                for x in 0..width {
                    assert_eq!(
                        *luma.add(y * stride + x),
                        pattern(x, y),
                        "luma differs from the mask at ({x}, {y})"
                    );
                }
            }
            let chroma = nv12.plane_base_address(1);
            let chroma_len = nv12.plane_bytes_per_row(1) * nv12.plane_height(1);
            for i in 0..chroma_len {
                assert_eq!(*chroma.add(i), 128, "chroma is not neutral at byte {i}");
            }
            nv12.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
                .result()
                .expect("unlock");
        }
    }

    #[test]
    fn vision_answers_a_frame_with_a_one_component_mask() {
        // No camera, no grant, no person: a blank frame still has to come
        // back as a mask in the format the luma copy expects. This is the
        // wiring test — the quality of the mask needs a face in front of a
        // real camera, which the packaged build is for.
        let frame =
            cv::PixelBuf::new(640, 360, cv::PixelFormat::_420V, None).expect("allocate a frame");
        let mut segmenter = VisionSegmenter::new();
        let mask = objc::ar_pool(|| segmenter.matte(&frame).expect("segment a blank frame"));

        assert_eq!(mask.pixel_format(), cv::PixelFormat::ONE_COMPONENT_8);
        assert!(mask.width() > 0 && mask.height() > 0, "an empty mask");
        assert!(!mask.is_planar(), "a one-component buffer has no planes");

        // And it converts and encodes: the whole worker path, minus the
        // camera.
        let mut nv12 = cv::PixelBuf::new(
            mask.width() & !1,
            mask.height() & !1,
            cv::PixelFormat::_420V,
            None,
        )
        .expect("allocate an NV12 buffer");
        let mut mask = mask;
        copy_mask_into_luma(&mut mask, &mut nv12).expect("copy");
    }

    #[test]
    fn a_mask_larger_than_the_buffer_is_clipped_rather_than_overrun() {
        // An odd-sized mask goes into an even-sized buffer; the last column
        // and row are dropped, and nothing is written past either plane.
        let mut mask = mask(33, 17);
        let mut nv12 = cv::PixelBuf::new(32, 16, cv::PixelFormat::_420V, None)
            .expect("allocate an NV12 buffer");
        copy_mask_into_luma(&mut mask, &mut nv12).expect("copy");

        unsafe {
            nv12.lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
                .result()
                .expect("lock");
            let stride = nv12.plane_bytes_per_row(0);
            let luma = nv12.plane_base_address(0);
            assert_eq!(*luma.add(15 * stride + 31), pattern(31, 15));
            nv12.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
                .result()
                .expect("unlock");
        }
    }
}
