import type { Route } from "next";

/**
 * Every piece of copy that appears in more than one place, in one file.
 *
 * Anything here is safe to change without touching a component. Anything not
 * here lives with the section that says it, because a constant used once is
 * just indirection.
 */
export const SITE = {
  name: "Prequel",
  tagline: "Create cinematic screen recordings from Mac",
  description:
    "A macOS screen recorder that hands back a finished video. Zooms that follow the work, a framed camera and a background, exported at up to 4K on your Mac's own media engine.",
  platform: "Apple Silicon · macOS 14+",
} as const;

export const NAV: { href: Route; label: string }[] = [
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
];

export const CONTACT_EMAIL = "hello@prequel.sh";
