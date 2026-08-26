/**
 * Better Auth, configured for a Worker in front of D1.
 *
 * Two providers, both of which create the account on first use — there is no
 * signup route and no signup form anywhere in the product. Someone who has
 * never been here before and someone returning take exactly the same path.
 */
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, organization } from "better-auth/plugins";

import { schema } from "@prequel/db";

import { database } from "./db.ts";
import type { Deferrable, Env } from "./env.ts";
import { entitlement, reconcileSeats } from "./lib/seats.ts";
import { emailShell, sendEmail } from "./lib/ses.ts";

export type Auth = ReturnType<typeof createAuth>;

/**
 * @param ctx The request's execution context, when there is one.
 *
 * Seat reconciliation is a call to Dodo, and the hooks below hang off actions a
 * user is waiting on — accepting an invitation is somebody clicking a link in an
 * email. Passed through so that work happens after the response instead of in
 * front of it. `middleware.ts` calls this for `getSession` and needs none of it.
 */
export function createAuth(env: Env, ctx?: Deferrable) {
  const db = database(env);

  /**
   * Runs seat reconciliation without the caller waiting on it.
   *
   * A failure is logged and left. `reconcileSeats` derives its work from state
   * rather than from the event, so the hourly sweep picks up whatever this
   * missed — which is a far better outcome than a member row written and the
   * request failed because a third party was slow.
   */
  const syncSeats = (teamId: string) => {
    const work = reconcileSeats(env, db, teamId).catch((error: unknown) => {
      console.error("seat reconciliation failed", teamId, error);
    });

    if (ctx) ctx.waitUntil(work);
    else void work;
  };

  /**
   * Refuses to grow a team that is not paying.
   *
   * 402 rather than 403: the dashboard opens the upgrade modal on this exact
   * status, and "you may not" and "you have not paid" want different words in
   * front of the user. `PAYMENT_REQUIRED` is better-call's name for it.
   */
  const requireSubscription = async (teamId: string) => {
    if (await entitlement(db, teamId)) return;

    throw new APIError("PAYMENT_REQUIRED", {
      message: "Upgrade to Pro to add teammates.",
      code: "SUBSCRIPTION_REQUIRED",
    });
  };

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
        // Teams. The plugin owns membership, roles and invitations; nothing
        // below reimplements any of it.
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
        invitationExpiresIn: 60 * 60 * 24 * 7,
        schema: {
          organization: {
            // Declared so the plugin passes these through on create and update
            // rather than dropping them as unknown fields. They exist for
            // billing, which is not built yet.
            additionalFields: {
              plan: { type: "string", required: false, input: false },
              storageQuotaBytes: { type: "number", required: false, input: false },
            },
          },
        },
        /**
         * Where billing meets membership.
         *
         * All of it hangs off the plugin rather than off routes of our own,
         * because the plugin *is* the route — invitations, acceptance and
         * removal are its endpoints under `/api/auth/organization/*`, and a
         * seat count maintained anywhere else would drift the first time
         * somebody used one of them directly.
         *
         * Who may invite and remove is already the plugin's: `owner` and
         * `admin` only, which is the rule the product wants. These add what it
         * costs, not who may.
         */
        organizationHooks: {
          // Both ways into a team. `beforeAddMember` is the direct path, which
          // no interface uses today — gating only the invitation would leave it
          // open the day something does.
          beforeCreateInvitation: async ({ invitation }) => {
            await requireSubscription(invitation.organizationId);
          },
          beforeAddMember: async ({ member: added }) => {
            await requireSubscription(added.organizationId);
          },

          afterAcceptInvitation: async ({ organization: team }) => syncSeats(team.id),
          afterAddMember: async ({ organization: team }) => syncSeats(team.id),
          afterRemoveMember: async ({ organization: team }) => syncSeats(team.id),
        },

        sendInvitationEmail: async ({ email, invitation, organization: team, inviter }) => {
          const url = `${env.APP_URL}/invite/${invitation.id}`;
          const who = inviter.user.name || inviter.user.email;

          await sendEmail(env, {
            to: email,
            subject: `${who} invited you to ${team.name} on Prequel`,
            text: `${who} invited you to join ${team.name} on Prequel.\n\n${url}`,
            html: emailShell(
              `Join ${team.name}`,
              `<p><strong>${who}</strong> invited you to their team on Prequel, where the team's screen recordings live.</p>`,
              { href: url, label: "Accept invitation" },
            ),
          });
        },
      }),
    ],
  });
}
