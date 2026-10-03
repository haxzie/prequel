/**
 * Tags the commit that bumped the version, and says what it tagged.
 *
 * The last step of the release, run on `main` by `release.yml` once the version
 * pull request has merged. Nobody types `git tag` any more: the version in
 * `apps/desktop/package.json` is whatever the changesets added up to, and the
 * tag is that version with a `v` on the front.
 *
 * Idempotent. The workflow runs on every push to `main`, and all but a handful
 * of those are pushes with no version change in them — so finding the tag
 * already there is the ordinary case and exits 0 having done nothing.
 *
 * Writes `tagged` and `version` to `$GITHUB_OUTPUT` so the workflow can decide
 * whether to build. Printing them is not enough: the build is what ships to
 * every installed copy, and "did this push release something" has to be a value
 * rather than a line somebody greps.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(
  readFileSync(new URL("../apps/desktop/package.json", import.meta.url), "utf8"),
).version;
const tag = `v${version}`;

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function output(tagged) {
  const file = process.env["GITHUB_OUTPUT"];
  if (file) appendFileSync(file, `tagged=${String(tagged)}\nversion=${version}\ntag=${tag}\n`);
  console.log(tagged ? `tagged ${tag}` : `${tag} already exists; nothing to release`);
}

// Remote rather than local: the checkout is shallow in CI and may hold no tags
// at all, and a local answer would re-tag a version that shipped last week.
const existing = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`);
if (existing !== "") {
  output(false);
  process.exit(0);
}

// Annotated, like every tag this repo has had. `git describe --abbrev=0` in the
// build's release notes walks annotated tags, and a lightweight one would be
// skipped — the compare link would then point at the release before last.
git("tag", "-a", tag, "-m", `Prequel ${version}`);
git("push", "origin", tag);

output(true);
