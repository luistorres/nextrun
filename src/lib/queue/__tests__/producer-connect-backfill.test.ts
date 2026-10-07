import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../queues", () => ({
  backfillQueue: {},
  planGenerationQueue: {},
  eventAdaptationQueue: {},
  garminSyncQueue: {},
  webhookProcessingQueue: {},
  fitDownloadQueue: {},
  connectBackfillQueue: {
    getJob: vi.fn(),
    add: vi.fn(),
  },
}));

import { connectBackfillQueue } from "../queues";
import { enqueueConnectBackfill } from "../producer";

const getJob = vi.mocked(connectBackfillQueue.getJob);
const add = vi.mocked(connectBackfillQueue.add);

function makeJob(state: string) {
  return {
    getState: vi.fn().mockResolvedValue(state),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

describe("enqueueConnectBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds with a deterministic per-user jobId when no job exists", async () => {
    getJob.mockResolvedValue(undefined);

    await enqueueConnectBackfill({ userId: "user-1" });

    expect(getJob).toHaveBeenCalledWith("connect-backfill-user-1");
    expect(add).toHaveBeenCalledWith(
      "connect-backfill",
      { userId: "user-1" },
      expect.objectContaining({ jobId: "connect-backfill-user-1" }),
    );
  });

  it.each(["completed", "failed", "unknown"])(
    "removes a %s job before adding",
    async (state) => {
      const job = makeJob(state);
      getJob.mockResolvedValue(job as never);

      await enqueueConnectBackfill({ userId: "user-1" });

      expect(job.remove).toHaveBeenCalledOnce();
      expect(add).toHaveBeenCalledOnce();
      expect(job.remove.mock.invocationCallOrder[0]).toBeLessThan(
        add.mock.invocationCallOrder[0],
      );
    },
  );

  it.each(["active", "waiting", "delayed"])(
    "does not remove a %s job but still calls add",
    async (state) => {
      const job = makeJob(state);
      getJob.mockResolvedValue(job as never);

      await enqueueConnectBackfill({ userId: "user-1" });

      expect(job.remove).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledOnce();
    },
  );

  it("still adds when getJob rejects", async () => {
    getJob.mockRejectedValue(new Error("redis down"));

    await enqueueConnectBackfill({ userId: "user-1" });

    expect(add).toHaveBeenCalledOnce();
  });

  it("still adds when remove rejects", async () => {
    const job = makeJob("failed");
    job.remove.mockRejectedValue(new Error("locked"));
    getJob.mockResolvedValue(job as never);

    await enqueueConnectBackfill({ userId: "user-1" });

    expect(add).toHaveBeenCalledOnce();
  });
});
