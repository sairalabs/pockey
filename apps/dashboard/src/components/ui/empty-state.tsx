import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Round icon badge, bold title, muted subline (notifications "all caught up"). */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-fg-2 [&_svg]:size-5">
        {icon}
      </div>
      <p className="mt-4 text-sm font-semibold text-fg">{title}</p>
      {description ? <p className="mt-1 text-[13px] text-fg-2">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
