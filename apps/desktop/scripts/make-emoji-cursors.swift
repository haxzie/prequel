// Rasterises the emoji pointers into the PNGs the compositors draw.
//
// The sibling of `make-cursor.mjs`, which draws its arrows and hands by hand
// because they are a handful of paths and a fill colour. These are not: they
// are finished artwork with dozens of paths each, so they arrive as SVG and are
// rendered rather than reconstructed.
//
// Swift rather than a Node dependency, for the reason `make-dmg-background.swift`
// is Swift: `NSImage` reads SVG on macOS 13+, so this needs nothing installed —
// and the one SVG renderer that *was* on this machine, ImageMagick's internal
// MSVG, dropped most of the paths and produced a washed-out shape that still
// looked plausible on its own.
//
// Run via `pnpm cursor:emoji`; output is committed, so a normal build needs no
// image tooling. Reads `scripts/cursors/*.svg` and writes
// `resources/cursor-<id>.png` — the name `CURSOR_STYLES` refers to.
import AppKit

/// Drawn at this size, then scaled down at use. Matches `make-cursor.mjs`, and
/// is large enough that a pointer in a 4K frame is not resampled up.
let size = 128

let root = URL(fileURLWithPath: CommandLine.arguments[0])
  .deletingLastPathComponent()
  .deletingLastPathComponent()
let sources = root.appendingPathComponent("scripts/cursors")
let out = root.appendingPathComponent("resources")

let files = (try? FileManager.default.contentsOfDirectory(atPath: sources.path))?
  .filter { $0.hasSuffix(".svg") }
  .sorted() ?? []

guard !files.isEmpty else {
  FileHandle.standardError.write("no SVGs in \(sources.path)\n".data(using: .utf8)!)
  exit(1)
}

for file in files {
  let id = String(file.dropLast(4))
  let source = sources.appendingPathComponent(file)

  guard let image = NSImage(contentsOf: source) else {
    FileHandle.standardError.write("could not read \(file)\n".data(using: .utf8)!)
    exit(1)
  }

  guard
    let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
      colorSpaceName: .deviceRGB, bytesPerRow: size * 4, bitsPerPixel: 32)
  else { exit(1) }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  // The artwork is square and fills its own viewBox, so it is drawn to the full
  // square: any inset here would be a margin the hotspot then has to know about.
  NSGraphicsContext.current?.imageInterpolation = .high
  image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
  NSGraphicsContext.restoreGraphicsState()

  guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
  let target = out.appendingPathComponent("cursor-\(id).png")
  try png.write(to: target)
  print("wrote cursor-\(id).png")
}
