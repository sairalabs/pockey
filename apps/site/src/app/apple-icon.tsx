import { ImageResponse } from 'next/og';

/** The icon iOS puts on a home screen, which has to be a bitmap. */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#101010',
      }}
    >
      <svg width="80" height="104" viewBox="0 0 600 780" fill="#ffffff">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M300 0L600 100V580L300 780L0 580V126.49H300V0ZM300 126.49V246.49H120V515.78L300 635.78L480 515.78V186.49L300 126.49Z"
        />
      </svg>
    </div>,
    size,
  );
}
