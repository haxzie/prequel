# Music

The library the editor's **Add Ambient Music** offers, one folder per category.
`categories.json` is the order the picker shows them in; a folder not listed
there is skipped.

Everything in here is uploaded to R2 and served from `/v1/music` — the app
carries none of it in its bundle. Put any audio format macOS reads into a
category folder; `pnpm --filter @prequel/api music` converts each one to a
`.m4a` under its own name and writes the catalogue.

```bash
pnpm --filter @prequel/api music --dry   # say what it would do
pnpm --filter @prequel/api music         # upload what has changed
```

Two rules, both of them load-bearing:

- **A file name is what a project stores**, so renaming one orphans every
  recording that chose it. Add a new name instead.
- **Only music you have the right to redistribute.** The editor puts these
  inside somebody's exported video. Where the licence asks for a credit, put it
  in `attribution.json` beside the audio — `{ "wander.m4a": "…" }` — and the
  catalogue carries it through to the app.
