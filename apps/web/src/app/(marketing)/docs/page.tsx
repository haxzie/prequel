import type { Metadata } from "next";
import Link from "next/link";

import { DocsShell } from "@/components/docs/DocsShell";
import { JsonLd } from "@/components/JsonLd";
import { SectionHeading } from "@/components/Section";
import { outline } from "@/content/docs";
import { itemListJsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Docs",
  description:
    "How Prequel works, from the first permission to the exported file: recording, the editor, captions, export and sharing.",
  path: "/docs",
});

export default async function Docs() {
  const sections = await outline();
  const pages = sections.flatMap((section) => section.pages);

  return (
    <DocsShell sections={sections}>
      <SectionHeading
        level={1}
        eyebrow="Docs"
        title="How Prequel works"
        lede="Everything the app can do, in the order you meet it. Start at the top if you have just installed it, or jump to the panel you are looking at."
      />

      {/* One list per section, in the "Read next" shape the blog uses: a
          bordered stack with a hairline between rows, so the index reads as a
          contents page rather than as a grid of cards competing for the eye. */}
      {sections.map((section) => (
        <section key={section.id} className="mt-14">
          <h2 className="text-2xl font-medium tracking-tight text-fg">{section.title}</h2>
          <ul className="mt-5 flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {section.pages.map((page) => (
              <li key={page.slug} className="bg-bg transition-colors hover:bg-surface">
                <Link href={page.path} className="block px-6 py-5">
                  <span className="text-[0.9375rem] font-medium text-fg">{page.title}</span>
                  <span className="mt-1.5 block text-sm leading-relaxed text-muted">
                    {page.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* An index emits a list, not a breadcrumb: a breadcrumb needs two hops
          and this page is the first of them. */}
      <JsonLd data={itemListJsonLd(pages.map((page) => ({ name: page.title, path: page.path })))} />
    </DocsShell>
  );
}
