import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Edge-compatible auth configuration.
 *
 * This file must NOT import any Node.js-only modules (database drivers,
 * garmin-connect, etc.) because it is used in middleware which runs on the
 * Edge runtime. The actual credential verification happens in src/auth.ts.
 */
export default {
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Garmin email", type: "email" },
        password: { label: "Garmin password", type: "password" },
      },
      // Authorize is overridden in src/auth.ts — this stub satisfies the Edge config
      authorize: () => null,
    }),
  ],
  pages: {
    signIn: "/login",
  },
} satisfies NextAuthConfig;
