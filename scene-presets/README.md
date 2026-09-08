# Scene presets

The looks the editor offers above the preview, under **Prequel**. One
`<id>.json` holding the settings, and one `<id>.jpg` beside it — a still of what
that look actually produces, which becomes the card in the picker.

`apps/api/scripts/upload-scene-presets.ts` reads this folder, uploads the cards
to R2 and writes the catalogue the app fetches:

```bash
pnpm --filter @prequel/api scene-presets --dry   # say what it would do
pnpm --filter @prequel/api scene-presets         # publish
```

It hashes each card and skips whatever is already up there unchanged, so a run
that only renames a look sends nothing.

## What a file holds

The shape is `ScenePreset` in `apps/desktop/src/shared/scene-presets.ts`, minus
the fields the uploader fills in (`md5`, `blurhash`, `thumbnail`):

```json
{
  "name": "Kinetic",
  "savedAt": 0,
  "frame": { "width": 1080, "height": 1920, "presetId": "9:16" },
  "layout": { "…": "every key of LayoutSettings" },
  "background": { "…": "every key of BackgroundSettings" },
  "captions": { "…": "CaptionSettings, without captionsOn" },
  "zoom": { "…": "ZoomDefaults" }
}
```

The `id` comes from the file name, so `kinetic.json` is `kinetic`. It is what
the card is served by, so it must be lower-case letters, digits and hyphens —
and it must never change, because it is what an app that has already cached the
card is asking for.

The quickest way to author one is to build the look in the editor, save it, and
copy `~/Library/Application Support/Prequel/scene-presets/<id>/` out — the JSON
is in `presets.json` and the card is `card.jpg`.

## Two rules that are enforced, not conventions

**A wallpaper must already be in the background catalogue.** A look that names
one is applied through the same download the picker uses, so the file has to be
something the app can fetch. Add the picture to `backgrounds/`, publish the
backgrounds, then publish the presets — the uploader refuses the other order and
says which name it could not find.

The check runs the other way too: publishing a background catalogue that
**drops** a picture a published look still names is refused, because nothing
downstream would notice. That would reach an editor as a composition which
simply does not draw.

**The frame may not be `"auto"`.** Automatic is not a size, it is the absence of
choosing one, and the editor writes the recording's own size straight back over
it — so a look carrying it would have its frame silently discarded, and its undo
would appear not to work. Give a real size and a real `presetId`, or `null`.
