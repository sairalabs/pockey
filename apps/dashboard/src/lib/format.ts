const integer = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dateShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dateLong = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function formatInt(value: number): string {
  return integer.format(value);
}

export function formatUsd(value: number): string {
  return usd.format(value);
}

/** Wei (decimal string) to ETH with at most `decimals` fraction digits. */
export function formatEth(wei: string, decimals = 4): string {
  const value = BigInt(wei);
  const base = 10n ** 18n;
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction.toString().padStart(18, '0').slice(0, decimals);
  const trimmed = fractionText.replace(/0+$/, '');
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString();
}

export function formatDate(iso: string): string {
  return dateLong.format(new Date(iso));
}

export function formatDay(iso: string): string {
  return dateShort.format(new Date(iso));
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
