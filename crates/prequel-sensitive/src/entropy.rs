//! Shannon entropy over a token, and the character census the secret rules
//! gate on.

/// Shannon entropy of a token, in bits per character.
///
/// The standard measure of "does this look random". A word has roughly 3 bits
/// per character, a hex string about 4, and base64 nearer 5.5 — but the useful
/// signal is the gap between a token and English, not the absolute number, and
/// a short token cannot have high entropy however random it is. Hence the
/// length floors in [`crate::secrets`] rather than here.
pub fn shannon(token: &str) -> f32 {
    let mut counts = [0u32; 256];
    let mut total = 0u32;

    for byte in token.bytes() {
        counts[byte as usize] += 1;
        total += 1;
    }
    if total == 0 {
        return 0.0;
    }

    let total = total as f32;
    -counts
        .iter()
        .filter(|count| **count > 0)
        .map(|count| {
            let p = *count as f32 / total;
            p * p.log2()
        })
        .sum::<f32>()
}

/// What sorts of character a token is made of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Census {
    pub lower: usize,
    pub upper: usize,
    pub digits: usize,
    pub symbols: usize,
    pub other: usize,
}

impl Census {
    pub fn of(token: &str) -> Self {
        let mut census = Self::default();
        for ch in token.chars() {
            match ch {
                'a'..='z' => census.lower += 1,
                'A'..='Z' => census.upper += 1,
                '0'..='9' => census.digits += 1,
                '-' | '_' | '+' | '/' | '=' | '.' => census.symbols += 1,
                _ => census.other += 1,
            }
        }
        census
    }

    /// Whether every character is from one class.
    ///
    /// A run of only letters is a word; a run of only digits is a number, and
    /// is handled by the card and phone rules rather than by entropy. Mixing is
    /// most of what distinguishes a generated token from a long word.
    pub fn single_class(self) -> bool {
        let used = [self.lower + self.upper, self.digits, self.symbols]
            .iter()
            .filter(|count| **count > 0)
            .count();
        used <= 1
    }

    /// Whether the token could be hexadecimal.
    ///
    /// Its own question because hex has a lower entropy ceiling than base64 —
    /// sixteen symbols is 4 bits a character at most — so a hex token needs a
    /// different threshold and a longer minimum to mean anything.
    pub fn hex_like(self, token: &str) -> bool {
        self.other == 0
            && self.symbols == 0
            && token.bytes().all(|b| b.is_ascii_hexdigit())
            && self.digits > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_word_scores_below_a_generated_token() {
        let word = shannon("configuration");
        let generated = shannon("k3Jx9Qm2VpL7bR4tZwN8");
        assert!(word < generated, "{word} should be below {generated}");
        assert!(generated > 3.4, "{generated} should clear the base64 gate");
    }

    #[test]
    fn a_repeated_character_scores_nothing() {
        assert_eq!(shannon("aaaaaaaa"), 0.0);
    }

    #[test]
    fn an_empty_token_is_not_a_division_by_zero() {
        assert_eq!(shannon(""), 0.0);
    }

    #[test]
    fn a_hex_sha_is_hex_like_and_a_base64_token_is_not() {
        let sha = "356a192b7913b04c54574d18c28d46e6395428ab";
        assert!(Census::of(sha).hex_like(sha));

        let token = "k3Jx9Qm2VpL7bR4tZwN8";
        assert!(!Census::of(token).hex_like(token));
    }

    #[test]
    fn a_word_is_a_single_class_and_a_token_is_not() {
        assert!(Census::of("configuration").single_class());
        assert!(Census::of("4242424242424242").single_class());
        assert!(!Census::of("k3Jx9Qm2VpL7bR4tZwN8").single_class());
    }
}
