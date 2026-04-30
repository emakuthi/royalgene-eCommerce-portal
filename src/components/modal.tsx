'use client';

import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';

interface ModalProps {
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

export default function Modal({ children, onClose, className = '' }: ModalProps) {
  useEffect(() => {
    // Lock body scroll while modal open
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // Close on ESC key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        onClose?.();
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return ReactDOM.createPortal(
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${className}`} role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Center the children directly. Avoid extra padding or background so the child Card controls visuals */}
      <div className="relative w-full max-w-4xl max-h-[calc(100vh-4rem)]" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}
