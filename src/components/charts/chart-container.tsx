"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Defers rendering of Recharts content until its container has a real,
 * non-zero size. Recharts' ResponsiveContainer logs
 * "The width(0) and height(0) of chart should be greater than 0" when a
 * chart mounts inside an unmeasured/zero-size box (e.g. during dynamic
 * import + layout settling) — this guard removes those warnings.
 */
export function ChartContainer({
  children,
  className = "",
  height = 256,
}: {
  children: React.ReactNode;
  className?: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setReady(true);
    };
    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`w-full ${className}`} style={{ height }}>
      {ready ? children : null}
    </div>
  );
}
