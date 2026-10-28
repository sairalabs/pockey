# The modal

The modal is the product. It renders inside apps nobody here controls, so it has
to sit well next to any brand: quiet, precise, themable, never loud.

Open `/?preview=1` on the embed dev server to see every screen at once, in both
themes and all four corner scales. Change a screen, look at the gallery.

## Frame

The iframe covers the host viewport and is transparent. The embed draws the
backdrop and a centred dialog.

- Backdrop `oklch(0 0 0 / 0.4)` light, `oklch(0 0 0 / 0.6)` dark, blurred 4px.
  Clicking it or pressing Escape cancels the pending request with `user_rejected`.
- Dialog 380px wide, `min(640px, 100dvh - 32px)` tall, 24px padding, on a real
  drop shadow in both themes. The body scrolls, the header and footer stay.
- Under 480px of viewport width it becomes a bottom sheet: full width, rounded
  on the top corners only, 20px padding plus `env(safe-area-inset-bottom)`.

## Flat

No surface carries an outline. A card, a row, a field and a chip are told apart
by their fill, never by a 1px ring, and the same holds in dark mode where a ring
is the lazy answer. The only rings left are the focus ring, which keyboard users
need, and the danger ring on a wallet whose request was refused.

## Tokens

Set by `ThemeScope` from the app's `appearance`, read everywhere as CSS
variables. A developer can override the colours per mode, the font stack, the
corner scale and the overlay opacity; anything they leave out keeps the value
below.

```
                 light      dark
--surface        #ffffff    #101010    the dialog
--surface-2      #f5f5f5    #1b1b1b    rows, fields, message boxes
--surface-3      #ebebeb    #262626    the same under the pointer
--text           #0a0a0a    #fafafa
--text-2         #525252    #a3a3a3
--text-3         #a3a3a3    #525252
--danger         #dc2626    #f87171
--accent         from appearance.accent, #4132ec by default
--accent-fg      white, or near black when white would not be readable on it
```

The accent rules live in `packages/types/src/color.ts`, shared with the dashboard
preview so a developer sees exactly what their users will see. When the chosen
accent disappears into the surface, primary buttons fall back to the text colour.

Corner scale, swapped as a set by `data-radius`:

```
              sharp   soft (default)   round   pill
panel         0       24               32      32
row           0       16               20      9999
control       0       12               16      9999
mark          0       11               14      9999
```

## Screens

Every screen opens on a header bar: back or help on the left, the screen name
centred, close on the right. A screen that has a mark carries its title big
under it; one without puts its title in the bar. A screen with nothing to act on
drops the bar entirely and centres what it has left.

A choice is a row: label left in 16px semibold, brand mark right at 40px, 60px
tall on one filled surface. A wallet waiting on the user shows its mark at 80px,
ringed in danger with a retry badge once the request is refused.

Marks come from Boxicons, solid wherever Boxicons draws a solid cut, in a
generated module. Wallet brands come from a bundled set loaded on demand, so a
wallet that hands us no icon still shows its own.

## Motion

Transform and opacity only, everything under 250ms, and all of it answers a
gesture: nothing moves on its own.

- A press scales to 0.96 in 150ms.
- A row lifts its brand mark 8% as the pointer arrives.
- The glyph inside a corner button answers before the button does.
- A screen mark arrives with its screen, 260ms.
- A field lifts one pixel on focus.
- Contextual swaps (copy to check, label to spinner) cross-fade in 300ms with
  both layers in the DOM, so the width never jumps.

All of it is off under `prefers-reduced-motion`.

## Accessibility

Errors live in an `aria-live="polite"` region. Hit areas are at least 40px. The
focus ring is 2px of accent at 2px offset, and it is never removed, only moved.
