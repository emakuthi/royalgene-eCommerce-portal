'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useHydratedAuth } from '@/lib/hooks';

export default function PortalPage() {
  const router = useRouter();
  const { user, mounted } = useHydratedAuth();

  useEffect(() => {
    // Only redirect if we've mounted and have determined auth state
    if (!mounted) return;

    try {
      if (!user) {
        // Not logged in, redirect to portal login
        router.push('/portal/login');
      } else if (user.role === 'portal_user' || user.role === 'admin' || user.role === 'super_admin') {
        // Portal user, admin, or super_admin, redirect to dashboard
        router.push('/portal/dashboard');
      } else {
        // Other roles, redirect to home
        router.push('/');
      }
    } catch (error) {
      console.error('Portal redirect error:', error);
      // Fallback to login
      router.push('/portal/login');
    }
  }, [mounted, user, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="text-center">
        <div className="inline-flex items-center gap-3 pl-3">
          <div className="w-2 h-2 bg-purple-600 rounded-full animate-bounce bounce-delay-0"></div>
          <div className="w-2 h-2 bg-purple-600 rounded-full animate-bounce bounce-delay-200"></div>
          <div className="w-2 h-2 bg-purple-600 rounded-full animate-bounce bounce-delay-400"></div>
        </div>
        <p className="text-gray-600 dark:text-gray-400">Loading portal...</p>
      </div>
    </div>
  );
}
