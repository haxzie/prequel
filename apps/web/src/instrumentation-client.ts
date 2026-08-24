/**
 * Client-side bootstrap: analytics, and React Grab in development.
 *
 * This file rather than a `<Script>` in the layout: Next runs it after the
 * document loads and *before* React hydrates, which is the window both of these
 * want, and it keeps a development tool out of the rendered app shell.
 */
import posthog from "posthog-js";

import { env } from "@prequel/env";

/**
 * PostHog, if this build was given a project token.
 *
 * Guarded rather than assumed: the token defaults to empty in the schema, and a
 * build that forgot it should be silent instead of sending a preview
 * deployment's traffic into the project.
 *
 * The site talks to PostHog directly, where the desktop app posts to the Worker
 * — a browser already holds the token by definition, and there is nothing to be
 * gained by proxying what is public.
 */
if (env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
  posthog.init(env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
    api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
    // The App Router does not reload the document on navigation, so without this
    // every route after the first one is invisible — the site would look like it
    // had one page.
    capture_pageview: "history_change",
    // Pins the modern defaults, which is worth doing for one of them in
    // particular: person profiles are only created for identified users. Without
    // it every anonymous visitor to the marketing site becomes a PostHog person
    // that does one thing and is billed for afterwards.
    defaults: "2025-05-24",
  });

  // The same property the Worker stamps on the desktop app's events. One PostHog
  // project holds both deployments, and this is the only thing that keeps local
  // work out of every insight.
  posthog.register({
    environment: env.NEXT_PUBLIC_APP_URL.startsWith("https://") ? "production" : "development",
    app: "web",
  });
}

/**
 * React Grab, in development only.
 *
 * Hover any element on the site and press ⌘C to copy it — with its component
 * stack and the source location behind each layer — for an agent to read. The
 * package is a devDependency and this is the only thing that imports it, so a
 * production build has nothing to resolve.
 *
 * `import()` rather than a static import, guarded on `NODE_ENV`: Next inlines
 * that flag and drops the dead branch, so nothing of the package reaches a
 * visitor. The docs are explicit that the import is fire-and-forget and may
 * land after hydration has begun — fine here, because React Grab reads
 * component stacks off React's commits rather than needing to be installed
 * before the first one.
 */
if (process.env.NODE_ENV === "development") {
  // Failure to load a development overlay must not take the page with it.
  void import("react-grab").catch((cause) => {
    console.warn("[react-grab] could not load:", cause);
  });
}
