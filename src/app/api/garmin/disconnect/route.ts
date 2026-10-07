import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { revokeToken } from "@/lib/garmin/auth";
import {
  getStoredTokens,
  deleteConnection,
} from "@/lib/garmin/token-manager";
import { getStorage } from "@/lib/storage";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Token retrieval and revocation are best-effort: a corrupt or undecryptable
  // token must never block the user from disconnecting.
  try {
    const tokens = await getStoredTokens(userId);
    if (tokens) {
      await revokeToken(tokens.accessToken);
    }
  } catch (error) {
    console.error(
      `[garmin/disconnect] Token revocation failed (non-fatal) for user ${userId}:`,
      error
    );
  }

  // Delete the connection from the database
  await deleteConnection(userId);

  // Delete stored activity files (best-effort — log failures, don't block)
  try {
    await getStorage().deleteUserFiles(userId);
  } catch (error) {
    console.error(
      `[garmin/disconnect] Failed to delete stored files for user ${userId} (non-fatal):`,
      error
    );
  }

  return NextResponse.json({ success: true });
}
