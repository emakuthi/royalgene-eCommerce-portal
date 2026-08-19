'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import { Eye, EyeOff, Store, ShieldCheck, BarChart3, Package } from 'lucide-react';
import { loadBranding, BRANDING_EVENT, type BrandingConfig } from '@/lib/branding';

const FEATURES = [
	{ icon: Store, label: 'Shop Management', desc: 'Manage all your shop locations in one place' },
	{ icon: Package, label: 'Inventory Control', desc: 'Real-time stock tracking and alerts' },
	{ icon: BarChart3, label: 'Sales Analytics', desc: 'Detailed insights and performance reports' },
	{ icon: ShieldCheck, label: 'Secure Access', desc: 'Role-based access control for your team' },
];

export default function PortalLoginPage() {
	const router = useRouter();
	const { setAuth, mounted } = useHydratedAuth();
	const { setCurrentShop, setCurrentPortalUser } = usePortalStore();
	const [loading, setLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [formData, setFormData] = useState({ email: '', password: '' });
	const [branding, setBranding] = useState<BrandingConfig>({
		logoSrc: null,
		companyName: 'Royal Gene',
		tagline: 'Management Portal',
	});

	useEffect(() => {
		setBranding(loadBranding());
		const handler = (e: Event) => setBranding((e as CustomEvent).detail as BrandingConfig);
		window.addEventListener(BRANDING_EVENT, handler);
		return () => window.removeEventListener(BRANDING_EVENT, handler);
	}, []);

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

	const logoSrc = branding.logoSrc ?? '/logo.png';
	const usingCustomLogo = Boolean(branding.logoSrc);

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
					{usingCustomLogo ? (
						<>
							<div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center overflow-hidden">
								<Image src={logoSrc} alt={branding.companyName} width={32} height={32} className="object-contain" unoptimized />
							</div>
							<div>
								<p className="text-white font-bold text-lg leading-none">{branding.companyName}</p>
								<p className="text-purple-200 text-xs leading-none mt-0.5">{branding.tagline}</p>
							</div>
						</>
					) : (
						<div className="bg-white/95 rounded-xl px-3 py-2 shadow-sm">
							<Image src={logoSrc} alt={branding.companyName} width={168} height={52} className="object-contain h-9 w-auto" />
						</div>
					)}
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
					{usingCustomLogo ? (
						<>
							<div className="w-10 h-10 rounded-xl bg-[hsl(var(--primary))] flex items-center justify-center overflow-hidden">
								<Image src={logoSrc} alt={branding.companyName} width={32} height={32} className="object-contain" unoptimized />
							</div>
							<div>
								<p className="font-bold text-lg text-gray-900 dark:text-white leading-none">{branding.companyName}</p>
								<p className="text-[hsl(var(--primary))] text-xs leading-none mt-0.5">{branding.tagline}</p>
							</div>
						</>
					) : (
						<Image src={logoSrc} alt={branding.companyName} width={168} height={52} className="object-contain h-10 w-auto" />
					)}
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
