/**
 * Transactional email through SES v2.
 *
 * `aws4fetch` rather than the AWS SDK, and not only for size: the v3 SDK pulls
 * in a Node-shaped credential chain that looks for a filesystem and an instance
 * metadata endpoint, neither of which exists in a Worker. The same signer
 * already presigns R2, so this costs nothing extra.
 */
import { AwsClient } from "aws4fetch";

import { required, type Env } from "../env.ts";

export async function sendEmail(
  env: Env,
  message: { to: string; subject: string; text: string; html: string },
): Promise<void> {
  const region = env.SES_REGION;

  const client = new AwsClient({
    accessKeyId: required(env, "SES_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "SES_SECRET_ACCESS_KEY"),
    region,
    service: "ses",
  });

  const response = await client.fetch(
    `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        FromEmailAddress: env.SES_FROM,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: message.text, Charset: "UTF-8" },
              Html: { Data: message.html, Charset: "UTF-8" },
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    // The body carries SES's own reason — an unverified sender, a sandboxed
    // account, a suppressed address — and every one of them looks identical
    // from the caller without it. Logged rather than returned: the caller is a
    // sign-in form, and what SES thinks of our account is not the visitor's
    // business.
    const detail = await response.text().catch(() => "");
    console.error(`ses: ${response.status} ${detail}`);
    throw new Error("Could not send that email.");
  }
}

/**
 * The one piece of chrome every email here shares.
 *
 * Inline styles and a table-free layout on purpose: this is opened in Gmail,
 * Outlook and Apple Mail, and the first two strip a `<style>` block.
 *
 * **Light, and only light.** The colours are the site's light tokens — `--bg`,
 * `--fg`, `--muted`, `--line` from `apps/web/src/app/globals.css` — written
 * out rather than referenced, because an email cannot carry a stylesheet and
 * `apps/api` shares no code with `apps/web`. A dark shell is the one thing a
 * client is likely to invert badly: several of them recolour a light email for
 * a dark reader and none of them lighten a dark one, so starting light is the
 * version that survives both.
 */
export function emailShell(
  /**
   * Where the artwork is served from — `APP_URL`, which is `prequel.sh` in
   * production and the site that carries `public/email/`.
   *
   * Passed rather than hardcoded so there is one place the origin is decided.
   * A dev build points this at localhost and the image will not load in a real
   * inbox, which is true of every link in these emails and is not worth a
   * second rule.
   */
  appUrl: string,
  heading: string,
  body: string,
  action?: { href: string; label: string },
  /**
   * The small print, when the default will not do.
   *
   * "You can ignore it safely" is the right line under a sign-in link, which
   * is the only thing anybody can be sent without asking for it. It is the
   * wrong line under an email somebody can be sent again — that one has to say
   * why it arrived and how to stop it, so the trial email passes its own.
   *
   * HTML, because the only reason to replace this is to put a link in it.
   */
  footer?: string,
) {
  const button = action
    ? `<p style="margin:32px 0"><a href="${action.href}" style="background:#e14b15;border-radius:10px;color:#fff;display:inline-block;font-weight:600;padding:12px 22px;text-decoration:none">${action.label}</a></p>`
    : "";

  return `<div style="background:#ffffff;color:#141518;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px 24px">
  <div style="margin:0 auto;max-width:480px">
    <!--
      The wordmark, as a flat image: the app icon beside the word, the same
      pairing the site's \`Wordmark\` draws. See \`public/email/README.md\`.

      Width and height are set as attributes as well as in the style, because
      Outlook ignores CSS dimensions on an image and would otherwise lay out
      the 256px asset at its full size.

      \`alt\` is doing real work here and is not decoration. Remote images are
      blocked by default in a good share of clients, and the styles on the
      image are inherited by the alt text when they are — so a blocked image
      degrades to "Prequel" set bold in the body colour, which is a wordmark
      rather than a broken-image icon.
    -->
    <img src="${appUrl}/email/wordmark.png" alt="Prequel" width="152" height="50"
      style="border:0;color:#141518;display:block;font-size:20px;font-weight:700;height:50px;margin:0 0 24px;width:152px" />
    <!-- Medium rather than semibold. The heading sits directly under a
         handwritten wordmark, and a heavy cut next to it reads as two
         competing voices; 500 lets the mark be the loud thing on the page. -->
    <h1 style="font-size:22px;font-weight:500;margin:0 0 12px">${heading}</h1>
    <div style="color:#6b6f76;font-size:15px;line-height:1.6">${body}</div>
    ${button}
    <p style="border-top:1px solid #e3e3e3;color:#6b6f76;font-size:12px;margin-top:32px;padding-top:16px">
      ${footer ?? "If you weren't expecting this, you can ignore it safely."}
    </p>
  </div>
</div>`;
}
