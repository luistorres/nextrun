"use client";

import { useEffect, useRef, useCallback } from "react";
import { ChatBubble } from "./chat-bubble";
import { ChatInput } from "./chat-input";
import { QuickPrompts } from "./quick-prompts";
import { useCoachHistory, useSendCoachMessage } from "@/lib/query/coach-hooks";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

const FOLLOW_UP_PROMPTS = [
  "Explain today's workout",
  "I'm short on time today",
  "Why was my plan changed?",
];

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: history, isLoading: historyLoading } = useCoachHistory();
  const sendMessage = useSendCoachMessage();

  const messages = history?.messages ?? [];
  const isEmpty = messages.length === 0 && !historyLoading;

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

  const handleSend = useCallback(
    (message: string) => {
      sendMessage.mutate(message);
    },
    [sendMessage],
  );

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-ink/30 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open}
        aria-label="Coach correspondence"
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)] transition-transform duration-300 ease-out lg:w-[400px] ${
          open ? "translate-x-0" : "invisible translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4">
          <p className="text-sm font-semibold text-ink">Coach</p>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-ink-soft transition-colors hover:bg-paper-shade hover:text-ink"
            aria-label="Close chat"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {historyLoading && (
            <div className="space-y-3 py-2">
              <div className="skeleton h-14 w-4/5" />
              <div className="skeleton ml-auto h-10 w-3/5" />
              <div className="skeleton h-14 w-4/5" />
            </div>
          )}

          {isEmpty && (
            <QuickPrompts onSelect={handleSend} disabled={sendMessage.isPending} />
          )}

          {messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              createdAt={msg.createdAt}
              isOptimistic={msg.id.startsWith("optimistic-")}
            />
          ))}

          {sendMessage.isPending && (
            <div className="flex justify-start">
              <div className="rounded-md bg-paper-shade px-3.5 py-3">
                <TypingIndicator />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {sendMessage.isError && (
          <p className="px-4 pb-2 text-xs text-red-600">
            {sendMessage.error instanceof Error
              ? sendMessage.error.message
              : "Message failed to send."}
          </p>
        )}

        <ChatInput onSend={handleSend} disabled={sendMessage.isPending} />

        {!isEmpty && messages.length < 4 && (
          <div className="border-t border-rule px-3 py-2">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {FOLLOW_UP_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  disabled={sendMessage.isPending}
                  className="shrink-0 rounded border border-rule px-2.5 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:bg-paper-shade hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function TypingIndicator() {
  return (
    <div className="flex h-5 items-center gap-1" aria-label="Coach is writing">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-1 w-1 animate-pulse rounded-full bg-ink-faint"
          style={{ animationDelay: `${i * 200}ms`, animationDuration: "1.2s" }}
        />
      ))}
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
