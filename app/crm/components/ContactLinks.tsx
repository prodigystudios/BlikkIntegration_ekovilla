import { cn } from '@/lib/shared/cn';

// Shared tap-to-act contact links used across CRM detail surfaces (customer card,
// work order). Phone → dialer, email → mail client, address → maps/GPS navigation.
// They inherit the surrounding font size and only set the accent colour + icon so
// they read as actionable.

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function PhoneGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 opacity-80">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MailGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 opacity-80">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 6 12 13 2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 shrink-0 opacity-80">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function PhoneLink({ value, className }: { value: string; className?: string }) {
  return (
    <a href={telHref(value)} className={cn('inline-flex items-center gap-1.5 font-medium text-emerald-700 transition hover:text-emerald-800 hover:underline', className)}>
      <PhoneGlyph /> {value}
    </a>
  );
}

export function EmailLink({ value, className }: { value: string; className?: string }) {
  return (
    <a href={`mailto:${value}`} className={cn('inline-flex items-center gap-1.5 font-medium text-emerald-700 transition hover:text-emerald-800 hover:underline', className)}>
      <MailGlyph /> <span className="break-all">{value}</span>
    </a>
  );
}

// Address as a tap-to-navigate link. Uses the universal Google Maps URL so it opens
// the OS map app (and offers navigation) on mobile, a maps tab on desktop.
export function AddressLink({ value, className }: { value: string; className?: string }) {
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-start gap-1.5 font-medium leading-relaxed text-emerald-700 transition hover:text-emerald-800 hover:underline', className)}>
      <PinGlyph /> <span>{value}</span>
    </a>
  );
}
