'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHydratedAuth } from '@/lib/hooks';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import PortalHeader from '@/components/portal/PortalHeader';

function PortalSettingsContent() {
  const { user, token, setAuth } = useHydratedAuth();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => {
    setMounted(true);
    if (user) {
      setFormData(prev => ({
        ...prev,
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
      }));
    }
  }, [user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Optimistic update: update local auth store immediately so UI reflects changes
    const previousUser = user;
    try {
      if (setAuth && user) {
        const optimisticUser = { ...user, name: formData.name, phone: formData.phone } as typeof user;
        // setAuth expects (user, token)
        setAuth(optimisticUser, token || '');
      }

      const response = await fetch('/api/portal/settings/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: formData.name,
          phone: formData.phone,
        }),
      });

      const data = await response.json();

      if (data.success && data.data) {
        // Ensure store matches authoritative server response (may include normalized fields)
        if (setAuth) {
          setAuth({ ...user, ...data.data }, token || '');
        }
        // show inline saved badge and toast
        setSaved(true);
        toast.success('Profile updated successfully');
        // hide saved badge after 3 seconds
        setTimeout(() => setSaved(false), 3000);
      } else {
        // Revert optimistic update
        if (setAuth && previousUser) setAuth(previousUser, token || '');
        toast.error(data.error || 'Failed to update profile');
      }
    } catch (error) {
      console.error('Profile update error:', error);
      // Revert optimistic update
      if (setAuth && previousUser) setAuth(previousUser, token || '');
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (formData.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/portal/settings/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Password changed successfully');
        setEditingPassword(false);
        setFormData(prev => ({
          ...prev,
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        }));
      } else {
        toast.error(data.error || 'Failed to change password');
      }
    } catch (error) {
      console.error('Password change error:', error);
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // If the auth state isn't mounted yet, show a spinner
  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  // Show a friendly message if the user isn't authenticated
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Not signed in</h2>
          <p className="text-sm text-gray-600 mb-4">Please sign in to manage your portal settings.</p>
          <Link href="/auth/login">
            <Button>Sign in</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Try to read shop/portalUser info from user metadata if available
  // (Some apps store portal/shop relation in the user's session/metadata)
  const userMeta = user as unknown as { currentShop?: { name?: string; location?: string }; position?: string };
  const shop = userMeta.currentShop ?? null;
  const portalPosition = userMeta.position ?? 'N/A';

  return (
    <div className="w-full bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <PortalHeader
        backHref="/portal/dashboard"
        title="Settings"
        description="Manage your portal account"
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Settings' }]}
        actions={<></>}
      />

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-12">
        {/* Shop Information - render only if present */}
        <Card className="mb-3">
          <CardHeader>
            <CardTitle>Shop Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {shop ? (
              <>
                <div>
                  <Label className="text-xs text-gray-500">Shop Name</Label>
                  <p className="font-medium">{shop.name}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Location</Label>
                  <p className="font-medium">{shop.location}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Your Position</Label>
                  <p className="font-medium capitalize">{portalPosition}</p>
                </div>
              </>
            ) : (
              <div>
                <p className="text-sm text-gray-600">No shop selected. Shop-specific settings will appear here when available.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profile Information */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div>
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  disabled={loading}
                />
              </div>

              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  disabled
                  className="opacity-50 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
              </div>

              <div>
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={loading}
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {loading ? 'Updating...' : 'Update Profile'}
              </Button>
              {/* inline saved badge */}
              {saved && (
                <span className="inline-flex items-center gap-2 ml-3 text-green-700 bg-green-50 border border-green-100 px-2 py-1 rounded-full text-sm animate-pulse">
                  <Check className="w-4 h-4" />
                  Saved
                </span>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <CardContent>
            {!editingPassword ? (
              <Button
                onClick={() => setEditingPassword(true)}
                variant="outline"
              >
                Change Password
              </Button>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={formData.currentPassword}
                    onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                    disabled={loading}
                  />
                </div>

                <div>
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={formData.newPassword}
                    onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                    disabled={loading}
                  />
                  <p className="text-xs text-gray-500 mt-1">Minimum 8 characters</p>
                </div>

                <div>
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    disabled={loading}
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    type="submit"
                    disabled={loading}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {loading ? 'Updating...' : 'Update Password'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingPassword(false);
                      setFormData(prev => ({
                        ...prev,
                        currentPassword: '',
                        newPassword: '',
                        confirmPassword: '',
                      }));
                    }}
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function PortalSettingsPage() {
  return (
    <PortalSettingsContent />
  );
}
