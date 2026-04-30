import React from 'react';
import AlertsClient, { type AlertItem } from '@/components/portal/AlertsClient';
import PortalHeader from '@/components/portal/PortalHeader';

async function fetchAlertsServer(limit = 10, offset = 0, req?: Request) {
  try {
    // server-side fetch uses absolute path; Next will proxy to internal API route
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';
    const url = `${base}/api/portal/alerts?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return { success: false, data: [], total: 0, status: res.status };
    }
    const json = await res.json();
    return { success: true, data: Array.isArray(json.data) ? json.data : [], total: typeof json.total === 'number' ? json.total : (Array.isArray(json.data) ? json.data.length : 0) };
  } catch (err) {
    return { success: false, data: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function Page() {
  const limit = 10;
  const offset = 0;
  const result = await fetchAlertsServer(limit, offset);

  // If server fetch failed, render client component with empty initial data and let client fetch show error as appropriate.
  const initialAlerts: AlertItem[] = result.success ? result.data : [];
  const initialTotal: number | null = result.success ? result.total : null;

  return (
    <div className="w-full bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 min-h-[60vh]">
      <PortalHeader backHref="/portal/dashboard" title="Alerts" description="Create and manage alerts for your shops" breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Alerts' }]} />
      <div className="w-full px-4 sm:px-6">
        <AlertsClient initialAlerts={initialAlerts} initialTotal={initialTotal} initialPage={1} pageSize={limit} />
      </div>
    </div>
  );
}
