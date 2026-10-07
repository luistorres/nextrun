import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: () => Promise.resolve({ user: { id: "u1" } }),
}));

const limit = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit }),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({ userGoals: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), desc: vi.fn() }));

const getJob = vi.fn();
vi.mock("@/lib/queue/queues", () => ({
  planGenerationQueue: { getJob: (...a: unknown[]) => getJob(...a) },
}));

import { GET } from "../route";

const request = new Request("http://test/api/plan/generate/status");

describe("GET /api/plan/generate/status", () => {
  beforeEach(() => {
    limit.mockReset();
    getJob.mockReset();
  });

  it("returns not_found when the user has no goals", async () => {
    limit.mockResolvedValue([]);
    const res = await GET(request);
    expect(await res.json()).toEqual({ status: "not_found" });
    expect(getJob).not.toHaveBeenCalled();
  });

  it("returns queued when the queue lookup throws", async () => {
    limit.mockResolvedValue([{ id: "g1" }]);
    getJob.mockRejectedValue(new Error("redis down"));
    const res = await GET(request);
    expect(await res.json()).toEqual({ status: "queued" });
  });

  it("returns failed with the failure reason", async () => {
    limit.mockResolvedValue([{ id: "g1" }]);
    getJob.mockResolvedValue({
      getState: () => Promise.resolve("failed"),
      failedReason: "boom",
    });
    const res = await GET(request);
    expect(await res.json()).toEqual({ status: "failed", error: "boom" });
    expect(getJob).toHaveBeenCalledWith("plan-gen-u1-g1");
  });
});
