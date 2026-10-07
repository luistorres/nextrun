"use client";

import { useState, useRef, useCallback } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
  }, []);

  return (
    <div className="flex items-end gap-2 border-t border-rule bg-paper-raised p-3">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder="Write to your coach"
        disabled={disabled}
        rows={1}
        className="max-h-[100px] flex-1 resize-none rounded border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-faint focus:border-pencil-red focus:outline-none disabled:opacity-50"
        aria-label="Message your coach"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="flex h-9 shrink-0 items-center justify-center rounded bg-pencil-red px-3.5 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Send message"
      >
        {disabled ? <LoadingSpinner /> : "Send"}
      </button>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
