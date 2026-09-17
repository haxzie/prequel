/**
 * Puts the font files in R2 and writes the catalogue the app reads.
 *
 *   pnpm --filter @prequel/api fonts          # upload what has changed
 *   pnpm --filter @prequel/api fonts --dry    # say what it would do
 *
 * Reads `fonts/` at the repo root: `families.json` lists every family with
 * its id, label and category, and a folder per family id holds one file per
 * variant, named `<weight>.woff2` or `<weight>-italic.woff2` — `400.woff2`,
 * `700-italic.woff2`. The name is the whole description of a variant, so a
 * family gains a weight by gaining a file and nothing else.
 *
 * Files land under `fonts/file/<family>-<weight>[-italic].woff2` and the
 * catalogue at `fonts/config.json`. Re-running is cheap for the reason the
 * backgrounds script is: every entry carries the MD5 of its bytes, and a file
 * whose hash still matches is not sent again.
 *
 * Only open-licence faces belong here; `families.json` carries the licence
 * of each so the answer to "may we ship this" is beside the file.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AwsClient } from "aws4fetch";

import {
  FONTS_CONFIG_KEY,
  FONTS_FILE_PREFIX,
  FONTS_VERSION,
  fontsConfig,
  type FontFamily,
  type FontVariant,
  type FontsConfig,
} from "../src/lib/fonts.ts";

const root = fileURLToPath(new URL("../../../fonts/", import.meta.url));
const dry = process.argv.includes("--dry");

const TYPES: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

// ── credentials ─────────────────────────────────────────────────────────────

/** Read from `.dev.vars`, where the Worker's own secrets already live. */
function credentials(): Record<string, string> {
  const file = fileURLToPath(new URL("../.dev.vars", import.meta.url));
  if (!existsSync(file)) throw new Error(`no ${file} — R2 credentials live there`);

  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, "");
  }

  for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
    if (!out[key]) throw new Error(`${key} is not set in .dev.vars`);
  }
  return out;
}

const env = credentials();

const client = new AwsClient({
  accessKeyId: env.R2_ACCESS_KEY_ID!,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
  // "auto" is the literal string R2 signs with — the same note as `src/lib/r2.ts`.
  region: "auto",
  service: "s3",
});

function objectUrl(key: string): string {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

// ── the run ─────────────────────────────────────────────────────────────────

async function existing(): Promise<Map<string, FontVariant>> {
  const response = await withRetries("reading the catalogue", () =>
    client.fetch(objectUrl(FONTS_CONFIG_KEY)),
  );
  if (response.status === 404) return new Map();
  if (!response.ok) throw new Error(`could not read the catalogue: ${response.status}`);

  const parsed = fontsConfig.safeParse(await response.json());
  if (!parsed.success) {
    console.warn("the catalogue in the bucket did not parse; uploading everything");
    return new Map();
  }

  return new Map(
    parsed.data.families.flatMap((family) =>
      family.variants.map((variant) => [variant.file, variant] as const),
    ),
  );
}

/** Retries, because a run of PUTs will drop a connection; see the backgrounds
    script for why that loses more than one file. */
async function withRetries<T>(what: string, run: () => Promise<T>): Promise<T> {
  let last: unknown;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await run();
    } catch (cause) {
      last = cause;
      const wait = 400 * 2 ** (attempt - 1);
      console.warn(`${what} failed (${attempt}/4), retrying in ${wait}ms`);
      await new Promise((resume) => setTimeout(resume, wait));
    }
  }

  throw last;
}

async function put(key: string, body: Buffer, type: string): Promise<void> {
  await withRetries(`PUT ${key}`, async () => {
    const response = await client.fetch(objectUrl(key), {
      method: "PUT",
      body: new Uint8Array(body),
      headers: { "content-type": type },
    });
    if (!response.ok && response.status >= 500) {
      throw new Error(`PUT ${key} failed: ${response.status}`);
    }
    if (!response.ok) {
      throw Object.assign(new Error(`PUT ${key} refused: ${response.status}`), { fatal: true });
    }
  });
}

/** `400.woff2` → 400 upright; `700-italic.ttf` → 700 italic; else null. */
function variantOf(file: string): { weight: number; italic: boolean; extension: string } | null {
  const match = /^([1-9]00)(-italic)?\.(woff2|woff|ttf|otf)$/i.exec(file);
  if (!match) return null;
  return {
    weight: Number(match[1]),
    italic: Boolean(match[2]),
    extension: match[3]!.toLowerCase(),
  };
}

async function main(): Promise<void> {
  if (!existsSync(root)) throw new Error(`no fonts at ${root}`);

  const listing = JSON.parse(readFileSync(join(root, "families.json"), "utf8")) as {
    categories: { id: string; label: string }[];
    families: { id: string; label: string; category: string; licence: string }[];
  };

  const before = await existing();
  const families: FontFamily[] = [];
  let uploaded = 0;
  let skipped = 0;

  for (const family of listing.families) {
    const folder = join(root, family.id);
    if (!existsSync(folder) || !statSync(folder).isDirectory()) {
      console.warn(`${family.id}: no folder, skipping`);
      continue;
    }

    const variants: FontVariant[] = [];
    for (const file of readdirSync(folder).sort()) {
      const variant = variantOf(file);
      if (!variant) continue;

      const bytes = readFileSync(join(folder, file));
      const md5 = createHash("md5").update(bytes).digest("hex");
      const name = `${family.id}-${String(variant.weight)}${variant.italic ? "-italic" : ""}.${variant.extension}`;
      const was = before.get(name);

      if (was?.md5 === md5) {
        skipped += 1;
      } else if (dry) {
        console.log(`would upload ${family.id}/${file} as ${name}`);
        uploaded += 1;
      } else {
        await put(`${FONTS_FILE_PREFIX}/${name}`, bytes, TYPES[variant.extension]!);
        console.log(`uploaded ${family.id}/${file} as ${name}`);
        uploaded += 1;
      }

      variants.push({
        weight: variant.weight,
        italic: variant.italic,
        file: name,
        md5,
        bytes: bytes.length,
      });
    }

    if (variants.length === 0) {
      console.warn(`${family.id}: no variants named like 400.woff2, skipping`);
      continue;
    }

    families.push({ id: family.id, label: family.label, category: family.category, variants });
  }

  const config: FontsConfig = {
    version: FONTS_VERSION,
    updated: new Date().toISOString(),
    categories: listing.categories,
    families,
  };

  // Validated before it is written, not after — the same reasoning as the
  // backgrounds script.
  const checked = fontsConfig.parse(config);

  if (dry) {
    console.log(`\nwould write ${FONTS_CONFIG_KEY} with ${checked.families.length} families`);
  } else {
    await put(FONTS_CONFIG_KEY, Buffer.from(JSON.stringify(checked, null, 2)), "application/json");
    console.log(`\nwrote ${FONTS_CONFIG_KEY}`);
  }

  console.log(`${checked.families.length} families — ${uploaded} uploaded, ${skipped} unchanged`);
}

await main();
