"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/lib/Toast';
import Select from '@/components/ui/Select';
import type { PortalReseller } from '@/lib/domains/portal/resellers';

// Bara typer ur domänen: resellers.ts importerar kundmodulen, som inte ska till webbläsaren.

export type ResellerView = PortalReseller & { lastSeenLabel: string };

type Seller = { id: string; full_name: string | null; role: string };

type ResellersPanelProps = {
  resellers: ResellerView[] | { error: string };
  fallbackUserId: string | null | { error: string };
};

const CARD =
  'rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]';

async function put(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    return !res.ok || !json?.ok ? json?.error || `Begäran misslyckades (${res.status})` : null;
  } catch {
    return 'Servern svarade inte. Försök igen.';
  }
}

/** Säljarna i listan, och den valda även om den inte längre står där (roll ändrad, konto borttaget). */
function sellerOptions(sellers: Seller[], selected: string | null) {
  const options = sellers.map((s) => ({ id: s.id, label: s.full_name || 'Namnlös användare' }));
  if (selected && !options.some((o) => o.id === selected)) options.unshift({ id: selected, label: 'Okänd användare' });
  return options;
}

/**
 * Fördelningen av portalens jobb (RESELLER_PORTAL_CRM_PLAN.md fas 3a): reserven och butikens säljare. Varje val sparas
 * direkt; misslyckas det går valet tillbaka.
 */
export default function ResellersPanel({ resellers, fallbackUserId }: ResellersPanelProps) {
  const toast = useToast();
  const [sellers, setSellers] = useState<Seller[] | null>(null);
  const [sellersError, setSellersError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(typeof fallbackUserId === 'object' && fallbackUserId !== null ? null : fallbackUserId);
  const [rows, setRows] = useState<ResellerView[]>(Array.isArray(resellers) ? resellers : []);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/crm/sellers', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return;
        if (json?.ok) setSellers(json.data.sellers as Seller[]);
        else setSellersError(json?.error || 'Säljarna gick inte att läsa.');
      })
      .catch(() => alive && setSellersError('Säljarna gick inte att läsa.'));
    return () => {
      alive = false;
    };
  }, []);

  async function saveFallback(next: string | null) {
    const previous = fallback;
    setFallback(next);
    setBusy('fallback');
    const error = await put('/api/crm/portal/settings', { fallback_user_id: next });
    setBusy(null);
    if (error) {
      setFallback(previous);
      toast.error(error);
    } else {
      toast.success(next ? 'Reserven är sparad' : 'Reserven är borttagen');
    }
  }

  async function saveSeller(resellerId: string, next: string | null) {
    const previous = rows.find((r) => r.resellerId === resellerId)?.sellerUserId ?? null;
    const apply = (value: string | null) =>
      setRows((current) => current.map((r) => (r.resellerId === resellerId ? { ...r, sellerUserId: value } : r)));
    apply(next);
    setBusy(resellerId);
    const error = await put(`/api/crm/portal/resellers/${encodeURIComponent(resellerId)}`, { seller_user_id: next });
    setBusy(null);
    if (error) {
      apply(previous);
      toast.error(error);
    } else {
      toast.success('Butikens säljare är sparad');
    }
  }

  const loading = sellers === null && !sellersError;
  const fallbackError = typeof fallbackUserId === 'object' && fallbackUserId !== null ? fallbackUserId.error : null;

  return (
    <div className="grid grid-cols-1 gap-6">
      {sellersError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{sellersError}</div>
      )}

      <section className={CARD} aria-labelledby="portal-fallback-heading">
        <h2 id="portal-fallback-heading" className="m-0 mb-1 text-base font-bold text-slate-900">
          Vem som får butikernas jobb
        </h2>
        <p className="m-0 mb-4 max-w-3xl text-sm text-slate-600">
          Ett jobb från portalen går till den första som finns: butikens säljare nedan, kundansvarig på butikens kundkort,
          säljaren för länet där jobbet utförs (Länbaserad routing under{' '}
          <Link href="/crm/ringlistor" className="font-semibold text-slate-800 underline">
            Ringlistor
          </Link>
          ) och sist reserven. Den som får jobbet måste kunna skriva arbetsordrar.
        </p>

        <label className="grid max-w-md gap-1.5">
          <span className="text-sm font-medium text-slate-700">Reserv</span>
          {fallbackError ? (
            <span className="text-sm text-red-700">{fallbackError}</span>
          ) : (
            <Select
              value={fallback ?? ''}
              onChange={(e) => saveFallback(e.target.value || null)}
              disabled={loading || busy !== null}
            >
              <option value="">{loading ? 'Hämtar säljare…' : 'Ingen reserv vald'}</option>
              {sellerOptions(sellers ?? [], fallback).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </label>

        {!fallbackError && !fallback && (
          <div className="mt-3 max-w-2xl rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800" role="status">
            Ingen reserv är vald. Ett jobb som inte hittar någon annan tas inte emot, och portalen försöker igen senare.
          </div>
        )}
      </section>

      <section className={CARD} aria-labelledby="portal-resellers-heading">
        <h2 id="portal-resellers-heading" className="m-0 mb-1 text-base font-bold text-slate-900">
          Butiker
        </h2>
        <p className="m-0 mb-4 max-w-3xl text-sm text-slate-600">
          En butik läggs till här när den skickar sitt första jobb. Välj en säljare om butikens jobb ska till någon annan än
          kundansvarig.
        </p>

        {!Array.isArray(resellers) ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">{resellers.error}</div>
        ) : rows.length === 0 ? (
          <p className="m-0 rounded-xl border border-[#e0e8dc] bg-white px-3.5 py-3 text-sm text-slate-600">
            Inga butiker än. Den första dyker upp när en butik skickar ett jobb från portalen.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                  <th className="py-2 pr-3">Butik</th>
                  <th className="py-2 pr-3">Kund i CRM:et</th>
                  <th className="py-2 pr-3">Säljare</th>
                  <th className="py-2">Senast hörd av</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.resellerId} className="border-b border-slate-100 align-top last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold text-slate-900">{r.name}</div>
                      <div className="text-xs text-slate-500">
                        {[r.street, [r.postalCode, r.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Ingen adress'}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.customerId ? (
                        <Link href={`/crm/kunder/${r.customerId}`} className="font-medium text-slate-900 underline">
                          {r.customerName ?? 'Kundkortet'}
                        </Link>
                      ) : (
                        <span className="text-slate-500">Ingen kund kopplad</span>
                      )}
                      <div className="text-xs text-slate-400">
                        {r.customerNumber ? `Kundnummer ${r.customerNumber} i portalen` : 'Inget kundnummer i portalen'}
                      </div>
                    </td>
                    <td className="min-w-[14rem] py-2.5 pr-3">
                      <Select
                        value={r.sellerUserId ?? ''}
                        onChange={(e) => saveSeller(r.resellerId, e.target.value || null)}
                        disabled={loading || busy !== null}
                        aria-label={`Säljare för ${r.name}`}
                      >
                        <option value="">Följ kedjan</option>
                        {sellerOptions(sellers ?? [], r.sellerUserId).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-slate-500">{r.lastSeenLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
