/**
 * Screenshots of the app for the documentation, from the gallery.
 *
 *   node scripts/shoot-docs.mjs [--recording "<folder name>"] [--only id,id]
 *                               [--out ../web/public/docs] [--attach] [--png]
 *
 * Starts the gallery (`gallery/vite.config.ts`) and a headless Chrome, opens
 * each shot in `gallery/shots.tsx`, performs its steps with real input events,
 * crops to its clip and writes `<out>/<id>.webp`. `--attach` uses a Chrome
 * already listening on 9222 instead of starting one; `--png` keeps the PNGs
 * beside the WebPs.
 *
 * Driven over the DevTools protocol rather than `--headless --screenshot`: the
 * editor runs a `requestAnimationFrame` loop and plays video, so a page-load
 * screenshot never decides the page is done. Node's own WebSocket, nothing
 * installed — the same arrangement as the comparison posts' capture script.
 *
 * Steps use `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`, not
 * `element.click()` in the page. The timeline calls `setPointerCapture`, which
 * throws on a synthetic `PointerEvent`; a CDP click is a real one.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const PACKAGE = resolve(here, "..");

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : (args[index + 1] ?? "");
};
const has = (name) => args.includes(`--${name}`);

const RECORDING = flag("recording") ?? "Prequel 2026-08-22 09-03-02";
const ONLY = flag("only")?.split(",").filter(Boolean) ?? null;
const OUT = resolve(flag("out") ?? join(PACKAGE, "../web/public/docs"));
// Each shot's size in CSS pixels, for the site to draw it at life size rather
// than stretched to the column. Written only on a full run, or a partial one
// would drop every shot it did not take.
const MANIFEST = flag("manifest") ?? (flag("out") || ONLY ? null : join(PACKAGE, "../web/src/content/docs/shots.json"));
const KEEP_PNG = has("png");
const ATTACH = has("attach");
// The whole viewport instead of the clip, for working out why a crop is wrong.
const FULL = has("full");

const PORT = 5199;
const CDP_PORT = 9222;
const RECORDINGS = process.env.PREQUEL_GALLERY_RECORDINGS ?? join(homedir(), "Movies/Prequel/.recordings");
const OVERLAY = join(tmpdir(), "prequel-gallery");
const SCRATCH = join(tmpdir(), "prequel-shots");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Preflight ───────────────────────────────────────────────────────────────

const recordingDir = join(RECORDINGS, RECORDING);
if (!existsSync(join(recordingDir, "session.json"))) {
  console.error(`No recording at ${recordingDir}`);
  process.exit(1);
}

// Chrome decodes H.264 in software and HEVC not at all; a HEVC take would show
// a black preview in every editor shot with nothing to say why.
try {
  const codec = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", join(recordingDir, "screen.mp4")],
    { encoding: "utf8" },
  ).trim();
  if (codec !== "h264") {
    console.error(`${RECORDING} has a ${codec} screen track; Chrome needs h264.`);
    process.exit(1);
  }
} catch {
  console.warn("ffprobe not available; skipping the codec check.");
}

rmSync(OVERLAY, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });
mkdirSync(OUT, { recursive: true });

// ── Children ────────────────────────────────────────────────────────────────

const children = [];
const stop = () => {
  for (const child of children) child.kill();
};
process.on("exit", stop);
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

async function waitFor(url, label, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(250);
  }
  throw new Error(`${label} did not come up at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "gallery/vite.config.ts"], {
  cwd: PACKAGE,
  env: { ...process.env, PREQUEL_GALLERY_RECORDING: RECORDING, PREQUEL_GALLERY_OVERLAY: OVERLAY },
  stdio: ["ignore", "pipe", "pipe"],
});
children.push(vite);
vite.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
await waitFor(`http://127.0.0.1:${PORT}/fixture/config.json`, "the gallery");

if (!ATTACH) {
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${join(tmpdir(), "prequel-gallery-profile")}`,
      // WebGL in software. Never `--disable-gpu`, which turns WebGL off and
      // leaves the preview canvas black.
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
      "--no-first-run",
      "--autoplay-policy=no-user-gesture-required",
      "--force-color-profile=srgb",
      "--window-size=1600,1000",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  children.push(chrome);
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, "Chrome");
}

// ── CDP ─────────────────────────────────────────────────────────────────────

const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let nextId = 0;
const events = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method && message.sessionId) {
    for (const listener of events.get(message.sessionId) ?? []) listener(message);
  }
});

function rpc(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolvePromise, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", onMessage);
      message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolvePromise(message.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error(`${method} timed out`));
    }, 30_000);
  });
}

async function evaluate(sessionId, expression) {
  const { result, exceptionDetails } = await rpc(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? "evaluate failed");
  return result.value;
}

async function rect(sessionId, selector, text) {
  const value = await evaluate(
    sessionId,
    `(() => { const r = window.__gallery.rect(${JSON.stringify(selector)}, ${JSON.stringify(text)}); return r && { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  if (!value) throw new Error(`nothing matches ${selector}${text ? ` "${text}"` : ""}`);
  return value;
}

async function until(sessionId, expression, label, attempts = 200) {
  for (let i = 0; i < attempts; i += 1) {
    if (await evaluate(sessionId, expression)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function click(sessionId, x, y) {
  const base = { x, y, button: "left", clickCount: 1, pointerType: "mouse" };
  await rpc("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, pointerType: "mouse" }, sessionId);
  await rpc("Input.dispatchMouseEvent", { type: "mousePressed", ...base }, sessionId);
  await rpc("Input.dispatchMouseEvent", { type: "mouseReleased", ...base }, sessionId);
}

async function key(sessionId, code) {
  // `key` and `text` matter as well as `code`: the editor's shortcuts read
  // `event.key`, and a key event with only a code reads as an unknown key.
  const keyName = code.startsWith("Key") ? code.slice(3).toLowerCase() : code === "Space" ? " " : code;
  const windowsVirtualKeyCode = code.startsWith("Key") ? code.charCodeAt(3) : code === "Space" ? 32 : code === "Escape" ? 27 : 0;
  await rpc("Input.dispatchKeyEvent", { type: "keyDown", code, key: keyName, windowsVirtualKeyCode, text: keyName.length === 1 ? keyName : undefined }, sessionId);
  await rpc("Input.dispatchKeyEvent", { type: "keyUp", code, key: keyName, windowsVirtualKeyCode }, sessionId);
}

async function runStep(sessionId, step) {
  switch (step.kind) {
    case "click": {
      await until(sessionId, `!!window.__gallery.rect(${JSON.stringify(step.selector)}, ${JSON.stringify(step.text)})`, step.selector);
      const r = await rect(sessionId, step.selector, step.text);
      await click(sessionId, r.x + r.width / 2, r.y + r.height / 2);
      await sleep(150);
      return;
    }
    case "key":
      await key(sessionId, step.code);
      await sleep(150);
      return;
    case "seek": {
      // The ruler is the first child of the timeline's scroller.
      const r = await rect(sessionId, "[data-panel='timeline'] > div > div");
      await click(sessionId, r.x + r.width * step.fraction, r.y + r.height / 2);
      await sleep(300);
      return;
    }
    case "wait":
      await until(sessionId, `!!document.querySelector(${JSON.stringify(step.selector)})`, step.selector);
      return;
    case "settle":
      await sleep(step.ms);
      return;
    default:
      throw new Error(`unknown step ${JSON.stringify(step)}`);
  }
}

async function clipOf(sessionId, clip, pad = 0, maxWidth = null) {
  const selectors = clip === "frame" ? ["[data-shot-frame]"] : Array.isArray(clip) ? clip : [clip];
  // The frame mounts before the lazy chunk inside it does, so a shot with no
  // steps can reach here with nothing to crop to yet.
  for (const selector of selectors) {
    await until(sessionId, `!!document.querySelector(${JSON.stringify(selector)})`, selector);
  }
  await evaluate(sessionId, "window.__gallery.settle()");
  const rects = await Promise.all(selectors.map((selector) => rect(sessionId, selector)));
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  // Snapped outwards to whole pixels, so a fractional edge does not become a
  // blurred half-pixel line down one side.
  const left = Math.max(0, Math.floor(x) - pad);
  const top = Math.max(0, Math.floor(y) - pad);
  return {
    x: left,
    y: top,
    width: Math.min(Math.ceil(right) + pad - left, maxWidth ?? Infinity),
    height: Math.ceil(bottom) + pad - top,
    scale: 1,
  };
}

// ── Shots ───────────────────────────────────────────────────────────────────

const probe = await rpc("Target.createTarget", { url: `http://127.0.0.1:${PORT}/#/` });
const probeSession = (await rpc("Target.attachToTarget", { targetId: probe.targetId, flatten: true })).sessionId;
await rpc("Runtime.enable", {}, probeSession);
await until(probeSession, "!!window.__gallery", "the gallery");
const shots = await evaluate(probeSession, "window.__gallery.shots");
await rpc("Target.closeTarget", { targetId: probe.targetId });

const wanted = ONLY ? shots.filter((shot) => ONLY.includes(shot.id)) : shots;
if (ONLY) {
  for (const id of ONLY) if (!shots.some((shot) => shot.id === id)) console.warn(`no shot called ${id}`);
}

let failed = 0;
const sizes = {};

for (const shot of wanted) {
  const started = Date.now();
  const warnings = [];
  const { targetId } = await rpc("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await rpc("Target.attachToTarget", { targetId, flatten: true });

  try {
    await rpc("Runtime.enable", {}, sessionId);
    await rpc("Page.enable", {}, sessionId);
    events.set(sessionId, [
      (message) => {
        if (message.method !== "Runtime.consoleAPICalled") return;
        const { type, args: callArgs } = message.params;
        const text = callArgs.map((a) => a.value ?? a.description ?? "").join(" ");
        // The bridge's unhandled-call line is the one that says a fixture is
        // missing; everything else at warn/error is worth a look too.
        if (type === "warning" || type === "error") warnings.push(text);
      },
    ]);

    // Twice the pixels of the app on a Retina display, which is what every
    // screenshot of a Mac app is expected to be.
    await rpc(
      "Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false },
      sessionId,
    );
    // The `:root` tokens follow the system; the app is documented on a dark Mac.
    await rpc(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-color-scheme", value: "dark" }] },
      sessionId,
    );
    if (shot.frame === "dock-transparent") {
      await rpc("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);
    }

    await rpc("Page.navigate", { url: `http://127.0.0.1:${PORT}/#/shot/${shot.id}` }, sessionId);
    await until(sessionId, "!!window.__gallery && !!document.querySelector('[data-shot-frame]')", "the frame");
    await evaluate(sessionId, "window.__gallery.settle()");

    for (const step of shot.steps) await runStep(sessionId, step);

    const clip = await clipOf(sessionId, shot.clip, shot.pad, shot.maxWidth);
    const { data } = await rpc(
      "Page.captureScreenshot",
      // Never `captureBeyondViewport`: it resizes the viewport to the document
      // for the capture and the dock came out twice, half a row apart. Every
      // clip sits inside the 1600×1000 viewport set above.
      { format: "png", ...(FULL ? {} : { clip }) },
      sessionId,
    );

    const png = join(KEEP_PNG ? OUT : SCRATCH, `${shot.id}.png`);
    writeFileSync(png, Buffer.from(data, "base64"));
    const webp = join(OUT, `${shot.id}.webp`);
    execFileSync("magick", [
      png,
      "-strip",
      "-quality",
      "82",
      "-define",
      "webp:alpha-quality=100",
      webp,
    ]);

    sizes[shot.id] = { width: clip.width, height: clip.height };
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`ok    ${shot.id.padEnd(22)} ${clip.width}×${clip.height} ${seconds}s`);
    for (const line of warnings) console.log(`      ${line}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${shot.id.padEnd(22)} ${error.message}`);
    for (const line of warnings) console.log(`      ${line}`);
  } finally {
    events.delete(sessionId);
    await rpc("Target.closeTarget", { targetId }).catch(() => {});
  }
}

if (MANIFEST && !failed) {
  writeFileSync(MANIFEST, `${JSON.stringify(sizes, null, 2)}\n`);
  console.log(`wrote ${MANIFEST}`);
}

ws.close();
stop();
process.exit(failed ? 1 : 0);
