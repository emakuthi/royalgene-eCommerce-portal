import * as React from 'react'
import { createPortal } from 'react-dom'
import Divider from '@mui/material/Divider'

// ── Context ──────────────────────────────────────────────────────────────────
type MenuContextType = {
  open: boolean
  setOpen: (o: boolean) => void
  anchorRef: React.MutableRefObject<HTMLElement | null>
}

const MenuContext = React.createContext<MenuContextType | null>(null)

// ── DropdownMenu ─────────────────────────────────────────────────────────────
export const DropdownMenu: React.FC<{
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}> = ({ children, open: controlledOpen, onOpenChange }) => {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const anchorRef = React.useRef<HTMLElement | null>(null)

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const setOpen = React.useCallback(
    (o: boolean) => {
      if (!isControlled) setInternalOpen(o)
      onOpenChange?.(o)
    },
    [isControlled, onOpenChange],
  )

  return (
    <MenuContext.Provider value={{ open, setOpen, anchorRef }}>
      {children}
    </MenuContext.Provider>
  )
}

// ── DropdownMenuTrigger ───────────────────────────────────────────────────────
export const DropdownMenuTrigger: React.FC<{
  asChild?: boolean
  children?: React.ReactNode
}> = ({ asChild, children }) => {
  const ctx = React.useContext(MenuContext)
  if (!ctx) return null
  const { anchorRef } = ctx

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    anchorRef.current = e.currentTarget as HTMLElement
    ctx.setOpen(!ctx.open)
  }

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement, {
      onClick: handleClick,
      ref: (el: HTMLElement | null) => { anchorRef.current = el },
    })
  }

  return (
    <button
      type="button"
      ref={(el) => { anchorRef.current = el }}
      onClick={handleClick}
      className="inline-flex items-center justify-center rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
    >
      {children}
    </button>
  )
}

// ── DropdownMenuContent ───────────────────────────────────────────────────────
export const DropdownMenuContent: React.FC<{
  children?: React.ReactNode
  align?: 'start' | 'end'
  className?: string
}> = ({ children, align = 'end', className = '' }) => {
  const ctx = React.useContext(MenuContext)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = React.useState(false)

  // Only render in browser
  React.useEffect(() => { setMounted(true) }, [])

  // Compute position whenever open transitions to true
  React.useEffect(() => {
    if (!ctx?.open || !ctx.anchorRef.current) {
      setPos(null)
      return
    }
    const rect = ctx.anchorRef.current.getBoundingClientRect()
    const panelWidth = 192 // min-w-48
    const left =
      align === 'end'
        ? Math.max(8, rect.right - panelWidth + window.scrollX)
        : rect.left + window.scrollX
    setPos({ top: rect.bottom + window.scrollY + 4, left })
  }, [ctx?.open, align, ctx?.anchorRef])

  // Close on outside click or Escape
  React.useEffect(() => {
    if (!ctx?.open) return
    const handleOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        ctx.anchorRef.current &&
        !ctx.anchorRef.current.contains(e.target as Node)
      ) {
        ctx.setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ctx.setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [ctx])

  if (!ctx?.open || !pos || !mounted) return null

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      style={{ position: 'absolute', top: pos.top, left: pos.left, zIndex: 9999 }}
      className={`
        min-w-[192px] rounded-xl border border-gray-200 dark:border-gray-700
        bg-white dark:bg-gray-900
        shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)]
        py-1 overflow-hidden
        animate-in fade-in-0 zoom-in-95
        ${className}
      `}
    >
      {children}
    </div>,
    document.body,
  )
}

// ── DropdownMenuItem ──────────────────────────────────────────────────────────
export const DropdownMenuItem: React.FC<{
  children?: React.ReactNode
  onClick?: (e: React.MouseEvent) => void
  inset?: boolean
  asChild?: boolean
  leading?: React.ReactNode
  trailing?: React.ReactNode
  destructive?: boolean
  className?: string
  disabled?: boolean
}> = ({ children, onClick, destructive = false, disabled = false, className = '' }) => {
  const ctx = React.useContext(MenuContext)

  const handleClick = (e: React.MouseEvent) => {
    if (disabled) return
    ctx?.setOpen(false)
    onClick?.(e)
  }

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={handleClick}
      className={`
        w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left
        transition-colors duration-100 select-none
        ${destructive
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
    >
      {children}
    </button>
  )
}

// ── DropdownMenuSeparator ─────────────────────────────────────────────────────
export const DropdownMenuSeparator = () => (
  <Divider sx={{ my: 0.5, borderColor: 'rgba(0,0,0,0.07)' }} />
)

export default DropdownMenu
