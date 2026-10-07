import { describe, it, expect } from "vitest";
import {
  aggregateLinkedActivities,
  type LinkedActivity,
} from "../aggregate-linked-activities";

describe("aggregateLinkedActivities", () => {
  it("returns zeros for an empty array", () => {
    const result = aggregateLinkedActivities([]);
    expect(result).toEqual({
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      activityCount: 0,
    });
  });

  it("returns the single activity's metrics unchanged", () => {
    const activities: LinkedActivity[] = [
      { distanceMeters: "3500", durationSeconds: 1200 },
    ];
    const result = aggregateLinkedActivities(activities);
    expect(result).toEqual({
      totalDistanceMeters: 3500,
      totalDurationSeconds: 1200,
      activityCount: 1,
    });
  });

  it("sums distance and duration across multiple activities", () => {
    const activities: LinkedActivity[] = [
      { distanceMeters: "3500", durationSeconds: 1200 },
      { distanceMeters: "3000", durationSeconds: 1000 },
    ];
    const result = aggregateLinkedActivities(activities);
    expect(result).toEqual({
      totalDistanceMeters: 6500,
      totalDurationSeconds: 2200,
      activityCount: 2,
    });
  });

  it("treats null distance as 0", () => {
    const activities: LinkedActivity[] = [
      { distanceMeters: null, durationSeconds: 900 },
      { distanceMeters: "5000", durationSeconds: 1800 },
    ];
    const result = aggregateLinkedActivities(activities);
    expect(result).toEqual({
      totalDistanceMeters: 5000,
      totalDurationSeconds: 2700,
      activityCount: 2,
    });
  });

  it("handles numeric distanceMeters (not just strings)", () => {
    const activities: LinkedActivity[] = [
      { distanceMeters: 2500, durationSeconds: 800 },
      { distanceMeters: 1500, durationSeconds: 600 },
    ];
    const result = aggregateLinkedActivities(activities);
    expect(result).toEqual({
      totalDistanceMeters: 4000,
      totalDurationSeconds: 1400,
      activityCount: 2,
    });
  });
});
