/**
 * Pace conversion utilities for running workouts.
 *
 * Internal representation: seconds per kilometer (sec/km)
 * Display format: "mm:ss" per kilometer
 * Garmin API format: may use seconds per meter (verify with actual API docs)
 */

/** Convert seconds/km to display string "mm:ss/km" */
export function secPerKmToDisplay(secPerKm: number): string {
  const minutes = Math.floor(secPerKm / 60);
  const seconds = Math.round(secPerKm % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Format a decimal-minutes pace (e.g. 5.33 min/km, the planned_workouts
 * `target_pace_min_per_km` storage format) as "m:ss" — 5.33 → "5:20".
 */
export function decimalMinPerKmToDisplay(pace: number | string): string {
  const minutes = typeof pace === "string" ? parseFloat(pace) : pace;
  if (!Number.isFinite(minutes) || minutes <= 0) return "--";
  return secPerKmToDisplay(Math.round(minutes * 60));
}

/** Parse "mm:ss" pace string to seconds/km */
export function displayToSecPerKm(pace: string): number {
  const [min, sec] = pace.split(":").map(Number);
  return min * 60 + sec;
}

/** Convert m/s (speed) to sec/km (pace) */
export function mpsToSecPerKm(mps: number): number {
  if (mps <= 0) return 0;
  return 1000 / mps;
}

/** Convert sec/km (pace) to m/s (speed) */
export function secPerKmToMps(secPerKm: number): number {
  if (secPerKm <= 0) return 0;
  return 1000 / secPerKm;
}

/** Convert sec/km to sec/m (for Garmin API, if needed) */
export function secPerKmToSecPerM(secPerKm: number): number {
  return secPerKm / 1000;
}

/** Convert sec/m to sec/km */
export function secPerMToSecPerKm(secPerM: number): number {
  return secPerM * 1000;
}

/** Convert km/h to sec/km */
export function kmhToSecPerKm(kmh: number): number {
  if (kmh <= 0) return 0;
  return 3600 / kmh;
}

/** Format distance in meters to a readable string */
export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    // Omit decimal for whole numbers (5km not 5.0km)
    return `${km % 1 === 0 ? Math.round(km) : km.toFixed(1)}km`;
  }
  return `${Math.round(meters)}m`;
}

/** Format duration in seconds to "HH:MM:SS" or "MM:SS" */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
