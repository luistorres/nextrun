import { describe, it, expect } from "vitest";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Replicate the validation schemas from the API routes for unit testing.
// These must stay in sync with the route files.
// ---------------------------------------------------------------------------

const preferencesSchema = z.object({
  units: z.enum(["metric", "imperial"]).optional(),
  paceDisplay: z.enum(["min_km", "min_mi"]).optional(),
  weekStartDay: z.enum(["monday", "sunday"]).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
  emailNotifications: z.boolean().optional(),
});

const profileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
});

// ---------------------------------------------------------------------------
// Preferences validation
// ---------------------------------------------------------------------------

describe("preferences validation", () => {
  it("accepts valid partial updates", () => {
    const result = preferencesSchema.safeParse({ units: "imperial" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (no changes)", () => {
    const result = preferencesSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts all fields at once", () => {
    const result = preferencesSchema.safeParse({
      units: "metric",
      paceDisplay: "min_km",
      weekStartDay: "monday",
      theme: "dark",
      emailNotifications: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid units value", () => {
    const result = preferencesSchema.safeParse({ units: "nautical" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid pace display value", () => {
    const result = preferencesSchema.safeParse({ paceDisplay: "sec_km" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid theme value", () => {
    const result = preferencesSchema.safeParse({ theme: "neon" });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean emailNotifications", () => {
    const result = preferencesSchema.safeParse({ emailNotifications: "yes" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid week start day", () => {
    const result = preferencesSchema.safeParse({ weekStartDay: "friday" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Profile validation
// ---------------------------------------------------------------------------

describe("profile validation", () => {
  it("accepts a valid name", () => {
    const result = profileSchema.safeParse({ name: "Alice" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = profileSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 characters", () => {
    const result = profileSchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts name at 100 characters", () => {
    const result = profileSchema.safeParse({ name: "a".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("rejects missing name field", () => {
    const result = profileSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
