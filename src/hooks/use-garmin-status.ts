"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncStatus {
  connected: boolean;
  garminUserId: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  backfillStatus: string | null;
  backfillRequestedAt: string | null;
  backfillCompletedAt: string | null;
}

export interface SyncResult {
  success: boolean;
  imported?: {
    activities: number;
    dailySummaries: number;
    sleep: number;
    hrv: number;
    stress: number;
  };
  errors?: string[];
  message?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGarminStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/garmin/sync-status");
      if (!response.ok) throw new Error("Failed to fetch sync status");
      const data = (await response.json()) as SyncStatus;
      setStatus(data);
      setError(null);
    } catch {
      setError("Failed to load connection status");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleDisconnect = useCallback(async () => {
    if (isDisconnecting) return;

    const confirmed = window.confirm(
      "Are you sure you want to disconnect your Garmin account?"
    );
    if (!confirmed) return;

    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/garmin/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("Failed to disconnect");
      await fetchStatus();
      setSyncResult(null);
    } catch {
      setError("Failed to disconnect. Please try again.");
    } finally {
      setIsDisconnecting(false);
    }
  }, [isDisconnecting, fetchStatus]);

  const handleSync = useCallback(
    async (days: number = 7) => {
      if (isSyncing) return;

      setIsSyncing(true);
      setSyncResult(null);

      try {
        const response = await fetch(`/api/garmin/sync?days=${days}`, {
          method: "POST",
        });
        const data = (await response.json()) as SyncResult;
        setSyncResult(data);
        if (response.ok) await fetchStatus();
      } catch {
        setSyncResult({
          success: false,
          error: "Network error. Please try again.",
        });
      } finally {
        setIsSyncing(false);
      }
    },
    [isSyncing, fetchStatus]
  );

  const clearSyncResult = useCallback(() => setSyncResult(null), []);

  return {
    status,
    isLoading,
    error,
    isSyncing,
    isDisconnecting,
    syncResult,
    clearSyncResult,
    handleSync,
    handleDisconnect,
    refetch: fetchStatus,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
