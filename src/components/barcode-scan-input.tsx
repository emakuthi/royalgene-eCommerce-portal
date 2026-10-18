'use client';

// Scan input for the sales and stock screens.
//
//  - Handheld USB / Bluetooth scanners act as a keyboard: they "type" the code and press
//    Enter. This input keeps focus, takes that Enter as a scan, clears itself and refocuses
//    so the next scan lands straight away.
//  - Phones/tablets/laptops with a camera: a "Camera" button feeds the same onScan callback.
//    It uses the browser's built-in BarcodeDetector where there is one (Chrome on Android,
//    macOS) and otherwise loads ZXing on demand (iOS Safari, Firefox, Chrome on Windows), so
//    browsers that never need it don't download it.

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Camera, ScanLine, X } from 'lucide-react';

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

/** Short beep so a cashier hears each scan without looking at the screen. */
export function scanBeep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 1100 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    osc.onended = () => void ctx.close();
  } catch {
    /* audio is best-effort */
  }
}

export type BarcodeScanInputHandle = { focus: () => void };

type Props = {
  /** Called with the trimmed code. May be async; further scans are held until it settles. */
  onScan: (code: string) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
};

const BarcodeScanInput = forwardRef<BarcodeScanInputHandle, Props>(function BarcodeScanInput(
  { onScan, disabled, label = 'Scan barcode', placeholder = 'Scan or type a barcode / SKU, then press Enter', autoFocus = true },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(false);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const busyRef = useRef(false);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  useEffect(() => {
    setCameraSupported(Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  useEffect(() => {
    if (autoFocus && !disabled) inputRef.current?.focus();
  }, [autoFocus, disabled]);

  const submit = useCallback(
    async (raw: string) => {
      const code = raw.replace(/[\r\n\t]/g, '').trim();
      if (!code || busyRef.current) return;
      // Scanners and the camera loop can fire the same read twice in quick succession.
      const last = lastScanRef.current;
      const now = Date.now();
      if (last && last.code === code && now - last.at < 700) return;
      lastScanRef.current = { code, at: now };

      busyRef.current = true;
      setBusy(true);
      try {
        await onScan(code);
      } finally {
        busyRef.current = false;
        setBusy(false);
        setValue('');
        inputRef.current?.focus();
      }
    },
    [onScan],
  );

  return (
    <div>
      <label htmlFor="barcode-scan-input" className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            id="barcode-scan-input"
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Keep a scan's trailing Enter from submitting the surrounding form.
                e.preventDefault();
                void submit(value);
              }
            }}
            className="block w-full rounded-md border border-input bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-ring dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-400"
          />
        </div>
        {cameraSupported && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => setCameraOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 dark:bg-gray-950 dark:hover:bg-gray-900"
          >
            <Camera className="h-4 w-4" aria-hidden />
            Camera
          </button>
        )}
      </div>
      {cameraOpen && (
        <CameraScanner
          onClose={() => {
            setCameraOpen(false);
            inputRef.current?.focus();
          }}
          onCode={(code) => {
            setCameraOpen(false);
            void submit(code);
          }}
        />
      )}
    </div>
  );
});

function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Parents pass an inline callback; hold it in a ref so a re-render doesn't restart the camera.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let zxingControls: { stop: () => void } | null = null;

    const found = (code: string) => {
      if (!code || stopped) return;
      stopped = true;
      onCodeRef.current(code);
    };

    (async () => {
      const Ctor = getDetectorCtor();
      if (!Ctor) {
        // No native detector (iOS Safari, Firefox, Chrome on Windows): decode with ZXing.
        try {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
            import('@zxing/browser'),
            import('@zxing/library'),
          ]);
          if (stopped) return;
          const video = videoRef.current;
          if (!video) return;
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE,
          ]);
          const reader = new BrowserMultiFormatReader(hints);
          const controls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' } }, audio: false },
            video,
            (result) => {
              if (result) found(result.getText());
            },
          );
          if (stopped) controls.stop();
          else zxingControls = controls;
        } catch {
          setError('Could not open the camera. Check that camera access is allowed for this site.');
        }
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] });
        let detecting = false;
        timer = setInterval(async () => {
          if (detecting || stopped || video.readyState < 2) return;
          detecting = true;
          try {
            const codes = await detector.detect(video);
            const code = codes[0]?.rawValue;
            if (code) found(code);
          } catch {
            /* a failed frame is fine; try the next one */
          } finally {
            detecting = false;
          }
        }, 250);
      } catch {
        setError('Could not open the camera. Check that camera access is allowed for this site.');
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      zxingControls?.stop();
    };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan with camera" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-medium">Point the camera at a barcode</p>
          <button type="button" onClick={onClose} aria-label="Close camera" className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        {error ? (
          <p className="px-4 pb-4 text-sm text-red-600">{error}</p>
        ) : (
          <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full bg-black object-cover" />
        )}
      </div>
    </div>
  );
}

export default BarcodeScanInput;
