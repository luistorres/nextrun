import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class MockAnthropic {
    messages = { create: createMock };
  }
  return { default: Object.assign(MockAnthropic, { APIError }) };
});

const insertValues = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/db", () => ({
  db: { insert: () => ({ values: insertValues }) },
}));
vi.mock("@/lib/db/schema", () => ({ aiCalls: {} }));

import { sendMessage } from "../client";

const okResponse = {
  content: [{ type: "text", text: "hi" }],
  usage: { input_tokens: 10, output_tokens: 5 },
  stop_reason: "end_turn",
};

describe("sendMessage tracing", () => {
  beforeEach(() => {
    createMock.mockReset();
    insertValues.mockClear();
  });

  it("records a success trace row when trace is passed", async () => {
    createMock.mockResolvedValue(okResponse);
    await sendMessage({
      maxTokens: 100,
      messages: [{ role: "user", content: "x" }],
      trace: { callsite: "test-call", userId: "u1" },
    });
    expect(insertValues).toHaveBeenCalledOnce();
    const row = insertValues.mock.calls[0][0];
    expect(row.callsite).toBe("test-call");
    expect(row.userId).toBe("u1");
    expect(row.success).toBe(true);
    expect(row.inputTokens).toBe(10);
    expect(row.outputTokens).toBe(5);
  });

  it("records a failure trace row after retries exhaust", async () => {
    createMock.mockRejectedValue(new Error("boom"));
    await expect(
      sendMessage({
        maxTokens: 100,
        messages: [{ role: "user", content: "x" }],
        trace: { callsite: "test-call" },
      }),
    ).rejects.toThrow("boom");
    expect(insertValues).toHaveBeenCalledOnce();
    const row = insertValues.mock.calls[0][0];
    expect(row.success).toBe(false);
    expect(row.errorMessage).toContain("boom");
  }, 15_000);

  it("does not insert when no trace param", async () => {
    createMock.mockResolvedValue(okResponse);
    await sendMessage({
      maxTokens: 100,
      messages: [{ role: "user", content: "x" }],
    });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("passes the remaining budget as the SDK request timeout", async () => {
    createMock.mockResolvedValue(okResponse);
    await sendMessage({
      maxTokens: 100,
      messages: [{ role: "user", content: "x" }],
      timeoutMs: 60_000,
    });
    const opts = createMock.mock.calls[0][1];
    expect(opts.timeout).toBeGreaterThan(0);
    expect(opts.timeout).toBeLessThanOrEqual(60_000);
  });

  it("traces once and does not retry on a non-retryable client error", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const APIError = (
      Anthropic as unknown as {
        APIError: new (m: string) => Error & { status?: number };
      }
    ).APIError;
    const err = new APIError("bad request");
    err.status = 400;
    createMock.mockRejectedValue(err);
    await expect(
      sendMessage({
        maxTokens: 100,
        messages: [{ role: "user", content: "x" }],
        trace: { callsite: "test-call" },
      }),
    ).rejects.toThrow("bad request");
    expect(createMock).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledOnce();
    expect(insertValues.mock.calls[0][0].success).toBe(false);
  });

  it("synthesizes an error when the budget is zero before any attempt", async () => {
    await expect(
      sendMessage({
        maxTokens: 100,
        messages: [{ role: "user", content: "x" }],
        timeoutMs: 0,
        trace: { callsite: "test-call" },
      }),
    ).rejects.toThrow("timed out before any attempt");
    expect(createMock).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledOnce();
  });

  it("stops retrying once the budget is spent", async () => {
    createMock.mockRejectedValue(new Error("slow"));
    await expect(
      sendMessage({
        maxTokens: 100,
        messages: [{ role: "user", content: "x" }],
        timeoutMs: 1,
      }),
    ).rejects.toThrow();
    expect(createMock.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
