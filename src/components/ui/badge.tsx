import * as React from "react"
import Chip from "@mui/material/Chip"

// Omit MUI's `variant`/`label`/`children` to avoid type conflicts and declare our own variant
type BadgeVariant = "default" | "secondary"
interface BadgeProps extends Omit<React.ComponentProps<typeof Chip>, 'label' | 'children' | 'variant'> {
  variant?: BadgeVariant
  children?: React.ReactNode
  className?: string
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, children, ...props }, ref) => {
    const muiVariant = variant === "secondary" ? "outlined" : "filled"
    const baseClass = 'px-2.5 py-0.5 text-xs font-semibold transition-colors'
    const variantClass =
      variant === 'secondary'
        ? 'bg-transparent border border-[hsl(var(--border))] text-[hsl(var(--primary))]'
        : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow'

    return (
      <Chip
        ref={ref}
        variant={muiVariant}
        label={children}
        className={`${baseClass} ${variantClass} ${className || ''}`}
        {...props}
      />
    )
  }
)
Badge.displayName = "Badge"

export { Badge }
