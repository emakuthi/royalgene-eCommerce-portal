import * as React from "react"
import Checkbox, { CheckboxProps as MUICheckboxProps } from "@mui/material/Checkbox"

const MuiCheckbox = React.forwardRef<HTMLInputElement, MUICheckboxProps>(({ ...props }, ref) => {
  return <Checkbox inputRef={ref as unknown as React.Ref<HTMLInputElement>} {...props} />
})
MuiCheckbox.displayName = "Checkbox"

export { MuiCheckbox as Checkbox }
