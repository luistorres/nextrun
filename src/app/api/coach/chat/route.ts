import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { db } from "@/lib/db";
import { coachMessages } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { sendMessage, extractTextContent, MODELS } from "@/lib/ai/client";
import {
  COACH_CHAT_SYSTEM_PROMPT,
  buildCoachContext,
  formatCoachContext,
} from "@/lib/ai/prompts/coach-chat";
import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const chatBodySchema = z.object({
  message: z.string().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// POST /api/coach/chat — Send a message to the AI coach
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await checkRateLimit(`chat:${session.user.id}`, 20, 3600);
    if (!allowed) {
      return NextResponse.json(
        {
          error:
            "Rate limit exceeded — the coach can answer up to 20 messages per hour.",
        },
        { status: 429 },
      );
    }

    const body = await request.json();
    const parsed = chatBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const userId = session.user.id;
    const { message } = parsed.data;

    // Fetch recent conversation history (last 20 messages)
    const history = await db
      .select({
        role: coachMessages.role,
        content: coachMessages.content,
      })
      .from(coachMessages)
      .where(eq(coachMessages.userId, userId))
      .orderBy(desc(coachMessages.createdAt))
      .limit(20);

    // Reverse to chronological order
    history.reverse();

    // Build dynamic context
    const context = await buildCoachContext(userId);
    const contextText = formatCoachContext(context);

    // Build system prompt with context
    const systemPrompt = `${COACH_CHAT_SYSTEM_PROMPT}\n\n${contextText}`;

    // Build messages array for Claude
    const messages: Anthropic.MessageParam[] = [
      ...history.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user", content: message },
    ];

    // Call Claude
    const response = await sendMessage({
      model: MODELS.SONNET,
      maxTokens: 1024,
      system: systemPrompt,
      cacheSystemPrompt: true,
      messages,
      timeoutMs: 60_000,
      trace: { callsite: "coach-chat", userId },
    });

    const assistantContent = extractTextContent(response);

    if (!assistantContent) {
      return NextResponse.json(
        { error: "AI did not return a response" },
        { status: 502 },
      );
    }

    // Save messages sequentially to ensure correct ordering by createdAt
    const [userMsg] = await db
      .insert(coachMessages)
      .values({
        userId,
        role: "user",
        content: message,
      })
      .returning();

    const [assistantMsg] = await db
      .insert(coachMessages)
      .values({
        userId,
        role: "assistant",
        content: assistantContent,
        metadata: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        },
      })
      .returning();

    return NextResponse.json({
      message: {
        id: assistantMsg.id,
        role: "assistant",
        content: assistantContent,
        createdAt: assistantMsg.createdAt.toISOString(),
      },
      userMessage: {
        id: userMsg.id,
        role: "user",
        content: message,
        createdAt: userMsg.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("[coach/chat] Error:", error);
    return NextResponse.json(
      { error: "Failed to process coach message" },
      { status: 500 },
    );
  }
}
