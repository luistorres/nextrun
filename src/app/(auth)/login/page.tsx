import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = {
  title: "Sign in — nextrun",
};

export default function LoginPage() {
  return (
    <div>
      <h2 className="mb-6 text-center text-xl font-semibold text-ink">
        Sign in with Garmin
      </h2>
      <Suspense
        fallback={
          <div className="space-y-4">
            <div className="skeleton h-10" />
            <div className="skeleton h-10" />
            <div className="skeleton h-10" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
      <p className="mt-4 text-center text-sm text-ink-soft">
        No access yet?{" "}
        <Link
          href="/waitlist"
          className="font-medium text-pencil-red underline underline-offset-2 hover:text-pencil-red-deep"
        >
          Request it
        </Link>
      </p>
    </div>
  );
}
