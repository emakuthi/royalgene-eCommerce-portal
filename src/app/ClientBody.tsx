'use client';
import { useEffect, useState } from 'react';
import { ThemeProvider as AppThemeProvider, useTheme } from '@/lib/theme-context';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { lightTheme, darkTheme } from '@/lib/mui-theme';
import createEmotionCache from '@/lib/emotion-cache';
import { CacheProvider } from '@emotion/react';
import { BrandingProvider } from '@/lib/branding-context';
import { BRANDING_DEFAULTS, type TenantBranding } from '@/lib/branding';
import DynamicFavicon from '@/components/DynamicFavicon';

const clientCache = createEmotionCache();

export default function ClientBody({
  children,
  initialBranding = BRANDING_DEFAULTS,
}: {
  children: React.ReactNode;
  initialBranding?: TenantBranding;
}) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    document.body.className = 'antialiased';
    setHydrated(true);
  }, []);

  return (
    <AppThemeProvider>
      <BrandingProvider initial={initialBranding}>
        <DynamicFavicon />
        {hydrated ? (
          <InnerMuiProvider>{children}</InnerMuiProvider>
        ) : (
          <div className="antialiased">{children}</div>
        )}
      </BrandingProvider>
    </AppThemeProvider>
  );
}

function InnerMuiProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const selectedTheme = theme === 'dark' ? darkTheme : lightTheme;
  return (
    <CacheProvider value={clientCache}>
      <MuiThemeProvider theme={selectedTheme}>
        <CssBaseline />
        <div className="antialiased">{children}</div>
      </MuiThemeProvider>
    </CacheProvider>
  );
}
