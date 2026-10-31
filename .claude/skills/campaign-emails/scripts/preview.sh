#!/usr/bin/env bash
# Render a campaign to a PNG, because the only way to know an email is right is
# to look at it. Headless Chrome rather than a mail client: no account, no send,
# and the same engine Gmail's web client lays the message out in.
#
# The height is the whole point of the argument — Chrome screenshots the window,
# not the document, so a short window silently crops the footer off. Run it,
# look, raise the height until the white tail appears.
set -euo pipefail

html="${1:?usage: preview.sh <campaign.html> [height]}"
height="${2:-1800}"
out="${html%.html}-preview.png"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -x "$chrome" ] || { echo "Chrome is not at $chrome" >&2; exit 1; }

"$chrome" --headless=new --disable-gpu --hide-scrollbars \
  --default-background-color=FFFFFFFF \
  --window-size=680,"$height" \
  --screenshot="$out" "$html" 2>/dev/null

echo "$out"
