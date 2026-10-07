export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-center py-2 sm:py-6">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  );
}
