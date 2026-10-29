import { AsciiField } from './ascii-field';
import { Grain } from './grain';

/**
 * Three wide bands crossing behind the sentence, each on its own long, uneven
 * loop, with a field of characters over them. Nothing here follows the
 * pointer: the light moves at its own pace, and only the characters answer.
 *
 * Kept dark on purpose: the colour is a hint of where the light comes from,
 * not the subject. The sentence is the subject.
 */
export function HeroGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-[-25%]">
        <span className="ribbon-a absolute left-[-10%] top-[22%] h-[13rem] w-[120%] -rotate-12 rounded-pill bg-accent/18 blur-[90px]" />
        <span className="ribbon-b absolute left-[-10%] top-[42%] h-[9rem] w-[120%] -rotate-6 rounded-pill bg-[#7b6bff]/8 blur-[80px]" />
        <span className="ribbon-c absolute left-[-10%] top-[62%] h-[15rem] w-[120%] -rotate-[14deg] rounded-pill bg-[#120c52]/55 blur-[100px]" />
      </div>

      {/* Masked away from the middle, so the characters frame the sentence
          rather than run under it. */}
      <div
        className="absolute inset-0"
        style={{
          maskImage: 'radial-gradient(50% 44% at 50% 50%, transparent 20%, #000 100%)',
          WebkitMaskImage: 'radial-gradient(50% 44% at 50% 50%, transparent 20%, #000 100%)',
        }}
      >
        <AsciiField base={0.06} />
      </div>
      <Grain />

      {/* The page comes back at the corners, and then at the bottom. */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(115% 85% at 50% 28%, transparent 22%, #101010 92%)' }}
      />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-b from-transparent to-bg" />
    </div>
  );
}
