//! Repairing a word list, with no Apple framework in sight.
//!
//! Its own module, and free of every `extern` in `lib.rs`, for the reason
//! `prequel-session` is free of them: this is the arithmetic that goes wrong
//! quietly, and it is only testable if it can run without a speech model, a
//! microphone or a signed bundle.
//!
//! The chunked engine is what makes this necessary. `SFSpeechRecognizer` is fed
//! forty seconds at a time and each chunk's times start again from zero, so the
//! Swift side adds the chunk's offset — and a cut that had to land mid-word
//! leaves the same word heard twice, once at the end of one chunk and once at
//! the start of the next.
use crate::Word;

/// How much two words may overlap before the later one is taken as a repeat.
///
/// Generous on purpose. A seam repeat is the same word recognised twice over
/// nearly the same audio, so the overlap is most of its length; two genuinely
/// different words never share more than the edge of a boundary.
const OVERLAP: f64 = 0.6;

/// Sorts a word list, drops what cannot be drawn, and removes seam repeats.
///
/// Applied to every engine's output rather than only the chunked one. A list
/// that is already clean comes through unchanged, and the cost of checking is
/// nothing next to the cost of a caption that flickers.
pub fn tidy(mut words: Vec<Word>) -> Vec<Word> {
    words.retain(|word| {
        // A word with no duration can never be the active one — `captionAt`
        // tests a half-open span — so it would be a hole in the highlight.
        word.at.is_finite() && word.end.is_finite() && word.end > word.at && !word.text.is_empty()
    });

    words.sort_by(|a, b| a.at.total_cmp(&b.at));

    let mut kept: Vec<Word> = Vec::with_capacity(words.len());

    for word in words {
        if let Some(last) = kept.last()
            && repeats(last, &word)
        {
            continue;
        }
        kept.push(word);
    }

    kept
}

/// Whether `next` is `last` heard a second time across a chunk boundary.
fn repeats(last: &Word, next: &Word) -> bool {
    if !last.text.eq_ignore_ascii_case(&next.text) {
        return false;
    }

    let overlap = last.end.min(next.end) - next.at.max(last.at);
    if overlap <= 0.0 {
        return false;
    }

    let shorter = (last.end - last.at).min(next.end - next.at);
    shorter > 0.0 && overlap / shorter >= OVERLAP
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(at: f64, end: f64, text: &str) -> Word {
        Word {
            at,
            end,
            text: text.to_owned(),
            confidence: 1.0,
        }
    }

    #[test]
    fn leaves_a_clean_list_alone() {
        let words = vec![word(0.0, 0.5, "one"), word(0.5, 1.0, "two")];

        assert_eq!(tidy(words.clone()), words);
    }

    #[test]
    fn puts_a_stray_word_back_in_order() {
        // Grouping and the per-frame lookup both walk these in order, so one
        // word out of place is a caption that flickers rather than bad data.
        let tidied = tidy(vec![word(1.0, 1.5, "second"), word(0.0, 0.5, "first")]);

        assert_eq!(
            tidied.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(),
            ["first", "second"]
        );
    }

    #[test]
    fn drops_a_word_heard_twice_across_a_seam() {
        // The chunk boundary had to fall mid-word, so both halves recognised
        // it. Two identical captions a frame apart is what that looks like.
        let tidied = tidy(vec![
            word(39.5, 40.0, "boundary"),
            word(39.6, 40.1, "boundary"),
            word(40.2, 40.6, "after"),
        ]);

        assert_eq!(tidied.len(), 2);
        assert_eq!(tidied[0].at, 39.5);
        assert_eq!(tidied[1].text, "after");
    }

    #[test]
    fn keeps_a_word_genuinely_said_twice() {
        // "very, very good". Same word, no overlap, and dropping the second is
        // a transcript that says something the speaker did not.
        let tidied = tidy(vec![word(0.0, 0.4, "very"), word(0.45, 0.85, "very")]);

        assert_eq!(tidied.len(), 2);
    }

    #[test]
    fn keeps_two_different_words_that_touch() {
        let tidied = tidy(vec![word(0.0, 0.5, "one"), word(0.4, 0.9, "two")]);

        assert_eq!(tidied.len(), 2);
    }

    #[test]
    fn drops_what_cannot_be_drawn() {
        // A zero-length word can never be the active one, so it is a hole in
        // the highlight rather than a word.
        let tidied = tidy(vec![
            word(0.0, 0.0, "instant"),
            word(1.0, 0.5, "backwards"),
            word(2.0, 2.5, ""),
            word(3.0, 3.5, "real"),
        ]);

        assert_eq!(tidied.len(), 1);
        assert_eq!(tidied[0].text, "real");
    }

    #[test]
    fn has_nothing_to_say_about_silence() {
        assert!(tidy(vec![]).is_empty());
    }
}
