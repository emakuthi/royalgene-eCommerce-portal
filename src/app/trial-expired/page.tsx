export default function TrialExpiredPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">Your free trial has ended</h1>
      <p className="max-w-md text-muted-foreground">
        Your 14-day trial is over. Choose a plan to keep using your workspace — your data is safe
        and will be right where you left it.
      </p>
      <a
        href="/settings?tab=billing"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Choose a plan
      </a>
    </div>
  );
}
