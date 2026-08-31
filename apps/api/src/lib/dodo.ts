/**
 * Everything Prequel says to Dodo Payments, and the one thing it listens to.
 *
 * Hand-rolled `fetch` rather than the `dodopayments` SDK, matching `ses.ts`,
 * `posthog.ts`, `r2.ts` and the desktop app's own client: four endpoints and a
 * signature check do not justify a dependency, and the HTTP shapes are the
 * contract either way.
 */
import { type Env, required } from "../env.ts";
import { timingSafeEqual } from "./ids.ts";

/**
 * Test and live are two different hosts, not a flag on one.
 *
 * A live key sent to the test host answers 401, which reads as a bad key rather
 * than as the wrong host — hours of looking at the wrong thing.
 */
const HOSTS = {
  test: "https://test.dodopayments.com",
  live: "https://live.dodopayments.com",
} as const;

/** How long to wait on Dodo before giving up. */
const TIMEOUT_MS = 10_000;

/**
 * How far out of date a webhook may claim to be.
 *
 * The signature covers the timestamp, so without this a body captured once
 * stays replayable for as long as the signing key lives.
 */
const MAX_SKEW_SECONDS = 5 * 60;

export class DodoError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Dodo Payments answered ${status}: ${body.slice(0, 200)}`);
    this.name = "DodoError";
  }
}

async function call<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${HOSTS[env.DODOPAYMENT_MODE]}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${required(env, "DODOPAYMENT_API_KEY")}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new DodoError(response.status, await response.text());

  return response.json<T>();
}

export interface CheckoutOptions {
  /** Travels back on every webhook this subscription ever produces. */
  teamId: string;
  email: string;
  name?: string | null;
  /** A returning payer, so a second subscription lands on the same customer. */
  customerId?: string | null;
  returnUrl: string;
}

/**
 * A hosted checkout for the Pro product.
 *
 * `metadata.teamId` is the only link between the page somebody is about to pay
 * on and the team it belongs to. Dodo echoes it on `subscription.active`, which
 * is where the subscription row is written — without it the webhook arrives
 * describing a payment nothing can attribute.
 */
export async function createCheckout(env: Env, options: CheckoutOptions): Promise<string> {
  const body = {
    product_cart: [{ product_id: required(env, "DODOPAYMENT_PRO_PRODUCT_ID"), quantity: 1 }],
    customer: options.customerId
      ? { customer_id: options.customerId }
      : { email: options.email, ...(options.name ? { name: options.name } : {}) },
    return_url: options.returnUrl,
    metadata: { teamId: options.teamId },
  };

  const session = await call<{ checkout_url: string | null }>(env, "/checkouts", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!session.checkout_url) throw new Error("Dodo Payments returned a session with no URL");

  return session.checkout_url;
}

export interface DodoSubscription {
  subscription_id: string;
  status: string;
  product_id: string;
  quantity: number;
  customer: { customer_id: string; email?: string };
  next_billing_date: string | null;
  cancel_at_next_billing_date: boolean;
  metadata: Record<string, string>;
}

export function getSubscription(env: Env, subscriptionId: string): Promise<DodoSubscription> {
  return call<DodoSubscription>(env, `/subscriptions/${subscriptionId}`);
}

/** A link to Dodo's own billing portal: card, invoices, cancellation. */
export async function portalSession(
  env: Env,
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const query = new URLSearchParams({ return_url: returnUrl });

  const session = await call<{ link: string }>(
    env,
    `/customers/${customerId}/customer-portal/session?${query}`,
    { method: "POST" },
  );

  return session.link;
}

export interface WebhookEnvelope {
  business_id: string;
  type: string;
  timestamp: string;
  data: DodoSubscription & { payload_type: string };
}

/**
 * Standard Webhooks verification, over the *raw* body.
 *
 * Three details each fail silently if missed:
 *
 * - The signing key is base64 **after** its `whsec_` prefix. Using the string
 *   as the HMAC key computes a valid signature over the wrong key and rejects
 *   every genuine delivery.
 * - `webhook-signature` is a space-separated list of `v1,<base64>` pairs, not a
 *   bare signature. Comparing the whole header to one computed value never
 *   matches.
 * - The body must be the bytes that arrived. Parsing and re-serialising changes
 *   key order and whitespace, and the digest with it.
 */
export async function verifyWebhook(
  secret: string,
  headers: { id: string | undefined; timestamp: string | undefined; signature: string | undefined },
  rawBody: string,
): Promise<boolean> {
  const { id, timestamp, signature } = headers;

  if (!id || !timestamp || !signature) return false;

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  if (Math.abs(Date.now() / 1000 - sent) > MAX_SKEW_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase64(secret.replace(/^whsec_/, "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  );

  const expected = encodeBase64(new Uint8Array(digest));

  // `some`, not a match against the first: the spec allows several signatures
  // during a key rotation, and only one of them has to be ours.
  return signature
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .some((part) => timingSafeEqual(part.slice(3), expected));
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
