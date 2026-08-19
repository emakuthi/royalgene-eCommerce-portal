'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, Check, X } from 'lucide-react';
import { useTheme } from '@/lib/theme-context';
import { checkSlugAvailable } from '@/lib/organizations';
import { getOrgUrl } from '@/lib/urls';

type SlugStatus = 'idle' | 'checking' | 'available' | 'unavailable';

export default function SignupPage() {
  const { theme } = useTheme();
  const pageBg = theme === 'dark' ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700' : 'bg-gradient-to-br from-purple-900 via-purple-800 to-purple-700';
  const backLinkClass = theme === 'dark' ? 'inline-flex items-center gap-2 text-white mb-8 hover:text-gray-200 transition' : 'inline-flex items-center gap-2 text-white mb-8 hover:text-purple-200 transition';

  const [loading, setLoading] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');
  const [slugTouched, setSlugTouched] = useState(false);
  const [signupOpen, setSignupOpen] = useState<boolean | null>(null); // null = still checking
  const [formData, setFormData] = useState({
    orgName: '',
    slug: '',
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/signup-status')
      .then((res) => res.json())
      .then((json) => { if (!cancelled) setSignupOpen(json?.data?.enabled !== false); })
      .catch(() => { if (!cancelled) setSignupOpen(true); }); // fail open — don't block signup on a flaky check
    return () => { cancelled = true; };
  }, []);

  // Debounced slug availability check
  useEffect(() => {
    if (!formData.slug) {
      setSlugStatus('idle');
      return;
    }
    setSlugStatus('checking');
    const t = setTimeout(async () => {
      const result = await checkSlugAvailable(formData.slug);
      const available = Boolean((result.data as { available?: boolean } | undefined)?.available);
      setSlugStatus(available ? 'available' : 'unavailable');
    }, 400);
    return () => clearTimeout(t);
  }, [formData.slug]);

  const slugify = (input: string) =>
    input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

  const handleOrgNameChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      orgName: value,
      slug: slugTouched ? prev.slug : slugify(value),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (formData.password.length < 8) {
      toast.error('Password must be at least 8 characters long');
      return;
    }
    if (slugStatus === 'unavailable') {
      toast.error('That workspace URL is already taken');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgName: formData.orgName,
          slug: formData.slug,
          name: formData.name,
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Workspace created! Setting things up…');
        const { token, organization, user } = data.data;
        const params = new URLSearchParams({ token, name: user.name || '' });
        window.location.href = getOrgUrl(organization.slug, `/session-bridge?${params.toString()}`);
      } else {
        toast.error(data.error || 'Signup failed');
      }
    } catch (error) {
      console.error('Signup error:', error);
      toast.error('An error occurred during signup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen ${pageBg} flex items-center justify-center p-4`}>
      <div className="w-full max-w-md">
        <Link href="/" className={backLinkClass}>
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Home</span>
        </Link>

        <Card className="border-0 shadow-2xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center">Create your workspace</CardTitle>
            <CardDescription className="text-center">
              {signupOpen === false ? 'Self-service signup is currently closed' : 'Set up Royal Gene Portal for your business'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {signupOpen === false ? (
              <div className="text-center py-4">
                <p className="text-sm text-gray-600">
                  We&apos;re not accepting self-service signups right now. Contact us and we&apos;ll get your workspace set up.
                </p>
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="orgName">Business Name</Label>
                <Input
                  id="orgName"
                  type="text"
                  required
                  placeholder="Acme Retail Ltd"
                  value={formData.orgName}
                  onChange={(e) => handleOrgNameChange(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div>
                <Label htmlFor="slug">Workspace URL</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="slug"
                    type="text"
                    required
                    placeholder="acme"
                    value={formData.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setFormData({ ...formData, slug: slugify(e.target.value) });
                    }}
                    disabled={loading}
                  />
                  {slugStatus === 'available' && <Check className="h-4 w-4 shrink-0 text-green-600" />}
                  {slugStatus === 'unavailable' && <X className="h-4 w-4 shrink-0 text-destructive" />}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {formData.slug ? `${formData.slug}.royalgene.app` : 'Choose a subdomain for your team'}
                </p>
              </div>

              <div>
                <Label htmlFor="name">Your Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  required
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  disabled={loading}
                />
              </div>

              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="your@email.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={loading}
                />
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  disabled={loading}
                />
                <p className="text-xs text-gray-500 mt-1">Minimum 8 characters</p>
              </div>

              <div>
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  disabled={loading}
                />
              </div>

              <Button
                type="submit"
                disabled={loading || slugStatus === 'unavailable' || slugStatus === 'checking'}
                className="w-full bg-[hsl(var(--primary))] hover:brightness-90 text-white"
              >
                {loading ? 'Creating workspace...' : 'Create workspace'}
              </Button>
            </form>
            )}

            <div className="mt-6 text-center text-sm">
              <p className="text-gray-600">
                Already have a workspace?{' '}
                <Link href="/login" className="text-[hsl(var(--primary))] hover:opacity-80 font-medium">
                  Log in
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
