//! Finding sensitive information in text read off a screen, and following it
//! as it moves.
//!
//! The pass this belongs to has two halves and they are kept strictly apart.
//! `prequel-ocr` asks Vision what text is on a frame and where. This crate
//! decides which of that text is a card number, an email address or an API key,
//! narrows the rectangle to the match, and stitches the matches from successive
//! samples into tracks that follow the text as the page scrolls.
//!
//! **Precision is the product.** A mask over the thing somebody was
//! demonstrating ruins the take, and a feature that does that twice is switched
//! off and never switched on again — so every category here is a shape, then a
//! validator, then a negative gate, and a rule that cannot be validated is
//! reported below the threshold at which a mask is applied rather than being
//! loosened until it fires. The corpus in `tests/does_not_cry_wolf.rs` is the
//! real specification.
//!
//! **Nothing here ever returns the matched text to its caller in the clear.**
//! A [`Finding`] carries a salted hash and a pre-masked preview, because the
//! artefact it ends up in sits on disk beside an unredacted recording and
//! travels with it — into a backup, into a zip attached to a support email. A
//! privacy pass that writes the card number down next to the video has made
//! things worse than it found them.

pub mod contact;
pub mod entropy;
pub mod geom;
pub mod iban;
pub mod ids;
pub mod luhn;
pub mod secrets;
pub mod text;
pub mod track;

use std::ops::Range;

use serde::{Deserialize, Serialize};

pub use geom::NormRect;

/// Confidence at or above which a finding is covered without being asked.
///
/// Everything below is still reported, and the panel lists it as a suggestion
/// the user can accept. The split is the whole safety argument: the categories
/// that carry a checksum sit above it and cannot really be wrong, and the ones
/// that are a judgement call sit below it and cannot really cover your work.
pub const MASK_THRESHOLD: f32 = 0.9;

/// How much of its own height a match's rectangle is grown by.
///
/// An OCR box hugs the ink, so an unpadded cover leaves the tops of the
/// ascenders and the tails of the descenders legible — and half a line of text
/// is enough to read a card number from. Also slack for the interpolation
/// between two samples, which lags the text during a fast scroll.
pub const RECT_PADDING: f32 = 0.25;

/// What sort of sensitive thing a finding is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Email,
    Phone,
    Url,
    Card,
    Iban,
    NationalId,
    Secret,
}

impl Category {
    /// Which of the three groups the panel offers this belongs to.
    pub fn group(self) -> Group {
        match self {
            Self::Email | Self::Phone | Self::Url => Group::Contact,
            Self::Card | Self::Iban | Self::NationalId => Group::Financial,
            Self::Secret => Group::Credential,
        }
    }
}

/// The three toggles in the panel.
///
/// Grouped because nobody wants seven switches, and because these three are the
/// three genuinely different answers to "would I mind this being seen".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Group {
    Contact,
    Financial,
    Credential,
}

/// One recognised line of text from one frame.
///
/// `rect` is the whole line, already in top-left fractions — the fallback for
/// when Vision cannot give a rectangle for the matched substring.
#[derive(Debug, Clone)]
pub struct Line {
    pub text: String,
    pub rect: NormRect,
    /// Vision's own confidence in having read the line correctly, 0 to 1.
    pub confidence: f32,
}

/// Something sensitive found in a line, before its rectangle is narrowed.
#[derive(Debug, Clone, PartialEq)]
pub struct Match {
    pub category: Category,
    /// What the panel calls it. Never the matched text — for a secret this is
    /// the vendor's name, for everything else the category's own label.
    pub label: &'static str,
    /// The match's span in the line, in bytes, for slicing in Rust.
    pub bytes: Range<usize>,
    /// The same span in UTF-16 code units, for Vision's `NSRange`.
    pub utf16: Range<u32>,
    /// The match with separators and case removed. Used for identity and for
    /// the preview, and never stored.
    pub canonical: String,
    pub confidence: f32,
    /// Whether a character had to be corrected for a checksum to pass.
    pub repaired: bool,
}

/// Everything sensitive in one line of recognised text.
pub fn scan_line(line: &str) -> Vec<Match> {
    let map = text::Utf16Map::new(line);
    let mut out: Vec<Match> = Vec::new();

    // Digit runs first, because a card or an IBAN written in groups spans the
    // whitespace a token split happens at — and because a run already claimed
    // as a card must not then also be offered as a phone number.
    for span in text::digit_runs(line) {
        let raw = &line[span.clone()];
        let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
        let context = text::context_before(line, span.start);

        if luhn::is_card(&digits) {
            out.push(spanned(Category::Card, "Card number", span, &map, &digits, 0.97));
            continue;
        }

        if let Some(id) = ids::classify(raw, &context) {
            out.push(spanned(Category::NationalId, id.label(), span, &map, &digits, 0.95));
            continue;
        }

        match contact::classify_phone(raw, &context) {
            Some(contact::Phone::International) => {
                out.push(spanned(Category::Phone, "Phone number", span, &map, &digits, 0.92));
            }
            Some(contact::Phone::Likely) => {
                // Below the threshold on purpose: a grouped ten-digit run is a
                // phone number most of the time and an identifier the rest, and
                // being wrong here covers the thing being demonstrated.
                out.push(spanned(Category::Phone, "Phone number", span, &map, &digits, 0.7));
            }
            None => {}
        }
    }

    // Then IBANs printed in groups, which no token split and no digit run can
    // see whole: `GB82 WEST 1234 5698 7654 32` is six tokens, only some of
    // which are digits. A token that opens like an IBAN names its country, the
    // country gives the exact length, and the length is what makes gathering
    // across the spaces safe rather than a greedy grab at the rest of the line.
    for token in text::tokens(line, &map) {
        let Some(span) = iban_from(line, &token) else {
            continue;
        };
        let compact = text::canonical(&line[span.clone()]).to_ascii_uppercase();
        if iban::is_iban(&compact) {
            out.push(spanned(Category::Iban, "IBAN", span, &map, &compact, 0.98));
        }
    }

    for token in text::tokens(line, &map) {
        // A token inside a run already claimed is not reconsidered.
        if out.iter().any(|found| overlaps(&found.bytes, &token.bytes)) {
            continue;
        }

        let context = text::context_before(line, token.bytes.start);
        let canonical = text::canonical(token.text);

        if contact::is_email(token.text) {
            out.push(tokenised(Category::Email, "Email address", &token, canonical, 0.95));
            continue;
        }

        if let Some(secret) = secrets::classify(token.text, &context) {
            let confidence = match secret {
                secrets::Secret::Known(_) => 0.97,
                // Below the threshold: an unrecognised high-entropy token is a
                // guess, and on a developer's screen the guess is wrong often
                // enough that it may not cover anything unasked.
                secrets::Secret::Generated => 0.65,
            };
            out.push(tokenised(Category::Secret, secret.label(), &token, canonical, confidence));
            continue;
        }

        if iban::is_iban(&canonical.to_ascii_uppercase()) {
            out.push(tokenised(Category::Iban, "IBAN", &token, canonical, 0.98));
            continue;
        }

        if let Some(id) = ids::classify(token.text, &context) {
            out.push(tokenised(Category::NationalId, id.label(), &token, canonical, 0.95));
            continue;
        }

        if contact::is_url(token.text) {
            // The lowest of the lot, and off by default in the panel: people
            // point a camera at an address bar on purpose.
            out.push(tokenised(Category::Url, "Web address", &token, canonical, 0.6));
        }
    }

    out.sort_by_key(|found| found.bytes.start);
    out
}

fn overlaps(a: &Range<usize>, b: &Range<usize>) -> bool {
    a.start < b.end && b.start < a.end
}

/// The span a grouped IBAN would occupy if this token opens one.
///
/// An IBAN opens with two letters of country and two check digits, which is a
/// shape common enough in prose — `GB82`, but also a stock ticker or a part
/// number — that this is only a reason to go and look, never a finding.
fn iban_from(line: &str, token: &text::Token<'_>) -> Option<Range<usize>> {
    let head = token.text.get(..4)?;
    let head = head.to_ascii_uppercase();
    let bytes = head.as_bytes();

    if !bytes[..2].iter().all(u8::is_ascii_alphabetic)
        || !bytes[2..].iter().all(u8::is_ascii_digit)
    {
        return None;
    }

    let length = iban::required_length(&head[..2])?;
    text::grouped_run(line, token.bytes.start, length)
}

fn tokenised(
    category: Category,
    label: &'static str,
    token: &text::Token<'_>,
    canonical: String,
    confidence: f32,
) -> Match {
    Match {
        category,
        label,
        bytes: token.bytes.clone(),
        utf16: token.utf16.clone(),
        canonical,
        confidence,
        repaired: false,
    }
}

fn spanned(
    category: Category,
    label: &'static str,
    span: Range<usize>,
    map: &text::Utf16Map,
    canonical: &str,
    confidence: f32,
) -> Match {
    Match {
        category,
        label,
        utf16: map.range(&span),
        bytes: span,
        canonical: canonical.to_owned(),
        confidence,
        repaired: false,
    }
}

/// Anything that can give a rectangle for a substring of a recognised line.
///
/// Implemented over Vision's `boundingBoxForRange:` by `prequel-ocr`, and by a
/// proportional stand-in in this crate's tests. The trait is the reason the
/// narrowing and the tracking are testable with no Mac, no Vision and no video
/// — the same move `prequel-camera`'s `trait Segmenter` makes one level down.
pub trait RangeRects {
    /// The rectangle of `utf16` within line `line`, in top-left fractions, or
    /// `None` if the reader cannot say.
    fn rect(&self, line: usize, utf16: Range<u32>) -> Option<NormRect>;
}

/// A match placed on a frame.
///
/// **Deliberately not `Serialize`.** This is the only type here that holds the
/// matched text, and it holds it so the tracker can recognise the same text in
/// the next sample. Nothing it carries may reach the artefact beside the
/// recording, and the way that is guaranteed is that this cannot be written:
/// only [`track::Track`] can, and a `Track` carries a bucket and a preview.
/// Adding a `Serialize` derive here would make the leak a one-line change
/// nobody would notice in review.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub category: Category,
    pub label: &'static str,
    pub rect: NormRect,
    pub confidence: f32,
    pub repaired: bool,
    /// The bucket this match's text falls in — see [`bucket`].
    pub bucket: u32,
    /// The pre-masked rendering shown in the panel.
    pub preview: String,
    /// The matched text, normalised. In memory only, for the reason above.
    pub canonical: String,
}

/// Everything sensitive on one frame, each rectangle narrowed to its match.
pub fn scan_frame(lines: &[Line], rects: &impl RangeRects, salt: u64) -> Vec<Candidate> {
    let mut out = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        for found in scan_line(&line.text) {
            // Vision's narrowing fails when a range straddles a recognition
            // discontinuity. Falling back to the whole line is a worse edit and
            // never a leak, which is the correct direction to fail.
            let rect = rects
                .rect(index, found.utf16.clone())
                .unwrap_or(line.rect)
                .padded(RECT_PADDING);

            let Some(rect) = rect.clamped() else {
                continue;
            };

            out.push(Candidate {
                category: found.category,
                label: found.label,
                rect,
                // A line Vision is unsure it read cannot produce a finding we
                // are sure of, however good the rule is.
                confidence: found.confidence.min(0.5 + line.confidence / 2.0),
                repaired: found.repaired,
                bucket: bucket(salt, found.category, &found.canonical),
                preview: preview(found.category, &found.canonical),
                canonical: found.canonical,
            });
        }
    }

    out
}

/// How many bits of a match's hash are kept.
///
/// Twenty-four, and the number is the whole security argument, so it is worth
/// stating plainly. A finding needs an identity that survives a re-scan, or
/// every mask the user dismissed comes back the next time the recording is
/// opened. Content is the only thing stable enough to key on — but a key
/// derived from content is a key somebody can attack, and the artefact holding
/// it sits in the same folder as the video and travels with it.
///
/// A full hash of a nine-digit number is no protection at all: there are only a
/// billion of them, so anybody with the file can try every one. Slowing the
/// hash down is an arms race against hardware. Truncating it is not — at
/// twenty-four bits there are sixteen million buckets, so about sixty different
/// social security numbers and millions of different card numbers fall into
/// each one, and no amount of computing power narrows that down. The
/// information is *gone*, rather than merely expensive to recover.
///
/// What it costs: two different findings in one recording can share a bucket,
/// and a dismissal would then apply to both. With tens of findings per
/// recording that is a one-in-hundreds-of-thousands event whose consequence is
/// one mask somebody dismisses twice — against an alternative that publishes a
/// card number.
const BUCKET_BITS: u32 = 24;

/// The bucket a match's text falls in, within one recording.
///
/// Salted per recording so the same card in two recordings does not produce the
/// same bucket. Without the salt the artefacts correlate, and "these two videos
/// show the same account" is itself worth not leaking.
pub fn bucket(salt: u64, category: Category, canonical: &str) -> u32 {
    // FNV-1a, and it does not need to be cryptographic: the truncation above is
    // what provides the protection and a stronger hash would add none. What
    // matters is that it is stable forever — a different hash in a later build
    // would orphan every dismissal already on disk.
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    let mut hash = OFFSET ^ salt;
    // The category goes in so two categories reading the same characters stay
    // two findings.
    let category = [category as u8];
    for byte in category.iter().chain(canonical.as_bytes()) {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(PRIME);
    }

    (hash >> (64 - BUCKET_BITS)) as u32
}

/// What the panel shows in place of the thing it found.
///
/// Enough to recognise, never enough to use. A card keeps its last four digits
/// because that is how a card is referred to everywhere and because four digits
/// identify nothing. A secret shows nothing at all: the label already names the
/// vendor, which is what makes the row findable, and any part of a key is part
/// of a key.
pub fn preview(category: Category, canonical: &str) -> String {
    const DOTS: &str = "\u{2022}\u{2022}\u{2022}\u{2022}";

    match category {
        Category::Card => match canonical.len() {
            4.. => format!("{DOTS} {}", &canonical[canonical.len() - 4..]),
            _ => DOTS.to_owned(),
        },
        // The last two digits of an IBAN or a phone number are not identifying,
        // and they are what makes one row tellable from the next.
        Category::Iban | Category::NationalId | Category::Phone => match canonical.len() {
            5.. => format!("{DOTS} {}", &canonical[canonical.len() - 2..]),
            _ => DOTS.to_owned(),
        },
        Category::Email => match canonical.split_once('@') {
            Some((local, domain)) => {
                let head = local.chars().next().unwrap_or('\u{2022}');
                format!("{head}\u{2022}\u{2022}\u{2022}@{domain}")
            }
            None => DOTS.to_owned(),
        },
        Category::Url => match canonical.split('/').next() {
            Some(host) if !host.is_empty() => format!("{host}/\u{2022}\u{2022}\u{2022}"),
            _ => DOTS.to_owned(),
        },
        Category::Secret => DOTS.to_owned(),
    }
}
