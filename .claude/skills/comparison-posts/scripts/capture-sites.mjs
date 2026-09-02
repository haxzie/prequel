/**
 * Screenshots of other people's landing pages, for a comparison post.
 *
 *   node capture-sites.mjs <out-dir> '{"slug":"https://example.com", ...}'
 *
 * Chrome has to already be listening on 9222. The SKILL.md beside this says how
 * to start it and how to turn the PNGs into the WebP the post ships.
 *
 * Driven over the DevTools protocol rather than `--headless --screenshot`,
 * because a bare screenshot cannot run script on the page first and every one
 * of these sites puts a consent wall over its hero. Node 22 has a WebSocket
 * built in, so this needs nothing installed.
 */
const PORT = 9222;
const OUT = process.argv[2];
const SITES = JSON.parse(process.argv[3]);

const rpc = (ws, id, method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const onMsg = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === id) {
        ws.removeEventListener("message", onMsg);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      ws.removeEventListener("message", onMsg);
      reject(new Error(`${method} timed out`));
    }, 45000);
  });

// Consent walls and floating chat widgets are the two things that ruin an
// otherwise clean hero shot, and both are position:fixed overlays rather than
// part of the page being photographed.
const DECLUTTER = `
(() => {
  const BTN = /^(allow|accept|agree|reject|decline|got it|ok|i understand|essential|necessary|manage)/i;
  const KILL = /cookie|consent|gdpr|onetrust|cky-|truste|didomi|usercentrics|intercom|drift|crisp|hubspot|beacon/i;

  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);

  // Consent walls are identified by their buttons, not by their CSS. Position
  // heuristics miss the ones rendered in normal flow or inside a <dialog>, and
  // class-name heuristics miss anything with generated class names.
  for (const el of all) {
    const tag = (el.tagName || "").toLowerCase();
    if (tag !== "button" && tag !== "a" && el.getAttribute?.("role") !== "button") continue;
    const label = (el.innerText || el.textContent || "").trim();
    if (!BTN.test(label) || label.length > 40) continue;

    // Walk up to the banner: the last ancestor still small enough to be one.
    let node = el, banner = null;
    for (let i = 0; i < 8 && node?.parentElement; i += 1) {
      node = node.parentElement;
      const text = (node.innerText || "").trim();
      if (text.length > 900) break;
      if (/cookie|consent|privacy|tracking/i.test(text)) banner = node;
    }
    if (banner && banner !== document.body) banner.remove();
  }

  for (const el of all) {
    if (!el.isConnected || !el.getBoundingClientRect) continue;
    const st = getComputedStyle(el);
    if (!["fixed", "sticky"].includes(st.position)) continue;
    const attrs = (el.id || "") + " " + (el.className?.baseVal ?? el.className ?? "");
    if (KILL.test(attrs)) el.remove();
  }

  document.documentElement.style.scrollBehavior = "auto";
  window.scrollTo(0, 0);
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { webSocketDebuggerUrl } = await (
  await fetch(`http://127.0.0.1:${PORT}/json/version`)
).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let id = 0;
for (const [slug, url] of Object.entries(SITES)) {
  try {
    const { targetId } = await rpc(ws, ++id, "Target.createTarget", { url: "about:blank" });
    const { sessionId } = await rpc(ws, ++id, "Target.attachToTarget", { targetId, flatten: true });
    await rpc(
      ws,
      ++id,
      "Emulation.setDeviceMetricsOverride",
      { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
      sessionId,
    );
    await rpc(ws, ++id, "Page.enable", {}, sessionId);
    await rpc(ws, ++id, "Page.navigate", { url }, sessionId);
    await sleep(6500);
    await rpc(ws, ++id, "Runtime.evaluate", { expression: DECLUTTER }, sessionId).catch(() => {});
    await sleep(1500);
    // Again: several of these banners mount after first paint, so one pass
    // runs before the thing it is meant to remove exists.
    await rpc(ws, ++id, "Runtime.evaluate", { expression: DECLUTTER }, sessionId).catch(() => {});
    await sleep(800);

    // A bot wall answers 200 and screenshots perfectly, so "captured" is not
    // the same as "captured the page". G2 and friends serve an interstitial
    // that looks like a clean run right up until somebody opens the file, and
    // a review screenshot of a "verify you are human" page is the sort of thing
    // that ships because every step reported success.
    const probe = await rpc(
      ws,
      ++id,
      "Runtime.evaluate",
      { expression: "document.body.innerText.slice(0, 600)", returnByValue: true },
      sessionId,
    ).catch(() => null);

    const text = typeof probe?.result?.value === "string" ? probe.result.value : "";
    const WALL =
      /access (is )?(temporarily )?(restricted|denied)|unusual activity|are you a robot|verify you are human|checking your browser|cloudflare|just a moment/i;
    // Unreadably short counts too: a wall that evaluates to nothing looks
    // exactly like a success from here.
    const blocked = WALL.test(text) || text.trim().length < 200;

    const { data } = await rpc(
      ws,
      ++id,
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      sessionId,
    );
    await (
      await import("node:fs/promises")
    ).writeFile(`${OUT}/${slug}.png`, Buffer.from(data, "base64"));
    console.log(
      blocked ? `  WALL  ${slug}: bot wall or empty page, open the file` : `  ok    ${slug}`,
    );
    await rpc(ws, ++id, "Target.closeTarget", { targetId });
  } catch (e) {
    console.log(`  FAIL  ${slug}: ${e.message}`);
  }
}
ws.close();
