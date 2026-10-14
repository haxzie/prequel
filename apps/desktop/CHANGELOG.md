# @prequel/desktop

## 0.5.0

### Minor Changes

- b40c5a4: Press C for the slice tool and click to cut a clip, a zoom or a text where you clicked; V goes back to selecting.

  <!-- highlight: Cut anything on the timeline with C -->

### Patch Changes

- 1ceef75: A zoom in a vertical frame follows the pointer anywhere on the screen, not just the strip the recording was cropped to.
- 05030cf: The recording bar is a darker pill with rounded controls, and a take is marked by a shimmering grid of red dots.
- 7a47c1e: A shimmer of light runs over each shape the picker finds when you select an area, then fades.
- ca62d8f: Undo stays in the transport with nothing to undo yet, greyed out, rather than appearing only once you have made an edit.

## 0.4.0

### Minor Changes

- 9ba104b: Selecting an area now finds the panels and cards on screen, so you can click one instead of dragging it out.

  <!-- highlight: Click a shape to select it -->

### Patch Changes

- c42294a: An area recording captures exactly the rectangle you drew, and the outlines in the picker sit on what they name.
- 6080ff2: Exports finish about three times faster, and the files they write are smaller.
- 9ba104b: The picker's highlight lines up with the window, screen or shape it is pointing at.

## 0.3.0

### Minor Changes

- 38f22fb: Put a cutting mat, graph paper or a contour map behind a recording: seven patterns in eight colours, drawn to fit any frame.

### Patch Changes

- 05bb126: Record the Mac's own sound losslessly, so music keeps its quality. Switch it on in Settings under Audio.
- 0fad0a5: Press ⇧⌘5 to start and stop a recording — the shortcut macOS gives to screenshots is Prequel's now.

  <!-- highlight: ⇧⌘5 starts a recording -->

- de5d47b: Settings has a sidebar of its own, splitting recording, shortcuts, permissions and general onto separate screens.

## 0.2.0

### Minor Changes

- 9e015e5: Mark every click with a ripple, sonar, burst, confetti, heart or one of seven more, in any colour and size.

  <!-- highlight: Click effects -->

### Patch Changes

- d289b36: A recording is kept when the microphone or the camera captured nothing, instead of being lost at the stop.
- 351d052: The Mac's own sound is recorded every time, and the editor is where you drop it from a take or set its volume.

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
