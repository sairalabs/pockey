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
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-bg"
    >
      {/* Wider than the frame by half, so an end never comes into it. */}
      <div className="absolute inset-[-30%]">
        <span className="band band-1 absolute left-[-15%] top-[14%] h-[11rem] w-[150%] -rotate-12 rounded-pill bg-accent/14 blur-[95px]" />
        <span className="band band-2 absolute left-[-15%] top-[29%] h-[8rem] w-[150%] -rotate-6 rounded-pill bg-[#7b6bff]/8 blur-[80px]" />
        <span className="band band-3 absolute left-[-15%] top-[44%] h-[14rem] w-[150%] -rotate-[17deg] rounded-pill bg-[#120c52]/26 blur-[110px]" />
        <span className="band band-4 absolute left-[-15%] top-[61%] h-[9rem] w-[150%] rotate-3 rounded-pill bg-accent/9 blur-[100px]" />
        <span className="band band-5 absolute left-[-15%] top-[75%] h-[12rem] w-[150%] -rotate-[9deg] rounded-pill bg-[#1a1270]/20 blur-[120px]" />
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
      {/* Light grain: on a surface this dark, more of it reads as grey. */}
      <Grain opacity={0.04} />

      {/* The page colour comes back at the corners, and then at the bottom. */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(95% 65% at 50% 24%, transparent 8%, #101010 82%)' }}
      />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-b from-transparent to-bg" />
    </div>
  );
}
