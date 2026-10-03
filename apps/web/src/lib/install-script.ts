/**
 * The script `prequel.sh/install.sh` serves.
 *
 * In its own module so it can be checked without a request. There is no test
 * runner in `apps/web`, and a string that is going to be piped into a shell on
 * somebody else's Mac has to be known to parse — so after editing it, run:
 *
 *     node --experimental-strip-types -e \
 *       'import("./src/lib/install-script.ts").then(m => process.stdout.write(m.installScript()))' \
 *       | sh -n
 *
 * Silence means it parses. The route is `app/install.sh/route.ts` and does
 * nothing but serve this with the right content type.
 *
 * The script itself is deliberately dull. It is read by people deciding whether
 * to pipe it into a shell, so it does exactly what it says, names every path it
 * writes, and asks the Mac rather than assuming: an installer that has to be
 * trusted should be short enough to read.
 */

/**
 * The shim, written in shell.
 *
 * The same three lines `apps/desktop/src/main/cli/shim.ts` writes, because both
 * have to produce an identical file: the app rewrites this on every launch so
 * the path inside it follows the bundle, and a script here that wrote something
 * subtly different would be overwritten on first run — which looks like the
 * installer having failed. Change one, change the other; `shim.test.ts` pins
 * the app's side.
 */
function shim(): string {
  return [
    '  cat > "$BIN/prequel" <<SHIM',
    "#!/bin/sh",
    "# Written by Prequel. Runs its command line tool under the app's own runtime.",
    "# Replaced whenever the app starts, so updating Prequel updates this too.",
    "CLI='$APP/Contents/Resources/app.asar.unpacked/out/cli/prequel.cjs'",
    "ELECTRON='$APP/Contents/MacOS/Prequel'",
    "",
    'if [ ! -f "\\$CLI" ]; then',
    '  echo "error: Prequel\'s command line tool is missing from \\$CLI. Reinstall it from the Prequel menu." >&2',
    "  exit 1",
    "fi",
    "",
    'exec env ELECTRON_RUN_AS_NODE=1 "\\$ELECTRON" "\\$CLI" "\\$@"',
    "SHIM",
  ].join("\n");
}

export function installScript(): string {
  return `#!/bin/sh
#
# Installs Prequel — the cinematic screen recorder for Mac — and its \`prequel\`
# command line tool.
#
#   curl -fsSL https://prequel.sh/install.sh | sh
#
# Options, passed after \`-s --\`:
#
#   --no-cli       install the app only, without the \`prequel\` command
#   --with-skill   also write the agent skill into ~/.claude/skills/prequel
#   --to <dir>     install somewhere other than /Applications
#
# What it does, in order: checks this is an Apple Silicon Mac on macOS 14 or
# newer, downloads the current disk image from https://prequel.sh/download,
# copies Prequel.app out of it, writes a three-line shim to ~/.local/bin/prequel,
# and opens the app once so macOS can be asked for Screen Recording. Nothing is
# installed outside your home directory except the app itself, and nothing needs
# administrator rights unless /Applications does.

set -eu

APPLICATIONS="/Applications"
BIN="$HOME/.local/bin"
WITH_CLI=1
WITH_SKILL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --no-cli) WITH_CLI=0 ;;
    --with-skill) WITH_SKILL=1 ;;
    --to) shift; APPLICATIONS="\${1:-/Applications}" ;;
    -h|--help) sed -n '2,24p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "install.sh: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\\033[1m%s\\033[0m\\n' "$1"; }
oops() { printf 'error: %s\\n' "$1" >&2; exit 1; }

# ── Is this Mac one Prequel runs on ───────────────────────────────────────────
#
# Checked before anything is downloaded. The app is a 100 MB disk image, and
# finding out it will not run after fetching it wastes the download and leaves a
# half-finished install to explain.

[ "$(uname -s)" = "Darwin" ] || oops "Prequel is a Mac app. This is $(uname -s)."

# Apple Silicon only: the capture core is ScreenCaptureKit, VideoToolbox and
# Metal, built for arm64. Rosetta reports x86_64 here, so this also catches a
# shell running translated.
if [ "$(uname -m)" != "arm64" ]; then
  oops "Prequel needs an Apple Silicon Mac (M1 or later). This reports $(uname -m)."
fi

MAJOR=$(sw_vers -productVersion | cut -d. -f1)
if [ "$MAJOR" -lt 14 ]; then
  oops "Prequel needs macOS 14 or newer. This is macOS $(sw_vers -productVersion)."
fi

APP="$APPLICATIONS/Prequel.app"

# ── Download ─────────────────────────────────────────────────────────────────

TMP=$(mktemp -d)
# Removed however this exits, including the failures above this line: a cancelled
# install should not leave a disk image in /tmp, and a mounted volume would stop
# the next attempt attaching the same image.
cleanup() {
  if [ -n "\${MOUNT:-}" ] && [ -d "\${MOUNT:-}" ]; then
    hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

say "Downloading Prequel…"
curl -fL --progress-bar https://prequel.sh/download -o "$TMP/Prequel.dmg" ||
  oops "could not download the disk image. Try https://prequel.sh/download in a browser."

# ── Install ──────────────────────────────────────────────────────────────────

# A running copy holds its own files open, and replacing the bundle underneath
# it leaves the version in memory talking to the version on disk. Asked to quit
# politely; a copy that will not go is reported rather than killed.
if pgrep -xq Prequel; then
  say "Quitting the copy that is already running…"
  osascript -e 'quit app "Prequel"' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -xq Prequel || break
    sleep 0.5
  done
  pgrep -xq Prequel && oops "Prequel is still running. Quit it from the menu bar and run this again."
fi

say "Installing to $APP…"
MOUNT=$(mktemp -d)
hdiutil attach "$TMP/Prequel.dmg" -nobrowse -quiet -mountpoint "$MOUNT" ||
  oops "could not open the disk image."

[ -d "$MOUNT/Prequel.app" ] || oops "the disk image has no Prequel.app in it."

mkdir -p "$APPLICATIONS"
rm -rf "$APP"
# \`ditto\` rather than \`cp -R\`: it keeps the bundle's extended attributes and
# its code signature intact, and a signature broken in transit is an app macOS
# refuses to open with a message about damage rather than about signing.
ditto "$MOUNT/Prequel.app" "$APP" || oops "could not copy Prequel.app to $APPLICATIONS."

hdiutil detach "$MOUNT" -quiet || true
MOUNT=""

# The quarantine flag is deliberately left alone. The app is signed and
# notarised, so Gatekeeper checks it once and opens it; stripping the flag would
# skip a check that exists for the user's benefit, in an installer they are
# piping into a shell.

# ── The command line ─────────────────────────────────────────────────────────

if [ "$WITH_CLI" = "1" ]; then
  mkdir -p "$BIN"
${shim()}
  chmod 755 "$BIN/prequel"
  say "Wrote $BIN/prequel"

  case ":$PATH:" in
    *":$BIN:"*) ;;
    *) printf '\\n  %s is not on your PATH. Add this to ~/.zshrc:\\n\\n    export PATH="$HOME/.local/bin:$PATH"\\n' "$BIN" ;;
  esac
fi

if [ "$WITH_SKILL" = "1" ] && [ "$WITH_CLI" = "1" ]; then
  "$BIN/prequel" skill install >/dev/null && say "Wrote the agent skill to ~/.claude/skills/prequel"
fi

# ── Open it once ─────────────────────────────────────────────────────────────
#
# So macOS has something to attach the Screen Recording grant to, and so the
# app writes its own copy of the shim and starts the socket the CLI talks to.

open -a "$APP"

cat <<'DONE'

Prequel is installed.

  1. Grant Screen Recording when macOS asks, or in System Settings →
     Privacy & Security → Screen & System Audio Recording.
  2. The icon is in the menu bar. There is no Dock icon.

If you are driving it from a terminal or an agent:

  prequel status        permissions, sign-in, and whether a take is running
  prequel guide --json  every command, which is also what an agent should read
  prequel skill install the agent skill, into ~/.claude/skills/prequel
  prequel upgrade       update Prequel and this command together

DONE
`;
}
