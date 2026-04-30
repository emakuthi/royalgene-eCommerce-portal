'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useHydratedAuth } from '@/lib/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import SignOutProvider from '@/components/portal/SignOutProvider';

interface PortalProtectedProps {
  children: React.ReactNode;
  requiredRole?: 'portal_user' | 'admin' | 'super_admin';
  pageName?: string;
}

/**
 * Component to protect portal routes from unauthorized access
 * Ensures only portal_user, admin, or super_admin users can access protected content
 * Super admin has access to all portal pages
 */
export function PortalProtected({
  children,
  requiredRole = 'portal_user',
  pageName = 'This page'
}: PortalProtectedProps) {
  const router = useRouter();
  const { user, mounted, logout } = useHydratedAuth();
  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState<{
    title: string;
    message: string;
    action: string;
  } | null>(null);

  // portal context store
  const portalStore = usePortalStore();

  useEffect(() => {
    if (!mounted) return;

    if (!user) {
      setAuthError({
        title: 'Authentication Required',
        message: `${pageName} requires you to be logged in to the portal. Please log in with your portal credentials to access this page.`,
        action: 'Login to Portal'
      });
      return;
    }

    // Super admin has access to everything
    if (user.role === 'super_admin') {
      setAuthorized(true);
      return;
    }

    const role = user.role as 'customer' | 'admin' | 'super_admin' | 'portal_user';
    let allowedRoles: Array<'customer' | 'admin' | 'super_admin' | 'portal_user'>;

    if (requiredRole === 'super_admin') {
      allowedRoles = ['super_admin'];
    } else if (requiredRole === 'admin') {
      allowedRoles = ['admin', 'super_admin'];
    } else {
      // default: portal_user
      allowedRoles = ['portal_user', 'admin', 'super_admin'];
    }

    if (!allowedRoles.includes(role)) {
      if (requiredRole === 'admin') {
        setAuthError({
          title: 'Admin Access Required',
          message: `${pageName} is only available to administrators. Your current role (${role}) does not have permission to access this page. Please contact your administrator for more information.`,
          action: 'Go to Dashboard'
        });
        return;
      }

      setAuthError({
        title: 'Portal Access Required',
        message: `${pageName} requires a portal account. Your current user role (${role}) does not have portal access. Please log in with a portal user account or contact your administrator.`,
        action: 'Return to Home'
      });
      return;
    }

    setAuthorized(true);
  }, [user, mounted, requiredRole, pageName]);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading portal...</p>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
        <Card className="w-full max-w-md border-2 border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950">
          <CardHeader>
            <div className="flex items-start gap-4">
              <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <CardTitle className="text-amber-900 dark:text-amber-100">{authError.title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
              {authError.message}
            </p>
            <div className="space-y-2">
              <Button asChild className="w-full bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600">
                <Link href="/portal/login" className="flex items-center justify-center gap-2">
                  {authError.action}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push('/portal/dashboard')}
              >
                Back to Dashboard
              </Button>
            </div>
            <div className="pt-4 border-t border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Need help? Contact your administrator or refer to the portal documentation.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  const confirmSignOutAction = () => {
    try {
      logout?.();
      portalStore.clearPortalContext?.();
      toast.success('Logged out successfully');
      router.push('/');
    } catch (err) {
      console.error('Error during logout:', err);
      toast.error('Failed to sign out. Please try again.');
    }
  };

  return (
    <SignOutProvider onConfirmAction={confirmSignOutAction}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </SignOutProvider>
  );
}

export default PortalProtected;

