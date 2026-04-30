export default function LegacyRouteRemoved() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-xl text-center">
        <h1 className="text-2xl font-semibold mb-2">Route removed</h1>
        <p className="text-sm text-muted-foreground mb-4">The old /portal/shop/{`[id]`}/edit route has been removed. Please use the new route under <code className="rounded bg-muted px-2 py-1">/portal/shops/{`[id]`}/edit</code>.</p>
        <div className="flex justify-center gap-2">
          <a href="/shops" className="inline-block px-4 py-2 rounded-md border border-input bg-transparent">Back to Shops</a>
          <a href="/shops" className="inline-block px-4 py-2 rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">Open Shops</a>
        </div>
      </div>
    </div>
  );
}

