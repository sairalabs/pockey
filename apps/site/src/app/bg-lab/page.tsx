import type { Metadata } from 'next';
import { Flow, Keys, Mesh, Nappes, Ribbons } from './variants';

/* The list lives here rather than next to the components: a client module
   hands a server one components, not data. */
const VARIANTS = [
  {
    name: 'Nappes',
    note: 'Three lights drifting on their own clocks. The pointer leans the whole field. What is on the page now.',
    Background: Nappes,
  },
  {
    name: 'Keys',
    note: 'A field of characters placed on a grid, so the site font keeps its alignment. The pointer lights the ones it passes, and only those keep changing.',
    Background: Keys,
  },
  {
    name: 'Flow',
    note: 'Five hundred threads on a slow current, leaving trails. The pointer pushes them aside and the current closes behind it.',
    Background: Flow,
  },
  {
    name: 'Mesh',
    note: 'Five colour points blended into one sheet. One of them follows the pointer, so the whole mesh re-forms around it.',
    Background: Mesh,
  },
  {
    name: 'Ribbons',
    note: 'Three wide bands crossing the screen, undulating. The pointer tilts and lifts them together.',
    Background: Ribbons,
  },
];

/**
 * Five candidates for the hero background, each behind the real sentence, one
 * screen each. Move the pointer over one to see what it does.
 *
 * Throwaway: when one is chosen it moves into `hero-glow.tsx` and this folder
 * is deleted. Not linked from anywhere and kept out of the index.
 */
export const metadata: Metadata = {
  title: 'Background lab',
  robots: { index: false, follow: false },
};

export default function BackgroundLab() {
  return (
    <>
      {VARIANTS.map((variant, index) => (
        <section
          key={variant.name}
          className="relative isolate flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-6 text-center"
        >
          <variant.Background />

          <p className="absolute left-6 top-6 text-[13px] text-fg-2">
            <span className="num text-fg-3">{`0${String(index + 1)}`}</span> {variant.name}
          </p>

          <div className="w-full max-w-[880px]">
            <p className="inline-flex items-center gap-2 rounded-pill bg-surface px-3.5 py-1.5 text-[13px] text-fg-2">
              <span className="size-1.5 rounded-pill bg-accent" />
              Nobody in the middle, including us
            </p>
            <h2 className="mt-7 text-[48px] font-semibold leading-[1.03] tracking-[-0.035em] sm:text-[76px]">
              Embedded wallets your users{' '}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage: 'linear-gradient(120deg, #ffffff 8%, #9d93ff 50%, #ffffff 92%)',
                }}
              >
                own
              </span>
            </h2>
            <p className="mx-auto mt-7 max-w-[540px] text-[17px] leading-[1.6] text-fg-2">
              Login, wallets and signing behind a few React hooks, on your own infrastructure. Your
              server never holds a key that can sign.
            </p>
          </div>

          <p className="absolute inset-x-6 bottom-8 mx-auto max-w-[520px] text-[13px] leading-[1.6] text-fg-3">
            {variant.note}
          </p>
        </section>
      ))}
    </>
  );
}
