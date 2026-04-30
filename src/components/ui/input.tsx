import * as React from "react"
import TextField from "@mui/material/TextField"
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'
import { Eye, EyeOff } from 'lucide-react'

type NativeInputProps = React.InputHTMLAttributes<HTMLInputElement>

type MuiTextFieldProps = React.ComponentProps<typeof TextField>
type MuiInputProps = MuiTextFieldProps['InputProps']

type InputProps = Omit<MuiTextFieldProps, 'inputRef'> & NativeInputProps & { className?: string }

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, min, max, step, accept, multiple, ...props }, ref) => {
  // Collect native input attributes to pass via inputProps
  const native: Partial<NativeInputProps> = {}
  if (min !== undefined) native.min = min
  if (max !== undefined) native.max = max
  if (step !== undefined) native.step = step
  if (accept !== undefined) native.accept = accept
  if (multiple !== undefined) native.multiple = multiple

  // Separate TextField props from native input props
  const { inputProps: incomingInputProps, ...textFieldProps } = props as Partial<MuiTextFieldProps>

  // Show/hide password handling
  const [showPassword, setShowPassword] = React.useState(false)
  const isPassword = type === 'password'
  // Keep fieldType as a simple string (TextField accepts string | undefined)
  const fieldType: string | undefined = isPassword ? (showPassword ? 'text' : 'password') : (type ?? undefined)

  // Merge incoming InputProps (for TextField) and append endAdornment when needed
  const incomingInputPropsFromTextField: MuiInputProps = (textFieldProps as Partial<MuiTextFieldProps>).InputProps ?? {}

  const InputPropsMerged: MuiInputProps = {
    ...incomingInputPropsFromTextField,
    endAdornment: isPassword ? (
      <InputAdornment position="end">
        <IconButton
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          onClick={() => setShowPassword((s) => !s)}
          edge="end"
          size="small"
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </IconButton>
      </InputAdornment>
    ) : incomingInputPropsFromTextField?.endAdornment,
  }

  return (
    <TextField
      inputRef={ref}
      type={fieldType}
      variant="outlined"
      size="small"
      fullWidth
      {...textFieldProps}
      InputProps={InputPropsMerged}
      inputProps={{ ...(incomingInputProps as React.InputHTMLAttributes<HTMLInputElement> | undefined), ...native }}
      className={className}
    />
  )
})
Input.displayName = "Input"

export { Input }
