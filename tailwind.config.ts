import type { Config } from "tailwindcss";
import tailwindAnimate from 'tailwindcss-animate';

export default {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      /*
       * ── Fluid Font Sizes ─────────────────────────────────────────────
       * Use text-fluid-xs … text-fluid-display for smooth viewport scaling.
       * ─────────────────────────────────────────────────────────────────
       */
      fontSize: {
        // Standard scale (explicit line-heights for tighter control)
        'xs':   ['0.75rem',  { lineHeight: '1rem' }],
        'sm':   ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem',     { lineHeight: '1.625rem' }],
        'lg':   ['1.125rem', { lineHeight: '1.75rem' }],
        'xl':   ['1.25rem',  { lineHeight: '1.875rem' }],
        '2xl':  ['1.5rem',   { lineHeight: '2rem' }],
        '3xl':  ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl':  ['2.25rem',  { lineHeight: '2.5rem' }],
        '5xl':  ['3rem',     { lineHeight: '1.15' }],
        '6xl':  ['3.75rem',  { lineHeight: '1.1' }],
        '7xl':  ['4.5rem',   { lineHeight: '1.05' }],
        // Fluid aliases — scale smoothly with viewport width
        'fluid-xs':      ['clamp(0.6875rem, 0.625rem + 0.3125vw, 0.8125rem)', { lineHeight: '1.5' }],
        'fluid-sm':      ['clamp(0.8125rem, 0.75rem + 0.3125vw, 0.9375rem)',  { lineHeight: '1.55' }],
        'fluid-base':    ['clamp(0.875rem,  0.75rem + 0.625vw,  1rem)',       { lineHeight: '1.65' }],
        'fluid-lg':      ['clamp(1rem,      0.875rem + 0.625vw, 1.25rem)',    { lineHeight: '1.6' }],
        'fluid-xl':      ['clamp(1.125rem,  0.875rem + 1.25vw,  1.5rem)',     { lineHeight: '1.5' }],
        'fluid-h3':      ['clamp(1.125rem,  0.875rem + 1.25vw,  1.75rem)',    { lineHeight: '1.25' }],
        'fluid-h2':      ['clamp(1.25rem,   0.875rem + 1.875vw, 2.25rem)',    { lineHeight: '1.2' }],
        'fluid-h1':      ['clamp(1.5rem,    1rem + 2.5vw,       3rem)',       { lineHeight: '1.15' }],
        'fluid-display': ['clamp(2rem,      1rem + 5vw,         4.5rem)',     { lineHeight: '1.1' }],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        royalgene: {
          amber: '#f59e0b',
          purple: '#6b21a8'
        },
        success: '#16a34a',
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      container: {
        center: true,
        padding: {
          DEFAULT: '1rem',
          sm: '2rem',
          lg: '4rem',
          xl: '5rem',
          '2xl': '6rem',
        },
        screens: {
          sm: '640px',
          md: '768px',
          lg: '1024px',
          xl: '1280px',
          '2xl': '1536px',
        },
      },
    }
  },
  plugins: [tailwindAnimate],
} satisfies Config;
