# @prequel/desktop

## 0.1.1

### Patch Changes

- 2ffd193: The loupe now spills a little light onto the frame beside it, tinted by what is under the glass, with a Light slider to set it.
- ce72bb5: Opening a long recording no longer crashes the editor, and its waveform appears faster on every open after the first.

## 0.1.0

### Minor Changes

- ab284c4: Record, render and edit from a terminal with the new `prequel` command, installed from the menu bar.

  <!-- highlight: Record from the command line -->

- Take a screenshot instead of a recording: the switch is at the left of the panel.

  <!-- highlight: Screenshots, dressed in the same editor -->

### Patch Changes

- ab284c4: Coding agents can drive Prequel now — `prequel skill install` teaches Claude Code to record for you.
- d3d0761: Picking a source says what to do beside the pointer instead of in a panel across the bottom of the screen.
- d3d0761: The camera bubble on screen is just the picture now, with no ring drawn around it.
- caeccf2: The camera can wear a glass edge, with Depth for how thick it is and Fringing for how much colour it splits.
- d3d0761: The video and screenshot switch marks what you picked in blue, like the rest of the panel.
- 0480751: `prequel version` says which version it is instead of "unknown".
- 3d41eba: Pull a corner in the preview to resize in proportion, or a side to stretch one way — hold Shift on a side to keep the shape.
- ab284c4: The editor opens straight away: the timeline, panels and controls are there while the recording is still loading.
- 435df96: Rate your export out of five once it finishes, and tell us what would have made it better.
- ab284c4: Padding works on a full-frame arrangement, and picking one clears it so the picture starts flush to the edges.
- 324207c: A full-frame arrangement starts flush and square-cornered, and the margin and corners come back when you leave it.
- cb1e7c8: The resize handles stay on the picture while a zoom moves it, instead of waiting where it used to be.
- 1282579: Ten more backgrounds in a new Haze group — five columns of light and five soft horizons.
- 7714d08: The ten Haze backgrounds are clean again — the heavy grain is gone and the colours are unchanged.
- 64ce1e0: Eight more faces to set text in — Inter, Plus Jakarta Sans, Instrument Serif, Fraunces, Anton, Bebas Neue, Caveat and JetBrains Mono.
- 792bf1b: The mark colours sit behind one swatch next to the thickness, and open as a row when you press it.
- ab284c4: Install Prequel in one line: `curl -fsSL https://prequel.sh/install.sh | sh`.
- 5abd1c6: Round the corners of your logo with a new Corner radius slider, up to a full circle.
- ab284c4: Motion blur for the loupe now sits with the other glass controls, under Glass.
- ab284c4: The loupe slightly darkens everything around it and casts a softer shadow, so the glass stands out.
- d3d0761: The mask tool has a new icon that shows what it does to the part of the picture you cover.
- d3d0761: The camera and microphone are one small menu each in the dock: pick a device to switch it on, or pick Off.
- ab284c4: Recordings started from the command line leave the panel and camera bubble off screen.
- 321bea7: Quitting while recording finishes the take first, and a take the app never finished turns up in your recordings.
- ac0be4c: Run `prequel scan` to list the card numbers, API keys, addresses and ID numbers a recording shows, and when.
- 6c8cc54: A screenshot you are editing says Screenshots above it, not Recordings.
- Screenshots open in the editor and get the same background, padding, border and shadow.
- Screenshots save as a PNG and sit in Exports with everything else.
- 6849296: Take a screenshot straight from the menu bar, and find them all in their own Screenshots tab.
- Draw on a screenshot: arrows, lines, boxes, ellipses, freehand, a highlighter and text.
- 90c60f7: Hide something on a screenshot: drag a mask over it and choose blur or pixelate.
- b230c24: Looks saved from a screenshot are offered to screenshots, and looks saved from a recording to recordings.
- 6849296: Share a screenshot: the link opens the picture itself rather than an empty player.
- 2952c46: Text on a screenshot comes in five styles — Classic, Modern, Neon, Typewriter and Strong.
- 90c60f7: Point at something in a screenshot with a loupe or a soft-focus lens, and lean the picture over.
- d3d0761: The teleprompter is one menu in the dock, with Off beside how it scrolls and Edit Script at the bottom.
- ddf3df5: A tooltip rises out of the control it belongs to instead of flying in from the corner of the screen.
- ab284c4: `prequel upgrade` updates the app and the command together.
- 160625d: Lean a recording or a screenshot up to 45 degrees, where it stopped at 30.
- ab284c4: A window recording is framed properly when the pointer was somewhere else while you recorded.
- 0218467: A zoom pushed in close fills the frame edge to edge, and the rounded corners stay on the recording.
