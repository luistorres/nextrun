"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface GarminConnectButtonProps {
  isConnected: boolean;
  onConnected?: () => void;
}

export function GarminConnectButton({
  isConnected,
  onConnected,
}: GarminConnectButtonProps) {
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isConnected) return null;

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-dashed border-rule-strong bg-paper px-4 py-3 text-left transition-colors duration-150 hover:border-solid hover:bg-paper-shade"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">
            Connect Garmin
          </span>
          <span className="mt-0.5 block text-sm text-ink-soft">
            Sign in with your Garmin Connect credentials to sync watch data.
          </span>
        </span>
        <svg
          className="h-4 w-4 shrink-0 text-ink-faint"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m8.25 4.5 7.5 7.5-7.5 7.5"
          />
        </svg>
      </button>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/garmin/connect-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Connection failed");
        return;
      }

      setEmail("");
      setPassword("");
      setShowForm(false);
      onConnected?.();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      <p className="text-sm font-medium text-ink">
        Garmin Connect credentials
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={isLoading}
          autoComplete="email"
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={isLoading}
          autoComplete="current-password"
        />
      </div>

      {error && (
        <div className="rounded-md bg-red-soft px-3 py-2">
          <p className="text-sm text-pencil-red-deep">{error}</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            Check the email and password, then try again.
          </p>
        </div>
      )}

      <p className="text-xs text-ink-faint">
        The password is not stored — only session tokens are saved.
      </p>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={isLoading}>
          {isLoading ? "Connecting" : "Connect"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowForm(false);
            setError(null);
          }}
          disabled={isLoading}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
