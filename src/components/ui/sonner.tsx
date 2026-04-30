"use client"

import React from "react"
import { useTheme } from "next-themes"
import { Toaster as SonnerToaster } from "sonner"

export const Toaster = () => {
  const { theme = "system" } = useTheme()

  return (
    <SonnerToaster
      theme={theme as 'light' | 'dark' | 'system'}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-[hsl(var(--primary))] group-[.toast]:text-[hsl(var(--primary-foreground))]",
          cancelButton:
            "group-[.toast]:bg-[hsl(var(--muted))] group-[.toast]:text-[hsl(var(--muted-foreground))]",
        },
      }}
    />
  )
}

export default Toaster
