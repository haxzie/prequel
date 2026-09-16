import type { ComponentProps } from "react";

import shots from "@/content/docs/shots.json";

/**
 * A screenshot in a docs page, drawn at the size the app draws it.
 *
 * The site-wide `img` in `mdx-components.tsx` stretches every picture to the
 * column, which is right for a blog's landing-page captures and wrong for a
 * 384px Inspector panel: stretched to 672px it reads as a mock-up rather than
 * as the thing on screen. The capture script records each shot's size in CSS
 * pixels in `shots.json`, and this caps the picture at that width.
 *
 * `width` and `height` are set on the element as well as in the style, so the
 * box is reserved before the WebP decodes and the prose under it does not
 * shift. Images not in the manifest — anything that is not a shot — fall back
 * to the column's width.
 *
 * Passed to the MDX body as a `components` override rather than put in
 * `mdx-components.tsx`, because the manifest is the docs' own and the blog
 * should not have to know about it.
 */
export function DocsImage({ src, alt, ...props }: ComponentProps<"img">) {
  const id = typeof src === "string" ? /^\/docs\/([^/]+)\.webp$/.exec(src)?.[1] : undefined;
  const size = id ? (shots as Record<string, { width: number; height: number }>)[id] : undefined;

  return (
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      className="my-7 block h-auto w-full rounded-xl border border-line bg-elevated"
      {...(size ? { width: size.width, height: size.height, style: { maxWidth: size.width } } : {})}
      {...props}
    />
  );
}
