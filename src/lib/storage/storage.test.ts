import { describe, it, expect } from "vitest";
import { buildFitFileKey } from "./index";

describe("buildFitFileKey", () => {
  it("builds keys as userId/summaryId with the fit extension by default", () => {
    expect(buildFitFileKey("user-123", "summary-456")).toBe(
      "user-123/summary-456.fit",
    );
  });

  it("maps Garmin file types to extensions", () => {
    expect(buildFitFileKey("u1", "s1", "FIT")).toBe("u1/s1.fit");
    expect(buildFitFileKey("u1", "s1", "TCX")).toBe("u1/s1.tcx");
    expect(buildFitFileKey("u1", "s1", "GPX")).toBe("u1/s1.gpx");
  });

  it("is case-insensitive on file type and defaults unknown types to fit", () => {
    expect(buildFitFileKey("u1", "s1", "fit")).toBe("u1/s1.fit");
    expect(buildFitFileKey("u1", "s1", "WHATEVER")).toBe("u1/s1.fit");
  });

  it("namespaces files under the user id so per-user deletion is a prefix delete", () => {
    const key = buildFitFileKey("user-a", "x");
    expect(key.startsWith("user-a/")).toBe(true);
  });

  it("sanitizes path separators in webhook-provided segments", () => {
    expect(buildFitFileKey("u1", "a/b\\c")).toBe("u1/a_b_c.fit");
  });

  it("neutralizes path traversal attempts", () => {
    const key = buildFitFileKey("u1", "../../etc/passwd");
    expect(key).not.toContain("..");
    // Only one separator may survive: the userId/summaryId boundary
    expect(key.split("/")).toHaveLength(2);
    expect(key).toBe("u1/____etc_passwd.fit");
  });
});
