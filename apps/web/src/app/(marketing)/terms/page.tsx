import type { Metadata } from "next";

import { LegalPage, type LegalSection } from "@/components/Legal";
import {
  PRICE_LIFETIME,
  PRICE_MONTHLY,
  STORAGE_LIFETIME,
  STORAGE_PRO,
  TRIAL_DAYS,
} from "@/lib/pricing";
import { pageMetadata } from "@/lib/seo";
import { OPERATOR, SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Terms",
  description:
    "The terms Prequel is sold under: what the licence covers, how billing and the 14-day refund work, what may be shared through a link, and the limits on both sides.",
  path: "/terms",
});

/**
 * What the product is sold under.
 *
 * Every price, storage figure and trial length is read from `lib/pricing.ts`
 * rather than typed out, for the reason that file gives: it is the only file
 * that carries a price, and a terms page quoting a stale one is worse than a
 * marketing page doing it, because this is the page somebody cites back.
 *
 * The refund window is the one number here with no home in the code, since
 * nothing enforces it. It is a promise, and it is honoured by hand.
 */
const REFUND_DAYS = 14;

const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    heading: "Who you are agreeing with",
    body: [
      `Prequel is made and run by ${OPERATOR.name}, ${OPERATOR.description}, in ${OPERATOR.country}. Downloading the app, starting the trial or buying a licence means accepting what is on this page.`,
      "A sole trader, so there is one person behind the product and the same person answers the support address.",
    ],
  },
  {
    id: "licence",
    heading: "What you are buying",
    body: [
      "A licence to use Prequel on the Macs you work on, for your own work or your employer's. Both plans are the same app: no watermark, no cap on the length of a take, no resolution tier and nothing held back behind the more expensive one.",
      `The lifetime licence is one payment for the app. Nothing renews and there is nothing to cancel. The ${PRICE_MONTHLY} a month plan runs monthly until you stop it.`,
      "What the licence does not cover: reselling it, renting it, redistributing the app, or sharing one licence between people as a way of buying a single copy for a team. Taking the app apart is limited to what the law allows you regardless of this page.",
    ],
  },
  {
    id: "trial",
    heading: "The trial",
    body: [
      `${TRIAL_DAYS} days with the whole app in it, and no card asked for to start. Nothing it exports is watermarked, so what you make during the trial is yours to keep whether or not you buy.`,
    ],
  },
  {
    id: "price",
    heading: "Price and billing",
    body: [
      `${PRICE_MONTHLY} a month, or ${PRICE_LIFETIME} once. Checkout, cards and invoices are handled by Dodo Payments, and taxes are added where they are owed.`,
      "A subscription renews each month until you cancel it, which you do in the billing portal. Cancelling stops the next renewal and leaves you with the month you have already paid for.",
      "The price can change. A change is said on the pricing page before it applies, and a subscription is told about it before the renewal it affects. A lifetime licence already bought is already paid for and is not repriced.",
    ],
  },
  {
    id: "refunds",
    heading: "Refunds",
    body: [
      `${REFUND_DAYS} days, no questions asked, on either plan. Write to ${SUPPORT_EMAIL} and it is refunded.`,
      `There is a ${TRIAL_DAYS}-day trial in front of both, so you can have the whole app before paying anything. The refund is there for what the trial did not catch.`,
    ],
  },
  {
    id: "storage",
    heading: "Storage on shared links",
    body: [
      "Storage counts only the recordings you upload to get a shareable link. What you export to your own Mac is never counted and has no limit.",
      "Over the quota, the next upload is refused. Nothing of yours is ever deleted to make room for it.",
      `Holding a lifetime licence and subscribing as well puts you on ${STORAGE_PRO.toLowerCase()} storage; stopping that subscription puts you back on the ${STORAGE_LIFETIME} you already own rather than on nothing.`,
    ],
    list: [
      `${PRICE_MONTHLY} a month: ${STORAGE_PRO.toLowerCase()} storage for shared recordings.`,
      `${PRICE_LIFETIME} once: ${STORAGE_LIFETIME} of shared recordings, kept for as long as you want them.`,
    ],
  },
  {
    id: "your-content",
    heading: "Your recordings are yours",
    body: [
      "Nothing you record, edit or share transfers to us. Uploading a recording grants only the permission needed to store that file and serve it to whoever opens the link, and it ends when you delete it.",
      "Your videos are not used to advertise Prequel, not shown as examples, and not used to train anything.",
    ],
  },
  {
    id: "acceptable",
    heading: "What may not be shared through a link",
    body: [
      "Sharing is hosted, and a host is allowed to refuse. What it refuses: unlawful material, somebody else's work you have no right to publish, anything whose purpose is to harass a person, and malware.",
      "A link can be removed and an account suspended for this. Where something is reported it is looked at before anything is acted on, and the refund above still applies if a paid account is ended this way and the report turns out to be wrong.",
    ],
  },
  {
    id: "service",
    heading: "The hosted part, and what happens when it is down",
    body: [
      "Recording, editing and exporting need nothing but your Mac. They keep working whether or not the service is up, and that is deliberate.",
      "Sharing, the library and signing in are hosted, and a hosted thing goes down sometimes. There is no uptime guarantee on that side. An outage there does not stop you making a video or exporting one.",
    ],
  },
  {
    id: "requirements",
    heading: "What you need to run it",
    body: [
      "An Apple Silicon Mac on macOS 14 or later, and the Screen Recording permission. Accessibility is optional and is what lets zooms follow your typing.",
      "If it will not run on your Mac, the refund above is what covers it. The requirements are on the download page and in the footer for that reason.",
    ],
  },
  {
    id: "updates",
    heading: "Updates and changes to the app",
    body: [
      "The app checks for updates and installs them, so the version you have is the one being supported.",
      "Features change. Something may be reworked, and occasionally something is removed because keeping it would make the rest worse. A removal worth noticing is written in the changelog.",
    ],
  },
  {
    id: "liability",
    heading: "Warranty and liability",
    body: [
      "The app is given as it is. It is tested, and there is no promise that it is fit for a particular purpose or that an export will be right for a use nobody here knew about.",
      "Keep your own copies of work you cannot lose. A recording is files on your Mac and the usual rules about backups apply to it.",
      "Where liability can be limited, it is limited to what you paid in the twelve months before the claim. Nothing here limits liability that the law does not allow to be limited, including for death, personal injury or fraud.",
    ],
  },
  {
    id: "ending",
    heading: "Ending it",
    body: [
      "Cancel a subscription whenever you like, in the billing portal, and keep using it until the month you have paid for is up.",
      "An account can be ended from this side for the sharing rules above, or for a payment reversed rather than disputed. Where that happens you are told which one it was.",
    ],
  },
  {
    id: "law",
    heading: "Governing law",
    body: [
      `These terms are governed by the laws of ${OPERATOR.country}, and the courts of ${OPERATOR.country} have jurisdiction.`,
      "If you are a consumer somewhere whose law gives you stronger protections than this page does, you keep those. Nothing here asks you to give them up.",
    ],
  },
  {
    id: "changes",
    heading: "Changes to these terms",
    body: [
      "This page carries the date it last changed, at the top. A change that alters what you are buying is said in the changelog, and carrying on using the app after one means accepting it.",
    ],
  },
  {
    id: "contact",
    heading: "Contact",
    body: [
      `${OPERATOR.name}, ${OPERATOR.description}, ${OPERATOR.country}.`,
      `${SUPPORT_EMAIL}, for licences, billing, refunds and anything on this page.`,
    ],
  },
];

export default function Terms() {
  return (
    <LegalPage
      title="Terms"
      lede={`What the licence covers, how billing works and what the ${REFUND_DAYS}-day refund means. Written to be read rather than to be survived.`}
      updated="10 September 2026"
      sections={SECTIONS}
    />
  );
}
