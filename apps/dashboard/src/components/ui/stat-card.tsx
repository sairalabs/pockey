import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Sparkline } from '@/components/ui/sparkline';
import { cn } from '@/lib/cn';

export interface StatCardProps {
  label: string;
  value: string;
  /** Small unit after the value (`ETH`, `USD`). */
  unit?: string;
  series?: readonly number[];
  /** Replaces the sparkline, used for list rows. */
  children?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, unit, series, children, className }: StatCardProps) {
  return (
    <Card accent className={cn('flex flex-col', className)}>
      <p className="text-[13px] text-fg-2">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5 leading-none">
        <span className="text-2xl font-medium tracking-[-0.01em] num">{value}</span>
        {unit ? <span className="text-[13px] text-fg-3">{unit}</span> : null}
      </p>
      <div className="mt-4 flex-1">
        {children ?? (series ? <Sparkline series={series} /> : <div className="h-12" />)}
      </div>
    </Card>
  );
}
