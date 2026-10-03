//! Email addresses, web addresses and phone numbers.
//!
//! The easy category and the hard one, side by side. An email address has a
//! shape nothing else has. A phone number is a run of digits, which is also
//! what a time, a date, a version, a screen resolution, a port, a line number,
//! a price and an order id are — so a phone is the lowest-precision rule here
//! and sits below the threshold at which a mask is applied unless it is written
//! internationally.

/// Top-level domains common enough that a bare `host/path` with one is a web
/// address rather than a filename.
///
/// A curated list rather than the full IANA set, and deliberately: `.sh`,
/// `.pl`, `.rs`, `.ts`, `.so`, `.md` and `.py` are all real top-level domains
/// and all far more often file extensions on a developer's screen. Including
/// them turns every sidebar in an editor into a list of web addresses.
const COMMON_TLDS: &[&str] = &[
    "com", "org", "net", "edu", "gov", "mil", "int", "io", "co", "ai", "app", "dev", "uk", "de",
    "fr", "nl", "eu", "ca", "au", "in", "jp", "cn", "br", "es", "it", "se", "no", "dk", "fi",
    "ch", "at", "be", "ie", "nz", "za", "mx", "info", "biz", "me", "tv", "cc", "xyz", "cloud",
    "store", "online", "tech", "site", "blog", "news",
];

/// Whether `token` is an email address.
pub fn is_email(token: &str) -> bool {
    let mut parts = token.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else {
        // Exactly one `@`. Two is not an address, and a token with none is
        // handled by the other rules.
        return false;
    };

    if local.is_empty() || local.len() > 64 {
        return false;
    }
    if !local
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"._%+-'".contains(&b))
    {
        return false;
    }

    is_hostname(domain, true)
}

/// Whether `token` is a web address.
///
/// Requires one of three things: a scheme, a `www.` prefix, or a recognised
/// top-level domain followed by a path. Without that gate `file.txt`,
/// `Chart.js`, `v1.2.3`, `e.g.` and every `.tsx` in a file tree is a web
/// address, and a recording of an editor is covered in grey boxes.
pub fn is_url(token: &str) -> bool {
    if let Some(rest) = token
        .strip_prefix("https://")
        .or_else(|| token.strip_prefix("http://"))
        .or_else(|| token.strip_prefix("ftp://"))
    {
        let host = rest.split(['/', '?', '#']).next().unwrap_or(rest);
        // Not `is_hostname(.., true)`: `http://localhost:3000` is a web address
        // and has no dot in it at all.
        return !host.is_empty() && is_hostname(host, false);
    }

    let (host, path) = match token.split_once('/') {
        Some((host, path)) => (host, Some(path)),
        None => (token, None),
    };

    if host.starts_with("www.") {
        return is_hostname(host, true);
    }

    // A bare host needs both a known top-level domain and a path, so
    // `example.com` in prose stays prose and `example.com/pricing` is a link.
    path.is_some() && is_hostname(host, true) && has_common_tld(host)
}

fn has_common_tld(host: &str) -> bool {
    host.rsplit('.')
        .next()
        .is_some_and(|tld| COMMON_TLDS.contains(&tld.to_ascii_lowercase().as_str()))
}

/// Whether `host` is a plausible hostname. `dotted` requires at least two
/// labels, which an email domain must have and `localhost` must not.
fn is_hostname(host: &str, dotted: bool) -> bool {
    // A port is part of an authority, not of a name.
    let host = host.split_once(':').map_or(host, |(name, _)| name);

    if host.is_empty() || host.len() > 253 {
        return false;
    }

    let labels: Vec<&str> = host.split('.').collect();
    if dotted && labels.len() < 2 {
        return false;
    }

    if dotted {
        // The last label is the top-level domain: letters only, two or more.
        // This is what keeps an IPv4 address and `1.2.3` out.
        let tld = labels[labels.len() - 1];
        if tld.len() < 2 || !tld.bytes().all(|b| b.is_ascii_alphabetic()) {
            return false;
        }
    }

    labels.iter().all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

/// How sure we are that a run of digits is a telephone number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phone {
    /// Written internationally, with a leading `+`. Unmistakable.
    International,
    /// Grouped the way a phone number is grouped, or named as one by the text
    /// beside it. Plausible, and not enough on its own to cover something.
    Likely,
}

/// Whether `raw` — a run of digits and the punctuation phone numbers carry — is
/// a telephone number, and how sure we are.
///
/// `context` is the lowercased text just before it on the line.
pub fn classify_phone(raw: &str, context: &str) -> Option<Phone> {
    let international = raw.trim_start().starts_with('+');
    let digits: String = raw.chars().filter(char::is_ascii_digit).collect();

    // E.164 caps a subscriber number at fifteen digits; below seven there is no
    // telephone network anywhere that routes it.
    if !(7..=15).contains(&digits.len()) {
        return None;
    }

    if is_not_a_phone(raw) {
        return None;
    }

    if international {
        return Some(Phone::International);
    }

    if grouped_like_a_phone(raw) || named_as_a_phone(context) {
        return Some(Phone::Likely);
    }

    None
}

/// The things a seven-to-fifteen digit run is when it is not a phone number.
fn is_not_a_phone(raw: &str) -> bool {
    // A time or a duration. Two colon-separated groups is never a number
    // anybody dials.
    if raw.matches(':').count() >= 1 {
        return true;
    }

    // A version, a decimal, an IP address, a build number.
    if raw.contains('.') {
        return true;
    }

    // A resolution or a dimension pair.
    if raw.contains('x') || raw.contains('\u{00d7}') {
        return true;
    }

    // A date written as digits and hyphens. `2024-01-15` is ten characters of
    // which eight are digits, which otherwise reads as a grouped phone number.
    if looks_like_a_date(raw) {
        return true;
    }

    false
}

fn looks_like_a_date(raw: &str) -> bool {
    let groups: Vec<&str> = raw.split(['-', '/']).collect();
    if groups.len() != 3 {
        return false;
    }
    // `2024-01-15` or `15/01/2024`: a four-digit year at either end and two
    // short groups. A phone number is not grouped 4-2-2 or 2-2-4.
    let widths: Vec<usize> = groups.iter().map(|g| g.len()).collect();
    matches!(widths.as_slice(), [4, 2, 2] | [2, 2, 4])
        && groups.iter().all(|g| g.bytes().all(|b| b.is_ascii_digit()))
}

/// Whether the punctuation groups the digits the way a phone number is
/// grouped — which is most of what distinguishes one from an order id.
fn grouped_like_a_phone(raw: &str) -> bool {
    let shape: String = raw
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| if c.is_ascii_digit() { 'd' } else { c })
        .collect();

    [
        "(ddd)ddd-dddd",
        "ddd-ddd-dddd",
        "ddd.ddd.dddd",
        "dddd-ddd-ddd",
        "ddddd-dddddd",
        "dd-dddd-dddd",
        "(d)ddd-ddd-dddd",
    ]
    .contains(&shape.as_str())
}

fn named_as_a_phone(context: &str) -> bool {
    ["tel", "phone", "mobile", "cell", "call", "fax", "whatsapp"]
        .iter()
        .any(|word| context.contains(word))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_an_email() {
        for token in [
            "a@b.com",
            "jane.doe@example.co.uk",
            "jane+newsletter@example.com",
            "j_doe99@mail.example.org",
        ] {
            assert!(is_email(token), "{token} should be an email");
        }
    }

    #[test]
    fn rejects_things_that_are_not_emails() {
        for token in [
            "jane@localhost",
            "jane@@example.com",
            "@example.com",
            "jane@example",
            "jane.doe",
            "jane@1.2.3.4",
        ] {
            assert!(!is_email(token), "{token} should not be an email");
        }
    }

    #[test]
    fn finds_a_web_address() {
        for token in [
            "https://example.com",
            "http://localhost:3000",
            "https://example.com/pricing?ref=a",
            "www.example.com",
            "example.com/pricing",
        ] {
            assert!(is_url(token), "{token} should be a web address");
        }
    }

    #[test]
    fn leaves_a_file_tree_alone() {
        // The reason the top-level-domain list is curated. Every one of these
        // has a real top-level domain as its extension, and every one of them
        // is a filename in a sidebar.
        for token in [
            "Chart.js",
            "index.ts",
            "main.rs",
            "build.sh",
            "setup.py",
            "README.md",
            "lib.so",
            "v1.2.3",
            "e.g.",
            "example.com",
        ] {
            assert!(!is_url(token), "{token} should not be a web address");
        }
    }

    #[test]
    fn an_international_number_needs_no_context() {
        assert_eq!(
            classify_phone("+44 20 7123 4567", ""),
            Some(Phone::International)
        );
        assert_eq!(
            classify_phone("+1 415 555 2671", ""),
            Some(Phone::International)
        );
    }

    #[test]
    fn a_local_number_needs_grouping_or_a_name() {
        assert_eq!(classify_phone("(415) 555-2671", ""), Some(Phone::Likely));
        assert_eq!(classify_phone("415-555-2671", ""), Some(Phone::Likely));
        // Ungrouped and unnamed, this is an order number.
        assert_eq!(classify_phone("4155552671", ""), None);
        // Named, it is a phone number.
        assert_eq!(classify_phone("4155552671", "mobile: "), Some(Phone::Likely));
    }

    #[test]
    fn does_not_dial_a_dashboard() {
        // Every one of these is a seven-to-fifteen digit run on a screen.
        for (raw, context) in [
            ("2024-01-15", "created "),
            ("1920x1080", "resolution "),
            ("01:23:45:67", "timecode "),
            ("1.2.3.4", "host "),
            ("12345678", "order "),
            ("1700000000000", "timestamp "),
        ] {
            assert_eq!(classify_phone(raw, context), None, "{raw}");
        }
    }
}
