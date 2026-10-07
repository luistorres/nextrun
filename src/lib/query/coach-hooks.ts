"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoachMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface CoachHistoryResponse {
  messages: CoachMessage[];
}

interface SendMessageResponse {
  message: CoachMessage;
  userMessage: CoachMessage;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.error ?? `API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// useCoachHistory — Fetch chat history
// ---------------------------------------------------------------------------

export function useCoachHistory() {
  return useQuery<CoachHistoryResponse>({
    queryKey: ["coach", "history"],
    queryFn: () => fetchJSON<CoachHistoryResponse>("/api/coach/history"),
    staleTime: 30 * 1000, // 30 seconds
  });
}

// ---------------------------------------------------------------------------
// useSendCoachMessage — Send a message to the AI coach
// ---------------------------------------------------------------------------

export function useSendCoachMessage() {
  const queryClient = useQueryClient();

  return useMutation<SendMessageResponse, Error, string, { previous: CoachHistoryResponse | undefined }>({
    mutationFn: (message: string) =>
      postJSON<SendMessageResponse>("/api/coach/chat", { message }),

    onMutate: async (message: string) => {
      await queryClient.cancelQueries({ queryKey: ["coach", "history"] });

      const previous =
        queryClient.getQueryData<CoachHistoryResponse>(["coach", "history"]);

      // Optimistically add the user message
      if (previous) {
        queryClient.setQueryData<CoachHistoryResponse>(["coach", "history"], {
          messages: [
            ...previous.messages,
            {
              id: `optimistic-${Date.now()}`,
              role: "user",
              content: message,
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }

      return { previous };
    },

    onSuccess: (data) => {
      // Replace optimistic data with server response
      const current =
        queryClient.getQueryData<CoachHistoryResponse>(["coach", "history"]);

      if (current) {
        // Remove the optimistic user message and add real ones
        const withoutOptimistic = current.messages.filter(
          (m) => !m.id.startsWith("optimistic-"),
        );
        queryClient.setQueryData<CoachHistoryResponse>(["coach", "history"], {
          messages: [...withoutOptimistic, data.userMessage, data.message],
        });
      }
    },

    onError: (_err, _message, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["coach", "history"], context.previous);
      }
    },
  });
}
