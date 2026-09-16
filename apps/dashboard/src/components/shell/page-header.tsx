import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: string;
  /** Rendered next to the title (a count badge). */
  badge?: ReactNode;
  description?: string;
  /** Right side controls. */
  actions?: ReactNode;
  className?: string;
}

/** 28px medium title row, optional actions on the right. */
export function PageHeader({ title, badge, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="flex items-center gap-3 text-[28px] font-medium leading-tight tracking-[-0.02em]">
          <span className="truncate">{title}</span>
          {badge}
        </h1>
        {description ? <p className="mt-1 text-sm text-fg-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
