import { clsx } from 'clsx';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';

interface OtpInputProps {
  length?: number;
  /** Called once per complete code. */
  onComplete: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Focus the first box on mount. */
  autoFocus?: boolean;
  /** Marks the first box for the dialog's initial focus. */
  initialFocus?: boolean;
}

const empty = (length: number) => Array.from({ length }, () => '');

/** Six numeric boxes: auto advance, full paste, backspace goes back, submits on the last digit. */
export function OtpInput({
  length = 6,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = false,
  initialFocus = false,
}: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(() => empty(length));
  const digitsRef = useRef<string[]>(digits);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  const focusBox = (index: number) => {
    const target = inputs.current[Math.max(0, Math.min(length - 1, index))];
    target?.focus();
    target?.select();
  };

  const commit = (next: string[]) => {
    digitsRef.current = next;
    setDigits(next);
    if (next.every((digit) => digit !== '')) {
      const code = next.join('');
      if (submitted.current !== code) {
        submitted.current = code;
        onComplete(code);
      }
    } else {
      submitted.current = null;
    }
  };

  const fill = (start: number, value: string) => {
    const next = [...digitsRef.current];
    const chars = value.slice(0, length - start);
    for (let i = 0; i < chars.length; i += 1) next[start + i] = chars.charAt(i);
    commit(next);
    focusBox(start + chars.length);
  };

  const onChange = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value.replace(/\D/g, '');
    const previous = digitsRef.current[index] ?? '';
    if (value === '') {
      const next = [...digitsRef.current];
      next[index] = '';
      commit(next);
      return;
    }
    if (value.length >= length) {
      // Autofill of the whole code into one box.
      fill(0, value);
      return;
    }
    if (value.length === 2 && previous !== '') {
      // Typed next to an existing digit: keep the new one.
      const caret = event.currentTarget.selectionStart ?? 2;
      const typed = caret <= 1 ? value.charAt(0) : value.charAt(1);
      fill(index, typed);
      return;
    }
    fill(index, value);
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const next = [...digitsRef.current];
      if (next[index]) {
        next[index] = '';
        commit(next);
      } else if (index > 0) {
        next[index - 1] = '';
        commit(next);
        focusBox(index - 1);
      }
    } else if (event.key === 'Delete') {
      event.preventDefault();
      const next = [...digitsRef.current];
      next[index] = '';
      commit(next);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text').replace(/\D/g, '');
    event.preventDefault();
    if (!text) return;
    fill(text.length >= length ? 0 : index, text);
  };

  return (
    <div className="flex gap-2" role="group" aria-label="Verification code">
      {digits.map((digit, index) => (
        <input
          // Fixed-length list, the index is the identity.
          key={index}
          ref={(node) => {
            inputs.current[index] = node;
          }}
          data-testid={`pk-otp-${String(index)}`}
          data-autofocus={initialFocus && index === 0 ? '' : undefined}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${String(index + 1)} of ${String(length)}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={digit}
          onChange={(event) => {
            onChange(index, event);
          }}
          onKeyDown={(event) => {
            onKeyDown(index, event);
          }}
          onPaste={(event) => {
            onPaste(index, event);
          }}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          className={clsx(
            'h-12 w-full min-w-0 rounded-xl bg-surface-2 text-center text-[20px] font-semibold text-fg tabular-nums caret-accent',
            'shadow-[inset_0_0_0_1px_var(--ring)] disabled:opacity-60',
          )}
        />
      ))}
    </div>
  );
}
