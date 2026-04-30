import * as React from "react"
import TextField from "@mui/material/TextField"

type TextareaProps = React.ComponentProps<typeof TextField>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <TextField
      inputRef={ref}
      variant="outlined"
      multiline
      fullWidth
      {...props}
      className={className}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
