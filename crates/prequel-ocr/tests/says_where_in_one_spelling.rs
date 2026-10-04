//! A scan's cover is spelled the way everything that draws one reads it.
//!
//! This is the only place the two halves of masking meet in Rust, and it is the
//! one that broke: `prequel-sensitive` serialised a rectangle as `w` and `h`
//! while `prequel-render`'s plan, `shared/project.ts` and `shared/layout.ts`
//! all read `width` and `height`. So every finding crossed into TypeScript with
//! two `undefined`s, `JSON.stringify` dropped them, and the cover was saved
//! with a position and no size — then discarded on the next open by the very
//! guard meant to protect it. The panel said "covered" and the film showed
//! nothing, with no error anywhere.
//!
//! Both ends were hand-written declarations of the same JSON, which is exactly
//! the kind of agreement a compiler cannot check and a test has to.

use prequel_render::plan::{MaskKey as PlanKey, mask_region_at};
use prequel_sensitive::NormRect;
use prequel_sensitive::track::MaskKey as ScanKey;

/// What a scan emits is readable as what the exporter rasterises.
#[test]
fn a_scanned_key_is_a_plan_key() {
    let scanned = ScanKey {
        at: 3_000_000_000,
        rect: NormRect::new(0.25, 0.5, 0.125, 0.0625),
        lost: false,
    };

    let json = serde_json::to_string(&scanned).expect("a key serialises");
    let read: PlanKey = serde_json::from_str(&json).expect("and reads back as the plan's");

    assert_eq!(read.at, 3_000_000_000);
    assert_eq!(read.x, 0.25);
    assert_eq!(read.y, 0.5);
    assert_eq!(read.width, 0.125);
    assert_eq!(read.height, 0.0625);
}

/// And the names are the names, stated outright.
///
/// The round-trip above would still pass if both sides were renamed together to
/// something TypeScript does not read. The spelling is a three-way contract and
/// only two of the three are Rust, so one end of it has to be written down.
#[test]
fn a_key_names_its_size_width_and_height() {
    let json = serde_json::to_value(ScanKey {
        at: 0,
        rect: NormRect::new(0.1, 0.2, 0.3, 0.4),
        lost: false,
    })
    .expect("a key serialises");

    let object = json.as_object().expect("an object");
    let mut names: Vec<&str> = object.keys().map(String::as_str).collect();
    names.sort_unstable();

    // `lost` is skipped when false — a held key is the exception, not the rule.
    assert_eq!(names, ["at", "height", "width", "x", "y"]);
}

/// A size that survives the trip is a size the sampler can use.
///
/// The failure was not merely a missing field: a zero-sized region is a cover
/// that draws nothing, so the sampler's own answer is the thing worth asserting.
#[test]
fn the_sampler_finds_a_region_with_area() {
    let json = serde_json::to_string(&[
        ScanKey {
            at: 0,
            rect: NormRect::new(0.1, 0.1, 0.2, 0.1),
            lost: false,
        },
        ScanKey {
            at: 1_000_000_000,
            rect: NormRect::new(0.3, 0.1, 0.2, 0.1),
            lost: false,
        },
    ])
    .expect("keys serialise");
    let keys: Vec<PlanKey> = serde_json::from_str(&json).expect("and read back");

    let middle = mask_region_at(&keys, 500_000_000).expect("a region halfway");
    assert!(middle.width > 0.0 && middle.height > 0.0, "{middle:?}");
    assert!(
        (middle.x - 0.2).abs() < 1e-6,
        "halfway across: {}",
        middle.x
    );
}
