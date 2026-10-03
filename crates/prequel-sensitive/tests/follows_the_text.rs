//! A cover follows what it covers, survives a missed reading, and never walks
//! across the page to a different copy of the same text.
//!
//! These are the behaviours the feature is actually sold on, and all three are
//! arithmetic over rectangles and strings — so none of them needs Vision, a
//! video, or a Mac.

use prequel_sensitive::track::{MaskKey, Tracker};
use prequel_sensitive::{Candidate, Category, NormRect, bucket};

const SECOND: u64 = 1_000_000_000;

/// A sighting of one piece of text at a position.
fn seen(canonical: &str, x: f32, y: f32) -> Candidate {
    let canonical = canonical.to_owned();
    Candidate {
        category: Category::Email,
        label: "Email address",
        rect: NormRect::new(x, y, 0.2, 0.03),
        confidence: 0.95,
        repaired: false,
        bucket: bucket(7, Category::Email, &canonical),
        preview: "a\u{2022}\u{2022}\u{2022}@example.com".to_owned(),
        canonical,
    }
}

fn rects(keys: &[MaskKey]) -> Vec<(f32, f32)> {
    keys.iter().map(|key| (key.rect.x, key.rect.y)).collect()
}

#[test]
fn follows_a_scroll() {
    let mut tracker = Tracker::new(SECOND);

    // The same address, rising up the page as it scrolls.
    for step in 0..5u64 {
        let y = 0.8 - 0.1 * step as f32;
        tracker.offer(step * SECOND, &[seen("a@example.com", 0.3, y)]);
    }

    let tracks = tracker.finish();
    assert_eq!(tracks.len(), 1, "one address, one cover: {tracks:?}");

    let track = &tracks[0];
    assert_eq!(track.keys.len(), 5);
    assert!(!track.uncertain);

    // The keys describe the movement, so the rasterisers' interpolation puts
    // the cover over the text at every frame in between.
    let ys: Vec<f32> = track.keys.iter().map(|key| key.rect.y).collect();
    assert!(
        ys.windows(2).all(|pair| pair[1] < pair[0]),
        "the cover should move up with the text: {ys:?}"
    );
    // And the keys stay in time order, which both samplers assume.
    assert!(track.keys.windows(2).all(|pair| pair[1].at > pair[0].at));
}

#[test]
fn survives_a_missed_reading() {
    let mut tracker = Tracker::new(SECOND);

    tracker.offer(0, &[seen("a@example.com", 0.3, 0.5)]);
    // Sample one reads nothing — a tooltip, a repaint, a glyph on a pixel
    // boundary. The cover must not blink off: that is both a reveal and reads
    // as a bug.
    tracker.offer(SECOND, &[]);
    tracker.offer(2 * SECOND, &[seen("a@example.com", 0.3, 0.5)]);

    let tracks = tracker.finish();
    assert_eq!(tracks.len(), 1, "still one cover, not two: {tracks:?}");

    let track = &tracks[0];
    assert_eq!(track.keys.len(), 3, "{:?}", rects(&track.keys));
    // The bridged sample holds the last rectangle rather than dropping it.
    assert!(track.keys[1].lost);
    assert_eq!(track.keys[1].rect, track.keys[0].rect);
    // And it is flagged, so the panel can sort it where somebody will look.
    assert!(track.uncertain);
}

#[test]
fn a_long_absence_ends_the_cover() {
    let mut tracker = Tracker::new(SECOND);

    tracker.offer(0, &[seen("a@example.com", 0.3, 0.5)]);
    for gap in 1..=5u64 {
        tracker.offer(gap * SECOND, &[]);
    }
    // Back on screen, a long time later and somewhere else entirely.
    tracker.offer(6 * SECOND, &[seen("a@example.com", 0.7, 0.2)]);

    let tracks = tracker.finish();
    assert_eq!(
        tracks.len(),
        2,
        "a navigation is two covers, not one swept across the page: {tracks:?}"
    );
}

#[test]
fn keeps_two_copies_apart() {
    let mut tracker = Tracker::new(SECOND);

    // The same address twice on the page — a list and a detail panel, say.
    // One of them scrolls and the other does not.
    tracker.offer(
        0,
        &[
            seen("a@example.com", 0.1, 0.2),
            seen("a@example.com", 0.6, 0.8),
        ],
    );
    tracker.offer(
        SECOND,
        &[
            seen("a@example.com", 0.1, 0.2),
            seen("a@example.com", 0.6, 0.7),
        ],
    );

    let tracks = tracker.finish();
    assert_eq!(tracks.len(), 2, "two copies, two covers: {tracks:?}");

    for track in &tracks {
        // Neither cover may have jumped to the other copy. Both are within
        // 0.1 of where they started; a swap would be a move of about 0.6.
        let first = track.keys[0].rect;
        let last = track.keys[track.keys.len() - 1].rect;
        assert!(
            first.centre_distance(last) < 0.3,
            "a cover jumped between copies: {:?}",
            rects(&track.keys)
        );
    }
}

#[test]
fn a_slightly_different_reading_is_the_same_text() {
    let mut tracker = Tracker::new(SECOND);

    // Vision reads the address cleanly, then misreads one character, then
    // reads it cleanly again. Without the rescue pass this is three covers
    // where one belongs, and the middle one has a different bucket so a
    // dismissal would not stick to it.
    tracker.offer(0, &[seen("accounts@example.com", 0.3, 0.5)]);
    tracker.offer(SECOND, &[seen("acc0unts@example.com", 0.3, 0.5)]);
    tracker.offer(2 * SECOND, &[seen("accounts@example.com", 0.3, 0.5)]);

    let tracks = tracker.finish();
    assert_eq!(tracks.len(), 1, "one address read three times: {tracks:?}");
    assert_eq!(tracks[0].keys.len(), 3);
}

#[test]
fn different_text_in_the_same_place_is_a_different_cover() {
    let mut tracker = Tracker::new(SECOND);

    // A table whose rows change under a filter. Same position, different
    // address — so the rescue pass must not join them, or a dismissal of one
    // silently dismisses the other.
    tracker.offer(0, &[seen("accounts@example.com", 0.3, 0.5)]);
    tracker.offer(SECOND, &[seen("warehouse@other.test", 0.3, 0.5)]);

    let tracks = tracker.finish();
    assert_eq!(tracks.len(), 2, "{tracks:?}");
}

#[test]
fn a_cover_held_to_the_end_is_trimmed_back() {
    let mut tracker = Tracker::new(SECOND);

    tracker.offer(0, &[seen("a@example.com", 0.3, 0.5)]);
    // The text leaves and the footage ends. The held keys were guesses about
    // nothing, and left in they put a cover over the last seconds of the take.
    tracker.offer(SECOND, &[]);
    tracker.offer(2 * SECOND, &[]);

    let tracks = tracker.finish();
    assert_eq!(tracks.len(), 1);
    assert_eq!(tracks[0].keys.len(), 1, "{:?}", rects(&tracks[0].keys));
    assert!(!tracks[0].keys[0].lost);
}

#[test]
fn a_cover_never_outlives_the_text_by_more_than_the_tolerance() {
    // The property behind the test above, stated generally: however long the
    // text is absent for, the number of held keys on the end is bounded.
    let mut tracker = Tracker::new(SECOND);
    tracker.offer(0, &[seen("a@example.com", 0.3, 0.5)]);
    for gap in 1..=20u64 {
        tracker.offer(gap * SECOND, &[]);
    }

    let tracks = tracker.finish();
    assert_eq!(tracks.len(), 1);
    let held = tracks[0].keys.iter().filter(|key| key.lost).count();
    assert!(held <= 3, "{held} held keys is an unbounded cover");
}
