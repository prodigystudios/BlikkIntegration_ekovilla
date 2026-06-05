"use client";

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import FortnoxCodeSelect from './FortnoxCodeSelect';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';

type CustomerType = 'business' | 'private';

type Draft = {
  customer_type: CustomerType;
  company_name: string;
  organization_number: string;
  first_name: string;
  last_name: string;
  personal_number: string;
  email: string;
  phone: string;
  mobile: string;
  visit_street: string;
  visit_postal_code: string;
  visit_city: string;
  delivery_street: string;
  delivery_postal_code: string;
  delivery_city: string;
  invoice_street: string;
  invoice_postal_code: string;
  invoice_city: string;
  invoice_email: string;
  payment_terms: string;
  price_list: string;
  discount: string;
  vat_number: string;
  reverse_vat: boolean;
};

const initial: Draft = {
  customer_type: 'business',
  company_name: '',
  organization_number: '',
  first_name: '',
  last_name: '',
  personal_number: '',
  email: '',
  phone: '',
  mobile: '',
  visit_street: '',
  visit_postal_code: '',
  visit_city: '',
  delivery_street: '',
  delivery_postal_code: '',
  delivery_city: '',
  invoice_street: '',
  invoice_postal_code: '',
  invoice_city: '',
  invoice_email: '',
  payment_terms: '',
  price_list: '',
  discount: '',
  vat_number: '',
  reverse_vat: false,
};

function buildAddress(street: string, postalCode: string, city: string) {
  if (!street && !postalCode && !city) return null;
  return { street: street || null, postal_code: postalCode || null, city: city || null };
}

// Only allow returning into the offer form (allowlist guards against open redirect).
function safeReturnTo(returnTo: string | null): string | null {
  return returnTo && returnTo.startsWith('/crm/offerter/') ? returnTo : null;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className={crm.label}>{children}</p>;
}

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={crm.cardInner}>
      <p className={cn('mb-4', crm.sectionTitle)}>{title}</p>
      {children}
    </div>
  );
}

function AddressColumn({
  label, street, postalCode, city, email,
  onStreet, onPostal, onCity, onEmail,
}: {
  label: string;
  street: string; postalCode: string; city: string; email?: string;
  onStreet: (v: string) => void; onPostal: (v: string) => void; onCity: (v: string) => void;
  onEmail?: (v: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className={crm.sectionTitle}>{label}</p>
      <Input value={street} onChange={(e) => onStreet(e.target.value)} placeholder="Gatuadress" />
      <div className="grid grid-cols-2 gap-2">
        <Input value={postalCode} onChange={(e) => onPostal(e.target.value)} placeholder="Postnr" />
        <Input value={city} onChange={(e) => onCity(e.target.value)} placeholder="Stad" />
      </div>
      {onEmail !== undefined && email !== undefined ? (
        <Input value={email} onChange={(e) => onEmail(e.target.value)} placeholder="Faktura-epost" type="email" />
      ) : null}
    </div>
  );
}

type Props = { fortnoxConnected: boolean };

export default function CustomerFormClient({ fortnoxConnected }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  // Where the back/cancel controls go. When we came from the offer form, return there
  // (restore_quote tells it to restore the stashed draft, without selecting a customer).
  const cancelTo = returnTo ? `${returnTo}?restore_quote=1` : '/crm/kunder';
  const [draft, setDraft] = useState<Draft>(initial);
  const [createInFortnox, setCreateInFortnox] = useState(false);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((c) => ({ ...c, [key]: value }));
  }

  async function handleSubmit() {
    const isB2B = draft.customer_type === 'business';
    if (isB2B && !draft.company_name.trim()) { toast.error('Företagsnamn krävs'); return; }
    if (!isB2B && (!draft.first_name.trim() || !draft.last_name.trim())) { toast.error('För- och efternamn krävs'); return; }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        customer_type: draft.customer_type,
        create_in_fortnox: createInFortnox,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        mobile: draft.mobile.trim() || null,
        visit_address: buildAddress(draft.visit_street, draft.visit_postal_code, draft.visit_city),
        delivery_address: buildAddress(draft.delivery_street, draft.delivery_postal_code, draft.delivery_city),
        invoice_address: buildAddress(draft.invoice_street, draft.invoice_postal_code, draft.invoice_city),
        invoice_email: draft.invoice_email.trim() || null,
        payment_terms: draft.payment_terms.trim() || null,
        price_list: draft.price_list.trim() || null,
        discount: draft.discount.trim() ? Number(draft.discount) : null,
        vat_number: draft.vat_number.trim() || null,
        reverse_vat: draft.reverse_vat,
      };
      if (isB2B) {
        body.company_name = draft.company_name.trim();
        body.organization_number = draft.organization_number.trim() || null;
      } else {
        body.first_name = draft.first_name.trim();
        body.last_name = draft.last_name.trim();
        body.personal_number = draft.personal_number.trim() || null;
      }

      const res = await fetch('/api/crm/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skapa kund'); return; }

      const item = json?.data?.item as { id: string; fortnox_customer_id?: string } | undefined;
      if (json?.data?.fortnox_error) {
        toast.error(`Kund skapad men Fortnox-push misslyckades: ${json.data.fortnox_error}`);
      } else if (createInFortnox && item?.fortnox_customer_id) {
        toast.success(`Kund skapad och synkad med Fortnox (#${item.fortnox_customer_id})`);
      } else {
        toast.success('Kund skapad');
      }

      // When sent here from the offer form, return there with the new customer id
      // so it can be auto-selected. Otherwise go to the new customer's detail page.
      if (returnTo && item?.id) {
        const sep = returnTo.includes('?') ? '&' : '?';
        router.push(`${returnTo}${sep}created_customer_id=${item.id}`);
      } else {
        router.push(item?.id ? `/crm/kunder/${item.id}` : '/crm/kunder');
      }
    } catch {
      toast.error('Fel vid skapande av kund');
    } finally {
      setSaving(false);
    }
  }

  const isB2B = draft.customer_type === 'business';

  return (
    <div className="grid gap-6">

      {/* ── Header ── */}
      <div>
        <button
          type="button"
          onClick={() => router.push(cancelTo)}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {returnTo ? 'Tillbaka till offert' : 'Kundregister'}
        </button>
        <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Registrera kund</h1>
        <p className="m-0 mt-0.5 text-sm text-slate-500">Fyll i uppgifterna nedan för att skapa en ny kundpost</p>
      </div>

      {/* ── Body: form + sidebar ── */}
      <div className="grid gap-5 lg:grid-cols-[1fr_300px] lg:items-start">

        {/* Left: form sections */}
        <div className="grid gap-5">

          {/* Row 1: Grundinfo + Kontakt side by side on desktop */}
          <div className="grid gap-5 lg:grid-cols-2">

            {/* Grundinfo */}
            <CardSection title="Grundinfo">
              <div className="grid gap-3">
                <div>
                  <FieldLabel>Kundtyp</FieldLabel>
                  <Select
                    value={draft.customer_type}
                    onChange={(e) => set('customer_type', e.target.value as CustomerType)}
                  >
                    <option value="business">Företag</option>
                    <option value="private">Privat</option>
                  </Select>
                </div>

                {isB2B ? (
                  <>
                    <div>
                      <FieldLabel>Företagsnamn *</FieldLabel>
                      <Input value={draft.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="AB Exempelbolaget" />
                    </div>
                    <div>
                      <FieldLabel>Organisationsnummer</FieldLabel>
                      <Input value={draft.organization_number} onChange={(e) => set('organization_number', e.target.value)} placeholder="556000-0000" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <FieldLabel>Förnamn *</FieldLabel>
                        <Input value={draft.first_name} onChange={(e) => set('first_name', e.target.value)} placeholder="Anna" />
                      </div>
                      <div>
                        <FieldLabel>Efternamn *</FieldLabel>
                        <Input value={draft.last_name} onChange={(e) => set('last_name', e.target.value)} placeholder="Svensson" />
                      </div>
                    </div>
                    <div>
                      <FieldLabel>Personnummer</FieldLabel>
                      <Input value={draft.personal_number} onChange={(e) => set('personal_number', e.target.value)} placeholder="ÅÅMMDD-XXXX" />
                    </div>
                  </>
                )}
              </div>
            </CardSection>

            {/* Kontakt */}
            <CardSection title="Kontakt">
              <div className="grid gap-3">
                <div>
                  <FieldLabel>E-post</FieldLabel>
                  <Input value={draft.email} onChange={(e) => set('email', e.target.value)} placeholder="info@foretaget.se" type="email" />
                </div>
                <div>
                  <FieldLabel>Telefon</FieldLabel>
                  <Input value={draft.phone} onChange={(e) => set('phone', e.target.value)} placeholder="08-123 456 78" />
                </div>
                <div>
                  <FieldLabel>Mobil</FieldLabel>
                  <Input value={draft.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="070-123 456 78" />
                </div>
              </div>
            </CardSection>
          </div>

          {/* Row 2: Adresser – 3 columns on desktop */}
          <CardSection title="Adresser">
            <div className="grid gap-5 lg:grid-cols-3">
              <AddressColumn
                label="Besöksadress"
                street={draft.visit_street} postalCode={draft.visit_postal_code} city={draft.visit_city}
                onStreet={(v) => set('visit_street', v)} onPostal={(v) => set('visit_postal_code', v)} onCity={(v) => set('visit_city', v)}
              />
              <AddressColumn
                label="Leveransadress"
                street={draft.delivery_street} postalCode={draft.delivery_postal_code} city={draft.delivery_city}
                onStreet={(v) => set('delivery_street', v)} onPostal={(v) => set('delivery_postal_code', v)} onCity={(v) => set('delivery_city', v)}
              />
              <AddressColumn
                label="Fakturaadress"
                street={draft.invoice_street} postalCode={draft.invoice_postal_code} city={draft.invoice_city}
                email={draft.invoice_email}
                onStreet={(v) => set('invoice_street', v)} onPostal={(v) => set('invoice_postal_code', v)} onCity={(v) => set('invoice_city', v)}
                onEmail={(v) => set('invoice_email', v)}
              />
            </div>
          </CardSection>

          {/* Row 3: Fakturainställningar */}
          <CardSection title="Fakturainställningar">
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <FieldLabel>Betalningsvillkor</FieldLabel>
                  <FortnoxCodeSelect
                    value={draft.payment_terms}
                    onChange={(v) => set('payment_terms', v)}
                    endpoint="/api/fortnox/terms-of-payment"
                    emptyLabel="Standard (Fortnox)"
                    placeholder="30 dagar"
                  />
                </div>
                <div>
                  <FieldLabel>Prislista</FieldLabel>
                  <FortnoxCodeSelect
                    value={draft.price_list}
                    onChange={(v) => set('price_list', v)}
                    endpoint="/api/fortnox/price-lists"
                    emptyLabel="Standard (Fortnox)"
                    placeholder="A"
                  />
                </div>
                <div>
                  <FieldLabel>Rabatt (%)</FieldLabel>
                  <Input value={draft.discount} onChange={(e) => set('discount', e.target.value)} placeholder="0" type="number" min="0" max="100" step="0.01" />
                </div>
                <div>
                  <FieldLabel>Momsreg-nummer</FieldLabel>
                  <Input value={draft.vat_number} onChange={(e) => set('vat_number', e.target.value)} placeholder="SE556000000001" />
                </div>
              </div>
              <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={draft.reverse_vat}
                  onChange={(e) => set('reverse_vat', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                />
                Omvänd skattskyldighet
              </label>
            </div>
          </CardSection>

        </div>

        {/* Right: sidebar */}
        <div className="grid gap-4 lg:sticky lg:top-6">

          {/* Fortnox */}
          {fortnoxConnected ? (
            <div className="rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50 to-white p-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-500">Fortnox</p>
              <label className="flex cursor-pointer select-none items-start gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={createInFortnox}
                  onChange={(e) => setCreateInFortnox(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-violet-600"
                />
                <span>
                  <strong className="block font-semibold text-slate-800">Skapa även i Fortnox</strong>
                  <span className="text-xs text-slate-500 leading-relaxed">Kunden skapas direkt i Fortnox och tilldelas ett kundnummer.</span>
                </span>
              </label>
            </div>
          ) : null}

          {/* Actions */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 grid gap-2 shadow-[0_1px_6px_rgba(0,0,0,0.04)]">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-emerald-600 bg-gradient-to-b from-emerald-500 to-emerald-600 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.28)] transition hover:brightness-[0.97] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Sparar…' : 'Skapa kund'}
            </button>
            <button
              type="button"
              onClick={() => router.push(cancelTo)}
              className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition hover:border-slate-300"
            >
              Avbryt
            </button>
          </div>

          {/* Tips */}
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-2">Tips</p>
            <ul className="grid gap-1.5">
              {[
                'Fält med * krävs.',
                'Leveransadressen används vid ordrar om den avviker från besöksadressen.',
                'Fakturaadressen och faktura-epost används vid fakturering.',
              ].map((tip) => (
                <li key={tip} className="flex items-start gap-2 text-xs text-slate-500 leading-relaxed">
                  <span className="mt-0.5 shrink-0 text-slate-300">–</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>
    </div>
  );
}
