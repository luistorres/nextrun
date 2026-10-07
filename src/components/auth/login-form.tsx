"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  password?: string;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isLoading, setIsLoading] = useState(false);

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((prev) =>
      prev[field] ? { ...prev, [field]: undefined } : prev,
    );
  }

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!email.trim()) {
      errors.email = "Email is required.";
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (!password) {
      errors.password = "Password is required.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    if (!validate()) return;

    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        if (result.code === "rate_limited") {
          setError("Too many attempts. Wait 15 minutes and try again.");
        } else if (result.code === "mfa") {
          setError(
            "Sign-in failed. Garmin accounts with MFA/2FA enabled are not supported — disable it and try again.",
          );
        } else {
          setFieldErrors({
            password: "Sign-in failed. Check your Garmin email and password.",
          });
        }
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && (
        <div className="rounded border border-pencil-red bg-red-soft p-3 text-sm text-pencil-red-deep">
          {error}
        </div>
      )}

      <Input
        id="email"
        label="Garmin email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          clearFieldError("email");
        }}
        placeholder="you@example.com"
        error={fieldErrors.email}
      />

      <Input
        id="password"
        label="Garmin password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          clearFieldError("password");
        }}
        placeholder="Your Garmin Connect password"
        error={fieldErrors.password}
      />

      <p className="text-xs text-ink-faint">
        Sign in with your Garmin Connect account. The password is not stored —
        only session tokens are saved.
      </p>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded bg-pencil-red px-4 py-2.5 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pencil-red disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
