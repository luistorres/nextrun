"use client";

import { useSession as useNextAuthSession } from "next-auth/react";

/**
 * Wrapper around next-auth's useSession hook.
 *
 * Provides typed access to the user session including custom fields
 * (onboardingCompleted, subscriptionStatus).
 *
 * Must be used within a SessionProvider.
 */
export function useSession() {
  const session = useNextAuthSession();
  return session;
}
