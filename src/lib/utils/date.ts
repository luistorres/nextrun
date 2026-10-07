import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  differenceInWeeks,
  differenceInDays,
  parseISO,
  isValid,
} from "date-fns";

/** Format a Date to ISO date string (YYYY-MM-DD) */
export function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Format a Date to display string (e.g., "Mon, Jan 15") */
export function toDisplayDate(date: Date): string {
  return format(date, "EEE, MMM d");
}

/** Get Monday-based start of week */
export function getWeekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

/** Get Sunday-based end of week */
export function getWeekEnd(date: Date): Date {
  return endOfWeek(date, { weekStartsOn: 1 });
}

/** Get all dates in a week starting from Monday */
export function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Calculate weeks between two dates */
export function weeksBetween(start: Date, end: Date): number {
  return differenceInWeeks(end, start);
}

/** Calculate days between two dates */
export function daysBetween(start: Date, end: Date): number {
  return differenceInDays(end, start);
}

/** Parse ISO date string safely */
export function safeParse(dateStr: string): Date | null {
  const parsed = parseISO(dateStr);
  return isValid(parsed) ? parsed : null;
}

/** Get day of week name (lowercase) from a Date */
export function getDayName(
  date: Date
): "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  return days[date.getDay()] as
    | "mon"
    | "tue"
    | "wed"
    | "thu"
    | "fri"
    | "sat"
    | "sun";
}
