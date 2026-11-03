import type { ReactNode } from 'react';
import { crm } from '@/app/crm/lib/crmTokens';

// Fältvyns bildspråk — samma som startsidans stoppkort (INSTALLATOR_UX_UPPGRADERING_PLAN.md):
// vita kort utan skugga på den mjuka sidbakgrunden, rubriker i versaler, allt tryckbart minst 44 px.
//
// ⚠️ var(--ek-*) och var(--ui-*), ALDRIG var(--crm-*). CRM-variablerna är scopade till .crm-shell och
// når inte /arbetsorder, som renderas utan appskal. Spårets #dfe7dc och avdelarens #eef2ec har ingen
// rotvariabel och står därför som värden.

export const FIELD_CARD = 'rounded-[18px] border border-solid border-[color:var(--ui-border-subtle)] bg-white p-4';

/** Rubriken på ett kort. 13 px, versaler — designens sektionsrubrik. Samma token som säck- och momentkorten. */
export const FIELD_SECTION_TITLE = crm.fieldSectionTitle;

/** Klassen de delade korten (säckar, framdrift, kommentarer) får via `className`, så Info-fliken bär ett kortspråk. */
export const FIELD_SHARED_CARD = 'rounded-[18px] border-[color:var(--ui-border-subtle)] bg-white p-4 shadow-none';

/** Avdelaren mellan rader i ett kort. Ljusare än kortets kant, så raderna hör ihop. */
export const FIELD_DIVIDER = 'border-0 border-t border-solid border-[#eef2ec]';

/** Segmentkontrollens spår (flikraden). Flikarna själva är `TabsTrigger variant="segmented"`. */
export const FIELD_SEGMENT_TRACK = 'grid gap-1 rounded-[14px] bg-[#e3eae0] p-1';

/** Laddningsytorna. Samma ton som mätarspåret i stoppkortet. */
export const FIELD_SKELETON = 'bg-[#dfe7dc] motion-safe:animate-pulse';

/**
 * Fokusringen på fältvyns egna länkar och knappar. ⚠️ --ek-accent, INTE --ek-accent-ring: ringtonen
 * har 20 % täckning och syns knappt mot ett vitt kort (globals.css: accenten är för länkar och fokus).
 */
export const FIELD_FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent)]';

// Ikonerna ritas i currentColor och färgas av sin behållare. aria-hidden: texten bredvid bär namnet.
function Icon({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="shrink-0">
      {children}
    </svg>
  );
}

export const ChevronLeftIcon = () => <Icon size={20}><path d="M15 18l-6-6 6-6" /></Icon>;
export const ChevronRightIcon = () => <Icon size={16}><path d="M9 18l6-6-6-6" /></Icon>;
export const PinIcon = () => (
  <Icon>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
);
export const PhoneIcon = () => (
  <Icon>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
  </Icon>
);
export const ChecklistIcon = () => (
  <Icon size={20}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4h6v3H9z" />
    <path d="M9 13l2 2 4-4" />
  </Icon>
);
export const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </Icon>
);
export const SackIcon = () => (
  <Icon>
    <path d="M6 7h12l1 13H5z" />
    <path d="M9 7a3 3 0 0 1 6 0" />
  </Icon>
);
