/**
 * Original-file (FIT) download via the unofficial Garmin Connect API.
 *
 * `/download-service/files/activity/{activityId}` returns a ZIP archive
 * containing the original upload (usually `{uploadId}.fit`). The archive is
 * unzipped in memory with fflate — no temp files (the garmin-connect
 * package's own downloadOriginalActivityData writes to disk, which we avoid).
 *
 * Unlike the official activity-files ping path there is no 24h callback
 * window: the download URL is permanent, so retry semantics are simple
 * (standard queue retries, no ledger required).
 */

import type { GarminConnect } from "garmin-connect";
import { unzipSync } from "fflate";

const CONNECT_API_BASE = "https://connectapi.garmin.com";

// ─── ZIP Extraction (pure, unit-tested) ─────────────────────────────────────

/**
 * Extract the first `.fit` entry from a ZIP archive held in memory.
 * Returns null when the bytes are not a valid ZIP or no FIT entry exists
 * (e.g. manually created activities have no original file).
 */
export function extractFitFromZip(zipBytes: Uint8Array): Buffer | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    return null;
  }

  const fitName = Object.keys(entries)
    .sort()
    .find((name) => name.toLowerCase().endsWith(".fit"));
  if (!fitName) return null;

  const bytes = entries[fitName];
  return bytes.length > 0 ? Buffer.from(bytes) : null;
}

// ─── Download ───────────────────────────────────────────────────────────────

/**
 * Download the original FIT file for an activity via the unofficial client.
 *
 * Returns null when the activity has no original FIT file (not retryable);
 * throws on HTTP/network errors (retryable — the caller's queue retries).
 */
export async function downloadOriginalFitViaConnect(
  client: GarminConnect,
  garminActivityId: string,
): Promise<Buffer | null> {
  // GarminConnect.get forwards the second argument as the axios request
  // config (same call shape the package's own zip download uses).
  const raw = await client.get<ArrayBuffer | Buffer>(
    `${CONNECT_API_BASE}/download-service/files/activity/${garminActivityId}`,
    { responseType: "arraybuffer" },
  );

  if (!raw) return null;
  const zipBytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  return extractFitFromZip(zipBytes);
}
