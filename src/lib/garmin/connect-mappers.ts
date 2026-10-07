/**
 * Pure mapping helpers for Garmin Connect (unofficial connectapi.garmin.com)
 * activity payloads → our DB columns.
 *
 * Kept free of DB/network imports so the unit conversions and defensive
 * parsing can be unit-tested as pure functions (see connect-mappers.test.ts).
 *
 * Field-name reality check (verified against garmin-connect/dist/garmin/types):
 * - The activity LIST payload (IActivity) uses
 *   `averageRunningCadenceInStepsPerMinute` / `maxRunningCadenceInStepsPerMinute`,
 *   `avgVerticalOscillation`, `avgGroundContactTime`, `avgVerticalRatio`,
 *   `avgStrideLength`, `activityTrainingLoad`, `vO2MaxValue`,
 *   `lactateThresholdBpm`, `lactateThresholdSpeed`.
 * - The activity DETAIL payload (IActivityDetails.summaryDTO) uses
 *   `averageRunCadence` / `maxRunCadence`, `verticalOscillation`,
 *   `groundContactTime`, `verticalRatio`, `strideLength`.
 * Both spellings are accepted here.
 *
 * Unit conventions (and the defensive conversions we apply):
 * - cadence            → steps/min (both feet) in both payloads; stored as-is
 * - vertical oscillation → Connect reports cm (~6–13); our column is mm.
 *   Values < 30 are treated as cm and ×10; values ≥ 30 are assumed to
 *   already be mm (defensive against payload variants).
 * - ground contact time → ms in both payloads; stored as-is
 * - vertical ratio     → percent; stored as-is
 * - stride length      → Connect reports cm (~60–250); our column is meters.
 *   Values > 10 are treated as cm and ÷100; values ≤ 10 are assumed meters.
 * - activityTrainingLoad → unitless Firstbeat load; stored as-is
 * - lactateThresholdBpm  → bpm (integer column)
 * - lactateThresholdSpeed → m/s; stored as-is
 */

// ─── Generic Defensive Parsers ──────────────────────────────────────────────

/** Parse to a finite number, or null (rejects NaN/Infinity/non-numeric). */
export function toFiniteNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/** Format for a Drizzle `numeric` column: finite number → string, else null. */
export function toNumericString(val: unknown): string | null {
  const n = toFiniteNumber(val);
  return n !== null ? String(n) : null;
}

/** Round to integer for `integer` columns, else null. */
export function toIntOrNull(val: unknown): number | null {
  const n = toFiniteNumber(val);
  return n !== null ? Math.round(n) : null;
}

// ─── Unit Conversions ───────────────────────────────────────────────────────

/**
 * Vertical oscillation → millimeters.
 * Connect summary payloads report cm (typical 6–13); FIT and some payload
 * variants use mm (typical 60–130). Values < 30 are assumed cm.
 */
export function verticalOscillationToMm(val: unknown): number | null {
  const n = toFiniteNumber(val);
  if (n === null || n <= 0) return null;
  return n < 30 ? n * 10 : n;
}

/**
 * Stride length → meters.
 * Connect summary payloads report cm (typical 60–250); some variants use
 * meters (typical 0.6–2.5). Values > 10 are assumed cm.
 */
export function strideLengthToMeters(val: unknown): number | null {
  const n = toFiniteNumber(val);
  if (n === null || n <= 0) return null;
  return n > 10 ? n / 100 : n;
}

// ─── Running Dynamics Extraction ────────────────────────────────────────────

/** Subset of activities columns populated from Connect summary dynamics. */
export interface ConnectRunningDynamics {
  avgRunCadence: string | null;
  maxRunCadence: string | null;
  activityTrainingLoad: string | null;
  avgGroundContactTimeMs: string | null;
  avgVerticalOscillationMm: string | null;
  avgVerticalRatioPct: string | null;
  avgStrideLengthM: string | null;
  lactateThresholdHeartRate: number | null;
  lactateThresholdPaceMps: string | null;
}

/**
 * Extract running dynamics / training load / lactate threshold from a raw
 * Connect activity payload. Every field is nullable; both the list-payload
 * and detail-payload spellings are accepted; garbage values map to null.
 */
export function extractRunningDynamics(
  raw: Record<string, unknown>,
): ConnectRunningDynamics {
  const cadence = toFiniteNumber(
    raw.averageRunningCadenceInStepsPerMinute ?? raw.averageRunCadence,
  );
  const maxCadence = toFiniteNumber(
    raw.maxRunningCadenceInStepsPerMinute ?? raw.maxRunCadence,
  );
  const gct = toFiniteNumber(raw.avgGroundContactTime ?? raw.groundContactTime);
  const vo = verticalOscillationToMm(
    raw.avgVerticalOscillation ?? raw.verticalOscillation,
  );
  const vRatio = toFiniteNumber(raw.avgVerticalRatio ?? raw.verticalRatio);
  const stride = strideLengthToMeters(raw.avgStrideLength ?? raw.strideLength);
  const ltSpeed = toFiniteNumber(raw.lactateThresholdSpeed);

  return {
    avgRunCadence: cadence !== null && cadence > 0 ? String(cadence) : null,
    maxRunCadence:
      maxCadence !== null && maxCadence > 0 ? String(maxCadence) : null,
    activityTrainingLoad: toNumericString(raw.activityTrainingLoad),
    avgGroundContactTimeMs: gct !== null && gct > 0 ? String(gct) : null,
    avgVerticalOscillationMm: vo !== null ? String(vo) : null,
    avgVerticalRatioPct: vRatio !== null && vRatio > 0 ? String(vRatio) : null,
    avgStrideLengthM: stride !== null ? String(stride) : null,
    lactateThresholdHeartRate: (() => {
      const bpm = toIntOrNull(raw.lactateThresholdBpm);
      return bpm !== null && bpm > 0 ? bpm : null;
    })(),
    lactateThresholdPaceMps:
      ltSpeed !== null && ltSpeed > 0 ? String(ltSpeed) : null,
  };
}

// ─── Splits → Laps Mapping ──────────────────────────────────────────────────

/** Lap insert values (everything except activityId / id). */
export interface ConnectLapValues {
  lapIndex: number;
  startTimeInSeconds: number | null;
  totalDistanceMeters: string | null;
  totalTimerTimeSeconds: string | null;
  avgSpeedMps: string | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgRunCadence: string | null;
  avgPaceSecondsPerKm: string | null;
  totalAscentMeters: string | null;
}

/**
 * Parse a Garmin Connect GMT timestamp ("2026-06-08 09:00:00.0" or ISO with
 * "T") into unix epoch seconds. The splits endpoint omits the timezone
 * designator, so a "Z" is appended when missing.
 */
export function parseGmtToEpochSeconds(val: unknown): number | null {
  if (typeof val !== "string" || val.length === 0) return null;
  let iso = val.replace(" ", "T");
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += "Z";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

/**
 * Map the unofficial splits endpoint response
 * (`/activity-service/activity/{id}/splits` → `{ lapDTOs: [...] }`) into
 * activity_laps insert values.
 *
 * Returns null when the payload shape is unexpected (caller logs once and
 * skips). lapIndex is the 0-based array position: Connect's own `lapIndex`
 * field is 1-based, and the FIT decode path (which later replaces these
 * rows) is 0-based — array position keeps the two consistent.
 */
export function mapSplitLaps(json: unknown): ConnectLapValues[] | null {
  if (json === null || typeof json !== "object") return null;
  const lapDTOs = (json as Record<string, unknown>).lapDTOs;
  if (!Array.isArray(lapDTOs)) return null;

  const laps: ConnectLapValues[] = [];
  for (let i = 0; i < lapDTOs.length; i++) {
    const lap = lapDTOs[i];
    if (lap === null || typeof lap !== "object") continue;
    const l = lap as Record<string, unknown>;

    const speed = toFiniteNumber(l.averageSpeed);
    const pace =
      speed !== null && speed > 0
        ? String(Math.round((1000 / speed) * 10) / 10)
        : null;

    laps.push({
      lapIndex: i,
      startTimeInSeconds: parseGmtToEpochSeconds(l.startTimeGMT),
      totalDistanceMeters: toNumericString(l.distance),
      // `duration` is the lap timer time; `elapsedDuration` includes pauses.
      totalTimerTimeSeconds: toNumericString(l.duration),
      avgSpeedMps: speed !== null && speed > 0 ? String(speed) : null,
      avgHeartRate: toIntOrNull(l.averageHR),
      maxHeartRate: toIntOrNull(l.maxHR),
      avgRunCadence: toNumericString(l.averageRunCadence),
      avgPaceSecondsPerKm: pace,
      totalAscentMeters: toNumericString(l.elevationGain),
    });
  }

  return laps;
}
