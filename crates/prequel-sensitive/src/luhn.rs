//! Card numbers: the Luhn check, and the issuer prefixes that make it mean
//! something.
//!
//! Luhn on its own is not evidence. It is a single mod-10 check digit, so
//! roughly one in ten arbitrary sixteen-digit numbers passes it — and a screen
//! recording of a dashboard is full of arbitrary long numbers: order ids,
//! invoice numbers, user ids, timestamps in milliseconds. Masking one in ten of
//! them is a steady drizzle of covers over the thing the user was demonstrating,
//! which is how this feature gets switched off and never switched back on.
//!
//! So a card is Luhn **and** a known issuer prefix **and** a plausible length
//! for that issuer. All three.

/// Issuer prefix ranges, as `(inclusive low, inclusive high, digits of the
/// prefix, valid lengths)`.
///
/// Ranges rather than string prefixes so Mastercard's 2221-2720 block is one
/// row instead of five hundred. Lengths are per issuer because a 16-digit Amex
/// is not an Amex — the length is part of the evidence, not a sanity check.
const ISSUERS: &[(u32, u32, u32, &[usize])] = &[
    // Visa.
    (4, 4, 1, &[13, 16, 19]),
    // Mastercard, both the old 51-55 block and the 2-series.
    (51, 55, 2, &[16]),
    (2221, 2720, 4, &[16]),
    // American Express.
    (34, 34, 2, &[15]),
    (37, 37, 2, &[15]),
    // Discover.
    (6011, 6011, 4, &[16, 19]),
    (644, 649, 3, &[16, 19]),
    (65, 65, 2, &[16, 19]),
    (622126, 622925, 6, &[16, 19]),
    // JCB.
    (3528, 3589, 4, &[16, 17, 18, 19]),
    // Diners Club.
    (300, 305, 3, &[14, 16, 19]),
    (3095, 3095, 4, &[14, 16, 19]),
    (36, 36, 2, &[14, 16, 19]),
    (38, 39, 2, &[14, 16, 19]),
    // UnionPay.
    (62, 62, 2, &[16, 17, 18, 19]),
];

/// Whether `digits` is a plausible card number.
///
/// `digits` must be nothing but ASCII digits — the caller strips the spaces and
/// hyphens a card is written with.
pub fn is_card(digits: &str) -> bool {
    let len = digits.len();
    if !(13..=19).contains(&len) || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }

    // A number whose digits are all the same passes Luhn surprisingly often
    // and is never a card. `0000000000000000` is a placeholder in every demo
    // dashboard ever built.
    if digits.bytes().all(|b| b == digits.as_bytes()[0]) {
        return false;
    }

    issuer_allows(digits, len) && luhn(digits)
}

fn issuer_allows(digits: &str, len: usize) -> bool {
    ISSUERS.iter().any(|(low, high, width, lengths)| {
        if !lengths.contains(&len) {
            return false;
        }
        digits
            .get(..*width as usize)
            .and_then(|head| head.parse::<u32>().ok())
            .is_some_and(|value| (*low..=*high).contains(&value))
    })
}

/// The Luhn mod-10 checksum.
///
/// Doubling every second digit from the right, subtracting 9 from anything over
/// 9, and requiring the total to be a multiple of 10.
pub fn luhn(digits: &str) -> bool {
    let mut sum = 0u32;
    for (index, byte) in digits.bytes().rev().enumerate() {
        let mut value = u32::from(byte - b'0');
        if index % 2 == 1 {
            value *= 2;
            if value > 9 {
                value -= 9;
            }
        }
        sum += value;
    }
    sum.is_multiple_of(10)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_published_test_numbers() {
        // The card numbers every payment provider publishes for testing, which
        // are also the ones most likely to be on screen in a recording.
        for number in [
            "4242424242424242",
            "4000056655665556",
            "5555555555554444",
            "2223003122003222",
            "378282246310005",
            "371449635398431",
            "6011111111111117",
            "3566002020360505",
            "30569309025904",
        ] {
            assert!(is_card(number), "{number} should be a card");
        }
    }

    #[test]
    fn rejects_a_single_wrong_digit() {
        assert!(!is_card("4242424242424243"));
    }

    #[test]
    fn rejects_luhn_without_an_issuer() {
        // Passes Luhn, has no issuer prefix: an order number, not a card.
        assert!(luhn("1234567812345670"));
        assert!(!is_card("1234567812345670"));
    }

    #[test]
    fn rejects_a_wrong_length_for_the_issuer() {
        // Amex's prefix, Luhn-correct, and sixteen digits long. Amex issues
        // fifteen, so the length is what rules this out — which is the point of
        // keeping lengths per issuer rather than as one 13-to-19 range.
        assert!(luhn("3782822463100052"));
        assert!(!is_card("3782822463100052"));
    }

    #[test]
    fn rejects_a_repeated_digit() {
        assert!(luhn("0000000000000000"));
        assert!(!is_card("0000000000000000"));
    }
}
