export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 20V9l8-5 8 5v11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 20v-6h6v6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="9.5" r="1.4" fill="#e8a860" />
    </svg>
  )
}
