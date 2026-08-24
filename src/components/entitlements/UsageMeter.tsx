export function UsageMeter({
  label,
  usage,
  limit,
  unit = '',
}: {
  label: string;
  usage: number;
  limit: number | null;
  /** Optional suffix shown after each number, e.g. "GB". */
  unit?: string;
}) {
  const isUnlimited = limit === null;
  const pct = isUnlimited || limit === 0 ? 0 : Math.min((usage / limit) * 100, 100);
  const isWarning = !isUnlimited && limit > 0 && usage / limit >= 0.8 && usage < limit;
  const isFull = !isUnlimited && usage >= limit;
  const suffix = unit ? ` ${unit}` : '';

  const barColor = isFull ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-[hsl(var(--primary))]';

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-600 dark:text-gray-300">{label}</span>
        <span className={`font-medium ${isFull ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-gray-900 dark:text-white'}`}>
          {usage.toLocaleString()}{suffix} / {isUnlimited ? 'Unlimited' : `${limit.toLocaleString()}${suffix}`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {isFull && <p className="text-xs text-red-600 mt-1">Limit reached — upgrade your plan to add more.</p>}
      {isWarning && !isFull && <p className="text-xs text-amber-600 mt-1">Approaching your plan&apos;s limit.</p>}
    </div>
  );
}
