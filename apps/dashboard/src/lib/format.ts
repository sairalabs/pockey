const integer = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dateShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dateLong = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
// Usage buckets are UTC calendar days and months: format them in UTC or a day
// slips for every developer west of Greenwich.
const dayUtc = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const monthUtc = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatInt(value: number): string {
  return integer.format(value);
}

export function formatUsd(value: number): string {
  return usd.format(value);
}

/** `1284` -> `1.3K`. For headline numbers, never for a column of figures. */
export function formatCompact(value: number): string {
  return compact.format(value);
}

/** Integer cents to a USD amount. Every money value of the API is in cents. */
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** Decimal string of base units to a decimal number with `decimals` digits. */
export function formatUnits(amount: string, exponent: number, decimals: number): string {
  const value = BigInt(amount);
  const base = 10n ** BigInt(exponent);
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction.toString().padStart(exponent, '0').slice(0, decimals);
  const trimmed = fractionText.replace(/0+$/, '');
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString();
}

/** Wei (decimal string) to ETH with at most `decimals` fraction digits. */
export function formatEth(wei: string, decimals = 4): string {
  return formatUnits(wei, 18, decimals);
}

/** Lamports (decimal string) to SOL with at most `decimals` fraction digits. */
export function formatSol(lamports: string, decimals = 4): string {
  return formatUnits(lamports, 9, decimals);
}

export function formatDate(iso: string): string {
  return dateLong.format(new Date(iso));
}

export function formatDay(iso: string): string {
  return dateShort.format(new Date(iso));
}

/**
 * One usage bucket label: `2026-09-14` -> `Sep 14`, `2026-09` -> `Sep 2026`.
 * Both keys come from the API in UTC.
 */
export function formatBucket(key: string): string {
  if (/^\d{4}-\d{2}$/.test(key)) return monthUtc.format(new Date(`${key}-01T00:00:00.000Z`));
  return dayUtc.format(new Date(`${key}T00:00:00.000Z`));
}

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (iso === null) return 'Never';
  const diff = now - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

/** `0x91CD...99df` style truncation for addresses and long ids. */
export function truncateMiddle(value: string, start = 6, end = 4): string {
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}
