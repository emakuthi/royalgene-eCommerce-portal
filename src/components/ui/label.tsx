import * as React from "react"
import FormLabel from "@mui/material/FormLabel"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
)

type LabelVariant = 'default' | 'primary'

// Use FormLabel's props for typing
interface Props extends React.ComponentProps<typeof FormLabel> {
  variant?: LabelVariant
}

const Label = React.forwardRef<HTMLLabelElement, Props>(({ className, variant = 'default', ...props }, ref) => (
  <FormLabel
    ref={ref}
    className={cn(
      labelVariants(),
      variant === 'primary' ? 'text-[hsl(var(--primary))] font-semibold' : '',
      className
    )}
    {...props}
  />
))
Label.displayName = "Label"

export { Label }
