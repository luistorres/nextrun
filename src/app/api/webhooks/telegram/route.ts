import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { allowedEmails } from "@/lib/db/schema";
import { answerCallback, editMessage, notifyOwner } from "@/lib/utils/telegram";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function approve(email: string): Promise<void> {
  await db
    .insert(allowedEmails)
    .values({ email: email.toLowerCase() })
    .onConflictDoNothing();
}

export async function POST(request: NextRequest) {
  // Set via setWebhook's secret_token; Telegram echoes it on every update
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (
    !secret ||
    request.headers.get("x-telegram-bot-api-secret-token") !== secret
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerChatId = process.env.TELEGRAM_CHAT_ID;
  const update = await request.json().catch(() => null);
  if (!update || !ownerChatId) return NextResponse.json({ ok: true });

  const callback = update.callback_query;
  if (callback?.data?.startsWith("approve:")) {
    if (String(callback.from?.id) !== ownerChatId) {
      return NextResponse.json({ ok: true });
    }
    const email = callback.data.slice("approve:".length);
    await approve(email);
    await answerCallback(callback.id, `Approved ${email}`);
    if (callback.message) {
      await editMessage(
        callback.message.chat.id,
        callback.message.message_id,
        `✅ Approved ${email}`,
      );
    }
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (message?.text && String(message.chat?.id) === ownerChatId) {
    if (message.text.startsWith("/approve")) {
      const email = message.text.replace("/approve", "").trim().toLowerCase();
      if (EMAIL_REGEX.test(email)) {
        await approve(email);
        await notifyOwner(`✅ Approved ${email}`);
      } else {
        await notifyOwner("Usage: /approve email@example.com");
      }
    } else {
      await notifyOwner(
        "Commands:\n/approve email@example.com — allowlist an email\n\nWaitlist signups arrive here with an Approve button.",
      );
    }
  }

  return NextResponse.json({ ok: true });
}
