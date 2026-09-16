#!/usr/bin/env bash
# Mechanical checks for one blog post. Usage: check-post.sh <slug>
#
# Everything here is a rule a reviewer has caught by eye at least once and
# then missed on the next post. The read is still the reviewer's job; this is
# the half that a grep does better than a person, run from the repo root.
#
# Exit status is the number of blockers, so it can gate a script.
set -u

slug="${1:?usage: check-post.sh <slug>}"
root="$(cd "$(dirname "$0")/../../../.." && pwd)"
web="$root/apps/web"
mdx="$web/src/content/blog/$slug.mdx"
posts="$web/src/content/posts.ts"

blockers=0
warnings=0
blocker() { printf '  BLOCK  %s\n' "$*"; blockers=$((blockers + 1)); }
warn()    { printf '  warn   %s\n' "$*"; warnings=$((warnings + 1)); }
ok()      { printf '  ok     %s\n' "$*"; }

if [ ! -f "$mdx" ]; then
  echo "no such post: $mdx"
  exit 1
fi

echo "== $slug"

# --- Voice -----------------------------------------------------------------

# The first thing the user notices, every time. Em dashes anywhere in prose.
n=$(grep -c "—" "$mdx")
[ "$n" -eq 0 ] && ok "no em dashes" || blocker "$n line(s) with an em dash"

# American spellings arrive with competitor research and survive a read.
if grep -niE "normaliz|customiz|behavior|centered|color[^u]|favorite|license[ds]? " "$mdx" >/dev/null; then
  blocker "American spelling: $(grep -noiE 'normaliz\w*|customiz\w*|behavior\w*|centered|color[^u]\w*|favorite\w*|license[ds]? ' "$mdx" | head -5 | tr '\n' ' ')"
else
  ok "British spelling"
fi

# The rhetorical shapes banned by name on 2026-09-10.
if grep -niE "not (just|only|merely) [^.]*, but|rather than|instead of" "$mdx" >/dev/null; then
  warn "contrast flourishes (not just X but Y / rather than / instead of): $(grep -ncE 'not (just|only|merely) [^.]*, but|rather than|instead of' "$mdx" || true) line(s); a factual contrast is fine, a definition-by-negation is not"
else
  ok "no contrast flourishes"
fi

if grep -niE "seamless|powerful|cutting.edge|state.of.the.art|revolutionar|robust|leverage|game.chang|effortless|in today's|worth noting|it is worth|it's worth|furthermore|in conclusion|workflow|experience" "$mdx" >/dev/null; then
  warn "buzzword or filler: $(grep -noiE "seamless|powerful|cutting.edge|state.of.the.art|revolutionar|robust|leverage|game.chang|effortless|in today's|worth noting|it is worth|it's worth|furthermore|in conclusion|workflow|experience" "$mdx" | head -6 | tr '\n' ' ')"
else
  ok "no buzzwords or filler"
fi

# --- Claims that may not be made -------------------------------------------

if grep -niE "dead air|remove[sd]? silence|cuts? silence|trims? silence|silence detection" "$mdx" >/dev/null; then
  blocker "claims Prequel cuts silences; the first pass never trims"
else
  ok "no silence-cutting claim"
fi

if grep -niE "the catch|downside|drawback|to be fair|admittedly|still early|still new|not yet" "$mdx" >/dev/null; then
  warn "possible Prequel shortcoming named: $(grep -noiE 'the catch|downside|drawback|to be fair|admittedly|still early|still new|not yet' "$mdx" | head -4 | tr '\n' ' ')"
else
  ok "no shortcoming language"
fi

# The one thing that stays in: whether it runs on the reader's Mac.
if grep -qiE "apple silicon" "$mdx" && grep -qiE "macos 14" "$mdx"; then
  ok "requirements stated (Apple Silicon, macOS 14)"
else
  warn "requirements not stated; a post that sells Prequel names Apple Silicon and macOS 14 or later once"
fi

# Prices are read from lib/pricing.ts, never remembered. Check the post's
# numbers against it.
lifetime=$(grep -oE 'PRICE_LIFETIME = "\$[0-9]+"' "$web/src/lib/pricing.ts" | grep -oE '\$[0-9]+')
monthly=$(grep -oE 'PRICE_MONTHLY = "\$[0-9]+"' "$web/src/lib/pricing.ts" | grep -oE '\$[0-9]+')
if grep -qE '\$[0-9]+ (once|one-off|lifetime)' "$mdx"; then
  if grep -qE "\\$lifetime (once|one-off|lifetime)" "$mdx"; then ok "lifetime price matches pricing.ts ($lifetime)"; else blocker "lifetime price does not match pricing.ts ($lifetime)"; fi
fi
if grep -qE '\$[0-9]+ ?(a|per|/) ?month' "$mdx"; then
  if grep -qE "\\$monthly ?(a|per|/) ?month" "$mdx"; then ok "monthly price matches pricing.ts ($monthly)"; else blocker "monthly price does not match pricing.ts ($monthly)"; fi
fi

# --- Structure -------------------------------------------------------------

if grep -q "^# " "$mdx"; then
  blocker "has a '# ' heading; the h1 comes from posts.ts, start at ##"
else
  ok "no h1 in the MDX"
fi

first=$(grep -m1 "^## " "$mdx")
case "$first" in
  "## What is"*|"## How do you"*|"## TL;DR"*) ok "opens with a definitional question or TL;DR" ;;
  *) warn "first heading is '$first'; a post opens with '## What is <thing>?' (roundups: TL;DR first, the question under it)" ;;
esac

# The definitional question must be unique across the blog.
q=$(grep -m1 -E "^## (What is|How do you)" "$mdx" || true)
if [ -n "$q" ]; then
  dup=$(grep -lxF "$q" "$web"/src/content/blog/*.mdx | grep -v "/$slug.mdx" || true)
  [ -z "$dup" ] && ok "definitional question is unique" || blocker "definitional question also opens: $(basename "$dup")"
fi

if grep -qiE "^## (faq|frequently asked)" "$mdx"; then
  blocker "body FAQ section; the FAQ lives on the posts.ts entry and the template renders it"
else
  ok "no body FAQ"
fi

# Headings in sentence case. A proper noun starts many headings here ("Screen
# Studio", "OBS Studio"), so the test is not "second word capitalised" but
# "two or more capitalised words after the first", which is what title case
# produces and a name at the front does not.
bad=$(grep -E "^##+ " "$mdx" | sed -E 's/^##+ ([0-9]+\. )?//' | awk '{
  c = 0; for (i = 2; i <= NF; i++) if ($i ~ /^[A-Z][a-z]/) c++;
  if (NF >= 3 && c >= 2) print
}')
[ -z "$bad" ] && ok "headings read as sentence case" || warn "heading may be title case: $(echo "$bad" | head -3 | tr '\n' '|')"

# --- Links -----------------------------------------------------------------

# The citation hosts, and nothing else. A competitor is never linked; a
# vendor URL in a post is the thing this check exists to catch.
hosts=$(grep -ohE "https?://[a-z0-9./-]+" "$mdx" | sed -E 's|(https?://[^/]+).*|\1|' | sort -u \
  | grep -vE "^https?://(www\.|old\.)?(reddit\.com|news\.ycombinator\.com|x\.com|g2\.com|github\.com|producthunt\.com)$" || true)
[ -z "$hosts" ] && ok "no outside host beyond the citation hosts" || blocker "links an outside host: $(echo "$hosts" | tr '\n' ' ')"

# A quote card is evidence only with its link under it. Every image in
# /blog/quotes/ is followed within six lines by a link to a citation host.
while IFS= read -r ln; do
  n=${ln%%:*}
  sed -n "$((n + 1)),$((n + 6))p" "$mdx" | grep -qE "\]\(https?://" || blocker "line $n: quote card with no source link under it"
done < <(grep -nE '^!\[[^]]*\]\(/blog/quotes/' "$mdx" || true)

# `[a-z0-9-]+\)` so an image under /blog/tools/ is not counted as a post link.
internal=$(grep -ohE '\]\(/blog/[a-z0-9-]+\)' "$mdx" | sed 's|](/blog/||; s|)||' | sort -u)
count=$(echo "$internal" | grep -c . || true)
for s in $internal; do
  [ -f "$web/src/content/blog/$s.mdx" ] || blocker "/blog/$s has no MDX file"
done
[ "$count" -ge 5 ] && ok "$count internal blog links" || warn "$count internal blog links; a guide carries five or more"

for s in $(grep -ohE '\]\(/alternatives/[a-z0-9-]+' "$mdx" | sed 's|](/alternatives/||' | sort -u); do
  [ -f "$web/src/content/alternatives/$s.mdx" ] && ok "/alternatives/$s exists" || blocker "/alternatives/$s has no page"
done

grep -q "](/pricing)" "$mdx" && ok "closes to /pricing" || warn "no /pricing link"

# --- Images ----------------------------------------------------------------

for img in $(grep -ohE '!\[[^]]*\]\(/[^)]+\)' "$mdx" | sed -E 's/.*\]\(([^)]+)\)/\1/' | sort -u); do
  [ -f "$web/public$img" ] || blocker "image missing: public$img"
  case "$img" in *.webp) ;; *) blocker "image is not WebP: $img" ;; esac
done
if grep -qE '!\[\]\(' "$mdx"; then blocker "image with empty alt text"; fi
figures=$(grep -cE '^!\[|^<[A-Z][A-Za-z]*Shot' "$mdx" || true)
[ "$figures" -ge 1 ] && ok "$figures figure(s)" || warn "no figures; a guide carries at least one drawn figure or pooled shot"

# --- posts.ts ----------------------------------------------------------------

if ! grep -q "slug: \"$slug\"" "$posts"; then
  blocker "no entry in posts.ts"
else
  ok "registered in posts.ts"
  # The entry runs from its slug line to the closing `  },` at two spaces of
  # indent; the FAQ objects inside close at deeper indents.
  entry=$(awk -v s="slug: \"$slug\"" '$0 ~ s {p=1} p {print} p && /^  \},?$/ {exit}' "$posts")
  faqs=$(echo "$entry" | grep -c "question:" || true)
  [ "$faqs" -ge 4 ] && ok "$faqs FAQ entries" || warn "$faqs FAQ entries; four to six for a guide, six or so for a roundup"
  echo "$entry" | grep -q "—" && blocker "em dash in the posts.ts entry"
  if echo "$entry" | grep -q "pillar:"; then
    p=$(echo "$entry" | grep -oE 'pillar: "[a-z0-9-]+"' | grep -oE '"[a-z0-9-]+"' | tr -d '"')
    [ -f "$web/src/content/blog/$p.mdx" ] && ok "pillar /blog/$p exists" || blocker "pillar $p has no MDX"
  else
    warn "no pillar: this post is a pillar, which is a decision to make with the user"
  fi
  words=$(wc -w < "$mdx" | tr -d ' ')
  mins=$(echo "$entry" | grep -oE 'readingMinutes: [0-9]+' | grep -oE '[0-9]+')
  want=$(( (words + 100) / 200 ))
  if [ -n "$mins" ] && [ $(( mins - want )) -le 1 ] && [ $(( want - mins )) -le 1 ]; then
    ok "readingMinutes $mins for $words words"
  else
    warn "readingMinutes $mins for $words words; about $want"
  fi
  # The excerpt string sits on the line after `excerpt:`.
  echo "$entry" | grep -A1 "excerpt:" | grep -qE '^ *"(Learn how|Discover|Unlock|Find out)' && warn "excerpt opens with a pitch; it states what the post contains"
fi

echo "== $blockers blocker(s), $warnings warning(s)"
exit "$blockers"
