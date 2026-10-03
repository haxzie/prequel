//! The corpus that decides whether this feature can ship.
//!
//! Everything here is a line somebody records their screen while looking at. If
//! any of it produces a finding at or above [`MASK_THRESHOLD`], the feature
//! covers the thing the user was demonstrating — and a cover over your own work
//! is discovered by scrubbing the take, if it is discovered at all. People
//! switch that off once and never switch it back on.
//!
//! So this is the specification, and it is deliberately harsher than the real
//! world: every line is scanned, and a finding above the threshold anywhere in
//! it is a failure. Findings *below* the threshold are allowed — those are
//! suggestions the panel lists and nobody's picture is covered by them.

use prequel_sensitive::{Category, MASK_THRESHOLD, scan_line};

/// Lines that may not produce a cover.
const INNOCENT: &[&str] = &[
    // ── A code editor ───────────────────────────────────────────────────────
    "import { useDeferredValue, useTransition } from \"react\";",
    "const CACHE_KEY = `assets-${BUILD_ID}-${process.env.NODE_ENV}`;",
    "export default defineConfig({ plugins: [react(), tailwindcss()] });",
    "  at Object.<anonymous> (/usr/local/lib/node_modules/vite/dist/node/cli.js:7:14)",
    "#1b1b1bff  #f5f5f4  #0a0a0aff  rgba(255, 255, 255, 0.08)",
    "background: linear-gradient(135deg, #1b1b1b 0%, #f5f5f4 100%);",
    "  \"integrity\": \"sha512-Qq0hgI0OqZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQZA==\",",
    // ── A terminal ──────────────────────────────────────────────────────────
    "7b52009 Merge pull request #4821 from prequel/loupe-rim",
    "356a192b7913b04c54574d18c28d46e6395428ab  HEAD -> main",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  dist.tar.gz",
    "   Compiling prequel-render v0.1.0 (/Users/alex/code/prequel/crates/prequel-render)",
    "    Finished `release` profile [optimized] target(s) in 48.21s",
    "➜  Local:   http://localhost:5173/",
    "node_modules/.pnpm/typescript@5.9.2/node_modules/typescript/bin/tsc",
    // ── A file tree ─────────────────────────────────────────────────────────
    "Chart.js  index.ts  main.rs  build.sh  setup.py  README.md  lib.so  go.mod",
    "src/components/Inspector.tsx  src/shared/layout.ts  src/main/ipc.ts",
    // ── A dashboard ─────────────────────────────────────────────────────────
    "Order #10048372  \u{2022}  12 Jan 2026  \u{2022}  \u{a3}248.00  \u{2022}  Fulfilled",
    "Invoice INV-2026-0041  Due 2026-02-14  Amount 1,420.00 USD",
    "Session 1700000000000 \u{2022} duration 00:04:12 \u{2022} 1920x1080 @ 60fps",
    "MRR 48,210  \u{2022}  Churn 2.4%  \u{2022}  Active 1,284  \u{2022}  Trials 96",
    "550e8400-e29b-41d4-a716-446655440000",
    "Build 2026.10.3  \u{2022}  v2.14.3  \u{2022}  commit 7b52009",
    // ── Prose and chat ──────────────────────────────────────────────────────
    "Can you take a look at the loupe rim before Friday? Thanks!",
    "I think the answer is 42 but the test says 1024 and I give up",
    "Ring me on extension 4021 when you get a sec",
    "See the docs at example.com for the full list of options",
    "e.g. the first 1000 rows, i.e. roughly 12% of the table",
];

#[test]
fn covers_nothing_on_an_ordinary_screen() {
    let mut cried = Vec::new();

    for line in INNOCENT {
        for found in scan_line(line) {
            if found.confidence >= MASK_THRESHOLD {
                cried.push(format!(
                    "  {:?} ({}) at {:?} in: {line}",
                    found.category, found.confidence, found.bytes
                ));
            }
        }
    }

    assert!(
        cried.is_empty(),
        "these would have been covered:\n{}",
        cried.join("\n")
    );
}

#[test]
fn still_finds_the_things_it_is_for() {
    // The other half of the specification. A rule set that reports nothing
    // passes the test above trivially, so these must be found, and found above
    // the threshold at which they are covered without being asked.
    // The key-shaped lines are joined from fragments rather than written out: a
    // secret scanner cannot tell a fixture from a leak, and GitHub's push
    // protection refuses a file carrying one. See `fixture` in `secrets.rs`.
    let key = ["export OPENAI_API_KEY=", "sk-", "proj-", &"a".repeat(36)].concat();
    let jwt = [
        "Authorization: Bearer ",
        "eyJ",
        "hbGciOiJIUzI1NiJ9",
        ".eyJzdWIiOiIxMjM0NTY3ODkwIn0",
        ".dBjftJeZ4CVPmB92K27uhbUJU1p1r",
    ]
    .concat();

    let wanted: &[(&str, Category)] = &[
        ("Charge to 4242 4242 4242 4242 expiring 04/27", Category::Card),
        ("Transfer to GB82 WEST 1234 5698 7654 32 today", Category::Iban),
        ("Email accounts@example.com for a copy", Category::Email),
        (&key, Category::Secret),
        (&jwt, Category::Secret),
        ("SSN 123-45-6789 on file", Category::NationalId),
        ("Call me on +44 20 7123 4567", Category::Phone),
    ];

    for (line, category) in wanted {
        let found = scan_line(line);
        let hit = found
            .iter()
            .find(|found| found.category == *category)
            .unwrap_or_else(|| panic!("expected a {category:?} in {line:?}, got {found:?}"));

        assert!(
            hit.confidence >= MASK_THRESHOLD,
            "a {category:?} should be covered unasked, not merely suggested: {} in {line:?}",
            hit.confidence
        );
    }
}

#[test]
fn a_guess_is_offered_and_not_applied() {
    // The suggestions. Each of these is probably sensitive and cannot be
    // proved, so each is reported below the threshold — listed in the panel,
    // covering nothing until somebody says so.
    let guesses: &[(&str, Category)] = &[
        // A generated token in credential context, with no vendor to name.
        (
            "api_key = k3Jx9Qm2VpL7bR4tZwN8cF6hT1yS5dG0",
            Category::Secret,
        ),
        // A grouped local number, which is as often an identifier.
        ("Reception 415-555-2671", Category::Phone),
        // A web address, which people put on screen deliberately.
        ("Docs at https://example.com/guide", Category::Url),
    ];

    for (line, category) in guesses {
        let found = scan_line(line);
        let hit = found
            .iter()
            .find(|found| found.category == *category)
            .unwrap_or_else(|| panic!("expected a {category:?} in {line:?}, got {found:?}"));

        assert!(
            hit.confidence < MASK_THRESHOLD,
            "a {category:?} here is a guess and must not cover anything: {}",
            hit.confidence
        );
    }
}

#[test]
fn a_long_line_of_minified_javascript_is_left_alone() {
    // Its own test because it is the worst case for an entropy rule: thousands
    // of mixed-class characters, much of it in assignment context.
    let line = "!function(e,t){\"object\"==typeof exports?module.exports=t():e.Chart=t()}(this,function(){var e={h:\"a1b2c3d4e5f6\",k:\"Zm9vYmFyYmF6cXV4\",n:0xdeadbeef,s:\"k3Jx9Qm2VpL7bR4t\"};return e});";

    let covered: Vec<_> = scan_line(line)
        .into_iter()
        .filter(|found| found.confidence >= MASK_THRESHOLD)
        .collect();

    assert!(covered.is_empty(), "{covered:?}");
}
