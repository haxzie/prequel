import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocsImage } from "@/components/docs/DocsImage";
import { DocsPager } from "@/components/docs/DocsPager";
import { DocsShell } from "@/components/docs/DocsShell";
import { JsonLd } from "@/components/JsonLd";
import { Eyebrow } from "@/components/Section";
import { DOCS, isDocSlug, loadDoc, neighbours, outline } from "@/content/docs";
import { breadcrumbJsonLd, faqPageJsonLd, pageMetadata } from "@/lib/seo";
import { headingsOf, readDocSource } from "@/lib/toc";

export function generateStaticParams() {
  return DOCS.flatMap((section) => section.pages.map((slug) => ({ slug })));
}

// The outline is the complete set of pages, so anything else is a 404 rather
// than an import that would fail on a missing module.
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!isDocSlug(slug)) return {};

  const doc = await loadDoc(slug);
  return pageMetadata({ title: doc.title, description: doc.description, path: doc.path });
}

export default async function DocPage({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  if (!isDocSlug(slug)) notFound();

  const [doc, sections, pager] = await Promise.all([
    loadDoc(slug),
    outline(),
    neighbours(slug),
  ]);
  // The FAQ is rendered by this page rather than by the MDX, so the source has
  // no heading for it; added by hand so the list matches what is on screen.
  const toc = [
    ...headingsOf(readDocSource(slug)),
    { depth: 2 as const, text: "Frequently asked questions", id: "faq" },
  ];

  return (
    <DocsShell sections={sections} current={slug} toc={toc}>
      <header>
        <Eyebrow>{doc.section.title}</Eyebrow>
        <h1 className="text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl">
          {doc.title}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-pretty text-muted">{doc.description}</p>
      </header>

      <hr className="my-10 border-line" />

      {/* Element styling comes from `src/mdx-components.tsx`, with one override:
          screenshots draw at the size the app draws them. See `DocsImage`. */}
      <doc.Body components={{ img: DocsImage }} />

      {/* After the body, as on a post: it answers what is left over, not what
          the page is about. The same `dl` shape, so the two read as one site.
          The data below comes off the same array, so the two cannot drift. */}
      <section id="faq" className="mt-16 scroll-mt-24">
        <h2 className="text-2xl font-medium tracking-tight text-fg">Frequently asked questions</h2>
        <dl className="mt-6 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
          {doc.faq.map((item) => (
            <div key={item.question} className="bg-bg px-6 py-6">
              <dt className="text-[0.9375rem] font-medium text-fg">{item.question}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <DocsPager {...pager} />

      <JsonLd data={faqPageJsonLd(doc.faq)} />

      {/* Two hops. Sections are headings in the sidebar, not pages, and a
          breadcrumb naming a URL that 404s is worse than a short one. */}
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Docs", path: "/docs" },
          { name: doc.title, path: doc.path },
        ])}
      />
    </DocsShell>
  );
}
