export type JobStatus = "queued" | "running" | "completed" | "failed";

export function mapJobState(state: string): JobStatus {
  switch (state) {
    case "active":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}
