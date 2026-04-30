import { useEffect, useState } from 'react';
import { useAuthStore, usePortalStore } from './store';
import { isTokenExpired } from './auth';
import logger from './client-logger';

/**
 * Custom hook to properly hydrate Zustand stores
 * Fixes issue where stores with skipHydration:true don't load from localStorage on first render
 */
export function useHydratedAuth() {
  const [mounted, setMounted] = useState(false);
  const authState = useAuthStore();

  useEffect(() => {
    // Rehydrate from localStorage on client-side
    // Zustand with skipHydration needs manual trigger
    if (typeof window !== 'undefined') {
      useAuthStore.persist.rehydrate();
    }

    // After rehydration, invalidate expired tokens so UI shows logged out state
    // We run this slightly after to allow the store to populate
    const checkExpired = () => {
      try {
        const token = useAuthStore.getState().token;
        if (isTokenExpired(token)) {
          // clear auth
          useAuthStore.getState().logout();
          // Also clear portal context if present
          if (usePortalStore.getState().clearPortalContext) {
            usePortalStore.getState().clearPortalContext();
          }
        }
      } catch (err) {
        // Avoid importing the server logger into client bundles — use console on client
        try { console.warn('Error checking token expiry', err); } catch (_) { /* ignore */ }
      }
    };

    // Slight delay to ensure rehydrate completed
    const t = setTimeout(() => {
      checkExpired();
      setMounted(true);
    }, 0);

    // Poll expiry periodically while mounted to catch tokens that expire during the session
    let intervalId: number | undefined;
    const startPolling = () => {
      // check every 15 seconds
      intervalId = window.setInterval(() => {
        try {
          const token = useAuthStore.getState().token;
          if (isTokenExpired(token)) {
            useAuthStore.getState().logout();
            if (usePortalStore.getState().clearPortalContext) {
              usePortalStore.getState().clearPortalContext();
            }
          }
        } catch (err) {
          try { console.warn('Error polling token expiry', err); } catch (_) { /* ignore */ }
        }
      }, 15000);
    };

    // Start polling after mount
    startPolling();

    return () => {
      clearTimeout(t);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  return {
    ...authState,
    mounted,
  };
}

/**
 * Custom hook to properly hydrate the portal store
 * Fixes issue where portal context doesn't load from localStorage on first render
 */
export function useHydratedPortal() {
  const [mounted, setMounted] = useState(false);
  const portalState = usePortalStore();

  useEffect(() => {
    // Rehydrate from localStorage on client-side
    if (typeof window !== 'undefined') {
      usePortalStore.persist.rehydrate();
    }
    setMounted(true);
  }, []);

  return {
    ...portalState,
    mounted,
  };
}
