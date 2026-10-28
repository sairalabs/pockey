# The dashboard

Dark only. One column, centred, around 660px wide for the app pages and wider for
the tables. It is a tool for one person at a time, not a console: dense enough to
read at a glance, quiet enough to stay there.

## Flat

Nothing carries an outline. Cards, rows, fields, menus, badges and switches are
told apart by their fill. The 1px rings, the row separators, the rules between
table rows and the hairlines around images are all gone, and they should stay
gone: a surface that needs a border is a surface whose fill is wrong.

What is left on purpose: the focus ring, white and 2px, and the baseline plus the
hover guide inside the usage chart, which are data rather than decoration and
live on their own `--grid` tokens.

## Tokens

In `src/app/globals.css`, raw values on `:root`, read through Tailwind's
`@theme inline`, so a light theme would be one `[data-theme='light']` block
overriding the same names.

```
--bg           #101010    the page
--surface      #181818    cards, dialogs, menus
--surface-2    #202020    rows and fields inside a card
--surface-3    #2a2a2a    the same under the pointer
--text         #ffffff
--text-2       #a1a1a1
--text-3       #6b6b6b
--accent       #4132ec
--danger       #ff4d4f
--grid         white at 8%, chart furniture only

--radius-card     16px
--radius-dialog   24px
--radius-control  12px    buttons keep the pill
--radius-pill     9999px
```

Utilities worth knowing: `bg-bg`, `bg-surface-2`, `text-fg-2`, `rounded-card`,
`rounded-control`, `rounded-pill`, `ease-out-strong`, and `num` for tabular
numerals, which every figure uses so columns do not dance.

## Components

- **Button**: a pill. Primary is white on black text, secondary is `surface-2`,
  ghost is transparent, danger is a danger-tinted fill. Press scales to 0.96.
- **Field**: a filled surface at `--radius-control`, no resting border, one step
  lighter on hover, white ring on focus.
- **Card**: `surface` at 16px, 20px of padding. Rows inside sit at 10px on
  `surface-2` and are treated as their own surface.
- **Tabs and section nav**: a single 2px accent bar slides from the old tab to
  the new one over 250ms, measured from the active item.
- **Avatar**: hashvatar in dither mode, always a circle, never a letter over it.
- **Empty state**: a bare mark, a bold line, a muted subline, and the action.
- **Settings dialog**: 880 by 640, a 232px sidebar on `surface-2`, items at 14px.
  It runs on the same type scale as the rest of the app, which is the whole point:
  a dialog that sets its own scale feels like a different product.

## Type

Inter, through `next/font`. 28px medium for a page title, 16px semibold for a
pane title, 14px for body, 13px for secondary text, 12px for labels. Nothing
below 12px, and no forced capitals anywhere.

## Motion

A page enters once on mount: opacity and a 12px rise, staggered 100ms per child,
400ms each. No blur, because a blur on a filled button reads as a halo. Hover and
state changes are 150ms on colour, transform only where it answers a gesture.
