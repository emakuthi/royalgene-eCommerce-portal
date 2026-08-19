import { Badge } from '@/components/ui/badge';

const STATUS_STYLES: Record<string, string> = {
  trialing: 'bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  past_due: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  suspended: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  expired: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  legacy: 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

const STATUS_LABELS: Record<string, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
  expired: 'Expired',
  legacy: 'Unlimited',
};

export function SubscriptionStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.cancelled;
  const label = STATUS_LABELS[status] || status;
  return <Badge className={`text-xs px-2 py-0.5 font-semibold ${style}`}>{label}</Badge>;
}
