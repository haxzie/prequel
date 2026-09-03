import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/JsonLd";
import { Container } from "@/components/Section";
import { Logo } from "@/components/Logo";
import { ButtonLink } from "@/components/Button";
import { LinkedInIcon, XIcon } from "@/components/icons";
import { AUTHOR } from "@/lib/site";
import { TRIAL_DAYS } from "@/lib/pricing";
import { clusterOf, findPost, formatDate, posts } from "@/content/posts";
import { blogPostingJsonLd, breadcrumbJsonLd, faqPageJsonLd, pageMetadata } from "@/lib/seo";

/**
 * The footer mark, as a variable so the button below it can indent to the text
 * rather than to the panel edge without the two sizes drifting apart.
 */
const MARK_SIZE = 72;

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

// The registry is the complete set of posts, so anything else is a 404 rather
// than a render attempt that would fail on a missing module.
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) return {};

  return pageMetadata({
    title: post.title,
    description: post.excerpt,
    path: `/blog/${post.slug}`,
    ownCard: true,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt,
      publishedTime: post.date,
      url: `/blog/${post.slug}`,
    },
  });
}

export default async function BlogPost({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) notFound();

  const { default: Body } = await import(`@/content/blog/${slug}.mdx`);

  // Both sides of the cluster come off `pillar`, so a post cannot claim a
  // parent that does not list it back.
  const parent = post.pillar ? findPost(post.pillar) : undefined;
  const cluster = clusterOf(post.slug);

  return (
    <Container className="py-20">
      <article className="mx-auto max-w-2xl">
        <Link href="/blog" className="font-mono text-xs text-muted hover:text-fg">
          ← All posts
        </Link>

        <header className="mt-8">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tracking-wide text-muted">
            <span className="rounded-full border border-line bg-elevated px-2.5 py-1">
              {post.tag}
            </span>
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <span aria-hidden>·</span>
            <span>{post.readingMinutes} min read</span>
          </div>
          <h1 className="mt-4 text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl">
            {post.title}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-pretty text-muted">{post.excerpt}</p>

          {/* The byline sits under the excerpt rather than in the meta row
              above the title, where the date and the reading time are. Those
              two describe the post; this says who is talking, and it is the
              last thing read before the prose starts.

              `justify-between` rather than a gap: the links go to the right
              edge of the measure at every width, so the row reads as a rule
              under the header instead of as a third line of metadata. */}
          <div className="mt-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Sized in the markup as well as in CSS. `next/image` needs the
                  intrinsic dimensions to reserve the box, and an avatar that
                  arrives after the text has laid out shifts the header. */}
              <Image
                src={AUTHOR.avatar}
                alt=""
                width={40}
                height={40}
                className="size-10 rounded-full ring-1 ring-white/10"
              />
              <div>
                <p className="text-sm font-medium text-fg">{AUTHOR.name}</p>
                <p className="text-xs text-muted">{AUTHOR.role}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {[
                { href: AUTHOR.x, label: `${AUTHOR.name} on X`, Icon: XIcon },
                { href: AUTHOR.linkedin, label: `${AUTHOR.name} on LinkedIn`, Icon: LinkedInIcon },
              ].map(({ href, label, Icon }) => (
                <a
                  key={href}
                  href={href}
                  // Both leave the site and neither is a link we vouch for
                  // being followed, which is what `rel` says here.
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={label}
                  className="flex size-9 items-center justify-center rounded-full border border-line bg-elevated text-muted transition-colors hover:text-fg"
                >
                  {/* The two marks are drawn at different weights at the same
                      box size — X is a pair of thick strokes, the LinkedIn
                      glyph sits inside a filled tile — so the icon size is set
                      per link rather than shared. */}
                  <Icon className={Icon === XIcon ? "size-3.5" : "size-4"} />
                </a>
              ))}
            </div>
          </div>

          {/* Up to the pillar. Inside the header rather than after the body,
              because a reader who arrived from a narrow search may want the
              broad guide instead, and that is a decision made before reading.
              Comes off `post.pillar`, the same field that builds the list of
              posts on the pillar itself, so the two cannot disagree. */}
          {parent ? (
            <p className="mt-6 text-sm text-muted">
              Part of{" "}
              <Link
                href={`/blog/${parent.slug}`}
                className="text-fg underline decoration-line underline-offset-4 transition-colors hover:decoration-accent"
              >
                {parent.title}
              </Link>
            </p>
          ) : null}
        </header>

        <hr className="my-10 border-line" />

        {/* Element styling comes from src/mdx-components.tsx, so the MDX itself
            stays free of class names. */}
        <Body />

        {/* The other half of `pillar`: everything filed under this page. Only
            renders on a pillar, since an ordinary post has an empty cluster. */}
        {cluster.length > 0 ? (
          <section className="mt-16">
            <h2 className="text-2xl font-medium tracking-tight text-fg">Read next</h2>
            <ul className="mt-6 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
              {cluster.map((item) => (
                <li key={item.slug} className="bg-bg transition-colors hover:bg-surface">
                  <Link href={`/blog/${item.slug}`} className="block px-6 py-5">
                    <span className="text-[0.9375rem] font-medium text-fg">{item.title}</span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-muted">
                      {item.excerpt}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Every post carries one, enforced by `faq` being required on `Post`.
            It sits after the body because it answers what is left over, not
            what the post is about, and a reader who got their answer in the
            prose should never have to scroll past it. */}
        <section className="mt-16">
          <h2 className="text-2xl font-medium tracking-tight text-fg">
            Frequently asked questions
          </h2>
          <dl className="mt-6 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {post.faq.map((item) => (
              <div key={item.question} className="bg-bg px-6 py-6">
                <dt className="text-[0.9375rem] font-medium text-fg">{item.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Three separate blocks rather than one `@graph`, matching the rest of
            the site. The FAQ data comes off `post.faq`, the same array the
            markup above renders, so the two cannot drift apart. */}
        <JsonLd data={blogPostingJsonLd(post)} />
        <JsonLd data={faqPageJsonLd(post.faq)} />
        <JsonLd
          data={breadcrumbJsonLd([
            { name: "Blog", path: "/blog" },
            { name: post.title, path: `/blog/${post.slug}` },
          ])}
        />

        <aside
          className="relative mt-16 overflow-hidden rounded-2xl border border-line bg-surface p-7"
          style={{ "--mark-size": `${MARK_SIZE}px` } as CSSProperties}
        >
          {/* A wash under the mark that is gone before the text ends, so the
              colour reads as coming off the icon's own sun gradient rather
              than as a tinted panel. Linear rather than radial: a radial
              centred on the mark bleeds through the left border and thickens
              it. `overflow-hidden` on the panel is what keeps the layer
              inside the corner radius. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgb(225 75 21 / 0.18), rgb(225 75 21 / 0.06) 34%, transparent 68%)",
            }}
          />
          {/* The mark centres on the heading and paragraph alone, so the row
              is its own flex container and the button sits outside it. With
              the button inside, the column it centres against is taller and
              the mark drifts below the heading. */}
          <div className="relative flex items-center gap-6">
            {/* The same warm halo the hero mark carries, at the smaller size. */}
            <Logo
              size={MARK_SIZE}
              radius={0.42}
              className="shadow-[0_16px_32px_-12px_rgb(0_0_0_/_0.7),0_10px_28px_-10px_rgb(225_75_21_/_0.45)]"
            />
            <div>
              <h2 className="text-base font-medium text-fg">Try it yourself</h2>
              <p className="mt-2 text-sm text-muted">
                Prequel records your screen and hands back a finished video. Free for {TRIAL_DAYS}{" "}
                days, with no watermark on anything you export.
              </p>
            </div>
          </div>
          {/* Indented to the text above rather than the panel edge — the
              mark's width plus the row's gap. */}
          <ButtonLink
            href="/download"
            className="relative mt-5 ml-[calc(var(--mark-size)_+_1.5rem)]"
          >
            Download for Mac
          </ButtonLink>
        </aside>
      </article>
    </Container>
  );
}
