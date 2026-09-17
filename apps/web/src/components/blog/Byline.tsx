import Image from "next/image";

import { LinkedInIcon, XIcon } from "@/components/icons";
import { AUTHOR } from "@/lib/site";

/**
 * Who is talking, with the two places to find them.
 *
 * Shared by a blog post and an article, which carry the same byline for the
 * same reason: one author, named in `lib/site.ts`, and a page that says so
 * under its excerpt rather than in the meta row above the title. The date and
 * the reading time describe the post; this says who wrote it, and it is the
 * last thing read before the prose starts.
 *
 * `justify-between` rather than a gap: the links go to the right edge of the
 * measure at every width, so the row reads as a rule under the header
 * instead of as a third line of metadata.
 */
export function Byline() {
  return (
    <div className="mt-8 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {/* Sized in the markup as well as in CSS. `next/image` needs the
            intrinsic dimensions to reserve the box, and an avatar that arrives
            after the text has laid out shifts the header. */}
        <Image
          src={AUTHOR.avatar}
          alt=""
          width={40}
          height={40}
          className="size-10 rounded-full ring-1 ring-fg/10"
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
            // Both leave the site and neither is a link we vouch for being
            // followed, which is what `rel` says here.
            target="_blank"
            rel="noreferrer noopener"
            aria-label={label}
            className="flex size-9 items-center justify-center rounded-full border border-line bg-elevated text-muted transition-colors hover:text-fg"
          >
            {/* The two marks are drawn at different weights at the same box
                size — X is a pair of thick strokes, the LinkedIn glyph sits
                inside a filled tile — so the icon size is set per link rather
                than shared. */}
            <Icon className={Icon === XIcon ? "size-3.5" : "size-4"} />
          </a>
        ))}
      </div>
    </div>
  );
}
