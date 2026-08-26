import type { Metadata } from "next";

import { env } from "@prequel/env";

import type { Post } from "@/content/posts";
import type { FaqEntry } from "@/lib/faq";

import { CONTACT_EMAIL, SITE } from "./site";

/** Trailing slash stripped once so sitemap, robots and canonicals agree. */
export const SITE_URL = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

export function absoluteUrl(path: `/${string}` | "/"): string {
  return `${SITE_URL}${path}`;
}

/** Open Graph's expected card. Twitter reads the same image. */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/**
 * The share card every page falls back to.
 *
 * Declared here rather than left to `opengraph-image.tsx` at the root of `app/`,
 * which is what used to be here and which reached no page at all. That file
 * convention applies to the segment it sits in and the segments below it, and
 * nothing lives in the root segment — every marketing page is inside the
 * `(marketing)` group and the home page with them — so the card it drew was
 * routed, built, and referenced by nobody. Sharing prequel.sh anywhere produced
 * a plain text link.
 *
 * `width` and `height` are given because a platform that has them can lay the
 * card out before the image arrives, and one that does not may fall back to a
 * small square thumbnail rather than the wide card.
 */
export const OG_IMAGE = {
  url: "/og.png",
  ...OG_SIZE,
  type: OG_CONTENT_TYPE,
  alt: `${SITE.name} — ${SITE.tagline}`,
} as const;

type PageMetadataInput = {
  /** Relative path from the site root, including the leading slash. */
  path: `/${string}` | "/";
  description: string;
  /** Short page title — the layout template appends ` · Prequel`. */
  title?: string;
  openGraph?: Metadata["openGraph"];
  robots?: Metadata["robots"];
  /**
   * This page draws its own card in a colocated `opengraph-image.tsx`.
   *
   * Setting it leaves `images` off entirely, which is the only way that file
   * gets a look in. Next 16 lets a config-based `openGraph.images` win over the
   * file convention — the reverse of what its documentation says — so naming the
   * default here quietly replaced every blog post's card, built from the post's
   * own title, with the generic one. Verified in the build output, not assumed.
   */
  ownCard?: boolean;
};

/**
 * One place for canonical URLs, Open Graph and Twitter cards.
 *
 * Without explicit `openGraph.url` and `alternates.canonical`, subpages inherit
 * the layout's home URL and every share preview points at `/`.
 */
export function pageMetadata({
  title,
  description,
  path,
  openGraph,
  robots,
  ownCard = false,
}: PageMetadataInput): Metadata {
  const socialTitle = title ? `${title} · ${SITE.name}` : `${SITE.name} — ${SITE.tagline}`;

  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE.name,
      title: socialTitle,
      description,
      url: path,
      // The key is left out rather than set to `undefined`: what matters to the
      // resolver is whether it is there at all.
      ...(ownCard ? {} : { images: [OG_IMAGE] }),
      ...openGraph,
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      // Named rather than left to Twitter's fallback onto `og:image`. The
      // fallback is real, but only once the crawler has parsed the whole head,
      // and `summary_large_image` with no image of its own degrades to a small
      // card on more than one client.
      ...(ownCard ? {} : { images: [OG_IMAGE.url] }),
    },
    ...(robots ? { robots } : {}),
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    url: SITE_URL,
    logo: absoluteUrl("/icon.svg"),
    contactPoint: {
      "@type": "ContactPoint",
      email: CONTACT_EMAIL,
      contactType: "customer support",
    },
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE_URL,
    description: SITE.description,
    publisher: { "@type": "Organization", name: SITE.name },
  };
}

export function faqPageJsonLd(entries: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function blogPostingJsonLd(post: Post) {
  const url = absoluteUrl(`/blog/${post.slug}`);

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: { "@type": "Organization", name: SITE.name },
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      logo: { "@type": "ImageObject", url: absoluteUrl("/icon.svg") },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: `${url}/opengraph-image`,
  };
}

/**
 * A trail, for a page that sits below the top level.
 *
 * `/create/<slug>` deliberately has none: its trail would be a single hop to a
 * `/create` index that does not exist. `/alternatives/<slug>` earns one because
 * the trail is real and three deep.
 */
export function breadcrumbJsonLd(trail: { name: string; path: `/${string}` | "/" }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: absoluteUrl(step.path),
    })),
  };
}
