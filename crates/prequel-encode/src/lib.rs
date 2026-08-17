//! Hardware video encoding to MP4, and software encoding to GIF.
//!
//! Uses `AVAssetWriter` rather than driving `VTCompressionSession` by hand.
//! The writer sits on VideoToolbox for the actual encode — so this is still
//! hardware H.264/HEVC on Apple Silicon — but it also handles MP4 muxing,
//! interleaving and moov-atom placement, which is a meaningful amount of
//! fiddly work to get right for no benefit.
//!
//! GIF is the exception and is done on the CPU: it is a palette format with LZW
//! compression, which no Apple encoder produces. See [`GifWriter`].

mod audio;
mod gif;
mod probe;
mod time;
mod video;

pub use audio::{AudioWriter, AudioWriterConfig, AudioWriterSummary};
pub use gif::GifWriter;
pub use probe::{TrackProbe, probe_file};
pub use time::{host_nanos, host_now};
pub use video::{VideoCodec, VideoWriter, VideoWriterConfig, VideoWriterSummary};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("could not create a writer for {path}: {reason}")]
    CreateWriter { path: String, reason: String },

    #[error("AVAssetWriter rejected the configuration: {0}")]
    Configuration(String),

    #[error("AVAssetWriter failed while writing: {0}")]
    Write(String),

    #[error("encoder is not accepting samples yet")]
    NotReady,

    #[error("the frame carried no image buffer")]
    NoImageBuffer,

    #[error("output dimensions must be non-zero, got {width}×{height}")]
    EmptyDimensions { width: u32, height: u32 },
}
