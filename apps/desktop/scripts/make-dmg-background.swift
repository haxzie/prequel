// Builds the disk image's background from the same wash the welcome window uses.
//
// The installer is the first Prequel anybody sees, and it used to be Finder's
// default grey — so the first impression of a product about how things look was
// a window with no design in it at all.
//
// The wash is a translation of `renderer/src/welcome/Welcome.tsx`, not a new
// design: same near-black, same three circles in the icon's own sunrise, same
// fade out of the top band. Every measurement below is written at welcome's
// 720pt scale and multiplied through, so the two can be compared line by line.
// Change one and change the other.
//
// Swift rather than a `scripts/*.mjs` like its neighbours, for one reason: the
// background carries a line of type, and this ffmpeg has no `drawtext`. Faking
// it — shipping the words as artwork, or hand-rasterising a font — costs more
// than reaching for the text engine that is already on every Mac this builds
// on. CoreText also gets the heading in the real system font at the real
// weight, which artwork exported once never stays.
//
// The two icon labels underneath — "Prequel" and "Applications" — are black on
// near-black, and that is a decision rather than an oversight. Finder renders a
// disk image window in *light appearance permanently* the moment it is given a
// background picture, so the labels are black whatever the user's system is set
// to, and nothing can recolour them: the icon view's own settings carry
// `iconSize`, `textSize` and `labelOnBottom` and no colour for the label, and
// electron-builder has no option because AppKit exposes none. The only way to
// read them is to put light behind them, which means giving up the dark window.
// That trade was made deliberately in favour of the dark window — the heading
// and the arrow carry the instruction, which is all those labels were doing.
// Anybody tempted to "fix" the contrast is really being asked to redesign this.
//
// Output is committed, so a normal build needs no image tooling — the same rule
// `make-app-icon.mjs` and `make-tray-icons.mjs` follow. Run via `pnpm dmg`.
import AppKit
import CoreGraphics
import CoreText
import Foundation

/// The window the background is drawn for.
///
/// This *is* the window: dmg-builder reads the image with `sips` and sets the
/// Finder window's frame to its size, ignoring `dmg.window` entirely whenever a
/// background is given. So the image cannot be sized to fit the window — the
/// window is sized to fit the image, and the only lever is here.
let WIDTH = 540.0
let HEIGHT = 420.0

/// The Finder title bar, which the frame above includes and the content does not.
///
/// Everything the user actually sees lives in the first `HEIGHT - CHROME`
/// points. Put an icon lower than that and Finder grows its scrollable area to
/// reach it — a disk image with a scroll bar in it, which is what the first cut
/// of this shipped.
let CHROME = 28.0

/// The part of the image that is on screen.
let VIEWPORT = HEIGHT - CHROME

/// How much smaller this is than the 720pt welcome window it copies.
let SCALE = WIDTH / 720.0

/// `--editor-bg`. The window's own near-black, and the whole of the surface.
let INK = (r: 0.086, g: 0.090, b: 0.102)

/// The band the colour is confined to.
///
/// `h-56` resolved against welcome's 720 would be 168. Opened out a little so
/// the wash holds the same share of this shorter window and reads as its top
/// rather than as a stripe across it.
let BAND = 185.0

/// The three circles, in the order they are stacked.
///
/// Positions are the Tailwind offsets resolved against a 720-wide window:
/// `-top-20 -left-20`, `-top-24 left-1/3`, `-top-20 -right-12`, each `size-80`.
/// Most of every circle sits above the top edge, which is what leaves only the
/// wide lower part of each in frame — one wholly inside reads as a dot.
let CIRCLES: [(x: Double, y: Double, r: Double, g: Double, b: Double, opacity: Double)] = [
  (80, 80, 0.949, 0.384, 0.180, 0.30),  // #f2622e
  (400, 64, 0.847, 0.118, 0.388, 0.25),  // #d81e63
  (608, 80, 0.545, 0.361, 0.965, 0.30),  // #8b5cf6
]

/// `size-80` is 320pt across, so 160 of radius.
let RADIUS = 160.0 * SCALE

/// `blur-3xl`. CSS reads the argument as a standard deviation, not a diameter.
let BLUR = 64.0 * SCALE

/// The instruction, and the reason the window is 420 tall rather than 380.
let HEADING = "Drag Prequel to Applications"
let HEADING_CENTRE_Y = 108.0
let HEADING_SIZE = 19.0

/// Where the arrow sits, between the two icons.
///
/// The x is the midpoint of `dmg.contents` in electron-builder.yml and the y is
/// theirs exactly, so the arrow points along the line the drag actually
/// travels. Move an icon and this has to move with it.
let ARROW = (x: (130.0 + 410.0) / 2, y: 250.0, length: 54.0, head: 11.0, thickness: 2.0)

/// A blurred disc, evaluated rather than rasterised.
///
/// A Gaussian-blurred hard edge is an error function, and `smoothstep` over two
/// standard deviations either side of it is within a couple of per cent — far
/// closer than the eye can tell on something drawn at 30% opacity, and it needs
/// no second buffer to blur into.
func disc(_ distance: Double, _ radius: Double, _ blur: Double) -> Double {
  let edge = (distance - (radius - 2 * blur)) / (4 * blur)
  if edge <= 0 { return 1 }
  if edge >= 1 { return 0 }
  return 1 - edge * edge * (3 - 2 * edge)
}

/// `colour` laid over `base` at `alpha`, which is what stacking translucent
/// divs amounts to.
func over(
  _ base: (r: Double, g: Double, b: Double),
  _ colour: (r: Double, g: Double, b: Double),
  _ alpha: Double
) -> (r: Double, g: Double, b: Double) {
  (
    base.r + (colour.r - base.r) * alpha,
    base.g + (colour.g - base.g) * alpha,
    base.b + (colour.b - base.b) * alpha
  )
}

func render(scale: Double) -> CGImage {
  let width = Int(WIDTH * scale)
  let height = Int(HEIGHT * scale)

  let space = CGColorSpace(name: CGColorSpace.sRGB)!
  let context = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: space,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  )!

  let pixels = context.data!.bindMemory(to: UInt8.self, capacity: width * height * 4)

  for row in 0..<height {
    for column in 0..<width {
      // Straight from the top, the way the CSS these numbers came from is.
      // The bitmap buffer's first row is the image's first row; it is only
      // CoreGraphics' *drawing* calls, further down, that put the origin at the
      // bottom left and need the height subtracted.
      let x = Double(column) / scale
      let y = Double(row) / scale

      var colour = INK

      if y < BAND {
        // The mask on the wash container: opaque for the first 45% of the band,
        // then out to nothing. Without it the circles end on the container's
        // straight bottom edge, and a blurred shape cut off in a straight line
        // is the one thing that gives away that it is a rectangle full of
        // circles — it reads as a seam across the window.
        let fade = y < BAND * 0.45 ? 1 : 1 - (y - BAND * 0.45) / (BAND * 0.55)

        // `from-white/[0.06] to-transparent`. Lifts the very top so the circles
        // sit in light rather than starting out of nothing.
        colour = over(colour, (1, 1, 1), 0.06 * (1 - y / BAND) * fade)

        for circle in CIRCLES {
          let distance = hypot(x - circle.x * SCALE, y - circle.y * SCALE)
          let coverage = disc(distance, RADIUS, BLUR)
          if coverage > 0 {
            colour = over(colour, (circle.r, circle.g, circle.b), coverage * circle.opacity * fade)
          }
        }
      }

      let offset = (row * width + column) * 4
      pixels[offset] = UInt8((colour.r * 255).rounded())
      pixels[offset + 1] = UInt8((colour.g * 255).rounded())
      pixels[offset + 2] = UInt8((colour.b * 255).rounded())
      pixels[offset + 3] = 255
    }
  }

  context.scaleBy(x: scale, y: scale)

  drawArrow(in: context)
  drawHeading(in: context)

  return context.makeImage()!
}

/// A shaft and two barbs, drawn rather than shipped as artwork.
///
/// It has to line up with icon positions that live in a different file, and a
/// PNG would go stale silently the first time one of them moved.
func drawArrow(in context: CGContext) {
  let half = ARROW.length / 2
  let tip = ARROW.x + half
  let y = HEIGHT - ARROW.y

  let path = CGMutablePath()
  path.move(to: CGPoint(x: ARROW.x - half, y: y))
  path.addLine(to: CGPoint(x: tip, y: y))
  path.move(to: CGPoint(x: tip - ARROW.head, y: y + ARROW.head))
  path.addLine(to: CGPoint(x: tip, y: y))
  path.addLine(to: CGPoint(x: tip - ARROW.head, y: y - ARROW.head))

  context.saveGState()
  context.setStrokeColor(red: 1, green: 1, blue: 1, alpha: 0.22)
  context.setLineWidth(ARROW.thickness)
  context.setLineCap(.round)
  context.setLineJoin(.round)
  context.addPath(path)
  context.strokePath()
  context.restoreGState()
}

/// The heading, in the system font at the weight the welcome window uses.
func drawHeading(in context: CGContext) {
  let font = NSFont.systemFont(ofSize: HEADING_SIZE, weight: .semibold)

  let attributed = NSAttributedString(
    string: HEADING,
    attributes: [
      .font: font,
      // Not pure white. The welcome window's `--editor-fg` is a shade off it,
      // and full white on a wash this soft reads as a brighter light source
      // than anything else in the picture.
      .foregroundColor: NSColor(red: 0.925, green: 0.933, blue: 0.945, alpha: 1),
      // `tracking-tight`, which every heading in the welcome window carries.
      .kern: -0.3,
    ]
  )

  let line = CTLineCreateWithAttributedString(attributed)
  let bounds = CTLineGetBoundsWithOptions(line, .useOpticalBounds)

  context.saveGState()
  context.textPosition = CGPoint(
    x: (WIDTH - bounds.width) / 2 - bounds.origin.x,
    y: HEIGHT - HEADING_CENTRE_Y - bounds.height / 2 - bounds.origin.y
  )
  CTLineDraw(line, context)
  context.restoreGState()
}

func write(_ image: CGImage, to url: URL) {
  let destination = CGImageDestinationCreateWithURL(
    url as CFURL, "public.png" as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else {
    fatalError("could not write \(url.path)")
  }
}

let build = URL(fileURLWithPath: CommandLine.arguments[0])
  .deletingLastPathComponent()
  .deletingLastPathComponent()
  .appendingPathComponent("build")

let at1x = build.appendingPathComponent("dmg-background.png")
let at2x = build.appendingPathComponent("dmg-background@2x.png")
let tiff = build.appendingPathComponent("background.tiff")

write(render(scale: 1), to: at1x)
write(render(scale: 2), to: at2x)

// One multi-representation TIFF rather than two PNGs beside each other.
// electron-builder hands the file straight to the Finder, and `@2x` is a
// convention of the app bundle loader, not of the disk image — on a Retina
// display the PNG pair gets the 1x scaled up, which on soft gradients looks
// like nothing is wrong at all.
let tiffutil = Process()
tiffutil.executableURL = URL(fileURLWithPath: "/usr/bin/tiffutil")
tiffutil.arguments = ["-cathidpicheck", at1x.path, at2x.path, "-out", tiff.path]
try tiffutil.run()
tiffutil.waitUntilExit()
guard tiffutil.terminationStatus == 0 else { exit(tiffutil.terminationStatus) }

try FileManager.default.removeItem(at: at1x)
try FileManager.default.removeItem(at: at2x)

print("wrote \(tiff.path)")
