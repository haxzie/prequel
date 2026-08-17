import { ImageResponse } from "next/og";

import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";
import { SITE } from "@/lib/site";

export const alt = `Prequel — ${SITE.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return new ImageResponse(
    await ogCard({ kicker: "macOS screen recorder", title: SITE.tagline }),
    size,
  );
}
