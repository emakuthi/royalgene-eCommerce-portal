'use client';

import React from 'react';
import { X } from 'lucide-react';

interface HeaderCloseProps {
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
}

export default function HeaderClose({ onClick, className = '', ariaLabel = 'Close' }: HeaderCloseProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${className}`}
    >
      <X />
    </button>
  );
}

