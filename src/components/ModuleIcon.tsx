// Line icons for the module tabs and the Settings tab under them. Drawn with the
// current text color, so they follow the active-tab color and dark mode. Decorative: the tab's label names it.
import type { ReactElement } from "react";
import type { ModuleId } from "../lib/modules";

export type TabIconId = ModuleId | "settings";

const PATHS: Record<TabIconId, ReactElement> = {
  // A person
  accounts: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  // An ID card
  profiles: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <circle cx="8.5" cy="10.5" r="2" />
      <path d="M5.5 16a3 3 0 0 1 6 0" />
      <path d="M14.5 10h4M14.5 14h4" />
    </>
  ),
  // A globe
  proxies: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18z" />
    </>
  ),
  // A checklist
  tasks: (
    <>
      <path d="m3.5 6.5 2 2 3.5-3.5" />
      <path d="m3.5 16.5 2 2 3.5-3.5" />
      <path d="M12.5 7h8M12.5 17h8" />
    </>
  ),
  // A gear
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
      <circle cx="12" cy="12" r="6.5" />
    </>
  ),
};

export function ModuleIcon({ id }: { id: TabIconId }) {
  return (
    <svg
      className="module-icon"
      data-icon={id}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[id]}
    </svg>
  );
}
