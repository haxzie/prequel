---
name: prequel
description: Record this Mac's screen — a window, a display, a region, or a browser you are driving — and get back a finished, auto-edited video with zooms, a framed camera and a background. Also edits an existing recording and renders it. Use whenever asked to record a demo, capture a walkthrough, make a screen recording, or produce a video of something happening on this Mac. Requires the `prequel` command, from prequel.sh.
---

# Prequel

`prequel` records with the Prequel app and hands back a video with the first cut
already made: zooms on every click and on typing, the pointer drawn as a layer,
the take on a background. One command starts, one stops, one renders.

**Run this first, and believe it over this file.** It is generated from the app
on this Mac; this file ships with one version and may be older than the app or
newer than it:

```sh
prequel guide --json
```

If the two disagree about a command name or a flag, the guide is right.

Every command takes `--json`, and answers with one JSON object on stdout
whenever stdout is not a terminal — which is always, for you. Progress goes to
stderr. Exit codes: `0` done, `1` the command failed, `2` the command line was
wrong. A failure carries `{"error":{"code","message"}}`, and the code is what to
branch on: `busy`, `idle`, `not_found`, `denied`, `needs_editor`, `signed_out`,
`unsupported`, `failed`.

## Record something

```sh
prequel status                       # permissions, sign-in, whether a take is running
prequel target list --windows        # ids, titles, apps
prequel record window 12345          # or: record display [id], record area 0,0,1280,800
#   … do the thing you want on screen …
prequel record stop --render         # → { id, dir, durationMs, zooms, clicks, render: { file, … } }
```

Prefer `record window` for a browser or an app: it captures that window alone,
whatever is in front of it. `record display` with no id takes the display the
pointer is on. An area is `x,y,width,height` in points from the display's top
left.

**Nothing is recorded that was not asked for.** No camera, no microphone, no
system audio unless you pass `--camera`, `--microphone` or `--system-audio` —
and those flags become the app's own recording settings, so what the panel shows
is what is being captured. The pointer is never baked into the frames; it is a
layer the edit can restyle or hide.

`prequel record stop` on its own keeps the take and renders nothing. Add
`--render` to get a file straight away, `--open` to leave the editor open for a
person, `--out <file>` to say where the video goes.

Other states: `prequel record pause`, `record resume`, `record cancel` (stops
and deletes), `record status`.

Nothing of Prequel's own appears on screen for a take started this way — no
panel, no camera bubble — so the screen you are capturing is the screen the user
left. Pass `--panel` if a person is going to watch and wants the controls. The
menu bar still shows the take and still stops it.

## Recording a terminal, or anything you have to drive

You cannot type into other apps: the shell you are running in has no
Accessibility grant, and `osascript` keystrokes fail with error 1002. What works
is launching the thing already running what you want to show.

- **Never record the terminal you are running in.** Open a new window with a
  title you choose, and find it by that title:

  ```sh
  open -na Ghostty.app --args --command="/bin/bash /tmp/demo.sh" --title=prequel-demo
  prequel target list --windows   # match on title, never on app name alone
  ```

- **Start the action after the recording, not before.** Have the script wait for
  a file you touch once capture is running, or use `--countdown <seconds>`.
- **Write the script in plain bash and check it first** (`bash -n script.sh`).
  A shell error recorded in full is a take to throw away.
- **Typing printed by a script is not typing.** Prequel's zooms come from real
  clicks and real key presses, so a scripted demo gets none and the text stays
  small in the frame. Add a zoom by editing `project.json` — see below — or
  record a frame size closer to the window, e.g. `--preset 16:9`.
- **Look at the video before you report success.** Pull two or three frames
  with `ffmpeg` and check them. A duration much shorter than the time you
  waited means the take started late or stopped early.
- **Clean up**: close the window you opened, and
  `prequel recordings delete <id>` any take you threw away.

## Then edit it, by editing a file

The edit is a JSON document beside the recording. There is no command for
changing a zoom or a cut — you edit `project.json` directly, which is the same
file the app's editor reads and writes.

```sh
prequel recordings list                      # ids, newest first
prequel recordings show <id>                 # tracks, length, slices, zoom count
prequel project path <id>                    # where project.json is
prequel project schema                       # every field, its units and its allowed values
#   … edit that file …
prequel project check <id>                   # before you render: valid? what got adjusted?
prequel render <id> --out demo.mp4
```

Read `prequel project schema` before the first edit. The three things that catch
people out:

- **Geometry is a fraction of the frame's shorter edge, never pixels.** `0.08`
  of padding is the same look in 16:9 and 9:16. Writing `40` means forty times
  the shorter edge.
- **A cut is a slice of source time, in nanoseconds.** `tracks[0].slices` play
  in array order; removing a stretch means ending one slice early and starting
  the next after it. There is nothing to delete.
- **Settings are flat leaves.** `cameraShape`, `cameraHeight` — never a nested
  `camera: {…}`. `defaults` is what every clip inherits; `slices[].overrides` is
  per clip, as a partial of the same sections.

`prequel project check` is not optional in a loop that edits. It runs the app's
own sanitiser and tells you what it would silently clamp or drop, which is the
difference between an edit that took and an edit you believed took.

What a project may be set to, all answerable with the app closed:

```sh
prequel filters list     # colour looks, and which parameters each one reads
prequel cursors list     # pointer styles
prequel layouts list     # how the screen and the camera share the frame
prequel presets list     # frame sizes, including the social ones
prequel sounds list      # keyboard and click voices
prequel backgrounds list # wallpapers, by category
prequel scenes list      # looks saved on this Mac
```

## Render

```sh
prequel render <id> [--out file.mp4] [--format h264|hevc|gif] [--preset 9:16]
                    [--short-edge 1080] [--fps 60] [--share]
```

Renders on this Mac. **Nothing is uploaded and there is no link** unless you
pass `--share`, which needs `prequel login` — say which you did when you report
back, or ask first if a link is what was wanted.

Frame counts arrive on **stderr** while it runs and the answer is the single
JSON object on **stdout**, so read the two streams separately rather than
merging them and taking the last line.

**`needs_editor` means stop and ask a person.** Burned-in captions, text
overlays and a named cursor tag are drawn by a window, so a headless render
would quietly produce the video without them. The command refuses instead and
names which one. `prequel recordings open <id>` puts it in front of someone who
can export it.

## Captions

```sh
prequel transcript generate <id>     # on-device, nothing leaves the Mac
prequel transcript show <id>
```

A transcript is words with timings. Turning them into _burned-in_ captions is a
project setting — and a project with captions on cannot be rendered from here,
per the rule above. Use the transcript for chapters, a description or a summary,
and leave burned-in captions to the editor.

## Keeping it current

```sh
prequel upgrade --check    # what is available, changing nothing
prequel upgrade            # update the app, and this command with it
```

The CLI lives inside the app, so one command updates both. Installing quits
Prequel and starts it again, so the connection you are holding goes with it —
wait a few seconds before the next command. It refuses while a take is running.

## When it refuses

- `busy` — a take is already running. `prequel record stop` first.
- `idle` — nothing is recording.
- `not_found` — the id is stale. Window ids change when windows close; read
  `prequel target list` again.
- `denied` — macOS has not granted Screen Recording. Nobody can fix that from a
  shell: tell the user to switch Prequel on in System Settings → Privacy &
  Security → Screen & System Audio Recording, and that a grant given while the
  app was running needs the app restarted.
- `failed` with "delivered no frames" — the display is asleep, or Screen
  Recording was granted after the app opened and it needs a restart.
- `needs_editor` — see above.

## Things worth knowing

- The app is launched if it is not running, and stays in the menu bar rather
  than opening a panel over the screen you are about to record.
- `prequel status` never starts it: "is Prequel running" must not be a question
  that changes the answer.
- A recording's id is its folder name under `~/Movies/Prequel/.recordings`. Never
  `cd` into that folder — deleting a recording you are standing in breaks the
  shell you are running in.
- `prequel recordings delete <id>` moves it to the Trash, so it can be put back.
- A packaged app has no console. `~/Library/Logs/Prequel/main.log` has the app's
  side of anything that went wrong.
