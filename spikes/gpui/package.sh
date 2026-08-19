#!/usr/bin/env bash
# Wraps the spike binary in a .app so it can be launched without a terminal.
#
# Not a packaging story — the real app is built by electron-builder. This exists
# so the spike can be *tried* the way the product is tried: double-clicked, on a
# real display, with nothing else in the way.
#
# Named so it cannot be mistaken for Prequel, and given no icon on purpose: a
# spike wearing the product's icon in the Dock is how you end up filing a bug
# against the wrong thing.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
name="Prequel GPUI Spike"
app="${1:-/Applications}/${name}.app"

export PATH="$HOME/.cargo/bin:$PATH"
cargo build --release --manifest-path "$here/Cargo.toml"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$here/target/release/gpui-spike" "$app/Contents/MacOS/gpui-spike"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>gpui-spike</string>
  <key>CFBundleIdentifier</key><string>com.prequel.gpui-spike</string>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.0.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <!-- Without this the window is drawn at 1x and scaled up, which would make a
       spike about render quality look terrible for a reason unrelated to it. -->
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Ad-hoc signature. A bare unsigned binary in a bundle is killed on launch on
# Apple Silicon — "is damaged" — rather than merely warned about.
codesign --force --sign - "$app" >/dev/null 2>&1 || echo "warning: could not sign; launch may be blocked"

echo "installed: $app"
