# prequel-capture

ScreenCaptureKit: permissions, target enumeration, and recording the screen
with both audio sources.

macOS 14+ only. Everything goes through ScreenCaptureKit — the legacy
`CGDisplayStream` and `CGWindowListCreateImage` paths are deprecated and make
modern macOS show the user a security warning.

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test -p prequel-capture
```

`tests/records_the_screen.rs` needs a real Screen Recording grant and a
non-sleeping display, and skips itself when it does not have them.

## What it writes

`screen.mp4`, `mic.m4a` and `system.m4a`, on the timeline owned by
`prequel-session`'s `SharedClock` — the same clock `prequel-camera` writes
against, which is what makes the four files reassemblable afterwards.

## The sample tracks

Three things are sampled alongside the video and end up in `session.json`
rather than burnt into a frame.

**`cursor`** — where the pointer was, as fractions of the captured frame. The
pointer is recorded _hidden_ and drawn back as a layer at edit time, so its
size, style and visibility stay editable and a zoom can follow it.

**`clicks`** — where it was pressed. The strongest signal a screen recording
gives about what mattered and when, and what the editor's automatic zooms are
built from. A listen-only CGEventTap on mouse-down only: it carries no key
codes and no modifiers, and **needs no permission at all**, unlike a keyboard
tap, which would need Input Monitoring.

The tap runs its own run loop on its own thread. An event tap is delivered by
the window server into a run loop source, so there has to be a run loop for it
to be delivered into — and it cannot be the capture callback's, which is
ScreenCaptureKit's and is busy sixty times a second.

**`typing`** — the bounds of the focused text field, via the Accessibility API,
so a zoom can hold on a form while it is being filled in. This is the one thing
here that wants a permission, and without it the track is simply absent. It
beats once a second while a field stays focused, so a minute in one box is a
minute of samples rather than a single one — the editor reads the last sample
as "still typing".

## Traps

**Positions are fractions of the captured frame**, never display points. The
display's origin and the crop are known only during capture; a fraction
survives both.

**`cidre`'s `define_obj_type!` expands to a transmute clippy flags.** The
`allow` has to sit at module scope to reach the expansion — it is not
suppressing a warning about code written here.

**Excluding Prequel's own windows from a recording** uses the `CGWindowID`
Electron embeds in `BrowserWindow.getMediaSourceId()` (`"window:<id>:0"`),
which is the same number `Target::id` carries.

**`capture_wallpaper`** screenshots the wallpaper agent's window through the
Screen Recording grant the app already holds. Reading the desktop picture from
disk does not work on modern macOS: `desktoppicture.db` is gone, the
replacement plist hides the identity in an NSKeyedArchiver blob, and neither
approach handles dynamic HEICs or Aerial video wallpapers at all.
