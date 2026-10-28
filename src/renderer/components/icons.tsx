import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 18, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Logo mark: dua bingkai workspace yang saling tumpang tindih. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="18" height="18" rx="5" stroke="#2dd4bf" strokeWidth="2" />
      <rect
        x="10.5"
        y="10.5"
        width="18"
        height="18"
        rx="5"
        stroke="#fbbf24"
        strokeWidth="2"
        opacity="0.85"
      />
      <circle cx="12.5" cy="12.5" r="2.4" fill="#2dd4bf" />
      <circle cx="19.5" cy="19.5" r="2.4" fill="#fbbf24" />
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconEnter(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5M15 12H3" />
    </Svg>
  );
}

export function IconFolder(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </Svg>
  );
}

export function IconFile(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 2v6h6l-6-6z" />
      <path d="M4 2h10v6h6v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
    </Svg>
  );
}

export function IconCopy(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </Svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 12.5l5 5L20 6.5" />
    </Svg>
  );
}

export function IconUsers(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.5 20c.7-3.2 3.3-5 6.5-5s5.8 1.8 6.5 5" />
      <path d="M16 4.6a3.4 3.4 0 0 1 0 6.8M17.8 15.4c2 .7 3.3 2.3 3.7 4.6" />
    </Svg>
  );
}

export function IconHourglass(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3h12M6 21h12" />
      <path d="M7.5 3c0 5.5 4.5 5.7 4.5 9s-4.5 3.5-4.5 9M16.5 3c0 5.5-4.5 5.7-4.5 9s4.5 3.5 4.5 9" />
    </Svg>
  );
}

export function IconMonitor(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8.5 21h7M12 17.5V21" />
    </Svg>
  );
}

export function IconTerminal(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 17l5.5-5-5.5-5M12.5 19h7" />
    </Svg>
  );
}

export function IconGlobe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14.5 14.5 0 0 1 4 9 14.5 14.5 0 0 1-4 9 14.5 14.5 0 0 1-4-9 14.5 14.5 0 0 1 4-9z" />
    </Svg>
  );
}

export function IconPower(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2.5v9" />
      <path d="M17.6 6.2a8 8 0 1 1-11.2 0" />
    </Svg>
  );
}

export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-2.9-6.6" />
      <path d="M21 3.5V9h-5.5" />
    </Svg>
  );
}

export function IconExternal(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.5 3.5H20.5V9.5" />
      <path d="M10.5 13.5l10-10" />
      <path d="M20.5 14v5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h5" />
    </Svg>
  );
}

export function IconX(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconLogout(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </Svg>
  );
}

export function IconInfo(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16.5V11M12 7.6h.01" />
    </Svg>
  );
}

export function IconWarn(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.3 3.9L1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.5M12 17.6h.01" />
    </Svg>
  );
}

export function IconError(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </Svg>
  );
}

export function IconZap(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13 2.5L3.5 14h7l-1 7.5L20 10h-7l1-7.5z" />
    </Svg>
  );
}

export function IconPlay(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 4.5l13 7.5-13 7.5v-15z" />
    </Svg>
  );
}

export function IconStop(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Svg>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 6.5h17M8.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h4.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M18.7 6.5l-.9 13a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9l-.9-13" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function IconCode(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15.5 18l6-6-6-6M8.5 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconExtension(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5v5.5c0 .8.7 1.5 1.5 1.5h5c.8 0 1.5-.7 1.5-1.5V3.5a2 2 0 0 0-2-2h-5a2 2 0 0 0-2 2z" />
      <path d="M8.5 19.5c0 .8.7 1.5 1.5 1.5h5c.8 0 1.5-.7 1.5-1.5v-5c0-.8-.7-1.5-1.5-1.5h-5a2 2 0 0 0-2 2v5z" />
      <path d="M19.5 12.5c0 .8-.7 1.5-1.5 1.5h-5c-.8 0-1.5-.7-1.5-1.5v-5c0-.8.7-1.5 1.5-1.5h5a2 2 0 0 1 2 2v5z" />
      <path d="M4.5 12.5c0 .8.7 1.5 1.5 1.5h5c.8 0 1.5-.7 1.5-1.5v-5c0-.8-.7-1.5-1.5-1.5h-5a2 2 0 0 0-2 2v5z" />
    </Svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </Svg>
  );
}

export function IconEdit(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4v16M4 12h16" />
      <path d="M18.5 5.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5a2.1 2.1 0 0 1 3 0z" />
    </Svg>
  );
}

export function IconWifi(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 9.5a15 15 0 0 1 19 0M5.5 13a10 10 0 0 1 13 0M8.7 16.4a5 5 0 0 1 6.6 0" />
      <path d="M12 19.8h.01" />
    </Svg>
  );
}

export function IconServer(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3.5" width="18" height="7" rx="2" />
      <rect x="3" y="13.5" width="18" height="7" rx="2" />
      <path d="M7 7h.01M7 17h.01" />
    </Svg>
  );
}

export function IconKey(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="15" r="4.5" />
      <path d="M11.2 11.8L20 3M17 6l3 3M14.5 8.5l2.5 2.5" />
    </Svg>
  );
}

export function IconSync(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20.5 11a8.5 8.5 0 0 0-14.9-4.7L3.5 8.5" />
      <path d="M3.5 3.5v5h5" />
      <path d="M3.5 13a8.5 8.5 0 0 0 14.9 4.7l2.1-2.2" />
      <path d="M20.5 20.5v-5h-5" />
    </Svg>
  );
}

export function Spinner({ size = 16, className }: IconProps) {
  return (
    <svg
      className={className ? `spin ${className}` : "spin"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconMaximize(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

export function IconMinimize(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 8H5a2 2 0 0 0-2 2v3M21 16V13a2 2 0 0 0-2-2h-3M3 8v3a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 0 2 2v3" />
    </Svg>
  );
}

export function IconDownload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3v12" />
      <path d="M5 12l7 7 7-7" />
      <path d="M19 12H5" />
    </Svg>
  );
}

export function IconChevronUp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M18 15L12 9 6 15" />
    </Svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 18L9 12l6-6" />
    </Svg>
  );
}

export function IconUserCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M16 21H9a3 3 0 0 1-3-3v-1a4 4 0 0 1 4-4h4" />
      <path d="M13 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M18 15l2 2 3-3" />
    </Svg>
  );
}

export function IconChevronRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}
