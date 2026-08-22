import type { ReactNode } from "react";

import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { Nav } from "@/components/Nav";
import { Rails } from "@/components/Rails";
import { Wash } from "@/components/Wash";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo";

/**
 * The public site's chrome: the wash, the rails, the nav and the footer.
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
      <Wash />
      <Rails />
      <Nav />
      <main>{children}</main>
      <Footer />
    </>
  );
}
