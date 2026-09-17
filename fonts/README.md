# Fonts

The faces the editor's text overlays can be set in, beyond what macOS ships.

`families.json` lists every family: an `id` a project stores, a `label` the
picker shows, a `category` it is grouped under, and its `licence`. A folder
named after the id holds one file per variant, named by weight and slant —
`400.woff2`, `700.woff2`, `700-italic.woff2`. Only open-licence faces belong
here.

`pnpm --filter @prequel/api fonts` puts them in R2 and writes the catalogue;
`--dry` says what it would do. The app fetches the catalogue from
`/v1/fonts` and each file the first time a text asks for it.
