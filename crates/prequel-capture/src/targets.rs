//! Enumerating what can be recorded: displays and on-screen windows.

use std::sync::mpsc;
use std::time::Duration;

use cidre::{arc, cg, ns, sc};

use crate::error::{Error, Result};

const SHAREABLE_CONTENT_TIMEOUT: Duration = Duration::from_secs(10);

/// Window layer 0 is the normal application layer. Menu bars, the Dock, screen
/// savers and other system chrome live above it and are noise in a picker.
const NORMAL_WINDOW_LAYER: isize = 0;

/// Windows smaller than this in either dimension are almost always invisible
/// helper windows rather than something a user means to record.
const MIN_WINDOW_EDGE: f64 = 40.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    Display,
    Window,
}

/// A rectangle in macOS global display coordinates (points, not pixels).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone)]
pub struct Target {
    pub kind: TargetKind,
    /// `CGDirectDisplayID` for displays, `CGWindowID` for windows.
    pub id: u32,
    pub title: String,
    /// Owning application name. Empty for displays.
    pub app_name: String,
    /// Path to the owning application's bundle, e.g. `/Applications/Safari.app`.
    ///
    /// Empty when it cannot be determined. Carried so the picker can show a
    /// real app icon: the bundle is the only place a full-resolution one
    /// exists — every API that hands an icon straight over caps out at 32px.
    pub app_path: String,
    pub bounds: Bounds,
    /// Physical pixels per point. For a window this is the density of the
    /// display it is on, so a window recording matches what the screen shows.
    pub scale_factor: f64,
}

/// Lists every display and every user-facing on-screen window.
///
/// Requires the Screen Recording grant: without it ScreenCaptureKit returns
/// `SCStreamErrorDomain -3801`, which surfaces as [`Error::ScreenAccessDenied`].
pub fn list_targets() -> Result<Vec<Target>> {
    let content = current_shareable_content()?;
    let mut targets = Vec::new();

    // Kept so each window can inherit the pixel density of the display it sits
    // on. Without it a window is captured at point resolution, which on a
    // Retina panel is half of what the screen was actually showing.
    let mut display_scales: Vec<(Bounds, f64)> = Vec::new();

    for display in content.displays().iter() {
        let scale_factor = point_pixel_scale(display);
        let frame = display.frame();
        display_scales.push((to_bounds(frame), scale_factor));

        targets.push(Target {
            kind: TargetKind::Display,
            id: display.display_id().0,
            title: format!(
                "Display {}×{}",
                (frame.size.width * scale_factor).round() as i64,
                (frame.size.height * scale_factor).round() as i64
            ),
            app_name: String::new(),
            app_path: String::new(),
            bounds: to_bounds(frame),
            scale_factor,
        });
    }

    // Collected separately so they can be put into stacking order before the
    // caller sees them; displays have no such ordering to speak of.
    let mut windows = Vec::new();

    for window in content.windows().iter() {
        if !window.is_on_screen() || window.window_layer() != NORMAL_WINDOW_LAYER {
            continue;
        }

        let frame = window.frame();
        if frame.size.width < MIN_WINDOW_EDGE || frame.size.height < MIN_WINDOW_EDGE {
            continue;
        }

        let owner = window.owning_app();
        let app_name = owner
            .as_ref()
            .map(|app| app.app_name().to_string())
            .unwrap_or_default();
        let app_path = owner
            .as_ref()
            .and_then(|app| bundle_path(app.process_id()))
            .unwrap_or_default();
        let title = window.title().map(|t| t.to_string()).unwrap_or_default();

        // A window with neither a title nor an owning app is not something a
        // user can meaningfully pick out of a list.
        if title.is_empty() && app_name.is_empty() {
            continue;
        }

        windows.push(Target {
            kind: TargetKind::Window,
            id: window.id(),
            title,
            app_name,
            app_path,
            bounds: to_bounds(frame),
            scale_factor: scale_for(&display_scales, to_bounds(frame)),
        });
    }

    sort_front_to_back(&mut windows);
    targets.append(&mut windows);

    Ok(targets)
}

/// Filesystem path of a process's application bundle.
///
/// ScreenCaptureKit names the owning app but will not say where it lives, and
/// the bundle is where a full-resolution icon actually is. `NSRunningApplication`
/// answers that from the pid alone.
fn bundle_path(pid: i32) -> Option<String> {
    let app = ns::RunningApp::with_pid(pid)?;
    let url = app.bundle_url()?;
    url.path().map(|path| path.to_string())
}

/// Pixel density for a window, taken from the display its centre falls on.
///
/// A window carries no scale of its own; capturing one at 1.0 silently records
/// a Retina window at half the resolution it is displayed at. Falls back to the
/// densest display available rather than to 1.0, because a soft recording is
/// much harder to notice than a missing one.
fn scale_for(displays: &[(Bounds, f64)], window: Bounds) -> f64 {
    let centre_x = window.x + window.width / 2.0;
    let centre_y = window.y + window.height / 2.0;

    displays
        .iter()
        .find(|(bounds, _)| {
            centre_x >= bounds.x
                && centre_x < bounds.x + bounds.width
                && centre_y >= bounds.y
                && centre_y < bounds.y + bounds.height
        })
        .map(|(_, scale)| *scale)
        .unwrap_or_else(|| displays.iter().map(|(_, scale)| *scale).fold(1.0, f64::max))
}

/// Puts windows into the order they are stacked on screen, front first.
///
/// ScreenCaptureKit does not do this. Its window list is stable and unrelated
/// to stacking — bringing a different app to the front does not move its window
/// in the list at all — so a picker that assumes front-to-back will happily
/// highlight whichever full-screen window happens to be listed first, whatever
/// is actually visible under the cursor.
///
/// `CGWindowListCreate` is the window server's own list, and it *is* documented
/// front-to-back. It needs no Screen Recording grant: window ids and stacking
/// are not privileged, only titles and pixels are.
fn sort_front_to_back(windows: &mut [Target]) {
    sort_by_order(windows, &stacking_order());
}

/// The ordering itself, separated from the window server so it can be tested.
fn sort_by_order(windows: &mut [Target], order: &[u32]) {
    // Stable, and anything the window server did not report keeps its relative
    // position at the back rather than jumping to the front.
    windows.sort_by_key(|target| {
        order
            .iter()
            .position(|&id| id == target.id)
            .unwrap_or(usize::MAX)
    });
}

/// On-screen window ids, front to back.
fn stacking_order() -> Vec<u32> {
    let Some(list) = cg::WindowList::new(
        cg::WindowListOpt::ON_SCREEN_ONLY | cg::WindowListOpt::EXCLUDE_DESKTOP_ELEMENTS,
        cg::WINDOW_ID_NULL,
    ) else {
        return Vec::new();
    };

    (0..list.len()).map(|index| list.get(index)).collect()
}

/// Looks up a single target by kind and id.
///
/// Re-reads the current snapshot rather than trusting a cached one: windows
/// close and displays get unplugged between listing and recording.
pub fn find_target(kind: TargetKind, id: u32) -> Result<Target> {
    list_targets()?
        .into_iter()
        .find(|t| t.kind == kind && t.id == id)
        .ok_or(match kind {
            TargetKind::Display => Error::DisplayNotFound(id),
            TargetKind::Window => Error::WindowNotFound(id),
        })
}

/// Fetches the current `SCShareableContent` snapshot, blocking the caller.
///
/// ScreenCaptureKit only offers a completion-handler API here and invokes it on
/// its own queue, so we bridge it to a channel.
pub(crate) fn current_shareable_content() -> Result<arc::R<sc::ShareableContent>> {
    let (tx, rx) = mpsc::channel();

    sc::ShareableContent::current_with_ch(move |content, err| {
        let outcome = match (content, err) {
            (Some(content), _) => Ok(content.retained()),
            (_, Some(err)) => Err(Error::from_ns_error(err)),
            _ => Err(Error::ScreenCaptureKit(
                "callback delivered neither content nor an error".to_owned(),
            )),
        };
        // The receiver is gone only if we already timed out; nothing to do.
        let _ = tx.send(outcome);
    });

    rx.recv_timeout(SHAREABLE_CONTENT_TIMEOUT)
        .map_err(|_| Error::Timeout(SHAREABLE_CONTENT_TIMEOUT))?
}

/// Physical pixels per point for a display.
///
/// `SCDisplay::width`/`height` are in **points**, not pixels — dividing them by
/// the frame gives 1.0 on every Mac and silently halves the capture resolution
/// on a Retina panel. `SCShareableContentInfo::pointPixelScale` is the value
/// Apple actually intends for this, and it needs a filter to ask about.
fn point_pixel_scale(display: &sc::Display) -> f64 {
    let filter = sc::ContentFilter::with_display_excluding_windows(display, &ns::Array::new());
    let scale = sc::ShareableContent::info_for_filter(&filter).point_pixel_scale();

    // A zero or nonsense scale would produce a zero-sized capture; 1.0 merely
    // produces a soft one.
    if scale.is_finite() && scale > 0.0 {
        f64::from(scale)
    } else {
        1.0
    }
}

/// Whether a display is asleep.
///
/// ScreenCaptureKit omits sleeping displays from its snapshot entirely, so
/// "display not in the list" and "display is asleep" are indistinguishable
/// without asking CoreGraphics directly. Worth telling apart: one is a bug, the
/// other just needs the user to nudge the mouse.
pub fn is_display_asleep(display_id: u32) -> bool {
    unsafe { CGDisplayIsAsleep(display_id) }
}

/// Whether the primary display is asleep.
///
/// Recording a display is impossible while it sleeps, so callers — including
/// tests — need to tell that apart from a real failure.
pub fn main_display_asleep() -> bool {
    is_display_asleep(cidre::cg::DirectDisplayId::main().0)
}

unsafe extern "C" {
    fn CGDisplayIsAsleep(display: u32) -> bool;
}

fn to_bounds(rect: cidre::cg::Rect) -> Bounds {
    Bounds {
        x: rect.origin.x,
        y: rect.origin.y,
        width: rect.size.width,
        height: rect.size.height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permission::{PermissionStatus, screen_access_status};

    fn window(id: u32) -> Target {
        Target {
            kind: TargetKind::Window,
            id,
            title: format!("window {id}"),
            app_name: "App".to_owned(),
            app_path: String::new(),
            bounds: Bounds {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            scale_factor: 1.0,
        }
    }

    fn ids(windows: &[Target]) -> Vec<u32> {
        windows.iter().map(|w| w.id).collect()
    }

    #[test]
    fn windows_are_reordered_to_match_the_window_server() {
        // The bug this fixes: ScreenCaptureKit's order is unrelated to
        // stacking, so the picker highlighted whichever overlapping window
        // happened to be listed first rather than the one on top.
        let mut windows = vec![window(10), window(20), window(30)];
        sort_by_order(&mut windows, &[30, 10, 20]);
        assert_eq!(ids(&windows), vec![30, 10, 20]);
    }

    #[test]
    fn windows_the_server_does_not_report_go_to_the_back() {
        // A window that closed between the two snapshots must not sort to the
        // front and swallow every hover.
        let mut windows = vec![window(10), window(99), window(20)];
        sort_by_order(&mut windows, &[20, 10]);
        assert_eq!(ids(&windows), vec![20, 10, 99]);
    }

    #[test]
    fn unknown_windows_keep_their_relative_order() {
        let mut windows = vec![window(98), window(99), window(10)];
        sort_by_order(&mut windows, &[10]);
        assert_eq!(ids(&windows), vec![10, 98, 99]);
    }

    #[test]
    fn an_empty_order_leaves_the_list_alone() {
        // CGWindowListCreate returning nothing must not scramble the picker.
        let mut windows = vec![window(10), window(20)];
        sort_by_order(&mut windows, &[]);
        assert_eq!(ids(&windows), vec![10, 20]);
    }

    #[test]
    fn a_window_takes_the_scale_of_the_display_it_is_on() {
        let displays = vec![
            (
                Bounds {
                    x: 0.0,
                    y: 0.0,
                    width: 1512.0,
                    height: 982.0,
                },
                2.0,
            ),
            (
                Bounds {
                    x: 1512.0,
                    y: 0.0,
                    width: 2560.0,
                    height: 1440.0,
                },
                1.0,
            ),
        ];

        let retina = Bounds {
            x: 100.0,
            y: 100.0,
            width: 800.0,
            height: 600.0,
        };
        assert_eq!(scale_for(&displays, retina), 2.0);

        let external = Bounds {
            x: 2000.0,
            y: 200.0,
            width: 800.0,
            height: 600.0,
        };
        assert_eq!(scale_for(&displays, external), 1.0);
    }

    #[test]
    fn a_window_off_every_display_falls_back_to_the_densest() {
        // Better a recording that is too sharp than one that is silently soft.
        let displays = vec![(
            Bounds {
                x: 0.0,
                y: 0.0,
                width: 1512.0,
                height: 982.0,
            },
            2.0,
        )];
        let stray = Bounds {
            x: -9000.0,
            y: -9000.0,
            width: 400.0,
            height: 300.0,
        };
        assert_eq!(scale_for(&displays, stray), 2.0);
    }

    #[test]
    fn with_no_displays_the_scale_is_one() {
        let stray = Bounds {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 300.0,
        };
        assert_eq!(scale_for(&[], stray), 1.0);
    }

    #[test]
    fn the_window_server_reports_a_stacking_order() {
        // Needs no Screen Recording grant, so this holds even on CI — though a
        // headless runner may legitimately have no windows at all.
        let order = stacking_order();
        let mut unique = order.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), order.len(), "window ids must not repeat");
    }

    #[test]
    fn listing_targets_without_permission_reports_denial() {
        // In CI (and any plain `cargo test` run) the test binary has no Screen
        // Recording grant, so this must fail with the actionable error rather
        // than hanging or panicking. On a machine where the grant *is* held by
        // the parent process, assert we got real targets instead.
        match (screen_access_status(), list_targets()) {
            (PermissionStatus::Denied, Err(Error::ScreenAccessDenied)) => {}
            (PermissionStatus::Granted, Ok(targets)) => {
                let displays: Vec<_> = targets
                    .iter()
                    .filter(|t| t.kind == TargetKind::Display)
                    .collect();
                // Not "a Mac always has a display": ScreenCaptureKit omits
                // sleeping displays from its snapshot entirely, so an empty
                // list is legitimate when the screen has dozed off — which it
                // will, during a long run on a developer machine.
                assert!(
                    !displays.is_empty() || main_display_asleep(),
                    "no displays reported, yet the main display is awake"
                );

                for display in displays {
                    assert!(display.bounds.width > 0.0 && display.bounds.height > 0.0);
                    // Scale must come from pointPixelScale, not a ratio of two
                    // point-valued fields — that silently yields 1.0 on Retina
                    // and would halve the capture resolution.
                    assert!(
                        display.scale_factor >= 1.0 && display.scale_factor <= 4.0,
                        "implausible scale factor {}",
                        display.scale_factor
                    );
                }
            }
            (status, result) => panic!("inconsistent: status={status:?} result={result:?}"),
        }
    }
}
