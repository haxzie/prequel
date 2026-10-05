#!/usr/bin/env bash
# Mechanical checks for one article, or for the whole set.
#
#   check-article.sh <slug>     one article
#   check-article.sh --all      every article, plus the checks that only make
#                               sense across all of them (related links in both
#                               directions, duplicate titles)
#
# Articles are posts that live at /articles and are listed on /content. They
# share the blog's voice rules but not its shape: no definitional question, no
# pillar, and a "Keep reading" list that `related` drives. `check-post.sh` is
# hard-wired to the blog's paths and rules, so this is its counterpart rather
# than a flag on it.
#
# Exit status is the number of blockers.
set -u

root="$(cd "$(dirname "$0")/../../../.." && pwd)"
web="$root/apps/web"
registry="$web/src/content/articles.ts"

blockers=0
warnings=0
blocker() { printf '  BLOCK  %s\n' "$*"; blockers=$((blockers + 1)); }
warn()    { printf '  warn   %s\n' "$*"; warnings=$((warnings + 1)); }
ok()      { printf '  ok     %s\n' "$*"; }

# One line per entry: slug|title|faq count|related (comma list)|reference|topics|date.
# Parsed with python rather than awk because the entries are TypeScript object
# literals with nested arrays, and a regex that works on today's formatting is a
# check that goes quiet the day prettier rewraps a line.
entries() {
  python3 - "$registry" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
body = src[src.index("const ENTRIES"):src.index("/** Newest first.")]
# An entry starts at two spaces of indent with `{` and ends at `  },`.
for m in re.finditer(r"^  \{\n(.*?)^  \},?\n", body, re.S | re.M):
    e = m.group(1)
    g = lambda pat: (re.search(pat, e, re.S) or [None, ""])[1]
    slug = g(r'slug:\s*"([^"]+)"')
    title = g(r'title:\s*"([^"]+)"')
    faq = len(re.findall(r"question:", e))
    related = ",".join(re.findall(r'"([a-z0-9-]+)"', g(r"related:\s*\[(.*?)\]")))
    ref = g(r'reference:\s*"([^"]+)"')
    topics = ",".join(re.findall(r'"([a-z]+)"', g(r"topics:\s*\[(.*?)\]")))
    date = g(r'date:\s*"([0-9-]+)"')
    print("|".join([slug, title, str(faq), related, ref, topics, date]))
PY
}

check_one() {
  local slug="$1"
  local mdx="$web/src/content/articles/$slug.mdx"
  if [ ! -f "$mdx" ]; then echo "no such article: $mdx"; blockers=$((blockers + 1)); return; fi

  echo "== $slug"

  # --- Voice ---------------------------------------------------------------
  local n
  n=$(grep -c "—" "$mdx")
  [ "$n" -eq 0 ] && ok "no em dashes" || blocker "$n line(s) with an em dash"

  if grep -niE "normaliz|customiz|behavior|centered|color[^u]|favorite|license[ds]? |optimiz|organiz|recogniz" "$mdx" >/dev/null; then
    blocker "American spelling: $(grep -noiE 'normaliz\w*|customiz\w*|behavior\w*|centered|color[^u]\w*|favorite\w*|license[ds]? |optimiz\w*|organiz\w*|recogniz\w*' "$mdx" | head -5 | tr '\n' ' ')"
  else
    ok "British spelling"
  fi

  # Quoted text is allowed to be American: it is somebody else's words. The
  # check above is a grep, so a verbatim quote that says "color" shows up as a
  # blocker; the writer confirms it sits inside quotation marks and moves on.

  local flourish
  flourish=$(grep -ciE "not (just|only|merely) [^.]*, but|rather than|instead of" "$mdx" || true)
  [ "$flourish" -eq 0 ] && ok "no contrast flourishes" || warn "$flourish line(s) with 'not X but Y' / 'rather than' / 'instead of'; a factual contrast is fine, a definition-by-negation is not"

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

  # Prequel has no iOS capture. `FEATURE_ROWS.iosCapture` is deliberately false.
  if grep -niE "prequel (can |will |also )?(records?|captures?) (your |an |the )?(iphone|ipad|ios)" "$mdx" >/dev/null; then
    blocker "claims Prequel records an iPhone or iPad; iosCapture is false"
  fi

  # Prequel cannot open another recorder's project file. The whole of the
  # competing sites' switching argument is that it can, and ours cannot.
  if grep -niE "import (your |the |a )?(\.screenstudio|\.cap|screen studio|cap) project|opens? (your |a )?\.(screenstudio|cap)" "$mdx" >/dev/null; then
    blocker "claims Prequel imports another recorder's project; it imports a video (Add Clip > Import Video)"
  fi

  if grep -qiE "apple silicon" "$mdx" && grep -qiE "macos 14" "$mdx"; then
    ok "requirements stated (Apple Silicon, macOS 14)"
  else
    warn "requirements not stated; name Apple Silicon and macOS 14 or later once, near the download link"
  fi

  local lifetime monthly trial
  lifetime=$(grep -oE 'PRICE_LIFETIME = "\$[0-9]+"' "$web/src/lib/pricing.ts" | grep -oE '\$[0-9]+')
  monthly=$(grep -oE 'PRICE_MONTHLY = "\$[0-9]+"' "$web/src/lib/pricing.ts" | grep -oE '\$[0-9]+')
  trial=$(grep -oE 'TRIAL_DAYS = [0-9]+' "$web/src/lib/pricing.ts" | grep -oE '[0-9]+')
  if grep -qE 'Prequel[^.]*\$[0-9]+ (once|one-off|lifetime)' "$mdx"; then
    grep -qE "Prequel[^.]*\\$lifetime (once|one-off|lifetime)" "$mdx" && ok "Prequel lifetime price matches pricing.ts ($lifetime)" || blocker "Prequel lifetime price does not match pricing.ts ($lifetime)"
  fi
  if grep -qE 'Prequel[^.]*\$[0-9]+ ?(a|per|/) ?month' "$mdx"; then
    grep -qE "Prequel[^.]*\\$monthly ?(a|per|/) ?month" "$mdx" && ok "Prequel monthly price matches pricing.ts ($monthly)" || blocker "Prequel monthly price does not match pricing.ts ($monthly)"
  fi
  if grep -qiE "prequel[^.]*[0-9]+[- ]day" "$mdx"; then
    grep -qiE "prequel[^.]*${trial}[- ]day" "$mdx" && ok "trial length matches pricing.ts ($trial days)" || blocker "trial length does not match pricing.ts ($trial days)"
  fi

  # --- Structure -------------------------------------------------------------
  grep -q "^# " "$mdx" && blocker "has a '# ' heading; the h1 comes from articles.ts, start at ##" || ok "no h1 in the MDX"

  if grep -qiE "^## (faq|frequently asked)" "$mdx"; then
    blocker "body FAQ section; the FAQ lives on the articles.ts entry and the template renders it"
  else
    ok "no body FAQ"
  fi

  local bad
  bad=$(grep -E "^##+ " "$mdx" | sed -E 's/^##+ ([0-9]+\. )?//' | awk '{
    c = 0; for (i = 2; i <= NF; i++) if ($i ~ /^[A-Z][a-z]/) c++;
    if (NF >= 3 && c >= 2) print
  }')
  [ -z "$bad" ] && ok "headings read as sentence case" || warn "heading may be title case: $(echo "$bad" | head -3 | tr '\n' '|')"

  # --- The call to action --------------------------------------------------------
  # Every article asks the reader to use Prequel, in the body and not only in
  # the panel the template adds at the foot.
  if grep -qE '\]\(/download\)' "$mdx"; then ok "asks the reader to download Prequel"; else blocker "no link to /download in the body; every article asks the reader to use Prequel"; fi

  # --- Links ---------------------------------------------------------------------
  local hosts
  hosts=$(grep -ohE "https?://[a-z0-9./-]+" "$mdx" | sed -E 's|(https?://[^/]+).*|\1|' | sort -u \
    | grep -vE "^https?://(www\.|old\.)?(reddit\.com|news\.ycombinator\.com|x\.com|g2\.com|github\.com|producthunt\.com)$" || true)
  [ -z "$hosts" ] && ok "no outside host beyond the citation hosts" || blocker "links an outside host: $(echo "$hosts" | tr '\n' ' ')"

  # A card is evidence only with its link under it.
  local ln
  while IFS= read -r ln; do
    n=${ln%%:*}
    sed -n "$((n + 1)),$((n + 6))p" "$mdx" | grep -qE "\]\(https?://" || blocker "line $n: quote card with no source link under it"
  done < <(grep -nE '^!\[[^]]*\]\(/blog/quotes/' "$mdx" || true)

  # Every internal link resolves: markdown links are not <Link>, so
  # `typedRoutes` cannot catch a typo.
  local s total=0
  for s in $(grep -ohE '\]\(/articles/[a-z0-9-]+\)' "$mdx" | sed 's|](/articles/||; s|)||' | sort -u); do
    total=$((total + 1))
    [ -f "$web/src/content/articles/$s.mdx" ] || blocker "/articles/$s has no MDX file"
    [ "$s" = "$slug" ] && blocker "links to itself"
  done
  for s in $(grep -ohE '\]\(/blog/[a-z0-9-]+\)' "$mdx" | sed 's|](/blog/||; s|)||' | sort -u); do
    total=$((total + 1))
    [ -f "$web/src/content/blog/$s.mdx" ] || blocker "/blog/$s has no MDX file"
  done
  for s in $(grep -ohE '\]\(/glossary/[a-z0-9-]+' "$mdx" | sed 's|](/glossary/||' | sort -u); do
    total=$((total + 1))
    [ -f "$web/src/content/glossary/$s.mdx" ] || blocker "/glossary/$s has no MDX file"
  done
  for s in $(grep -ohE '\]\(/docs/[a-z0-9-]+' "$mdx" | sed 's|](/docs/||' | sort -u); do
    total=$((total + 1))
    [ -f "$web/src/content/docs/$s.mdx" ] || blocker "/docs/$s has no MDX file"
  done
  for s in $(grep -ohE '\]\(/alternatives/[a-z0-9-]+' "$mdx" | sed 's|](/alternatives/||' | sort -u); do
    total=$((total + 1))
    [ -f "$web/src/content/alternatives/$s.mdx" ] || blocker "/alternatives/$s has no page"
  done
  local arts
  arts=$(grep -ohE '\]\(/articles/[a-z0-9-]+\)' "$mdx" | sort -u | wc -l | tr -d ' ')
  [ "$arts" -ge 3 ] && ok "$arts links to other articles ($total internal in all)" || warn "$arts links to other articles in the body; carry at least three, $total internal links in all"
  [ "$total" -ge 5 ] && ok "$total internal links" || warn "$total internal links; carry five or more"
  grep -q "](/pricing)" "$mdx" && ok "links to /pricing" || warn "no /pricing link"

  # --- Images ----------------------------------------------------------------------
  local img
  for img in $(grep -ohE '!\[[^]]*\]\(/[^)]+\)' "$mdx" | sed -E 's/.*\]\(([^)]+)\)/\1/' | sort -u); do
    [ -f "$web/public$img" ] || blocker "image missing: public$img"
    case "$img" in *.webp) ;; *) blocker "image is not WebP: $img" ;; esac
  done
  grep -qE '!\[\]\(' "$mdx" && blocker "image with empty alt text"
  local shots
  shots=$(grep -cE '^!\[[^]]*\]\(/articles/prequel/' "$mdx" || true)
  [ "$shots" -ge 1 ] && ok "$shots Prequel screenshot(s)" || warn "no Prequel screenshot; the call to action is stronger with the app in view"

  # --- The entry ---------------------------------------------------------------------
  local entry
  entry=$(entries | awk -F'|' -v s="$slug" '$1 == s')
  if [ -z "$entry" ]; then
    blocker "no entry in articles.ts"
  else
    ok "registered in articles.ts"
    local faqs related ref topics
    faqs=$(echo "$entry" | cut -d'|' -f3)
    related=$(echo "$entry" | cut -d'|' -f4)
    ref=$(echo "$entry" | cut -d'|' -f5)
    topics=$(echo "$entry" | cut -d'|' -f6)
    [ "$faqs" -ge 4 ] && ok "$faqs FAQ entries" || blocker "$faqs FAQ entries; an article carries four or more"
    local rc
    rc=$(echo "$related" | tr ',' '\n' | grep -c . || true)
    [ "$rc" -ge 3 ] && ok "$rc related articles" || blocker "$rc related articles; list at least three"
    [ -n "$topics" ] && ok "topics: $topics" || blocker "no topics"
    if [ -n "$ref" ]; then
      [ -f "$web/public/blog/quotes/$ref.webp" ] && ok "reference card $ref exists" || blocker "reference card missing: public/blog/quotes/$ref.webp"
      [ -f "$web/public/articles/og/$ref.png" ] && ok "OG PNG for $ref exists" || blocker "OG PNG missing: public/articles/og/$ref.png (Satori cannot read WebP)"
    else
      warn "no reference card; the social card is the title alone"
    fi
    local words mins want
    words=$(wc -w < "$mdx" | tr -d ' ')
    mins=$(awk -v s="slug: \"$slug\"" '$0 ~ s {p=1} p && /readingMinutes/ {print; exit}' "$registry" | grep -oE '[0-9]+')
    want=$(( (words + 100) / 200 ))
    if [ -n "$mins" ] && [ $(( mins - want )) -le 1 ] && [ $(( want - mins )) -le 1 ]; then
      ok "readingMinutes $mins for $words words"
    else
      warn "readingMinutes ${mins:-?} for $words words; about $want"
    fi
  fi

  local block
  block=$(awk -v s="slug: \"$slug\"" '$0 ~ s {p=1} p {print} p && /^  \},?$/ {exit}' "$registry")
  echo "$block" | grep -q "—" && blocker "em dash in the articles.ts entry"

  echo "== $slug: done"
}

check_all() {
  local slugs
  slugs=$(entries | cut -d'|' -f1)
  local before=$blockers
  echo "== registry"

  local dupes
  dupes=$(echo "$slugs" | sort | uniq -d)
  [ -z "$dupes" ] && ok "no duplicate slugs" || blocker "duplicate slugs: $dupes"

  local tdupes
  tdupes=$(entries | cut -d'|' -f2 | sort | uniq -d)
  [ -z "$tdupes" ] && ok "no duplicate titles" || blocker "duplicate titles: $tdupes"

  # `related` in both directions. The page a link points at should list the
  # page that pointed at it, or a reader arriving there first has no way back.
  local line a r back
  while IFS= read -r line; do
    a=$(echo "$line" | cut -d'|' -f1)
    for r in $(echo "$line" | cut -d'|' -f4 | tr ',' ' '); do
      if ! echo "$slugs" | grep -qx "$r"; then
        blocker "$a lists related article '$r', which does not exist"
        continue
      fi
      [ "$r" = "$a" ] && { blocker "$a lists itself as related"; continue; }
      back=$(entries | awk -F'|' -v s="$r" '$1 == s {print $4}')
      echo ",$back," | grep -q ",$a," || warn "$a lists $r, but $r does not list $a"
    done
  done < <(entries)

  # Anything nobody links to is an orphan.
  local s
  for s in $slugs; do
    if ! grep -rqE "\]\(/articles/$s\)" "$web/src/content/articles" --include='*.mdx' --exclude="$s.mdx" \
       && ! entries | cut -d'|' -f4 | tr ',' '\n' | grep -qx "$s"; then
      warn "$s is linked from no other article"
    fi
  done

  [ "$blockers" -eq "$before" ] && ok "registry clean"
  echo
  # The first seven articles predate this checker, its call to action and the
  # `related` list. They are in the registry checks above, and only the ones
  # dated from the day this was written are held to the per-article rules.
  while IFS='|' read -r s _ _ _ _ _ date; do
    [ "$date" \< "2026-10-05" ] && continue
    check_one "$s"
  done < <(entries)
}

case "${1:-}" in
  "") echo "usage: check-article.sh <slug> | --all"; exit 1 ;;
  --all) check_all ;;
  *) check_one "$1" ;;
esac

echo "== $blockers blocker(s), $warnings warning(s)"
exit "$blockers"
