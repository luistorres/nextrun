"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!EMAIL_REGEX.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), website }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (submitted) {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        You&apos;re on the list. Once your email is approved you can sign in
        directly with your Garmin account.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Input
        id="email"
        label="Garmin account email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        error={error || undefined}
      />

      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <p className="text-xs text-ink-faint">
        Use the same email as your Garmin Connect account — access is granted
        per email, and you&apos;ll sign in with your Garmin credentials.
      </p>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded bg-pencil-red px-4 py-2.5 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pencil-red disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? "Submitting..." : "Request access"}
      </button>
    </form>
  );
}
