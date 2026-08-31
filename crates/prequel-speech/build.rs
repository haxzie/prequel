//! Compiles `swift/speech.swift` into a static library and links it in.
//!
//! `swiftc` rather than a Swift package: there is one file, it has no
//! dependencies beyond the SDK, and a `Package.swift` would put a second build
//! system in a tree that has two already.
//!
//! Nothing of the Swift runtime is vendored. It has been ABI-stable and shipped
//! inside macOS since 10.14.4, so the library links against the copy in
//! `/usr/lib/swift` and finds it there at runtime — which is also why the
//! deployment target below can be lower than the SDK this is built with.
use std::{env, path::PathBuf, process::Command};

/// The oldest macOS the app runs on. Everything newer is behind `#available`.
const DEPLOYMENT_TARGET: &str = "arm64-apple-macos14.0";

/// The oldest SDK that can *compile* this, which is not the same thing.
///
/// `SpeechAnalyzer` arrived in macOS 26. `if #available` gates it at runtime,
/// but the type has to exist in the SDK for the file to compile at all.
const REQUIRED_SDK_MAJOR: u32 = 26;

/// Stops with something worth reading when the selected Xcode is too old.
///
/// Without this the failure is thirty lines of "cannot find 'SpeechAnalyzer' in
/// scope", which names a symbol rather than the problem — and the problem is
/// never the code. It is what `xcode-select` points at: CI defaulted to Xcode
/// 16.4 and the build was red for two commits before anyone read far enough
/// down the log to see why.
fn require_modern_sdk() {
    let Ok(out) = Command::new("xcrun")
        .args(["--sdk", "macosx", "--show-sdk-version"])
        .output()
    else {
        // No `xcrun` at all is a machine without the command line tools, and
        // `swiftc` below will say so more precisely than this could.
        return;
    };

    let version = String::from_utf8_lossy(&out.stdout);
    let major: u32 = version
        .trim()
        .split('.')
        .next()
        .and_then(|part| part.parse().ok())
        .unwrap_or(0);

    // Unparseable is not a reason to refuse to build: an SDK version this does
    // not recognise is likelier to be newer than older.
    if major != 0 && major < REQUIRED_SDK_MAJOR {
        panic!(
            "prequel-speech needs the macOS {REQUIRED_SDK_MAJOR} SDK or newer, and the selected \
             Xcode has {}. `SpeechAnalyzer` does not exist before then, so `speech.swift` cannot \
             compile against it — the app still runs on macOS 14, because the analyzer is behind \
             `if #available`. Point `xcode-select` at a newer Xcode, or set DEVELOPER_DIR.",
            version.trim()
        );
    }
}

fn main() {
    let source = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("swift")
        .join("speech.swift");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let library = out.join("libprequelspeech.a");

    println!("cargo:rerun-if-changed={}", source.display());

    require_modern_sdk();

    let status = Command::new("swiftc")
        .args(["-emit-library", "-static", "-O", "-parse-as-library"])
        .args(["-target", DEPLOYMENT_TARGET])
        // Swift 6 sends this file's `@_cdecl` entry points concurrency errors
        // it cannot see through — the callbacks are C function pointers, and
        // the semaphore bridge is exactly the thing strict checking forbids.
        // The bridge is the point, so the mode is the one that matches it.
        .args(["-swift-version", "5"])
        .arg("-o")
        .arg(&library)
        .arg(&source)
        .status()
        .expect("swiftc is part of the Xcode command line tools and has to be on PATH");

    assert!(status.success(), "swiftc failed to build speech.swift");

    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=prequelspeech");

    // The Swift standard library and concurrency runtime, from the OS copy.
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    for framework in ["Speech", "AVFAudio", "AVFoundation", "Foundation", "CoreMedia"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}
