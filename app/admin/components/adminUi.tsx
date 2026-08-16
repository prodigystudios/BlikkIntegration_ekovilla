import type { ReactNode } from 'react';
import { cn } from '../../../lib/shared/cn';

// Delade admin-recept för CRM-standarden. Strängar och småkomponenter — inga nya
// primitiver utanför admin (CLAUDE.md: inga förtida delade abstraktioner).

// AA-säker fältetikett — samma recept och samma skäl som TidClient.tsx:139-143 /
// AdminTimeApprovals.tsx:71. Medvetet inte `crm.sectionTitle` (slate-400 @10px är
// under WCAG AA som instruerande text).
export const ADMIN_LABEL = 'text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600';

// Kolumnhuvudsraden i listkort (CustomersClient-receptet).
// Konsumeras från våg 3–4 av admin-migreringen (Kontakter/Tidkoder).
export const ADMIN_COLHEAD = 'text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400';

// Inline-tillståndsrutor — dialekt B-recepten som Ärenden/Changelog/Behörigheter redan använder.
// Sätt role="alert" på felrutan så skärmläsare annonserar den.
export const ADMIN_ERROR_BOX = 'rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700';
// Konsumeras från våg 3–4 (profileditorns success-ruta, Behörigheternas förklaring).
export const ADMIN_NOTICE_BOX = 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900';
export const ADMIN_EMPTY_BOX = 'rounded-2xl border border-dashed border-[#d5e0cf] bg-[#f4f8f1] px-4 py-8 text-center';
// Tomrutans brödtext: <p className="m-0 text-sm text-slate-500">…</p>
// Laddar: <p className="m-0 text-sm text-slate-400">Laddar…</p> (ingen hjälpare behövs)

// Roll → badgefärger. Renderas som cn(crm.badge, roleBadgeClass(role)).
// OBS: AdminBlikkUsersMapping bär ännu sin egen bytidentiska kopia — den byts
// när fliken migreras (våg 2); färgändringar här måste tills dess speglas där.
export function roleBadgeClass(role: string): string {
  if (role === 'admin') return 'border-red-200 bg-red-50 text-red-800';
  if (role === 'sales') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (role === 'konsult') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

// Fältomslag — ersätter flikarnas lokala FieldBlock/Field-hjälpare.
export function AdminField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('grid gap-1', className)}>
      <span className={ADMIN_LABEL}>{label}</span>
      {children}
    </label>
  );
}

// Filterchip med valfri räknare — CustomersClient.tsx-receptet ordagrant:
// aktiv = var(--crm-primary)-solid + vitt, räknarpiller bg-white/20 resp. bg-slate-100.
export function AdminFilterChip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[13px] font-semibold transition',
        active ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
      )}
      style={active ? { backgroundColor: 'var(--crm-primary)' } : undefined}
    >
      {children}
      {count != null ? (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
            active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
