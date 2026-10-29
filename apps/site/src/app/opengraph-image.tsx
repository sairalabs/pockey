import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

/**
 * The card every link to this site unfurls into. Drawn here rather than kept as
 * a file so it cannot fall out of step with the tagline.
 */
export const alt = `${site.name}, ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#101010',
        color: '#ffffff',
        padding: '76px 80px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <svg width="30" height="39" viewBox="0 0 600 780" fill="#ffffff">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M300 0L600 100V580L300 780L0 580V126.49H300V0ZM300 126.49V246.49H120V515.78L300 635.78L480 515.78V186.49L300 126.49Z"
          />
        </svg>
        <div style={{ fontSize: 30, letterSpacing: '-0.01em' }}>Pockey</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 76,
            lineHeight: 1.05,
            letterSpacing: '-0.035em',
            maxWidth: 940,
          }}
        >
          Embedded wallets your users own
        </div>
        <div style={{ marginTop: 28, fontSize: 30, color: '#a1a1a1', maxWidth: 880 }}>
          Login, wallets and signing behind a few React hooks, on your own infrastructure.
        </div>
      </div>

      <div style={{ display: 'flex', fontSize: 24, color: '#6b6b6b' }}>
        Open source, MIT licensed, self hosted
      </div>
    </div>,
    size,
  );
}
