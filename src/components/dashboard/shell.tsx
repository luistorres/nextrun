"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import {
  useAdaptations,
  usePlanReviewOnVisit,
  useWorkoutDetail,
} from "@/lib/query/plan-hooks";
import { isPendingAdaptation } from "@/components/plan/adaptation-helpers";
import { GarminHeaderIndicator } from "@/components/garmin/header-indicator";
import { Wordmark } from "@/components/ui/wordmark";
import { ChatPanel } from "@/components/coach/chat-panel";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Today", icon: TodayIcon },
  { href: "/dashboard/plan", label: "Plan", icon: PlanIcon },
  { href: "/dashboard/metrics", label: "Trends", icon: TrendsIcon },
  { href: "/dashboard/settings", label: "Profile", icon: ProfileIcon },
];

function getPageTitle(pathname: string, workoutTitle?: string | null): string {
  const TITLES: Record<string, string> = {
    "/dashboard": "Today",
    "/dashboard/plan": "Plan",
    "/dashboard/metrics": "Trends",
    "/dashboard/adaptations": "Plan changes",
    "/dashboard/settings": "Profile",
  };
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/dashboard/plan/workout/")) {
    return workoutTitle ?? "Workout";
  }
  const last = pathname.split("/").filter(Boolean).pop() ?? "";
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(last) || /^\d+$/.test(last)) {
    return "Dashboard";
  }
  return (
    last.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
    "Dashboard"
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();
  const { data: adaptationsData } = useAdaptations();
  usePlanReviewOnVisit();
  const hasPendingAdaptations = (adaptationsData?.adaptations ?? []).some(
    isPendingAdaptation,
  );

  const workoutId = pathname.match(/^\/dashboard\/plan\/workout\/([^/]+)/)?.[1];
  const { data: workoutDetail } = useWorkoutDetail(workoutId);
  const workoutTitle = workoutDetail?.workout?.title ?? null;

  const handleEscapeKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && chatOpen) setChatOpen(false);
    },
    [chatOpen],
  );

  useEffect(() => {
    if (chatOpen) {
      document.addEventListener("keydown", handleEscapeKey);
      return () => document.removeEventListener("keydown", handleEscapeKey);
    }
  }, [chatOpen, handleEscapeKey]);

  return (
    <div className="paper-tooth flex h-screen bg-paper">
      {/* Desktop spine: the logbook's buckram cover */}
      <aside
        className="buckram hidden w-56 flex-col lg:flex"
        aria-label="Navigation"
      >
        <div
          className="border-b px-6 py-5"
          style={{ borderColor: "rgba(230,238,232,0.15)" }}
        >
          <Link href="/dashboard" className="block">
            <Wordmark tone="cloth" className="text-lg" />
          </Link>
        </div>

        <nav className="flex-1 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative my-0.5 ml-3 flex items-center gap-3 rounded-l-md py-2 pl-3 pr-4 text-sm font-medium transition-colors duration-150"
                style={
                  isActive
                    ? { background: "var(--paper)", color: "var(--ink)" }
                    : { color: "var(--cloth-text-dim)" }
                }
                onMouseEnter={(e) => {
                  if (!isActive)
                    e.currentTarget.style.color = "var(--cloth-text)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    e.currentTarget.style.color = "var(--cloth-text-dim)";
                }}
              >
                <item.icon className="h-[18px] w-[18px]" />
                {item.label}
                {item.href === "/dashboard" && hasPendingAdaptations && (
                  <>
                    <span
                      aria-hidden="true"
                      className="ml-auto h-1.5 w-1.5 rounded-full bg-pencil-red"
                    />
                    <span className="sr-only">Pending plan changes</span>
                  </>
                )}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="relative my-0.5 ml-3 flex w-[calc(100%-0.75rem)] items-center gap-3 rounded-l-md py-2 pl-3 pr-4 text-sm font-medium transition-colors duration-150"
            style={{ color: "var(--cloth-text-dim)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--cloth-text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--cloth-text-dim)";
            }}
          >
            <CoachIcon className="h-[18px] w-[18px]" />
            Coach
          </button>
        </nav>

        <div
          className="border-t px-6 py-4"
          style={{ borderColor: "rgba(230,238,232,0.15)" }}
        >
          <p
            className="truncate text-sm font-medium"
            style={{ color: "var(--cloth-text)" }}
          >
            {session?.user?.email ?? "Runner"}
          </p>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-rule bg-paper px-4 lg:px-8">
          <Wordmark className="text-sm lg:hidden" />
          <p className="hidden text-sm font-medium text-ink-soft lg:block">
            {getPageTitle(pathname, workoutTitle)}
          </p>
          <GarminHeaderIndicator />
        </header>

        <main className="flex-1 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:p-8 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-rule bg-paper-raised pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Navigation"
      >
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium ${
                isActive ? "text-pencil-red" : "text-ink-soft"
              }`}
            >
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {item.href === "/dashboard" && hasPendingAdaptations && (
                  <>
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-pencil-red"
                    />
                    <span className="sr-only">Pending plan changes</span>
                  </>
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium ${
            chatOpen ? "text-pencil-red" : "text-ink-soft"
          }`}
          aria-label="Open coach chat"
        >
          <CoachIcon className="h-5 w-5" />
          Coach
        </button>
      </nav>

      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}

function TodayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
    >
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9h16M8 3v4M16 3v4" strokeLinecap="round" />
      <circle cx="12" cy="15" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PlanIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        d="M5 4h14v17H5z M8 4v17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11 9h5M11 13h5M11 17h3" strokeLinecap="round" />
    </svg>
  );
}

function TrendsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M4 19h16" strokeLinecap="round" />
      <path
        d="M4 15l4.5-5 3.5 3 6-7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProfileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c1.4-3.2 4-4.8 7-4.8s5.6 1.6 7 4.8" strokeLinecap="round" />
    </svg>
  );
}

function CoachIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        d="M4 6.5C4 5.1 5.1 4 6.5 4h11C18.9 4 20 5.1 20 6.5v7c0 1.4-1.1 2.5-2.5 2.5H10l-4.5 4v-4h-1C4.1 16 4 14.9 4 13.5v-7Z"
        strokeLinejoin="round"
      />
      <path d="M8.5 9.5h7M8.5 12.5h4" strokeLinecap="round" />
    </svg>
  );
}
