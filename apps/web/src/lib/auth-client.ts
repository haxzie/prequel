"use client";

/**
 * Better Auth, from the browser.
 *
 * Points at the Worker rather than at this app, which is the one thing that has
 * to be right: the client builds every call off `baseURL`, and a client aimed at
 * the Next app would 404 against pages that no longer exist there.
 */
import { createAuthClient } from "better-auth/react";
import { magicLinkClient, organizationClient } from "better-auth/client/plugins";

import { env } from "@prequel/env";

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_API_URL,
  // Cross-origin, so nothing is sent by default. Every call here is
  // authenticated by the cookie, so this is not optional.
  fetchOptions: { credentials: "include" },
  plugins: [magicLinkClient(), organizationClient()],
});

export const { signIn, signOut, useSession, organization } = authClient;
