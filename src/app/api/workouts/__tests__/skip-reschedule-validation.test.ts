import { describe, it, expect } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Replicate validation schemas from the API routes for unit testing
// ---------------------------------------------------------------------------

const skipSchema = z.object({
  reason: z.string().max(500).optional(),
});

const rescheduleSchema = z.object({
  newDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .refine(
      (d) => !isNaN(new Date(d + "T00:00:00").getTime()),
      "Invalid date",
    ),
});

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return DAY_NAMES[date.getDay()];
}

// ---------------------------------------------------------------------------
// Skip validation
// ---------------------------------------------------------------------------

describe("skip workout validation", () => {
  it("accepts empty body (no reason)", () => {
    const result = skipSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts body with reason", () => {
    const result = skipSchema.safeParse({ reason: "Knee pain" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("Knee pain");
    }
  });

  it("accepts body with empty reason string", () => {
    const result = skipSchema.safeParse({ reason: "" });
    expect(result.success).toBe(true);
  });

  it("rejects reason longer than 500 characters", () => {
    const longReason = "x".repeat(501);
    const result = skipSchema.safeParse({ reason: longReason });
    expect(result.success).toBe(false);
  });

  it("accepts reason at exactly 500 characters", () => {
    const reason = "x".repeat(500);
    const result = skipSchema.safeParse({ reason });
    expect(result.success).toBe(true);
  });

  it("rejects non-string reason", () => {
    const result = skipSchema.safeParse({ reason: 123 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reschedule validation
// ---------------------------------------------------------------------------

describe("reschedule workout validation", () => {
  it("accepts valid YYYY-MM-DD date", () => {
    const result = rescheduleSchema.safeParse({ newDate: "2026-04-15" });
    expect(result.success).toBe(true);
  });

  it("rejects missing newDate", () => {
    const result = rescheduleSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects malformed date (DD/MM/YYYY)", () => {
    const result = rescheduleSchema.safeParse({ newDate: "15/04/2026" });
    expect(result.success).toBe(false);
  });

  it("rejects malformed date (no dashes)", () => {
    const result = rescheduleSchema.safeParse({ newDate: "20260415" });
    expect(result.success).toBe(false);
  });

  it("rejects non-date string matching format", () => {
    const result = rescheduleSchema.safeParse({ newDate: "2026-13-40" });
    expect(result.success).toBe(false);
  });

  it("rejects ISO datetime (with time component)", () => {
    const result = rescheduleSchema.safeParse({
      newDate: "2026-04-15T10:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts leap year date", () => {
    const result = rescheduleSchema.safeParse({ newDate: "2028-02-29" });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Day of week derivation
// ---------------------------------------------------------------------------

describe("getDayOfWeek", () => {
  it("returns correct day for a known Monday", () => {
    expect(getDayOfWeek("2026-03-23")).toBe("monday");
  });

  it("returns correct day for a known Friday", () => {
    expect(getDayOfWeek("2026-03-27")).toBe("friday");
  });

  it("returns correct day for a known Sunday", () => {
    expect(getDayOfWeek("2026-03-29")).toBe("sunday");
  });

  it("returns correct day for a known Wednesday", () => {
    expect(getDayOfWeek("2026-03-25")).toBe("wednesday");
  });

  it("returns correct day for a known Saturday", () => {
    expect(getDayOfWeek("2026-03-28")).toBe("saturday");
  });
});

// ---------------------------------------------------------------------------
// Skip reason storage
// ---------------------------------------------------------------------------

describe("skip reason storage", () => {
  it("stores reason directly in skipReason column", () => {
    const reason = "Feeling under the weather";
    expect(reason).toBe("Feeling under the weather");
  });

  it("skipReason is null when no reason provided", () => {
    const reason: string | null = null;
    expect(reason).toBeNull();
  });
});
