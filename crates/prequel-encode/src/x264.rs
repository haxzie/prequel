//! H.264 on the CPU, through libx264.
//!
//! Not instead of VideoToolbox everywhere — the recorder still encodes on the
//! media engine, where the picture arrives already on the GPU and the CPU is
//! wanted for the app being recorded. This is for the *export*, where the
//! measurement goes the other way round and by a long way. On an M4 Pro, 300
//! frames of 1080p60 screen content:
//!
//! ```text
//! videotoolbox    4.12 ms/frame   2.22 MB
//! x264 veryfast   0.79 ms/frame   0.42 MB
//! ```
//!
//! Five times quicker and five times smaller, from the same frames. Screen
//! content is flat regions and hard edges, which is where a CPU encoder's
//! decisions pay and where the hardware's rate control spends bits on
//! stillness. `measures_the_encoder_ceiling` is that table, and
//! `prequel_render::export::StageTimes` is what it does to an export.
//!
//! Input is NV12 and nothing else, because that is what the compositor writes
//! straight out of Metal. Handing x264 packed BGRA and letting it convert would
//! put a 1.5ms colour conversion on the CPU and give the whole win back.

use std::ffi::{CString, c_char};

use crate::{Error, Result};

/// The two planes of one NV12 frame, borrowed from wherever they live — in
/// practice a locked `cv::PixelBuf` the GPU has just written.
#[derive(Debug, Clone, Copy)]
pub struct Nv12<'a> {
    pub y: &'a [u8],
    pub y_stride: usize,
    /// Cb and Cr interleaved, at half the width and half the height.
    pub uv: &'a [u8],
    pub uv_stride: usize,
}

/// One encoded access unit. Length-prefixed, so it goes into a `CMBlockBuffer`
/// as it is.
///
/// Borrowed from the encoder rather than copied: libx264's contract is that the
/// payload is invalidated by the next `encode`, and the borrow is what makes
/// that a compile error rather than a torn frame.
#[derive(Debug)]
pub struct Sample<'a> {
    pub payload: &'a [u8],
    pub pts: i64,
    pub dts: i64,
    pub keyframe: bool,
}

/// How hard x264 is asked to work.
///
/// `Ultrafast` is the fastest and still writes less than half what the hardware
/// does; `Superfast` is around 40% slower again for a file a third the size.
/// Named rather than taking an arbitrary string so an unknown preset cannot
/// reach `x264_param_default_preset` and fail at open time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Preset {
    #[default]
    Ultrafast,
    Superfast,
    Veryfast,
    Faster,
}

impl Preset {
    fn name(self) -> &'static str {
        match self {
            Self::Ultrafast => "ultrafast",
            Self::Superfast => "superfast",
            Self::Veryfast => "veryfast",
            Self::Faster => "faster",
        }
    }
}

/// The constant rate factor every export is encoded at.
///
/// 20 rather than x264's default 23: this is the last encode of a screen
/// recording that is going straight to someone else, and text that has been
/// through one generation of 23 shows it. At 20 the file is still well under
/// what the hardware encoder wrote at its own default.
pub const DEFAULT_CRF: f32 = 20.0;

/// The preset every export uses.
///
/// `Veryfast` rather than `Ultrafast`, measured: 0.79ms a frame against 0.61ms,
/// for a file of 0.42MB against 1.20MB on the same 300 frames of 1080p screen
/// content. Three times smaller for a fifth more time — and that time is free,
/// because the encoder is not what the export waits on. The GPU composite is,
/// at around 1.1ms a frame, and the encoder runs alongside it.
///
/// Which also says when to revisit this: if the composite ever gets quicker
/// than the encode, the preset is the first thing to trade back.
pub const PRESET: Preset = Preset::Veryfast;

/// How many threads libx264 is given.
///
/// Half the cores rather than x264's own default of one and a half times them,
/// and it costs nothing: measured at 1080p on screen content, four, six and
/// twelve threads all land within noise of each other, because the export is
/// bounded by the GPU composite and the encoder only has to keep up rather than
/// win. So the machine is left with something to do other than this — an export
/// runs while the person who asked for it carries on working.
///
/// Worth re-measuring if the composite ever gets quicker. On deliberately hard
/// content, where the encoder *was* the wall, the same sweep ran from 7.8ms a
/// frame at two threads to 2.7ms at twelve.
pub fn threads() -> u32 {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);
    (cores / 2).max(2)
}

#[derive(Debug)]
pub struct X264 {
    inner: *mut ffi::PqX264,
}

/// Carries a CoreFoundation-ish handle across a thread boundary.
///
/// `arc::R` is not `Send`, and for most of what cidre wraps that is right.
/// These two are the exception: a `CVPixelBuffer` and a `CMSampleBuffer` are
/// immutable once written and reference-counted atomically, and moving one onto
/// the encoder thread is what lets the GPU compose the next frame while this
/// one is being encoded. Nothing here is *shared* across threads — ownership
/// moves and the sender keeps no copy.
pub struct Moved<T>(pub T);

// Safety: see above. Ownership moves; no handle is touched from two threads.
unsafe impl<T> Send for Moved<T> {}

// The encoder is owned by whoever holds it and is never touched from two places
// at once. x264's own threads live behind `x264_encoder_encode`.
unsafe impl Send for X264 {}

impl X264 {
    pub fn open(
        width: u32,
        height: u32,
        fps_num: u32,
        fps_den: u32,
        preset: Preset,
        crf: f32,
        threads: u32,
    ) -> Result<Self> {
        // Even dimensions, for the same reason `VideoWriterConfig::even` exists:
        // 4:2:0 chroma has no half pixel to put an odd row in.
        if width == 0 || height == 0 || width % 2 == 1 || height % 2 == 1 {
            return Err(Error::EmptyDimensions { width, height });
        }

        let name = CString::new(preset.name()).expect("a preset name holds no nul");
        let mut error = [0 as c_char; 256];

        let inner = unsafe {
            ffi::pq_x264_open(
                width as i32,
                height as i32,
                fps_num as i32,
                fps_den as i32,
                name.as_ptr(),
                crf,
                threads as i32,
                error.as_mut_ptr(),
                error.len() as i32,
            )
        };

        if inner.is_null() {
            let reason = unsafe { std::ffi::CStr::from_ptr(error.as_ptr()) }
                .to_string_lossy()
                .into_owned();
            return Err(Error::Configuration(format!("libx264: {reason}")));
        }

        Ok(Self { inner })
    }

    /// The SPS and PPS, for the format description the muxer needs before it
    /// will take a sample.
    pub fn parameter_sets(&mut self) -> Result<(&[u8], &[u8])> {
        let mut sps = std::ptr::null();
        let mut sps_len = 0i32;
        let mut pps = std::ptr::null();
        let mut pps_len = 0i32;

        let ok = unsafe {
            ffi::pq_x264_headers(self.inner, &mut sps, &mut sps_len, &mut pps, &mut pps_len)
        };
        if ok != 0 {
            return Err(Error::Configuration(
                "libx264 produced no parameter sets".to_owned(),
            ));
        }

        Ok(unsafe {
            (
                std::slice::from_raw_parts(sps, sps_len as usize),
                std::slice::from_raw_parts(pps, pps_len as usize),
            )
        })
    }

    /// Feeds one frame. `None` means the encoder is still filling its lookahead
    /// and has nothing to give back yet, which is normal for the first few
    /// frames of every export — not a dropped frame. [`Self::flush`] gets them
    /// back at the end.
    pub fn encode(&mut self, frame: Nv12<'_>, pts: i64) -> Result<Option<Sample<'_>>> {
        let mut out = ffi::PqX264Sample::default();
        let took = unsafe {
            ffi::pq_x264_encode(
                self.inner,
                frame.y.as_ptr(),
                frame.y_stride as i32,
                frame.uv.as_ptr(),
                frame.uv_stride as i32,
                pts,
                &mut out,
            )
        };
        self.result(took, out)
    }

    /// Drains what the lookahead is still holding, one sample a call, until it
    /// answers `None`.
    ///
    /// Keeps asking across an empty answer rather than stopping at one, because
    /// libx264 gives empty answers with frames still in hand — see the comment
    /// on `pq_x264_flush`. `None` here means the encoder is genuinely empty.
    pub fn flush(&mut self) -> Result<Option<Sample<'_>>> {
        loop {
            let mut out = ffi::PqX264Sample::default();
            let took = unsafe { ffi::pq_x264_flush(self.inner, &mut out) };
            if took == 2 {
                continue;
            }
            // Borrowed from `self`, so the match has to be the tail of the
            // function rather than a value carried out of the loop.
            return self.result(took, out);
        }
    }

    fn result(&mut self, took: i32, out: ffi::PqX264Sample) -> Result<Option<Sample<'_>>> {
        match took {
            0 => Ok(None),
            1 => Ok(Some(Sample {
                payload: unsafe {
                    std::slice::from_raw_parts(out.payload, out.length as usize)
                },
                pts: out.pts,
                dts: out.dts,
                keyframe: out.keyframe != 0,
            })),
            _ => Err(Error::Write("libx264 refused a frame".to_owned())),
        }
    }
}

impl Drop for X264 {
    fn drop(&mut self) {
        unsafe { ffi::pq_x264_close(self.inner) };
    }
}

mod ffi {
    use std::ffi::c_char;

    #[repr(C)]
    pub struct PqX264 {
        _opaque: [u8; 0],
    }

    #[repr(C)]
    pub struct PqX264Sample {
        pub payload: *const u8,
        pub length: i32,
        pub pts: i64,
        pub dts: i64,
        pub keyframe: i32,
    }

    impl Default for PqX264Sample {
        fn default() -> Self {
            Self {
                payload: std::ptr::null(),
                length: 0,
                pts: 0,
                dts: 0,
                keyframe: 0,
            }
        }
    }

    unsafe extern "C" {
        pub fn pq_x264_open(
            width: i32,
            height: i32,
            fps_num: i32,
            fps_den: i32,
            preset: *const c_char,
            crf: f32,
            threads: i32,
            error: *mut c_char,
            error_len: i32,
        ) -> *mut PqX264;

        pub fn pq_x264_headers(
            enc: *mut PqX264,
            sps: *mut *const u8,
            sps_len: *mut i32,
            pps: *mut *const u8,
            pps_len: *mut i32,
        ) -> i32;

        pub fn pq_x264_encode(
            enc: *mut PqX264,
            y: *const u8,
            y_stride: i32,
            uv: *const u8,
            uv_stride: i32,
            pts: i64,
            out: *mut PqX264Sample,
        ) -> i32;

        pub fn pq_x264_flush(enc: *mut PqX264, out: *mut PqX264Sample) -> i32;

        pub fn pq_x264_close(enc: *mut PqX264);
    }
}
