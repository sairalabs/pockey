# Embed modal design brief

The modal is the product (spec principle 4). It renders inside customer apps we do not control, so it must look native next to any brand: quiet, precise, themable, never loud. Apply `.agents/skills/better-ui` and `.agents/skills/emil-design-eng` literally.

## Frame

- The iframe covers the host viewport and is transparent. The embed draws a backdrop and a centered dialog.
- Backdrop: `oklch(0 0 0 / 0.4)` light, `oklch(0 0 0 / 0.6)` dark, `backdrop-filter: blur(4px)`. Clicking it or pressing Escape cancels the pending request with `user_rejected`.
- Dialog: width 380px, max-height `min(640px, 100dvh - 32px)`, radius 24px, padding 24px, surface token, shadow ring (better-ui: layered transparent shadows in light, one white ring in dark). Content scrolls inside, header stays.
- Under 480px viewport width: bottom sheet, full width, radius 24px on top corners only, padding 20px plus `env(safe-area-inset-bottom)`.
- Inner surfaces sit 24px inside the dialog, so per better-ui they are independent: buttons and inputs 12px radius, message boxes 12px, chips 9999px.

## Theme tokens

Light and dark, chosen by `appearance.theme` (`system` follows `prefers-color-scheme`). Accent from `appearance.accent` (default cherry `#d2042d`). The color rules live in `packages/types/src/color.ts` and are shared with the dashboard preview.

```
                light                  dark
--surface       #ffffff                #111111
--surface-2     #f5f5f5                #1a1a1a   inputs, message boxes, secondary buttons
--surface-3     #ebebeb                #242424   hover, pressed
--text          #0a0a0a                #fafafa
--text-2        #525252                #a3a3a3
--text-3        #a3a3a3                #525252
--ring          oklch(0 0 0 / 0.08)    oklch(1 0 0 / 0.08)
--danger        #dc2626                #f87171
--accent        from config, replaced by --text when it melts into the surface (WCAG ratio below 1.35: black on dark, white on light)
--accent-fg     #ffffff whenever white reaches APCA Lc 50 on the accent, #0a0a0a otherwise (white text first)
--accent-hover  color-mix(in oklch, var(--accent) 90%, var(--accent-fg))
```

No monospace anywhere, including hashes, addresses, codes and keys: use the site font with tabular numbers.

Font: system stack `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif` (no webfont: CSP and host neutrality). 15px body, 20px/600 titles, 13px secondary. Tabular numbers for codes, amounts, countdowns, addresses.

## Screens and copy

No em dash anywhere. Sentence case. Short.

1. **Login** (`login` request)
   - Header: app logo (40px, 12px radius, 1px image outline per better-ui, fallback: first letter on accent), title `Log in or sign up`, subline `to {app name}`.
   - Email field (placeholder `you@example.com`) with a trailing `Continue` primary button that appears only when the value is a plausible email.
   - Divider `or`.
   - One secondary button per enabled method, in config order: `Continue with Google`, `Continue with Apple`, `Continue with a passkey`, `Continue with a wallet`. 20px icon on the left, label centered optically.
   - Footer: small lock icon + `Protected by Pocketkey`.
2. **Email code**: back button, title `Check your email`, subline `Enter the 6 digit code sent to {email}`. Six boxes, 48px tall, auto advance, full paste support, backspace goes back, submits automatically on the sixth digit. Error text below: `That code is not valid. Try again.` Resend link with countdown `Resend code in 0:30`, then `Resend code`.
3. **Passkey**: large key icon, title `Use your passkey`, subline `Follow your device prompt`. On failure: `Passkey sign in was cancelled` + `Try again` button.
4. **Wallet**: list of detected wallets (EIP-6963 announcements with their icons, then `window.ethereum`, then Phantom for Solana), each a row button. After choosing: `Confirm in {wallet name}` with the wallet icon. Nothing detected: `No wallet found in this browser`.
5. **OAuth**: `Continue in the popup` with a spinner. If the popup is blocked: `Open {Google}` button (the second click is a user gesture).
6. **Success**: checkmark (icon transition values from better-ui), title `You are in`, auto close after 600ms.
7. **Confirm signature** (`signMessage`, `signTypedData`)
   - Title `Sign message` or `Sign data`. Requester row: favicon-less origin chip `{host}`.
   - Wallet row: chain icon + truncated address `0x4bF0...F711` (middle truncation, tabular).
   - Message box: site font 14px with tabular numbers (never monospace), 12px radius, max-height 200px scroll. Hex messages that decode to printable UTF-8 show decoded text with a `Hex` toggle.
   - Typed data: `{domain.name}` + primary type, then a key/value list (nested objects indented one level, long values truncated with expand).
   - Buttons: `Cancel` secondary, `Sign` primary, full width row, 8px gap.
8. **Confirm transaction** (`signTransaction`, `sendTransaction`)
   - Title `Confirm transaction`. Rows: `To` (truncated + copy icon), `Amount` (formatted with symbol ETH or SOL and full precision on hover), `Network` (name from chain id or cluster), `Data` (`{n} bytes` expandable) for EVM, `Instructions` count for Solana.
   - Primary label `Send` for send, `Sign` for sign.
   - Pending: the primary label cross-fades to a spinner, button width stays fixed (no layout shift).
9. **Export**: warning icon, title `Export private key`, body `Anyone with this key has full control of this wallet. Never share it.` Hold-to-reveal button `Hold to reveal` (emil hold-to-delete pattern: 1.5s linear clip-path fill on press, 200ms ease-out snap back on release). Revealed state shows the key in a box with copy, site font, tabular numbers. With the mock key provider the bundle is not a key: show `Development build: export is simulated`.
10. **Error**: inline where possible. Full screen fallback: title `Something went wrong`, the API message, `Close`.

## Motion (exact values)

- Easing tokens: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`.
- Dialog enter: opacity 0 to 1, scale 0.97 to 1, 200ms ease-out, `transform-origin: center`. Exit: 150ms.
- Backdrop: opacity 200ms enter, 150ms exit.
- Bottom sheet: translateY(100%) to 0, 300ms ease-drawer; exit 200ms ease-out.
- Screen changes inside the dialog: height follows content (measure with ResizeObserver, `transition: height 200ms var(--ease-out)`); outgoing content fades out in 100ms, incoming fades in with translateX(8px) to 0 and blur(2px) to 0 over 150ms. Backward navigation mirrors the direction.
- Press feedback: `scale(0.96)`, 150ms ease-out, on every button except the OTP boxes.
- Icon swaps (copy to check, spinner to label): scale 0.25 to 1, opacity 0 to 1, blur 4px to 0, `cubic-bezier(0.2, 0, 0, 1)` 300ms, both icons kept in the DOM.
- Keyboard initiated actions (Enter to submit, Escape to close) never animate beyond opacity.
- `prefers-reduced-motion: reduce`: opacity only, no transforms, no blur, no height animation.
- Only `transform`, `opacity`, `filter`, `height` (the one container), `clip-path` animate. Never `transition: all`.

## Accessibility

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title. Focus moves to the first field on open and is trapped. Escape cancels.
- OTP boxes: `inputmode="numeric"`, `autocomplete="one-time-code"` on the first box, `aria-label="Digit n of 6"`.
- Errors in an `aria-live="polite"` region. Hit areas at least 40px. Visible focus ring: 2px accent at 2px offset.

## Preview mode

Opening the embed top level with `?preview=1&appId=...` renders every screen above on one page with mock data, plus theme (light, dark), accent presets (cherry, blue, green, black), a custom color (native picker and hex field) and a chip showing the resolved fill and text color. It exists so design can iterate without going through the host SDK.
