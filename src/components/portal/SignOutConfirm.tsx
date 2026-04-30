'use client';

import React, { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

interface SignOutConfirmProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const SignOutConfirm: React.FC<SignOutConfirmProps> = ({ open, onConfirm, onCancel }) => {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', onKey);
    // focus confirm button when opened
    confirmRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />

      <div
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
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            className="bg-destructive text-destructive-foreground hover:brightness-95"
            onClick={onConfirm}
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SignOutConfirm;

