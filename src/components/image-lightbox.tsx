'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  /** The image to preview. Rendering nothing when null lets callers pass
   *  their "currently selected preview image" state directly, no extra guard. */
  src: string | null;
  alt?: string;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * Full-screen, zoomable preview for a single uploaded image — shared by every
 * place a product photo renders across the portal (upload grid, product
 * form, stock view/transfer, sale preview). Mirrors the Android app's
 * ImagePreviewDialog: mouse-wheel + drag-to-pan on desktop, touch
 * pinch-zoom + drag-to-pan on touch devices, Escape or a background click
 * (while not zoomed in) to dismiss.
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isInteracting = useRef(false);
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pinchState = useRef<{ startDist: number; startScale: number } | null>(null);
  const touchPanState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => setMounted(true), []);

  // Reset zoom/pan whenever a new image opens
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  // Escape key dismisses
  useEffect(() => {
    if (!src) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [src, onClose]);

  // Lock background scroll while open
  useEffect(() => {
    if (!src) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [src]);

  // Native wheel + touch listeners — React's synthetic handlers for wheel and
  // touchmove can be registered passive by default, which silently breaks
  // preventDefault (needed here to stop page/browser zoom while previewing).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !src) return;

    const dist = (touches: TouchList) => {
      const a = touches[0];
      const b = touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      setScale((prev) => {
        const next = clampScale(prev + prev * delta);
        if (next <= MIN_SCALE) setOffset({ x: 0, y: 0 });
        return next;
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        isInteracting.current = true;
        pinchState.current = { startDist: dist(e.touches), startScale: scale };
        touchPanState.current = null;
      } else if (e.touches.length === 1 && scale > MIN_SCALE) {
        isInteracting.current = true;
        const t = e.touches[0];
        touchPanState.current = { startX: t.clientX, startY: t.clientY, originX: offset.x, originY: offset.y };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchState.current) {
        e.preventDefault();
        const next = clampScale(pinchState.current.startScale * (dist(e.touches) / pinchState.current.startDist));
        setScale(next);
        if (next <= MIN_SCALE) setOffset({ x: 0, y: 0 });
      } else if (e.touches.length === 1 && touchPanState.current) {
        e.preventDefault();
        const t = e.touches[0];
        setOffset({
          x: touchPanState.current.originX + (t.clientX - touchPanState.current.startX),
          y: touchPanState.current.originY + (t.clientY - touchPanState.current.startY),
        });
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchState.current = null;
      if (e.touches.length < 1) {
        touchPanState.current = null;
        isInteracting.current = false;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchEnd, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- offset/scale read via refs is stale-safe here; re-binding on every change would re-arm mid-gesture
  }, [src]);

  // Desktop drag-to-pan with the mouse, only while zoomed in
  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= MIN_SCALE) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y };
  };
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      setOffset({
        x: dragState.current.originX + (e.clientX - dragState.current.startX),
        y: dragState.current.originY + (e.clientY - dragState.current.startY),
      });
    };
    const onMouseUp = () => {
      dragState.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handleDoubleClick = useCallback(() => {
    setScale((prev) => (prev > MIN_SCALE ? MIN_SCALE : 2.5));
    setOffset({ x: 0, y: 0 });
  }, []);

  if (!src || !mounted) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/95"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && scale <= MIN_SCALE) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? 'Image preview'}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
        aria-label="Close preview"
      >
        <X className="h-5 w-5" />
      </button>
      {/* Plain <img>, not next/image: an arbitrary remote URL zoomed via a CSS
          transform — next/image's fixed intrinsic sizing doesn't fit a
          free-form zoom/pan surface. */}
      <img
        src={src}
        alt={alt ?? 'Preview'}
        draggable={false}
        onMouseDown={onMouseDown}
        onDoubleClick={handleDoubleClick}
        className="max-h-[92vh] max-w-[92vw] select-none object-contain"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > MIN_SCALE ? 'grab' : 'zoom-in',
        }}
      />
    </div>,
    document.body
  );
}
