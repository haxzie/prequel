/**
 * Fetches the faces in `families.json` from Google Fonts, cut down to the
 * characters a screenshot or a title will ever use.
 *
 *   node fonts/fetch.mjs            # fetch anything missing
 *   node fonts/fetch.mjs --force    # fetch every file again
 *
 * Only the files. `families.json` is written by hand — a family's id, label,
 * category, licence and the variants it is offered in are decisions, and this
 * is the errand that follows them.
 *
 * **Why it re-cuts the files rather than taking Google's own.** The CSS API
 * serves a *subset per script*: `latin` and `latin-ext` are disjoint ranges in
 * two separate files, and the catalogue holds one file per variant — so taking
 * either one alone ships a face that renders tofu the first time somebody
 * types a ł or a ş, with nothing anywhere to say why. Asking as an ancient
 * browser gets the complete font in one piece instead, and `fontTools` cuts
 * that to the range below. The result is about the size of one of Google's
 * subsets and covers both.
 *
 * Needs Python with `fonttools` and `brotli`:
 *
 *   python3 -m pip install 'fonttools[woff]'
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const force = process.argv.includes("--force");

/**
 * The characters the files carry.
 *
 * Google's `latin` and `latin-ext` ranges put together, which is every
 * language written in the Latin alphabet that anybody is likely to annotate a
 * screenshot in — Western, Central and Eastern European, Turkish, Vietnamese
 * left out as it doubles the file for a tone mark this app has never been
 * asked for. Punctuation, currency and the arrows and maths signs people
 * actually type come along: a caption that loses its → is a caption somebody
 * has to rewrite.
 */
const UNICODES = [
  "U+0000-00FF",
  "U+0100-024F",
  "U+0259",
  "U+1E00-1EFF",
  "U+2000-206F",
  "U+2074",
  "U+20A0-20CF",
  "U+2122",
  "U+2190-2193",
  "U+2212",
  "U+2215",
  "U+FEFF",
  "U+FFFD",
].join(",");

/**
 * A browser old enough that Google answers with the whole font in one file.
 *
 * Firefox 30, which is after `woff` and before `unicode-range`: a modern
 * string gets the per-script subsets this script exists to avoid, and an
 * *ancient* one — MSIE 6 — gets EOT, which fontTools cannot read at all and
 * which fails as "bad sfntVersion" rather than as anything about the request.
 * This window is the only one that answers with a complete, readable font.
 */
const ANCIENT = "Mozilla/5.0 (Windows NT 6.1; rv:30.0) Gecko/20100101 Firefox/30.0";

const families = JSON.parse(readFileSync(join(root, "families.json"), "utf8")).families;
if (families.length === 0) {
  console.error("No families listed in families.json.");
  process.exit(1);
}

let fetched = 0;
let kept = 0;

for (const family of families) {
  for (const variant of family.variants) {
    const name = `${String(variant.weight)}${variant.italic ? "-italic" : ""}.woff2`;
    const file = join(root, family.id, name);

    if (!force && existsSync(file)) {
      kept += 1;
      continue;
    }

    // `ital,wght@0,400` — the axis order Google wants, and it is strict: the
    // tuples have to be sorted or the request comes back 400.
    const axis = variant.italic
      ? `ital,wght@1,${String(variant.weight)}`
      : `wght@${String(variant.weight)}`;
    const css = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.google)}:${axis}&display=swap`;

    const sheet = await (await fetch(css, { headers: { "user-agent": ANCIENT } })).text();
    const source = /src:\s*url\(([^)]+)\)/.exec(sheet)?.[1];
    if (!source) {
      console.error(`${family.id} ${name}: Google did not offer that variant`);
      console.error(sheet.slice(0, 200));
      process.exit(1);
    }

    const bytes = Buffer.from(await (await fetch(source)).arrayBuffer());
    mkdirSync(join(root, family.id), { recursive: true });

    const whole = `${file}.whole`;
    writeFileSync(whole, bytes);

    try {
      execFileSync(
        "python3",
        [
          "-m",
          "fontTools.subset",
          whole,
          `--unicodes=${UNICODES}`,
          "--flavor=woff2",
          `--output-file=${file}`,
          // Kept: a face without them kerns badly at display sizes, which is
          // every size this app sets type at.
          "--layout-features+=kern,liga,calt",
          // Dropped: the name table carries a licence a hundred lines long and
          // the file is served beside the licence it was recorded under.
          "--name-IDs=1,2",
        ],
        { stdio: ["ignore", "ignore", "inherit"] },
      );
    } finally {
      rmSync(whole, { force: true });
    }

    fetched += 1;
    console.log(`${family.id}/${name}`);
  }
}

console.log(`\n${String(fetched)} fetched, ${String(kept)} already here.`);
