//! Where the index ends up in an exported file.
//!
//! A player can draw nothing until it has `moov` — the atom naming where every
//! sample is. Written last, a browser opening a share link has to find and
//! fetch the tail of the file before the first frame appears, which on a 20 MB
//! export is several seconds of blank player. Written first, it plays at once.
//!
//! Invisible in every other way: the file is valid, the same length and the
//! same pixels either way, and `ffprobe` on a local copy reports no difference.
//! Only somebody streaming it over a network can tell, which is exactly the
//! person who is not in the room.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use cidre::{arc, cv};
use prequel_encode::{VideoWriter, VideoWriterConfig};

const WIDTH: u32 = 320;
const HEIGHT: u32 = 240;
const FRAMES: u64 = 30;
const NS_PER_FRAME: u64 = 1_000_000_000 / 30;

fn frame(index: u64) -> arc::R<cv::PixelBuf> {
    let mut buf = cv::PixelBuf::new(
        WIDTH as usize,
        HEIGHT as usize,
        cv::PixelFormat::_32_BGRA,
        None,
    )
    .expect("allocate pixel buffer");

    unsafe {
        buf.lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("lock");

        let row = buf.bytes_per_row();
        let base = buf.base_address_mut().cast::<u8>();
        let phase = (index * 8) as u8;

        for y in 0..HEIGHT as usize {
            for x in 0..WIDTH as usize {
                let offset = y * row + x * 4;
                *base.add(offset) = phase;
                *base.add(offset + 1) = (x as u8).wrapping_add(phase);
                *base.add(offset + 2) = (y as u8).wrapping_sub(phase);
                *base.add(offset + 3) = 255;
            }
        }

        buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("unlock");
    }

    buf
}

/// The top-level atoms, in the order they appear in the file.
///
/// Walked by hand rather than with `ffprobe`: the order is the whole point and
/// `ffprobe` reports a file's contents, not its layout — it answers identically
/// for both, which is why this went unnoticed.
fn atoms(path: &Path) -> Vec<String> {
    let mut file = File::open(path).expect("open the written file");
    let length = file.metadata().expect("stat").len();
    let mut found = Vec::new();
    let mut offset = 0u64;

    while offset + 8 <= length {
        file.seek(SeekFrom::Start(offset)).expect("seek");

        let mut header = [0u8; 8];
        if file.read_exact(&mut header).is_err() {
            break;
        }

        let mut size = u32::from_be_bytes(header[0..4].try_into().unwrap()) as u64;
        let name = String::from_utf8_lossy(&header[4..8]).to_string();

        // A 32-bit size of 1 means the real one is the 64 bits that follow, which
        // is how `mdat` carries more than four gigabytes — and how it is written
        // here, so a walk that did not understand it would stop at the first atom.
        if size == 1 {
            let mut extended = [0u8; 8];
            file.read_exact(&mut extended).expect("64-bit atom size");
            size = u64::from_be_bytes(extended);
        }

        found.push(name);

        // Zero means "to the end of the file", and anything smaller than a
        // header would loop for ever.
        if size < 8 {
            break;
        }
        offset += size;
    }

    found
}

fn write(path: &PathBuf, config: VideoWriterConfig) {
    let _ = std::fs::remove_file(path);

    let mut writer = VideoWriter::create(path, &config).expect("create writer");
    for index in 0..FRAMES {
        assert!(
            writer
                .append(&frame(index), index * NS_PER_FRAME)
                .expect("append"),
            "the encoder should take every frame"
        );
    }
    writer.finish_at(FRAMES * NS_PER_FRAME).expect("finish");
}

fn position(atoms: &[String], name: &str) -> usize {
    atoms
        .iter()
        .position(|atom| atom == name)
        .unwrap_or_else(|| panic!("expected a {name} atom in {atoms:?}"))
}

#[test]
fn an_export_puts_its_index_before_its_samples() {
    let path = std::env::temp_dir().join("prequel-streamable.mp4");
    write(
        &path,
        VideoWriterConfig::new(WIDTH, HEIGHT).offline().for_streaming(),
    );

    let found = atoms(&path);
    let _ = std::fs::remove_file(&path);

    assert!(
        position(&found, "moov") < position(&found, "mdat"),
        "moov must come before mdat so a player can start without fetching the \
         tail of the file first — atoms were {found:?}"
    );
}

#[test]
fn a_recording_is_left_alone() {
    // A take is read from the disk it was written to, and the rewrite this
    // costs at `finish` buys that nothing. Pinned so the flag is not quietly
    // turned on everywhere later: stopping a capture is the one moment the app
    // cannot afford to be slow.
    let path = std::env::temp_dir().join("prequel-not-streamable.mp4");
    write(&path, VideoWriterConfig::new(WIDTH, HEIGHT).offline());

    let found = atoms(&path);
    let _ = std::fs::remove_file(&path);

    assert!(
        position(&found, "mdat") < position(&found, "moov"),
        "a file not asked to stream should keep the cheaper layout — atoms were {found:?}"
    );
}
