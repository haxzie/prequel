import type { Metadata } from "next";

import { LegalPage, type LegalSection } from "@/components/Legal";
import { pageMetadata } from "@/lib/seo";
import { CONTACT_EMAIL, OPERATOR, SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Privacy",
  description:
    "What Prequel collects and what it does not. Recording, editing, export and transcription all happen on your Mac. Only a recording you share, your account and product analytics reach a server.",
  path: "/privacy",
});

/**
 * What the product actually does with data, clause by clause.
 *
 * Written from the code rather than from a template, which is the only way this
 * page is worth anything: every sentence here was checked against the route or
 * the table that does the thing. The ones that were easiest to get wrong, and so
 * are worth re-checking if any of this changes:
 *
 * - **Transcription is on-device.** `main/transcribe/apple.ts` runs Apple's own
 *   engines through the addon. It used to upload `mic.m4a` to OpenAI through our
 *   Worker and `apps/api/src/routes/transcribe.ts` is still mounted, so anybody
 *   reading that file could reasonably think this page lies. Nothing calls it.
 * - **A view is counted, not a viewer.** `routes/public.ts` captures
 *   `video_viewed` against the video's own id with `anonymous: true`.
 * - **An over-quota upload is refused**, not made room for. Nothing is ever
 *   deleted on somebody's behalf.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "summary",
    heading: "The short version",
    body: [
      "Prequel records, edits and exports on your Mac. Nothing about making a video reaches a server, and the captions are transcribed by macOS on the same machine.",
      "Three things do leave it: a recording you press Share on, the account you sign in with, and product analytics about how the app is used. Each has a section below, and none of them includes what is inside a recording.",
      `Prequel is run by ${OPERATOR.name}, ${OPERATOR.description}, in ${OPERATOR.country}. Anything on this page can be asked about at ${SUPPORT_EMAIL}.`,
    ],
  },
  {
    id: "local",
    heading: "What stays on your Mac",
    body: [
      "Your screen, your camera, your microphone and the sound coming out of your Mac are captured to files in a folder on your own disk. Editing and export run on your Mac's own media engine. There is no upload step and no cloud render.",
      "Captions are transcribed on the device, through the speech engines macOS already has. The audio is not sent anywhere to be read, so there is no size ceiling and no allowance to count against.",
      "Prequel cannot see a recording you have not shared. There is no inventory of what is on your disk, and deleting a recording in the app deletes files that never left it.",
      "The app writes a log to ~/Library/Logs/Prequel/main.log, on your Mac, and sends it nowhere. If you are reporting a bug you attach it to an email yourself.",
    ],
  },
  {
    id: "sharing",
    heading: "When you share a recording",
    body: [
      "Press Share on a finished export and that file is uploaded, because a link has to point at something. It is stored on Cloudflare R2, with a row that holds the title, the size, the length, the dimensions, a poster still taken from the video, and a count of views.",
      "The link is unlisted rather than public. It resolves through sixteen random characters, it is never indexed, and anyone holding it can watch without an account. That is as far as it goes.",
      "Views are counted, not identified. Opening a share page adds one to that recording's count and records an event filed under the recording itself, so no person is created out of somebody who watched a video.",
      "Delete a shared recording and the file goes from storage immediately. The row stays behind so a link already sitting in somebody's chat says the recording was deleted rather than showing a page that looks broken.",
    ],
  },
  {
    id: "account",
    heading: "Your account",
    body: [
      "You sign in with Google or with a link sent to your email address. Either way what is kept is your name, your email address and the avatar URL the provider gives. There is no password anywhere in the product and no signup form, so there is nothing of that kind to leak.",
      "A session records the IP address and browser it was created from. That is what lets you tell your own sessions apart from one you do not recognise.",
      "A signed-in Mac holds a token in a file only the app can read. What is stored here is a hash of that token and the Mac's hostname, so the account page can name the device you are about to revoke.",
    ],
  },
  {
    id: "payments",
    heading: "Payments",
    body: [
      "Checkout and the billing portal are run by Dodo Payments. Card details are entered on their side and Prequel never receives them.",
      "What is kept here is the plan, the state of the subscription or the one-off purchase behind it, and enough to answer a question about a receipt. Invoices, cards and cancellation live in their portal.",
    ],
  },
  {
    id: "analytics",
    heading: "Analytics",
    body: [
      "Product analytics go to PostHog, on their US cloud. What they record is how the product is used, never what is in a recording.",
      "On the site: the pages visited, where you arrived from, and whether the download button was pressed, against a first-party cookie.",
      "In the app: events such as a launch, a recording started, a transcription finished, an export completed, along with the app version and the macOS version. These are keyed to a random install id, and to your account id once you have signed in.",
      "When something fails, the app reports the failure: where in the app it happened, the kind of error and its message. Any file path inside that message is replaced before it is sent, because a path carries your account name and the name of what you recorded.",
      "Never collected, on either side: screen contents, keystrokes, window titles, the names of your files, audio, or anything out of a transcript. The zooms are placed by reading your clicks and your typing, and that reading happens on your Mac and stays there.",
      "Signed into the dashboard, your account id, email and name are attached to your own events, so a support question can be answered by the person who builds the app.",
    ],
  },
  {
    id: "email",
    heading: "Email",
    body: [
      "Sign-in links and transactional mail go through Amazon SES. Your address is used for getting you in and for telling you about something you bought.",
      "There is no marketing list. Nothing is sold, and nothing is shared for advertising.",
    ],
  },
  {
    id: "cookies",
    heading: "Cookies",
    body: [
      "Two, and both first-party: a session cookie once you are signed in, and the analytics cookie PostHog keeps its identity in.",
      "No advertising cookies and no third-party trackers, which is why there is no consent banner in front of this site. Blocking the analytics cookie costs you nothing here.",
    ],
  },
  {
    id: "processors",
    heading: "Who else handles it",
    body: [
      "Each of these is given the least it needs to do its part, and none of them is given a recording you have not shared.",
    ],
    list: [
      "Cloudflare: the API, the database, and the files behind shared links.",
      "Vercel: hosting for this site.",
      "Google: sign-in, if that is how you sign in.",
      "Dodo Payments: checkout, cards and invoices.",
      "Amazon SES: sign-in links and transactional email.",
      "PostHog: product analytics.",
      "GitHub and Cloudflare: the download itself, mirrored from the release.",
    ],
  },
  {
    id: "retention",
    heading: "How long it is kept",
    body: [
      "Account data is kept while the account exists. Ask for it to go and it goes.",
      "A shared recording is kept until you delete it, and the file goes at once when you do.",
      "Analytics events are kept on PostHog's own retention rather than forever.",
      "Deleting your account takes the team with it, and the library and the stored files with that.",
    ],
  },
  {
    id: "rights",
    heading: "What you can ask for",
    body: [
      `A copy of what is held about you, a correction to it, or its deletion. One address, ${SUPPORT_EMAIL}, read by the person who builds the app rather than a ticket queue.`,
      "In the EU or the UK these are your rights under the GDPR. They are given to everybody who asks, wherever they are, because running two standards would mean the smaller one is what the code actually does.",
      "The service runs on infrastructure in the United States and elsewhere, so using it means data about you crossing a border. The processors above are the ones it crosses to.",
    ],
  },
  {
    id: "changes",
    heading: "Changes to this policy",
    body: [
      "This page carries the date it last changed, at the top. A change to what is collected is said in the changelog as well rather than edited in quietly.",
    ],
  },
  {
    id: "contact",
    heading: "Contact",
    body: [
      `${OPERATOR.name}, ${OPERATOR.description}, ${OPERATOR.country}.`,
      `${SUPPORT_EMAIL} for anything on this page or about your data. ${CONTACT_EMAIL} for everything else.`,
    ],
  },
];

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy"
      lede="Recording, editing, export and transcription all happen on your Mac. This page says what reaches a server, and what never does."
      updated="10 September 2026"
      sections={SECTIONS}
    />
  );
}
