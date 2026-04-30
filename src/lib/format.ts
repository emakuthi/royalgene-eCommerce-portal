export function formatKESFromCents(cents: number | undefined | null): string {
  const v = Number(cents ?? 0);
  const major = v / 100;
  try {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(major);
  } catch (e) {
    // Fallback
    return `KES ${major.toFixed(2)}`;
  }
}

export function formatKESMajor(amount: number | undefined | null): string {
  // If amount is already in major units (not cents)
  const v = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(v);
  } catch (e) {
    return `KES ${v.toFixed(2)}`;
  }
}
