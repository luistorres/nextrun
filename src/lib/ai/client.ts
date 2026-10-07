/**
 * Anthropic SDK wrapper with retry logic, prompt caching, and token usage tracking.
 */

import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Model constants
// ---------------------------------------------------------------------------

export const MODELS = {
  /** Primary model for plan adaptations and coach chat */
  SONNET: "claude-sonnet-5",
  /**
   * Full plan generation only — the one-shot, highest-stakes call where
   * multi-week coherence matters most and volume is low.
   */
  OPUS: "claude-opus-5-5",
  /** Fast/cheap model for triage decisions */
  HAIKU: "claude-haiku-4-5-20251001",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // We run our own retry loop below (with logging) — the SDK's built-in
      // retries would stack on top of it (~9 attempts on a 529).
      maxRetries: 0,
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Retry wrapper
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;
// The SDK's own default request timeout is also 10 min; this makes the
// budget explicit and overridable per call.
const DEFAULT_TIMEOUT_MS = 600_000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ClaudeMessageParams {
  model?: ModelId | string;
  maxTokens: number;
  /** Plain string system prompt (no caching) */
  system?: string;
  /** Enable prompt caching for the system prompt (reduces cost ~90% on cache hits) */
  cacheSystemPrompt?: boolean;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  toolChoice?: Anthropic.ToolChoice;
  /**
   * Structured outputs: constrain the response to this JSON schema
   * (output_config.format). Preferred over forced tool_choice — it
   * guarantees schema-valid JSON and, unlike forced tool choice, is
   * compatible with thinking.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * Enable adaptive thinking. Incompatible with forced toolChoice —
   * use outputSchema for structured results instead.
   */
  thinking?: boolean;
  /**
   * Total wall-clock budget for this call across all retry attempts.
   * Each attempt gets the remaining budget as its SDK request timeout.
   */
  timeoutMs?: number;
  /** When present, a row is written to ai_calls for this request. */
  trace?: { callsite: string; userId?: string };
}

export interface ClaudeResponse {
  content: Anthropic.ContentBlock[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  stopReason: string | null;
}

interface TraceEntry {
  userId?: string;
  callsite: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
}

const TRACE_TIMEOUT_MS = 5_000;

// Lazy import so scripts/tests without a DATABASE_URL can use sendMessage
// untraced. In the worker process this opens a second (lazy, idle-reaped)
// pg pool next to workers/shared/db — accepted over threading db through
// every caller. Waits at most 5s; the insert keeps running in the
// background past the cap (its catch is attached up front, so a late
// failure never becomes an unhandled rejection).
async function recordTrace(entry: TraceEntry): Promise<void> {
  const insert = (async () => {
    const { db } = await import("@/lib/db");
    const { aiCalls } = await import("@/lib/db/schema");
    await db.insert(aiCalls).values(entry);
  })().catch((err) => {
    console.warn("[ai] trace insert failed:", err);
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      insert,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TRACE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a message to Claude with automatic retry and exponential backoff.
 *
 * Retries on transient errors (rate limits, server errors). Throws
 * immediately on client errors (bad request, auth).
 *
 * When `cacheSystemPrompt` is true, the system prompt is sent with
 * Anthropic's prompt caching enabled (cache_control: ephemeral).
 * System prompt on cache hit costs $0.30/MTok instead of $3/MTok.
 */
export async function sendMessage(
  params: ClaudeMessageParams,
): Promise<ClaudeResponse> {
  const client = getClient();
  const model = params.model ?? MODELS.SONNET;
  let lastError: Error | null = null;

  // Build system param — use cache_control when caching is enabled
  const systemParam = params.system
    ? params.cacheSystemPrompt
      ? [
          {
            type: "text" as const,
            text: params.system,
            cache_control: { type: "ephemeral" as const },
          },
        ]
      : params.system
    : undefined;

  const startedAt = Date.now();
  const deadline = startedAt + (params.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const traceFailure = async (err: unknown) => {
    if (!params.trace) return;
    const message = err instanceof Error ? err.message : String(err);
    await recordTrace({
      userId: params.trace.userId,
      callsite: params.trace.callsite,
      model: String(model),
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      success: false,
      errorMessage: message.slice(0, 500),
    });
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await client.messages.create(
        {
          model,
          max_tokens: params.maxTokens,
          system: systemParam,
          messages: params.messages,
          tools: params.tools,
          tool_choice: params.toolChoice,
          output_config: params.outputSchema
            ? { format: { type: "json_schema", schema: params.outputSchema } }
            : undefined,
          thinking: params.thinking ? { type: "adaptive" } : undefined,
        },
        { timeout: remaining },
      );

      // Log token usage (include cache stats when present)
      const usage = response.usage;
      const usageAny = usage as unknown as Record<string, number>;
      const cacheInfo =
        "cache_creation_input_tokens" in usage || "cache_read_input_tokens" in usage
          ? `, cache_write: ${usageAny.cache_creation_input_tokens ?? 0}, cache_read: ${usageAny.cache_read_input_tokens ?? 0}`
          : "";
      console.log(
        `[ai] Claude usage — input: ${usage.input_tokens}, output: ${usage.output_tokens}${cacheInfo}, model: ${model}`,
      );

      if (params.trace) {
        await recordTrace({
          userId: params.trace.userId,
          callsite: params.trace.callsite,
          model: String(model),
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usageAny.cache_read_input_tokens,
          cacheWriteTokens: usageAny.cache_creation_input_tokens,
          latencyMs: Date.now() - startedAt,
          success: true,
        });
      }

      return {
        content: response.content,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheCreationInputTokens: usageAny.cache_creation_input_tokens,
          cacheReadInputTokens: usageAny.cache_read_input_tokens,
        },
        stopReason: response.stop_reason,
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry client errors (400, 401, 403)
      if (err instanceof Anthropic.APIError) {
        if (err.status !== undefined && err.status < 500 && err.status !== 429) {
          await traceFailure(err);
          throw err;
        }
      }

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[ai] Retrying Claude request (attempt ${attempt + 1}/${MAX_RETRIES}) after ${delay}ms — ${lastError.message}`,
        );
        if (Date.now() + delay >= deadline) break;
        await sleep(delay);
      }
    }
  }

  const finalError =
    lastError ?? new Error("Claude request timed out before any attempt");
  await traceFailure(finalError);
  throw finalError;
}

/**
 * Extract the text content from a tool_use block in a Claude response.
 * Returns the parsed input object from the first tool_use block found.
 */
export function extractToolUseResult<T = unknown>(
  response: ClaudeResponse,
): T | null {
  for (const block of response.content) {
    if (block.type === "tool_use") {
      return block.input as T;
    }
  }
  return null;
}

/**
 * Extract plain text content from a Claude response.
 */
export function extractTextContent(response: ClaudeResponse): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Extract the structured-output JSON from a Claude response.
 *
 * With output_config.format the API guarantees the text content is valid
 * JSON matching the schema; callers should still run their domain (Zod)
 * validation on the result.
 */
export function extractStructuredResult<T = unknown>(
  response: ClaudeResponse,
): T | null {
  const text = extractTextContent(response).trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
