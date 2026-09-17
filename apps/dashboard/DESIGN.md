# Dashboard design reference

Source: screenshots of the Base developer dashboard (Coinbase), provided by Medhy on 2026-09-15. Reproduce the feel, not the brand. Apply `.agents/skills/better-ui` and `.agents/skills/emil-design-eng` on every component.

## What the references show

1. **Home** (`Welcome, stonkbox`). Pure black page, centered column ~660px wide. Top bar: app switcher (small square icon + app name + up/down chevron) on the left, three icon buttons on the right (inbox, gear, avatar). Below: `Welcome, <app>` in ~28px medium weight. A row with a `Last week` pill select on the left and an `App Rankings >` pill button on the right. A KPI block: small muted label `Total Daily Transacting Users` with an info icon, big number below, a 1px blue accent line at the bottom of the block spanning the full width. Then a segmented control `Base App | Other` (pill, selected segment lighter). Then a 2-column grid of cards: each card has a muted label top-left, a large number, empty chart area, and a 1px blue accent line at the bottom. Some cards contain list rows (`Home 0`, `Search 0`, `Messaging 0`) rendered as slightly lighter rounded rows inside the card. Footer: `Dashboard` logo text, links (Home, Docs, Terms, Privacy, Preferences, Help), social icons.

2. **Notifications popover**. Anchored under the inbox icon, ~360px wide, dark card with 1px translucent border, tabs `Unread 0 | Completed` with underline indicator, empty state centered: circular icon badge, `You're all caught up.` bold, muted subline.

3. **Account menu**. Small popover under the avatar: rows `0x91CD...99df` (copy icon), `Manage Account`, `Log Out`. 16px icons, 14px text.

4. **Settings dialog**. Large centered dialog (~1300px max, ~92vh), radius ~24px, dark surface, 1px translucent border. Left sidebar ~400px: section labels (`App`, `Account`, `General`) muted uppercase-ish small text, nav items with 20px icons and 22px text (large, airy): App Information, Configuration, Members, Builder Codes, API Keys, Appcoin, Account Information, Notifications, Appearance. Selected item has a lighter rounded background (radius 12px). Right pane: title row (`Visibility`, close X on the right), 1px divider, then setting rows: bold title + muted description on the left, toggle switch on the right. Toggle: 70px wide pill, white knob when on, dark when off. Members page: title with count badge, member row with avatar + truncated address + `Owner` chip, `+ Add` outlined pill button. Account Information: label/value pairs, `Update` filled pill button, `Danger Zone` section with `Delete` red outlined pill.

5. **App Rankings**. `< Base App | Base Chain` segmented control, title `Popular Apps` with `Last updated on ...` muted subline, `Refreshes in` countdown card top-right, search input, ranked list rows (rank number in rounded square, app icon 32px rounded, name + url muted, `1,008 WTUs` right aligned, tabular numbers).

## Tokens (dark first, this dashboard ships dark only at MVP)

```
--bg:            #000000        page
--surface:       #0f0f0f        cards, dialog
--surface-2:     #171717        rows inside cards, hover
--surface-3:     #212121        selected nav item, pressed
--border:        oklch(1 0 0 / 0.08)   1px rings (shadow-border per better-ui)
--border-strong: oklch(1 0 0 / 0.13)   hover ring
--text:          #ffffff
--text-2:        #a1a1a1        secondary
--text-3:        #6b6b6b        tertiary, placeholders
--accent:        #0052ff        Base blue, used only for the 1px card underline and focus
--danger:        #ff4d4f
--radius-card:   16px
--radius-dialog: 24px
--radius-pill:   9999px
```

Font: Inter (via `next/font/google`), `font-feature-settings: "cv11", "ss01"`, tabular numbers on every numeric value. Base sizes: 14px body, 13px labels, 28px page titles, 22px dialog nav items.

## Rules pulled from the skills

- Concentric radius: dialog 24px with 8px padding means inner nav item 16px, and so on. Compute, never guess.
- Cards: no border, use `box-shadow: 0 0 0 1px oklch(1 0 0 / 0.08)`; hover `0.13`. Transition `box-shadow 150ms ease-out`.
- Buttons: `active:scale-[0.96]`, `transition-transform 150ms ease-out`, `static` prop to opt out.
- Popovers: `transform-origin: var(--transform-origin)`, enter `opacity 0 -> 1`, `scale 0.97 -> 1`, 150ms `cubic-bezier(0.23, 1, 0.32, 1)`; exit faster, 120ms.
- Dialog: centered, `scale 0.97 -> 1` + opacity, 200ms; backdrop `oklch(0 0 0 / 0.6)` with `backdrop-filter: blur(4px)`.
- Tabs and segmented control: no motion beyond a 150ms `background-color` transition; no stagger.
- Icons: lucide, `stroke-width 1.5` beside 400 text, `2` beside 500 or 600 text, `currentColor` only.
- Page enter: stagger title, filters and cards by 100ms with `opacity + translateY(12px) + blur(4px)`, 400ms ease-out, once per navigation, CSS keyframes (one-shot), respect `prefers-reduced-motion`.
- No `transition: all`. No em dashes anywhere in copy.

## Implementation notes

Written 2026-09-15 with the first mocked version of the dashboard (no auth, no network, `TODO(T5.1)` markers where real data plugs in).

### Where things live

- Tokens: `src/app/globals.css`. Raw values sit on `:root` (`--bg`, `--surface`, `--text-2`, `--accent`...) and Tailwind 4 reads them through `@theme inline`, so a light theme is one `[data-theme='light']` block that overrides the same variables. Utilities: `bg-bg`, `bg-surface-2`, `text-fg-2`, `shadow-border`, `rounded-card`, `rounded-dialog`, `rounded-pill`, `ease-out-strong`, `num` (tabular numerals).
- Primitives: `src/components/ui/*`. Base UI (`@base-ui-components/react` rc) for Popover, Menu, Select, Dialog, Tabs, Switch, ToggleGroup; everything else is plain markup.
- Shell: `src/components/shell/*` (top bar, app switcher, notifications popover, account menu, settings dialog and its eight panes, footer, app section nav).
- Pages: `src/app/(app)/...` share the shell, `src/app/login` does not. `/apps/[id]` routes use the internal `app_...` id; the public `pk_app_...` id is shown and copyable on the app card and the keys page.

### Values used

- Press feedback: `active:not-disabled:scale-[0.96]`, `transition-[transform,...] duration-150 ease-out`, `static` prop on `Button` and `IconButton`.
- Cards: `box-shadow: 0 0 0 1px oklch(1 0 0 / 0.08)`, hover `0.13`, `transition: box-shadow 150ms ease-out`. The accent underline is an `::after` 1px line clipped by the 16px radius.
- Popups (`.popup`): `transform-origin: var(--transform-origin)`, `opacity 0 -> 1` and `scale 0.97 -> 1`, 150ms `cubic-bezier(0.23, 1, 0.32, 1)`, exit 120ms. The `scale` property is used instead of `transform` so it never fights Tailwind's `translate` utilities.
- Dialog (`.dialog-popup`): centered, `transform-origin: center`, `scale 0.97 + opacity`, 200ms enter, 150ms exit; backdrop `oklch(0 0 0 / 0.6)` + `backdrop-filter: blur(4px)`.
- Keyboard opens: Base UI already stamps `data-instant` on popups opened from the keyboard; our wrappers add `data-no-motion` from the native event as a second signal (also on the dialog, which Base UI leaves out). Both zero the transition duration.
- Page enter: `.stagger > *` runs `enter-up` (opacity, translateY 12px, blur 4px) 400ms ease-out, 100ms per child, keyframes so it plays once per mount. Under `prefers-reduced-motion` it becomes a 200ms fade with no delay and popups lose the scale.
- Tabs and segmented: 150ms `color` / `background-color` only, no indicator motion.
- Concentric radii: settings dialog 24px, sidebar padding 12px, selected item 12px. Menu and select popups 12px with 4px padding, items 8px. Segmented pill 9999 with 4px padding, segments 9999.
- Icons: lucide only, `strokeWidth={1.5}` beside regular text, `2` beside medium or semibold text, `size-4` inline and `size-5` in the settings nav and icon buttons.
- Switch: 44x24 track, 20px knob, knob translates 20px, white when on.

### Deviations from the reference, with reasons

- Card rows (`CardRow`, the `Email 812` style rows) use a 10px radius inside 16px cards with 20px padding. Strict concentric math gives a negative radius there; better-ui treats surfaces past ~20px of inset as independent, so the rows are their own surface.
- Card hover ring is applied to every card, as DESIGN.md states, even on cards that are not clickable.
- Form inputs keep a real 1px border (better-ui: borders for form outlines, shadows for depth).
- The dashboard has no light theme yet, so the Appearance pane exposes switch rows only. The login modal preview in Configuration does resolve `light`, `dark` and `system`.
- Footer social buttons use `Globe`, `MessageCircle` and `AtSign`: the installed lucide version has no brand icons, and only lucide is allowed.
- `Fingerprint` and `Trash2` do not exist in the installed lucide version either; `ScanFace` stands in for passkeys.
- ESLint: `eslint-config-next/core-web-vitals` is spread before the shared `base` so the type-aware typescript-eslint setup keeps the parser for `.ts/.tsx`. `import/no-default-export` is switched off for `src/**` because the App Router requires default exports.

## Wired to the admin API (T5.1, T5.2, T5.3, T5.4 UI), 2026-09-17

The mock is gone: `src/lib/mock-data.ts` is deleted and every page reads the
real `/admin/*` API. The design above is unchanged, only its data source is.

### Data layer

- `src/app/api/admin/[...path]/route.ts` is a same origin proxy. It forwards
  method, query, body and cookies to `${POCKETKEY_API_URL}/admin/...` (default
  `http://localhost:8787`) and hands back `Set-Cookie`, `Location` and the
  status. The browser therefore only ever talks to the dashboard origin: no CORS
  preflight, no third party cookie, and the `pocketkey_dev` session cookie is a
  first party cookie of the dashboard.
- `src/lib/api.ts` is the browser client: it calls the proxy, parses every
  answer with the Zod schemas of `@pocketkey/types`, and throws a typed
  `ApiError` carrying `code`, `message`, `details` and `requestId`.
- `src/lib/api.server.ts` is the same thing for server components: it reads the
  cookies of the incoming request with `cookies()` and calls the API directly.
  `tryFetch` turns the single 401 into "render the login screen" and lets every
  other error bubble to the error boundary.
- Server components render the first paint; mutations and range switches run in
  client components against the proxy, then `router.refresh()` so the server
  data and the screen agree.

### Where the design met the contract

- `App information` shows name, slug and allowed origins. The mocked tagline and
  description do not exist in `packages/types/src/app.ts`, and the public id and
  creation date took their place.
- `Configuration` gained a display name and a logo URL: both are real
  `appearance` fields with nowhere else to live.
- `Members` lists the session developer as the owner. There is no member table
  and no invite route, so the invite form is gone rather than fake.
- `Account information` is read only with a sign out. `/admin` has no route to
  update or delete a developer.
- Home and Usage lost the `Web | React Native` segmented control: usage is not
  broken down per platform anywhere in the contract. The range select now
  carries the three ranges the API serves, `7d`, `30d` and `12m`.
- Sponsoring caps are the Solana daily cap in lamports, the only cap the API
  stores. The mocked USD app cap and per user cap do not exist. The recent
  sponsored transactions table is gone: no endpoint lists them.
- Billing renders `BillingSummary` only. Invoices and the card on file are not
  exposed, the Stripe portal is.

### Charts

`src/components/charts/usage-chart.tsx`, inline SVG, no dependency, following
the `dataviz` skill: one column chart per measure, one series each so no legend,
marks capped at 20 viewbox units (about 24px) with a 4 unit rounded cap and a 2
unit gap, one recessive hairline at a rounded maximum, `--accent` as the single
data color (validated above 3:1 against `--surface`), and axis and value text in
HTML so it keeps the site font and never wears the series color. Hover and the
arrow keys move one readout, and the table under the charts holds every value,
so the tooltip enhances and never gates. `Sparkline` no longer clamps its
maximum to 1, which used to flatten the fractional gas series.
