/**
 * What SES will let this deployment send, and to whom.
 *
 * Worth a script because every failure here reads the same from the app — a 500
 * on the sign-in form — while the causes are completely different: an
 * unverified sender, a sandbox that refuses unverified *recipients*, or a
 * suppressed address. Reading the answer straight from SES beats guessing.
 *
 *   node apps/api/scripts/ses-status.mjs
 *   node apps/api/scripts/ses-status.mjs add you@example.com
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AwsClient } from "aws4fetch";

const here = dirname(fileURLToPath(import.meta.url));

const vars = Object.fromEntries(
  readFileSync(join(here, "..", ".dev.vars"), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")).trim(),
      line.slice(line.indexOf("=") + 1).trim(),
    ]),
);

// The region is configuration rather than a secret, so it lives in
// wrangler.jsonc and not in `.dev.vars` — which means this fallback is what
// actually runs. It has to track the one there or this reports on an empty
// region and says the domain is unverified.
const region = vars.SES_REGION ?? "ap-south-1";
const endpoint = `https://email.${region}.amazonaws.com/v2/email`;

const client = new AwsClient({
  accessKeyId: vars.SES_ACCESS_KEY_ID,
  secretAccessKey: vars.SES_SECRET_ACCESS_KEY,
  region,
  service: "ses",
});

const [command, address] = process.argv.slice(2);

if (command === "add") {
  if (!address) {
    console.error("usage: node scripts/ses-status.mjs add you@example.com");
    process.exit(1);
  }

  const response = await client.fetch(`${endpoint}/identities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ EmailIdentity: address }),
  });

  console.log(
    response.ok
      ? `${address}: verification email sent — click the link in it`
      : `${address}: ${await response.text()}`,
  );

  process.exit(response.ok ? 0 : 1);
}

const account = await (await client.fetch(`${endpoint}/account`)).json();

console.log(`region    ${region}`);
console.log(`sending   ${account.SendingEnabled ? "enabled" : "DISABLED"}`);
console.log(
  `sandbox   ${account.ProductionAccessEnabled === false ? "yes — recipients must be verified too" : "no"}`,
);
console.log("");

const { EmailIdentities: identities = [] } = await (
  await client.fetch(`${endpoint}/identities`)
).json();

if (identities.length === 0) {
  console.log("no identities — nothing can send. `add <address>` to start one.");
} else {
  for (const identity of identities) {
    // `SendingEnabled` and `VerificationStatus`, not `VerifiedForSendingStatus`
    // — that one comes back from `GetEmailIdentity` on a single identity and is
    // simply absent from this list, so reading it here marked every identity
    // pending, including the verified domain everything actually sends from.
    const note = identity.SendingEnabled
      ? ""
      : identity.VerificationStatus === "FAILED"
        ? "  failed — verification never completed"
        : identity.IdentityType === "DOMAIN"
          ? "  pending — the DNS records are not visible yet"
          : "  pending — click the link AWS emailed";

    console.log(
      `${identity.SendingEnabled ? "✓" : "·"} ${identity.IdentityName}` +
        `  [${identity.IdentityType}]${note}`,
    );
  }
}
