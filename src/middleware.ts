import NextAuth from "next-auth";
import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // Public routes — no auth required
  const isPublicRoute =
    nextUrl.pathname === "/" ||
    nextUrl.pathname === "/login" ||
    nextUrl.pathname === "/waitlist" ||
    nextUrl.pathname === "/api/waitlist" ||
    nextUrl.pathname.startsWith("/api/auth") ||
    nextUrl.pathname.startsWith("/api/webhooks");

  if (isPublicRoute) {
    return;
  }

  // Protected routes — redirect to login if not authenticated
  if (!isLoggedIn && nextUrl.pathname.startsWith("/dashboard")) {
    const loginUrl = new URL("/login", nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return Response.redirect(loginUrl);
  }

  // Catch-all: any other non-API route requires auth
  if (!isLoggedIn && !nextUrl.pathname.startsWith("/api/")) {
    const loginUrl = new URL("/login", nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return Response.redirect(loginUrl);
  }
});

export const config = {
  // Match all routes except static files and Next.js internals
  // Browsers fetch the manifest and icons without the session cookie, so a
  // login redirect there would break installing the app.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon).*)",
  ],
};
