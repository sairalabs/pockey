import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/*
  Inputs keep a real 1px border: better-ui reserves shadow-borders for depth
  and keeps borders where they communicate structure (form outlines).
*/
const control =
  'w-full rounded-[10px] border border-border bg-surface-2 text-sm text-fg placeholder:text-fg-3 ' +
  'transition-[border-color,background-color] duration-150 ease-out hover:border-border-strong ' +
  'focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className, ...props }: ComponentPropsWithRef<'input'>) {
  return <input className={cn(control, 'h-10 px-3', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithRef<'textarea'>) {
  return (
    <textarea
      className={cn(control, 'min-h-24 resize-y px-3 py-2.5 leading-relaxed', className)}
      {...props}
    />
  );
}

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  /** Character counter, rendered `8/25` with tabular numbers. */
  counter?: { value: number; max: number };
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, counter, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg-2">
          {label}
        </label>
        {counter ? (
          <span
            className={cn('text-xs num', counter.value > counter.max ? 'text-danger' : 'text-fg-3')}
          >
            {counter.value}/{counter.max}
          </span>
        ) : null}
      </div>
      {children}
      {hint ? <p className="text-xs text-fg-3">{hint}</p> : null}
    </div>
  );
}
