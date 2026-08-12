# prequel-encode

Hardware video and audio encoding to MP4, plus reading a file's timeline back.

Uses `AVAssetWriter` rather than driving `VTCompressionSession` by hand. The
writer sits on VideoToolbox for the actual encode — so this is still hardware
H.264/HEVC on Apple Silicon — but it also handles MP4 muxing, interleaving and
moov-atom placement, which is a meaningful amount of fiddly work to get right
for no benefit.

Both writers have a **live** and an **offline** mode, and the difference is not
cosmetic. Live sets `expectsMediaDataInRealTime` and drops a sample the encoder
is not ready for, which is correct while recording — a dropped frame beats a
stalled capture. Offline waits, because an export that silently loses audio
under load is worse than a slow one.

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test -p prequel-encode
```

Tests shell out to `ffprobe`.

## Traps

**`AVAssetWriter` refuses a URL that already exists** — error `-11823` — rather
than truncating. Remove the file first, or re-exporting fails every time after
the first, which reads as a broken export rather than a stale file.

**`start_session_at_src_time(first_pts)` makes the file zero-based.** The first
sample becomes the origin, so a camera that opened 250 ms late produces a file
that starts at zero, not at 250 ms. Where that offset actually lives is
`session.json` — see `prequel-session`. Pinned by
`tests/probes_a_late_track.rs`.

**The final frame needs a duration.** Ending the session at the last PTS gives
it zero, and the last frame of an export vanishes. End past it.

**Timestamps must advance.** The writer rejects a sample that does not, which
is why `prequel-session`'s clock exists rather than passing host time through.

## `probe`

`probe_file` opens an `AVURLAsset` and reports the track's real start,
duration and dimensions. Both the editor and the exporter read the same probe,
so they agree by construction rather than by two independent readings of an
ambiguity — Chromium's demuxer and AVFoundation do not always agree about
whether a leading gap is an edit list or a gap, and the disagreement is silent.
