import { DashboardProviders } from "@/components/dashboard/providers";
import { DashboardShell } from "@/components/dashboard/shell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardProviders>
      <DashboardShell>{children}</DashboardShell>
    </DashboardProviders>
  );
}
