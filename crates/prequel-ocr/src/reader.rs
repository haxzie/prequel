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
            let tags: Vec<arc::R<ns::String>> = langs.iter().map(|tag| ns::String::with_str(tag)).collect();
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
