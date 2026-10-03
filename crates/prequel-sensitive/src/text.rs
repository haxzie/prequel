//! Splitting a recognised line into tokens, and keeping two sets of offsets.
//!
//! Two, because the producer and the consumer of a match count differently.
//! Rust slices a `&str` by **bytes**. Vision's
//! `-[VNRecognizedText boundingBoxForRange:error:]` takes an `NSRange` into the
//! `NSString` it handed back, which counts **UTF-16 code units**. For plain
//! ASCII the two are identical, which is the problem: every test anyone writes
//! by hand passes, and then a line with an emoji in it — a Slack message, a
//! commit subject, a filename — masks the wrong word, and only that line.
//!
//! So every token carries both, built in the same pass.

use std::ops::Range;

/// How many characters of the text before a token count as its context.
///
/// Enough for `Authorization: Bearer` and `export OPENAI_API_KEY=`, which are
/// the shapes the entropy rules look for, and short enough that a key named
/// near the start of a long sentence does not inherit the sentence.
const CONTEXT_CHARS: usize = 32;

/// A token of a recognised line, with both its offsets.
#[derive(Debug, Clone, PartialEq)]
pub struct Token<'a> {
    /// The token with surrounding punctuation trimmed off.
    pub text: &'a str,
    /// Where `text` sits in the line, in bytes — what Rust slices with.
    pub bytes: Range<usize>,
    /// The same span in UTF-16 code units — what Vision measures with.
    pub utf16: Range<u32>,
}

/// Byte offsets to UTF-16 offsets, for one string.
///
/// A prefix sum rather than a recount per lookup: a line has tens of tokens and
/// each one asks twice, and `encode_utf16().take_while()` per ask is quadratic
/// on a line of minified JavaScript, which is exactly the sort of line a screen
/// recording is full of.
pub struct Utf16Map {
    /// `(byte offset, utf-16 offset)` at every character boundary that differs
    /// from its predecessor by more than one unit, plus the ends.
    marks: Vec<(usize, u32)>,
}

impl Utf16Map {
    pub fn new(text: &str) -> Self {
        let mut marks = Vec::with_capacity(8);
        let mut utf16 = 0u32;

        marks.push((0, 0));
        for (byte, ch) in text.char_indices() {
            // Only record where the two counts come apart. For an all-ASCII
            // line that is nowhere, so the map is two entries and the lookup
            // below is a subtraction.
            if ch.len_utf8() != ch.len_utf16() {
                marks.push((byte, utf16));
            }
            utf16 += ch.len_utf16() as u32;
        }
        marks.push((text.len(), utf16));

        Self { marks }
    }

    /// The UTF-16 offset of a byte offset.
    ///
    /// `byte` must be a character boundary; every offset this crate produces
    /// comes from `char_indices`, so it is.
    pub fn utf16_at(&self, byte: usize) -> u32 {
        // The last mark at or before `byte`, then count the bytes since it.
        // Between two marks every character is one byte and one unit, which is
        // what makes the remainder a plain subtraction.
        let index = match self.marks.binary_search_by_key(&byte, |(b, _)| *b) {
            Ok(index) => index,
            Err(index) => index.saturating_sub(1),
        };
        let (mark_byte, mark_utf16) = self.marks[index];
        mark_utf16 + (byte - mark_byte) as u32
    }

    pub fn range(&self, bytes: &Range<usize>) -> Range<u32> {
        self.utf16_at(bytes.start)..self.utf16_at(bytes.end)
    }
}

/// Punctuation that cannot be part of anything being looked for, and so is
/// trimmed off both ends of a token.
///
/// `.` and `-` are not here even though a sentence ends with one, because
/// `example.com` and `4242-4242` need them inside; they are trimmed separately
/// from the end only. `_`, `+`, `/`, `=` and `:` stay because a token is
/// routinely `OPENAI_API_KEY=sk-...` or a base64 tail.
const TRIM: &[char] = &[
    '"', '\'', '`', '(', ')', '[', ']', '{', '}', '<', '>', ',', ';', '!', '?', '|', '\\', '*',
    '\u{201c}', '\u{201d}', '\u{2018}', '\u{2019}',
];

/// The tokens of a line, whitespace-separated and trimmed.
pub fn tokens<'a>(line: &'a str, map: &Utf16Map) -> Vec<Token<'a>> {
    let mut out = Vec::new();

    for (offset, raw) in whitespace_split(line) {
        let trimmed = raw.trim_matches(|c| TRIM.contains(&c));
        // Sentence punctuation, from the end only: `visit example.com.` must
        // not become `example.com.`, while `v1.2` must keep its dots.
        let trimmed = trimmed.trim_end_matches(['.', ':', '-']);
        if trimmed.is_empty() {
            continue;
        }

        // `trim` returns a subslice, so its start is found by pointer distance
        // rather than by searching — searching would find the first occurrence,
        // which is the wrong one whenever a token repeats its own prefix.
        let start = offset + (trimmed.as_ptr() as usize - raw.as_ptr() as usize);
        let bytes = start..start + trimmed.len();

        out.push(Token {
            text: trimmed,
            utf16: map.range(&bytes),
            bytes,
        });

        push_assigned(&mut out, trimmed, start, map);
    }

    out
}

/// Characters that separate a name from the value assigned to it.
///
/// A credential is almost never written on its own. It is
/// `OPENAI_API_KEY=sk-proj-…`, or `"apiKey":"sk-proj-…"`, and neither contains
/// a space — so whitespace tokenisation hands the rules one token that is a
/// name *and* a value, and an anchored pattern matches neither. Splitting here
/// is what lets the vendor rules stay anchored, which is what stops `sk-live`
/// inside an ordinary word becoming a Stripe key.
const ASSIGNS: &[char] = &['=', ':', '"', '\'', ','];

/// How long a piece of a split token has to be to be worth considering.
///
/// Eight. Below that it is a field name or a fragment, and every rule that
/// looks at these needs twenty characters anyway.
const MIN_ASSIGNED: usize = 8;

fn push_assigned<'a>(out: &mut Vec<Token<'a>>, token: &'a str, start: usize, map: &Utf16Map) {
    // Only when there is something to split on, so the common case — a word —
    // does nothing.
    if !token.contains(ASSIGNS) {
        return;
    }

    let mut offset = 0;
    for piece in token.split(ASSIGNS) {
        let at = start + offset;
        offset += piece.len() + 1;

        if piece.len() < MIN_ASSIGNED || piece.len() == token.len() {
            continue;
        }

        let bytes = at..at + piece.len();
        out.push(Token {
            text: piece,
            utf16: map.range(&bytes),
            bytes,
        });
    }
}

fn whitespace_split(line: &str) -> impl Iterator<Item = (usize, &str)> {
    line.split_whitespace().map(move |piece| {
        let offset = piece.as_ptr() as usize - line.as_ptr() as usize;
        (offset, piece)
    })
}

/// Runs of digits that may be separated by single spaces or hyphens.
///
/// Its own scanner rather than a token rule because a card number on screen is
/// `4242 4242 4242 4242` as often as it is one run, and an IBAN is printed in
/// groups of four. Whitespace-separated tokenisation turns both into four
/// unrelated short numbers that no checksum can be run against, so the pass
/// would simply never find a card typed the way a card is written.
///
/// Returns byte ranges over `line`; the caller strips the separators.
pub fn digit_runs(line: &str) -> Vec<Range<usize>> {
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;

    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }

        // A leading `+` belongs to the number. It is also the single strongest
        // piece of evidence a run of digits is a telephone number — written
        // internationally, nothing else looks like that — so dropping it here
        // would demote every `+44 20 …` to a guess that covers nothing.
        let start = if index > 0 && bytes[index - 1] == b'+' {
            index - 1
        } else {
            index
        };
        let mut end = index;
        while end < bytes.len() {
            if bytes[end].is_ascii_digit() {
                end += 1;
                continue;
            }
            // A single space or hyphen continues the run, but only when a digit
            // follows it. Without that lookahead `4242 ` at the end of a line
            // swallows the space, and `total: 42 - 7` becomes one number.
            let joins = matches!(bytes[end], b' ' | b'-')
                && bytes.get(end + 1).is_some_and(u8::is_ascii_digit);
            if joins {
                end += 2;
            } else {
                break;
            }
        }

        out.push(start..end);
        index = end;
    }

    out
}

/// A run of exactly `units` alphanumeric characters starting at `start`, where
/// single spaces between groups are allowed and skipped.
///
/// For the formats printed in groups that are *not* all digits — an IBAN is
/// `GB82 WEST 1234 5698 7654 32`, so neither whitespace tokenisation nor
/// [`digit_runs`] can see it whole. A length is demanded up front rather than
/// consumed greedily because a greedy run would swallow the rest of the
/// sentence: every word after it is alphanumeric and separated by one space.
/// The caller knows the length from the country code, which is what makes this
/// precise instead of a guess.
///
/// Returns the byte range covering the run, or `None` if the line runs out or
/// hits punctuation first.
pub fn grouped_run(line: &str, start: usize, units: usize) -> Option<Range<usize>> {
    let bytes = line.as_bytes();
    let mut index = start;
    let mut end = start;
    let mut taken = 0;

    while index < bytes.len() && taken < units {
        if bytes[index].is_ascii_alphanumeric() {
            taken += 1;
            index += 1;
            end = index;
        } else if bytes[index] == b' '
            && bytes.get(index + 1).is_some_and(u8::is_ascii_alphanumeric)
        {
            index += 1;
        } else {
            break;
        }
    }

    (taken == units).then_some(start..end)
}

/// Up to [`CONTEXT_CHARS`] of the line before `byte`, lowercased.
///
/// What the entropy rules gate on. A twenty-character base64 token is a secret
/// when it follows `token=` and is a cache-busting hash the rest of the time,
/// and nothing about the token itself can tell the two apart.
pub fn context_before(line: &str, byte: usize) -> String {
    let head = &line[..byte.min(line.len())];
    let start = head
        .char_indices()
        .rev()
        .take(CONTEXT_CHARS)
        .last()
        .map_or(0, |(index, _)| index);
    head[start..].to_lowercase()
}

/// The token with every separator and case difference removed.
///
/// What a finding is identified by across samples, and what is hashed into the
/// artefact. Deliberately lossy: `4242 4242 4242 4242` and `4242424242424242`
/// are the same card, and an OCR read repaired from `O` to `0` has to hash the
/// same as a clean read of the same number or the two become separate masks
/// that flicker between each other.
pub fn canonical(text: &str) -> String {
    const DROPPED: &[char] = &['-', '_', '.', '(', ')', '/', '\u{00a0}'];

    text.chars()
        .filter(|c| !c.is_whitespace() && !DROPPED.contains(c))
        .flat_map(char::to_lowercase)
        .collect()
}
