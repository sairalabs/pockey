import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OtpInput } from './OtpInput';

const box = (index: number) => screen.getByTestId<HTMLInputElement>(`pk-otp-${String(index)}`);

function typeDigit(index: number, digit: string) {
  fireEvent.change(box(index), { target: { value: digit } });
}

describe('OtpInput', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders six labelled numeric boxes, one-time-code on the first', () => {
    render(<OtpInput onComplete={() => undefined} />);
    for (let i = 0; i < 6; i += 1) {
      expect(box(i).getAttribute('inputmode')).toBe('numeric');
      expect(box(i).getAttribute('aria-label')).toBe(`Digit ${String(i + 1)} of 6`);
    }
    expect(box(0).getAttribute('autocomplete')).toBe('one-time-code');
    expect(box(1).getAttribute('autocomplete')).toBe('off');
  });

  it('advances focus while typing and submits once on the sixth digit', () => {
    const onComplete = vi.fn();
    render(<OtpInput onComplete={onComplete} />);
    box(0).focus();
    '123456'.split('').forEach((digit, index) => {
      expect(document.activeElement).toBe(box(index));
      typeDigit(index, digit);
    });
    expect([0, 1, 2, 3, 4, 5].map((i) => box(i).value).join('')).toBe('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('ignores non digits', () => {
    const onComplete = vi.fn();
    render(<OtpInput onComplete={onComplete} />);
    typeDigit(0, 'a');
    expect(box(0).value).toBe('');
  });

  it('fills every box from a pasted code, from any box', () => {
    const onComplete = vi.fn();
    render(<OtpInput onComplete={onComplete} />);
    fireEvent.paste(box(3), { clipboardData: { getData: () => ' 987-654 ' } });
    expect([0, 1, 2, 3, 4, 5].map((i) => box(i).value).join('')).toBe('987654');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('987654');
  });

  it('fills every box when autofill drops the whole code into one box', () => {
    const onComplete = vi.fn();
    render(<OtpInput onComplete={onComplete} />);
    typeDigit(0, '246810');
    expect(onComplete).toHaveBeenCalledWith('246810');
  });

  it('backspace clears the current box, then moves back and clears the previous one', () => {
    render(<OtpInput onComplete={() => undefined} />);
    box(0).focus();
    typeDigit(0, '1');
    typeDigit(1, '2');
    expect(document.activeElement).toBe(box(2));

    fireEvent.keyDown(box(2), { key: 'Backspace' });
    expect(document.activeElement).toBe(box(1));
    expect(box(1).value).toBe('');
    expect(box(0).value).toBe('1');

    fireEvent.keyDown(box(1), { key: 'Backspace' });
    expect(document.activeElement).toBe(box(0));
    expect(box(0).value).toBe('');
  });

  it('submits again only after the code changes', () => {
    const onComplete = vi.fn();
    render(<OtpInput onComplete={onComplete} />);
    fireEvent.paste(box(0), { clipboardData: { getData: () => '111111' } });
    fireEvent.paste(box(0), { clipboardData: { getData: () => '111111' } });
    expect(onComplete).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(box(5), { key: 'Backspace' });
    typeDigit(5, '2');
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith('111112');
  });
});
