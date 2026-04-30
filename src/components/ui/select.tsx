import * as React from "react"
import Button from "@mui/material/Button"
import Menu from "@mui/material/Menu"
import MenuItem from "@mui/material/MenuItem"
import ListSubheader from "@mui/material/ListSubheader"

type SelectContextType = {
  value: string | null
  setValue: (v: string) => void
  open: boolean
  setOpen: (o: boolean) => void
  anchorEl: HTMLElement | null
  setAnchorEl: (el: HTMLElement | null) => void
}

const SelectContext = React.createContext<SelectContextType | null>(null)

interface SelectProps {
  value?: string
  onValueChange?: (v: string) => void
  children?: React.ReactNode
}

export const Select: React.FC<SelectProps> = ({
  value: controlledValue,
  onValueChange,
  children,
}) => {
  const [value, setValueState] = React.useState<string | null>(
    controlledValue ?? null
  )
  const [open, setOpen] = React.useState(false)
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    if (controlledValue !== undefined) setValueState(controlledValue)
  }, [controlledValue])

  const setValue = (v: string) => {
    if (onValueChange) onValueChange(v)
    setValueState(v)
  }

  return (
    <SelectContext.Provider
      value={{ value, setValue, open, setOpen, anchorEl, setAnchorEl }}
    >
      {children}
    </SelectContext.Provider>
  )
}

interface TriggerProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean
  children?: React.ReactNode
  disabled?: boolean
  style?: React.CSSProperties
  className?: string
}

export const SelectTrigger: React.FC<TriggerProps> = ({
  asChild,
  children,
  ...props
}) => {
  const ctx = React.useContext(SelectContext)
  if (!ctx) return null
  const { setOpen, setAnchorEl } = ctx

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget as HTMLElement)
    setOpen(true)
  }

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement, { onClick: handleClick })
  }

  // Only forward safe props to MUI Button to avoid typing issues
  const { className, style, disabled } = props
  return (
    <Button onClick={handleClick} className={className} style={style} disabled={disabled}>
      {children}
    </Button>
  )
}

export const SelectValue: React.FC<{ placeholder?: string }> = ({
  placeholder,
}) => {
  const ctx = React.useContext(SelectContext)
  if (!ctx) return null
  return <>{ctx.value ?? placeholder ?? ""}</>
}

interface ContentProps {
  children?: React.ReactNode
  style?: React.CSSProperties
}

export const SelectContent: React.FC<ContentProps> = ({ children, ...props }) => {
  const ctx = React.useContext(SelectContext)
  if (!ctx) return null
  const { open, setOpen, anchorEl, setAnchorEl } = ctx

  const handleClose = () => {
    setOpen(false)
    setAnchorEl(null)
  }

  return (
    <Menu anchorEl={anchorEl} open={Boolean(open)} onClose={handleClose} {...props}>
      {children}
    </Menu>
  )
}

interface ItemProps {
  value: string
  children?: React.ReactNode
  disabled?: boolean
}

export const SelectItem: React.FC<ItemProps> = ({ value, children, disabled }) => {
  const ctx = React.useContext(SelectContext)
  if (!ctx) return null
  const { setValue, setOpen } = ctx

  const handleClick = () => {
    if (disabled) return
    setValue(value)
    setOpen(false)
  }

  return (
    <MenuItem onClick={handleClick} disabled={disabled}>
      {children}
    </MenuItem>
  )
}

export const SelectGroup = ({ children }: { children?: React.ReactNode }) => (
  <div>{children}</div>
)
export const SelectLabel = ({ children }: { children?: React.ReactNode }) => (
  <ListSubheader>{children}</ListSubheader>
)
export const SelectSeparator = () => <div className="h-2" />
export const SelectScrollUpButton = () => null
export const SelectScrollDownButton = () => null

export {
  Select as default,
  // named exports for compatibility
  // Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectLabel, SelectSeparator
}
