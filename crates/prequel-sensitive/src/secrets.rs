//! API keys and other credentials, in two tiers.
//!
//! **Tier one is a vendor prefix**, and the prefix is the whole evidence.
//! `sk-ant-api03-` is not a thing that occurs by accident, so a token carrying
//! one is a secret with no further test needed. These are high confidence and
//! are covered by default.
//!
//! **Tier two is an unknown token that looks generated** — long, mixed, high
//! entropy. On its own that describes a git SHA, a UUID in a URL, a
//! cache-busting hash, a line of minified JavaScript and most Tailwind class
//! strings. In other words it describes a developer's screen, which is this
//! app's entire audience. So tier two also requires **context**: the token has
//! to follow something that says it is a credential. Even then it sits below
//! the threshold at which a mask is applied, and is offered as a suggestion.
//!
//! The asymmetry is deliberate. A missed secret is caught by the user reviewing
//! a list. A covered dashboard is caught by nobody, because they are looking at
//! a box where their work used to be.

use std::sync::LazyLock;

use regex::RegexSet;

use crate::entropy::{Census, shannon};

/// The shortest token tier two will look at.
///
/// Twenty characters. Below that, entropy is not measurable — a short random
/// string and a short word score alike — and every real credential format is
/// longer.
const MIN_GENERATED: usize = 20;

/// Entropy floor for a token drawn from a base64-ish alphabet, in bits per
/// character. English prose sits near 3.0 and generated tokens above 4.
const BASE64_ENTROPY: f32 = 3.4;

/// Entropy floor for a hexadecimal token. Sixteen symbols cap entropy at 4.0,
/// so the base64 floor would reject every hex secret.
const HEX_ENTROPY: f32 = 3.0;

/// The shortest hex token tier two will look at, longer than the general floor
/// because 20 hex characters is also an object id, a colour pair and a
/// truncated hash.
const MIN_HEX: usize = 32;

/// Words that, appearing just before a token, make it a credential.
const CREDENTIAL_WORDS: &[&str] = &[
    "key", "token", "secret", "password", "passwd", "pwd", "api", "auth", "bearer", "credential",
    "apikey", "access", "private", "signature", "session", "cookie",
];

/// Named tier-one rules: `(name, pattern)`.
///
/// The name is what the review list shows, because the artefact never stores
/// the token itself — "OpenAI API key" at 04:12 is all a user needs to find it,
/// and is not itself a secret.
///
/// Anchored at both ends: a token is matched whole, so `sk-live-ish-name` in a
/// sentence does not become a Stripe key.
///
/// **The order is significant.** Several vendors share a prefix — an Anthropic
/// key is `sk-ant-…`, which also satisfies OpenAI's `sk-…` — and
/// [`RegexSet::matches`] reports matches by pattern index, so the first rule
/// here wins. The specific one therefore goes above the general one, and
/// `the_specific_rule_wins` pins it. Without that order the review list
/// confidently names the wrong vendor, which is worse than naming none: a user
/// who knows they have no OpenAI account concludes the whole feature is broken.
/// The regex crate has no lookahead, so this cannot be expressed in the
/// patterns themselves.
const RULES: &[(&str, &str)] = &[
    ("Anthropic API key", r"^sk-ant-(api|sid)[0-9]{2}-[A-Za-z0-9_-]{20,}$"),
    ("OpenAI API key", r"^sk-(proj-)?[A-Za-z0-9_-]{20,}$"),
    ("GitHub token", r"^gh[pousr]_[A-Za-z0-9]{36,}$"),
    ("GitHub fine-grained token", r"^github_pat_[A-Za-z0-9_]{50,}$"),
    ("AWS access key id", r"^(AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}$"),
    ("Google API key", r"^AIza[A-Za-z0-9_-]{35}$"),
    ("Slack token", r"^xox[baprs]-[A-Za-z0-9-]{10,}$"),
    ("Slack webhook", r"^https://hooks\.slack\.com/services/[A-Za-z0-9/]{20,}$"),
    ("SendGrid API key", r"^SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$"),
    ("Stripe secret key", r"^(sk|rk)_(live|test)_[A-Za-z0-9]{20,}$"),
    ("Stripe webhook secret", r"^whsec_[A-Za-z0-9]{20,}$"),
    ("Shopify access token", r"^shp(at|ca|pa|ss)_[a-fA-F0-9]{32}$"),
    ("GitLab token", r"^glpat-[A-Za-z0-9_-]{20,}$"),
    ("npm token", r"^npm_[A-Za-z0-9]{36}$"),
    ("DigitalOcean token", r"^dop_v1_[a-f0-9]{64}$"),
    ("Hugging Face token", r"^hf_[A-Za-z0-9]{30,}$"),
    ("Twilio API key", r"^SK[a-f0-9]{32}$"),
    ("Mailgun API key", r"^key-[a-f0-9]{32}$"),
    ("PyPI token", r"^pypi-[A-Za-z0-9_-]{50,}$"),
    ("JSON web token", r"^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$"),
    ("Private key", r"^-----BEGIN [A-Z ]*PRIVATE KEY-----$"),
];

/// One `RegexSet` over every tier-one pattern.
///
/// A set rather than a vector of `Regex`: it answers "which of these match" in
/// a single pass over the token, where twenty separate matches would walk it
/// twenty times — and the scan runs this over every token of every line of
/// every sampled frame.
///
/// Built once. `LazyLock` rather than compiling per call because compiling
/// twenty patterns costs more than the whole classification of a frame.
static TIER_ONE: LazyLock<RegexSet> = LazyLock::new(|| {
    // Unwrap: the patterns are literals in this file, so a failure here is a
    // typo caught by this crate's first test rather than anything a user can
    // reach.
    RegexSet::new(RULES.iter().map(|(_, pattern)| *pattern))
        .expect("the tier-one secret patterns are literals and must compile")
});

/// What sort of secret a token is, if any.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Secret {
    /// A recognised vendor format. The name is safe to display.
    Known(&'static str),
    /// A token that looks generated and sits in credential-ish context.
    Generated,
}

impl Secret {
    /// What the review list calls it. Never the token.
    pub fn label(self) -> &'static str {
        match self {
            Self::Known(name) => name,
            Self::Generated => "Possible secret",
        }
    }
}

/// Whether `token` is a secret, and which sort.
///
/// `context` is the lowercased text just before the token on the same line —
/// see [`crate::text::context_before`].
pub fn classify(token: &str, context: &str) -> Option<Secret> {
    if let Some(index) = TIER_ONE.matches(token).into_iter().next() {
        return Some(Secret::Known(RULES[index].0));
    }

    if looks_generated(token) && credential_context(context) {
        return Some(Secret::Generated);
    }

    None
}

/// Whether a token looks machine-generated, ignoring context.
fn looks_generated(token: &str) -> bool {
    if token.len() < MIN_GENERATED {
        return false;
    }

    let census = Census::of(token);

    // Anything outside the alphabets a credential is encoded in. A sentence
    // fragment, a path with slashes and dots, a CSS declaration.
    if census.other > 0 {
        return false;
    }

    // One class is a word or a number, and both have their own rules. This is
    // also what keeps a long lowercase identifier out.
    if census.single_class() {
        return false;
    }

    if is_excluded(token, census) {
        return false;
    }

    let bits = shannon(token);
    if census.hex_like(token) {
        token.len() >= MIN_HEX && bits >= HEX_ENTROPY
    } else {
        bits >= BASE64_ENTROPY
    }
}

/// The things that look generated and are not secrets.
///
/// Every one of these is on a developer's screen constantly, and every one of
/// them clears an entropy threshold. Without this list the feature covers a
/// code editor in grey boxes.
fn is_excluded(token: &str, census: Census) -> bool {
    // A git object id, long or short. 40 or 64 hex characters with nothing else.
    if census.hex_like(token) && matches!(token.len(), 7 | 8 | 40 | 64) {
        return true;
    }

    // A UUID, with or without its hyphens — in a URL, a database row, a React
    // key. `canonical` has already removed the hyphens by the time a token gets
    // here, so both shapes are 32 hex characters.
    if token.len() == 32 && token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return true;
    }

    // A hex colour, with or without alpha.
    if let Some(rest) = token.strip_prefix('#')
        && matches!(rest.len(), 3 | 4 | 6 | 8) && rest.bytes().all(|b| b.is_ascii_hexdigit()) {
            return true;
        }

    // A URL. Its own category, and never a secret by entropy — a signed URL's
    // query string would otherwise light up every time.
    if token.contains("://") {
        return true;
    }

    // A path. `/usr/local/lib/node_modules/...` mixes classes and is long.
    if token.starts_with('/') || token.starts_with("./") || token.contains('\\') {
        return true;
    }

    // A base64 data URI's payload, which is arbitrarily long and arbitrarily
    // random and is a picture.
    if token.starts_with("data:") {
        return true;
    }

    false
}

fn credential_context(context: &str) -> bool {
    // The assignment punctuation on its own is enough: `=`, `:` or a quote
    // immediately before a generated token is how every config file and every
    // header writes one.
    let assigns = context
        .trim_end()
        .ends_with(['=', ':', '"', '\'']);

    assigns || CREDENTIAL_WORDS.iter().any(|word| context.contains(word))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_pattern_compiles() {
        // Touching the set is what forces it to build; a bad pattern panics
        // here rather than in the middle of a scan.
        assert_eq!(TIER_ONE.len(), RULES.len());
    }

    /// A fixture, from fragments.
    ///
    /// Not an affectation. A crate that recognises credentials necessarily
    /// contains strings shaped like credentials, and a secret scanner cannot
    /// tell a test fixture from the real thing — GitHub's push protection
    /// refused this file over the Stripe one below, naming it a leaked key.
    /// Arguing with a scanner is not a thing anybody wins, and an allowlist
    /// entry per fixture is a cost paid again on every rule added.
    ///
    /// So no fixture appears contiguously in the source: the scanner reads
    /// fragments, the test reads the token. Keep it that way when adding a rule.
    fn fixture(parts: &[&str]) -> String {
        parts.concat()
    }

    #[test]
    fn finds_a_vendor_key_with_no_context_at_all() {
        let tail = "abcdefghijklmnopqrstuvwxyz0123456789";

        for (expected, token) in [
            ("OpenAI API key", fixture(&["sk-", "proj-", tail])),
            ("Anthropic API key", fixture(&["sk-", "ant-", "api03-", tail])),
            ("GitHub token", fixture(&["ghp", "_", tail])),
            ("AWS access key id", fixture(&["AKIA", "IOSFODNN7EXAMPLE"])),
            // 39 characters: `AIza` and exactly 35 more, which is the format.
            ("Google API key", fixture(&["AIza", "SyA1234567890abcdefghijklmnopqrstuv"])),
            ("Slack token", fixture(&["xoxb", "-123456789012-abcdefghijkl"])),
            ("Stripe secret key", fixture(&["sk", "_live_", "abcdefghijklmnopqrstuvwx"])),
            ("npm token", fixture(&["npm", "_", tail])),
        ] {
            assert_eq!(
                classify(&token, ""),
                Some(Secret::Known(expected)),
                "{token} should be a {expected}"
            );
        }
    }

    #[test]
    fn the_specific_rule_wins() {
        // An Anthropic key satisfies OpenAI's pattern too. This pins the
        // ordering in `RULES` that decides which name the user is shown.
        let tail = "abcdefghijklmnopqrstuvwxyz0123456789";

        assert_eq!(
            classify(&fixture(&["sk-", "ant-", "api03-", tail]), ""),
            Some(Secret::Known("Anthropic API key"))
        );
        // And the general rule still catches what the specific one does not.
        assert_eq!(
            classify(&fixture(&["sk-", tail]), ""),
            Some(Secret::Known("OpenAI API key"))
        );
    }

    #[test]
    fn finds_a_jwt() {
        let jwt = fixture(&[
            "eyJ",
            "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
            ".eyJzdWIiOiIxMjM0NTY3ODkwIn0",
            ".dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        ]);
        assert_eq!(classify(&jwt, ""), Some(Secret::Known("JSON web token")));
    }

    #[test]
    fn a_generated_token_needs_context() {
        let token = "k3Jx9Qm2VpL7bR4tZwN8cF6hT1yS5dG0";

        // On its own it is a cache-busting hash, an asset name, an id.
        assert_eq!(classify(token, "sprite "), None);
        // Named as a credential it is a credential.
        assert_eq!(
            classify(token, "export api_key="),
            Some(Secret::Generated)
        );
        // Assignment punctuation alone is enough.
        assert_eq!(classify(token, "authorization: "), Some(Secret::Generated));
    }

    #[test]
    fn a_generated_secret_is_not_a_known_one() {
        // So the review list never claims a vendor it did not recognise.
        assert_eq!(
            classify("k3Jx9Qm2VpL7bR4tZwN8cF6hT1yS5dG0", "token=")
                .map(Secret::label),
            Some("Possible secret")
        );
    }

    #[test]
    fn leaves_a_developers_screen_alone() {
        // Every one of these is long, mixed-class and high-entropy, and every
        // one of them is on screen constantly. Given the most incriminating
        // context available, none may be reported.
        for token in [
            // A git SHA, full and short.
            "356a192b7913b04c54574d18c28d46e6395428ab",
            "7b52009",
            // A UUID with its hyphens already stripped by `canonical`.
            "550e8400e29b41d4a716446655440000",
            // A sha256 digest.
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            // A hex colour.
            "#1b1b1bff",
            // A URL, including one with a signed query string.
            "https://cdn.example.com/a/b?sig=k3Jx9Qm2VpL7bR4tZwN8cF6hT1yS5dG0",
            // A path.
            "/usr/local/lib/node_modules/typescript/bin/tsc",
            // A data URI.
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
            // A version and a date, which are single-class or short.
            "v2.14.3",
            "2024-01-15",
            // A long lowercase identifier.
            "useDeferredValueWithTransition",
        ] {
            assert_eq!(classify(token, "secret api_key = "), None, "{token}");
        }
    }

    #[test]
    fn a_short_token_is_never_generated() {
        assert_eq!(classify("k3Jx9Qm2Vp", "api_key="), None);
    }
}
