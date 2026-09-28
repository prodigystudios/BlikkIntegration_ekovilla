"use client";

import { useState } from 'react';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { withReturnTo } from '@/app/crm/lib/returnTo';
import EntityCombobox, { type EntityResult } from '@/app/crm/components/EntityCombobox';
import WorkOrderReadinessNotice from '@/app/crm/components/WorkOrderReadinessNotice';
import type { WorkOrderReadinessIssue } from '@/lib/domains/crm/workOrderReadiness';

// En portalorder utan kund (RESELLER_PORTAL_CRM_PLAN.md fas 3c). Jobbet kom från butiken utan ett kundnummer som finns
// i kundregistret, och utan kund kan Fortnox-ordern inte skapas. Här kopplas butikens kundkort, och Fortnox-ordern
// skapas i samma steg.
//
// Butiken är kunden: det är butiken Ekovilla fakturerar, och butiken fakturerar sin kund. Servern prövar kortet med
// samma kontroll som våra egna ordrar och nekar med listan om något saknas; då visas listan här, med en väg till
// kortet. Vem som får koppla avgör servern (den som har ordern, eller en admin).

type Props = {
  workOrderId: string;
  storeName: string;
  /** Den uppdaterade arbetsordern, ur serverns svar. */
  onLinked: (item: unknown) => void;
};

async function searchCustomers(query: string): Promise<EntityResult[]> {
  const res = await fetch(`/api/crm/customers/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  const items = json?.ok && Array.isArray(json?.data?.items) ? json.data.items : [];
  return items.map((c: { id: string; display_name: string; organization_number: string | null; city: string | null }) => ({
    id: c.id,
    label: c.display_name || 'Okänd kund',
    sublabel: [c.organization_number, c.city].filter(Boolean).join(' · ') || undefined,
  }));
}

export default function WorkOrderPortalCustomerCard({ workOrderId, storeName, onLinked }: Props) {
  const toast = useToast();
  const [customerId, setCustomerId] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');
  const [blockers, setBlockers] = useState<WorkOrderReadinessIssue[]>([]);
  const [linking, setLinking] = useState(false);

  function choose(id: string, label: string) {
    setCustomerId(id);
    setCustomerLabel(label);
    // Listan gällde det förra kortet.
    setBlockers([]);
  }

  async function link() {
    if (!customerId || linking) return;
    setLinking(true);
    try {
      const res = await fetch(`/api/crm/portal/jobs/${workOrderId}/link-customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const found = json?.errorDetails?.details?.blockers;
        if (Array.isArray(found) && found.length > 0) {
          setBlockers(found as WorkOrderReadinessIssue[]);
          return;
        }
        toast.error(json?.error || 'Kunden kunde inte kopplas.');
        return;
      }
      const data = json.data as { item: unknown; fortnox_order_number: string | null; fortnox_error: string | null };
      if (data.fortnox_error) {
        toast.error(`Kunden är kopplad, men Fortnox-ordern kunde inte skapas: ${data.fortnox_error}`);
      } else {
        toast.success(
          data.fortnox_order_number
            ? `Kunden är kopplad och Fortnox-order ${data.fortnox_order_number} är skapad.`
            : 'Kunden är kopplad.',
        );
      }
      onLinked(data.item);
    } catch {
      toast.error('Kunden kunde inte kopplas.');
    } finally {
      setLinking(false);
    }
  }

  return (
    <section className={cn(crm.cardInner, 'grid gap-3 border-amber-200')} aria-labelledby="portal-customer-title">
      <div className="grid gap-1">
        <h2 id="portal-customer-title" className={cn(crm.cardTitle, 'm-0')}>
          Butiken är inte kopplad till någon kund
        </h2>
        <p className={cn(crm.meta, 'm-0 max-w-[70ch] leading-relaxed')}>
          Jobbet kom från {storeName} utan ett kundnummer som finns i kundregistret, så Fortnox-ordern kan inte skapas. Välj
          butikens kundkort: det är butiken vi fakturerar. Kopplingen gäller också butikens nästa jobb.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <EntityCombobox
          value={customerId}
          valueLabel={customerLabel}
          onChange={choose}
          onClear={() => choose('', '')}
          search={searchCustomers}
          placeholder="Sök butikens kundkort…"
          disabled={linking}
        />
        {/* saveButton och inte primaryButton: den senare kräver en inline-bakgrund på --crm-*, som ny kod inte får
            peka på. Samma knapp som detaljvyns Spara. */}
        <button type="button" onClick={link} disabled={!customerId || linking} className={cn(crm.saveButton, 'px-5 sm:w-auto')}>
          {linking ? 'Kopplar…' : 'Koppla och skicka till Fortnox'}
        </button>
      </div>
      <WorkOrderReadinessNotice
        blockers={blockers}
        warnings={[]}
        customerHref={customerId ? withReturnTo(`/crm/kunder/${customerId}`, `/crm/arbetsorder/${workOrderId}`) : null}
        blockedAction="innan kunden kan kopplas"
      />
    </section>
  );
}
