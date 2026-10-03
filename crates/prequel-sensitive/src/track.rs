//! Stitching the findings of successive samples into things that follow the
//! text they cover.
//!
//! This is the part of the feature nobody else has. Screen Studio's mask is a
//! fixed rectangle on the screen, so the moment the page scrolls it slides off
//! what it was covering and reveals it. Following the content instead is the
//! whole point, and it is why a finding is identified by **what it says** and
//! only then by where it is.
//!
//! That ordering is the one thing to get right. A flick scroll moves a line
//! most of the way up a screen between two samples a second apart, so any
//! geometry-first matching loses the mask on exactly the gesture the feature
//! exists to survive. Position does one job here: telling two copies of the
//! same string apart.
//!
//! **Every ambiguity resolves towards more covering.** A sample where the text
//! could not be found holds the last rectangle rather than dropping the cover;
//! a track that cannot be matched is closed rather than stretched across
//! unrelated content. Both directions are chosen so the failure is a cover over
//! the wrong thing — which somebody can see and undo — rather than a reveal,
//! which nobody sees until the file is published.

use prequel_session::MediaTime;
use serde::{Deserialize, Serialize};

use crate::{Candidate, Category, NormRect};

/// How far a finding's centre may move, in frame widths per second, and still
/// be the same finding.
///
/// Generous on purpose. A scroll is fast and a page can jump; the gate exists
/// only to stop a mask teleporting to the *other* copy of the same email
/// address on the page, which is a short distance problem, not a long one.
const MAX_DRIFT_PER_SECOND: f32 = 1.2;

/// How differently sized the same finding may be between two samples.
///
/// A zoom or a font change beyond this is a different instance rather than the
/// same one grown, and pairing across it drags a cover across the page.
const MAX_SIZE_CHANGE: f32 = 0.6;

/// How many consecutive samples a finding may go unseen before its track is
/// closed.
///
/// Three. A tooltip, a dropdown, the cursor, a repaint or a dropped OCR read is
/// one or two samples; a navigation is permanent. And a cover that blinks off
/// for a second is both a leak and reads as a bug.
const GAP_TOLERANCE: usize = 3;

/// How different two readings of the same text may be and still be the same
/// text, as an edit distance.
///
/// Two. OCR confidence dips without the text leaving the screen all the time —
/// a glyph lands on a pixel boundary, something animates behind it — and this
/// one rule accounts for most of the samples that would otherwise be lost.
const MAX_EDITS: usize = 2;

/// One sample of where a cover goes.
///
/// Deliberately the shape of `BlobSample` in `prequel-camera`: both rasterisers
/// already interpolate between two samples of a shape, so following a scroll
/// falls out of machinery that exists rather than needing any of its own.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MaskKey {
    pub at: MediaTime,
    #[serde(flatten)]
    pub rect: NormRect,
    /// The text could not be found at this sample and the previous rectangle is
    /// standing in. Never a reason to stop covering — see the module note.
    #[serde(default, skip_serializing_if = "not")]
    pub lost: bool,
}

/// A finding followed across time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub category: Category,
    /// What the panel calls it. Never the matched text.
    pub label: String,
    /// The pre-masked rendering shown in the panel.
    pub preview: String,
    /// Which bucket the text falls in, for matching a re-scan against what the
    /// user has already dismissed. See [`crate::bucket`].
    pub bucket: u32,
    pub confidence: f32,
    /// Whether any sample needed a character corrected to pass its checksum.
    pub repaired: bool,
    /// Whether any sample was held rather than found. The panel sorts these
    /// first, because a cover that lost its anchor is the one most likely to be
    /// over the wrong thing.
    pub uncertain: bool,
    pub keys: Vec<MaskKey>,
}

impl Track {
    pub fn start(&self) -> MediaTime {
        self.keys.first().map_or(0, |key| key.at)
    }

    pub fn end(&self) -> MediaTime {
        self.keys.last().map_or(0, |key| key.at)
    }
}

/// So the common case — a key that was found — writes nothing for it.
fn not(value: &bool) -> bool {
    !*value
}

/// A track still being built.
struct Open {
    track: Track,
    /// The canonical text, kept to match later samples against. In memory only
    /// — it is not on [`Track`], so it cannot reach the artefact on disk.
    canonical: String,
    /// Consecutive samples this has gone unseen.
    missed: usize,
    /// The last rectangle actually found, as opposed to held.
    last: NormRect,
    last_at: MediaTime,
}

/// Follows findings across samples.
pub struct Tracker {
    interval: MediaTime,
    open: Vec<Open>,
    done: Vec<Track>,
}

impl Tracker {
    /// `interval` is the nominal gap between samples, used to widen a track's
    /// span to the half-interval either side of where it was actually seen: the
    /// text appeared at an unknown moment between two samples, and erring
    /// inwards leaks.
    pub fn new(interval: MediaTime) -> Self {
        Self {
            interval,
            open: Vec::new(),
            done: Vec::new(),
        }
    }

    /// Offers one sample's findings at time `at`, on the session clock.
    pub fn offer(&mut self, at: MediaTime, candidates: &[Candidate]) {
        let mut taken = vec![false; candidates.len()];

        // Exact identity first: same category, same bucket, inside the gates.
        for open in &mut self.open {
            if let Some(index) = best(open, candidates, &taken, at, Identity::Bucket) {
                open.absorb(at, &candidates[index]);
                taken[index] = true;
            }
        }

        // Then the rescue pass, for a track whose text was read slightly
        // differently this time. Second so an exact match is never given away
        // to a near one.
        for open in &mut self.open {
            if open.last_at == at {
                continue;
            }
            if let Some(index) = best(open, candidates, &taken, at, Identity::Similar) {
                open.absorb(at, &candidates[index]);
                taken[index] = true;
            }
        }

        // Anything unclaimed is new.
        for (index, candidate) in candidates.iter().enumerate() {
            if taken[index] {
                continue;
            }
            self.open.push(Open::new(at, candidate));
        }

        self.sweep(at);
    }

    /// Holds or closes every track that went unseen at `at`.
    fn sweep(&mut self, at: MediaTime) {
        let mut still_open = Vec::with_capacity(self.open.len());

        for mut open in self.open.drain(..) {
            if open.track.end() == at {
                open.missed = 0;
                still_open.push(open);
                continue;
            }

            open.missed += 1;
            if open.missed > GAP_TOLERANCE {
                // Closed at its last real sighting. Bridging a longer gap would
                // sweep a cover diagonally across content it was never over.
                self.done.push(open.track);
            } else {
                // Held, not dropped. The text may be behind a tooltip.
                open.track.keys.push(MaskKey {
                    at,
                    rect: open.last,
                    lost: true,
                });
                open.track.uncertain = true;
                still_open.push(open);
            }
        }

        self.open = still_open;
    }

    /// Every track, with the held tail of an unfinished one trimmed back.
    pub fn finish(mut self) -> Vec<Track> {
        for mut open in self.open.drain(..) {
            // A track that was still being held when the footage ran out was
            // never seen again, so the held keys are guesses about nothing.
            while open.track.keys.last().is_some_and(|key| key.lost) {
                open.track.keys.pop();
            }
            if !open.track.keys.is_empty() {
                self.done.push(open.track);
            }
        }

        self.done.sort_by_key(Track::start);
        self.done
    }

    /// How far either side of its samples a track's cover should extend.
    pub fn lead(&self) -> MediaTime {
        self.interval / 2
    }
}

impl Open {
    fn new(at: MediaTime, candidate: &Candidate) -> Self {
        Self {
            track: Track {
                category: candidate.category,
                label: candidate.label.to_owned(),
                preview: candidate.preview.clone(),
                bucket: candidate.bucket,
                confidence: candidate.confidence,
                repaired: candidate.repaired,
                uncertain: false,
                keys: vec![MaskKey {
                    at,
                    rect: candidate.rect,
                    lost: false,
                }],
            },
            canonical: candidate.canonical.clone(),
            missed: 0,
            last: candidate.rect,
            last_at: at,
        }
    }

    fn absorb(&mut self, at: MediaTime, candidate: &Candidate) {
        // A held key for this instant is replaced: the text was found after all.
        if self.track.keys.last().is_some_and(|key| key.at == at) {
            self.track.keys.pop();
        }

        self.track.keys.push(MaskKey {
            at,
            rect: candidate.rect,
            lost: false,
        });
        // The highest confidence any sample had. A finding read clearly once is
        // that finding, however poorly the next frame rendered it.
        self.track.confidence = self.track.confidence.max(candidate.confidence);
        self.track.repaired |= candidate.repaired;
        self.last = candidate.rect;
        self.last_at = at;
        self.missed = 0;
    }
}

/// Which notion of "the same finding" a matching pass uses.
#[derive(Clone, Copy, PartialEq)]
enum Identity {
    /// The same text exactly, by bucket.
    Bucket,
    /// Text within [`MAX_EDITS`] of the track's.
    Similar,
}

/// The index of the candidate that best continues `open`, if any qualifies.
fn best(
    open: &Open,
    candidates: &[Candidate],
    taken: &[bool],
    at: MediaTime,
    identity: Identity,
) -> Option<usize> {
    let elapsed = at.saturating_sub(open.last_at) as f32 / 1_000_000_000.0;
    // A sample at the same instant still gets a budget, or the first match of
    // a sample would be gated to zero movement.
    let budget = MAX_DRIFT_PER_SECOND * elapsed.max(0.25);

    candidates
        .iter()
        .enumerate()
        .filter(|(index, _)| !taken[*index])
        .filter(|(_, candidate)| {
            if candidate.category != open.track.category {
                return false;
            }
            match identity {
                Identity::Bucket => candidate.bucket == open.track.bucket,
                Identity::Similar => within(&open.canonical, &candidate.canonical, MAX_EDITS),
            }
        })
        .filter(|(_, candidate)| {
            open.last.centre_distance(candidate.rect) <= budget
                && open.last.size_mismatch(candidate.rect) <= MAX_SIZE_CHANGE
        })
        .min_by(|(_, a), (_, b)| {
            cost(open.last, a.rect)
                .partial_cmp(&cost(open.last, b.rect))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
}

/// How poorly a candidate continues from a rectangle. Distance dominates; size
/// breaks ties between two copies of the same text at a similar distance.
fn cost(from: NormRect, to: NormRect) -> f32 {
    from.centre_distance(to) + 0.5 * from.size_mismatch(to)
}

/// Whether two strings are within `budget` edits of each other.
///
/// Bounded Levenshtein: the full table is never needed because anything beyond
/// the budget is already a different finding, and the length difference alone
/// rules most pairs out before any work.
fn within(a: &str, b: &str, budget: usize) -> bool {
    if a == b {
        return true;
    }
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if a.len().abs_diff(b.len()) > budget {
        return false;
    }

    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0usize; b.len() + 1];

    for (i, ca) in a.iter().enumerate() {
        current[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let substitute = previous[j] + usize::from(ca != cb);
            current[j + 1] = substitute.min(previous[j + 1] + 1).min(current[j] + 1);
        }
        // The whole row is already over budget, so every row below it is too.
        if current.iter().min().is_some_and(|best| *best > budget) {
            return false;
        }
        std::mem::swap(&mut previous, &mut current);
    }

    previous[b.len()] <= budget
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_identical_string_is_within_nothing() {
        assert!(within("abc", "abc", 0));
    }

    #[test]
    fn counts_edits() {
        // One substitution.
        assert!(within("kitten", "sitten", 1));
        // Two substitutions.
        assert!(within("kitten", "sittin", 2));
        assert!(!within("kitten", "sittin", 1));
        // The textbook pair, which is three: two substitutions and an
        // insertion. Beyond the budget this crate allows, and so a different
        // finding rather than a poor reading of the same one.
        assert!(!within("kitten", "sitting", 2));
    }

    #[test]
    fn a_length_difference_short_circuits() {
        assert!(!within("a", "abcdefgh", 2));
    }
}
