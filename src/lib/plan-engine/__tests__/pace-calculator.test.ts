import { describe, it, expect } from "vitest";
import {
  filterEasyRuns,
  estimateVDOTFromRecentRuns,
  estimateVDOTFromEasyPace,
  blendGoalAndCurrentVdot,
  GOAL_VDOT_BLEND_THRESHOLD,
  type RunSample,
} from "@/lib/plan-engine/pace-calculator";

// ---------------------------------------------------------------------------
// filterEasyRuns
// ---------------------------------------------------------------------------

describe("filterEasyRuns", () => {
  it("returns an empty array for no runs", () => {
    expect(filterEasyRuns([])).toEqual([]);
  });

  it("excludes runs without a usable pace", () => {
    const runs: RunSample[] = [
      { avgPaceSecsPerKm: 0, avgHR: 130 },
      { avgPaceSecsPerKm: -1 },
    ];
    expect(filterEasyRuns(runs)).toEqual([]);
  });

  it("keeps HR-recorded runs at or below ~78% of estimated max (148 bpm)", () => {
    const runs: RunSample[] = [
      { avgPaceSecsPerKm: 360, avgHR: 140 }, // easy
      { avgPaceSecsPerKm: 350, avgHR: 148 }, // easy (boundary)
      { avgPaceSecsPerKm: 280, avgHR: 170 }, // workout
      { avgPaceSecsPerKm: 300, avgHR: 149 }, // just above threshold
    ];
    const easy = filterEasyRuns(runs);
    expect(easy.map((r) => r.avgPaceSecsPerKm)).toEqual([360, 350]);
  });

  it("falls back to median pace for runs without HR", () => {
    const runs: RunSample[] = [
      { avgPaceSecsPerKm: 240 }, // interval-ish, faster than median
      { avgPaceSecsPerKm: 300 }, // median run
      { avgPaceSecsPerKm: 360 }, // easy, slower than median
    ];
    const easy = filterEasyRuns(runs);
    // At-or-slower than median (300) qualifies
    expect(easy.map((r) => r.avgPaceSecsPerKm)).toEqual([300, 360]);
  });

  it("mixes HR-based and median-pace classification per run", () => {
    const runs: RunSample[] = [
      { avgPaceSecsPerKm: 250, avgHR: 175 }, // HR says workout
      { avgPaceSecsPerKm: 250, avgHR: 145 }, // HR says easy (e.g. downhill)
      { avgPaceSecsPerKm: 340 }, // no HR, slower than median (250) → easy
      { avgPaceSecsPerKm: 240 }, // no HR, faster than median → workout
    ];
    const easy = filterEasyRuns(runs);
    expect(easy).toEqual([
      { avgPaceSecsPerKm: 250, avgHR: 145 },
      { avgPaceSecsPerKm: 340 },
    ]);
  });

  it("treats avgHR of 0 as missing and uses the pace fallback", () => {
    const runs: RunSample[] = [
      { avgPaceSecsPerKm: 360, avgHR: 0 },
      { avgPaceSecsPerKm: 300, avgHR: 0 },
    ];
    // Median is 330 → only the 360 run is at-or-slower
    expect(filterEasyRuns(runs)).toEqual([{ avgPaceSecsPerKm: 360, avgHR: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// estimateVDOTFromRecentRuns
// ---------------------------------------------------------------------------

describe("estimateVDOTFromRecentRuns", () => {
  it("returns null when no run has a pace", () => {
    expect(estimateVDOTFromRecentRuns([])).toBeNull();
    expect(
      estimateVDOTFromRecentRuns([{ avgPaceSecsPerKm: 0, avgHR: 130 }]),
    ).toBeNull();
  });

  it("ignores workout paces so VDOT is not inflated", () => {
    const easyOnly: RunSample[] = [
      { avgPaceSecsPerKm: 380, avgHR: 138 },
      { avgPaceSecsPerKm: 372, avgHR: 142 },
    ];
    const withWorkouts: RunSample[] = [
      ...easyOnly,
      { avgPaceSecsPerKm: 270, avgHR: 172 }, // tempo
      { avgPaceSecsPerKm: 250, avgHR: 180 }, // intervals
    ];

    const honest = estimateVDOTFromRecentRuns(withWorkouts);
    expect(honest).toBe(estimateVDOTFromRecentRuns(easyOnly));

    // Sanity: naively averaging everything would inflate the estimate
    const naiveAvg =
      withWorkouts.reduce((s, r) => s + r.avgPaceSecsPerKm, 0) /
      withWorkouts.length;
    expect(estimateVDOTFromEasyPace(naiveAvg)).toBeGreaterThan(honest!);
  });

  it("falls back to averaging all paced runs when nothing qualifies as easy", () => {
    // All runs have high HR → none qualify as easy
    const runs: RunSample[] = [
      { avgPaceSecsPerKm: 280, avgHR: 175 },
      { avgPaceSecsPerKm: 300, avgHR: 168 },
    ];
    expect(estimateVDOTFromRecentRuns(runs)).toBe(
      estimateVDOTFromEasyPace(290),
    );
  });

  it("matches the easy-pace table lookup for a single easy run", () => {
    const runs: RunSample[] = [{ avgPaceSecsPerKm: 366, avgHR: 140 }];
    expect(estimateVDOTFromRecentRuns(runs)).toBe(
      estimateVDOTFromEasyPace(366),
    );
  });
});

// ---------------------------------------------------------------------------
// blendGoalAndCurrentVdot
// ---------------------------------------------------------------------------

describe("blendGoalAndCurrentVdot", () => {
  it("keeps the goal VDOT when current fitness is unknown", () => {
    expect(blendGoalAndCurrentVdot(50, null)).toEqual({
      vdot: 50,
      blended: false,
    });
  });

  it("keeps the goal VDOT when current fitness is close (within threshold)", () => {
    expect(blendGoalAndCurrentVdot(50, 47)).toEqual({
      vdot: 50,
      blended: false,
    });
    expect(blendGoalAndCurrentVdot(50, 50)).toEqual({
      vdot: 50,
      blended: false,
    });
  });

  it("keeps the goal VDOT when current fitness exceeds the goal", () => {
    expect(blendGoalAndCurrentVdot(45, 52)).toEqual({
      vdot: 45,
      blended: false,
    });
  });

  it("uses the midpoint when the goal is more than the threshold above current fitness", () => {
    expect(blendGoalAndCurrentVdot(54, 46)).toEqual({
      vdot: 50,
      blended: true,
    });
    // Just past the boundary
    expect(
      blendGoalAndCurrentVdot(50, 50 - GOAL_VDOT_BLEND_THRESHOLD - 1),
    ).toEqual({ vdot: 48, blended: true });
  });
});
