//! A cover follows what it covers, survives a missed reading, and never walks
//! across the page to a different copy of the same text.
//!
//! These are the behaviours the feature is actually sold on, and all three are
//! arithmetic over rectangles and strings — so none of them needs Vision, a
//! video, or a Mac.

use prequel_sensitive::track::{MaskKey, Tracker};
use prequel_sensitive::{Candidate, Category, NormRect, bucket};
use prequel_session::MediaTime;

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

/// Where the cover's top edge is at `when`, the way both rasterisers read it.
///
/// A straight line between the two keys either side — `maskRegionAt` in
/// `shared/layout.ts` and `mask_region_at` in `plan.rs`, which is what makes a
/// key that already lies on that line redundant.
fn at(keys: &[MaskKey], when: MediaTime) -> f32 {
    let after = keys.iter().position(|key| key.at >= when).unwrap_or(0);
    if after == 0 {
        return keys[0].rect.y;
    }
    let (a, b) = (keys[after - 1], keys[after]);
    let span = b.at.saturating_sub(a.at);
    let t = if span > 0 {
        when.saturating_sub(a.at) as f32 / span as f32
    } else {
        0.0
    };
    a.rect.y + (b.rect.y - a.rect.y) * t
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
    assert!(!track.uncertain);

    // The keys describe the movement, so the rasterisers' interpolation puts
    // the cover over the text at every frame in between. Asserted by
    // interpolating rather than by counting keys: a scroll at a steady rate is
    // a straight line, and a key that lies on the line between the two around
    // it is dropped — it draws nothing the interpolation would not.
    for step in 0..5u64 {
        let want = 0.8 - 0.1 * step as f32;
        let got = at(&track.keys, step * SECOND);
        assert!(
            (got - want).abs() < 0.01,
            "at {step}s the cover should be at {want}, not {got}: {:?}",
            track.keys
        );
    }
    // Halfway between two samples as well, which is where a cover that was
    // held rather than followed would show.
    assert!((at(&track.keys, SECOND / 2) - 0.75).abs() < 0.01);
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
    // Covered for the whole of it. Not a key count: all three readings put the
    // address in the same place, so the middle key lies on the line between
    // the other two and is dropped as saying nothing.
    assert_eq!(tracks[0].start(), 0);
    assert_eq!(tracks[0].end(), 2 * SECOND);
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

/// A face Vision is ordinarily sure of is covered without being asked.
///
/// The regression this pins cost the feature its whole point: Vision scores a
/// plain front-on face at about 0.8 to 0.9, the threshold for covering
/// something is 0.9, and the two numbers were compared directly — so every face
/// in a recording came back just under the line and was filed as a guess. Two
/// faces found, neither hidden.
#[test]
fn a_face_is_covered_rather_than_merely_suggested() {
    use prequel_sensitive::{MASK_THRESHOLD, NormRect, face};

    let box_ = NormRect::new(0.4, 0.3, 0.1, 0.2);

    // The range Vision actually answers with for an ordinary face.
    for score in [0.80, 0.83, 0.88, 0.95] {
        let found = face(box_, score, 1).expect("a face in frame is a candidate");
        assert!(
            found.confidence >= MASK_THRESHOLD,
            "a face scored {score} should be covered, not suggested"
        );
    }

    // And a marginal one is still only a suggestion.
    let maybe = face(box_, 0.2, 1).expect("a candidate");
    assert!(maybe.confidence < MASK_THRESHOLD);
}

#[test]
fn a_cover_ends_where_the_thing_it_covers_was_last_seen() {
    // The report this was written for: a cover that never leaves. Two halves to
    // it, and this is the first — a track closed by the gap kept the keys it
    // held while the thing was missing, so the cover outlived the address by
    // however long the tracker was willing to wait for it.
    let mut tracker = Tracker::new(SECOND);

    for step in 0..3u64 {
        tracker.offer(step * SECOND, &[seen("a@example.com", 0.3, 0.5)]);
    }
    // Gone: a navigation, not a tooltip. Offered nothing for long enough that
    // the track closes.
    for step in 3..9u64 {
        tracker.offer(step * SECOND, &[]);
    }

    let tracks = tracker.finish();
    assert_eq!(tracks.len(), 1, "one address: {tracks:?}");

    let track = &tracks[0];
    assert_eq!(
        track.end(),
        2 * SECOND,
        "the cover should end at the last sighting, not at the end of the wait: {:?}",
        track.keys
    );
    assert!(
        track.keys.iter().all(|key| !key.lost),
        "no held key should survive on the end of a closed track: {:?}",
        track.keys
    );
}

#[test]
fn a_cover_still_bridges_a_gap_it_comes_back_from() {
    // The other direction, and the reason the held keys exist. A tooltip over
    // the address for a sample or two must not blink the cover off it — this is
    // the case the trim above must not break.
    let mut tracker = Tracker::new(SECOND);

    tracker.offer(0, &[seen("a@example.com", 0.3, 0.5)]);
    tracker.offer(SECOND, &[]);
    tracker.offer(2 * SECOND, &[seen("a@example.com", 0.3, 0.5)]);

    let tracks = tracker.finish();
    assert_eq!(
        tracks.len(),
        1,
        "one address, covered throughout: {tracks:?}"
    );
    assert_eq!(tracks[0].start(), 0);
    assert_eq!(tracks[0].end(), 2 * SECOND);
    assert!(tracks[0].uncertain, "and the panel is told it was held");
}

#[test]
fn a_cover_reaches_half_a_sample_past_its_own_sightings() {
    // The thing appeared at an unknown moment between the sample that missed it
    // and the one that caught it, so the span has to reach back towards the
    // miss. Erring inwards is a frame of it uncovered, which is the one
    // direction this feature may not fail in.
    let mut tracker = Tracker::new(SECOND);
    tracker.offer(2 * SECOND, &[seen("a@example.com", 0.3, 0.5)]);

    let tracks = tracker.finish();
    assert_eq!(tracks[0].lead, SECOND / 2);
}
