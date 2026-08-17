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
  a: (props) => (
    <a
      className="text-fg underline decoration-line underline-offset-4 transition-colors hover:decoration-accent"
      {...props}
    />
  ),
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
