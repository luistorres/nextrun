/**
 * next│run — the ledger's red margin line divides the two words, so the
 * brand mark carries the same device as every log sheet in the app.
 */
export function Wordmark({
  tone = "ink",
  className = "",
}: {
  tone?: "ink" | "cloth";
  className?: string;
}) {
  const text = tone === "cloth" ? "text-[var(--cloth-text)]" : "text-ink";
  return (
    <span
      className={`inline-flex items-baseline font-bold tracking-tight ${text} ${className}`}
    >
      next
      <span
        aria-hidden="true"
        className="mx-[0.18em] inline-block w-[1.5px] self-stretch bg-pencil-red"
        style={{ transform: "translateY(0.08em)" }}
      />
      run
    </span>
  );
}
