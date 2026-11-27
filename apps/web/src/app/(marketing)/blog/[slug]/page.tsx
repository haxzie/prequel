import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/JsonLd";
import { Container } from "@/components/Section";
import { Toc } from "@/components/Toc";
import { Byline } from "@/components/blog/Byline";
import { TryItAside } from "@/components/blog/TryItAside";
import { TryPrequelCard } from "@/components/blog/TryPrequelCard";
import { headsOf } from "@/content/changelog";
import { clusterOf, findPost, formatDate, posts } from "@/content/posts";
import { blogPostingJsonLd, breadcrumbJsonLd, faqPageJsonLd, pageMetadata } from "@/lib/seo";
import { headingsOf, readPostSource } from "@/lib/toc";

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
  const shipped = await headsOf(post.releases ?? []);

  // The body's own headings, then the sections this page renders rather than
  // the MDX. Appended by hand for the same reason the docs do it: the source
  // has no heading for them, and a contents list that stops before the FAQ
  // reads as a list that has lost its end. Each entry here has a matching
  // `id` on the section below, and only the sections that actually render.
  const toc = [
    ...headingsOf(readPostSource(slug)),
    ...(shipped.length > 0
      ? [{ depth: 2 as const, text: "In the changelog", id: "changelog" }]
      : []),
    ...(cluster.length > 0 ? [{ depth: 2 as const, text: "Read next", id: "read-next" }] : []),
    { depth: 2 as const, text: "Frequently asked questions", id: "faq" },
  ];

  return (
    <Container className="py-20">
      {/* The article and the rail are one block, centred together: the rail is
          part of what there is to read, so centring the prose alone and
          letting the rail hang off its right would sit the page's weight left
          of the window.

          `justify-center` is what does it. Both tracks are fixed, so they come
          to 59.5rem inside a 68rem container and the free space is split
          either side; a `1fr` spacer track would do the same thing by hand and
          stop being symmetric the moment either width changed.

          The rail is 15rem. It was 11rem, matching the docs' own, and the docs
          have short page titles where a post has "How do you record your
          screen and your face at the same time?" — which wrapped to three
          lines and made the list taller than the post it was indexing.

          The container cannot grow to pay for that: `Nav` uses the same
          `Container` at `max-w-6xl`, and a wider one here would start the
          article's left edge outside the logo above it.

          Below `xl` the grid is off and the article is centred as before; the
          rail is the first thing to go, because a contents list stacked above
          a post is a screenful of links in front of the thing you came for. */}
      <div className="xl:grid xl:grid-cols-[minmax(0,42rem)_15rem] xl:justify-center xl:gap-10">
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

            {/* Under the excerpt rather than in the meta row: the note in
              `Byline.tsx` says why. */}
            <Byline />

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

          {/* The releases this post describes, as links to their place on the
            changelog. The changelog lists the post back under each one, off
            the same `releases` field. After the body: it is where a reader
            who wants to know when a feature landed goes next. */}
          {shipped.length > 0 ? (
            <section id="changelog" className="mt-16 scroll-mt-24">
              <h2 className="text-2xl font-medium tracking-tight text-fg">In the changelog</h2>
              <ul className="mt-6 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
                {shipped.map((release) => (
                  <li key={release.version} className="bg-bg transition-colors hover:bg-surface">
                    <Link
                      href={`/docs/changelog#v${release.version}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-4"
                    >
                      <span className="font-mono text-sm text-fg">v{release.version}</span>
                      <span className="text-[0.9375rem] text-fg">{release.highlight}</span>
                      <time dateTime={release.date} className="ml-auto text-sm text-muted">
                        {formatDate(release.date)}
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* The other half of `pillar`: everything filed under this page. Only
            renders on a pillar, since an ordinary post has an empty cluster. */}
          {cluster.length > 0 ? (
            <section id="read-next" className="mt-16 scroll-mt-24">
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
          <section id="faq" className="mt-16 scroll-mt-24">
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

          {/* Hidden from `xl`, where `TryPrequelCard` is in the rail and is
              the same offer. See the note on that component. */}
          <div className="xl:hidden">
            <TryItAside />
          </div>
        </article>

        {/* `self-start` is what lets `sticky` work inside a grid: a stretched
            item is already as tall as the row and has nothing to stick within.
            Only rendered when there is enough of a post to navigate.

            A column with the scroll on the contents alone, so the card under
            them is always on screen. A guide with numbered steps runs to
            twenty entries and is taller than the viewport on its own; with the
            rail scrolling as one piece the card sits below its fold, where the
            page's own scrollbar cannot reach it and it is never seen.
            `min-h-0` on the scrolling child is the part that is easy to miss:
            a flex item will not shrink below its content without it, so the
            list would push the card back out of the column. */}
        {toc.length >= 3 ? (
          <aside className="hidden self-start xl:sticky xl:top-8 xl:flex xl:max-h-[calc(100dvh-4rem)] xl:flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Toc headings={toc} />
            </div>
            <div className="mt-6 shrink-0">
              <TryPrequelCard />
            </div>
          </aside>
        ) : null}
      </div>
    </Container>
  );
}
