export interface ProgressStep {
  label: string;
  status: "completed" | "current" | "upcoming";
}

interface ProgressProps {
  steps: ProgressStep[];
}

export function Progress({ steps }: ProgressProps) {
  return (
    <nav aria-label="Progress" className="w-full">
      <ol className="hidden items-center sm:flex">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={`flex items-center ${
              index < steps.length - 1 ? "flex-1" : ""
            }`}
          >
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  step.status === "completed"
                    ? "bg-sage-soft text-sage"
                    : step.status === "current"
                      ? "border-2 border-pencil-red bg-paper-raised text-pencil-red"
                      : "border-2 border-rule bg-paper-raised text-ink-faint"
                }`}
              >
                {step.status === "completed" ? (
                  <svg
                    className="pencil-check h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 12.5l4.2 4.8L19 6.5"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={`mt-2 text-xs font-medium ${
                  step.status === "completed"
                    ? "text-sage"
                    : step.status === "current"
                      ? "text-ink"
                      : "text-ink-faint"
                }`}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`mx-2 h-px flex-1 ${
                  step.status === "completed" ? "bg-sage" : "bg-rule"
                }`}
              />
            )}
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-between sm:hidden">
        <span className="text-sm font-medium text-ink">
          Step {steps.findIndex((s) => s.status === "current") + 1} of{" "}
          {steps.length}
        </span>
        <span className="text-sm text-ink-soft">
          {steps.find((s) => s.status === "current")?.label}
        </span>
      </div>
      <div className="mt-2 h-1 w-full rounded-full bg-paper-shade sm:hidden">
        <div
          className="h-1 rounded-full bg-pencil-red transition-all duration-300"
          style={{
            width: `${
              ((steps.filter((s) => s.status === "completed").length +
                (steps.some((s) => s.status === "current") ? 0.5 : 0)) /
                steps.length) *
              100
            }%`,
          }}
        />
      </div>
    </nav>
  );
}
