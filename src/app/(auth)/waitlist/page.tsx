import Link from "next/link";
import { WaitlistForm } from "@/components/auth/waitlist-form";

export const metadata = {
  title: "Request access — nextrun",
};

export default function WaitlistPage() {
  return (
    <div>
      <h2 className="mb-6 text-center text-xl font-semibold text-ink">
        Request access
      </h2>
      <WaitlistForm />
      <p className="mt-4 text-center text-sm text-ink-soft">
        Already approved?{" "}
        <Link
          href="/login"
          className="font-medium text-pencil-red underline underline-offset-2 hover:text-pencil-red-deep"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
