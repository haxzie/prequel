/**
 * The drawn-background catalogue.
 *
 * What the desktop app leans on: the list comes back unauthenticated, every
 * palette is complete, and every colour is a hex the app can hand to a
 * renderer. A palette missing a field is not a 500 anywhere — it is one line
 * of a mat drawn in `undefined`, which paints nothing and reads as a hole in
 * the grid.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import app from "../src/index.ts";

async function call(path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`https://api.prequel.sh${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

interface Catalogue {
  version: number;
  styles: { id: string; label: string }[];
  /** Read loosely on purpose: the point of the test below is that every one of
      the five colours is really there, which a typed shape would assume. */
  palettes: Record<string, string | undefined>[];
}

describe("GET /v1/wallpapers", () => {
  it("answers without a session", async () => {
    const response = await call("/v1/wallpapers");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("carries styles and palettes", async () => {
    const body = (await (await call("/v1/wallpapers")).json()) as Catalogue;

    expect(body.version).toBeGreaterThan(0);
    expect(body.styles.length).toBeGreaterThan(0);
    expect(body.palettes.length).toBeGreaterThan(0);

    for (const style of body.styles) {
      expect(style.id).toMatch(/^[a-z0-9-]+$/);
      expect(style.label).toBeTruthy();
    }
  });

  it("gives every palette all five colours, as hex", async () => {
    const body = (await (await call("/v1/wallpapers")).json()) as Catalogue;

    for (const palette of body.palettes) {
      expect(palette.id).toMatch(/^[a-z0-9-]+$/);
      expect(palette.label).toBeTruthy();

      for (const key of ["surface", "line", "rule", "ink", "accent"]) {
        expect(palette[key]).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("names each style and palette once", async () => {
    const body = (await (await call("/v1/wallpapers")).json()) as Catalogue;

    expect(new Set(body.styles.map((style) => style.id)).size).toBe(body.styles.length);
    expect(new Set(body.palettes.map((palette) => palette.id)).size).toBe(body.palettes.length);
  });
});
