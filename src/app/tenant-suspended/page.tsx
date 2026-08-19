export default function TenantSuspendedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">This workspace is unavailable</h1>
      <p className="max-w-md text-muted-foreground">
        This organization&apos;s access has been suspended or cancelled. Contact your
        administrator, or reach out to support if you believe this is a mistake.
      </p>
    </div>
  );
}
