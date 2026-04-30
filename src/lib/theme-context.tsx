'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  // Load theme from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    setTheme(initialTheme);
    applyTheme(initialTheme);
    setMounted(true);
  }, []);

  const applyTheme = (newTheme: Theme) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (newTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  };

  const toggleTheme = () => {
    if (typeof window === 'undefined') return;
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  // Provide context value even before mount so components can render
  const value = { theme, toggleTheme };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  // Create a fallback toggle function that works even without context
  const fallbackToggle = () => {
    if (typeof window === 'undefined') return;

    const currentTheme = (localStorage.getItem('theme') as Theme) || 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    const root = document.documentElement;
    if (newTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', newTheme);
    // Trigger a re-render by dispatching a custom event
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: newTheme } }));
  };

  // Return context if available, otherwise return default with working fallback
  if (context === undefined) {
    return {
      theme: (typeof window !== 'undefined' ? (localStorage.getItem('theme') as Theme) : null) || 'dark' as Theme,
      toggleTheme: fallbackToggle
    };
  }
  return context;
}

