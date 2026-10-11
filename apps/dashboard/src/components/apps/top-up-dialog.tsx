'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { createTopUpCheckout, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/format';

/** Spec 7.5: prepaid only, 5 USD minimum and 10,000 USD maximum per checkout. */
const MIN_CENTS = 500;
const MAX_CENTS = 1_000_000;
const PRESETS = [2500, 5000, 10_000, 25_000];

export interface TopUpDialogProps {
  appId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TopUpDialog({ appId, open, onOpenChange }: TopUpDialogProps) {
  const id = useId();
  const [amountCents, setAmountCents] = useState(PRESETS[1] ?? MIN_CENTS);
  const [custom, setCustom] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = custom.trim().length > 0 ? Math.round(Number(custom) * 100) : amountCents;
  const valid = Number.isFinite(value) && value >= MIN_CENTS && value <= MAX_CENTS;

  const submit = async () => {
    if (!valid) return;
    setPending(true);
    setError(null);
    try {
      const url = `${window.location.origin}/apps/${appId}/sponsoring`;
      const checkout = await createTopUpCheckout(appId, {
        amountCents: value,
        successUrl: `${url}?topup=done`,
        cancelUrl: `${url}?topup=cancelled`,
      });
      // The checkout is a hosted page: hand the browser over to it.
      window.location.assign(checkout.url);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not open the checkout'));
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Top up gas sponsoring"
      description="Prepaid, never on credit. Sponsoring stops when the balance reaches zero."
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const selected = custom.trim().length === 0 && preset === amountCents;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setAmountCents(preset);
                  setCustom('');
                }}
                className={cn(
                  'h-10 rounded-pill px-4 text-sm font-medium num',
                  'transition-[transform,background-color,box-shadow,color] duration-150 ease-out active:scale-[0.96]',
                  selected ? 'bg-white text-black' : 'bg-surface-2 text-fg hover:bg-surface-3',
                )}
              >
                {formatCents(preset).replace('.00', '')}
              </button>
            );
          })}
        </div>

        <Field
          label="Custom amount (USD)"
          htmlFor={`${id}-amount`}
          hint="Between 5 and 10,000 dollars."
        >
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            placeholder="50"
            value={custom}
            className="num"
            onChange={(event) => {
              setCustom(event.target.value);
            }}
          />
        </Field>

        {error !== null ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <span className="whitespace-nowrap text-[13px] text-fg-2 num">
            {valid ? `Total ${formatCents(value)}` : 'Enter an amount'}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending || !valid}>
              {pending ? 'Opening checkout' : 'Continue to payment'}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
