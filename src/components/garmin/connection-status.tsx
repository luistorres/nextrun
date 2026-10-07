"use client";

import { useState, useEffect, useCallback } from "react";
import { GarminConnectButton } from "./connect-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardContent } from "@/components/ui/card";

interface SyncStatus {
  connected: boolean;
  garminUserId: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  backfillStatus: string | null;
  backfillRequestedAt: string | null;
  backfillCompletedAt: string | null;
}

interface SyncResult {
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

export function GarminConnectionStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedDays, setSelectedDays] = useState(7);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/garmin/sync-status");
      if (!response.ok) {
        throw new Error("Failed to fetch sync status");
      }
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

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const handleDisconnect = async () => {
    if (isDisconnecting) return;

    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/garmin/disconnect", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect");
      }

      await fetchStatus();
      setSyncResult(null);
    } catch {
      setError("Failed to disconnect. Please try again.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSync = async (days: number = 7) => {
    if (isSyncing) return;

    setSelectedDays(days);
    setIsSyncing(true);
    setSyncResult(null);

    try {
      const response = await fetch(`/api/garmin/sync?days=${days}`, {
        method: "POST",
      });

      const data = (await response.json()) as SyncResult;
      setSyncResult(data);

      if (response.ok) {
        await fetchStatus();
      }
    } catch {
      setSyncResult({
        success: false,
        error: "Network error. Please try again.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <div className="skeleton h-4 w-36" />
          <div className="skeleton h-3 w-52" />
        </CardContent>
      </Card>
    );
  }

  if (error && !status) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="rounded-md bg-red-soft px-3 py-2">
            <p className="text-sm text-pencil-red-deep">{error}</p>
            <button
              type="button"
              onClick={fetchStatus}
              className="mt-1 text-sm font-medium text-pencil-red-deep underline"
            >
              Retry
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status?.connected) {
    return (
      <Card>
        <CardContent className="py-6">
          <h3 className="text-base font-semibold text-ink">
            Garmin connection
          </h3>
          <p className="mb-4 mt-1 text-sm text-ink-soft">
            Connect your Garmin to sync activities, sleep, HRV, and stress
            data.
          </p>

          <GarminConnectButton isConnected={false} onConnected={fetchStatus} />

          {error && (
            <p className="mt-3 text-sm text-pencil-red-deep">{error}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const totalImported = syncResult?.imported
    ? syncResult.imported.activities +
      syncResult.imported.dailySummaries +
      syncResult.imported.sleep +
      syncResult.imported.hrv +
      syncResult.imported.stress
    : 0;

  return (
    <Card>
      <CardContent className="py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-sage" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-ink">Connected</h3>
              <p className="truncate text-xs text-ink-soft">
                {status.garminUserId}
                {status.lastSyncAt && (
                  <span>
                    {" "}
                    &middot; last synced {formatRelativeTime(status.lastSyncAt)}
                  </span>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowDisconnectConfirm(true)}
            disabled={isDisconnecting}
            className="shrink-0 text-xs font-medium text-pencil-red-deep transition-colors duration-150 hover:underline disabled:opacity-50"
          >
            {isDisconnecting ? "Disconnecting…" : "Disconnect"}
          </button>

          <ConfirmDialog
            open={showDisconnectConfirm}
            onOpenChange={setShowDisconnectConfirm}
            title="Disconnect Garmin?"
            description="Synced data is kept, but new data stops syncing until you reconnect."
            confirmLabel="Disconnect"
            cancelLabel="Keep connected"
            variant="destructive"
            onConfirm={handleDisconnect}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
          <span className="mr-1 text-xs text-ink-faint">Pull data</span>
          <SyncButton
            label="7 days"
            loading={isSyncing}
            onClick={() => handleSync(7)}
            selected={selectedDays === 7}
          />
          <SyncButton
            label="30 days"
            loading={isSyncing}
            onClick={() => handleSync(30)}
            selected={selectedDays === 30}
          />
          <SyncButton
            label="90 days"
            loading={isSyncing}
            onClick={() => handleSync(90)}
            selected={selectedDays === 90}
          />

          {isSyncing && (
            <span className="ml-1 text-xs text-ink-soft">Syncing&hellip;</span>
          )}
        </div>

        {syncResult && (
          <div className="mt-3">
            {syncResult.success && syncResult.imported ? (
              <div className="rounded-md bg-sage-soft px-3 py-2">
                <p className="text-xs font-medium text-sage">
                  {totalImported} records synced
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {[
                    syncResult.imported.activities > 0 &&
                      `${syncResult.imported.activities} activities`,
                    syncResult.imported.dailySummaries > 0 &&
                      `${syncResult.imported.dailySummaries} daily`,
                    syncResult.imported.sleep > 0 &&
                      `${syncResult.imported.sleep} sleep`,
                    syncResult.imported.hrv > 0 &&
                      `${syncResult.imported.hrv} HRV`,
                    syncResult.imported.stress > 0 &&
                      `${syncResult.imported.stress} stress`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {syncResult.errors && syncResult.errors.length > 0 && (
                    <span className="text-amber-pencil">
                      {" "}
                      ({syncResult.errors.length} warnings)
                    </span>
                  )}
                </p>
              </div>
            ) : (
              <div className="rounded-md bg-red-soft px-3 py-2">
                <p className="text-sm text-pencil-red-deep">
                  {syncResult.error || "Sync failed. Try again."}
                </p>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-pencil-red-deep">{error}</p>}
      </CardContent>
    </Card>
  );
}

function SyncButton({
  label,
  loading,
  onClick,
  selected,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={`rounded border px-2.5 py-1 text-xs transition-colors duration-150 disabled:opacity-50 ${
        selected
          ? "border-rule-strong bg-paper-shade font-medium text-ink"
          : "border-rule bg-paper-raised font-medium text-ink-soft hover:bg-paper-shade"
      }`}
    >
      {label}
    </button>
  );
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatRelativeTime(isoString: string): string {
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
  return formatDate(isoString);
}
