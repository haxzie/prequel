/**
 * Better Auth, configured for a Worker in front of D1.
 *
 * Two providers, both of which create the account on first use — there is no
 * signup route and no signup form anywhere in the product. Someone who has
 * never been here before and someone returning take exactly the same path.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, organization } from "better-auth/plugins";

import { schema } from "@prequel/db";

import { database } from "./db.ts";
import type { Env } from "./env.ts";
import { emailShell, sendEmail } from "./lib/ses.ts";

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(env: Env) {
  const db = database(env);

  return betterAuth({
    // The Worker's own origin. OAuth callback URLs are built from this and must
    // match what is registered with Google character for character — a trailing
    // slash here is a `redirect_uri_mismatch` there.
    baseURL: env.API_URL,
    secret: env.BETTER_AUTH_SECRET,

    database: drizzleAdapter(db, { provider: "sqlite", schema }),

    // The dashboard is on prequel.sh and this is on api.prequel.sh. Same site,
    // different origin: every browser call needs `credentials: "include"`, and
    // every origin allowed to make one has to be listed here or Better Auth
    // rejects the request before CORS is even consulted.
    trustedOrigins: [env.APP_URL, env.API_URL],

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      },
    },

    account: {
      accountLinking: {
        // Signing in with Google after a magic link on the same address is the
        // same person, and the alternative is a duplicate-email insert that
        // fails with a constraint violation on what looks to the user like an
        // ordinary login. Both providers below prove control of the address.
        enabled: true,
        trustedProviders: ["google", "magic-link"],
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        // A signed snapshot of the session in the cookie itself. Without it the
        // dashboard's per-request `getSession` is a D1 read on every navigation,
        // paid twice over because Vercel has to cross the Atlantic to make it.
        // Five minutes is the lag before a revoked session actually stops
        // working, which is the price.
        enabled: true,
        maxAge: 5 * 60,
      },
    },

    advanced: {
      crossSubDomainCookies: {
        // What makes one login cover prequel.sh and api.prequel.sh. Scoped to
        // the registrable domain, and left unset in development because
        // `localhost` cannot take a dotted cookie domain — Chrome discards the
        // Set-Cookie silently and every request afterwards looks signed out.
        enabled: env.APP_URL.startsWith("https://"),
        domain: env.APP_URL.startsWith("https://") ? ".prequel.sh" : undefined,
      },
      defaultCookieAttributes: {
        // Lax, not None. prequel.sh and api.prequel.sh are the same site, so Lax
        // is sent on these calls; None would additionally hand the cookie to any
        // third-party page that chose to call us.
        sameSite: "lax",
        secure: env.APP_URL.startsWith("https://"),
        httpOnly: true,
      },
    },

    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        sendMagicLink: async ({ email, url }) => {
          // Better Auth's `url` points at this Worker's verify endpoint, which
          // then redirects to the app. Rewriting it to the dashboard here would
          // skip the verification that consumes the token.
          await sendEmail(env, {
            to: email,
            subject: "Your Prequel sign-in link",
            text: `Sign in to Prequel: ${url}\n\nThis link expires in 10 minutes.`,
            html: emailShell(
              "Sign in to Prequel",
              "<p>Use the button below to sign in. The link expires in 10 minutes and works once.</p>",
              { href: url, label: "Sign in" },
            ),
          });
        },
      }),

      organization({
        /**
         * Teams, of exactly one person.
         *
         * Multi-member teams are not built yet — inviting, the member list and
         * the per-seat billing behind them were all removed rather than left
         * switched off, because a half-wired invitation path is what took
         * onboarding down for a week. A team is still the thing a video belongs
         * to, which is why organizations exist at all here.
         *
         * `organizationLimit: 1` is the rule, and it is enforced by the plugin
         * *before* it writes the organization row — so an account that already
         * has a team is refused rather than quietly given a second one.
         *
         * The invitation endpoints are refused in `index.ts`, in front of this
         * handler rather than in an `organizationHooks` gate. **Nothing here
         * hooks membership at all any more**, deliberately: the plugin runs
         * `beforeAddMember` for the creator's own `owner` row inside
         * `createOrganization`, after the organization is written, so a refusal
         * there does not refuse to add a member — it refuses to create a team
         * and leaves the team behind. That is the outage this replaces.
         */
        allowUserToCreateOrganization: true,
        organizationLimit: 1,
        creatorRole: "owner",
        schema: {
          organization: {
            // Declared so the plugin passes these through on create and update
            // rather than dropping them as unknown fields. Both are billing's,
            // and `storageQuotaBytes` is what uploads check against.
            additionalFields: {
              plan: { type: "string", required: false, input: false },
              storageQuotaBytes: { type: "number", required: false, input: false },
              // `input: false` on all three: these are ours to set, and a
              // client that could name its own `createdBy` could hand its team
              // to somebody else.
              createdBy: { type: "string", required: false, input: false },
            },
          },
        },

        organizationHooks: {
          /**
           * Stamps the creator onto the team, before the team exists.
           *
           * The plugin writes the creator's `member` row a few statements after
           * the organization row, with no transaction across the pair, so there
           * is a window in which a team exists and nothing records whose it is.
           * Membership alone cannot close that window — it *is* the thing that
           * goes missing. This is written in the same statement as the team, so
           * a team without a creator is not a state the database can reach.
           *
           * Safe where a `beforeAddMember` gate was not: this runs before the
           * insert, so throwing here refuses the team rather than orphaning it.
           */
          beforeCreateOrganization: async ({ organization: team, user }) => ({
            data: { ...team, createdBy: user.id },
          }),
        },
      }),
    ],
  });
}
