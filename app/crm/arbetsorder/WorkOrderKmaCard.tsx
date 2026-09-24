"use client";

import { useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate } from '@/app/crm/lib/format';
import { openFortnoxPdf } from '@/app/crm/lib/fortnoxDoc';
import { kmaCardAction } from '@/lib/domains/crm/kmaPlans/dialog';
import { useKmaPlans, type KmaPrefillResponse } from './useKmaPlans';
import WorkOrderKmaDialog from './WorkOrderKmaDialog';

// KMA-planen på arbetsordern — kvalitets-, miljö- och arbetsmiljöplanen till beställaren.
//
// Sidokolumnen, mellan Fortnox-kortet och Snabböversikt. INTE i Fortnox-kortet: det ritas bara när
// Fortnox är anslutet, och KMA-planen har ingenting med Fortnox att göra.
//
// Revisionerna listas nyaste först, var och en med "Öppna" (PDF-rutten i en ny flik — rutten sätter
// filnamnet). En plan kan inte ändras eller tas bort: den har gått till kund, och ett fel rättas med
// en ny revision. Därför heter knappen "Revidera" när ordern redan har en plan.
//
// ⚠️ `canEdit` är VYNS läsläge (ekonomins läsvy av samma sida), `canCreate` SERVERNS svar på
// skrivnyckeln. Båda krävs för en knapp — se kmaCardAction.
type Props = {
  workOrderId: string;
  canEdit: boolean;
  /** Säljarens namn, som sidan redan har (profiles är self-read — servern kan inte slå upp det). */
  salesName: string | null;
};

export default function WorkOrderKmaCard({ workOrderId, canEdit, salesName }: Props) {
  const { items, canCreate, loading, loadError, saving, loadPrefill, create } = useKmaPlans(workOrderId);
  // Läget och revisionsnumret LÅSES när dialogen öppnas. Härleddes de vid varje rendering bytte
  // rubriken från "Ny KMA-plan" till "Revidera" i ögonblicket efter sparningen — listan hämtas om
  // innan dialogen hunnit stängas.
  const [dialog, setDialog] = useState<{ prefill: KmaPrefillResponse; nextRevision: number } | null>(null);
  const [opening, setOpening] = useState(false);

  const action = kmaCardAction({ canEdit, canCreate, hasPlans: items.length > 0, loadError });

  async function openDialog() {
    setOpening(true);
    const nextRevision = (items[0]?.revision ?? 0) + 1;
    const data = await loadPrefill(salesName);
    setOpening(false);
    if (data) setDialog({ prefill: data, nextRevision });
  }

  return (
    <div className={cn(crm.cardInner, 'grid gap-3')}>
      <p className={cn('m-0', crm.cardTitle)}>KMA-plan</p>

      {loading ? (
        <p className="m-0 text-sm text-slate-500">Hämtar…</p>
      ) : loadError ? (
        <p className="m-0 text-sm text-amber-800">Kunde inte hämta KMA-planerna. Ladda om sidan.</p>
      ) : items.length === 0 ? (
        <p className="m-0 text-sm leading-relaxed text-slate-600">
          Kvalitets-, miljö- och arbetsmiljöplan till beställaren. Den fylls i med orderns uppgifter och kan justeras innan den sparas.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-0 divide-y divide-[#e8eee4] p-0">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className={cn('m-0', crm.bodyStrong)}>Revision {item.revision}</p>
                <p className={cn('m-0 truncate', crm.meta)}>
                  {formatDate(item.issued_on)}, {item.created_by_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openFortnoxPdf(item.pdf_url)}
                className={cn(crm.ghostButton, 'h-9 shrink-0')}
                aria-label={`Öppna revision ${item.revision} av KMA-planen`}
              >
                Öppna
              </button>
            </li>
          ))}
        </ul>
      )}

      {action ? (
        <button
          type="button"
          onClick={() => void openDialog()}
          disabled={opening}
          className={action === 'create' ? crm.saveButton : cn(crm.ghostButton, 'h-9 w-full')}
        >
          {opening ? 'Hämtar orderns uppgifter…' : action === 'create' ? 'Skapa KMA-plan' : 'Revidera'}
        </button>
      ) : null}

      {dialog ? (
        <WorkOrderKmaDialog
          nextRevision={dialog.nextRevision}
          prefill={dialog.prefill}
          saving={saving}
          onSubmit={create}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
