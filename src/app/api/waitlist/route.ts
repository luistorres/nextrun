import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { waitlist } from "@/lib/db/schema";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { notifyOwner } from "@/lib/utils/telegram";

const waitlistSchema = z.object({
  email: z.email(),
  // Honeypot: hidden in the form, bots fill it
  website: z.string().max(0).optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = waitlistSchema.safeParse(body);

  if (!parsed.success) {
    // Honeypot hits get the same success response as everyone else
    if (
      body &&
      typeof body === "object" &&
      "website" in body &&
      body.website
    ) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const allowed = await checkRateLimit(`waitlist:ip:${ip}`, 5, 60 * 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();

  const inserted = await db
    .insert(waitlist)
    .values({ email })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    void notifyOwner(`nextrun waitlist: ${email}`, { approveEmail: email });
  }

  return NextResponse.json({ ok: true });
}
