// Översiktens ikoner, inline så att inget bibliotek behövs. Alla är dekor (aria-hidden): texten
// bredvid säger samma sak, och en skärmläsare ska inte läsa upp "stjärna" en gång till.

type IconProps = { className?: string };

/** Fylld stjärna: ETT budskap på sidan — veckomålet är nått. Färgen sätts av anroparen (--ek-star). */
export function StarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M10 1.6l2.57 5.2 5.74.84-4.15 4.05.98 5.71L10 14.7l-5.14 2.7.98-5.71L1.69 7.64l5.74-.84L10 1.6z" />
    </svg>
  );
}

/** Pokal för den som leder topplistan — i varumärkesgrönt, aldrig i stjärnans guld. */
export function TrophyIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M6.5 3.5h7v3.25a3.5 3.5 0 0 1-7 0V3.5z" />
      <path d="M6.5 4.75H4.25v.75a2.5 2.5 0 0 0 2.5 2.5M13.5 4.75h2.25v.75a2.5 2.5 0 0 1-2.5 2.5" />
      <path d="M10 10.25v3M7.25 16.5h5.5M8 13.25h4l.5 3.25h-5L8 13.25z" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" className={className}>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </svg>
  );
}
