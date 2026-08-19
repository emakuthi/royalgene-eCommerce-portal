import { Badge } from '@/components/ui/badge';

const TIER_STYLES: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  starter: 'bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  business: 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  pro: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  enterprise: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  legacy: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export function PlanBadge({ name, tier }: { name: string; tier?: string | null }) {
  const style = (tier && TIER_STYLES[tier]) || TIER_STYLES.free;
  return <Badge className={`text-xs px-2 py-0.5 font-semibold ${style}`}>{name}</Badge>;
}
