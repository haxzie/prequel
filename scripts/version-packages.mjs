/**
 * Turns the pending changesets into a version and a changelog entry.
 *
 * Run by `.github/workflows/release.yml`, which puts the result in a pull
 * request called "Release x.y.z". Nothing here pushes, tags or publishes — this
 * writes three files and stops:
 *
 *   - `apps/desktop/package.json`, bumped by `changeset version`
 *   - `apps/web/src/content/changelog/<version>.mdx`, the release as the site
 *     shows it
 *   - `apps/web/src/content/changelog.ts`, whose `RELEASES` array is the order
 *     the page reads in
 *
 * The changelog is written here rather than by changesets' own formatter
 * because the site's entry is not a `CHANGELOG.md`: it is an `.mdx` with two
 * exports on top, it is ordered by an array in a TypeScript file, and the
 * release workflow reads it back out as the GitHub release's notes. One script
 * that knows all three beats a formatter that knows the first.
 *
 * The changesets are read *before* `changeset version` runs, because that is
 * what deletes them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const CHANGESETS = join(root, ".changeset");
const DESKTOP = join(root, "apps/desktop/package.json");
const ENTRIES = join(root, "apps/web/src/content/changelog");
const REGISTRY = join(root, "apps/web/src/content/changelog.ts");

/**
 * The line a release is known by, carried in a comment rather than in the
 * frontmatter.
 *
 * `<!-- highlight: Record from the command line -->` anywhere in a changeset's
 * body. A comment because changesets parses the frontmatter as a map of package
 * to bump and refuses a key that is not a package — and because a marker that
 * renders as nothing cannot leak into the sentence if this script ever stops
 * stripping it.
 */
const HIGHLIGHT = /<!--\s*highlight:\s*(.+?)\s*-->/i;

/** Every pending changeset, as `{ bump, line, highlight }`. */
function pending() {
  if (!existsSync(CHANGESETS)) return [];

  return readdirSync(CHANGESETS)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => {
      const text = readFileSync(join(CHANGESETS, name), "utf8");
      const [, frontmatter = "", body = ""] = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(
        text,
      ) ?? [undefined, "", text];

      // The biggest bump the file asks for. A changeset may name several
      // packages; only one of them is ever versioned here, but reading them all
      // keeps this honest if that changes.
      const bump = /\bmajor\b/.test(frontmatter)
        ? "major"
        : /\bminor\b/.test(frontmatter)
          ? "minor"
          : "patch";

      const marked = HIGHLIGHT.exec(body);
      const line = body
        .replace(HIGHLIGHT, "")
        .trim()
        // One entry per changeset. A body that runs to several paragraphs is a
        // changeset that should have been two, and joining them into one bullet
        // is the readable half of saying so.
        .split(/\r?\n\s*\r?\n/)[0]
        ?.replace(/\s*\r?\n\s*/g, " ")
        .trim();

      return { name, bump, line, highlight: marked?.[1] };
    })
    .filter((entry) => entry.line);
}

/**
 * What the release is called in one fragment, for the pill on the home page.
 *
 * An explicit marker wins. Failing that, the first line of the most significant
 * changeset — a release's headline is almost always the thing that moved the
 * version — with its full stop removed, because the pill is a fragment rather
 * than a sentence.
 */
function highlightOf(entries) {
  const marked = entries.find((entry) => entry.highlight);
  if (marked) return marked.highlight;

  const order = { major: 0, minor: 1, patch: 2 };
  const first = [...entries].sort((a, b) => order[a.bump] - order[b.bump])[0];
  return (first?.line ?? "A new version").replace(/\.$/, "");
}

/** The `.mdx` the site renders, and the GitHub release reads back. */
function entryFile(version, entries) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = entries.map((entry) => `- ${entry.line}`).join("\n");

  // No `draft` export. The file is written by the release itself, so there is
  // no window in which it exists unreleased — which is exactly what that flag
  // was for when the entry was written by hand days ahead.
  return `export const date = "${date}";\nexport const highlight = "${highlightOf(entries).replace(/"/g, '\\"')}";\n\n${lines}\n`;
}

/**
 * Puts the version at the top of `RELEASES`.
 *
 * Newest first, and by insertion rather than by sorting: the array is read as
 * the page's order, and sorting it as text is the bug its own comment warns
 * about — `0.0.9` lands after `0.0.13`.
 */
function register(version) {
  const source = readFileSync(REGISTRY, "utf8");
  if (source.includes(`"${version}"`)) return false;

  const updated = source.replace(
    /export const RELEASES = \[\n/,
    `export const RELEASES = [\n  "${version}",\n`,
  );
  if (updated === source) {
    throw new Error(`could not find RELEASES in ${REGISTRY} to add ${version} to`);
  }

  writeFileSync(REGISTRY, updated);
  return true;
}

/**
 * Biggest change first, then by file name.
 *
 * `readdir` order is the order the filesystem happens to hold them in, which is
 * neither the order they were written nor any order worth reading: it put the
 * command line — the reason the release exists — fourth, under a note about a
 * control moving panel. A reader scans the top of a release and stops, so the
 * entry that moved the version belongs there. The name is the tie-break so the
 * same set of changesets always produces the same file.
 */
function ordered(entries) {
  const weight = { major: 0, minor: 1, patch: 2 };
  return [...entries].sort(
    (a, b) => weight[a.bump] - weight[b.bump] || a.name.localeCompare(b.name),
  );
}

const entries = ordered(pending());
if (entries.length === 0) {
  console.log("no changesets: nothing to version");
  process.exit(0);
}

const before = JSON.parse(readFileSync(DESKTOP, "utf8")).version;

execFileSync("pnpm", ["exec", "changeset", "version"], { cwd: root, stdio: "inherit" });

const version = JSON.parse(readFileSync(DESKTOP, "utf8")).version;
if (version === before) {
  throw new Error(
    `changeset version left apps/desktop at ${version}. Every changeset here must name "@prequel/desktop" — see .changeset/README.md`,
  );
}

const path = join(ENTRIES, `${version}.mdx`);
writeFileSync(path, entryFile(version, entries));
register(version);

// The site's files are Prettier-checked in CI, and this writes two of them.
execFileSync("pnpm", ["exec", "prettier", "--write", path, REGISTRY], { cwd: root, stdio: "pipe" });

console.log(`${before} → ${version}, ${String(entries.length)} entries in ${version}.mdx`);
