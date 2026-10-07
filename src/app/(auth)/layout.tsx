import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Wordmark } from "@/components/ui/wordmark";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block">
            <Wordmark className="text-xl" />
          </Link>
          <p className="mt-2 text-sm text-ink-soft">
            Adaptive coaching for people with a full life
          </p>
        </div>
        <Card className="p-6 sm:p-8">{children}</Card>
      </div>
    </div>
  );
}
