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
 */
export function emailShell(
  heading: string,
  body: string,
  action?: { href: string; label: string },
) {
  const button = action
    ? `<p style="margin:32px 0"><a href="${action.href}" style="background:#e14b15;border-radius:10px;color:#fff;display:inline-block;font-weight:600;padding:12px 22px;text-decoration:none">${action.label}</a></p>`
    : "";

  return `<div style="background:#0b0d11;color:#e8eaed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px 24px">
  <div style="margin:0 auto;max-width:480px">
    <p style="color:#e14b15;font-size:20px;font-weight:700;margin:0 0 24px">Prequel</p>
    <h1 style="font-size:22px;font-weight:600;margin:0 0 12px">${heading}</h1>
    <div style="color:#9aa0a6;font-size:15px;line-height:1.6">${body}</div>
    ${button}
    <p style="border-top:1px solid #1e2128;color:#5f6469;font-size:12px;margin-top:32px;padding-top:16px">
      If you weren't expecting this, you can ignore it safely.
    </p>
  </div>
</div>`;
}
