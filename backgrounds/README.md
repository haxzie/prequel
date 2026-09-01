# Backgrounds

The one committed copy of the pictures the editor offers behind a recording.
A folder per category; the folder name is the category id, and
`categories.json` gives the order the picker shows them in and what each is
called.

Two things read this folder:

- `apps/desktop/scripts/sync-backgrounds.mjs` copies the pictures into
  `apps/desktop/resources/backgrounds` before a build. That folder is generated
  and git-ignored — a second committed copy would be forty megabytes of the
  same JPEGs, and the two would drift the first time one was edited.
- `apps/api/scripts/upload-backgrounds.ts` uploads them to R2 and writes the
  catalogue the app fetches. It hashes each file and skips whatever is already
  there unchanged, so running it twice costs one `GET`.

To add one: drop a JPEG into the right folder and run the upload script. The
id and the label come from the file name, so `soft-focus.jpg` becomes `Soft
Focus`.

Encode them the way the rest are encoded. These are gradients, and a smooth
ramp bands visibly once it has been through a video encoder — every picture
here carries grain as the dither that stops it. Judge a new one by measuring,
not by eye: a flat patch should have a standard deviation near 3, and the ones
that arrived smooth were dithered on the way in.
