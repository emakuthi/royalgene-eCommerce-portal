export default function TenantNotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that workspace</h1>
      <p className="max-w-md text-muted-foreground">
        This subdomain isn&apos;t linked to a Royal Gene organization. Double-check the URL, or
        sign up for a new workspace below.
      </p>
      <a
        href="/signup"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Create a workspace
      </a>
    </div>
  );
}
