/**
 * Placeholder mark: an ensō (incomplete circle) with a still centre.
 * Branding is an explicit post-V1 pass — this keeps the shell from looking
 * unbranded without pretending to be a final logo.
 */
export function ZenMark({ className }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path
        d="M17.2 4.9a9 9 0 1 0 3.1 5.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
