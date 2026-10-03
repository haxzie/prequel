//! National identity numbers.
//!
//! The shipped set is deliberately small, and every member of it has either a
//! check digit or structural rules strict enough to stand in for one. That is a
//! product decision as much as a technical one: every country added is a
//! validator plus an assumption about which country the user is in, and every
//! country left out is somebody who read "national ID numbers" on a toggle and
//! believed they were covered. A short list the panel can name beats a long
//! list that is wrong about half of it.
//!
//! The format without a checksum — a bare nine-digit run — is the reason the US
//! social security number here needs either its separators or a keyword beside
//! it. Nine digits with no structure is an order number far more often than it
//! is anybody's SSN.

/// Which identity number a string is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NationalId {
    UsSocialSecurity,
    UkNationalInsurance,
    IndiaAadhaar,
    CanadaSocialInsurance,
    BrazilCpf,
    SpainDni,
}

impl NationalId {
    /// What the review list calls it.
    pub fn label(self) -> &'static str {
        match self {
            Self::UsSocialSecurity => "Social security number",
            Self::UkNationalInsurance => "National insurance number",
            Self::IndiaAadhaar => "Aadhaar number",
            Self::CanadaSocialInsurance => "Social insurance number",
            Self::BrazilCpf => "CPF number",
            Self::SpainDni => "DNI number",
        }
    }
}

/// Whether `raw` is a national identity number.
///
/// `raw` is the token as it appeared, separators and all — the separators are
/// evidence for the formats that have no checksum. `context` is the lowercased
/// text just before it.
pub fn classify(raw: &str, context: &str) -> Option<NationalId> {
    let compact: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_uppercase())
        .collect();

    if is_aadhaar(&compact) {
        return Some(NationalId::IndiaAadhaar);
    }
    if is_cpf(&compact) {
        return Some(NationalId::BrazilCpf);
    }
    if is_nino(&compact) {
        return Some(NationalId::UkNationalInsurance);
    }
    if is_dni(&compact) {
        return Some(NationalId::SpainDni);
    }
    if is_ssn(raw, &compact, context) {
        return Some(NationalId::UsSocialSecurity);
    }
    if is_sin(&compact, context) {
        return Some(NationalId::CanadaSocialInsurance);
    }

    None
}

/// India's Aadhaar: twelve digits with a Verhoeff check digit.
fn is_aadhaar(compact: &str) -> bool {
    // The first digit is never 0 or 1, which rules out a twelve-digit
    // timestamp in milliseconds — the commonest twelve-digit run on a screen.
    compact.len() == 12
        && compact.bytes().all(|b| b.is_ascii_digit())
        && !matches!(compact.as_bytes()[0], b'0' | b'1')
        && verhoeff(compact)
}

/// Brazil's CPF: nine digits and two check digits, each a weighted sum mod 11.
fn is_cpf(compact: &str) -> bool {
    if compact.len() != 11 || !compact.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    // Every repeated-digit string satisfies both check digits and none is a
    // real CPF; `111.111.111-11` is the placeholder in every Brazilian form.
    if compact.bytes().all(|b| b == compact.as_bytes()[0]) {
        return false;
    }

    let digits: Vec<u32> = compact.bytes().map(|b| u32::from(b - b'0')).collect();
    cpf_check(&digits[..9]) == digits[9] && cpf_check(&digits[..10]) == digits[10]
}

fn cpf_check(digits: &[u32]) -> u32 {
    let start = digits.len() as u32 + 1;
    let sum: u32 = digits
        .iter()
        .enumerate()
        .map(|(index, digit)| digit * (start - index as u32))
        .sum();
    let remainder = (sum * 10) % 11;
    if remainder == 10 { 0 } else { remainder }
}

/// The UK's national insurance number: two prefix letters, six digits, a suffix
/// letter. No checksum, but the letter rules are tight enough to serve.
fn is_nino(compact: &str) -> bool {
    if compact.len() != 9 {
        return false;
    }
    let bytes = compact.as_bytes();
    if !bytes[..2].iter().all(u8::is_ascii_alphabetic)
        || !bytes[2..8].iter().all(u8::is_ascii_digit)
        || !bytes[8].is_ascii_alphabetic()
    {
        return false;
    }

    // `D`, `F`, `I`, `Q`, `U` and `V` are never used in either prefix position,
    // `O` never in the second, and the pairs `BG`, `GB`, `NK`, `KN`, `TN`,
    // `NT` and `ZZ` are not allocated.
    const FORBIDDEN: &[u8] = b"DFIQUV";
    let prefix = &compact[..2];
    if FORBIDDEN.contains(&bytes[0]) || FORBIDDEN.contains(&bytes[1]) || bytes[1] == b'O' {
        return false;
    }
    if ["BG", "GB", "NK", "KN", "TN", "NT", "ZZ"].contains(&prefix) {
        return false;
    }

    // The suffix is only ever A to D.
    matches!(bytes[8], b'A'..=b'D')
}

/// Spain's DNI: eight digits and a check letter from a mod-23 table.
fn is_dni(compact: &str) -> bool {
    if compact.len() != 9 {
        return false;
    }
    let (digits, letter) = compact.split_at(8);
    if !digits.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }

    const TABLE: &[u8] = b"TRWAGMYFPDXBNJZSQVHLCKE";
    digits
        .parse::<u32>()
        .is_ok_and(|value| TABLE[(value % 23) as usize] == letter.as_bytes()[0])
}

/// The US social security number.
///
/// No checksum exists, so this leans entirely on structure plus evidence that
/// the number is being presented as an SSN: either it is written with its
/// hyphens, or the text beside it says what it is. A bare nine-digit run with
/// neither is left alone, because that is an order id.
fn is_ssn(raw: &str, compact: &str, context: &str) -> bool {
    if compact.len() != 9 || !compact.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }

    let bytes = compact.as_bytes();
    let area = &compact[..3];
    let group = &compact[3..5];
    let serial = &compact[5..];

    // Ranges the administration has never issued.
    if area == "000" || area == "666" || bytes[0] == b'9' {
        return false;
    }
    if group == "00" || serial == "0000" {
        return false;
    }

    let hyphenated = raw.len() == 11 && raw.as_bytes()[3] == b'-' && raw.as_bytes()[6] == b'-';
    let named = ["ssn", "social security", "soc sec"]
        .iter()
        .any(|word| context.contains(word));

    hyphenated || named
}

/// Canada's social insurance number: nine digits with a Luhn check.
///
/// Luhn over nine digits is weak evidence on its own — one in ten nine-digit
/// runs passes — so this also needs to be named, for the same reason the SSN
/// does.
fn is_sin(compact: &str, context: &str) -> bool {
    if compact.len() != 9 || !compact.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    // The first digit is never 0 or 8.
    if matches!(compact.as_bytes()[0], b'0' | b'8') {
        return false;
    }

    let named = ["sin", "social insurance"]
        .iter()
        .any(|word| context.contains(word));

    named && crate::luhn::luhn(compact)
}

/// The Verhoeff checksum, which Aadhaar uses.
///
/// Stronger than Luhn: it catches every single-digit error and every
/// transposition of adjacent digits, which is what OCR gets wrong.
fn verhoeff(digits: &str) -> bool {
    const D5: [[usize; 10]; 10] = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
        [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
        [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
        [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
        [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
        [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
        [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
        [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
        [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    ];
    const PERM: [[usize; 10]; 8] = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
        [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
        [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
        [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
        [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
        [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
        [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
    ];
    const INV: [usize; 10] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

    let mut check = 0usize;
    for (index, byte) in digits.bytes().rev().enumerate() {
        let digit = (byte - b'0') as usize;
        check = D5[check][PERM[index % 8][digit]];
    }
    // The inverse is here so this reads as the textbook algorithm rather than
    // as a simplification of it; a valid number leaves the accumulator at 0.
    INV[check] == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_cpf() {
        // A CPF whose two check digits are correct.
        assert_eq!(classify("529.982.247-25", ""), Some(NationalId::BrazilCpf));
        // One digit changed.
        assert_eq!(classify("529.982.247-26", ""), None);
        // The placeholder everybody types.
        assert_eq!(classify("111.111.111-11", ""), None);
    }

    #[test]
    fn finds_a_dni() {
        assert_eq!(classify("12345678Z", ""), Some(NationalId::SpainDni));
        // Wrong check letter.
        assert_eq!(classify("12345678A", ""), None);
    }

    #[test]
    fn finds_a_national_insurance_number() {
        // Printed with its spaces, which is how it appears on a payslip.
        assert_eq!(
            classify("AB 12 34 56 C", ""),
            Some(NationalId::UkNationalInsurance)
        );
        // `D` is never a prefix letter, in either position.
        assert_eq!(classify("DB123456C", ""), None);
        assert_eq!(classify("AD123456C", ""), None);
        // `ZZ` is not allocated.
        assert_eq!(classify("ZZ123456C", ""), None);
        // The suffix only runs A to D.
        assert_eq!(classify("AB123456E", ""), None);
    }

    #[test]
    fn a_social_security_number_needs_its_hyphens_or_a_name() {
        assert_eq!(
            classify("123-45-6789", ""),
            Some(NationalId::UsSocialSecurity)
        );
        assert_eq!(
            classify("123456789", "ssn "),
            Some(NationalId::UsSocialSecurity)
        );
        // The thing that makes this rule safe: nine bare digits beside nothing
        // is an order number, and there are a great many of them on a screen.
        assert_eq!(classify("123456789", "order "), None);
    }

    #[test]
    fn rejects_unissued_social_security_ranges() {
        for raw in ["000-45-6789", "666-45-6789", "900-45-6789", "123-00-6789", "123-45-0000"] {
            assert_eq!(classify(raw, ""), None, "{raw}");
        }
    }

    #[test]
    fn a_timestamp_is_not_an_aadhaar() {
        // Thirteen digits is the usual millisecond timestamp, but a ten-digit
        // second timestamp padded to twelve starts with a 1 — which is why the
        // leading digit rule is there.
        assert_eq!(classify("170000000000", ""), None);
    }

    #[test]
    fn the_verhoeff_check_catches_a_transposition() {
        // Build a number the checksum accepts, then swap two adjacent digits.
        // Whichever concrete value is valid, a transposition of it must not be.
        let valid = (2..10u64)
            .flat_map(|lead| (0..1_000u64).map(move |tail| format!("{lead}{tail:011}")))
            .find(|candidate| verhoeff(candidate))
            .expect("a twelve-digit Verhoeff-valid number exists");

        let mut swapped: Vec<u8> = valid.clone().into_bytes();
        let last = swapped.len() - 1;
        swapped.swap(last - 1, last);
        let swapped = String::from_utf8(swapped).expect("digits stay ascii");

        if swapped != valid {
            assert!(!verhoeff(&swapped), "{swapped} should fail after a swap");
        }
    }
}
