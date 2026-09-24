const SIZE = 96;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Radial progress ring for a single usage metric. Severity color (accent ->
 * warning -> danger) carries the fill; the unfilled track stays a neutral,
 * always-visible ring so partial state reads even before the fill starts.
 * Same thresholds as the legacy `UsageMeter` bar it replaces: amber at 80%,
 * red at 100%.
 */
export function UsageGauge({
  label,
  usage,
  limit,
  unit = '',
  isOverridden = false,
}: {
  label: string;
  usage: number;
  limit: number | null;
  /** Optional suffix shown after each number, e.g. "GB". */
  unit?: string;
  /** True when a super-admin has set a per-tenant quota override for this metric. */
  isOverridden?: boolean;
}) {
  const isUnlimited = limit === null;
  const pct = isUnlimited || limit === 0 ? 0 : Math.min((usage / limit) * 100, 100);
  const isWarning = !isUnlimited && limit > 0 && usage / limit >= 0.8 && usage < limit;
  const isFull = !isUnlimited && usage >= limit;
  const suffix = unit ? ` ${unit}` : '';

  const ringColorClass = isFull ? 'stroke-red-500' : isWarning ? 'stroke-amber-500' : 'stroke-[hsl(var(--primary))]';
  const textColorClass = isFull ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-gray-900 dark:text-white';
  const dashOffset = CIRCUMFERENCE - (isUnlimited ? 0 : (pct / 100) * CIRCUMFERENCE);

  return (
    <div className="flex flex-col items-center text-center gap-2">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} fill="none" className="stroke-gray-100 dark:stroke-gray-800" />
          {!isUnlimited && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className={`transition-all ${ringColorClass}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {isUnlimited ? (
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Unlimited</span>
          ) : (
            <span className={`text-lg font-semibold tabular-nums ${textColorClass}`}>{Math.round(pct)}%</span>
          )}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <span>{label}</span>
          {isOverridden && (
            <span
              title="Custom quota set for this tenant"
              className="rounded-full bg-[hsl(var(--primary)/0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--primary))]"
            >
              Custom
            </span>
          )}
        </div>
        <p className={`text-sm font-medium tabular-nums ${isFull ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-gray-900 dark:text-white'}`}>
          {usage.toLocaleString()}
          {suffix} / {isUnlimited ? 'Unlimited' : `${limit.toLocaleString()}${suffix}`}
        </p>
        {isFull && <p className="text-xs text-red-600 mt-0.5">Limit reached — upgrade your plan to add more.</p>}
        {isWarning && !isFull && <p className="text-xs text-amber-600 mt-0.5">Approaching your plan&apos;s limit.</p>}
      </div>
    </div>
  );
}
