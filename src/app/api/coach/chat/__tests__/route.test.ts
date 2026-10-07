import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "u1" } }),
}));
const checkRateLimit = vi.fn();
vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/client", () => ({
  sendMessage: vi.fn(),
  extractTextContent: vi.fn(),
  MODELS: { SONNET: "claude-sonnet-5" },
}));
vi.mock("@/lib/ai/prompts/coach-chat", () => ({
  COACH_CHAT_SYSTEM_PROMPT: "",
  buildCoachContext: vi.fn(),
  formatCoachContext: vi.fn(),
}));

import { POST } from "../route";
import { auth } from "@/auth";

const post = () =>
  POST(
    new Request("http://test/api/coach/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hi" }),
    }),
  );

describe("POST /api/coach/chat rate limit", () => {
  beforeEach(() => checkRateLimit.mockReset());

  it("returns 429 when over the limit", async () => {
    checkRateLimit.mockResolvedValue(false);
    const res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(
      "Rate limit exceeded — the coach can answer up to 20 messages per hour.",
    );
    expect(checkRateLimit).toHaveBeenCalledWith("chat:u1", 20, 3600);
  });

  it("returns 401 without consulting the rate limit when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const res = await post();
    expect(res.status).toBe(401);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
