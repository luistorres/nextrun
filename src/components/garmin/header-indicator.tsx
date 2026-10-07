"use client";

import { useState, useRef, useEffect } from "react";
import { useGarminStatus, formatRelativeTime } from "@/hooks/use-garmin-status";
import { GarminConnectButton } from "./connect-button";

export function GarminHeaderIndicator() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const garmin = useGarminStatus();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const { syncResult, clearSyncResult } = garmin;
  useEffect(() => {
    if (!syncResult) return;
    const timer = setTimeout(() => clearSyncResult(), 8000);
    return () => clearTimeout(timer);
  }, [syncResult, clearSyncResult]);

  const dotClass = garmin.isLoading
    ? "bg-ink-faint"
    : garmin.error && !garmin.status
      ? "bg-pencil-red"
      : garmin.status?.connected
        ? "bg-sage"
        : "bg-ink-faint";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium text-ink-soft transition-colors duration-150 hover:bg-paper-shade"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          {garmin.isSyncing && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sage opacity-50" />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dotClass}`} />
        </span>

        <span className="hidden sm:inline">
          {garmin.isLoading
            ? "Garmin"
            : garmin.status?.connected
              ? "Connected"
              : "Connect Garmin"}
        </span>

        {garmin.status?.connected && garmin.status.lastSyncAt && (
          <span className="hidden text-ink-faint lg:inline">
            &middot; {formatRelativeTime(garmin.status.lastSyncAt)}
          </span>
        )}

        <svg
          className="h-3 w-3 transition-transform duration-150"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-md border border-rule bg-paper-raised p-4 shadow-[0_1px_4px_rgba(38,36,31,0.06)] max-sm:fixed max-sm:left-4 max-sm:right-4 max-sm:top-16 max-sm:w-auto">
          {garmin.isLoading && <LoadingState />}

          {garmin.error && !garmin.status && (
            <ErrorState error={garmin.error} onRetry={garmin.refetch} />
          )}

          {!garmin.isLoading && garmin.status?.connected && (
            <ConnectedPanel garmin={garmin} onClose={() => setOpen(false)} />
          )}

          {!garmin.isLoading && !garmin.status?.connected && !garmin.error && (
            <DisconnectedPanel
              onConnected={() => {
                garmin.refetch();
                setOpen(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton h-3 w-36" />
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-md bg-red-soft px-3 py-2">
      <p className="text-sm text-pencil-red-deep">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 text-sm font-medium text-pencil-red-deep underline"
      >
        Retry
      </button>
    </div>
  );
}

function ConnectedPanel({
  garmin,
  onClose,
}: {
  garmin: ReturnType<typeof useGarminStatus>;
  onClose: () => void;
}) {
  const totalImported = garmin.syncResult?.imported
    ? garmin.syncResult.imported.activities +
      garmin.syncResult.imported.dailySummaries +
      garmin.syncResult.imported.sleep +
      garmin.syncResult.imported.hrv +
      garmin.syncResult.imported.stress
    : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-sage" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Connected</p>
          <p className="truncate text-xs text-ink-soft">
            {/* Garmin's displayName is an opaque GUID for most accounts — noise, not identity */}
            {[
              garmin.status?.garminUserId &&
              !/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(garmin.status.garminUserId)
                ? garmin.status.garminUserId
                : null,
              garmin.status?.lastSyncAt
                ? `synced ${formatRelativeTime(garmin.status.lastSyncAt)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-rule pt-3">
        <span className="mr-0.5 text-xs text-ink-faint">Sync</span>
        <SyncButton
          label="7 days"
          loading={garmin.isSyncing}
          onClick={() => garmin.handleSync(7)}
        />
        <SyncButton
          label="30 days"
          loading={garmin.isSyncing}
          onClick={() => garmin.handleSync(30)}
        />
        <SyncButton
          label="90 days"
          loading={garmin.isSyncing}
          onClick={() => garmin.handleSync(90)}
        />

        {garmin.isSyncing && (
          <span className="ml-1 text-xs text-ink-soft">Syncing&hellip;</span>
        )}
      </div>

      {garmin.syncResult && (
        <div>
          {garmin.syncResult.success && garmin.syncResult.imported ? (
            <div className="rounded-md bg-sage-soft px-3 py-2">
              <p className="text-xs font-medium text-sage">
                {totalImported} records synced
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">
                {[
                  garmin.syncResult.imported.activities > 0 &&
                    `${garmin.syncResult.imported.activities} activities`,
                  garmin.syncResult.imported.sleep > 0 &&
                    `${garmin.syncResult.imported.sleep} sleep`,
                  garmin.syncResult.imported.hrv > 0 &&
                    `${garmin.syncResult.imported.hrv} HRV`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ) : (
            <div className="rounded-md bg-red-soft px-3 py-2">
              <p className="text-xs text-pencil-red-deep">
                {garmin.syncResult.error || "Sync failed. Try again."}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-rule pt-2">
        <button
          type="button"
          onClick={() => {
            garmin.handleDisconnect();
            onClose();
          }}
          disabled={garmin.isDisconnecting}
          className="text-xs font-medium text-pencil-red-deep transition-colors duration-150 hover:underline disabled:opacity-50"
        >
          {garmin.isDisconnecting ? "Disconnecting…" : "Disconnect Garmin"}
        </button>
      </div>
    </div>
  );
}

function DisconnectedPanel({ onConnected }: { onConnected: () => void }) {
  return (
    <div>
      <p className="mb-3 text-xs text-ink-soft">
        Connect your Garmin to sync activities, sleep, HRV, and stress data.
      </p>
      <GarminConnectButton isConnected={false} onConnected={onConnected} />
    </div>
  );
}

function SyncButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className="rounded border border-rule-strong bg-paper-raised px-2 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:bg-paper-shade disabled:opacity-50"
    >
      {label}
    </button>
  );
}
