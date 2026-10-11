import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

/* Minimal table: rows are told apart by their height and their hover fill. */

export function Table({ className, ...props }: ComponentPropsWithRef<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentPropsWithRef<'th'>) {
  return (
    <th
      className={cn(
        'h-10 whitespace-nowrap px-3 text-left text-[13px] font-medium text-fg-2 first:ps-5 last:pe-5',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentPropsWithRef<'td'>) {
  return (
    <td
      className={cn('h-12 whitespace-nowrap px-3 align-middle first:ps-5 last:pe-5', className)}
      {...props}
    />
  );
}
