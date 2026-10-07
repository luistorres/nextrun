"use client";

const QUICK_PROMPTS = [
  "Explain today's workout",
  "I'm short on time today",
  "Why was my plan changed?",
  "How is my training going?",
  "I'm carrying some fatigue",
];

interface QuickPromptsProps {
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}

export function QuickPrompts({ onSelect, disabled }: QuickPromptsProps) {
  return (
    <div className="px-1 py-4">
      <p className="text-sm font-medium text-ink">Write to your coach</p>
      <p className="mt-1 text-xs text-ink-soft">
        Questions about your plan, your training, or how you feel today.
      </p>

      <div className="mt-4 border-t border-rule">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSelect(prompt)}
            disabled={disabled}
            className="block w-full border-b border-rule px-1 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-paper-shade hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
