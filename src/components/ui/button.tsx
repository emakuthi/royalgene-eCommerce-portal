'use client';

import * as React from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '@/lib/theme-context'

type Variant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
type Size = 'default' | 'sm' | 'lg' | 'icon'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  variant?: Variant
  size?: Size
  icon?: ReactNode
  endIcon?: ReactNode
  customColor?: string
  borderRadius?: string | number
  // New convenience props: accept Tailwind class strings for quick overrides
  border?: string
  background?: string
  text?: string
  // `sx` accepts a style object to apply directly to the element (merged with CSS vars)
  sx?: React.CSSProperties
}

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild,
      variant = 'default',
      size = 'default',
      icon,
      endIcon,
      children,
      className,
      disabled,
      customColor,
      borderRadius,
      // new props
      border,
      background,
      text,
      sx,
      ...props
    },
    ref
  ) => {
    const { theme } = useTheme()

    const base = 'inline-flex items-center justify-center gap-2 font-medium transition-colors normal-case'

    const sizeClasses =
      size === 'sm'
        ? 'h-7 px-2.5 text-xs'
        : size === 'lg'
        ? 'h-9 px-5 text-sm'
        : size === 'icon'
        ? 'h-8 w-8 p-0'
        : 'h-8 px-3 text-sm'

    // Theme-aware variant classes
    const variantClasses: Record<Variant, string> = {
      // Default (primary) buttons now use brand pink background with white text
      default:
        theme === 'dark'
          ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border border-transparent hover:brightness-90'
          : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border border-transparent hover:brightness-90',
      destructive: theme === 'dark' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-red-600 text-white hover:bg-red-700',
      // Outline uses pink border and text when unselected; transparent background
      outline:
        theme === 'dark'
          ? 'bg-transparent border border-[hsl(var(--border))] text-[hsl(var(--primary-foreground))] hover:bg-[rgba(255,255,255,0.02)]'
          : 'bg-transparent border border-[hsl(var(--border))] text-[hsl(var(--primary))] hover:bg-[rgba(0,0,0,0.02)]',
      secondary:
        theme === 'dark'
          ? 'bg-gray-800 text-gray-100 hover:bg-gray-700'
          : 'bg-gray-100 text-gray-900 hover:bg-gray-200',
      ghost: theme === 'dark' ? 'bg-transparent text-gray-100 hover:bg-gray-800' : 'bg-transparent text-gray-900 hover:bg-gray-100',
      link: theme === 'dark' ? 'bg-transparent underline text-primary/90 hover:opacity-90' : 'bg-transparent underline text-primary hover:opacity-90',
    }

    const rounded = borderRadius ? `rounded-[${borderRadius}]` : 'rounded-md'
    // Allow `sx` to provide backgroundColor and color (like MUI's sx).
    // Prefer explicit `customColor` prop; otherwise fall back to sx.backgroundColor.
    const sxRec = sx as Record<string, unknown> | undefined
    const sxBg = sxRec
      ? typeof sxRec.backgroundColor === 'string'
        ? (sxRec.backgroundColor as string)
        : typeof sxRec.bg === 'string'
        ? (sxRec.bg as string)
        : typeof sxRec.background === 'string'
        ? (sxRec.background as string)
        : undefined
      : undefined
    const sxColor = sxRec
      ? typeof sxRec.color === 'string'
        ? (sxRec.color as string)
        : typeof sxRec.text === 'string'
        ? (sxRec.text as string)
        : undefined
      : undefined
    const finalBg = customColor || sxBg
    const hasCustom = Boolean(finalBg)
    const customClasses = hasCustom
      ? `bg-[var(--btn-bg)] ${sxColor ? 'text-[var(--btn-text)]' : 'text-white'} hover:brightness-90`
      : ''

    // Allow quick overrides via `background`, `text`, `border` props (treated as class strings)
    const overrideClasses = classNames(background, text, border)

    // Detect whether the consumer provided background/text via className or props so we can
    // avoid applying the variant's bg/text classes (which would otherwise win in CSS order).
    const hasClassName = typeof className === 'string' && className.trim().length > 0
    const classNameProvidesBg = hasClassName && /(^|\s)bg-(?:\[|\S+)/.test(className as string)
    const classNameProvidesText = hasClassName && /(^|\s)text-(?:\[|\S+)/.test(className as string)
    const propProvidesBg = Boolean(background || customColor || sxBg)
    const propProvidesText = Boolean(text || sxColor)

    // Build the variant part but strip bg-/hover:bg- tokens if the user provided their own background
    // and strip text- tokens if the user provided their own text color.
    const rawVariant = variantClasses[variant]
    const variantTokens = rawVariant.split(/\s+/).filter(Boolean)
    const filteredVariantTokens = variantTokens.filter((tok) => {
      // remove background-related tokens when user provided a bg override
      if (propProvidesBg || classNameProvidesBg) {
        if (tok.startsWith('bg-') || tok.startsWith('hover:bg-') || tok.startsWith('bg[') || tok.startsWith('hover:bg[')) return false
      }
      // remove text-related tokens when user provided a text override
      if (propProvidesText || classNameProvidesText) {
        if (tok.startsWith('text-') || tok.startsWith('text[')) return false
      }
      return true
    })
    const variantPart = filteredVariantTokens.join(' ')

    // If the consumer supplied a background (via className or the `background` prop) but didn't
    // supply any explicit text color, default the button's text to white so it remains legible.
    // Don't force this when the background is transparent.
    const providedBgString = (className && String(className)) || background || ''
    const providedBgLower = providedBgString.toLowerCase()
    const isTransparentBg = providedBgLower.includes('bg-transparent') || providedBgLower.includes('transparent')

    const autoTextNeeded = (propProvidesBg || classNameProvidesBg) && !(propProvidesText || classNameProvidesText) && !isTransparentBg
    const autoTextClass = autoTextNeeded ? 'text-white' : ''

    const computedClass = classNames(
      base,
      sizeClasses,
      hasCustom ? customClasses : variantPart,
      rounded,
      overrideClasses,
      autoTextClass,
      className
    )

    // CSS variable map to set on the element (minimal inline usage)
    const cssVars: React.CSSProperties | undefined = hasCustom
      ? ({ ['--btn-bg']: finalBg, ...(sxColor ? ({ ['--btn-text']: sxColor } as React.CSSProperties) : {}) } as React.CSSProperties)
      : undefined

    // If sx provided, strip color/background from inline style since we map them to CSS vars
    const filteredSx: Record<string, unknown> | undefined = sxRec
      ? Object.keys(sxRec).reduce<Record<string, unknown>>((acc, key) => {
          if (key === 'backgroundColor' || key === 'background' || key === 'bg' || key === 'color' || key === 'text') return acc
          const val = sxRec[key]
          if (typeof val !== 'undefined') acc[key] = val
          return acc
        }, {})
      : undefined

    // Merge styles: CSS vars (from customColor/sx) + other sx props
    const mergedStyle = { ...(cssVars || {}), ...(filteredSx ? (filteredSx as React.CSSProperties) : {}) }

    // If asChild and children is an element (e.g., Link), clone it and merge classes & props
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement
      const childProps = child.props || {}
      const merged = classNames(childProps.className, computedClass)
      // Merge styles into child style (preserve existing style)
      const childMergedStyle = { ...(childProps.style || {}), ...mergedStyle }
      return React.cloneElement(child, { className: merged, style: childMergedStyle, ...props })
    }

    // Render native button with merged style applied
    return (
      <button ref={ref} className={computedClass} disabled={disabled} style={mergedStyle} {...props}>
        {icon && <span className="inline-flex items-center">{icon}</span>}
        {children}
        {endIcon && <span className="inline-flex items-center">{endIcon}</span>}
      </button>
    )
  }
)

Button.displayName = 'Button'

export { Button }
