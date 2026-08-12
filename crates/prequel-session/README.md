# prequel-session

Timing, lifecycle and the manifest.

**Depends on no Apple frameworks**, deliberately. All of it is testable with
synthetic input on any machine, with no display and no TCC grant — which is
what makes the parts that are easy to get subtly wrong and hard to notice
cheap to pin down.

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test -p prequel-session
```

## `clock` — host timestamps to media timestamps

Three problems solved together. Getting any of them wrong produces a file that
looks fine until you scrub it.

1. **A shared origin.** Screen, camera, microphone and system audio arrive on
   separate streams. They are only reassemblable later if every track is
   measured from the same `t0`, so the origin lives here, once, rather than per
   track.
2. **Paused spans must vanish.** A 10 s recording paused for 30 s in the middle
   is a 10 s file, not a 40 s one with a freeze. Pauses are subtracted from
   every track's timeline.
3. **Monotonicity.** ScreenCaptureKit does not guarantee non-decreasing
   timestamps, and `AVAssetWriter` rejects a sample that does not advance.
   Small regressions are nudged forward — imperceptible; large ones mean the
   sample is genuinely stale and it is dropped.

`SharedClock` is what lets the screen and camera pipelines run on different
queues and still land on one timeline. Pausing one pauses both.

## `manifest` — `session.json`

Tracks are written as independent files so the webcam bubble can be moved,
resized and reshaped after the fact. That only works if something records how
they line up; this is that something. It also carries the cursor, click and
typing samples the editor's automatic first cut is built from.

**A track's late start exists only here.** The media files are zero-based —
`VideoWriter` opens its session at the first sample's PTS, so that sample
becomes the origin. Take the offset from the manifest and seek the file from
zero. Subtracting a probed file start as well double-counts it, and the result
is a camera a few hundred milliseconds out that nobody notices until they watch
the export.

`MANIFEST_VERSION` is bumped whenever the shape changes incompatibly, so an old
recording opened by a newer build fails loudly instead of exporting something
wrong.

## `state` — the recording lifecycle

`Idle → Preparing → Recording ⇄ Paused → Finalising`, modelled explicitly
because the UI can issue any command at any moment — a global hotkey during
finalisation, a double-click on stop, a pause that races the first frame — and
every one of those must resolve to a defined outcome rather than a half-written
file.
