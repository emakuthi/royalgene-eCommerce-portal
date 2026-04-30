'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type SignOutContextType = {
  open: () => void;
};

const SignOutContext = createContext<SignOutContextType | null>(null);

export const useSignOut = () => {
  const ctx = useContext(SignOutContext);
  if (!ctx) throw new Error('useSignOut must be used within a SignOutProvider');
  return ctx;
};

export function SignOutProvider({ children, onConfirmAction }: { children: React.ReactNode; onConfirmAction: () => void }) {
  const [open, setOpen] = useState(false);
  const lastActive = useRef<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const openModal = useCallback(() => {
    lastActive.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setOpen(false);
    // restore focus
    requestAnimationFrame(() => lastActive.current?.focus());
  }, []);

  const handleConfirm = useCallback(() => {
    try {
      onConfirmAction();
    } finally {
      closeModal();
    }
  }, [onConfirmAction, closeModal]);

  // focus trap implementation
  useEffect(() => {
    if (!open) return;
    const modal = modalRef.current;
    if (!modal) return;

    const focusable = modal.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
        return;
      }

      if (e.key === 'Tab') {
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        // forward
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        // backward
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    // focus confirm by default
    requestAnimationFrame(() => {
      confirmRef.current?.focus();
      if (!confirmRef.current) first?.focus();
    });

    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeModal]);

  return (
    <SignOutContext.Provider value={{ open: openModal }}>
      {children}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />

          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="signout-title"
            className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6"
          >
            <h3 id="signout-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              Confirm sign out
            </h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Are you sure you want to sign out? You will be redirected to the home page and your portal session will be closed.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                ref={confirmRef}
                className="bg-destructive text-destructive-foreground hover:brightness-95"
                onClick={handleConfirm}
              >
                Sign out
              </Button>
            </div>
          </div>
        </div>
      )}
    </SignOutContext.Provider>
  );
}

export default SignOutProvider;
