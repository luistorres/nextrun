import Link from "next/link";
import { Wordmark } from "@/components/ui/wordmark";

const WEEK_ROWS: {
  day: string;
  type: string;
  label: string;
  detail: string;
  done?: boolean;
  adjusted?: boolean;
}[] = [
  { day: "Mon", type: "Easy", label: "Easy run", detail: "8.0 km", done: true },
  { day: "Tue", type: "Cross", label: "Padel", detail: "90 min", done: true },
  { day: "Wed", type: "—", label: "Poor sleep", detail: "5h 10m" },
  { day: "Thu", type: "Rest", label: "Rest day", detail: "", adjusted: true },
  { day: "Fri", type: "Tempo", label: "Tempo run", detail: "6.0 km", adjusted: true },
  { day: "Sat", type: "Cross", label: "Cycling", detail: "40 km" },
  { day: "Sun", type: "Long", label: "Long run", detail: "14.0 km", adjusted: true },
];

function PencilUnderline() {
  return (
    <svg
      className="pencil-stroke -mt-0.5 block h-2 w-36"
      viewBox="0 0 144 8"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 5.5C30 3 68 2.5 96 4c18 1 32 1.5 46 .5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        pathLength="1"
      />
    </svg>
  );
}

function DoneTick() {
  return (
    <svg
      className="h-4 w-4 text-sage"
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Completed"
    >
      <path
        d="M5 12.5l4.2 4.8L19 6.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WeekSheet() {
  return (
    <div className="overflow-hidden rounded-md border border-rule bg-paper-raised shadow-[0_1px_4px_rgba(38,36,31,0.06)]">
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <span className="text-sm font-semibold text-ink">This week</span>
        <span className="stamp text-[11px] text-ink-soft">Week 7/12</span>
      </div>

      <div className="px-5 pb-2">
        {WEEK_ROWS.map((row) => (
          <div
            key={row.day}
            className="grid items-baseline gap-3 border-b border-rule py-2.5 last:border-b-0"
            style={{ gridTemplateColumns: "2.2rem 3.2rem 1fr auto" }}
          >
            <span className="font-mono text-xs text-ink-faint">{row.day}</span>
            <span className="text-xs text-ink-soft">{row.type}</span>
            <span className="flex min-w-0 items-center gap-1.5 truncate text-sm text-ink">
              {row.label}
              {row.done && <DoneTick />}
              {row.adjusted && (
                <span className="text-[11px] font-medium text-pencil-red">
                  adjusted
                </span>
              )}
            </span>
            <span className="font-mono text-xs tabular-nums text-ink-soft">
              {row.detail}
            </span>
          </div>
        ))}
      </div>

      <div className="coach-note px-5 pb-5 pt-2">
        <p className="text-sm font-medium leading-snug">
          Rough night Wednesday. Thursday is now rest, tempo trimmed, long run
          shortened. The race date holds.
        </p>
        <PencilUnderline />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <header>
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5"
        >
          <Wordmark className="text-lg" />
          <Link
            href="/login"
            className="rounded bg-pencil-red px-4 py-2 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-6 pb-16 pt-12 sm:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-ink sm:text-5xl">
                A training plan that keeps up with your life.
              </h1>
              <p className="mt-5 max-w-[26rem] text-base leading-relaxed text-ink-soft">
                You play padel. You cycle on weekends. Some nights you sleep
                badly. Your coach reads all of it from your watch and rewrites
                the week before you have to ask.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/waitlist"
                  className="rounded bg-pencil-red px-6 py-2.5 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep"
                >
                  Request access
                </Link>
                <Link
                  href="/login"
                  className="rounded border border-rule-strong px-6 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-shade hover:text-ink"
                >
                  Sign in with Garmin
                </Link>
              </div>
            </div>

            <WeekSheet />
          </div>
        </section>

        <section className="border-y border-rule bg-paper-raised">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              What the coach works from
            </h2>
            <div className="mt-8 border-t border-rule">
              {[
                {
                  title: "Every activity counts",
                  desc: "Rides, swims, gym sessions, a football kickaround — anything your watch records feeds the weekly load, and your running is planned around it.",
                },
                {
                  title: "Recovery is measured, not guessed",
                  desc: "Sleep, HRV, and stress are read daily. When recovery drops, intensity drops with it.",
                },
                {
                  title: "The goal stays fixed",
                  desc: "Your race is the constant. Schedule, other sports, and rough weeks are the variables the plan absorbs.",
                },
                {
                  title: "Every change comes with a reason",
                  desc: "When the plan moves, you see what the coach noticed and why it matters. No black boxes.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[16rem_1fr] sm:gap-6"
                >
                  <h3 className="text-sm font-semibold text-ink">
                    {item.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-ink-soft">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            How it works
          </h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Connect your watch",
                desc: "Your activity history, sleep, and heart rate data establish the baseline in minutes.",
              },
              {
                step: "2",
                title: "Set a goal",
                desc: "A race, a distance, a timeframe. The plan is built around your available days and current fitness.",
              },
              {
                step: "3",
                title: "Run the week you're given",
                desc: "The coach reviews everything weekly and adjusts. The goal never moves.",
              },
            ].map((item) => (
              <div key={item.step}>
                <span className="font-mono text-2xl font-bold text-pencil-red">
                  {item.step}
                </span>
                <h3 className="mt-3 text-base font-semibold text-ink">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-rule">
          <div className="mx-auto max-w-5xl px-6 py-16 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Start your logbook
            </h2>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
              Connect your watch, set a goal, and let the coach take it from
              there.
            </p>
            <Link
              href="/waitlist"
              className="mt-7 inline-block rounded bg-pencil-red px-8 py-3 text-sm font-semibold text-paper-raised transition-colors hover:bg-pencil-red-deep"
            >
              Request access
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule bg-paper-raised">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-7 sm:flex-row">
          <p className="text-sm text-ink-soft">
            nextrun{" "}
            <span className="text-xs text-ink-faint">
              &copy; {new Date().getFullYear()}
            </span>
          </p>
          <Link
            href="/login"
            className="text-sm text-ink-soft transition-colors hover:text-ink"
          >
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
