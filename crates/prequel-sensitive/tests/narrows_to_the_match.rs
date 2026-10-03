//! The rectangle handed to the masker covers the match and nothing else — and
//! the offsets it is asked for are the ones Vision counts in.
//!
//! The UTF-16 test here is the one that earns its keep. Vision's
//! `boundingBoxForRange:` indexes the `NSString` it returned, which counts
//! UTF-16 code units; Rust slices bytes. For an all-ASCII line the two are
//! identical, so a hand-written test passes either way — and then a line with
//! an emoji in it masks the wrong word, on that line only, in an exported file.

use std::ops::Range;

use prequel_sensitive::{Category, Line, NormRect, RangeRects, scan_frame, scan_line};

/// A stand-in for Vision that lays every line out in a monospaced font.
///
/// Characters are counted in UTF-16 units, exactly as the real reader does, so
/// a caller that hands over byte offsets gets a visibly wrong rectangle rather
/// than a subtly wrong one.
struct Monospace {
    lines: Vec<String>,
}

impl RangeRects for Monospace {
    fn rect(&self, line: usize, utf16: Range<u32>) -> Option<NormRect> {
        let text = self.lines.get(line)?;
        let units = text.encode_utf16().count() as f32;
        if units == 0.0 {
            return None;
        }

        let start = utf16.start as f32 / units;
        let end = utf16.end as f32 / units;
        Some(NormRect::new(start, 0.0, end - start, 0.1))
    }
}

fn frame(lines: &[&str]) -> (Vec<Line>, Monospace) {
    let owned: Vec<String> = lines.iter().map(|line| (*line).to_owned()).collect();
    let placed = owned
        .iter()
        .enumerate()
        .map(|(index, text)| Line {
            text: text.clone(),
            rect: NormRect::new(0.0, index as f32 * 0.1, 1.0, 0.1),
            confidence: 1.0,
        })
        .collect();

    (placed, Monospace { lines: owned })
}

/// Where the match sits in the line, as a fraction, worked out independently of
/// the crate so the test is not asserting the implementation against itself.
fn expected(line: &str, needle: &str) -> f32 {
    let byte = line.find(needle).expect("the needle is in the line");
    let before = line[..byte].encode_utf16().count() as f32;
    before / line.encode_utf16().count() as f32
}

#[test]
fn narrows_to_the_match_rather_than_the_line() {
    let line = "Please invoice accounts@example.com before Friday";
    let (lines, rects) = frame(&[line]);

    let found = scan_frame(&lines, &rects, 1);
    assert_eq!(found.len(), 1, "one address, found once: {found:?}");

    let email = &found[0];
    assert_eq!(email.category, Category::Email);

    // The whole line is 1.0 wide. A rectangle narrowed to the address is a
    // fraction of that, and starts where the address starts.
    assert!(
        email.rect.w < 0.5,
        "the cover should be the address, not the sentence: {:?}",
        email.rect
    );
    let start = expected(line, "accounts@example.com");
    assert!(
        (email.rect.x - start).abs() < 0.05,
        "expected the cover near {start}, got {:?}",
        email.rect
    );
}

#[test]
fn counts_in_utf16_units_not_bytes() {
    // The emoji is one UTF-16 surrogate pair — two units — and four bytes. So
    // a byte offset overstates the position by two units, and the cover lands
    // two characters to the right of the address. On an all-ASCII line this
    // test cannot fail; that is exactly why it uses one that is not.
    let line = "\u{1f680} ship it: accounts@example.com";
    let (lines, rects) = frame(&[line]);

    let found = scan_frame(&lines, &rects, 1);
    assert_eq!(found.len(), 1, "{found:?}");

    let start = expected(line, "accounts@example.com");
    assert!(
        (found[0].rect.x - start).abs() < 0.05,
        "expected the cover near {start}, got {:?} — byte offsets were used where UTF-16 was wanted",
        found[0].rect
    );

    // And prove the two really do differ on this line, so the assertion above
    // is testing something.
    let byte = line.find("accounts").expect("the address is in the line") as f32;
    let bytes_would_be = byte / line.len() as f32;
    assert!(
        (bytes_would_be - start).abs() > 0.01,
        "this line must distinguish byte offsets from UTF-16 offsets"
    );
}

#[test]
fn falls_back_to_the_whole_line_when_the_reader_cannot_say() {
    struct Silent;
    impl RangeRects for Silent {
        fn rect(&self, _line: usize, _utf16: Range<u32>) -> Option<NormRect> {
            None
        }
    }

    let (lines, _) = frame(&["card 4242 4242 4242 4242 on file"]);
    let found = scan_frame(&lines, &Silent, 1);

    assert_eq!(found.len(), 1, "{found:?}");
    // Covering the whole line is a worse edit and never a leak, which is the
    // direction this has to fail in.
    assert!(found[0].rect.w > 0.9, "{:?}", found[0].rect);
}

#[test]
fn every_rectangle_stays_inside_the_frame() {
    // Padding grows a rectangle, so a match at the very edge of a frame is the
    // case that leaves it. An unclamped rect is a cover that either vanishes or
    // fills the picture depending on which rasteriser drew it, and then the
    // preview and the export disagree.
    struct Edge;
    impl RangeRects for Edge {
        fn rect(&self, _line: usize, _utf16: Range<u32>) -> Option<NormRect> {
            Some(NormRect::new(0.0, 0.0, 0.2, 0.08))
        }
    }

    // The key fragment is joined rather than written out: a secret scanner
    // cannot tell a fixture from a leak, and GitHub's push protection refuses a
    // file carrying one. See `fixture` in `secrets.rs`.
    let line = ["a@b.com 4242424242424242 ", "sk-", "ant-", "api03-", &"a".repeat(22)].concat();
    let (lines, _) = frame(&[&line]);
    let found = scan_frame(&lines, &Edge, 1);
    assert!(!found.is_empty());

    for candidate in &found {
        let rect = candidate.rect;
        assert!(rect.x >= 0.0, "{rect:?}");
        assert!(rect.y >= 0.0, "{rect:?}");
        assert!(rect.x + rect.w <= 1.0 + f32::EPSILON, "{rect:?}");
        assert!(rect.y + rect.h <= 1.0 + f32::EPSILON, "{rect:?}");
        assert!(rect.w > 0.0 && rect.h > 0.0, "{rect:?}");
    }
}

#[test]
fn a_card_written_in_groups_is_one_finding() {
    // The reason digit runs are scanned before tokens: whitespace-separated
    // tokenisation turns a card into four unrelated four-digit numbers that no
    // checksum can be run against, so the pass would never find a card typed
    // the way a card is written.
    let found = scan_line("Charge 4242 4242 4242 4242 today");

    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].category, Category::Card);
    assert_eq!(found[0].canonical, "4242424242424242");
}

#[test]
fn a_claimed_run_is_not_also_a_phone_number() {
    // Overlapping findings would stack two covers on one number and list it
    // twice in the panel.
    let found = scan_line("card 4242424242424242");
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].category, Category::Card);
}

#[test]
fn a_line_vision_doubts_lowers_the_confidence() {
    let (mut lines, rects) = frame(&["accounts@example.com"]);
    lines[0].confidence = 0.2;

    let found = scan_frame(&lines, &rects, 1);
    assert_eq!(found.len(), 1);
    // The rule is sure; the reading is not. A finding cannot be more certain
    // than the text it was found in.
    assert!(found[0].confidence < 0.7, "{}", found[0].confidence);
}
