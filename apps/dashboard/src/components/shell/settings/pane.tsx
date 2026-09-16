import type { ReactNode } from 'react';
import { DialogClose } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

export interface PaneProps {
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** Right pane of the settings dialog: title row with close, divider, content. */
export function Pane({ title, badge, actions, children }: PaneProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex h-[72px] shrink-0 items-center justify-between gap-4 border-b border-border px-8">
        <h2 className="flex items-center gap-3 text-xl font-semibold tracking-[-0.01em]">
          {title}
          {badge}
        </h2>
        <div className="flex items-center gap-2">
          {actions}
          <DialogClose className="-me-2" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-[640px]">{children}</div>
      </div>
    </div>
  );
}

export interface PaneSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function PaneSection({ title, description, children, className }: PaneSectionProps) {
  return (
    <section className={cn('py-6 first:pt-0', className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? <p className="mt-1 text-[13px] text-fg-2">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Label/value pair used by Account information. */
export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <span className="text-[13px] text-fg-2">{label}</span>
      <span className="min-w-0 text-right text-sm">{children}</span>
    </div>
  );
}

/** Inline feedback after a local save. */
export function SavedHint({ visible, text = 'Saved' }: { visible: boolean; text?: string }) {
  return (
    <span
      aria-live="polite"
      className={cn(
        'text-[13px] text-fg-2 transition-[opacity] duration-150 ease-out',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {visible ? text : ''}
    </span>
  );
}
