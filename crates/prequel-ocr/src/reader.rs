//! Reading the text off one frame, with Vision.

use cidre::{arc, cv, ns, vn};
use prequel_sensitive::{Line, NormRect, RangeRects};

use crate::{Error, Result};

/// The smallest text, as a fraction of the frame's height, that is worth
/// reading.
///
/// Below about this, Vision's output is mostly noise and the noise is what
/// fires an entropy rule — so a floor here costs nothing real and removes a
/// whole class of false positive. Roughly seventeen pixels on a 2160-tall
/// frame, which is smaller than any interface draws body text.
const MIN_TEXT_HEIGHT: f32 = 0.008;

/// How many readings of a line Vision is asked for.
///
/// One. The alternatives are the same words spelled differently, and
/// classifying a second choice and then asking the first for a rectangle would
/// put the cover over text that was never matched.
const CANDIDATES: usize = 1;

/// Anything that can read the text off a frame.
///
/// A trait for the reason `prequel-camera`'s `Segmenter` is one: the model is a
/// detail. It also lets the sampling loop — the segment offsets, the progress
/// weighting, the end-of-file bound — be tested without decoding anything.
pub trait TextReader {
    fn read(&mut self, frame: &cv::PixelBuf) -> Result<Reading>;
}

/// What was read off one frame.
///
/// Carries the lines for the classifier and, alongside them, whatever the
/// reader needs to answer for a *substring* of one — which for Vision means
/// holding its `VNRecognizedText` objects alive.
pub struct Reading {
    pub lines: Vec<Line>,
    /// One per line, in the same order. `None` where the reader cannot narrow,
    /// which falls back to covering the whole line.
    texts: Vec<Option<arc::R<vn::RecognizedText>>>,
}

impl Reading {
    /// A reading that cannot narrow to a substring. For a reader with no
    /// Vision behind it.
    pub fn unnarrowed(lines: Vec<Line>) -> Self {
        let texts = lines.iter().map(|_| None).collect();
        Self { lines, texts }
    }
}

impl RangeRects for Reading {
    fn rect(&self, line: usize, utf16: std::ops::Range<u32>) -> Option<NormRect> {
        let text = self.texts.get(line)?.as_ref()?;

        // `NSRange` is a location and a length in UTF-16 code units, which is
        // what `prequel-sensitive` carries alongside its byte offsets for
        // exactly this call. Handing it bytes puts the cover on the wrong word
        // in any line with an emoji in it, and on the right one everywhere
        // else.
        let range = ns::Range::new(
            utf16.start as ns::UInteger,
            utf16.end.saturating_sub(utf16.start) as ns::UInteger,
        );

        // Fails when the range straddles a recognition discontinuity. `None`
        // falls back to the whole line, which is a worse edit and never a
        // leak — the direction this has to fail in.
        let box_ = text.bounding_box_for_range(range).ok()?;
        let rect = box_.bounding_box();

        Some(NormRect::from_vision(
            rect.origin.x as f32,
            rect.origin.y as f32,
            rect.size.width as f32,
            rect.size.height as f32,
        ))
    }
}

/// Anything that can find the faces on a frame.
///
/// Its own trait beside [`TextReader`] rather than more returned from that one.
/// The two are different requests with different revisions and different costs,
/// a recording can want either without the other, and a reader that had to
/// answer both would make "find faces but not text" impossible to ask for.
pub trait FaceReader {
    /// The faces, in top-left fractions of the frame.
    fn read(&mut self, frame: &cv::PixelBuf) -> Result<Vec<Face>>;
}

/// One face, where it is and how sure Vision is of it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Face {
    pub rect: NormRect,
    pub confidence: f32,
}

/// Apple's face detection, via Vision.
pub struct VisionFaceReader {
    request: arc::R<vn::DetectFaceRectanglesRequest>,
    /// Built once, for the reason the text reader's is.
    requests: arc::R<ns::Array<vn::Request>>,
}

impl VisionFaceReader {
    pub fn new() -> Self {
        let mut request = vn::DetectFaceRectanglesRequest::new();

        // The newest revision this build knows. Unlike the text request's,
        // which is pinned so a reading cannot change under a stored finding,
        // this only decides *where* a box lands — and a later revision finding
        // a face an earlier one missed is the whole of what it is for.
        request.set_revision(vn::DetectFaceRectanglesRequest::REVISION_3);

        let base: &vn::Request = &request;
        let requests = ns::Array::from_slice(&[base]);

        Self { request, requests }
    }
}

impl Default for VisionFaceReader {
    fn default() -> Self {
        Self::new()
    }
}

impl FaceReader for VisionFaceReader {
    fn read(&mut self, frame: &cv::PixelBuf) -> Result<Vec<Face>> {
        let handler = vn::ImageRequestHandler::with_cv_pixel_buf(frame, None)
            .ok_or_else(|| Error::Read("Vision refused the frame".to_owned()))?;

        handler
            .perform(&self.requests)
            .map_err(|e| Error::Read(format!("{e:?}")))?;

        let Some(results) = self.request.results() else {
            return Ok(Vec::new());
        };

        Ok(results
            .iter()
            .map(|observation| {
                let rect = observation.bounding_box();
                Face {
                    rect: NormRect::from_vision(
                        rect.origin.x as f32,
                        rect.origin.y as f32,
                        rect.size.width as f32,
                        rect.size.height as f32,
                    ),
                    confidence: observation.confidence(),
                }
            })
            .collect())
    }
}

/// Apple's text recognition, via Vision.
pub struct VisionTextReader {
    request: arc::R<vn::RecognizeTextRequest>,
    /// Built once: `perform` takes an array, and building one per frame is a
    /// needless allocation on a path that runs once a second for minutes.
    requests: arc::R<ns::Array<vn::Request>>,
}

impl VisionTextReader {
    /// `langs` are BCP-47 tags, most preferred first.
    pub fn new(langs: &[String]) -> Self {
        let mut request = vn::RecognizeTextRequest::new();

        request.set_revision(vn::RecognizeTextRequest::REVISION_3);
        request.set_recognition_level(vn::RequestTextRecognitionLevel::Accurate);

        // **Off, and this is the one setting that decides whether the secrets
        // category works at all.** `usesLanguageCorrection` defaults to *true*
        // and is a language model over the candidates: left on, it reads
        // `sk-ant-api03-…` as words and a card number as something plausible,
        // quietly defeating the rules that exist to find them. Nothing in the
        // output says it happened.
        request.set_uses_lang_correction(false);

        // Also off. Detection costs a pass and can land on a language the
        // recording is not in, and the caller already knows which languages
        // the person reading the screen uses.
        request.set_automatically_detects_lang(false);

        request.set_min_text_height(MIN_TEXT_HEIGHT);

        if !langs.is_empty() {
            let tags: Vec<arc::R<ns::String>> =
                langs.iter().map(|tag| ns::String::with_str(tag)).collect();
            let refs: Vec<&ns::String> = tags.iter().map(AsRef::as_ref).collect();
            request.set_recognition_langs(&ns::Array::from_slice(&refs));
        }

        let base: &vn::Request = &request;
        let requests = ns::Array::from_slice(&[base]);

        Self { request, requests }
    }

    /// The languages this build can read, as BCP-47 tags.
    pub fn supported_langs() -> Vec<String> {
        let request = vn::RecognizeTextRequest::new();
        request
            .supported_recognition_langs()
            .map(|langs| langs.iter().map(|tag| tag.to_string()).collect())
            .unwrap_or_default()
    }
}

impl TextReader for VisionTextReader {
    fn read(&mut self, frame: &cv::PixelBuf) -> Result<Reading> {
        // A handler per frame, unlike `prequel-camera`'s matte, which keeps one
        // `VNSequenceRequestHandler` for the whole take. The difference is
        // deliberate: a sequence handler carries state between frames, which
        // helps a segmentation mask settle and would make text recognition
        // depend on what came before it — so the same frame could read
        // differently depending on how it was reached, and a test could not pin
        // it. An image handler is a few hundred bytes against a request that
        // costs hundreds of milliseconds.
        let handler = vn::ImageRequestHandler::with_cv_pixel_buf(frame, None)
            .ok_or_else(|| Error::Read("Vision refused the frame".to_owned()))?;

        handler
            .perform(&self.requests)
            .map_err(|e| Error::Read(format!("{e:?}")))?;

        let Some(results) = self.request.results() else {
            return Ok(Reading::unnarrowed(Vec::new()));
        };

        let mut lines = Vec::with_capacity(results.len());
        let mut texts = Vec::with_capacity(results.len());

        for observation in results.iter() {
            let candidates = observation.top_candidates(CANDIDATES);
            let Some(text) = candidates.first() else {
                continue;
            };

            let rect = observation.bounding_box();
            lines.push(Line {
                text: text.string().to_string(),
                rect: NormRect::from_vision(
                    rect.origin.x as f32,
                    rect.origin.y as f32,
                    rect.size.width as f32,
                    rect.size.height as f32,
                ),
                confidence: text.confidence(),
            });
            texts.push(Some(text.retained()));
        }

        Ok(Reading { lines, texts })
    }
}
