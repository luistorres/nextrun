import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
  allowedEmails,
  garminConnections,
} from "@/lib/db/schema";
import { enqueueConnectBackfill } from "@/lib/queue/producer";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import {
  authenticateGarmin,
  persistGarminConnection,
  type StoredTokens,
} from "@/lib/garmin/connect-client";
import authConfig from "@/auth.config";

class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

class MfaRequiredError extends CredentialsSignin {
  code = "mfa";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Garmin email", type: "email" },
        password: { label: "Garmin password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = String(credentials.email).trim().toLowerCase();
        const password = String(credentials.password);

        // Increment before the allowlist check so probing is throttled too
        const ip =
          request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        const [emailOk, ipOk] = await Promise.all([
          checkRateLimit(`login:email:${email}`),
          checkRateLimit(`login:ip:${ip}`),
        ]);
        if (!emailOk || !ipOk) {
          throw new RateLimitedError();
        }

        // Allowlist before any Garmin call; failure indistinguishable from
        // bad credentials so the list can't be probed
        const allowed = await db
          .select({ email: allowedEmails.email })
          .from(allowedEmails)
          .where(eq(allowedEmails.email, email))
          .then((res) => res[0] ?? null);
        if (!allowed) {
          console.warn(`[auth] sign-in rejected: ${email} not in allowed_emails`);
          throw new CredentialsSignin();
        }

        let displayName: string;
        let tokens: StoredTokens;
        try {
          ({ displayName, tokens } = await authenticateGarmin(email, password));
        } catch (error) {
          // Only the first line: garmin-connect errors can embed request
          // params/tokens, and the password must never reach the logs
          const message =
            error instanceof Error ? error.message : "Unknown error";
          console.error(`[auth] Garmin login failed: ${message.split("\n")[0]}`);
          if (message.includes("MFA") || message.includes("Ticket not found")) {
            throw new MfaRequiredError();
          }
          throw new CredentialsSignin();
        }

        const [user] = await db
          .insert(users)
          .values({ email, name: displayName, emailVerified: new Date() })
          .onConflictDoUpdate({
            target: users.email,
            set: { updatedAt: new Date() },
          })
          .returning();

        await persistGarminConnection(user.id, displayName, tokens);

        // Kick the initial 90-day import unless one already ran; also
        // re-kicks connections stuck on pending/failed from older logins
        const [connection] = await db
          .select({ backfillStatus: garminConnections.backfillStatus })
          .from(garminConnections)
          .where(eq(garminConnections.userId, user.id));
        if (
          connection?.backfillStatus === "pending" ||
          connection?.backfillStatus === "failed"
        ) {
          try {
            await enqueueConnectBackfill({ userId: user.id });
          } catch (error) {
            console.error(
              `[auth] connect-backfill enqueue failed: ${error instanceof Error ? error.message : "unknown"}`,
            );
          }
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }

      // Fetch custom fields from the database on each token refresh
      if (token.id) {
        const dbUser = await db
          .select({
            onboardingCompleted: users.onboardingCompleted,
            subscriptionStatus: users.subscriptionStatus,
          })
          .from(users)
          .where(eq(users.id, token.id as string))
          .then((res) => res[0] ?? null);

        if (dbUser) {
          token.onboardingCompleted = dbUser.onboardingCompleted;
          token.subscriptionStatus = dbUser.subscriptionStatus;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        session.user.onboardingCompleted =
          (token.onboardingCompleted as boolean) ?? false;
        session.user.subscriptionStatus =
          (token.subscriptionStatus as string) ?? "free";
      }
      return session;
    },
  },
});

// ─── Type Augmentation ──────────────────────────────────────────────────────

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      onboardingCompleted: boolean;
      subscriptionStatus: string;
    };
  }

  interface User {
    onboardingCompleted?: boolean;
    subscriptionStatus?: string;
  }
}

