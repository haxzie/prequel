# Fonts

The faces the editor's text overlays can be set in, beyond what macOS ships.

`families.json` lists every family: an `id` a project stores, a `label` the
picker shows, a `category` it is grouped under, its `licence`, the `google`
family it comes from, and the variants it is offered in. A folder named after
the id holds one file per variant, named by weight and slant — `400.woff2`,
`700.woff2`, `700-italic.woff2`. Only open-licence faces belong here.

```bash
node fonts/fetch.mjs                      # fetch what is missing from Google Fonts
node fonts/fetch.mjs --force              # fetch every file again
pnpm --filter @prequel/api fonts --dry    # say what it would upload
pnpm --filter @prequel/api fonts          # upload to R2 and write the catalogue
```

The app fetches the catalogue from `/v1/fonts` and each file the first time a
text asks for it. Both are cached in `userData/fonts`: a file for ever — its
name never changes meaning, and a project set in it has to keep rendering the
same — and the catalogue for six hours, served from disk at once and
re-checked behind, so a family added here turns up by itself.

## Adding a family

Add it to `families.json` with the weights you want and run `fetch.mjs`. The
files it writes are cut down to Latin and Latin Extended, which is every
language written in that alphabet, and that is why they are re-cut rather than
taken as Google serves them: the CSS API hands out a _subset per script_ in
separate files, and the catalogue holds one file per variant — so shipping
either one alone renders tofu the first time somebody types a ł or a ş.

`fetch.mjs` needs Python with `fonttools` and `brotli`:

```bash
python3 -m pip install 'fonttools[woff]'
```

Nothing is bundled into the app. A face that nobody picks is never downloaded.
