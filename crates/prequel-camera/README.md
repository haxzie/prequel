# prequel-camera

Webcam capture: AVFoundation → timing → encoder → `camera.mp4`.

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test -p prequel-camera
```

`tests/records_the_camera.rs` needs a real camera and the Camera grant, and
skips itself without them.

## Why this is a separate crate

The camera is recorded as its own file rather than composited into the screen
capture. That is what makes the webcam bubble movable, resizable and
reshapeable after the fact — the layout becomes an editing decision instead of
a recording one — and it is why this exists separately from `prequel-capture`,
which owns ScreenCaptureKit.

The two pipelines run on different queues but share one
`prequel_session::SharedClock`, so their timestamps land on a common timeline
and pausing one pauses both.

## Traps

**The camera opens late.** AVFoundation takes a few hundred milliseconds to
start delivering, so `camera.mp4` covers less than the recording does. That
offset lives in `session.json` and nowhere else — the file itself is
zero-based, like every other track. Before the camera's start there is simply
no camera frame, and both the preview and the export must draw nothing rather
than hold a frozen first frame.

**The bubble the user saw while recording is mirrored.** A webcam preview that
is not mirrored feels wrong to the person in front of it, so the bubble flips
horizontally — but the file is written unflipped. Editor defaults must mirror
the camera or every recording looks flipped relative to the take.

**A denied grant makes every camera invisible**, which is indistinguishable
from "you unplugged it" unless the authorisation status is checked — so
`start` checks it and reports the two separately. It also blocks until the
capture session is actually running, so a missing camera or a refused
permission surfaces there rather than as an empty file later.
