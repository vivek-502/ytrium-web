import type { ReactNode, SVGProps } from 'react';

/**
 * Original icon set (hand-drawn 24px stroke icons) - no third-party icon
 * package, keeps the bundle small and the identity consistent.
 */

const PATHS: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3 10.6 12 3.2l9 7.4" />
      <path d="M5.5 9.6V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.6" />
      <path d="M9.8 21v-6h4.4v6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.2-4.2" />
    </>
  ),
  library: (
    <>
      <path d="M4 4v16" />
      <path d="M9 4v16" />
      <path d="m14.5 4.5 4.6 15.4" />
    </>
  ),
  heart: (
    <path d="M12 20.3s-7.3-4.4-9.3-8.7A5.2 5.2 0 0 1 12 6.6a5.2 5.2 0 0 1 9.3 5c-2 4.3-9.3 8.7-9.3 8.7Z" />
  ),
  'heart-filled': (
    <path
      fill="currentColor"
      stroke="none"
      d="M12 20.6s-7.5-4.5-9.5-8.9A5.3 5.3 0 0 1 12 6.4a5.3 5.3 0 0 1 9.5 5.3c-2 4.4-9.5 8.9-9.5 8.9Z"
    />
  ),
  play: <path fill="currentColor" stroke="none" d="M8 5.4v13.2L19 12z" />,
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="6.5" y="5" width="3.8" height="14" rx="1.2" />
      <rect x="13.7" y="5" width="3.8" height="14" rx="1.2" />
    </g>
  ),
  'skip-next': (
    <g fill="currentColor" stroke="none">
      <path d="M5.5 5.6v12.8L15.5 12z" />
      <rect x="17" y="5" width="2.4" height="14" rx="1" />
    </g>
  ),
  'skip-prev': (
    <g fill="currentColor" stroke="none">
      <path d="M18.5 5.6v12.8L8.5 12z" />
      <rect x="4.6" y="5" width="2.4" height="14" rx="1" />
    </g>
  ),
  shuffle: (
    <>
      <path d="M16.5 4.5 21 9l-4.5 4.5" />
      <path d="M16.5 15 21 19.5" />
      <path d="M3 9h3.5c1.4 0 2.7.7 3.5 1.8l4 6c.8 1.1 2.1 1.8 3.5 1.8H21" />
      <path d="M3 15h3.5c1 0 1.9-.3 2.6-1" />
      <path d="M14.5 8.5c.6-.8 1.5-1.5 2.5-1.5H21" />
    </>
  ),
  repeat: (
    <>
      <path d="m17 2.5 4 4-4 4" />
      <path d="M3 11.5v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 21.5-4-4 4-4" />
      <path d="M21 12.5v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  'repeat-1': (
    <>
      <path d="m17 2.5 4 4-4 4" />
      <path d="M3 11.5v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 21.5-4-4 4-4" />
      <path d="M21 12.5v1a4 4 0 0 1-4 4H3" />
      <path d="M11 10.4 12.6 9.6V15" />
    </>
  ),
  'volume-high': (
    <>
      <path d="M11 5.5 6.5 9.2H3v5.6h3.5L11 18.5z" />
      <path d="M15 9.5a3.6 3.6 0 0 1 0 5" />
      <path d="M17.8 6.8a7.4 7.4 0 0 1 0 10.4" />
    </>
  ),
  'volume-low': (
    <>
      <path d="M11 5.5 6.5 9.2H3v5.6h3.5L11 18.5z" />
      <path d="M15 9.5a3.6 3.6 0 0 1 0 5" />
    </>
  ),
  'volume-mute': (
    <>
      <path d="M11 5.5 6.5 9.2H3v5.6h3.5L11 18.5z" />
      <path d="m16 10 4.5 4.5" />
      <path d="m20.5 10-4.5 4.5" />
    </>
  ),
  queue: (
    <>
      <path d="M3.5 6.5H14" />
      <path d="M3.5 11.5H14" />
      <path d="M3.5 16.5h6" />
      <path d="M17 17.4V9.6l4-1.1v7" />
      <circle cx="15.4" cy="17.6" r="1.8" />
      <circle cx="19.4" cy="16.4" r="1.8" />
    </>
  ),
  list: (
    <>
      <path d="M8 6.5h13" />
      <path d="M8 12h13" />
      <path d="M8 17.5h13" />
      <path d="M3.5 6.5h.01" />
      <path d="M3.5 12h.01" />
      <path d="M3.5 17.5h.01" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  'more-horizontal': (
    <g fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </g>
  ),
  x: (
    <>
      <path d="m6.5 6.5 11 11" />
      <path d="m17.5 6.5-11 11" />
    </>
  ),
  'chevron-left': <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  'chevron-right': <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  'chevron-down': <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />,
  'chevron-up': <path d="m5.5 14.5 6.5-6.5 6.5 6.5" />,
  settings: (
    <>
      <path d="M3.5 7.5h9" />
      <path d="M17.5 7.5h3" />
      <path d="M3.5 16.5h3" />
      <path d="M12.5 16.5h8" />
      <circle cx="15" cy="7.5" r="2.4" />
      <circle cx="9.5" cy="16.5" r="2.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  disc: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  rows: (
    <>
      <rect x="4" y="5" width="16" height="4.4" rx="1.4" />
      <rect x="4" y="14.6" width="16" height="4.4" rx="1.4" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.4A1.4 1.4 0 0 1 11 4h2a1.4 1.4 0 0 1 1.4 1.4V7" />
      <path d="m6.5 7 .9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
      <path d="M10.5 11v5.5" />
      <path d="M13.5 11v5.5" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5h4L19.6 8.4a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4.5 15.5z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 4h8A1.5 1.5 0 0 1 14.5 5.5V6" />
    </>
  ),
  'expand': (
    <>
      <path d="M14.5 4.5H20v5.5" />
      <path d="M9.5 19.5H4V14" />
      <path d="m20 4.5-6.5 6.5" />
      <path d="m4 19.5 6.5-6.5" />
    </>
  ),
  'collapse': (
    <>
      <path d="M20 9.5h-5.5V4" />
      <path d="M4 14.5h5.5V20" />
      <path d="M14.5 9.5 20 4" />
      <path d="M9.5 14.5 4 20" />
    </>
  ),
  drag: (
    <g fill="currentColor" stroke="none">
      <circle cx="9.5" cy="6" r="1.5" />
      <circle cx="14.5" cy="6" r="1.5" />
      <circle cx="9.5" cy="12" r="1.5" />
      <circle cx="14.5" cy="12" r="1.5" />
      <circle cx="9.5" cy="18" r="1.5" />
      <circle cx="14.5" cy="18" r="1.5" />
    </g>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  warning: (
    <>
      <path d="M12 4 3 19.5h18z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  music: (
    <>
      <path d="M9 17.5V5.8l10-2v11.4" />
      <circle cx="6.8" cy="17.6" r="2.2" />
      <circle cx="16.8" cy="15.3" r="2.2" />
    </>
  ),
  trending: (
    <>
      <path d="m3.5 16.5 5.5-5.5 3.5 3.5 7-7" />
      <path d="M14 7.5h5.5V13" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 4.5 13.6 9l4.4 1.6-4.4 1.6L12 16.6l-1.6-4.4L6 10.6 10.4 9z" />
      <path d="M18.5 16.5 19.3 18.7 21.5 19.5 19.3 20.3 18.5 22.5 17.7 20.3 15.5 19.5 17.7 18.7z" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M7 14.5h.01" />
      <path d="M10.5 14.5h.01" />
      <path d="M14 14.5h.01" />
      <path d="M17 14.5h.01" />
      <path d="M8 10.5h8" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3.5" />
      <path d="m10 15.5 3.5-3.5L10 8.5" />
      <path d="M13.5 12H4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="m5.6 5.6 1.4 1.4" />
      <path d="m17 17 1.4 1.4" />
      <path d="m18.4 5.6-1.4 1.4" />
      <path d="m7 17-1.4 1.4" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M19.5 12H5" />
      <path d="m11.5 5.5-6.5 6.5 6.5 6.5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4.5h5.5V10" />
      <path d="m19.5 4.5-8 8" />
      <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11.5a8 8 0 1 0-1 5" />
      <path d="M20 5v6.5H14" />
    </>
  ),
  'folder-plus': (
    <>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.5h8A1.5 1.5 0 0 1 20.5 10v7.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M12 11.5v5" />
      <path d="M9.5 14h5" />
    </>
  ),
};

export type IconName = keyof typeof PATHS | string;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, strokeWidth = 1.9, ...rest }: IconProps) {
  const content = PATHS[name];
  if (!content) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {content}
    </svg>
  );
}

export default Icon;
