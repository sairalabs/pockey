import type { CSSProperties } from 'react';
import { AsciiField } from './ascii-field';
import { Grain } from './grain';

/*
  Five bands of light, each hung on two swings whose periods share no factor.
  Wider than the frame by half, so an end never comes into it, and in white
  alone: on this page the light has no colour of its own.
*/
const BANDS = [
  {
    top: '13%',
    height: '11rem',
    tilt: '-12deg',
    fill: 'rgba(255, 255, 255, 0.05)',
    blur: '95px',
    x: { sway: '5%', duration: '53s', delay: '-17s' },
    y: { sway: '4%', duration: '71s', delay: '-29s' },
  },
  {
    top: '28%',
    height: '8rem',
    tilt: '-6deg',
    fill: 'rgba(255, 255, 255, 0.035)',
    blur: '80px',
    x: { sway: '7%', duration: '61s', delay: '-41s' },
    y: { sway: '3%', duration: '83s', delay: '-11s' },
  },
  {
    top: '44%',
    height: '14rem',
    tilt: '-17deg',
    fill: 'rgba(255, 255, 255, 0.055)',
    blur: '110px',
    x: { sway: '4%', duration: '67s', delay: '-8s' },
    y: { sway: '5%', duration: '97s', delay: '-47s' },
  },
  {
    top: '60%',
    height: '9rem',
    tilt: '3deg',
    fill: 'rgba(255, 255, 255, 0.03)',
    blur: '100px',
    x: { sway: '6%', duration: '79s', delay: '-63s' },
    y: { sway: '4%', duration: '101s', delay: '-5s' },
  },
  {
    top: '74%',
    height: '12rem',
    tilt: '-9deg',
    fill: 'rgba(255, 255, 255, 0.04)',
    blur: '120px',
    x: { sway: '5%', duration: '89s', delay: '-29s' },
    y: { sway: '6%', duration: '113s', delay: '-73s' },
  },
];

/** A custom property, which the style attribute types do not know about. */
function swing(sway: string, duration: string, delay: string): CSSProperties {
  return { '--sway': sway, animationDuration: duration, animationDelay: delay } as CSSProperties;
}

/**
 * Bands of light drifting behind the sentence, with a field of characters over
 * them. Nothing here follows the pointer: the light moves at its own pace, and
 * only the characters answer.
 *
 * Kept dark and colourless on purpose. The sentence is the subject.
 */
export function HeroGlow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-bg"
    >
      <div className="absolute inset-[-30%]">
        {BANDS.map((band) => (
          <div
            key={band.top}
            className="sway-x"
            style={swing(band.x.sway, band.x.duration, band.x.delay)}
          >
            <div className="sway-y" style={swing(band.y.sway, band.y.duration, band.y.delay)}>
              <span
                className="absolute left-[-15%] w-[150%] rounded-pill"
                style={{
                  top: band.top,
                  height: band.height,
                  transform: `rotate(${band.tilt})`,
                  background: band.fill,
                  filter: `blur(${band.blur})`,
                }}
              />
            </div>
          </div>
        ))}
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
        <AsciiField base={0.038} />
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
