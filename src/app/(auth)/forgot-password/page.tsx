'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useBranding } from '@/lib/branding-context';

function ForgotPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { branding } = useBranding();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Always advance — the response is deliberately the same either way.
      toast.success('If that email has an account, a code is on its way.');
      setStep('code');
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6 || password.length < 8) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), password }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        toast.success('Password updated — sign in with your new password.');
        router.push('/login');
      } else {
        toast.error(json.error || 'Could not reset the password.');
      }
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {step === 'email' ? 'Reset your password' : 'Enter your code'}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {step === 'email'
              ? `We'll email a 6-digit code to reset your ${branding.companyName} password.`
              : `Enter the code sent to ${email} and choose a new password.`}
          </p>
        </div>

        {step === 'email' ? (
          <form onSubmit={requestCode} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-gray-700 dark:text-gray-300">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="h-11 bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"
              />
            </div>
            <Button type="submit" disabled={loading || !email.trim()} className="w-full h-11 bg-[hsl(var(--primary))] hover:brightness-90 text-white font-semibold">
              {loading ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitReset} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="code" className="text-sm font-medium text-gray-700 dark:text-gray-300">6-digit code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                disabled={loading}
                className="h-11 tracking-[0.3em] text-center bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-sm font-medium text-gray-700 dark:text-gray-300">New password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="h-11 pr-10 bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              disabled={loading || code.trim().length < 6 || password.length < 8}
              className="w-full h-11 bg-[hsl(var(--primary))] hover:brightness-90 text-white font-semibold"
            >
              {loading ? 'Updating…' : 'Set new password'}
            </Button>
            <button
              type="button"
              onClick={() => { setStep('email'); setCode(''); setPassword(''); }}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Use a different email / resend code
            </button>
          </form>
        )}

        <Link href="/login" className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--primary))] hover:opacity-80">
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordInner />
    </Suspense>
  );
}
