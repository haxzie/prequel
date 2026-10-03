# @prequel/desktop

## 0.1.0

### Minor Changes

- ab284c4: Record, render and edit from a terminal with the new `prequel` command, installed from the menu bar.

  <!-- highlight: Record from the command line -->

- Take a screenshot instead of a recording: the switch is at the left of the panel.

  <!-- highlight: Screenshots, dressed in the same editor -->

### Patch Changes

- ab284c4: Coding agents can drive Prequel now — `prequel skill install` teaches Claude Code to record for you.
- ab284c4: The editor opens straight away: the timeline, panels and controls are there while the recording is still loading.
- 435df96: Rate your export out of five once it finishes, and tell us what would have made it better.
- ab284c4: Padding works on a full-frame arrangement, and picking one clears it so the picture starts flush to the edges.
- 324207c: A full-frame arrangement starts flush and square-cornered, and the margin and corners come back when you leave it.
- cb1e7c8: The resize handles stay on the picture while a zoom moves it, instead of waiting where it used to be.
- ab284c4: Install Prequel in one line: `curl -fsSL https://prequel.sh/install.sh | sh`.
- ab284c4: Motion blur for the loupe now sits with the other glass controls, under Glass.
- ab284c4: The loupe slightly darkens everything around it and casts a softer shadow, so the glass stands out.
- ab284c4: Recordings started from the command line leave the panel and camera bubble off screen.
- Screenshots open in the editor and get the same background, padding, border and shadow.
- Screenshots save as a PNG and sit in Exports with everything else.
- Draw on a screenshot: arrows, lines, boxes, ellipses, freehand, a highlighter and text.
- b230c24: Looks saved from a screenshot are offered to screenshots, and looks saved from a recording to recordings.
- ab284c4: `prequel upgrade` updates the app and the command together.
- ab284c4: A window recording is framed properly when the pointer was somewhere else while you recorded.
- 0218467: A zoom pushed in close fills the frame edge to edge, and the rounded corners stay on the recording.
