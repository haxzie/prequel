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

type PageMetadataInput = {
  /** Relative path from the site root, including the leading slash. */
  path: `/${string}` | "/";
  description: string;
  /** Short page title — the layout template appends ` · Prequel`. */
  title?: string;
  openGraph?: Metadata["openGraph"];
  robots?: Metadata["robots"];
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
      ...openGraph,
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
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
