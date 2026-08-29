import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import ClientBody from './ClientBody';
import { Toaster } from '@/components/ui/sonner';
import React from 'react';
import { getTenantBranding } from '@/lib/branding.server';
import { BRANDING_DEFAULTS } from '@/lib/branding';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const DEFAULT_ICONS: Metadata['icons'] = {
  icon: [
    { url: '/favicon.ico', sizes: 'any' },
    { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
    { url: '/favicon-192.png', type: 'image/png', sizes: '192x192' },
  ],
  apple: '/apple-touch-icon.png',
};

export async function generateMetadata(): Promise<Metadata> {
  const orgId = (await headers()).get('x-org-id');
  const branding = await getTenantBranding(orgId);
  return {
    title: `${branding.companyName} Portal`,
    description: `${branding.companyName} – Shop Management Portal`,
    icons: branding.faviconUrl
      ? { icon: branding.faviconUrl, apple: branding.faviconUrl }
      : DEFAULT_ICONS,
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const orgId = (await headers()).get('x-org-id');
  const branding = orgId ? await getTenantBranding(orgId) : BRANDING_DEFAULTS;

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body suppressHydrationWarning className="antialiased">
        <ClientBody initialBranding={branding}>
          <Toaster />
          {children}
        </ClientBody>
      </body>
    </html>
  );
}
