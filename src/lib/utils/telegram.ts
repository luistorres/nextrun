/**
 * Owner notifications via Telegram bot. No-op when TELEGRAM_BOT_TOKEN /
 * TELEGRAM_CHAT_ID are unset — the DB row is the source of truth, the
 * message is only a convenience.
 */

async function callTelegram(method: string, payload: object): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.error(
      `[telegram] ${method} failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

export async function notifyOwner(
  text: string,
  opts?: { approveEmail?: string },
): Promise<void> {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  // callback_data is capped at 64 bytes; skip the button for oversized emails
  const email = opts?.approveEmail;
  const replyMarkup =
    email && `approve:${email}`.length <= 64
      ? {
          inline_keyboard: [
            [{ text: `Approve ${email}`, callback_data: `approve:${email}` }],
          ],
        }
      : undefined;

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function answerCallback(
  callbackQueryId: string,
  text: string,
): Promise<void> {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export async function editMessage(
  chatId: string | number,
  messageId: number,
  text: string,
): Promise<void> {
  await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
  });
}
