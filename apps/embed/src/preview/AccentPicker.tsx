import { clsx } from 'clsx';
import { Pipette } from '../components/icons';
import { useId, useState } from 'react';
import { normalizeHexColor, resolveAccentColors, type ColorMode } from '../lib/theme';

function accentLabel(resolved: { foreground: string; inverted: boolean }, mode: ColorMode): string {
  const text = resolved.foreground === '#ffffff' ? 'white text' : 'dark text';
  if (!resolved.inverted) return text.charAt(0).toUpperCase() + text.slice(1);
  // The picked color disappears into this surface, so buttons use the theme text color instead.
  return mode === 'dark' ? `White buttons, ${text}` : `Black buttons, ${text}`;
}

export const ACCENT_PRESETS = ['#d2042d', '#0052ff', '#16a34a', '#0a0a0a'] as const;

/**
 * Preset swatches plus a custom color: native picker and a hex field that
 * accepts `d2042d`, `#D2042D` or `#abc`. The chip on the right shows what the
 * modal will actually render: the resolved fill and the text color on it.
 */
export function AccentPicker({
  value,
  mode,
  onChange,
}: {
  value: string;
  mode: ColorMode;
  onChange: (accent: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const isPreset = (ACCENT_PRESETS as readonly string[]).includes(value);
  const shown = editing ? draft : value.toUpperCase();
  const invalid = editing && normalizeHexColor(draft) === null;
  const resolved = resolveAccentColors(value, mode);

  const commit = (raw: string) => {
    const color = normalizeHexColor(raw);
    if (color) onChange(color);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Accent">
      <div className="flex items-center">
        {ACCENT_PRESETS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`Accent ${swatch}`}
            aria-pressed={value === swatch}
            onClick={() => {
              onChange(swatch);
            }}
            className="pk-press flex size-10 items-center justify-center rounded-full"
          >
            <span
              className={clsx(
                'size-6 rounded-full shadow-[inset_0_0_0_1px_oklch(0.5_0_0/0.25)]',
                value === swatch && 'outline-2 outline-offset-2 outline-fg',
              )}
              style={{ background: swatch }}
            />
          </button>
        ))}

        <label
          htmlFor={`${id}-native`}
          className="pk-press relative flex size-10 cursor-pointer items-center justify-center rounded-full"
          title="Custom color"
        >
          <span
            className={clsx(
              'flex size-6 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_oklch(0.5_0_0/0.25)]',
              !isPreset && 'outline-2 outline-offset-2 outline-fg',
            )}
            style={{
              background: isPreset
                ? 'conic-gradient(from 90deg, #d2042d, #f59e0b, #16a34a, #0891b2, #0052ff, #db2777, #d2042d)'
                : value,
            }}
          >
            {isPreset && <Pipette size={12} className="text-white" aria-hidden="true" />}
          </span>
          <input
            id={`${id}-native`}
            type="color"
            value={normalizeHexColor(value) ?? '#d2042d'}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            aria-label="Custom accent color"
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>

      <label htmlFor={`${id}-hex`} className="sr-only">
        Accent hex value
      </label>
      <input
        id={`${id}-hex`}
        value={shown}
        spellCheck={false}
        autoComplete="off"
        inputMode="text"
        maxLength={7}
        aria-invalid={invalid}
        onFocus={() => {
          setDraft(value.toUpperCase());
          setEditing(true);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          commit(event.target.value);
        }}
        onBlur={() => {
          setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className={clsx(
          'h-9 w-[92px] rounded-[10px] bg-surface-2 px-2.5 text-[13px] text-fg tabular-nums uppercase outline-none',
          'transition-[box-shadow] duration-150 ease-out',
          invalid && 'shadow-[inset_0_0_0_1px_var(--danger)]',
        )}
      />

      <span
        className="inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium tabular-nums"
        style={{ background: resolved.accent, color: resolved.foreground }}
        aria-live="polite"
      >
        {accentLabel(resolved, mode)}
      </span>
    </div>
  );
}
