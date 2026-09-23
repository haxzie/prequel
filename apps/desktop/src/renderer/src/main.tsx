import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import * as Sentry from "@sentry/electron/renderer";

import { DOCK_HEADROOM, PANEL_INSET } from "../../shared/contract";
import { Root } from "./Root";
import "./index.css";

// No DSN, and that is the whole point: this window's CSP is
// `connect-src 'self' prequel-media:`, so it cannot reach `ingest.sentry.io`
// and must not be given a reason to try. Events go to main over IPC and are
// sent from there, which also means they pass through the one `beforeSend`
// that redacts them — see `main/sentry.ts`.
//
// Every window runs this file. Without it the whole renderer is a blind spot:
// `render-process-gone` fires only when the process actually *dies*, and a
// component that throws does not die — React unmounts the tree and leaves a
// blank window behind, which is indistinguishable from a hung one and reports
// nothing at all.
Sentry.init({});

// The camera bubble's and the dock's windows are sized in main with the same
// constant, so publishing it as a custom property keeps the CSS inset and the
// window geometry from drifting apart — a mismatch would clip the shadow it is
// there to hold or leave a dead band around it.
document.documentElement.style.setProperty("--panel-inset", `${PANEL_INSET}px`);
// The dock's top margin, which is the inset plus room for a tooltip. Published
// for the same reason: main grows the window by it, and the panel has to sit
// exactly that far down or the label is drawn over the panel or off the top.
document.documentElement.style.setProperty("--dock-headroom", `${DOCK_HEADROOM}px`);

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
