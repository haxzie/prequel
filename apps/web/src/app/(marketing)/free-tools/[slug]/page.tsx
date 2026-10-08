import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Faq } from "@/components/Faq";
import { JsonLd } from "@/components/JsonLd";
import { Container } from "@/components/Section";
import { Converter } from "@/components/free-tools/convert/Converter";
import { ShotEditor } from "@/components/free-tools/shot/ShotEditor";
import { Studio } from "@/components/free-tools/Studio";
import { ToolBody } from "@/components/free-tools/ToolBody";
import { ToolHero } from "@/components/free-tools/ToolHero";
import { findFreeTool, freeTools, type FreeTool } from "@/content/free-tools";
import { breadcrumbJsonLd, howToJsonLd, pageMetadata, webApplicationJsonLd } from "@/lib/seo";

/** The pills under the heading, by what the page is. */
const FACTS: Record<FreeTool["surface"]["kind"], string[]> = {
  recorder: ["No sign up", "Nothing uploaded", "No watermark", "Up to 30 minutes a take"],
  editor: ["No sign up", "Nothing uploaded", "No watermark", "Pastes straight in"],
  converter: ["No sign up", "Nothing uploaded", "No queue", "Up to 300 MB a file"],
};

export function generateStaticParams() {
  return freeTools.map((tool) => ({ slug: tool.slug }));
}

// The registry is the complete set of pages, so anything else is a 404 rather
// than a render attempt that would fail on a missing MDX module.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<"/free-tools/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const tool = findFreeTool(slug);
  if (!tool) return {};

  return pageMetadata({
    title: tool.name,
    description: tool.description,
    path: `/free-tools/${tool.slug}`,
    ownCard: true,
  });
}

/**
 * One tool: the hero, the thing itself, this page's prose, then the shared body.
 *
 * The studio goes directly under the hero because it is the page. Everything
 * below it is there for the visitor who wants to know what the tool does before
 * granting it their screen, and for the crawler that has no screen to grant.
 */
export default async function FreeToolPage({ params }: PageProps<"/free-tools/[slug]">) {
  const { slug } = await params;
  const tool = findFreeTool(slug);
  if (!tool) notFound();

  // The prefix has to stay a literal. The bundler turns this into a context
  // module over `src/content/free-tools`; a path assembled from a variable
  // compiles and then resolves to nothing at run time, for every slug at once.
  const { default: Body } = await import(`@/content/free-tools/${slug}.mdx`);

  return (
    <>
      <ToolHero
        eyebrow={tool.eyebrow}
        title={tool.heading}
        lede={tool.lede}
        // Per surface. These answer the question the page raises and no other:
        // a take has a ceiling, an image is pasted, and the thing everybody
        // wants to know about an online converter is whether their file is
        // going to sit in somebody's queue.
        facts={FACTS[tool.surface.kind]}
      />

      <section className="pb-12">
        <Container>
          {/* A client component inside a static page: the shell, the copy and
              every word of the structured data are rendered at build time, and
              the only JavaScript a visitor downloads is the tool itself. Which
              tool comes off the registry, so a page is still a registry entry
              and a file of prose. */}
          {tool.surface.kind === "editor" ? (
            <ShotEditor />
          ) : tool.surface.kind === "converter" ? (
            <Converter from={tool.surface.from} to={tool.surface.to} />
          ) : (
            <Studio mode={tool.surface.mode} />
          )}
        </Container>
      </section>

      <section className="pb-4">
        <Container>
          {/* Element styling comes from src/mdx-components.tsx, which sets no
              measure of its own. This is the column the blog and the use-case
              pages already use. */}
          <div className="mx-auto max-w-2xl">
            <Body />
          </div>
        </Container>
      </section>

      <ToolBody tool={tool} />
      <Faq heading={tool.faqHeading} entries={tool.faq} />

      <JsonLd
        data={[
          webApplicationJsonLd({
            name: tool.name,
            description: tool.description,
            path: `/free-tools/${tool.slug}`,
            features: tool.features.map((feature) => feature.title),
          }),
          howToJsonLd({
            // Only the first letter is lowered. The headings name formats, and
            // `toLowerCase()` on the whole string turned "MP4 to MP3" into "mp4
            // to mp3" in the structured data for every converter.
            name: `How to ${tool.heading.charAt(0).toLowerCase()}${tool.heading.slice(1)}`,
            description: tool.lede,
            path: `/free-tools/${tool.slug}`,
            steps: tool.steps,
          }),
          breadcrumbJsonLd([
            { name: "Free tools", path: "/free-tools" },
            { name: tool.name, path: `/free-tools/${tool.slug}` },
          ]),
        ]}
      />
    </>
  );
}
