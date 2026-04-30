"use client"

import * as React from "react"
import Dialog from "@mui/material/Dialog"
import DialogTitle from "@mui/material/DialogTitle"
import DialogContent from "@mui/material/DialogContent"

import { cn } from "@/lib/utils"

// Trigger can accept standard span props and an optional `asChild` flag
interface DialogTriggerProps extends React.HTMLAttributes<HTMLSpanElement> {
  asChild?: boolean
  children?: React.ReactNode
}
const DialogTrigger: React.FC<DialogTriggerProps> = ({ asChild, children, ...props }) => {
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement, { ...props })
  }
  return <span {...props}>{children}</span>
}

// Derive the exact onClose type from MUI Dialog props
type DialogOnClose = React.ComponentProps<typeof Dialog>["onClose"]

type DialogProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: DialogOnClose
  children?: React.ReactNode
} & React.ComponentProps<typeof Dialog>

const DialogComponent: React.FC<DialogProps> = ({ open = false, onOpenChange, onClose, children, ...props }) => {
  const handleClose: NonNullable<DialogOnClose> = (event, reason) => {
    onClose?.(event, reason)
    if (typeof onOpenChange === 'function') onOpenChange(false)
  }

  // When parent toggles open to true, we just pass to MUI Dialog. When MUI closes, we call onOpenChange(false).
  return (
    <Dialog open={Boolean(open)} onClose={handleClose} {...props}>
      {children}
    </Dialog>
  )
}

const DialogHeader = ({
                          className,
                          ...props
                      }: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex flex-col space-y-1.5 text-center sm:text-left",
            className
        )}
        {...props}
    />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
                          className,
                          ...props
                      }: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
            className
        )}
        {...props}
    />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitleShim = DialogTitle

const DialogDescriptionShim = DialogContent

export {
    DialogComponent as Dialog,
    DialogTrigger,
    DialogHeader,
    DialogFooter,
    DialogTitleShim as DialogTitle,
    DialogDescriptionShim as DialogDescription,
    DialogContent as DialogContent,
}
