//! Compiles the libx264 shim and links the encoder.
//!
//! Static, not the dylib: an export must not depend on a Homebrew prefix
//! existing on the machine that runs the app, and a `.dylib` under
//! `/opt/homebrew` is not something a notarised bundle can load.

use std::path::{Path, PathBuf};

/// Where libx264 lives, in the order it is looked for. Homebrew's two prefixes
/// — Apple silicon and Intel — then MacPorts.
const PREFIXES: [&str; 3] = ["/opt/homebrew", "/usr/local", "/opt/local"];

fn main() {
    println!("cargo:rerun-if-changed=x264/shim.c");
    println!("cargo:rerun-if-changed=x264/shim.h");
    println!("cargo:rerun-if-env-changed=X264_PREFIX");

    let prefix = locate();
    let include = prefix.join("include");
    let lib = prefix.join("lib");

    cc::Build::new()
        .file("x264/shim.c")
        .include("x264")
        .include(&include)
        .opt_level(2)
        .warnings(true)
        .compile("prequel_x264_shim");

    println!("cargo:rustc-link-search=native={}", lib.display());
    println!("cargo:rustc-link-lib=static=x264");
}

/// The prefix that has both the header and the static library, or a message
/// that names what to install.
///
/// Both, not either: Homebrew's `x264` formula is the only one of the three
/// that ships `libx264.a`, and a prefix with just the header gets through the
/// compile and fails at the link with `ld: library not found for -lx264`, which
/// reads as a broken build rather than a missing package.
fn locate() -> PathBuf {
    if let Ok(prefix) = std::env::var("X264_PREFIX") {
        let prefix = PathBuf::from(prefix);
        if complete(&prefix) {
            return prefix;
        }
        panic!(
            "X264_PREFIX is set to {} but there is no include/x264.h and lib/libx264.a under it",
            prefix.display()
        );
    }

    for prefix in PREFIXES {
        let prefix = PathBuf::from(prefix);
        if complete(&prefix) {
            return prefix;
        }
    }

    panic!(
        "libx264 was not found under {}. Install it with `brew install x264`, \
         or point X264_PREFIX at a prefix holding include/x264.h and lib/libx264.a.",
        PREFIXES.join(", ")
    );
}

fn complete(prefix: &Path) -> bool {
    prefix.join("include/x264.h").exists() && prefix.join("lib/libx264.a").exists()
}
