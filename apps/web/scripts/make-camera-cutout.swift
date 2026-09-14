// Cuts the person out of a still, for the features page's "remove background"
// card.
//
// The same request the app's `VisionSegmenter` runs — Vision's person
// segmentation, on the Neural Engine — applied to one frame and written back
// as the picture's alpha. So the cutout on the site is the product's own
// matte on the product's own footage, and not a hand-traced approximation of
// what it does.
//
// The frame is the one `camera-still.jpg` was cut from, taken again at full
// size because that file is 150 pixels wide and a cutout is drawn larger than
// a bubble. Output is committed, so a normal build needs no image tooling.
//
//   ffmpeg -ss 9.0 -i camera-talking-head.mp4 -frames:v 1 \
//     -vf "crop=495:660:393:0" frame.png
//   swiftc -O scripts/make-camera-cutout.swift -o /tmp/cut
//   /tmp/cut frame.png cutout.png
//   cwebp -q 85 -resize 300 0 cutout.png -o public/camera-cutout.webp
//
// WebP rather than PNG: the PNG with alpha is 67kB at 260 wide, the WebP 12kB
// at 300, and every browser the site supports decodes it.
import AppKit
import CoreImage
import Vision

let input = CommandLine.arguments[1]
let output = CommandLine.arguments[2]

guard let image = NSImage(contentsOfFile: input),
  let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
  fatalError("could not read \(input)")
}

let request = VNGeneratePersonSegmentationRequest()
// `.accurate` rather than the app's realtime level: the app is keeping up with
// a camera and this is one frame with all day to spend on it.
request.qualityLevel = .accurate
request.outputPixelFormat = kCVPixelFormatType_OneComponent8
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
guard let mask = request.results?.first?.pixelBuffer else {
  fatalError("Vision returned no mask")
}

// The mask comes back at the model's own size, not the picture's, so it is
// scaled to the picture before it is used as an alpha — which is also what
// the app's rasterisers do, by sampling it in normalised coordinates.
let picture = CIImage(cgImage: cg)
var matte = CIImage(cvPixelBuffer: mask)
matte = matte.transformed(
  by: CGAffineTransform(
    scaleX: picture.extent.width / matte.extent.width,
    y: picture.extent.height / matte.extent.height))

let blend = CIFilter(name: "CIBlendWithMask")!
blend.setValue(picture, forKey: kCIInputImageKey)
blend.setValue(CIImage(color: .clear).cropped(to: picture.extent), forKey: kCIInputBackgroundImageKey)
blend.setValue(matte, forKey: kCIInputMaskImageKey)

let result = CIContext().createCGImage(blend.outputImage!, from: picture.extent)!
let png = NSBitmapImageRep(cgImage: result).representation(using: .png, properties: [:])!
try png.write(to: URL(fileURLWithPath: output))
print("wrote \(output) \(result.width)x\(result.height)")
