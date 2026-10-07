/**
 * FIT binary decoding — extracts lap splits, running dynamics, and lactate
 * threshold estimates from Garmin activity FIT files.
 *
 * Decoding uses the official @garmin/fitsdk (pure JS Decoder/Stream). The
 * extraction step (`extractFitMetrics`) is a pure function over the decoder's
 * message output so it can be unit-tested with mocked message objects.
 *
 * Defensive by design: every field is optional, missing/garbled messages
 * never throw, and both the fitsdk's camelCase keys (what the JS SDK actually
 * emits, e.g. `sessionMesgs` / `avgStanceTime`) and snake_case variants (other
 * FIT parsers / raw profile names, e.g. `avg_stance_time`) are accepted.
 *
 * Unit conventions (fitsdk applies scale/offset by default):
 * - avg_stance_time        → milliseconds (stored as ground contact time, ms)
 * - avg_vertical_oscillation → millimeters
 * - avg_vertical_ratio     → percent
 * - avg_step_length        → millimeters (converted here to meters)
 * - avg_speed / enhanced_avg_speed → meters/second
 * - total_distance         → meters
 * - total_timer_time       → seconds
 * - cadence fields         → strides/min for one foot in running activities;
 *                            doubled here to steps/min (both feet) to match
 *                            Garmin's summary-API avgRunCadence convention
 */

import { Decoder, Stream } from "@garmin/fitsdk";

// ─── Output Types ────────────────────────────────────────────────────────────

export interface FitLapMetrics {
  /** 0-based lap position within the activity */
  lapIndex: number;
  /** Lap start as unix epoch seconds */
  startTimeInSeconds?: number;
  totalDistanceMeters?: number;
  totalTimerTimeSeconds?: number;
  avgSpeedMps?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  /** Steps/min, both feet (FIT cadence × 2, incl. fractional cadence) */
  avgRunCadence?: number;
  /** Derived from avgSpeedMps: 1000 / speed (sec/km) */
  avgPaceSecondsPerKm?: number;
  totalAscentMeters?: number;
}

export interface FitRunningDynamics {
  /** Ground contact time in ms (FIT avg_stance_time) */
  avgGroundContactTimeMs?: number;
  /** Vertical oscillation in mm */
  avgVerticalOscillationMm?: number;
  /** Vertical ratio in % */
  avgVerticalRatioPct?: number;
  /** Stride length in meters (FIT avg_step_length mm → m) */
  avgStrideLengthM?: number;
}

export interface FitLactateThreshold {
  /** LT heart rate in bpm (session or zones_target threshold_heart_rate) */
  heartRateBpm?: number;
  /** LT pace in m/s (session lactate/threshold speed where present) */
  paceMps?: number;
}

export interface FitMetrics {
  laps: FitLapMetrics[];
  dynamics: FitRunningDynamics;
  lactateThreshold: FitLactateThreshold;
}

/**
 * Loose shape of the fitsdk Decoder.read() `messages` output. Kept
 * intentionally permissive — extraction must survive any input.
 */
export type DecodedFitMessages = Record<string, unknown>;

// ─── Field Access Helpers ────────────────────────────────────────────────────

/** Seconds between the unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
const FIT_EPOCH_OFFSET_SECONDS = 631065600;

function camelToSnake(key: string): string {
  return key.replace(/([A-Z])/g, "_$1").toLowerCase();
}

/**
 * Read a raw field value from a decoded message, accepting both the camelCase
 * name (fitsdk JS output) and its snake_case equivalent (raw profile name).
 */
function rawField(msg: Record<string, unknown>, camelKey: string): unknown {
  if (msg[camelKey] !== undefined) return msg[camelKey];
  return msg[camelToSnake(camelKey)];
}

/** Read a finite-number field; anything else → undefined. */
function numField(
  msg: Record<string, unknown>,
  camelKey: string,
): number | undefined {
  const value = rawField(msg, camelKey);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** First defined numeric field among several candidate names. */
function firstNumField(
  msg: Record<string, unknown>,
  camelKeys: string[],
): number | undefined {
  for (const key of camelKeys) {
    const value = numField(msg, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Read a timestamp field as unix epoch seconds. The fitsdk converts FIT
 * timestamps to `Date` by default; raw numbers are treated as FIT epoch
 * seconds (seconds since 1989-12-31) per the FIT protocol.
 */
function epochSecondsField(
  msg: Record<string, unknown>,
  camelKey: string,
): number | undefined {
  const value = rawField(msg, camelKey);
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value) + FIT_EPOCH_OFFSET_SECONDS;
  }
  return undefined;
}

/** Get a message array off the decoded output (camelCase or snake_case key). */
function messageArray(
  messages: DecodedFitMessages,
  camelKey: string,
): Record<string, unknown>[] {
  const value =
    messages[camelKey] ?? messages[camelToSnake(camelKey)] ?? undefined;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is Record<string, unknown> => typeof m === "object" && m !== null,
  );
}

// ─── Per-Message Extraction ──────────────────────────────────────────────────

/**
 * Running cadence in steps/min (both feet). FIT running cadence fields are
 * strides/min for a single foot, so the value (plus the fractional component
 * when present) is doubled to match Garmin's summary-API convention.
 */
function extractRunCadenceSpm(
  msg: Record<string, unknown>,
): number | undefined {
  const cadence = firstNumField(msg, ["avgRunningCadence", "avgCadence"]);
  if (cadence === undefined) return undefined;
  const fractional = numField(msg, "avgFractionalCadence") ?? 0;
  return (cadence + fractional) * 2;
}

function extractLap(
  msg: Record<string, unknown>,
  fallbackIndex: number,
): FitLapMetrics {
  // Prefer enhanced_avg_speed (32-bit, no 65 m/s cap) over avg_speed.
  const avgSpeedMps = firstNumField(msg, ["enhancedAvgSpeed", "avgSpeed"]);

  const lap: FitLapMetrics = {
    lapIndex: numField(msg, "messageIndex") ?? fallbackIndex,
    startTimeInSeconds: epochSecondsField(msg, "startTime"),
    totalDistanceMeters: numField(msg, "totalDistance"),
    totalTimerTimeSeconds: numField(msg, "totalTimerTime"),
    avgSpeedMps,
    avgHeartRate: numField(msg, "avgHeartRate"),
    maxHeartRate: numField(msg, "maxHeartRate"),
    avgRunCadence: extractRunCadenceSpm(msg),
    totalAscentMeters: numField(msg, "totalAscent"),
  };

  if (avgSpeedMps !== undefined && avgSpeedMps > 0) {
    lap.avgPaceSecondsPerKm = 1000 / avgSpeedMps;
  }

  return lap;
}

function extractDynamics(
  sessionMesgs: Record<string, unknown>[],
): FitRunningDynamics {
  const dynamics: FitRunningDynamics = {};

  // Session-message averages are preferred: they cover the full activity and
  // are computed on-device. First session message with a value wins.
  for (const session of sessionMesgs) {
    dynamics.avgGroundContactTimeMs ??= numField(session, "avgStanceTime");
    dynamics.avgVerticalOscillationMm ??= numField(
      session,
      "avgVerticalOscillation",
    );
    dynamics.avgVerticalRatioPct ??= numField(session, "avgVerticalRatio");
    // avg_step_length is in millimeters → meters
    const stepLengthMm = numField(session, "avgStepLength");
    if (dynamics.avgStrideLengthM === undefined && stepLengthMm !== undefined) {
      dynamics.avgStrideLengthM = stepLengthMm / 1000;
    }
  }

  return dynamics;
}

function extractLactateThreshold(
  sessionMesgs: Record<string, unknown>[],
  zonesTargetMesgs: Record<string, unknown>[],
): FitLactateThreshold {
  const lt: FitLactateThreshold = {};

  // Session-level LT fields (present on devices with LT auto-detection).
  for (const session of sessionMesgs) {
    lt.heartRateBpm ??= firstNumField(session, [
      "lactateThresholdHeartRate",
      "thresholdHeartRate",
    ]);
    lt.paceMps ??= firstNumField(session, [
      "lactateThresholdSpeed",
      "thresholdSpeed",
    ]);
  }

  // zones_target carries the configured/learned threshold HR.
  for (const zones of zonesTargetMesgs) {
    lt.heartRateBpm ??= numField(zones, "thresholdHeartRate");
  }

  return lt;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Pure extraction over decoded FIT messages. Never throws: missing messages
 * yield empty laps / empty dynamics objects.
 */
export function extractFitMetrics(messages: DecodedFitMessages): FitMetrics {
  const sessionMesgs = messageArray(messages, "sessionMesgs");
  const lapMesgs = messageArray(messages, "lapMesgs");
  const zonesTargetMesgs = messageArray(messages, "zonesTargetMesgs");

  return {
    laps: lapMesgs.map((msg, i) => extractLap(msg, i)),
    dynamics: extractDynamics(sessionMesgs),
    lactateThreshold: extractLactateThreshold(sessionMesgs, zonesTargetMesgs),
  };
}

/**
 * Decode a raw FIT binary and extract metrics.
 * Throws when the buffer is not a valid FIT file (callers treat decoding as
 * best-effort and must catch).
 */
export function decodeFitBuffer(bytes: Buffer | Uint8Array): FitMetrics {
  const stream = Stream.fromByteArray(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  );

  if (!Decoder.isFIT(stream)) {
    throw new Error("Buffer is not a FIT file");
  }

  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read();

  // Partial decodes still yield usable messages; only fail when nothing at
  // all could be read.
  if (errors.length > 0 && Object.keys(messages).length === 0) {
    throw new Error(`FIT decode failed: ${errors[0]?.message ?? "unknown"}`);
  }

  return extractFitMetrics(messages as DecodedFitMessages);
}
