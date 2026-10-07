"use client";

interface ChatTriggerProps {
  onClick: () => void;
  isOpen: boolean;
}

// Unused: the coach entry point lives in DashboardShell's nav. Kept as a
// compilable no-op for any stale imports.
export function ChatTrigger(props: ChatTriggerProps) {
  void props;
  return null;
}
