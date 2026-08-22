# Competitor logos

Drop `<slug>.svg` in here and the comparison page picks it up. Nothing else to
change — `Mark` in `src/components/comparison/Comparison.tsx` checks for the
file at build time, so a slug with no file renders its monogram instead and a
slug with one renders the logo. Adding a logo is one file; removing it is
deleting that file.

The slug is the same one in `src/content/competitors.ts`, which is also the URL
segment: `screen-studio.svg`, `loom.svg`, `obs.svg`, and so on.

## Before you add one

**These are other companies' trademarks.** Using them to identify the product a
comparison page is about is ordinary nominative use, but it is a decision with
terms attached, and the terms differ per vendor. Check the vendor's brand
guidelines before adding a file. Prefer artwork the vendor publishes themselves
over anything traced from a screenshot.

**Apple's are the strictest of the eleven.** Their third-party guidelines allow
referential use of the word mark — "a QuickTime alternative" — but not
reproduction of their graphic marks in promotional material, which a comparison
page is. The QuickTime icon is here anyway, deliberately and with that
understood. It is the one file in this directory that is a judgement call rather
than a routine one, so if the set is ever trimmed back, start there.

`logoAllowed` in `competitors.ts` is the lever: set it `false` and that page
falls back to its monogram without deleting anything. It is checked before the
filesystem, so it is the answer rather than a hint, and a leftover file cannot
quietly reinstate a mark that was pulled on purpose.

## What renders well

`.svg` is preferred and `.png` is accepted, in that order. Most of these marks
only exist as raster — an app icon is drawn as one — so refusing PNG would mean
most pages falling back to a monogram over a file format.

The tile is 64px with 12px of padding, on `--surface`. **This site is dark
only**, so the contrast question has one answer rather than two:

- **Square-ish artwork.** A wide wordmark shrinks to nothing inside a square.
  Use the vendor's app icon or glyph mark, not their full lockup.
- **Nothing near-black on transparent.** It vanishes into the tile. A
  brand-coloured or light mark is safe; white-on-transparent is fine here.
- **A real `viewBox` on an SVG.** Without one the browser cannot scale it into
  the tile and it renders at its intrinsic size.
- **Flattened text.** A logo relying on a font that is not on the visitor's
  machine falls back to something that is not the logo.

Artwork **fills** the tile and is clipped by it, rather than sitting inset. Most
of these arrive as an `apple-touch-icon.png` flattened onto opaque white, and a
white square floating inside a rounded tile reads as a postage stamp. Filling
means the squircle rounds their background the way it rounds ours.

So a file with transparent margin baked into it renders smaller than the tile
with a gap around it. Trim that margin before adding the file, and square the
canvas to the artwork's own longest side:

```bash
magick in.png -trim +repage -background none -gravity center \
  -set option:side "%[fx:max(w,h)]" -extent "%[side]x%[side]" \
  -resize 256x256\> -strip out.png
```

The `>` matters — it caps the long side at 256 without enlarging anything below
it. Upscaling a 140px app icon to 256 only adds blur; the tile is 64 CSS px, so
128 already covers a 2x display.

Served as a plain `<img>` rather than through `next/image`: Next refuses SVG
unless `dangerouslyAllowSVG` is on, and enabling that for files we did not draw
is not a trade worth making for eleven icons.

## Where these came from

Every file here was taken from the vendor's own published artwork, normalised
only by trimming transparent margin and resizing to a 256px square:

| Slug            | Source                                                           |
| --------------- | ---------------------------------------------------------------- |
| `screen-studio` | `screen.studio/icon.png`                                         |
| `loom`          | `cdn.loom.com/assets/favicons-loom/apple-touch-icon-180x180.png` |
| `obs`           | `obsproject.com/assets/images/new_icon_small-r.png`              |
| `cleanshot-x`   | `cleanshot.com/apple-touch-icon.png`                             |
| `descript`      | `static-cdn.descript.com/web/icons/favicon.svg`                  |
| `cap`           | `cap.so/apple-touch-icon.png`                                    |
| `tella`         | `tella.tv/apple-touch-icon.png`                                  |
| `camtasia`      | Mac App Store artwork, TechSmith Camtasia 2024                   |
| `screenflow`    | Mac App Store artwork, ScreenFlow 10                             |
| `focusee`       | Mac App Store artwork, FocuSee (iMobie)                          |
| `quicktime`     | Apple's QuickTime Player app icon, supplied by hand              |

`camtasia`, `screenflow` and `focusee` are the **product** icons. Their vendors' site favicons are the
_company_ mark — TechSmith's T, Telestream's t — which is a different logo from
the app the page is comparing against, and using it would be a small factual
error on a page whose whole argument is that its facts are checked.
