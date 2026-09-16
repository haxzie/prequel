/**
 * A quote card for a post that exists, drawn from its real data.
 *
 *   node render-quote-card.mjs <out.webp> '<json>'
 *
 *   {"kind":"reddit","where":"r/macapps","author":"u/someone","age":"1y",
 *    "title":"Have any one of you noticed the Screen Studio increased their pricing?",
 *    "body":"optional excerpt, kept short","score":"212","comments":"87",
 *    "url":"https://www.reddit.com/r/macapps/comments/..."}
 *
 * `kind` is reddit | hn | x | g2 and only changes the badge and the labels on
 * the meta line. `where` is the subreddit, the @handle, "Hacker News" or
 * "G2". `score` and `comments` are strings so "1.2k" survives.
 *
 * Why a drawing and not a screenshot. Reddit serves headless Chrome a "prove
 * your humanity" page and redirects a plain fetch of old.reddit.com to login,
 * G2 answers "access restricted" to anything without a real session, and a
 * capture through the user's own browser carries their account in the left
 * rail. The one route that works everywhere is: read the post through the
 * claude-in-chrome extension, then render the words here.
 *
 * Which is also why the data on the card is never typed from memory. Every
 * field comes from the open thread, and the URL goes in the caption under the
 * image so a reader can check the card against the source in one click. A
 * card whose content did not come from a verifiable post is a fabricated
 * review attached to a named company; the SKILL.md beside this says so.
 *
 * Rendered with `--headless=new --screenshot` at 2x rather than over the
 * DevTools protocol, because nothing on this page needs script to run first.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [out, json] = process.argv.slice(2);
if (!out || !json) {
  console.error("usage: render-quote-card.mjs <out.webp> '<json>'");
  process.exit(1);
}
const p = JSON.parse(json);
for (const k of ["kind", "where", "title", "url"]) {
  if (!p[k]) throw new Error(`missing "${k}"`);
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The source's own mark, drawn inline so the card needs no network and no
// font. A coloured dot was the first version and read as a bullet point;
// the mark is what makes a reader recognise the source before the label.
// Snoo is simplified to the head and eyes, which is the form Reddit's own
// favicon uses; the others are the wordmarks at the size they are legible.
const MARKS = {
  reddit: `<svg viewBox="0 0 20 20" width="22" height="22"><circle cx="10" cy="10" r="10" fill="#ff4500"/><path fill="#fff" d="M16.67 10a1.46 1.46 0 0 0-2.47-1 7.12 7.12 0 0 0-3.85-1.23l.65-3.08 2.13.45a1 1 0 1 0 1-.93 1 1 0 0 0-.96.68l-2.38-.5a.16.16 0 0 0-.19.12l-.73 3.44a7.14 7.14 0 0 0-3.89 1.23 1.46 1.46 0 1 0-1.61 2.39 2.87 2.87 0 0 0 0 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a2.87 2.87 0 0 0 0-.44 1.46 1.46 0 0 0 .64-1.57zM8 11a1 1 0 1 1 1 1 1 1 0 0 1-1-1zm5.48 2.68a3.39 3.39 0 0 1-2.48.85 3.39 3.39 0 0 1-2.48-.85.2.2 0 0 1 .28-.28 3 3 0 0 0 2.2.73 3 3 0 0 0 2.2-.73.2.2 0 0 1 .28.28zM13 12a1 1 0 1 1 1-1 1 1 0 0 1-1 1z"/></svg>`,
  hn: `<svg viewBox="0 0 20 20" width="22" height="22"><rect width="20" height="20" rx="3" fill="#ff6600"/><path fill="#fff" d="M9.1 11.4 5.6 4.5h1.9l2.5 5.2 2.5-5.2h1.9l-3.5 6.9v4.1H9.1z"/></svg>`,
  x: `<svg viewBox="0 0 20 20" width="22" height="22"><rect width="20" height="20" rx="3" fill="#111"/><path fill="#fff" d="M4.5 4h3.1l2.7 3.8L13.6 4h1.9l-4.3 5 4.6 7h-3.1l-3-4.2L6 16H4.1l4.7-5.4z"/></svg>`,
  g2: `<svg viewBox="0 0 20 20" width="22" height="22"><circle cx="10" cy="10" r="10" fill="#ff492c"/><text x="10" y="14" text-anchor="middle" font-family="-apple-system, Helvetica, Arial" font-weight="700" font-size="10" fill="#fff">G2</text></svg>`,
};
const BADGE = {
  reddit: { label: "Reddit" },
  hn: { label: "Hacker News" },
  x: { label: "X" },
  g2: { label: "G2" },
}[p.kind];
if (!BADGE) throw new Error(`kind must be reddit | hn | x | g2, not ${p.kind}`);

// Reddit and HN count upvotes and comments; X counts likes and replies; a
// G2 review has a star rating and no thread. The label has to match the
// source or the card claims a number the source does not show.
const META = {
  reddit: [p.score && `${esc(p.score)} upvotes`, p.comments && `${esc(p.comments)} comments`],
  hn: [p.score && `${esc(p.score)} points`, p.comments && `${esc(p.comments)} comments`],
  x: [p.score && `${esc(p.score)} likes`, p.comments && `${esc(p.comments)} replies`],
  g2: [p.score && `${esc(p.score)} / 5`],
}[p.kind].filter(Boolean);

// Long bodies make a tall card that crowds the post; the point is the
// complaint, and the link under the image carries the rest.
const body = p.body ? String(p.body).slice(0, 420).trim() : "";

// 720 CSS px wide, drawn at 2x, matching the crop width the hand-cropped
// captures in public/blog/quotes/ landed at. `mdx-components.tsx` sizes on
// the image's own proportions, so the card is written at its natural height
// rather than padded onto 16:10.
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #fff; }
  body { width: 720px; font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
         -webkit-font-smoothing: antialiased; color: #1c1c1c; }
  .card { padding: 22px 26px 20px; }
  .head { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #576f76; margin-bottom: 10px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: #1c1c1c; }
  .badge svg { display: block; }
  .where { font-weight: 600; color: #1c1c1c; }
  .title { font-size: 19px; font-weight: 600; line-height: 1.32; margin: 0 0 8px; letter-spacing: -0.01em; }
  .body { font-size: 14.5px; line-height: 1.5; color: #333; margin: 0 0 12px; white-space: pre-wrap; }
  .meta { display: flex; gap: 18px; font-size: 13px; color: #576f76; font-weight: 500; }
  .sep::before { content: "·"; }
</style></head><body>
<div class="card">
  <div class="head">
    <span class="badge">${MARKS[p.kind]}${esc(BADGE.label)}</span>
    ${p.where !== BADGE.label ? `<span class="sep"></span><span class="where">${esc(p.where)}</span>` : ""}
    ${p.author ? `<span class="sep"></span><span>${esc(p.author)}</span>` : ""}
    ${p.age ? `<span class="sep"></span><span>${esc(p.age)}</span>` : ""}
  </div>
  <p class="title">${esc(p.title)}</p>
  ${body ? `<p class="body">${esc(body)}</p>` : ""}
  ${META.length ? `<div class="meta">${META.map((m) => `<span>${m}</span>`).join("")}</div>` : ""}
</div>
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), "quote-card-"));
const page = join(dir, "card.html");
const png = join(dir, "card.png");
writeFileSync(page, html);

// A tall window so the page never scrolls; the trim below cuts the white
// underneath the card to its real height.
execFileSync(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--force-device-scale-factor=2", "--window-size=720,1400",
  `--screenshot=${png}`, `file://${page}`,
], { stdio: "ignore" });

// `-trim` finds the card's real edges, which also eats the padding, so the
// padding is put back as a uniform border (52x44 at 2x is the 26x22 the CSS
// asked for). No drawn frame: the `img` override in `mdx-components.tsx` adds
// its own hairline, and a second one reads as double-framed.
execFileSync("magick", [
  png, "-trim", "+repage", "-bordercolor", "#fff", "-border", "52x44",
  "-strip", "-quality", "88", out,
]);
rmSync(dir, { recursive: true, force: true });
console.log(`${out}  <- ${p.url}`);
