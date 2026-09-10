import type { ReactNode } from "react";

import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { Nav } from "@/components/Nav";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo";

/**
 * The public site's chrome: the nav and the footer.
 *
 * There was a background wash here too — three blurred circles of the icon's
 * sunrise at the top of every page. It was tuned against a near-black ground and
 * the light site does without it entirely: paper, and the colour comes from the
 * illustrations and the mark. `Wash` still exists for the sign-in page.
 *
 * This is what the root layout used to be. It moved down here when the app grew
 * pages that are not marketing — a dashboard has its own header, and a sign-in
 * page wants none at all.
 *
 * The organisation and website JSON-LD live here too rather than at the root.
 * They describe the product to a search engine, and the pages that are not
 * indexed — every dashboard route, the auth flow, a share link — have no use for
 * them.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
      <Nav />
      <main>{children}</main>
      <Footer />
    </>
  );
}
