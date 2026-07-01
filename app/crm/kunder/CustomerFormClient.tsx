"use client";

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import FortnoxCodeSelect from './FortnoxCodeSelect';
import TicLookupInput from '@/app/crm/components/TicLookupInput';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { formatSwedishIdNumber, isValidSwedishOrgNumber, vatFromOrgNumber } from './customerNumbers';
import { riskTypeLabel } from '@/lib/domains/tic/mappers';
import { CreditReportSummary } from '@/app/crm/components/CreditReport';
import type { TicLookupResult, TicRiskIndicator, TicCreditReport } from '@/lib/domains/tic/types';

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
  annual_revenue: string;
  number_of_employees: string;
  legal_entity_type: string;
  sni_code: string;
  sni_name: string;
  operating_profit: string;
  profit_after_financial_items: string;
  total_assets: string;
  operating_margin: string;
  equity_ratio: string;
  financial_year: string;
  risk_indicators: TicRiskIndicator[];
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
  annual_revenue: '',
  number_of_employees: '',
  legal_entity_type: '',
  sni_code: '',
  sni_name: '',
  operating_profit: '',
  profit_after_financial_items: '',
  total_assets: '',
  operating_margin: '',
  equity_ratio: '',
  financial_year: '',
  risk_indicators: [],
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

// Same card chrome as CardSection but collapsible (native <details>). Collapsed by
// default; the summary row carries the title + an optional hint and a chevron.
function CollapsibleCardSection({
  title, hint, children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <details className={cn(crm.cardInner, 'group')}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className={crm.sectionTitle}>{title}</span>
          {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
        </span>
        <svg
          width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden
          className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function AddressColumn({
  label, street, postalCode, city, email,
  onStreet, onPostal, onCity, onEmail,
  disabled, headerControl,
}: {
  label: string;
  street: string; postalCode: string; city: string; email?: string;
  onStreet: (v: string) => void; onPostal: (v: string) => void; onCity: (v: string) => void;
  onEmail?: (v: string) => void;
  disabled?: boolean;
  headerControl?: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className={crm.sectionTitle}>{label}</p>
        {headerControl}
      </div>
      <Input value={street} onChange={(e) => onStreet(e.target.value)} placeholder="Gatuadress" disabled={disabled} />
      <div className="grid grid-cols-2 gap-2">
        <Input value={postalCode} onChange={(e) => onPostal(e.target.value)} placeholder="Postnr" disabled={disabled} />
        <Input value={city} onChange={(e) => onCity(e.target.value)} placeholder="Stad" disabled={disabled} />
      </div>
      {onEmail !== undefined && email !== undefined ? (
        <Input value={email} onChange={(e) => onEmail(e.target.value)} placeholder="Faktura-epost" type="email" disabled={disabled} />
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
  // The invoice address defaults to the visit address + contact email so the common
  // "same address" case needs no typing. While this is on, the invoice fields mirror
  // the visit address and stay locked; unchecking seeds + unlocks them for editing.
  const [invoiceSameAsVisit, setInvoiceSameAsVisit] = useState(true);
  // Credit report previewed before the customer exists; persisted with the row on save so
  // we don't bill tic.io a second time.
  const [creditReport, setCreditReport] = useState<TicCreditReport | null>(null);
  const [creditCompanyId, setCreditCompanyId] = useState<number | null>(null);
  const [creditFetchedAt, setCreditFetchedAt] = useState<string | null>(null);
  const [fetchingCredit, setFetchingCredit] = useState(false);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((c) => ({ ...c, [key]: value }));
  }

  // Drop a previewed report when the org number changes — it no longer matches the company.
  function clearCreditReport() {
    setCreditReport(null);
    setCreditCompanyId(null);
    setCreditFetchedAt(null);
  }

  // Pull a tic.io credit report for the typed org number (no customer row yet).
  async function fetchCreditPreview() {
    const org = draft.organization_number.trim();
    if (!org) { toast.error('Ange organisationsnummer först'); return; }
    setFetchingCredit(true);
    try {
      const res = await fetch('/api/tic/companies/credit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_number: org }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte hämta kreditupplysning'); return; }
      setCreditReport(json.data?.report ?? null);
      setCreditCompanyId(json.data?.company_id ?? null);
      setCreditFetchedAt(new Date().toISOString());
      toast.success('Kreditupplysning hämtad');
    } catch { toast.error('Fel vid hämtning av kreditupplysning'); }
    finally { setFetchingCredit(false); }
  }

  function toggleInvoiceSame(same: boolean) {
    // When unchecking, seed the now-editable invoice fields from the visit address +
    // contact email so the user starts from populated fields, not blank ones.
    if (!same) {
      setDraft((c) => ({
        ...c,
        invoice_street: c.visit_street,
        invoice_postal_code: c.visit_postal_code,
        invoice_city: c.visit_city,
        invoice_email: c.email,
      }));
    }
    setInvoiceSameAsVisit(same);
  }

  // Switching customer type clears the fields that belong to the other type, so a
  // private customer never carries an org number / VAT / reverse VAT (all
  // business-only concepts) and a business customer never carries a personal number.
  function setCustomerType(type: CustomerType) {
    if (type === 'private' && creditReport) clearCreditReport();
    setDraft((c) =>
      type === 'private'
        ? { ...c, customer_type: type, organization_number: '', vat_number: '', reverse_vat: false }
        : { ...c, customer_type: type, personal_number: '' },
    );
  }

  // Auto-derive the VAT number from the org number for business customers,
  // but only while the VAT field is still empty so manual edits are preserved.
  function setOrganizationNumber(value: string) {
    const formatted = formatSwedishIdNumber(value);
    if (creditReport) clearCreditReport();
    setDraft((c) => {
      const next = { ...c, organization_number: formatted };
      if (!c.vat_number.trim()) {
        const derived = vatFromOrgNumber(formatted);
        if (derived) next.vat_number = derived;
      }
      return next;
    });
  }

  // Pre-fill the form from a tic.io lookup hit. Only writes into empty fields so a
  // lookup never clobbers something the user already typed (same principle as the
  // VAT derivation above). Org/personal numbers are run through the same formatter.
  function applyLookup(r: TicLookupResult) {
    setDraft((c) => {
      const next = { ...c };
      if (r.kind === 'company') {
        if (r.company_name && !c.company_name.trim()) next.company_name = r.company_name;
        if (r.organization_number && !c.organization_number.trim()) {
          const formatted = formatSwedishIdNumber(r.organization_number);
          next.organization_number = formatted;
          if (!c.vat_number.trim()) {
            const derived = vatFromOrgNumber(formatted);
            if (derived) next.vat_number = derived;
          }
        }
        if (r.annual_revenue != null && !c.annual_revenue.trim()) next.annual_revenue = String(r.annual_revenue);
        if (r.number_of_employees != null && !c.number_of_employees.trim()) next.number_of_employees = String(r.number_of_employees);
        // Extra company info → "Övrig information" section. Fill only empty fields.
        if (r.legal_entity_type && !c.legal_entity_type.trim()) next.legal_entity_type = r.legal_entity_type;
        if (r.sni_code && !c.sni_code.trim()) next.sni_code = r.sni_code;
        if (r.sni_name && !c.sni_name.trim()) next.sni_name = r.sni_name;
        if (r.operating_profit != null && !c.operating_profit.trim()) next.operating_profit = String(r.operating_profit);
        if (r.profit_after_financial_items != null && !c.profit_after_financial_items.trim()) next.profit_after_financial_items = String(r.profit_after_financial_items);
        if (r.total_assets != null && !c.total_assets.trim()) next.total_assets = String(r.total_assets);
        if (r.operating_margin != null && !c.operating_margin.trim()) next.operating_margin = String(r.operating_margin);
        if (r.equity_ratio != null && !c.equity_ratio.trim()) next.equity_ratio = String(r.equity_ratio);
        if (r.financial_year != null && !c.financial_year.trim()) next.financial_year = String(r.financial_year);
        if (r.risk_indicators && r.risk_indicators.length > 0 && c.risk_indicators.length === 0) {
          next.risk_indicators = r.risk_indicators;
        }
      } else {
        if (r.first_name && !c.first_name.trim()) next.first_name = r.first_name;
        if (r.last_name && !c.last_name.trim()) next.last_name = r.last_name;
        if (r.personal_number && !c.personal_number.trim()) next.personal_number = formatSwedishIdNumber(r.personal_number);
      }
      if (r.email && !c.email.trim()) next.email = r.email;
      if (r.phone && !c.phone.trim()) next.phone = r.phone;
      if (r.address) {
        if (r.address.street && !c.visit_street.trim()) next.visit_street = r.address.street;
        if (r.address.postal_code && !c.visit_postal_code.trim()) next.visit_postal_code = r.address.postal_code;
        if (r.address.city && !c.visit_city.trim()) next.visit_city = r.address.city;
      }
      return next;
    });
    toast.success('Uppgifter hämtade från uppslaget');
  }

  async function handleSubmit() {
    const isB2B = draft.customer_type === 'business';
    if (isB2B && !draft.company_name.trim()) { toast.error('Företagsnamn krävs'); return; }
    if (!isB2B && (!draft.first_name.trim() || !draft.last_name.trim())) { toast.error('För- och efternamn krävs'); return; }
    // Personnummer is optional at create — sales sometimes only get it once the job is booked.
    // It is required later, when a work order is created for the customer.

    // When "same as visit address" is on, the invoice address + email follow the visit
    // address / contact email rather than the (locked, possibly stale) invoice fields.
    const invoiceStreet = invoiceSameAsVisit ? draft.visit_street : draft.invoice_street;
    const invoicePostal = invoiceSameAsVisit ? draft.visit_postal_code : draft.invoice_postal_code;
    const invoiceCity = invoiceSameAsVisit ? draft.visit_city : draft.invoice_city;
    const invoiceEmail = invoiceSameAsVisit ? draft.email : draft.invoice_email;

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
        invoice_address: buildAddress(invoiceStreet, invoicePostal, invoiceCity),
        invoice_email: invoiceEmail.trim() || null,
        payment_terms: draft.payment_terms.trim() || null,
        price_list: draft.price_list.trim() || null,
        discount: draft.discount.trim() ? Number(draft.discount) : null,
        vat_number: draft.vat_number.trim() || null,
        reverse_vat: draft.reverse_vat,
        annual_revenue: draft.annual_revenue.trim() ? Number(draft.annual_revenue) : null,
        number_of_employees: draft.number_of_employees.trim() ? Number(draft.number_of_employees) : null,
        legal_entity_type: draft.legal_entity_type.trim() || null,
        sni_code: draft.sni_code.trim() || null,
        sni_name: draft.sni_name.trim() || null,
        operating_profit: draft.operating_profit.trim() ? Number(draft.operating_profit) : null,
        profit_after_financial_items: draft.profit_after_financial_items.trim() ? Number(draft.profit_after_financial_items) : null,
        total_assets: draft.total_assets.trim() ? Number(draft.total_assets) : null,
        operating_margin: draft.operating_margin.trim() ? Number(draft.operating_margin) : null,
        equity_ratio: draft.equity_ratio.trim() ? Number(draft.equity_ratio) : null,
        financial_year: draft.financial_year.trim() ? Number(draft.financial_year) : null,
        risk_indicators: draft.risk_indicators.length > 0 ? draft.risk_indicators : null,
      };
      if (isB2B) {
        body.company_name = draft.company_name.trim();
        body.organization_number = draft.organization_number.trim() || null;
        // Persist a previewed credit report with the new row (no re-fetch on save).
        if (creditReport) {
          body.tic_company_id = creditCompanyId;
          body.credit_report = creditReport;
          body.credit_report_fetched_at = creditFetchedAt;
        }
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

  // While "same as visit address" is on, the invoice column shows the visit address +
  // contact email live (locked); otherwise it shows the customer's own invoice fields.
  const invoiceStreet = invoiceSameAsVisit ? draft.visit_street : draft.invoice_street;
  const invoicePostal = invoiceSameAsVisit ? draft.visit_postal_code : draft.invoice_postal_code;
  const invoiceCity = invoiceSameAsVisit ? draft.visit_city : draft.invoice_city;
  const invoiceEmail = invoiceSameAsVisit ? draft.email : draft.invoice_email;

  return (
    <div className="grid grid-cols-1 gap-6">

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
                    onChange={(e) => setCustomerType(e.target.value as CustomerType)}
                  >
                    <option value="business">Företag</option>
                    <option value="private">Privat</option>
                  </Select>
                </div>

                {/* Lookup is company-only: tic.io person search requires the Enterprise+
                    tier, which we don't have, so it's hidden for private customers. */}
                {isB2B ? (
                  <div>
                    <FieldLabel>Slå upp företag</FieldLabel>
                    <TicLookupInput mode="company" onSelect={applyLookup} />
                    <p className="mt-1 text-xs text-slate-400">Sök via tic.io för att fylla i uppgifterna automatiskt.</p>
                  </div>
                ) : null}

                {isB2B ? (
                  <>
                    <div>
                      <FieldLabel>Företagsnamn *</FieldLabel>
                      <Input value={draft.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="AB Exempelbolaget" />
                    </div>
                    <div>
                      <FieldLabel>Organisationsnummer</FieldLabel>
                      <Input value={draft.organization_number} onChange={(e) => setOrganizationNumber(e.target.value)} placeholder="556000-0000" />
                      {draft.organization_number.replace(/\D/g, '').length === 10 && !isValidSwedishOrgNumber(draft.organization_number) ? (
                        <p className="mt-1 text-xs text-amber-600">Ogiltigt organisationsnummer – kontrollsiffran stämmer inte.</p>
                      ) : null}
                    </div>

                    {/* Kreditupplysning — hämtas (och sparas med kunden) innan kunden finns */}
                    <div className="rounded-xl border border-[#e0e8dc] bg-[#f3f6f1] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Kreditupplysning</p>
                          <p className="mt-0.5 text-xs text-slate-400">Hämta kreditbetyg & risk från tic.io innan du sparar.</p>
                        </div>
                        <button
                          type="button"
                          onClick={fetchCreditPreview}
                          disabled={fetchingCredit || !draft.organization_number.trim()}
                          className={cn(crm.ghostButton, 'shrink-0 disabled:opacity-50')}
                        >
                          {fetchingCredit ? 'Hämtar…' : creditReport ? 'Uppdatera' : 'Hämta'}
                        </button>
                      </div>
                      {creditReport ? (
                        <div className="mt-3 border-t border-[#e0e8dc] pt-3">
                          <CreditReportSummary report={creditReport} />
                        </div>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <FieldLabel>Omsättning (SEK)</FieldLabel>
                        <Input value={draft.annual_revenue} onChange={(e) => set('annual_revenue', e.target.value)} placeholder="0" type="number" min="0" step="1" />
                      </div>
                      <div>
                        <FieldLabel>Antal anställda</FieldLabel>
                        <Input value={draft.number_of_employees} onChange={(e) => set('number_of_employees', e.target.value)} placeholder="0" type="number" min="0" step="1" />
                      </div>
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
                      <Input value={draft.personal_number} onChange={(e) => set('personal_number', formatSwedishIdNumber(e.target.value))} placeholder="ÅÅMMDD-XXXX" />
                      <p className="mt-1 text-[11px] leading-snug text-slate-400">Kan fyllas i senare, men krävs innan en order kan skapas för kunden.</p>
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
                street={invoiceStreet} postalCode={invoicePostal} city={invoiceCity}
                email={invoiceEmail}
                onStreet={(v) => set('invoice_street', v)} onPostal={(v) => set('invoice_postal_code', v)} onCity={(v) => set('invoice_city', v)}
                onEmail={(v) => set('invoice_email', v)}
                disabled={invoiceSameAsVisit}
                headerControl={
                  <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={invoiceSameAsVisit}
                      onChange={(e) => toggleInvoiceSame(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600"
                    />
                    Samma som besöksadress
                  </label>
                }
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
                {isB2B ? (
                  <div>
                    <FieldLabel>Momsreg-nummer</FieldLabel>
                    <Input value={draft.vat_number} onChange={(e) => set('vat_number', e.target.value)} placeholder="SE556000000001" />
                  </div>
                ) : null}
              </div>
              {isB2B ? (
                <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={draft.reverse_vat}
                    onChange={(e) => set('reverse_vat', e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                  />
                  Omvänd skattskyldighet
                </label>
              ) : null}
            </div>
          </CardSection>

          {/* Row 4: Övrig information (företag) – collapsible, mostly filled by the lookup */}
          {isB2B ? (
            <CollapsibleCardSection title="Övrig information" hint="ekonomi, bransch & risk">
              <div className="grid gap-5">

                {/* Bransch & bolagsform */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <FieldLabel>Bolagsform</FieldLabel>
                    <Input value={draft.legal_entity_type} onChange={(e) => set('legal_entity_type', e.target.value)} placeholder="Aktiebolag" />
                  </div>
                  <div>
                    <FieldLabel>SNI-kod</FieldLabel>
                    <Input value={draft.sni_code} onChange={(e) => set('sni_code', e.target.value)} placeholder="43990" />
                  </div>
                  <div>
                    <FieldLabel>Bransch</FieldLabel>
                    <Input value={draft.sni_name} onChange={(e) => set('sni_name', e.target.value)} placeholder="Specialiserad bygg- och anläggningsverksamhet" />
                  </div>
                </div>

                {/* Ekonomi & nyckeltal */}
                <div>
                  <p className={cn('mb-2', crm.label)}>Ekonomi & nyckeltal</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <FieldLabel>Rörelseresultat (SEK)</FieldLabel>
                      <Input value={draft.operating_profit} onChange={(e) => set('operating_profit', e.target.value)} placeholder="0" type="number" step="1" />
                    </div>
                    <div>
                      <FieldLabel>Resultat e. fin. poster (SEK)</FieldLabel>
                      <Input value={draft.profit_after_financial_items} onChange={(e) => set('profit_after_financial_items', e.target.value)} placeholder="0" type="number" step="1" />
                    </div>
                    <div>
                      <FieldLabel>Totala tillgångar (SEK)</FieldLabel>
                      <Input value={draft.total_assets} onChange={(e) => set('total_assets', e.target.value)} placeholder="0" type="number" step="1" />
                    </div>
                    <div>
                      <FieldLabel>Rörelsemarginal (%)</FieldLabel>
                      <Input value={draft.operating_margin} onChange={(e) => set('operating_margin', e.target.value)} placeholder="0" type="number" step="0.1" />
                    </div>
                    <div>
                      <FieldLabel>Soliditet (%)</FieldLabel>
                      <Input value={draft.equity_ratio} onChange={(e) => set('equity_ratio', e.target.value)} placeholder="0" type="number" step="0.1" />
                    </div>
                    <div>
                      <FieldLabel>Räkenskapsår</FieldLabel>
                      <Input value={draft.financial_year} onChange={(e) => set('financial_year', e.target.value)} placeholder="2024" type="number" step="1" />
                    </div>
                  </div>
                </div>

                {/* Riskindikatorer (read-only, från uppslaget) */}
                <div>
                  <p className={cn('mb-2', crm.label)}>Riskindikatorer</p>
                  {draft.risk_indicators.length > 0 ? (
                    <ul className="grid gap-1.5">
                      {draft.risk_indicators.map((r, i) => (
                        <li key={`${r.type}-${i}`} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <span className="mt-0.5 shrink-0">⚠</span>
                          <span>
                            <span className="font-semibold">{riskTypeLabel(r.type)}</span>
                            {r.notes ? <span className="text-amber-700"> – {r.notes}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-400">Inga riskindikatorer hämtade.</p>
                  )}
                </div>

              </div>
            </CollapsibleCardSection>
          ) : null}

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
          <div className="rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 grid gap-2 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
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
                'Fakturaadressen följer besöksadressen som standard – avmarkera rutan för att ange en annan.',
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
