"use client";

import { SessionProvider } from "next-auth/react";
import { QueryProvider } from "@/lib/query/provider";

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  );
}
