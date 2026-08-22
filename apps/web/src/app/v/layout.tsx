import type { ReactNode } from "react";

/**
 * A share link, opened by somebody who is not a customer.
 *
 * The most likely visitor here has no account, has never heard of Prequel, and
 * clicked a link in a chat window to watch a two-minute recording. So there is
 * no nav, no footer and no wash — the page is the video, and the only mention
 * of the product is one mark under it.
 *
 * That restraint is the point. A site's worth of chrome around somebody else's
 * screen recording reads as an ad wrapped round the thing they actually wanted.
 */
export default function PlayerLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-bg">{children}</div>;
}
