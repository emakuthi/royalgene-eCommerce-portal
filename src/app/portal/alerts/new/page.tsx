import React from 'react';
import AlertsNewForm from '@/components/portal/AlertsNewForm';
import PortalHeader from '@/components/portal/PortalHeader';

export default function Page() {
  return (
      <div className="w-full bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <PortalHeader
        backHref="/portal/alerts"
        title="Create New Alert"
        description="Create an alert for your shop"
        breadcrumbs={[
          { label: 'Portal', href: '/portal' },
          { label: 'Alerts', href: '/portal/alerts' },
          { label: 'New' },
        ]}
      />
      <div className="w-full px-4 sm:px-6 max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-3">Create New Alert</h1>
        <p className="text-sm text-gray-600 mb-4">
          Create a system alert for portals and shops.
        </p>
        <AlertsNewForm />
      </div>
    </div>
  );
}
