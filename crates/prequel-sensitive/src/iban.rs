//! IBANs: mod-97-10, against a table of exact per-country lengths.
//!
//! The length table is not a sanity check, it is half the test. ISO 13616 gives
//! every country one exact length, and a truncated or over-read IBAN that still
//! happens to satisfy mod-97 is a real possibility at one in ninety-seven —
//! which over a long recording of a banking page is not rare enough to ignore.

/// Exact IBAN length per country code. A country absent from this table is not
/// an IBAN country, and a string that looks like one is something else.
const LENGTHS: &[(&str, usize)] = &[
    ("AD", 24), ("AE", 23), ("AL", 28), ("AT", 20), ("AZ", 28), ("BA", 20), ("BE", 16),
    ("BG", 22), ("BH", 22), ("BI", 27), ("BR", 29), ("BY", 28), ("CH", 21), ("CR", 22),
    ("CY", 28), ("CZ", 24), ("DE", 22), ("DJ", 27), ("DK", 18), ("DO", 28), ("EE", 20),
    ("EG", 29), ("ES", 24), ("FI", 18), ("FO", 18), ("FR", 27), ("GB", 22), ("GE", 22),
    ("GI", 23), ("GL", 18), ("GR", 27), ("GT", 28), ("HR", 21), ("HU", 28), ("IE", 22),
    ("IL", 23), ("IQ", 23), ("IS", 26), ("IT", 27), ("JO", 30), ("KW", 30), ("KZ", 20),
    ("LB", 28), ("LC", 32), ("LI", 21), ("LT", 20), ("LU", 20), ("LV", 21), ("LY", 25),
    ("MC", 27), ("MD", 24), ("ME", 22), ("MK", 19), ("MR", 27), ("MT", 31), ("MU", 30),
    ("NL", 18), ("NO", 15), ("PK", 24), ("PL", 28), ("PS", 29), ("PT", 25), ("QA", 29),
    ("RO", 24), ("RS", 22), ("RU", 33), ("SA", 24), ("SC", 31), ("SD", 18), ("SE", 24),
    ("SI", 19), ("SK", 24), ("SM", 27), ("SO", 23), ("ST", 25), ("SV", 28), ("TL", 23),
    ("TN", 24), ("TR", 26), ("UA", 29), ("VA", 22), ("VG", 24), ("XK", 20),
];

/// How long an IBAN from `country` is, if that country issues them.
///
/// Exported so the scanner can read a grouped IBAN: it needs to know how many
/// characters to gather across the spaces before it has anything to check.
pub fn required_length(country: &str) -> Option<usize> {
    LENGTHS
        .iter()
        .find(|(code, _)| *code == country)
        .map(|(_, length)| *length)
}

/// Whether `compact` is a valid IBAN.
///
/// `compact` must already have its spaces removed — an IBAN is printed in
/// groups of four and arrives from OCR that way.
pub fn is_iban(compact: &str) -> bool {
    if !compact.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return false;
    }

    // The length bound comes before any slicing, and not only for tidiness:
    // every two-letter word on screen — `on`, `it`, `to` — is alphanumeric and
    // has a two-character head that reads as a country code, so a check on the
    // country before a check on the length indexes past the end of the string
    // and brings the whole scan down. The shortest IBAN is Norway's fifteen and
    // the longest is Saint Lucia's thirty-two.
    if !(15..=34).contains(&compact.len()) {
        return false;
    }

    let upper = compact.to_ascii_uppercase();
    let country = &upper[..2];
    if !country.bytes().all(|b| b.is_ascii_alphabetic()) {
        return false;
    }

    // The check digits are digits. Without this, `DEADBEEF…` reaches the
    // modulus and the letter mapping below quietly turns it into a number.
    if !upper[2..4].bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }

    let Some((_, length)) = LENGTHS.iter().find(|(code, _)| *code == country) else {
        return false;
    };
    if upper.len() != *length {
        return false;
    }

    mod97(&upper) == 1
}

/// ISO 7064 mod-97-10 over an IBAN.
///
/// The first four characters move to the end, then each letter becomes its
/// position in the alphabet plus nine, and the whole thing is one enormous
/// decimal number taken mod 97. Folded a digit at a time because that number
/// is up to 70 digits long and will not fit in any integer here.
fn mod97(upper: &str) -> u32 {
    let (head, tail) = upper.split_at(4);
    let mut remainder = 0u32;

    for byte in tail.bytes().chain(head.bytes()) {
        if byte.is_ascii_digit() {
            remainder = remainder * 10 + u32::from(byte - b'0');
        } else {
            // 'A' is 10, so two decimal digits go in at once.
            let value = u32::from(byte - b'A') + 10;
            remainder = remainder * 100 + value;
        }
        remainder %= 97;
    }

    remainder
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_published_examples() {
        for iban in [
            "GB82WEST12345698765432",
            "DE89370400440532013000",
            "FR1420041010050500013M02606",
            "NL91ABNA0417164300",
            "CH9300762011623852957",
            "IT60X0542811101000000123456",
            "NO9386011117947",
        ] {
            assert!(is_iban(iban), "{iban} should be an IBAN");
        }
    }

    #[test]
    fn rejects_a_transposition() {
        // Two characters swapped. mod-97 exists to catch exactly this, which is
        // also the commonest way OCR gets a long string wrong.
        assert!(!is_iban("GB82WEST12345698765423"));
    }

    #[test]
    fn rejects_a_truncation_of_the_right_shape() {
        // Valid country, valid check digits, one character short. The length
        // table is the only thing that rejects this.
        assert!(!is_iban("GB82WEST1234569876543"));
    }

    #[test]
    fn rejects_an_unknown_country() {
        assert!(!is_iban("ZZ82WEST12345698765432"));
    }

    #[test]
    fn rejects_letters_where_the_check_digits_go() {
        assert!(!is_iban("DEADBEEF370400440532"));
    }
}
