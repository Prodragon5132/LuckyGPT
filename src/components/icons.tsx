import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: React.ReactNode }) {
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
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** LuckyGPT logo: a four-leaf clover. */
export function Logo({ size = 24, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
      <path d="M12 11.2c-.9-1.9-.9-4.1.3-5.6 1-1.3 2.9-1.4 3.9-.3 1 1.1.8 2.9-.4 3.9-1.2 1-2.6 1.6-3.8 2Z" />
      <path d="M12.8 12c1.9-.9 4.1-.9 5.6.3 1.3 1 1.4 2.9.3 3.9-1.1 1-2.9.8-3.9-.4-1-1.2-1.6-2.6-2-3.8Z" />
      <path d="M12 12.8c.9 1.9.9 4.1-.3 5.6-1 1.3-2.9 1.4-3.9.3-1-1.1-.8-2.9.4-3.9 1.2-1 2.6-1.6 3.8-2Z" />
      <path d="M11.2 12c-1.9.9-4.1.9-5.6-.3-1.3-1-1.4-2.9-.3-3.9 1.1-1 2.9-.8 3.9.4 1 1.2 1.6 2.6 2 3.8Z" />
      <path d="M12.2 12.4c1.4 2.4 3.3 5 5.8 6.6" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

export const NewChatIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V12" />
    <path d="M17.6 3.6a1.9 1.9 0 0 1 2.8 2.8L12.6 14.2 9 15l.8-3.6 7.8-7.8Z" />
  </Svg>
);
export const SidebarIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16" />
  </Svg>
);
export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const LibraryIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <circle cx="9" cy="9" r="1.6" />
    <path d="m20.5 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L4 20.2" />
  </Svg>
);
export const GptsIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="3.25" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="3.25" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
  </Svg>
);
export const FolderIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l2 2.2H18a2.5 2.5 0 0 1 2.5 2.5v7.8A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-10Z" />
  </Svg>
);
export const FolderPlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20.5 12V9.7A2.5 2.5 0 0 0 18 7.2h-6.8L9.2 5H6a2.5 2.5 0 0 0-2.5 2.5v10A2.5 2.5 0 0 0 6 20h6" />
    <path d="M18 15v6M15 18h6" />
  </Svg>
);
export const DotsIcon = (p: P) => (
  <Svg {...p} strokeWidth={0} fill="currentColor">
    <circle cx="5.5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="18.5" cy="12" r="1.7" />
  </Svg>
);
export const ChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const ChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const ChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="m15 6-6 6 6 6" />
  </Svg>
);
export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const ArrowUpIcon = (p: P) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
export const ArrowDownIcon = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const StopIcon = (p: P) => (
  <Svg {...p} strokeWidth={0} fill="currentColor">
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
  </Svg>
);
export const MicIcon = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
);
export const MicOffIcon = (p: P) => (
  <Svg {...p}>
    <path d="M15 9.4V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5" />
    <path d="M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10.2 5.4M12 17.5V21M3 3l18 18" />
  </Svg>
);
export const VoiceIcon = (p: P) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M5 10v4M9 7v10M13 4v16M17 8v8M21 11v2" />
  </Svg>
);
export const CopyIcon = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
    <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const EditIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 5.5 18.5 9.5M4 20l1-4.8L16.2 4a2.1 2.1 0 0 1 3 0l.8.8a2.1 2.1 0 0 1 0 3L8.8 19 4 20Z" />
  </Svg>
);
export const ThumbUpIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? "currentColor" : "none"}>
    <path d="M7.5 10.5v9H5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 5 10.5h2.5Zm0 0 3.6-6.3a1.6 1.6 0 0 1 3 .9l-.6 4.4h4.6a2 2 0 0 1 2 2.4l-1.3 6.3a2 2 0 0 1-2 1.6H7.5" />
  </Svg>
);
export const ThumbDownIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? "currentColor" : "none"}>
    <path d="M16.5 13.5v-9H19a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-2.5Zm0 0-3.6 6.3a1.6 1.6 0 0 1-3-.9l.6-4.4H5.9a2 2 0 0 1-2-2.4l1.3-6.3a2 2 0 0 1 2-1.6h9.3" />
  </Svg>
);
export const SpeakerIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
    <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.5a8 8 0 0 1 0 11" />
  </Svg>
);
export const RefreshIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 11.5A8 8 0 0 0 5.6 7M4 12.5A8 8 0 0 0 18.4 17" />
    <path d="M5 3.5V7.5h4M19 20.5v-4h-4" />
  </Svg>
);
export const ShareIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" />
    <path d="M5 12v6.5A2 2 0 0 0 7 20.5h10a2 2 0 0 0 2-2V12" />
  </Svg>
);
export const TrashIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7M6.5 6.5l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12M10 10.5v6M14 10.5v6" />
  </Svg>
);
export const ArchiveIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="4.5" rx="1.2" />
    <path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4" />
  </Svg>
);
export const PinIcon = (p: P) => (
  <Svg {...p}>
    <path d="M15 4.5 19.5 9l-2.8 1.2-3.4 3.4.3 3.9-1.4 1.4-3.2-3.2L5 19.7M8.9 14.7 5.7 11.5 7.1 10l3.9.3 3.4-3.4L15 4.5Z" />
  </Svg>
);
export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const PaperclipIcon = (p: P) => (
  <Svg {...p}>
    <path d="m19.5 11.5-7.3 7.3a4.6 4.6 0 0 1-6.5-6.5l7.8-7.8a3.1 3.1 0 0 1 4.4 4.4l-7.8 7.8a1.5 1.5 0 0 1-2.2-2.2l7.3-7.3" />
  </Svg>
);
export const GlobeIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5Z" />
  </Svg>
);
export const ImageIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m20.5 15.5-4-4a1.5 1.5 0 0 0-2.1 0l-7.9 8" />
  </Svg>
);
export const BulbIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.4.3.6.8.6 1.3V16h6v-.9c0-.5.2-1 .6-1.3A6 6 0 0 0 12 3Z" />
  </Svg>
);
export const TelescopeIcon = (p: P) => (
  <Svg {...p}>
    <path d="m4 13.5 2.3 3.8 12.2-7.3-2.3-3.8L4 13.5ZM14 6.8l1.4-.8 2.3 3.8-1.4.8M9 15l-1.5 6M11.5 13.7 14 21M10 16h.01" />
  </Svg>
);
export const CanvasIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M8 8.5h8M8 12h8M8 15.5h5" />
  </Svg>
);
export const BookIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 5.5A2 2 0 0 1 6 3.5h13.5v14H6a2 2 0 0 0-2 2v-14Z" />
    <path d="M4 19.5a2 2 0 0 0 2 2h13.5v-4" />
  </Svg>
);
export const SettingsIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </Svg>
);
export const LogoutIcon = (p: P) => (
  <Svg {...p}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />
  </Svg>
);
export const SparkleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9L12 3.5Z" />
  </Svg>
);
export const UserIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Svg>
);
export const ShieldIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.4 3 7.8 7 9 4-1.2 7-4.6 7-9V6l-7-2.5Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
export const DatabaseIcon = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
    <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
  </Svg>
);
export const KeyIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="15" r="4.5" />
    <path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2" />
  </Svg>
);
export const CpuIcon = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9.5 9.5h5v5h-5zM9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" />
  </Svg>
);
export const UsersIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M16 4.7a3.5 3.5 0 0 1 0 6.6M18.5 14a6.5 6.5 0 0 1 3 5.5" />
  </Svg>
);
export const HeadphonesIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
    <rect x="3.5" y="14" width="4.5" height="6.5" rx="1.8" />
    <rect x="16" y="14" width="4.5" height="6.5" rx="1.8" />
  </Svg>
);
export const TempChatIcon = (p: P) => (
  <Svg {...p} strokeDasharray="3 2.4">
    <path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.5L3.5 20.5l1-4.6A8.5 8.5 0 1 1 20.5 12Z" />
  </Svg>
);
export const MenuIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h16M4 16h10" />
  </Svg>
);
export const DownloadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </Svg>
);
export const FileIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8L14 3.5Z" />
    <path d="M14 3.5V8h4.5" />
  </Svg>
);
export const BrainIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 4.5a2.5 2.5 0 0 0-2.5 2.4A3 3 0 0 0 4.5 12a3 3 0 0 0 1.4 4.6A2.8 2.8 0 0 0 9 19.5c.9 0 1.7-.4 2.2-1V6.3A2.5 2.5 0 0 0 9 4.5ZM15 4.5a2.5 2.5 0 0 1 2.5 2.4 3 3 0 0 1 2 5.1 3 3 0 0 1-1.4 4.6 2.8 2.8 0 0 1-3.1 2.9c-.9 0-1.7-.4-2.2-1" />
  </Svg>
);
export const CaptionsIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M10.5 10.3a2.2 2.2 0 1 0 0 3.4M17 10.3a2.2 2.2 0 1 0 0 3.4" />
  </Svg>
);
export const ExternalIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
);
export const LockIcon = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const PaletteIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.8-.9 1.5-1.9l-.3-.8c-.4-1.1.4-2.3 1.6-2.3h1.7a4 4 0 0 0 4-4c0-4.4-3.8-8-8.5-8Z" />
    <circle cx="7.5" cy="11.5" r="1" fill="currentColor" />
    <circle cx="10" cy="7.5" r="1" fill="currentColor" />
    <circle cx="14.5" cy="7.5" r="1" fill="currentColor" />
  </Svg>
);
export const BranchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="5.5" r="2" />
    <circle cx="6" cy="18.5" r="2" />
    <circle cx="18" cy="8.5" r="2" />
    <path d="M6 7.5v9M18 10.5c0 4-4 4-10.5 6.5" />
  </Svg>
);
