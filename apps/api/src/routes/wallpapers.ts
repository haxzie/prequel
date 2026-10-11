/**
 * The drawn backgrounds: which styles the app offers, and in what colours.
 *
 * No bytes. Unlike `backgrounds.ts`, which serves JPEGs out of R2, a drawn
 * background is a recipe — a style and five colours — and the app draws it at
 * the size of the frame it is for. So this endpoint is the whole thing, and it
 * is a few hundred bytes.
 *
 * The list is a literal here rather than an object in R2 because changing it
 * is changing a colour, which is a deploy rather than an upload, and a
 * palette that can be edited without one is a palette nothing reviews. The
 * desktop app carries its own copy as the offline floor — the same
 * relationship the shipped `monterey.jpg` has with the hosted catalogue — so
 * adding a palette here reaches everybody on their next launch without an app
 * release, and taking the network away leaves the built-in eight.
 *
 * Not authenticated, for the reason the picker is not: a background that only
 * works once somebody signs in is one that mostly does not work.
 */
import { Hono } from "hono";

import type { Env } from "../env.ts";

const wallpapers = new Hono<{ Bindings: Env }>();

/**
 * A day, re-checked in the background by the app.
 *
 * Shorter than the picture catalogue's week of `stale-while-revalidate`: this
 * costs nothing to re-fetch and is the one thing a colour change has to travel
 * through.
 */
const CACHE = "public, max-age=86400, stale-while-revalidate=86400";

/**
 * `version` is for the app's cache, not for the shape of this document.
 *
 * Bumped whenever a style or a palette changes, which is what lets a client
 * tell "the same list again" from "the same list with a different green in it"
 * — the file a drawn background is cached under is named after its recipe, and
 * a palette edited in place would otherwise keep the old picture for ever.
 */
const CATALOGUE = {
  version: 1,
  styles: [
    { id: "cutting-mat", label: "Cutting Mat" },
    { id: "graph", label: "Graph" },
    { id: "dot-grid", label: "Dot Grid" },
    { id: "blueprint", label: "Blueprint" },
    { id: "isometric", label: "Isometric" },
    { id: "hatch", label: "Hatch" },
    { id: "terrain", label: "Terrain" },
  ],
  palettes: [
    {
      id: "olive",
      label: "Olive",
      surface: "#15301f",
      line: "#35593d",
      rule: "#eff27a",
      ink: "#eff27a",
      accent: "#b6cd85",
    },
    {
      id: "slate",
      label: "Slate",
      surface: "#1a1d21",
      line: "#282d33",
      rule: "#8fa3b8",
      ink: "#b9c7d6",
      accent: "#64788c",
    },
    {
      id: "blueprint",
      label: "Blueprint",
      surface: "#0d2a52",
      line: "#1b407a",
      rule: "#9dc2ff",
      ink: "#cfe0ff",
      accent: "#6f9fe8",
    },
    {
      id: "carbon",
      label: "Carbon",
      surface: "#101112",
      line: "#1e2022",
      rule: "#3f4349",
      ink: "#8b9196",
      accent: "#5c6166",
    },
    {
      id: "paper",
      label: "Paper",
      surface: "#f4f1e8",
      line: "#ddd7c7",
      rule: "#b9ac8c",
      ink: "#8a7c5e",
      accent: "#ad9a6d",
    },
    {
      id: "rose",
      label: "Rose",
      surface: "#2a1420",
      line: "#45233a",
      rule: "#ff9ec4",
      ink: "#ffc8de",
      accent: "#d1739f",
    },
    {
      id: "sand",
      label: "Sand",
      surface: "#2a2114",
      line: "#443722",
      rule: "#f0c46a",
      ink: "#f6dca2",
      accent: "#c09a4e",
    },
    {
      id: "mint",
      label: "Mint",
      surface: "#0f2a28",
      line: "#1c433f",
      rule: "#7fe3d2",
      ink: "#aef0e4",
      accent: "#4fb8a6",
    },
  ],
} as const;

wallpapers.get("/", (c) => {
  c.header("cache-control", CACHE);
  return c.json(CATALOGUE);
});

export default wallpapers;
