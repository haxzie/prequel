---
name: campaign-emails
description: Write the product email that goes to the whole list - a release announcement, a monthly roundup, a feature launch. Use whenever someone asks for a campaign, a newsletter, an email about what shipped, or says an email reads badly or lands in the wrong Gmail tab. Covers the template, the light palette it borrows from the site, where the contents come from, the unsubscribe tag, and what may not be claimed.
---

# Campaign emails

The mail that goes to everybody with an account. Not the magic-link mail, which
is transactional, lives in `apps/api/src/lib/ses.ts` and is sent by the Worker
rather than by hand.

The two look nothing alike and should not. `emailShell` is dark, because it is
the app talking to one person who just asked it something. A campaign is the
marketing site talking to a list, so it is paper-white and borrows the site's
palette — a reader who clicks through should land somewhere that looks like
where they came from.

## Where it is sent from

Mails, the service at `mails-api.haxzie.com`. The campaign itself is composed
in Mails' own UI; nothing in this repo sends one. `apps/api/src/lib/mails.ts`
only keeps the contact list in step — it creates a contact at sign-up, syncs
the plan, and toggles the suppression list when somebody uses the switch on
`/app/settings`.

So the deliverable here is **an HTML file and its plain-text twin**, pasted
into the composer. Write both: a text part is not optional for a bulk send, and
one generated from HTML by a tool reads like one.

## The files

- `assets/campaign.html` — the template. Placeholder copy in capitals, the
  structure and every colour already right.
- `assets/campaign.txt` — the plain-text twin, same shape.
- `scripts/preview.sh` — renders a campaign to a PNG. `./scripts/preview.sh
  mail.html 1800`.

Draft into `.context/`, never into the repo. A campaign is a thing that was
sent once, not a thing the tree carries.

**Look at it before you hand it over.** `preview.sh` exists because an email is
laid out by rules nobody holds in their head, and the failure is always visual —
a section label orphaned at the foot, a margin that collapsed, a headline that
wrapped to three lines. Raise the height argument until the white tail shows, or
the footer is cropped and you will not know it.

## Where the contents come from

`apps/web/src/content/changelog`. Each `.mdx` is one release: a `date`, a
`highlight`, and a line per thing somebody can now do.

```bash
grep -H "export const date" apps/web/src/content/changelog/*.mdx | sort -k2
```

That gives the releases in the window the mail covers. Read them all, then
group by what the reader would call it — "Screenshots", "The camera" — rather
than by version. Nobody knows which release they got a thing in, and a list
ordered by version number reads as a dev log.

**A roundup is almost always the stronger mail.** A point release gives you four
bullets and a headline about the smallest of them; a month gives you the two or
three things that are actually new, with the rest as a list underneath. Check
when the list was last mailed before deciding which one to write.

Sections earn their place by size: a genuinely new capability gets a label and a
paragraph, everything else is a bolded lead-in in the list. Ten labels is not a
structure.

## The voice

`[[site-copy]]`, not this file's and not the changelog's. Short, plain,
directive, addressed to one person. The sign-off is always:

> Musthaq
> Creator of Prequel

Keep the reply line above it. "Reply to this email — it reaches me" is true,
and a reply is the strongest engagement signal Gmail reads.

Numbers do the work superlatives would: *seventeen releases this month* needs no
adjective. Only use one you have counted — "thirty-seven backgrounds" was wrong
because seven patterns come in eight colours each, and the honest version was
"three new sets".

## What the mail may not say

Everything in `[[site-copy]]`'s list of claims applies, and two bite here:

- **Never say Prequel cuts silences or removes dead air.** The first pass does
  not trim anything.
- **Never promise a date.** A roundup says what shipped, not what is coming.

## The palette

Lifted from `apps/web/src/app/globals.css`, which is the canonical one. Change
it there and these go stale.

| | |
|---|---|
| Page | `#ffffff` |
| Text | `#141518` |
| Muted | `#6b6f76` |
| Hairline | `#e3e3e3` |
| Surface, for inline code | `#f5f5f5` |
| Brand | `#e14b15` |

**The CTA is a black pill, not an orange one.** The site's primary button is
`bg-fg text-bg` (`ButtonLink.tsx`); orange is the `danger` variant. An orange
button is the one mistake that makes the mail look like somebody else's.

Orange appears once, as the version chip beside the wordmark, exactly as
`Hero.tsx` draws the release pill.

One word of the headline is set in a serif italic, as `HeroWords` does it.
Georgia, not Newsreader — a webfont does not load in Gmail or Outlook.

## Rules the template already keeps

- **Inline styles only, no `<style>` block.** Gmail and Outlook strip it.
- **No tables and no images.** Gmail and Outlook block remote images until the
  reader asks for them, so an image-led mail arrives broken for most of the
  list. A mail that is only text arrives the same for everybody, carries no
  tracking pixel, and stays well under the 102 KB where Gmail clips a message.
- **A written preview line.** Left out, Gmail shows the wordmark and the version
  number beside the subject.
- **`max-width:520px`**, which is the readable measure on a phone.

## The unsubscribe tag

`{{unsubscribe_url}}` in the template **is a guess and must be checked in the
composer before any send.** What is known: Mails uses `{{…}}` merge tags —
`lib/mails.ts` writes `"Hi {{firstName}}"` — and holds a server-side
`POST /v1/contacts/:email/unsubscribe`, which is what the settings switch calls.
The name of the tag that renders a link is not documented anywhere reachable;
`mails.haxzie.com/docs` 404s and the service is not in this tree.

A tag that does not resolve ships as literal braces to the whole list, so this
is the last thing to confirm and the one worth being slow about.

**Never remove the unsubscribe line to stay out of Promotions.** Gmail requires
`List-Unsubscribe` from bulk senders; dropping it trades a tab for the spam
folder, which is the worse of the two by a long way.

## Promotions is the right tab

A bulk announcement with a call to action is a promotion, and Gmail sorts by
intent. There is no arrangement of this mail that lands it in Primary, and the
tactics that claim to — disguising bulk as transactional, splitting the send —
cost domain reputation to win a tab the recipient already expects product mail
in.

What is worth checking instead is authentication, because Spam is the failure
that matters. Confirm the From domain, send one to a Gmail account and read
**Show original**, which states the SPF, DKIM and DMARC verdicts plainly.
`prequel.sh` is a Google Workspace domain — its SPF includes only
`_spf.google.com` — so a campaign sent as `@prequel.sh` through anything else
needs that sender's DKIM on the domain before DMARC can pass.

## Before it goes

- Both parts written, HTML and text.
- Rendered and looked at.
- The unsubscribe tag confirmed against the composer.
- Every number counted.
- The window checked: does this cover everything since the list was last mailed?
- A test to a real Gmail account, read in **Show original** for the three
  verdicts.
