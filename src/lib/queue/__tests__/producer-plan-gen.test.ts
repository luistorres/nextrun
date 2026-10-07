import { describe, it, expect, vi, beforeEach } from "vitest";

const getJob = vi.fn();
const remove = vi.fn();
const add = vi.fn().mockResolvedValue({ id: "job" });

vi.mock("../queues", () => ({
  backfillQueue: {},
  planGenerationQueue: {
    getJob: (...a: unknown[]) => getJob(...a),
    remove: (...a: unknown[]) => remove(...a),
    add: (...a: unknown[]) => add(...a),
  },
  eventAdaptationQueue: {},
  garminSyncQueue: {},
  webhookProcessingQueue: {},
  fitDownloadQueue: {},
  connectBackfillQueue: {},
}));

import { enqueuePlanGeneration } from "../producer";

const data = { userId: "u1", goalId: "g1" } as never;

describe("enqueuePlanGeneration", () => {
  beforeEach(() => {
    getJob.mockReset();
    remove.mockReset().mockResolvedValue(1);
    add.mockClear();
  });

  it("removes a stale completed job before re-adding", async () => {
    getJob.mockResolvedValue({ getState: () => Promise.resolve("completed") });
    await enqueuePlanGeneration(data);
    expect(remove).toHaveBeenCalledWith("plan-gen-u1-g1");
    expect(add).toHaveBeenCalledWith(
      "plan-generation",
      data,
      expect.objectContaining({ jobId: "plan-gen-u1-g1" }),
    );
  });

  it("leaves an active job in place and still calls add", async () => {
    getJob.mockResolvedValue({ getState: () => Promise.resolve("active") });
    await enqueuePlanGeneration(data);
    expect(remove).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledOnce();
  });

  it("still adds when getJob rejects", async () => {
    getJob.mockRejectedValue(new Error("redis down"));
    await enqueuePlanGeneration(data);
    expect(remove).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledOnce();
  });
});
