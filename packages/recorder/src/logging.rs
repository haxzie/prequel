//! Routing the Rust side's diagnostics into the app's log file.
//!
//! Every crate here uses `tracing`, and without a subscriber installed all of
//! it is discarded — which is why an export could skip a background image and
//! say so to nobody. A packaged Electron app has no console either, so stderr
//! is no better: the only place worth writing is the file the shell already
//! keeps.
//!
//! The path comes from JavaScript rather than being derived here, so both sides
//! write to exactly one file and neither has to agree on how to find it.

use std::fs::OpenOptions;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Opens the log fresh for each write.
///
/// Slower than holding the handle, and deliberately so: the shell appends to
/// the same file from JavaScript, and two long-lived handles with independent
/// offsets would interleave into nonsense. Diagnostics are rare enough that the
/// open costs nothing worth saving.
struct Appender(PathBuf);

impl io::Write for Appender {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.0)
            .and_then(|mut file| io::Write::write(&mut file, buf))
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct MakeAppender(PathBuf);

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for MakeAppender {
    type Writer = Appender;

    fn make_writer(&'a self) -> Self::Writer {
        Appender(self.0.clone())
    }
}

static INSTALLED: Mutex<bool> = Mutex::new(false);

/// Points the Rust logs at a file. Safe to call more than once.
#[napi]
pub fn set_log_file(path: String) -> Result<()> {
    let mut installed = INSTALLED
        .lock()
        .map_err(|_| Error::from_reason("LOG_POISONED: the logging lock is poisoned"))?;

    // A global subscriber can only be set once; a second call is a no-op rather
    // than an error, because the shell may reasonably call this on every start.
    if *installed {
        return Ok(());
    }

    let result = tracing_subscriber::fmt()
        .with_writer(MakeAppender(PathBuf::from(path)))
        // No colour: the output is a file, and escape codes in it are noise.
        .with_ansi(false)
        .with_target(true)
        .try_init();

    if result.is_ok() {
        *installed = true;
    }

    Ok(())
}
