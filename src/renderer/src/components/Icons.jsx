import React from 'react';

function Svg({ children, size = 18, className = '', strokeWidth = 1.7, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function LichenMark({ size = 36, className = '' }) {
  const petals = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`lichen-mark ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor">
        {petals.map((angle, index) => (
          <ellipse
            key={angle}
            cx="32"
            cy="20.5"
            rx="6.4"
            ry="11.8"
            transform={`rotate(${angle} 32 32)`}
            opacity={index % 2 === 0 ? 0.26 : 0.17}
          />
        ))}
        <circle cx="32" cy="32" r="7.5" opacity="0.92" />
        <circle cx="32" cy="32" r="3.1" fill="var(--surface)" opacity="0.8" />
      </g>
    </svg>
  );
}

export const LeafIcon = (props) => (
  <Svg {...props}>
    <path d="M20 4c-8 1-14 6-14 14 0 1.1.2 2.2.5 3.2C10 17 16 13.4 20 4Z" />
    <path d="M4 20c1-8 6-14 14-14" />
    <path d="M4 20c8 0 14-4 16-16" />
  </Svg>
);

export const LockIcon = (props) => (
  <Svg {...props}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
    <path d="M8 10V7.6a4 4 0 0 1 8 0V10" />
    <circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none" />
    <path d="M12 16.2V18" />
  </Svg>
);

export const FolderIcon = (props) => (
  <Svg {...props}>
    <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l2 2.4H18a2.5 2.5 0 0 1 2.5 2.5v6.6A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z" />
  </Svg>
);

export const SettingsIcon = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.2 13.4a7.8 7.8 0 0 0 0-2.8l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-2.4-1.4L14 2.7h-4l-.4 2.6A7.6 7.6 0 0 0 7.2 6.7l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 2.8l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 2.4 1.4l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.5Z" />
  </Svg>
);

export const SearchIcon = (props) => (
  <Svg {...props}>
    <circle cx="10.8" cy="10.8" r="6.6" />
    <path d="m15.7 15.7 4.1 4.1" />
  </Svg>
);

export const XIcon = (props) => (
  <Svg {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const SunIcon = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Svg>
);

export const MoonIcon = (props) => (
  <Svg {...props}>
    <path d="M20 14.4A8.2 8.2 0 0 1 9.6 4 8.3 8.3 0 1 0 20 14.4Z" />
  </Svg>
);

export const EyeIcon = (props) => (
  <Svg {...props}>
    <path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12Z" />
    <circle cx="12" cy="12" r="2.9" />
  </Svg>
);

export const EyeOffIcon = (props) => (
  <Svg {...props}>
    <path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12Z" />
    <circle cx="12" cy="12" r="2.9" />
    <path d="m4.2 4.2 15.6 15.6" />
  </Svg>
);

export const ChevronLeftIcon = (props) => (
  <Svg {...props}>
    <path d="m14.5 6-6 6 6 6" />
  </Svg>
);

export const ChevronRightIcon = (props) => (
  <Svg {...props}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);

export const SparkleIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3.2c.6 4.7 2.6 6.7 7.3 7.3-4.7.6-6.7 2.6-7.3 7.3-.6-4.7-2.6-6.7-7.3-7.3 4.7-.6 6.7-2.6 7.3-7.3Z" />
    <path d="M18.5 16.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z" />
  </Svg>
);

export const TagIcon = (props) => (
  <Svg {...props}>
    <path d="M20 12.2 12.2 20a2.3 2.3 0 0 1-3.2 0L4 15a2.3 2.3 0 0 1-.7-1.6V5.5A1.5 1.5 0 0 1 4.8 4h7.9c.6 0 1.2.2 1.6.7l5.7 5.7a1.3 1.3 0 0 1 0 1.8Z" />
    <circle cx="8.3" cy="8.3" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

export const DownloadIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3.5v11" />
    <path d="m7.8 10.7 4.2 4.2 4.2-4.2" />
    <path d="M4.5 17.5v1A2.2 2.2 0 0 0 6.7 20.5h10.6a2.2 2.2 0 0 0 2.2-2v-1" />
  </Svg>
);

export const TrashIcon = (props) => (
  <Svg {...props}>
    <path d="M4.5 6.5h15" />
    <path d="M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7" />
    <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
    <path d="M10 10.5v6M14 10.5v6" />
  </Svg>
);

export const CopyIcon = (props) => (
  <Svg {...props}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5v-1a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" />
  </Svg>
);

export const RefreshIcon = (props) => (
  <Svg {...props}>
    <path d="M20 11.5a8 8 0 0 0-14.6-4.2L4 9.5" />
    <path d="M4 4.5v5h5" />
    <path d="M4 12.5a8 8 0 0 0 14.6 4.2l1.4-2.2" />
    <path d="M20 19.5v-5h-5" />
  </Svg>
);

export const CheckIcon = (props) => (
  <Svg {...props}>
    <path d="m5 12.5 4.2 4.2L19 6.9" />
  </Svg>
);

export const AlertIcon = (props) => (
  <Svg {...props}>
    <path d="M12 8.5v5" />
    <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    <path d="M10.2 4.3 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.8 4.3a2 2 0 0 0-3.6 0Z" />
  </Svg>
);


export const PhotoIcon = (props) => (
  <Svg {...props}>
    <rect x="3.5" y="6.5" width="17" height="13" rx="2.5" />
    <circle cx="12" cy="13" r="3.4" />
    <path d="M8.4 6.5 9.8 4h4.4l1.4 2.5" />
  </Svg>
);

export const CalendarIcon = (props) => (
  <Svg {...props}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    <circle cx="8.2" cy="13.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="13.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="15.8" cy="13.5" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const QuoteIcon = (props) => (
  <Svg {...props}>
    <path d="M9.5 6.5C6.5 7.6 5 10 5 13v4.5h5.5V12H7.7c0-2 .6-3.3 2.4-4.1l-.6-1.4Z" />
    <path d="M19.5 6.5C16.5 7.6 15 10 15 13v4.5h5.5V12h-2.8c0-2 .6-3.3 2.4-4.1l-.6-1.4Z" />
  </Svg>
);

export const ArrowRightIcon = (props) => (
  <Svg {...props}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </Svg>
);

export const MenuIcon = (props) => (
  <Svg {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const PaletteIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3a9 9 0 0 0 0 18c1.4 0 2.1-.9 2.1-1.9 0-.6-.2-1-.6-1.4-.4-.5-.6-.9-.6-1.4 0-1 .8-1.8 1.9-1.8h1.4A4.8 4.8 0 0 0 21 9.7C21 5.9 17 3 12 3Z" />
    <circle cx="7.5" cy="9" r="1" fill="currentColor" stroke="none" />
    <circle cx="10" cy="6.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const CpuIcon = (props) => (
  <Svg {...props}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
  </Svg>
);

export const FeatherIcon = (props) => (
  <Svg {...props}>
    <path d="M19.5 4.5c-2.4-1.7-6.2-.6-8.7 1.9L5 12.2V19h6.8l5.8-5.8c2.5-2.5 3.6-6.3 1.9-8.7Z" />
    <path d="M5 19 13 11M11.5 12.5H8.8M14 10V7.3" />
  </Svg>
);

export const ShieldIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3 5 5.8v5.4c0 4.5 2.8 8.1 7 9.8 4.2-1.7 7-5.3 7-9.8V5.8L12 3Z" />
    <path d="m9 11.8 2.1 2.1 4-4.2" />
  </Svg>
);

export const BookOpenIcon = (props) => (
  <Svg {...props}>
    <path d="M12 6.6C10.4 4.9 8.1 4 5.4 4H3v14h3.1c2.3 0 4.4.7 5.9 2 1.5-1.3 3.6-2 5.9-2H21V4h-2.4C15.9 4 13.6 4.9 12 6.6Z" />
    <path d="M12 6.6V20" />
  </Svg>
);

export const InfoIcon = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11v5" />
    <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
  </Svg>
);
