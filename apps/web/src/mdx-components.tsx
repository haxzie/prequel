import type { MDXComponents } from "mdx/types";

/**
 * Element overrides for every MDX file in the site.
 *
 * This file is required by `@next/mdx` and must sit beside `src/app`; MDX
 * silently renders nothing useful without it.
 *
 * Next 16 changed the signature — `useMDXComponents` now takes **no argument**.
 * The 15-era `(components) => ({ ...components, ...mine })` shape typechecks
 * against nothing here and would drop these overrides.
 */
const components = {
  h2: (props) => (
    <h2
      className="mt-14 mb-4 scroll-mt-24 text-2xl font-medium tracking-tight text-fg"
      {...props}
    />
  ),
  h3: (props) => (
    <h3 className="mt-10 mb-3 scroll-mt-24 text-lg font-medium tracking-tight text-fg" {...props} />
  ),
  p: (props) => <p className="my-5 leading-[1.75] text-muted" {...props} />,
  /**
   * Internal links stay put; anything off-site opens in a tab and is disowned.
   *
   * Posts cite Reddit threads as evidence for what people report about other
   * tools, and those are links we point at rather than vouch for, which is
   * exactly what `rel="noreferrer noopener"` says. Same treatment the author
   * byline gives its outbound links. Derived from the href rather than set per
   * link in the MDX, because the one that gets forgotten is the one that
   * matters.
   */
  a: ({ href, ...props }) => {
    const external = typeof href === "string" && /^https?:\/\//.test(href);

    return (
      <a
        href={href}
        className="text-fg underline decoration-line underline-offset-4 transition-colors hover:decoration-accent"
        {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
        {...props}
      />
    );
  },
  ul: (props) => (
    <ul className="my-5 list-disc space-y-2 pl-5 text-muted marker:text-line" {...props} />
  ),
  ol: (props) => (
    <ol className="my-5 list-decimal space-y-2 pl-5 text-muted marker:text-muted" {...props} />
  ),
  li: (props) => <li className="leading-[1.75] pl-1" {...props} />,
  strong: (props) => <strong className="font-medium text-fg" {...props} />,
  hr: (props) => <hr className="my-12 border-line" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="my-8 border-l-2 border-brand-from/60 pl-5 text-fg italic [&>p]:text-fg"
      {...props}
    />
  ),
  // Inline code only — a fenced block arrives as <code> inside <pre>, where the
  // surrounding pill would draw a second box around the whole listing.
  code: (props) => (
    <code
      className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] text-lilac [pre_&]:bg-transparent [pre_&]:p-0 [pre_&]:text-inherit"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="my-7 overflow-x-auto rounded-xl border border-line bg-surface p-4 font-mono text-[0.8125rem] leading-relaxed text-fg/90"
      {...props}
    />
  ),
  /**
   * Two shapes of image share this element and they do not share a ratio.
   *
   * Landing-page captures are 16:10 by construction; a cropped Reddit thread is
   * whatever height the post happened to be. Forcing one ratio on both means
   * either cropping the thread or padding it into a frame it does not fill,
   * which reads as a small graphic stranded in a large box. So the image keeps
   * its own proportions and the file is generated at the size it should render.
   *
   * The cost is that no box is reserved before the image decodes, so prose
   * below it shifts once. Every one of these is a local file a few tens of
   * kilobytes in size, which is the case where that is cheap.
   */
  img: (props) => (
    <img
      className="my-7 h-auto w-full rounded-xl border border-line bg-surface"
      loading="lazy"
      decoding="async"
      {...props}
    />
  ),
  table: (props) => (
    <div className="my-7 overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-left text-sm" {...props} />
    </div>
  ),
  th: (props) => <th className="border-b border-line px-4 py-3 font-medium text-fg" {...props} />,
  td: (props) => <td className="border-b border-line/60 px-4 py-3 text-muted" {...props} />,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
