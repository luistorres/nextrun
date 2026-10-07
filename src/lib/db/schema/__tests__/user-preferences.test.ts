import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { userPreferences } from "../auth";

describe("userPreferences schema", () => {
  const columns = getTableColumns(userPreferences);

  it("has all required columns", () => {
    const columnNames = Object.keys(columns);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("userId");
    expect(columnNames).toContain("units");
    expect(columnNames).toContain("paceDisplay");
    expect(columnNames).toContain("weekStartDay");
    expect(columnNames).toContain("theme");
    expect(columnNames).toContain("emailNotifications");
    expect(columnNames).toContain("createdAt");
    expect(columnNames).toContain("updatedAt");
  });

  it("has correct default values", () => {
    expect(columns.units.default).toBe("metric");
    expect(columns.paceDisplay.default).toBe("min_km");
    expect(columns.weekStartDay.default).toBe("monday");
    expect(columns.theme.default).toBe("dark");
    expect(columns.emailNotifications.default).toBe(true);
  });

  it("userId column is not nullable", () => {
    expect(columns.userId.notNull).toBe(true);
  });

  it("units column is not nullable", () => {
    expect(columns.units.notNull).toBe(true);
  });
});
