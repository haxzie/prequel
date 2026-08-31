fn main() {
    napi_build::setup();

    // The Swift runtime, for `prequel-speech`'s side of the addon.
    //
    // Everything Swift links is referenced by absolute path out of the dyld
    // shared cache except one: `libswift_Concurrency.dylib` comes through as
    // `@rpath/...`, because swiftc emits the back-deployment reference whenever
    // the deployment target could predate the concurrency runtime shipping in
    // the OS. Without a search path the addon builds, links, passes every Rust
    // test — and then fails to `dlopen` inside Electron with "Library not
    // loaded", which in a packaged build is an app that cannot record.
    //
    // It has to be here rather than in `prequel-speech/build.rs`, where the
    // Swift actually lives: `cargo:rustc-link-arg` applies to the crate that
    // emits it and does not reach a dependent. The speech crate's own test
    // binaries link fine from its copy, which is exactly why this was invisible
    // until the `.node` was loaded.
    println!("cargo:rustc-link-arg-cdylib=-Wl,-rpath,/usr/lib/swift");
}
