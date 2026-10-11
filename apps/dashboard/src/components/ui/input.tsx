import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/*
  Flat brand: a field is a filled surface, not an outlined box. It lifts one step
  on hover and shows an accent ring only while focused, which keyboard users need.
*/
const control =
  'w-full rounded-pill bg-surface-2 text-sm text-fg placeholder:text-fg-3 ' +
  'transition-[background-color,box-shadow] duration-150 ease-out hover:bg-surface-3 ' +
  'focus-visible:bg-surface-3 focus-visible:shadow-[0_0_0_2px_var(--accent)] focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className, ...props }: ComponentPropsWithRef<'input'>) {
  return <input className={cn(control, 'h-11 px-4', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithRef<'textarea'>) {
  return (
    <textarea
      className={cn(
        control,
        'min-h-24 resize-y rounded-[18px] px-4 py-3 leading-relaxed',
        className,
      )}
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
