// Line icon for app updates: a circular arrow around a download arrow. Drawn
// with the current text color like the module icons. Decorative.
export function UpdateIcon() {
  return (
    <svg
      className="update-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4h-4" />
      <path d="M12 8v7" />
      <path d="m9 12.5 3 3 3-3" />
    </svg>
  );
}
