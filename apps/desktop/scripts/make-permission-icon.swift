// Draws the Input Monitoring row's icon for the permissions list.
//
// The other four icons in `resources/permissions/` are the ones System
// Settings shows beside each privacy category, so the row and the pane a user
// is sent to look like the same thing. Input Monitoring's is not reachable
// as a file on a current macOS — it lives in a private asset catalogue — so
// it is drawn here in the same manner: the category's plate, and the
// system's own `keyboard` symbol on it, at the size the others are.
//
// Swift for the reason `make-emoji-cursors.swift` is: AppKit draws SF Symbols
// and nothing else on the machine does. Run via `pnpm permission-icon`;
// output is committed.
import AppKit

let size = 128
let root = URL(fileURLWithPath: CommandLine.arguments[0])
  .deletingLastPathComponent()
  .deletingLastPathComponent()
let out = root.appendingPathComponent("resources/permissions/input.png")

let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
  // The plate. System Settings draws Input Monitoring on a dark slate
  // gradient; near enough to be recognised beside the pane it names.
  let plate = NSBezierPath(
    roundedRect: rect.insetBy(dx: 4, dy: 4),
    xRadius: CGFloat(size) * 0.22,
    yRadius: CGFloat(size) * 0.22
  )
  NSGradient(
    starting: NSColor(calibratedRed: 0.42, green: 0.45, blue: 0.50, alpha: 1),
    ending: NSColor(calibratedRed: 0.24, green: 0.26, blue: 0.30, alpha: 1)
  )!.draw(in: plate, angle: -90)

  // The symbol, in white, sized to the plate the way the others are.
  let config = NSImage.SymbolConfiguration(pointSize: CGFloat(size) * 0.42, weight: .medium)
  guard let symbol = NSImage(systemSymbolName: "keyboard", accessibilityDescription: nil)?
    .withSymbolConfiguration(config)
  else { return false }
  let tinted = NSImage(size: symbol.size, flipped: false) { symbolRect in
    symbol.draw(in: symbolRect)
    NSColor.white.set()
    symbolRect.fill(using: .sourceAtop)
    return true
  }
  let at = NSRect(
    x: (rect.width - tinted.size.width) / 2,
    y: (rect.height - tinted.size.height) / 2,
    width: tinted.size.width,
    height: tinted.size.height
  )
  tinted.draw(in: at)
  return true
}

guard let tiff = image.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiff),
  let png = bitmap.representation(using: .png, properties: [:])
else {
  fputs("could not encode the icon\n", stderr)
  exit(1)
}
try! png.write(to: out)
print("wrote \(out.path)")
