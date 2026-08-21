import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PANEL_HEIGHT, PANEL_INSET } from "../../shared/contract";
import { Root } from "./Root";
import "./index.css";

// The windows are sized in main with the same constant, so publishing it as a
// custom property keeps the CSS inset and the window geometry from drifting
// apart — a mismatch would clip the shadow or leave a dead band around it.
document.documentElement.style.setProperty("--panel-inset", `${PANEL_INSET}px`);
document.documentElement.style.setProperty("--panel-height", `${PANEL_HEIGHT}px`);

// Hover any element and press ⌘C to copy it, with its component stack and
// source locations, for an agent to read.
//
// Dynamically imported behind `import.meta.env.DEV` rather than imported at the
// top: Vite substitutes the flag at build time, so the whole branch — and with
// it every byte of the package — is eliminated from a packaged build. A static
// import would ship a development overlay inside the .dmg.
if (import.meta.env.DEV) void import("react-grab");

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
