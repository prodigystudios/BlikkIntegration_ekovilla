"use client";

import { useEffect, useState } from 'react';
import { postalCodeWarning } from '@/lib/domains/crm/postalCode';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import FortnoxCodeSelect from './FortnoxCodeSelect';
import CollapsibleCardSection from './CollapsibleCardSection';
import TicLookupInput from '@/app/crm/components/TicLookupInput';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { formatSwedishIdNumber, isValidSwedishOrgNumber, vatFromOrgNumber } from './customerNumbers';
import type { AccountManagerOption } from './accountManagerDefault';
import {
  applyTicLookup,
  clearTicLookup,
  EMPTY_TIC_FILL,
  INITIAL_NEW_CUSTOMER_DRAFT,
  isTicFilled,
  newCustomerChecklist,
  resolveInvoiceEmail,
  type CustomerType,
  type NewCustomerDraft,
  type TicFill,
  type TicFillableField,
} from './newCustomerDraft';
import {
  formatPersonalNumber,
  isValidPersonalNumber,
  PERSONAL_NUMBER_ERROR,
  PERSONAL_NUMBER_OPTIONAL_HINT,
} from '@/lib/domains/crm/personalNumber';
import { riskTypeLabel } from '@/lib/domains/tic/mappers';
import { creditForecastText, creditRemarkLines, creditRiskLabel, creditScoreMeta } from '@/app/crm/components/CreditReport';
import type { TicLookupResult, TicCreditReport } from '@/lib/domains/tic/types';

type Seller = { id: string; full_name: string | null; role: string };

function buildAddress(street: string, postalCode: string, city: string) {
  if (!street && !postalCode && !city) return null;
  return { street: street || null, postal_code: postalCode || null, city: city || null };
}

// Medvetet SNÄVARE än den delade `safeReturnTo` i app/crm/lib/returnTo.ts: hit kommer man bara
// från offertformuläret, så bara den vägen tillbaka godtas. Eget namn för att skillnaden inte
// ska förväxlas — den delade släpper igenom hela /crm/.
function safeOfferFormReturnTo(returnTo: string | null): string | null {
  return returnTo && returnTo.startsWith('/crm/offerter/') ? returnTo : null;
}

// Kortens rubrik är en vanlig rubrik (sentence case), inte CRM-kickern: formuläret har få och stora
// sektioner, och skissen bär dem som rubriker. Kickern står kvar där den hör hemma — i sidokolumnen.
const sectionHeading = 'm-0 mb-4 text-base font-semibold text-slate-900';
const cardPadding = 'p-5 sm:p-6';
// Textlänk som är en knapp ("Byt företag", "Fyll i manuellt istället" …). `min-h-8` för touch,
// `px-0 py-0` mot den globala knapp-paddingen.
const linkButton = 'min-h-8 px-0 py-0 text-[13px] font-semibold text-[color:var(--ek-accent)] underline underline-offset-2 hover:text-[color:var(--ek-green)]';

function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn(crm.cardInner, cardPadding, className)}>
      {title ? <h2 className={sectionHeading}>{title}</h2> : null}
      {children}
    </section>
  );
}

function TicTag() {
  return (
    <span className="inline-flex h-[18px] items-center rounded-full bg-[color:var(--ek-accent-soft)] px-1.5 text-[11px] font-semibold text-[color:var(--ek-accent)]">
      tic.io
    </span>
  );
}

// 🧨 `flex` + `w-full` medvetet: `:where(label){display:block;width:100%}` i globals.css — `flex`
// slår display, och bredden får stå kvar eftersom etiketten ska vara full rad över sitt fält.
function FieldLabel({ htmlFor, children, tic, hint }: { htmlFor?: string; children: React.ReactNode; tic?: boolean; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn(crm.label, 'flex items-center gap-2')}>
      <span>{children}</span>
      {hint ? <span className="font-normal text-slate-500">{hint}</span> : null}
      {tic ? <TicTag /> : null}
    </label>
  );
}

// 🧨 `w-auto` — `:where(label){width:100%}` gör annars varje kryssruta fullbred, och två rutor som
// ska stå på en rad staplas.
function CheckRow({ checked, onChange, children, className }: {
  checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={cn('flex min-h-11 w-auto cursor-pointer select-none items-center gap-2.5 text-sm text-slate-700', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-[18px] w-[18px] shrink-0 rounded border-slate-300 accent-[color:var(--ek-green)]"
      />
      {children}
    </label>
  );
}

// Fortnox tar bara siffror i ZipCode och avvisar kunden med ett 400 som inte pekar ut fältet —
// felet dyker upp först flera steg senare, som "Ingen Fortnox-kundkoppling" på en orderpush.
// Uppmätt i drift 2026-09-17. VARNAR, spärrar inte: fältet bär utländska adresser också, och en hård
// spärr på ett fritextfält lär man sig bara att kringgå. Se lib/domains/crm/postalCode.ts.
function ZipWarning({ postalCode, city }: { postalCode: string; city: string }) {
  const warning = postalCodeWarning(postalCode, city);
  return warning ? <p className="m-0 text-[11px] leading-snug text-amber-700">{warning}</p> : null;
}

// En avvikande adress (leverans eller faktura) i en nedsänkt ruta under kryssrutorna.
function ExtraAddress({ title, idPrefix, street, postalCode, city, onStreet, onPostal, onCity }: {
  title: string; idPrefix: string;
  street: string; postalCode: string; city: string;
  onStreet: (v: string) => void; onPostal: (v: string) => void; onCity: (v: string) => void;
}) {
  return (
    <div className={cn(crm.sunken, 'grid gap-3 rounded-xl p-4')}>
      <p className={cn(crm.groupTitle, 'm-0')}>{title}</p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        <Input id={`${idPrefix}-street`} aria-label={`${title}, gatuadress`} value={street} onChange={(e) => onStreet(e.target.value)} placeholder="Gatuadress" />
        <Input id={`${idPrefix}-zip`} aria-label={`${title}, postnummer`} value={postalCode} onChange={(e) => onPostal(e.target.value)} placeholder="Postnr" />
        <Input id={`${idPrefix}-city`} aria-label={`${title}, ort`} value={city} onChange={(e) => onCity(e.target.value)} placeholder="Ort" />
      </div>
      <ZipWarning postalCode={postalCode} city={city} />
    </div>
  );
}

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

// Kreditupplysningen innan kunden finns. Hämtas med knapp, aldrig av sig själv: tic.io-kvoten är
// begränsad (Williams beslut 2026-10-22). Rapporten sparas med kunden vid Skapa, så ingen ny hämtning.
function CreditPreview({ report, fetching, canFetch, onFetch }: {
  report: TicCreditReport | null; fetching: boolean; canFetch: boolean; onFetch: () => void;
}) {
  if (!report) {
    return (
      <div className={cn(crm.sunken, 'flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3')}>
        <div className="min-w-0">
          <p className={cn(crm.sectionTitle, 'm-0')}>Kreditupplysning</p>
          <p className="m-0 mt-0.5 text-xs text-slate-600">
            {canFetch ? 'Kreditbetyg och betalningsanmärkningar från tic.io.' : 'Kräver organisationsnummer.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onFetch}
          disabled={fetching || !canFetch}
          className={cn(crm.ghostButton, 'h-10 shrink-0 px-3.5')}
        >
          {fetching ? 'Hämtar…' : 'Hämta kreditupplysning'}
        </button>
      </div>
    );
  }
  const score = creditScoreMeta(report.credit_score);
  const remarks = creditRemarkLines(report);
  const forecast = creditForecastText(report);
  return (
    <div className={cn(crm.sunken, 'grid gap-2 rounded-xl px-4 py-3')}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className={cn(crm.sectionTitle, 'm-0')}>Kreditbetyg</p>
          <p className="m-0 mt-0.5 text-[15px] font-bold tabular-nums">
            <span className={score.text}>{report.credit_score != null ? `${report.credit_score}/100` : '–'}</span>
            <span className="font-medium text-slate-600"> · {creditRiskLabel(report)}</span>
          </p>
          {forecast ? <p className="m-0 text-xs text-slate-600">{forecast}</p> : null}
        </div>
        <button
          type="button"
          onClick={onFetch}
          disabled={fetching || !canFetch}
          className={linkButton}
        >
          {fetching ? 'Hämtar…' : 'Uppdatera'}
        </button>
      </div>
      {remarks.length > 0 ? (
        <ul className="m-0 grid list-none gap-0.5 p-0 text-xs text-slate-700">
          {remarks.map((line) => (
            <li key={line.label}><span className="font-semibold">{line.label}:</span> {line.value}</li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-xs text-slate-600">Inga betalningsanmärkningar eller skulder registrerade.</p>
      )}
      <p className="m-0 text-[11px] text-slate-500">Källa: tic.io · kan skilja från andra kreditbyråer</p>
    </div>
  );
}

type Props = { fortnoxConnected: boolean; defaultAccountManager?: AccountManagerOption | null };

export default function CustomerFormClient({ fortnoxConnected, defaultAccountManager }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const returnTo = safeOfferFormReturnTo(searchParams.get('returnTo'));
  // Where the back/cancel controls go. When we came from the offer form, return there
  // (restore_quote tells it to restore the stashed draft, without selecting a customer).
  //
  // ⚠️ Separatorn måste väljas, inte antas: offertformulärets adress bär numera sin egen
  // `?returnTo=` när resan startade i säljtavlan. Ett hårdkodat `?` gav två frågetecken —
  // `restore_quote` slutade räknas som parameter (utkastet återställdes inte) och hamnade
  // i stället inuti returnTo-värdet, så tavlan aldrig återöppnade kortet.
  const cancelTo = returnTo
    ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}restore_quote=1`
    : '/crm/kunder';
  // Kundansvarig förvald till säljaren som skapar kunden (se accountManagerDefault.ts).
  const [draft, setDraft] = useState<NewCustomerDraft>(() => ({ ...INITIAL_NEW_CUSTOMER_DRAFT, account_manager_id: defaultAccountManager?.id ?? '' }));
  // Urkryssad med flit (Williams beslut 2026-10-22): offertpushen skapar kunden i Fortnox när den
  // behövs (lib/domains/fortnox/offers.ts). Förvald hade varje prospekt hamnat i Fortnox, och Fortnox
  // återanvänder kundnummer när en kund tas bort.
  const [createInFortnox, setCreateInFortnox] = useState(false);
  const [saving, setSaving] = useState(false);
  // Leverans: "samma adress" = ingen egen leveransadress (null), som förut när fälten lämnades tomma —
  // ordern faller då tillbaka på besöksadressen. Faktura: "samma adress" = besöksadressen KOPIERAS in
  // vid sparning, låst under tiden; avkryssning fyller fälten ur besöksadressen så man börjar ifyllt.
  const [deliverySameAsVisit, setDeliverySameAsVisit] = useState(true);
  const [invoiceSameAsVisit, setInvoiceSameAsVisit] = useState(true);
  // Credit report previewed before the customer exists; persisted with the row on save so
  // we don't bill tic.io a second time.
  const [creditReport, setCreditReport] = useState<TicCreditReport | null>(null);
  const [creditCompanyId, setCreditCompanyId] = useState<number | null>(null);
  const [creditFetchedAt, setCreditFetchedAt] = useState<string | null>(null);
  const [fetchingCredit, setFetchingCredit] = useState(false);
  const [sellers, setSellers] = useState<Seller[]>([]);
  // Uppslaget: vald träff (bekräftelsekortet), vad den fyllde i (taggar + "Byt företag") och om
  // säljaren valt bort sökningen.
  const [picked, setPicked] = useState<TicLookupResult | null>(null);
  const [ticFill, setTicFill] = useState<TicFill>(EMPTY_TIC_FILL);
  const [manual, setManual] = useState(false);

  // Säljare för kundansvarig-väljaren (profiles sales/admin, läs-katalog).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/crm/sellers', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (active && res.ok && json.ok) setSellers(json.data?.sellers || []);
      } catch { /* icke-kritiskt */ }
    })();
    return () => { active = false; };
  }, []);

  function set<K extends keyof NewCustomerDraft>(key: K, value: NewCustomerDraft[K]) {
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
    // When unchecking, seed the now-editable invoice fields from the visit address so the user
    // starts from populated fields, not blank ones.
    if (!same) {
      setDraft((c) => ({
        ...c,
        invoice_street: c.visit_street,
        invoice_postal_code: c.visit_postal_code,
        invoice_city: c.visit_city,
      }));
    }
    setInvoiceSameAsVisit(same);
  }

  // Switching customer type clears the fields that belong to the other type, so a
  // private customer never carries an org number / VAT / reverse VAT (all
  // business-only concepts) and a business customer never carries a personal number.
  // Uppslaget backas också, som med "Byt företag": det var ett företag, och dess bolagsdata
  // (omsättning, bransch, nyckeltal …) hade annars följt med en privatkund in i sparningen utan att
  // synas i formuläret. Bekräftelsekortet hade dessutom pekat på ett org.nr som just tömts.
  function setCustomerType(type: CustomerType) {
    if (type === draft.customer_type) return;
    if (type === 'private' && creditReport) clearCreditReport();
    setPicked(null);
    setTicFill(EMPTY_TIC_FILL);
    setDraft((c) => {
      const base = clearTicLookup(c, ticFill);
      return type === 'private'
        ? { ...base, customer_type: type, organization_number: '', vat_number: '', reverse_vat: false }
        : { ...base, customer_type: type, personal_number: '' };
    });
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

  // Pre-fill the form from a tic.io lookup hit — only into empty fields (see applyTicLookup).
  function applyLookup(r: TicLookupResult) {
    const result = applyTicLookup(draft, r);
    setDraft(result.draft);
    setTicFill(result.fill);
    if (r.kind === 'company') setPicked(r);
  }

  // "Byt företag": tillbaka till sökningen, och det uppslaget fyllde töms — det säljaren skrivit om
  // står kvar. Rapporten hör till det förra företagets org.nr.
  function clearPick() {
    setDraft((c) => clearTicLookup(c, ticFill));
    setTicFill(EMPTY_TIC_FILL);
    setPicked(null);
    clearCreditReport();
  }

  const tic = (key: TicFillableField) => isTicFilled(draft, ticFill, key);

  async function handleSubmit() {
    const isB2B = draft.customer_type === 'business';
    if (isB2B && !draft.company_name.trim()) { toast.error('Företagsnamn krävs'); return; }
    if (!isB2B && (!draft.first_name.trim() || !draft.last_name.trim())) { toast.error('För- och efternamn krävs'); return; }
    // Personnummer is optional at create — sales sometimes only get it once the job is booked.
    // It is required later, when a work order is created for the customer.

    // When "same as visit address" is on, the invoice address follows the visit address rather
    // than the (locked, possibly stale) invoice fields.
    const invoiceStreet = invoiceSameAsVisit ? draft.visit_street : draft.invoice_street;
    const invoicePostal = invoiceSameAsVisit ? draft.visit_postal_code : draft.invoice_postal_code;
    const invoiceCity = invoiceSameAsVisit ? draft.visit_city : draft.invoice_city;

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        customer_type: draft.customer_type,
        create_in_fortnox: createInFortnox,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        mobile: draft.mobile.trim() || null,
        visit_address: buildAddress(draft.visit_street, draft.visit_postal_code, draft.visit_city),
        delivery_address: deliverySameAsVisit
          ? null
          : buildAddress(draft.delivery_street, draft.delivery_postal_code, draft.delivery_city),
        invoice_address: buildAddress(invoiceStreet, invoicePostal, invoiceCity),
        invoice_email: resolveInvoiceEmail(draft),
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
        account_manager_id: draft.account_manager_id || null,
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
        // Tomt är fortfarande tillåtet här (fylls ofta i senare) — men står det något ska det
        // hålla, annars når ett trasigt nummer Fortnox och ROT-uppgifterna faller tyst.
        const personalNumber = draft.personal_number.trim();
        if (personalNumber && !isValidPersonalNumber(personalNumber)) {
          // `finally` nedan nollställer saving — därför ingen egen setSaving här.
          toast.error(PERSONAL_NUMBER_ERROR);
          return;
        }
        body.personal_number = personalNumber || null;
      }

      const res = await fetch('/api/crm/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte skapa kund'); return; }

      const item = json?.data?.item as { id: string; fortnox_customer_id?: string } | undefined;
      // Kundkortet säger själv "Kunden är skapad" (bannern, `?skapad=1`) — där vore en grön toast
      // samma besked två gånger. Toasten står kvar när resan går tillbaka till offerten, och
      // Fortnox-felet visas alltid: bannern vet inte att pushen föll.
      const toCard = Boolean(item?.id) && !returnTo;
      if (json?.data?.fortnox_error) {
        toast.error(`Kund skapad men Fortnox-push misslyckades: ${json.data.fortnox_error}`);
      } else if (!toCard && createInFortnox && item?.fortnox_customer_id) {
        toast.success(`Kund skapad och synkad med Fortnox (#${item.fortnox_customer_id})`);
      } else if (!toCard) {
        toast.success('Kund skapad');
      }

      // When sent here from the offer form, return there with the new customer id
      // so it can be auto-selected. Otherwise go to the new customer's detail page.
      if (toCard) {
        router.push(`/crm/kunder/${item?.id}?skapad=1`);
      } else if (returnTo && item?.id) {
        const sep = returnTo.includes('?') ? '&' : '?';
        router.push(`${returnTo}${sep}created_customer_id=${item.id}`);
      } else {
        router.push('/crm/kunder');
      }
    } catch {
      toast.error('Fel vid skapande av kund');
    } finally {
      setSaving(false);
    }
  }

  const isB2B = draft.customer_type === 'business';
  const showLookup = isB2B && !picked && !manual;
  const showManualNote = isB2B && !picked && manual;

  // While "same as visit address" is on, the invoice fields mirror the visit address (see submit).
  const invoiceStreet = invoiceSameAsVisit ? draft.visit_street : draft.invoice_street;
  const invoicePostal = invoiceSameAsVisit ? draft.visit_postal_code : draft.invoice_postal_code;
  const invoiceCity = invoiceSameAsVisit ? draft.visit_city : draft.invoice_city;

  const checklist = newCustomerChecklist(draft);
  const pickedOrg = picked?.organization_number ? formatSwedishIdNumber(picked.organization_number) : null;
  const pickedAddress = [picked?.address?.street, picked?.address?.city].filter(Boolean).join(', ');
  const pickedMeta = [pickedOrg, pickedAddress, picked?.sni_name].filter(Boolean).join(' · ');
  // Uppslaget skriver aldrig över ett ifyllt org.nr. Stod ett annat där redan är det formulärets som
  // sparas och som kreditupplysningen hämtas på — kortet måste säga det, inte bara visa träffens.
  const draftOrgDigits = draft.organization_number.replace(/\D/g, '');
  const pickedOrgDiffers = Boolean(pickedOrg && draftOrgDigits && draftOrgDigits !== pickedOrg.replace(/\D/g, ''));

  const segment = (active: boolean) => cn(
    'h-9 rounded-lg px-4 py-0 text-sm font-semibold transition',
    active ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(20,44,27,0.14)]' : 'text-slate-600 hover:text-slate-900',
  );

  return (
    <div className="grid grid-cols-1 gap-6">

      {/* ── Header ── */}
      <div>
        <button
          type="button"
          onClick={() => router.push(cancelTo)}
          className="mb-1.5 inline-flex items-center gap-1.5 px-0 py-1 text-[13px] text-slate-600 transition hover:text-slate-900"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {returnTo ? 'Tillbaka till offert' : 'Kundregister'}
        </button>
        <h1 className="m-0 text-[28px] font-bold leading-tight tracking-tight text-slate-900">Registrera kund</h1>
      </div>

      {/* ── Body: form + sidebar ── */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">

        {/* Left: form sections */}
        <div className="grid min-w-0 gap-5">

          {/* Vem är kunden? — sökningen är startpunkten för företag */}
          <section className={cn(crm.cardInner, 'p-5 sm:p-7')}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="m-0 text-xl font-semibold text-slate-900">Vem är kunden?</h2>
                <p className="m-0 mt-1 text-sm text-slate-600">
                  {isB2B
                    ? 'Börja med att söka upp företaget – resten fylls i automatiskt.'
                    : 'Fyll i kundens namn och kontaktuppgifter.'}
                </p>
              </div>
              <div role="group" aria-label="Kundtyp" className={cn(crm.sunken, 'inline-flex gap-1 rounded-xl p-1')}>
                <button type="button" aria-pressed={isB2B} onClick={() => setCustomerType('business')} className={segment(isB2B)}>
                  Företag
                </button>
                <button type="button" aria-pressed={!isB2B} onClick={() => setCustomerType('private')} className={segment(!isB2B)}>
                  Privatperson
                </button>
              </div>
            </div>

            {/* Lookup is company-only: tic.io person search requires the Enterprise+
                tier, which we don't have, so it's hidden for private customers. */}
            {showLookup ? (
              <div>
                <TicLookupInput mode="company" onSelect={applyLookup} placeholder="Sök på företagsnamn eller org.nr" />
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-600">
                  <span>Namn, org.nr, momsnummer, adress och telefon fylls i åt dig.</span>
                  <button
                    type="button"
                    onClick={() => setManual(true)}
                    className={linkButton}
                  >
                    Fyll i manuellt istället
                  </button>
                </div>
              </div>
            ) : null}

            {isB2B && picked ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[#d3e1d6] bg-[color:var(--ek-accent-soft)] px-5 py-4">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color:var(--ek-green)] text-white">
                    <CheckIcon size={22} />
                  </span>
                  <div className="min-w-0 flex-[1_1_240px]">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-[17px] font-semibold text-slate-900">
                      {picked.company_name || picked.label}
                      {picked.inactive ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">Avregistrerad</span>
                      ) : null}
                    </p>
                    {pickedMeta ? <p className="m-0 text-[13px] text-slate-600">{pickedMeta}</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={clearPick}
                    className={linkButton}
                  >
                    Byt företag
                  </button>
                </div>
                {pickedOrgDiffers ? (
                  <p role="alert" className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">
                    Organisationsnumret nedan ({draft.organization_number}) är ett annat än det valda företagets. Det
                    är numret nedan som sparas — rätta det om det är fel.
                  </p>
                ) : null}
                <CreditPreview
                  report={creditReport}
                  fetching={fetchingCredit}
                  canFetch={Boolean(draft.organization_number.trim())}
                  onFetch={fetchCreditPreview}
                />
              </div>
            ) : null}

            {showManualNote ? (
              <div className={cn(crm.sunken, 'flex flex-wrap items-center justify-between gap-3 rounded-xl border-dashed border-[#c4cec2] px-4 py-3.5')}>
                <span className="text-sm text-slate-700">Manuell registrering – fyll i uppgifterna nedan.</span>
                <button
                  type="button"
                  onClick={() => setManual(false)}
                  className={linkButton}
                >
                  Sök företag istället
                </button>
              </div>
            ) : null}

            {!isB2B ? (
              <p className={cn(crm.sunken, 'm-0 rounded-xl px-4 py-3.5 text-sm text-slate-700')}>
                Privatkunder registreras manuellt. Personnummer krävs för ROT-avdrag.
              </p>
            ) : null}
          </section>

          {/* Företags-/personuppgifter + kontakt, sida vid sida */}
          <div className="grid gap-5 md:grid-cols-2">
            {isB2B ? (
              <Card title="Företagsuppgifter">
                <div className="grid gap-4">
                  <div>
                    <FieldLabel htmlFor="nc-company" tic={tic('company_name')}>Företagsnamn *</FieldLabel>
                    <Input id="nc-company" value={draft.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="AB Exempelbolaget" />
                  </div>
                  <div>
                    <FieldLabel htmlFor="nc-org" tic={tic('organization_number')}>Organisationsnummer</FieldLabel>
                    <Input id="nc-org" value={draft.organization_number} onChange={(e) => setOrganizationNumber(e.target.value)} placeholder="556000-0000" />
                    {draft.organization_number.replace(/\D/g, '').length === 10 && !isValidSwedishOrgNumber(draft.organization_number) ? (
                      <p className="m-0 mt-1 text-xs text-amber-700">Ogiltigt organisationsnummer – kontrollsiffran stämmer inte.</p>
                    ) : null}
                  </div>
                  {/* Förifyllt ur org.numret men SKRIVBART med flit: alla bolag är inte momsregistrerade
                      (tomt ska gå att spara), och en koncernregistrering kan sluta på 02, 03 … Se
                      deriveVatNumberForWrite i lib/domains/crm/orgNumber.ts. */}
                  <div>
                    <FieldLabel htmlFor="nc-vat" hint="fylls i från org.nr" tic={tic('vat_number')}>Momsreg.nummer</FieldLabel>
                    <Input id="nc-vat" value={draft.vat_number} onChange={(e) => set('vat_number', e.target.value)} placeholder="SE556000000001" />
                  </div>
                  {/* Utan vald träff bor kreditupplysningen här, intill org.numret den hämtas på. Med
                      träff står den i bekräftelsekortet ovan. */}
                  {!picked ? (
                    <CreditPreview
                      report={creditReport}
                      fetching={fetchingCredit}
                      canFetch={Boolean(draft.organization_number.trim())}
                      onFetch={fetchCreditPreview}
                    />
                  ) : null}
                </div>
              </Card>
            ) : (
              <Card title="Personuppgifter">
                <div className="grid gap-4">
                  <div>
                    <FieldLabel htmlFor="nc-first">Förnamn *</FieldLabel>
                    <Input id="nc-first" value={draft.first_name} onChange={(e) => set('first_name', e.target.value)} placeholder="Anna" />
                  </div>
                  <div>
                    <FieldLabel htmlFor="nc-last">Efternamn *</FieldLabel>
                    <Input id="nc-last" value={draft.last_name} onChange={(e) => set('last_name', e.target.value)} placeholder="Andersson" />
                  </div>
                  <div>
                    <FieldLabel htmlFor="nc-pnr">Personnummer</FieldLabel>
                    <Input
                      id="nc-pnr"
                      value={draft.personal_number}
                      onChange={(e) => set('personal_number', formatPersonalNumber(e.target.value))}
                      placeholder="ÅÅÅÅMMDD-XXXX"
                      inputMode="numeric"
                      aria-invalid={!!draft.personal_number.trim() && !isValidPersonalNumber(draft.personal_number)}
                    />
                    {draft.personal_number.trim() && !isValidPersonalNumber(draft.personal_number) ? (
                      <p className="m-0 mt-1 text-[11px] leading-snug text-rose-600">{PERSONAL_NUMBER_ERROR}</p>
                    ) : (
                      <p className="m-0 mt-1 text-[11px] leading-snug text-slate-500">{PERSONAL_NUMBER_OPTIONAL_HINT}</p>
                    )}
                  </div>
                </div>
              </Card>
            )}

            <Card title="Kontaktuppgifter">
              <div className="grid gap-4">
                <div>
                  <FieldLabel htmlFor="nc-email" tic={tic('email')}>E-post</FieldLabel>
                  <Input id="nc-email" value={draft.email} onChange={(e) => set('email', e.target.value)} placeholder="info@foretaget.se" type="email" />
                </div>
                <div>
                  <FieldLabel htmlFor="nc-phone" tic={tic('phone')}>Telefon</FieldLabel>
                  <Input id="nc-phone" value={draft.phone} onChange={(e) => set('phone', e.target.value)} placeholder="08-123 456 78" />
                </div>
                <div>
                  <FieldLabel htmlFor="nc-mobile">Mobil</FieldLabel>
                  <Input id="nc-mobile" value={draft.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="070-123 456 78" />
                </div>
              </div>
            </Card>
          </div>

          {/* Adress */}
          <Card title="Adress">
            <div className="grid gap-4">
              <div>
                <FieldLabel htmlFor="nc-street" tic={tic('visit_street')}>Besöksadress</FieldLabel>
                <Input id="nc-street" value={draft.visit_street} onChange={(e) => set('visit_street', e.target.value)} placeholder="Gatuadress" />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4">
                <div>
                  <FieldLabel htmlFor="nc-zip" tic={tic('visit_postal_code')}>Postnr</FieldLabel>
                  <Input id="nc-zip" value={draft.visit_postal_code} onChange={(e) => set('visit_postal_code', e.target.value)} placeholder="123 45" />
                </div>
                <div>
                  <FieldLabel htmlFor="nc-city" tic={tic('visit_city')}>Ort</FieldLabel>
                  <Input id="nc-city" value={draft.visit_city} onChange={(e) => set('visit_city', e.target.value)} placeholder="Ort" />
                </div>
              </div>
              <ZipWarning postalCode={draft.visit_postal_code} city={draft.visit_city} />
              <div className="flex flex-wrap gap-x-8 border-t border-[#edf1ec] pt-1">
                <CheckRow checked={deliverySameAsVisit} onChange={setDeliverySameAsVisit}>Leverans till samma adress</CheckRow>
                <CheckRow checked={invoiceSameAsVisit} onChange={toggleInvoiceSame}>Faktura till samma adress</CheckRow>
              </div>
              {!deliverySameAsVisit ? (
                <ExtraAddress
                  title="Leveransadress" idPrefix="nc-delivery"
                  street={draft.delivery_street} postalCode={draft.delivery_postal_code} city={draft.delivery_city}
                  onStreet={(v) => set('delivery_street', v)} onPostal={(v) => set('delivery_postal_code', v)} onCity={(v) => set('delivery_city', v)}
                />
              ) : null}
              {!invoiceSameAsVisit ? (
                <ExtraAddress
                  title="Fakturaadress" idPrefix="nc-invoice"
                  street={invoiceStreet} postalCode={invoicePostal} city={invoiceCity}
                  onStreet={(v) => set('invoice_street', v)} onPostal={(v) => set('invoice_postal_code', v)} onCity={(v) => set('invoice_city', v)}
                />
              ) : null}
            </div>
          </Card>

          {/* Fakturering */}
          <Card title="Fakturering">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="nc-terms">Betalningsvillkor</FieldLabel>
                <FortnoxCodeSelect
                  id="nc-terms"
                  value={draft.payment_terms}
                  onChange={(v) => set('payment_terms', v)}
                  endpoint="/api/fortnox/terms-of-payment"
                  emptyLabel="Standard (Fortnox)"
                  placeholder="30 dagar"
                />
              </div>
              <div>
                <FieldLabel htmlFor="nc-pricelist">Prislista</FieldLabel>
                <FortnoxCodeSelect
                  id="nc-pricelist"
                  value={draft.price_list}
                  onChange={(v) => set('price_list', v)}
                  endpoint="/api/fortnox/price-lists"
                  emptyLabel="Standard (Fortnox)"
                  placeholder="A"
                />
              </div>
              <div>
                <FieldLabel htmlFor="nc-discount">Rabatt (%)</FieldLabel>
                <Input id="nc-discount" value={draft.discount} onChange={(e) => set('discount', e.target.value)} placeholder="Ingen rabatt" type="number" min="0" max="100" step="0.01" />
              </div>
              <div>
                <FieldLabel htmlFor="nc-invoice-email">Faktura-e-post</FieldLabel>
                <Input
                  id="nc-invoice-email"
                  value={draft.invoice_email}
                  onChange={(e) => set('invoice_email', e.target.value)}
                  placeholder={draft.email.trim() || 'Samma som e-post ovan'}
                  type="email"
                />
              </div>
            </div>
            {isB2B ? (
              <CheckRow className="mt-2" checked={draft.reverse_vat} onChange={(v) => set('reverse_vat', v)}>
                Omvänd skattskyldighet (bygg)
              </CheckRow>
            ) : null}
          </Card>

          {/* Övrig information (företag) – hopfälld, fylls mest av uppslaget */}
          {isB2B ? (
            <CollapsibleCardSection
              title="Övrig information"
              hint="ekonomi, bransch & risk – valfritt"
              className={cardPadding}
              titleClassName="text-base font-semibold text-slate-900"
            >
              <div className="grid gap-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <FieldLabel htmlFor="nc-revenue" tic={tic('annual_revenue')}>Omsättning (SEK)</FieldLabel>
                    <Input id="nc-revenue" value={draft.annual_revenue} onChange={(e) => set('annual_revenue', e.target.value)} placeholder="–" type="number" min="0" step="1" />
                  </div>
                  <div>
                    <FieldLabel htmlFor="nc-employees" tic={tic('number_of_employees')}>Antal anställda</FieldLabel>
                    <Input id="nc-employees" value={draft.number_of_employees} onChange={(e) => set('number_of_employees', e.target.value)} placeholder="–" type="number" min="0" step="1" />
                  </div>
                  <div>
                    <FieldLabel htmlFor="nc-sni-name" tic={tic('sni_name')}>Bransch</FieldLabel>
                    <Input id="nc-sni-name" value={draft.sni_name} onChange={(e) => set('sni_name', e.target.value)} placeholder="–" />
                  </div>
                  <div>
                    <FieldLabel htmlFor="nc-legal" tic={tic('legal_entity_type')}>Bolagsform</FieldLabel>
                    <Input id="nc-legal" value={draft.legal_entity_type} onChange={(e) => set('legal_entity_type', e.target.value)} placeholder="–" />
                  </div>
                  <div>
                    <FieldLabel htmlFor="nc-sni-code" tic={tic('sni_code')}>SNI-kod</FieldLabel>
                    <Input id="nc-sni-code" value={draft.sni_code} onChange={(e) => set('sni_code', e.target.value)} placeholder="–" />
                  </div>
                </div>

                <div>
                  <p className={cn(crm.groupTitle, 'm-0 mb-3')}>Ekonomi &amp; nyckeltal</p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <FieldLabel htmlFor="nc-op-profit" tic={tic('operating_profit')}>Rörelseresultat (SEK)</FieldLabel>
                      <Input id="nc-op-profit" value={draft.operating_profit} onChange={(e) => set('operating_profit', e.target.value)} placeholder="–" type="number" step="1" />
                    </div>
                    <div>
                      <FieldLabel htmlFor="nc-fin-profit" tic={tic('profit_after_financial_items')}>Resultat e. fin. poster (SEK)</FieldLabel>
                      <Input id="nc-fin-profit" value={draft.profit_after_financial_items} onChange={(e) => set('profit_after_financial_items', e.target.value)} placeholder="–" type="number" step="1" />
                    </div>
                    <div>
                      <FieldLabel htmlFor="nc-assets" tic={tic('total_assets')}>Totala tillgångar (SEK)</FieldLabel>
                      <Input id="nc-assets" value={draft.total_assets} onChange={(e) => set('total_assets', e.target.value)} placeholder="–" type="number" step="1" />
                    </div>
                    <div>
                      <FieldLabel htmlFor="nc-margin" tic={tic('operating_margin')}>Rörelsemarginal (%)</FieldLabel>
                      <Input id="nc-margin" value={draft.operating_margin} onChange={(e) => set('operating_margin', e.target.value)} placeholder="–" type="number" step="0.1" />
                    </div>
                    <div>
                      <FieldLabel htmlFor="nc-equity" tic={tic('equity_ratio')}>Soliditet (%)</FieldLabel>
                      <Input id="nc-equity" value={draft.equity_ratio} onChange={(e) => set('equity_ratio', e.target.value)} placeholder="–" type="number" step="0.1" />
                    </div>
                    <div>
                      <FieldLabel htmlFor="nc-fin-year" tic={tic('financial_year')}>Räkenskapsår</FieldLabel>
                      <Input id="nc-fin-year" value={draft.financial_year} onChange={(e) => set('financial_year', e.target.value)} placeholder="–" type="number" step="1" />
                    </div>
                  </div>
                </div>

                {/* Riskindikatorer (read-only, från uppslaget) */}
                <div>
                  <p className={cn(crm.groupTitle, 'm-0 mb-2')}>Riskindikatorer</p>
                  {draft.risk_indicators.length > 0 ? (
                    <ul className="m-0 grid list-none gap-1.5 p-0">
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
                    <p className="m-0 text-xs text-slate-500">Inga riskindikatorer hämtade.</p>
                  )}
                </div>
              </div>
            </CollapsibleCardSection>
          ) : null}

        </div>

        {/* Right: sidebar — kort nog att följa med vid scroll (se lg:sticky-fällan i
            CustomerDetailClient: en sticky kolumn som är högre än fönstret fastnar aldrig). */}
        <aside className="grid gap-4 lg:sticky lg:top-6">
          <div className={cn(crm.cardInner, 'p-5')}>
            <p className={cn(crm.sectionTitle, 'm-0 mb-3.5')}>Innan du sparar</p>
            <ul className="m-0 mb-5 grid list-none gap-3 p-0">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-2.5 text-sm">
                  {item.done ? (
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--ek-green)] text-white">
                      <CheckIcon />
                    </span>
                  ) : (
                    <span className="inline-block h-5 w-5 shrink-0 rounded-full border-2 border-[#aab5ac]" aria-hidden />
                  )}
                  <span className={item.done ? 'text-slate-900' : 'text-slate-600'}>
                    {item.label}
                    <span className="sr-only">{item.done ? ' – klart' : ' – saknas'}</span>
                  </span>
                </li>
              ))}
            </ul>

            <FieldLabel htmlFor="nc-owner">Kundansvarig</FieldLabel>
            <Select id="nc-owner" value={draft.account_manager_id} onChange={(e) => set('account_manager_id', e.target.value)}>
              <option value="">— Ingen —</option>
              {/* Förvalet finns från första renderingen, katalogen kommer efter. Utan ett eget
                  alternativ hade rullistan visat "Ingen" medan formuläret bar ett id. */}
              {draft.account_manager_id && !sellers.some((s) => s.id === draft.account_manager_id) ? (
                <option value={draft.account_manager_id}>
                  {draft.account_manager_id === defaultAccountManager?.id ? defaultAccountManager.name : 'Okänd säljare'}
                </option>
              ) : null}
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name || s.id}</option>
              ))}
            </Select>
            <p className="m-0 mt-1.5 text-xs text-slate-500">Säljaren som äger kundrelationen. Kan sättas senare.</p>

            {fortnoxConnected ? (
              <div className="mt-4 border-t border-[#edf1ec] pt-4">
                <label className="flex w-auto cursor-pointer select-none items-start gap-2.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={createInFortnox}
                    onChange={(e) => setCreateInFortnox(e.target.checked)}
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border-slate-300 accent-[color:var(--ek-green)]"
                  />
                  <span>
                    <span className="block font-semibold text-slate-900">Skapa även i Fortnox</span>
                    <span className="mt-0.5 block text-xs text-slate-500">Får ett kundnummer direkt.</span>
                  </span>
                </label>
              </div>
            ) : null}

            <div className="mt-5 grid gap-2.5">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className={cn(crm.saveButton, 'h-12 text-[15px] active:scale-[0.98]')}
              >
                {saving ? 'Sparar…' : 'Skapa kund'}
              </button>
              <button
                type="button"
                onClick={() => router.push(cancelTo)}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#dce4d8] bg-white px-4 py-0 text-sm font-semibold text-slate-700 transition hover:border-[#c8d4c3] hover:text-slate-900"
              >
                Avbryt
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
