'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useHydratedAuth } from '@/lib/hooks';
import { toast } from 'sonner';

interface AdminProtectedProps {
  children: React.ReactNode;
}

/**
 * Admin Protected Wrapper Component
 * Ensures only admin and super_admin users can access wrapped content
 */
export function AdminProtected({ children }: AdminProtectedProps) {
  const router = useRouter();
  const { user, token, mounted } = useHydratedAuth();

  useEffect(() => {
    // Only check auth after component is mounted and store is hydrated
    if (!mounted) return;

    // Check if user is authenticated and has admin role
    if (!user || !token) {
      toast.error('Authentication required');
      router.push('/auth/login');
      return;
    }

    if (user.role !== 'admin' && user.role !== 'super_admin') {
      toast.error('Admin access required');
      router.push('/');
      return;
    }
  }, [mounted, user, token, router]);

  // Show nothing while checking authentication
  if (!mounted || !user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return null;
  }

  return <>{children}</>;
}

