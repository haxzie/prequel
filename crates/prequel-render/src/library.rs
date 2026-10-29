//! Where an asset named by a plan actually is.
//!
//! A plan carries paths and nothing else, and they come from two roots. Most
//! are the recording's own — the footage, the pointer sprites, a picture
//! somebody dragged in — and resolve against the session directory as they
//! always have. The rest are ours: a wallpaper or a track from the catalogue,
//! held once for the machine instead of once per recording, and named with the
//! prefix below.
//!
//! A hand-kept mirror of `apps/desktop/src/shared/library.ts`, with the same
//! prefix and the same refusals in both sets of tests. The editor writes these
//! references and this reads them, so the two have to agree exactly or an
//! export draws a gradient where the preview drew a picture.

use std::path::{Path, PathBuf};

/// What a library path starts with — `LIBRARY_PREFIX` in the editor.
pub const LIBRARY_PREFIX: &str = "@library/";

/// The shelves. One directory each under the library root.
const SHELVES: [&str; 2] = ["backgrounds", "music"];

/// The shelf and bare name a reference points at, or `None` for a recording's
/// own file.
///
/// `None` for every bare name, which is what makes this safe to ask of any
/// path in any plan: a caller resolves against the recording wherever this
/// says nothing, exactly as it did before the library existed.
///
/// Refuses anything that is not a shelf and a bare name. The path arrives from
/// a project file and is about to be joined onto a directory, so `..` and a
/// second separator have to be impossible here.
pub fn library_parts(path: &str) -> Option<(&str, &str)> {
    let rest = path.strip_prefix(LIBRARY_PREFIX)?;
    let (shelf, file) = rest.split_once('/')?;

    if !SHELVES.contains(&shelf) {
        return None;
    }
    if !is_bare_name(file) {
        return None;
    }

    Some((shelf, file))
}

/// Letters, digits and dashes, one dot, an extension — the shape the API's own
/// names take.
fn is_bare_name(file: &str) -> bool {
    let Some((stem, extension)) = file.split_once('.') else {
        return false;
    };

    !stem.is_empty()
        && stem.starts_with(|c: char| c.is_ascii_alphanumeric())
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !extension.is_empty()
        && extension.chars().all(|c| c.is_ascii_alphanumeric())
}

/// The file a path names, under whichever root owns it.
///
/// Falls back to the session directory for a library reference with no library
/// to look in — an export driven by something that has not been told where the
/// shelf is. The file will not be there, and a missing background is already a
/// plainer video rather than a failed export; this only keeps the fallback in
/// one place.
pub fn resolve_asset(session_dir: &Path, library_dir: Option<&Path>, path: &Path) -> PathBuf {
    // Through `to_str`, because a reference is written by the editor and is
    // always UTF-8. A name that is not stays a name: it resolves against the
    // recording, which is where every path that is not one of ours belongs.
    match (path.to_str().and_then(library_parts), library_dir) {
        (Some((shelf, file)), Some(library)) => library.join(shelf).join(file),
        _ => session_dir.join(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_shelf_and_a_name() {
        assert_eq!(
            library_parts("@library/backgrounds/monterey.jpg"),
            Some(("backgrounds", "monterey.jpg"))
        );
        assert_eq!(
            library_parts("@library/music/slow-wander.m4a"),
            Some(("music", "slow-wander.m4a"))
        );
    }

    #[test]
    fn says_nothing_about_a_recordings_own_file() {
        // Every project written before the library existed carries bare names,
        // and all of them go on resolving against the recording.
        for name in ["monterey.jpg", "wallpaper.jpg", "2/screen.mp4", "texts/a1.png"] {
            assert_eq!(library_parts(name), None, "{name}");
        }
    }

    #[test]
    fn refuses_anything_that_could_climb_out_of_the_shelf() {
        for bad in [
            "@library/backgrounds/../../secrets.jpg",
            "@library/backgrounds/sub/dir.jpg",
            "@library/../backgrounds.jpg",
            "@library/backgrounds/.jpg",
            "@library/fonts/inter.woff2",
            "@library/backgrounds/",
            "@library/",
        ] {
            assert_eq!(library_parts(bad), None, "{bad}");
        }
    }

    #[test]
    fn resolves_each_path_under_the_root_that_owns_it() {
        let session = Path::new("/recordings/take");
        let library = PathBuf::from("/library");

        assert_eq!(
            resolve_asset(
                session,
                Some(&library),
                Path::new("@library/backgrounds/monterey.jpg")
            ),
            PathBuf::from("/library/backgrounds/monterey.jpg")
        );
        assert_eq!(
            resolve_asset(session, Some(&library), Path::new("wallpaper.jpg")),
            PathBuf::from("/recordings/take/wallpaper.jpg")
        );
        // No library to look in: the reference is not treated as a name to
        // join blindly — it lands under the session directory and is simply
        // not there, which is a plainer video rather than a traversal.
        assert_eq!(
            resolve_asset(session, None, Path::new("@library/backgrounds/monterey.jpg")),
            PathBuf::from("/recordings/take/@library/backgrounds/monterey.jpg")
        );
    }
}
