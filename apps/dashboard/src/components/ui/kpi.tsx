import { Info } from './icons';
import { cn } from '@/lib/cn';

export interface KpiProps {
  label: string;
  value: string;
  /** Shown as the info icon's accessible name and native tooltip. */
  info?: string;
  className?: string;
}

/** Headline metric: a muted label with its info icon, then a big tabular number. */
export function Kpi({ label, value, info, className }: KpiProps) {
  return (
    <section className={cn('pb-5', className)}>
      <div className="flex items-center gap-1.5 text-[13px] text-fg-2">
        <span>{label}</span>
        {info ? (
          <span
            role="img"
            aria-label={info}
            title={info}
            className="inline-flex size-4 items-center justify-center text-fg-3"
          >
            <Info className="size-3.5" />
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[40px] font-medium leading-none tracking-[-0.02em] num">{value}</p>
    </section>
  );
}
