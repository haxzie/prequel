---
name: backgrounds
description: Add, change or re-upload the background pictures the editor offers behind a recording. Use when someone adds or removes a wallpaper, renames or re-categorises one, edits `backgrounds/categories.json`, asks why a background is blank or banded, or asks to push the catalogue to R2. Covers the folder layout, the encode requirements (including the grain that stops banding), the upload script, the MD5 dedup, and what to do when a run fails part way.
---

# Background pictures

The pictures the editor draws behind a recording. They live in `backgrounds/`
at the repo root, ship inside the app, and are also uploaded to R2 so the app
can fetch a catalogue rather than carry forty megabytes of JPEGs.

## Where things are

| Path                                              | What it is                                              |
| ------------------------------------------------- | ------------------------------------------------------- |
| `backgrounds/<category>/*.jpg`                    | The one committed copy. Folder name is the category id. |
| `backgrounds/categories.json`                     | Group order and display labels.                         |
| `apps/api/src/lib/backgrounds.ts`                 | The zod schema. Both ends hold it.                      |
| `apps/api/scripts/upload-backgrounds.ts`          | Uploads and writes the catalogue.                       |
| `apps/desktop/scripts/sync-backgrounds.mjs`       | Copies them into the app before a build.                |
| `apps/desktop/src/shared/backgrounds.ts`          | What the _shipped_ app knows about.                     |
| `apps/desktop/resources/backgrounds/`             | **Generated. Git-ignored. Never edit.**                 |
| `apps/api/src/routes/backgrounds.ts`              | Serves the catalogue and the pictures.                  |
| `apps/desktop/src/main/backgrounds.ts`            | Fetches and caches them. All of it lives in main.       |
| `apps/desktop/src/renderer/.../useBackgrounds.ts` | The catalogue, with the shipped presets as fallback.    |

In the bucket: `backgrounds/raw/<file>`, `backgrounds/thumbnail/<file>`,
`backgrounds/config.json`.

## Adding a picture

1. Encode it (see below) and drop it in `backgrounds/<category>/`.
2. Add it to `BACKGROUND_PRESETS` in `apps/desktop/src/shared/backgrounds.ts`
   with a matching `category`, or the app will not offer it. The upload script
   does not read that file and will not warn you.
3. `pnpm --filter @prequel/api backgrounds -- --dry` to see what would happen.
4. `pnpm --filter @prequel/api backgrounds` to upload.
5. `pnpm --filter @prequel/desktop test` — `backgrounds.test.ts` checks every
   preset has a file and lands in a group the picker walks.

The id and label come from the file name: `soft-focus.jpg` becomes
`soft-focus` and `Soft Focus`.

**Never rename a shipped picture.** A project stores the file name
(`{kind: "image", source: "preset", path: "monterey.jpg"}`), so renaming
orphans every edit that chose it — the background silently draws nothing. Add
a new file instead, and leave the old one.

`monterey.jpg` is what a fresh project opens on, via `DEFAULT_BACKGROUND`.
Removing it breaks the first frame of every new recording.

## Encoding: the grain matters

**3200×1800, 16:9, JPEG.** Crop rather than squash.

These are gradients, and a smooth ramp bands visibly once it has been through a
video encoder. Every picture here carries grain as the dither that stops it.
Judge a new one by measuring, not by eye — the file looks fine, and the banding
only appears in the exported video.

Measure the standard deviation of luminance in the flattest 32×32 patch:

- Existing catalogue sits near **2.9** (`aurora.jpg` is 2.877).
- Anything **below ~1** will band and must be dithered.
- Large near-black areas measure low regardless, because noise cannot go below
  zero. That is fine; flat black does not band.

Settings that produced the current set:

| Source                         | Treatment                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Already grainy (measures ≈ 3+) | `sips -s format jpeg -s formatOptions 75 -Z 3200`                                                    |
| Smooth (measures < 1)          | Crop, scale, add uniform noise of amplitude 7 per channel, encode at quality 0.82 → lands at 2.8–2.9 |

Do not "fix" a grainy picture by encoding it at a lower quality. Quality is
what carries the dither.

## Running the upload

```bash
pnpm --filter @prequel/api backgrounds -- --dry   # plan only
pnpm --filter @prequel/api backgrounds           # upload
```

Credentials come from `apps/api/.dev.vars` — `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Same file the Worker
uses, so there is one place to put them. Never print or commit their values.

**macOS only.** It shells out to `sips` for dimensions, thumbnails and the
pixels the BlurHash is computed from, rather than pulling in a native image
dependency.

### What a run does

For each picture: MD5 the bytes, read the dimensions, make a 640px thumbnail
at quality 70, compute a 4×3 BlurHash, upload raw and thumbnail, and collect an
entry. Then validate the whole catalogue against `backgroundsConfig` and write
`backgrounds/config.json`.

**The MD5 is the dedup.** The script reads the catalogue it is about to replace
and skips any picture whose hash still matches. A second run reports
`0 uploaded, 32 unchanged` and costs one GET. The entry is rebuilt either way,
so a label or a category can move without resending pixels.

## When it goes wrong

**Dropped sockets are normal.** A long run of large PUTs will lose a
connection; the script retries four times with backoff. This is not defensive —
it happened on the first real run.

**A failure before the catalogue is written loses the whole run.** The dedup
reads `config.json`, which is only written at the end, so there is no resume
point. Just run it again; it re-uploads everything, which is slow but correct.

**A 4xx fails immediately** rather than retrying. That is a bad credential or a
bad request, and it will fail the same way four times.

**"the catalogue in the bucket did not parse"** is a warning, not an error. The
script uploads everything and replaces it. Expect this after a schema change.

**A blank swatch or a blank background** in the app is almost always a missing
file rather than a rendering bug. Check `backgrounds.test.ts` passes, then check
the file is actually in `apps/desktop/resources/backgrounds` after a sync.

## The schema is the contract

`apps/api/src/lib/backgrounds.ts` is held by both the script that writes the
catalogue and the API that serves it. Change it in one place only, and bump
`BACKGROUNDS_VERSION` when the shape changes in a way an older app cannot read.
The app is expected to keep whatever it had rather than throw: a catalogue it
does not understand means the shipped pictures, not an editor that will not
open.

## How the app gets them

`apps/api/src/routes/backgrounds.ts` serves the catalogue at
`/v1/backgrounds` and the pictures at `/v1/backgrounds/thumbnail/:file` and
`/raw/:file`. Bytes go through the Worker rather than presigned URLs — the
opposite of `videos.ts`, and for the opposite reason: a thumbnail is twenty
kilobytes to everyone, and a URL that never expires is one the app can cache
and revalidate with `If-None-Match`.

`apps/desktop/src/main/backgrounds.ts` does all the fetching, because the
renderer's CSP is `connect-src 'self' prequel-media:` and a window cannot reach
the API at all. The catalogue is cached in `userData` and served stale while it
revalidates; thumbnails are cached there too and read back through
`prequel-media://background/`; the full picture is downloaded into the
_recording_, so it still exports on another machine next year.

The picker draws in the order things can be had: skeleton, then BlurHash from
the catalogue, then the thumbnail fading in over it. Choosing one downloads the
full picture with a spinner on the swatch, and **only applies the setting once
the bytes are there** — applying first left the composition dark for the length
of the download.

Two traps worth knowing:

- **`If-None-Match` arrives quoted, and R2's `onlyIf` throws on the quoted
  form.** That turns the cheapest request the app makes into a 500. The route
  strips the quotes and any `W/`.
- **A failed image load used to be permanent.** `useEditorImages` is keyed on
  the _set_ of paths, so choosing the same background again does not re-run it.
  One failure meant that picture never appeared again for the life of the
  editor, even once the bytes were on disk — which is how a single bad download
  became a dozen backgrounds that "do not get set". It now retries with backoff,
  and the download still finishes before the setting is applied.
- **`response.ok` does not mean a picture was served.** An app pointed at the
  wrong port got another dev server, which answered `200` with an HTML page;
  that page was written as `indigo.jpg` and `existsSync` then made it permanent.
  `fetchInto` checks the `FF D8 FF` marker on what it downloads _and_ on what is
  already on disk, so a poisoned file repairs itself.

Still shipped in the bundle: all of them, via the sync script. Trimming that to
a small offline floor is what actually reclaims the forty megabytes — but keep
_some_, or a first run with no network is an empty picker.
