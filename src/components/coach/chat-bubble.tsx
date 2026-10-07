"use client";

import { memo } from "react";

interface ChatBubbleProps {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  isOptimistic?: boolean;
}

export const ChatBubble = memo(function ChatBubble({
  role,
  content,
  createdAt,
  isOptimistic,
}: ChatBubbleProps) {
  const isUser = role === "user";

  const time = new Date(createdAt);
  const timeStr = time.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%]">
        <div
          className={`rounded-md px-3.5 py-2.5 text-sm leading-relaxed text-ink ${
            isUser
              ? "bg-sage-soft"
              : "bg-paper-shade"
          }`}
          style={{ opacity: isOptimistic ? 0.7 : 1 }}
        >
          <FormattedContent content={content} />
        </div>
        <p
          className={`mt-1 px-1 text-[11px] text-ink-faint ${
            isUser ? "text-right" : ""
          }`}
        >
          {isOptimistic ? "Sending" : timeStr}
        </p>
      </div>
    </div>
  );
});

function FormattedContent({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.trim() === "") {
          return <div key={i} className="h-1" />;
        }

        if (line.match(/^[-*]\s/)) {
          const bulletContent = line.replace(/^[-*]\s/, "");
          return (
            <div key={i} className="ml-1 flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
              <span>
                <BoldText text={bulletContent} />
              </span>
            </div>
          );
        }

        return (
          <p key={i}>
            <BoldText text={line} />
          </p>
        );
      })}
    </div>
  );
}

function BoldText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
