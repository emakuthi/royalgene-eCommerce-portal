'use client';

import { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import { Eye, EyeOff, Store, ShieldCheck, BarChart3, Package } from 'lucide-react';
import { useBranding } from '@/lib/branding-context';
import { extractSubdomain, ROOT_DOMAIN } from '@/lib/tenant';
import { getGoogleStartUrl, getFacebookStartUrl } from '@/lib/social-auth-urls';

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
	google_not_configured: 'Google sign-in isn’t set up yet. Contact your administrator.',
	facebook_not_configured: 'Facebook sign-in isn’t set up yet. Contact your administrator.',
	google_signin_failed: 'Google sign-in failed. Please try again.',
	facebook_signin_failed: 'Facebook sign-in failed. Please try again.',
	google_state_mismatch: 'That sign-in link expired. Please try again.',
	facebook_state_mismatch: 'That sign-in link expired. Please try again.',
	google_email_not_verified: 'Your Google account email is not verified.',
};

const FEATURES = [
	{ icon: Store, label: 'Shop Management', desc: 'Manage all your shop locations in one place' },
	{ icon: Package, label: 'Inventory Control', desc: 'Real-time stock tracking and alerts' },
	{ icon: BarChart3, label: 'Sales Analytics', desc: 'Detailed insights and performance reports' },
	{ icon: ShieldCheck, label: 'Secure Access', desc: 'Role-based access control for your team' },
];

export default function PortalLoginPage() {
	return (
		<Suspense fallback={null}>
			<PortalLoginPageInner />
		</Suspense>
	);
}

function PortalLoginPageInner() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { setAuth, mounted } = useHydratedAuth();
	const { setCurrentShop, setCurrentPortalUser } = usePortalStore();
	const [loading, setLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [formData, setFormData] = useState({ email: '', password: '' });
	const { branding } = useBranding();

	useEffect(() => {
		const error = searchParams.get('error');
		if (error) toast.error(OAUTH_ERROR_MESSAGES[error] || 'Sign-in failed. Please try again.');
	}, [searchParams]);

	const currentTenantSlug = mounted ? extractSubdomain(window.location.host, ROOT_DOMAIN) : null;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		try {
			const response = await fetch('/api/portal/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(formData),
			});
			const data = await response.json();
			if (data.success) {
				setAuth(data.data.user, data.data.token);
				if (data.data.portalUser) setCurrentPortalUser(data.data.portalUser);
				if (data.data.shop) setCurrentShop(data.data.shop);
				toast.success('Welcome back! Redirecting to dashboard…');
				router.push('/dashboard');
			} else {
				toast.error(data.error || 'Login failed. Please check your credentials.');
			}
		} catch {
			toast.error('An error occurred. Please try again.');
		} finally {
			setLoading(false);
		}
	};

	if (!mounted) return null;

	const logoSrc = branding.logoUrl ?? '/logo.png';

	return (
		<div className="min-h-screen flex">
			{/* ── Left panel – branding ─────────────────────────────── */}
			<div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-purple-900 via-purple-800 to-fuchsia-900 flex-col justify-between p-12">
				{/* decorative blobs */}
				<div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
				<div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-fuchsia-400/10 blur-3xl" />
				<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-purple-600/10 blur-3xl" />

				{/* Logo */}
				<div className="relative z-10 flex items-center gap-3">
					<div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center overflow-hidden">
						<Image src={logoSrc} alt={branding.companyName} width={32} height={32} className="object-contain" unoptimized />
					</div>
					<div>
						<p className="text-white font-bold text-lg leading-none">{branding.companyName}</p>
						<p className="text-purple-200 text-xs leading-none mt-0.5">{branding.tagline}</p>
					</div>
				</div>

				{/* Hero copy */}
				<div className="relative z-10 space-y-6">
					<div>
						<h1 className="text-4xl font-bold text-white leading-tight">
							Run your shops
							<br />
							<span className="text-fuchsia-300">smarter &amp; faster.</span>
						</h1>
						<p className="mt-4 text-purple-200 text-base leading-relaxed max-w-sm">
							Everything you need to manage inventory, track sales, and grow your business — all in one dashboard.
						</p>
					</div>

					{/* Feature list */}
					<ul className="space-y-4">
						{FEATURES.map(({ icon: Icon, label, desc }) => (
							<li key={label} className="flex items-start gap-3">
								<div className="mt-0.5 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
									<Icon className="w-4 h-4 text-fuchsia-300" />
								</div>
								<div>
									<p className="text-white text-sm font-semibold">{label}</p>
									<p className="text-purple-300 text-xs">{desc}</p>
								</div>
							</li>
						))}
					</ul>
				</div>

				{/* Bottom note */}
				<div className="relative z-10 text-purple-300 text-xs">
					© {new Date().getFullYear()} {branding.companyName}. Authorised staff only.
				</div>
			</div>

			{/* ── Right panel – form ────────────────────────────────── */}
			<div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 bg-white dark:bg-gray-950">
				{/* Mobile logo */}
				<div className="lg:hidden mb-8 flex items-center gap-3">
					<div className="w-10 h-10 rounded-xl bg-[hsl(var(--primary))] flex items-center justify-center overflow-hidden">
						<Image src={logoSrc} alt={branding.companyName} width={32} height={32} className="object-contain" unoptimized />
					</div>
					<div>
						<p className="font-bold text-lg text-gray-900 dark:text-white leading-none">{branding.companyName}</p>
						<p className="text-[hsl(var(--primary))] text-xs leading-none mt-0.5">{branding.tagline}</p>
					</div>
				</div>

				<div className="w-full max-w-sm">
					{/* Heading */}
					<div className="mb-8">
						<h2 className="text-2xl font-bold text-gray-900 dark:text-white">Sign in to Portal</h2>
						<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Enter your credentials to access the dashboard</p>
					</div>

					{/* Form */}
					<form onSubmit={handleSubmit} className="space-y-5">
						<div className="space-y-1.5">
							<Label htmlFor="email" className="text-sm font-medium text-gray-700 dark:text-gray-300">
								Email address
							</Label>
							<Input
								id="email"
								type="email"
								required
								autoComplete="email"
								placeholder="you@royalgene.com"
								value={formData.email}
								onChange={(e) => setFormData({ ...formData, email: e.target.value })}
								disabled={loading}
								className="h-11 bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 focus-visible:ring-purple-500"
							/>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-gray-300">
								Password
							</Label>
							<div className="relative">
								<Input
									id="password"
									type={showPassword ? 'text' : 'password'}
									required
									autoComplete="current-password"
									placeholder="••••••••"
									value={formData.password}
									onChange={(e) => setFormData({ ...formData, password: e.target.value })}
									disabled={loading}
									className="h-11 pr-10 bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 focus-visible:ring-purple-500"
								/>
								<button
									type="button"
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									onClick={() => setShowPassword((v) => !v)}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
									tabIndex={-1}
								>
									{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
								</button>
							</div>
						</div>

						<Button
							type="submit"
							disabled={loading}
							className="w-full h-11 bg-[hsl(var(--primary))] hover:brightness-90 text-white font-semibold text-sm rounded-lg transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-60"
						>
							{loading ? (
								<span className="flex items-center gap-2">
									<span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
									Signing in…
								</span>
							) : (
								'Sign In'
							)}
						</Button>
					</form>

					{/* Social sign-in */}
					<div className="mt-6">
						<div className="relative text-center">
							<div className="absolute inset-0 flex items-center">
								<span className="w-full border-t border-gray-200 dark:border-gray-800" />
							</div>
							<span className="relative bg-white dark:bg-gray-950 px-3 text-xs text-gray-400 dark:text-gray-500">Or continue with</span>
						</div>
						<div className="mt-4 flex justify-center gap-3">
							<a
								href={getGoogleStartUrl(currentTenantSlug)}
								aria-label="Sign in with Google"
								className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 transition hover:brightness-95"
							>
								<svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
									<path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87z" />
									<path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.11 0-5.75-2.1-6.69-4.92H1.3v3.09A11.99 11.99 0 0 0 12 24z" />
									<path fill="#FBBC05" d="M5.31 14.33A7.2 7.2 0 0 1 4.93 12c0-.81.14-1.6.38-2.33V6.58H1.3A11.99 11.99 0 0 0 0 12c0 1.94.46 3.77 1.3 5.42l4.01-3.09z" />
									<path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.3 6.58l4.01 3.09C6.25 6.85 8.89 4.75 12 4.75z" />
								</svg>
							</a>
							<a
								href={getFacebookStartUrl(currentTenantSlug)}
								aria-label="Sign in with Facebook"
								className="flex h-11 w-11 items-center justify-center rounded-full transition hover:brightness-95"
								style={{ backgroundColor: '#1877F2' }}
							>
								<svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden="true">
									<path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.89h2.78l-.44 2.91h-2.34V22c4.78-.79 8.44-4.94 8.44-9.94z" />
								</svg>
							</a>
						</div>
					</div>

					{/* Register link */}
					<p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
						Need portal access?{' '}
						<Link href="/register" className="font-medium text-[hsl(var(--primary))] hover:opacity-80 transition">
							Request an account
						</Link>
					</p>

					{/* Divider */}
					<div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 text-center">
						<p className="text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center gap-1.5">
							<ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
							Authorised personnel only. All access is logged.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
