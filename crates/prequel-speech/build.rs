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

fn main() {
    let source = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("swift")
        .join("speech.swift");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let library = out.join("libprequelspeech.a");

    println!("cargo:rerun-if-changed={}", source.display());

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
