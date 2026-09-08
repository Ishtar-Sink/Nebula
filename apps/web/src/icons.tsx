/** Inline stroke icons — no icon package, so the bundle stays small and the style stays uniform. */
interface P { size?: number; className?: string }

const svg = (path: React.ReactNode, viewBox = '0 0 24 24') =>
  function Icon({ size = 20, className }: P) {
    return (
      <svg
        width={size} height={size} viewBox={viewBox} fill="none"
        stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
        className={className} aria-hidden="true"
      >
        {path}
      </svg>
    );
  };

export const IconHome = svg(<><path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></>);
export const IconSearch = svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconLibrary = svg(<><path d="M4 20V6" /><path d="M9 20V4" /><path d="M14 20V9" /><rect x="18" y="7" width="3" height="13" rx="1" /></>);
export const IconDisc = svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.6" /></>);
export const IconFolder = svg(<><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2a1.5 1.5 0 0 1 1.06.44L11.5 8h8A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" /></>);
export const IconQueue = svg(<><path d="M4 6h11" /><path d="M4 12h11" /><path d="M4 18h7" /><path d="M17 13v6.2" /><circle cx="19" cy="19" r="2" /><path d="M17 13l4-1.2v3" /></>);
export const IconPlus = svg(<><path d="M12 5v14" /><path d="M5 12h14" /></>);
export const IconPlay = svg(<><path d="M8 5.2v13.6a.6.6 0 0 0 .92.5l10.5-6.8a.6.6 0 0 0 0-1L8.92 4.7a.6.6 0 0 0-.92.5z" fill="currentColor" stroke="none" /></>);
export const IconPause = svg(<><rect x="7" y="5" width="3.6" height="14" rx="1.1" fill="currentColor" stroke="none" /><rect x="13.4" y="5" width="3.6" height="14" rx="1.1" fill="currentColor" stroke="none" /></>);
export const IconNext = svg(<><path d="M6 5.5v13a.5.5 0 0 0 .77.42l9.4-6.5a.5.5 0 0 0 0-.84l-9.4-6.5A.5.5 0 0 0 6 5.5z" fill="currentColor" stroke="none" /><rect x="17.4" y="5" width="2.4" height="14" rx="1.1" fill="currentColor" stroke="none" /></>);
export const IconPrev = svg(<><path d="M18 5.5v13a.5.5 0 0 1-.77.42l-9.4-6.5a.5.5 0 0 1 0-.84l9.4-6.5a.5.5 0 0 1 .77.42z" fill="currentColor" stroke="none" /><rect x="4.2" y="5" width="2.4" height="14" rx="1.1" fill="currentColor" stroke="none" /></>);
export const IconShuffle = svg(<><path d="M16 3.5 20 7l-4 3.5" /><path d="M16 13.5 20 17l-4 3.5" /><path d="M4 7h3.2c1.3 0 2.5.7 3.2 1.8l3.2 6.4c.7 1.1 1.9 1.8 3.2 1.8H20" /><path d="M4 17h3.2c1.3 0 2.5-.7 3.2-1.8" /><path d="M16.8 8.8c.7-1.1 1.9-1.8 3.2-1.8" /></>);
export const IconRepeat = svg(<><path d="M17 2.5 20.5 6 17 9.5" /><path d="M3.5 12V9.5A3.5 3.5 0 0 1 7 6h13.5" /><path d="M7 21.5 3.5 18 7 14.5" /><path d="M20.5 12v2.5a3.5 3.5 0 0 1-3.5 3.5H3.5" /></>);
export const IconVolume = svg(<><path d="M4 9.5h3L11.5 6v12L7 14.5H4z" /><path d="M15.5 9.2a4 4 0 0 1 0 5.6" /><path d="M18.2 6.5a8 8 0 0 1 0 11" /></>);
export const IconVolumeOff = svg(<><path d="M4 9.5h3L11.5 6v12L7 14.5H4z" /><path d="m16 10 4 4" /><path d="m20 10-4 4" /></>);
export const IconDevices = svg(<><rect x="2.5" y="5" width="13" height="10" rx="1.6" /><path d="M6 19h6" /><rect x="17" y="9" width="4.5" height="10" rx="1.4" /></>);
export const IconLaptop = svg(<><rect x="3.5" y="5" width="17" height="11" rx="1.6" /><path d="M2 19.5h20" /></>);
export const IconPhone = svg(<><rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" /></>);
export const IconMonitor = svg(<><rect x="2.5" y="4" width="19" height="13" rx="1.8" /><path d="M8.5 21h7" /><path d="M12 17v4" /></>);
export const IconMore = svg(<><circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" /></>);
export const IconTrash = svg(<><path d="M4 6.5h16" /><path d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" /><path d="M6.5 6.5 7.4 20a1.3 1.3 0 0 0 1.3 1.2h6.6a1.3 1.3 0 0 0 1.3-1.2l.9-13.5" /></>);
export const IconUpload = svg(<><path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M3.5 15v3.5A2.5 2.5 0 0 0 6 21h12a2.5 2.5 0 0 0 2.5-2.5V15" /></>);
export const IconImage = svg(<><rect x="3" y="4.5" width="18" height="15" rx="2.4" /><circle cx="8.5" cy="10" r="1.6" /><path d="m4 17 4.8-4.6a1.6 1.6 0 0 1 2.2 0L16 17" /><path d="m14 14.5 1.6-1.5a1.6 1.6 0 0 1 2.2 0L20 15" /></>);
export const IconEdit = svg(<><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M14.5 6.5l3 3" /></>);
export const IconRefresh = svg(<><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" /><path d="M20.5 4v5h-5" /></>);
export const IconMusic = svg(<><path d="M9 18V5.5l11-2V16" /><circle cx="6.5" cy="18" r="2.6" /><circle cx="17.5" cy="16" r="2.6" /></>);
export const IconX = svg(<><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>);
export const IconCheck = svg(<><path d="m4.5 12.5 5 5 10-11" /></>);
export const IconSettings = svg(<><circle cx="12" cy="12" r="3.2" /><path d="M19.6 14.2a1.5 1.5 0 0 0 .3 1.65l.06.06a1.8 1.8 0 1 1-2.55 2.55l-.06-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37v.17a1.8 1.8 0 1 1-3.6 0v-.09a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06A1.8 1.8 0 1 1 4.96 15.9l.06-.06a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9h-.17a1.8 1.8 0 1 1 0-3.6h.09a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.06-.06A1.8 1.8 0 1 1 7.43 4.5l.06.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37v-.17a1.8 1.8 0 1 1 3.6 0v.09a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06a1.8 1.8 0 1 1 2.55 2.55l-.06.06a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9h.17a1.8 1.8 0 1 1 0 3.6h-.09a1.5 1.5 0 0 0-1.37.9z" /></>);
