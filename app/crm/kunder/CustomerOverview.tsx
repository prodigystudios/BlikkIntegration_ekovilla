"use client";

import { crm, quoteStatusMeta, type QuoteStatus } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { documentRef, formatCurrency } from '@/app/crm/lib/format';
import { netAmount } from '@/lib/domains/crm/pricing';
import { CrmTable, CustomerCell, type CrmTableColumn } from '@/app/crm/components/CrmTable';
import { riskTypeLabel } from '@/lib/domains/tic/mappers';
import { PhoneLink, EmailLink } from '@/app/crm/components/ContactLinks';
import {
  deliveryAddressDisplay,
  formatPercent,
  formatSek,
  hasAddress,
  hasCompanyInfo,
  invoiceAddressDisplay,
  addressLines,
  quotePlace,
  type Customer,
  type CustomerEditSection,
  type RelatedQuote,
} from './customerCard';
import { AddressValue, cardLinkButton, Chip, DefinitionList, EmptyState, Field, InfoCard, Muted } from './CustomerCardUi';

// Kundkortets Översikt-flik: kunden i fyra kort, företagsinformationen från tic.io och de senaste
// offerterna. Ren visning — all hämtning och sparning bor i CustomerDetailClient.

function EditLink({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cardLinkButton}>Ändra</button>;
}

export default function CustomerOverview({
  customer, quotes, quotesLoading, newQuoteHref, onEdit, onShowQuotes, enriching, onFetchCompanyData,
}: {
  customer: Customer;
  quotes: RelatedQuote[];
  quotesLoading: boolean;
  /** null = ingen rätt att skapa offerter. */
  newQuoteHref: string | null;
  onEdit: (section: CustomerEditSection) => void;
  onShowQuotes: () => void;
  enriching: boolean;
  onFetchCompanyData: () => void;
}) {
  const isB2B = customer.customer_type === 'business';
  const companyInfo = hasCompanyInfo(customer);
  const keyFigures = [
    { label: 'Omsättning', value: formatSek(customer.annual_revenue) },
    { label: 'Antal anställda', value: customer.number_of_employees != null ? String(customer.number_of_employees) : null },
    { label: 'Rörelseresultat', value: formatSek(customer.operating_profit) },
    { label: 'Resultat e. fin. poster', value: formatSek(customer.profit_after_financial_items) },
    { label: 'Totala tillgångar', value: formatSek(customer.total_assets) },
    { label: 'Rörelsemarginal', value: formatPercent(customer.operating_margin) },
    { label: 'Soliditet', value: formatPercent(customer.equity_ratio) },
  ].filter((f): f is { label: string; value: string } => f.value != null);
  // Listan kommer sorterad nyast först (created_desc, se CustomerDetailClient).
  const recentQuotes = quotes.slice(0, 2);
  const quoteHref = (q: RelatedQuote) => `/crm/offerter?quote_id=${q.id}`;
  const recentQuoteColumns: Array<CrmTableColumn<RelatedQuote>> = [
    { header: 'Nr', className: 'hidden w-[7rem] tabular-nums text-slate-500 sm:table-cell', cell: (q) => documentRef(q.fortnox_offer_number, q.quote_number) },
    { header: 'Benämning', cell: (q) => <CustomerCell href={quoteHref(q)} customer={q.project_name || 'Offert utan namn'} project={quotePlace(q)} /> },
    {
      header: 'Status',
      className: 'w-[6.75rem] pr-0 text-right sm:w-[7.5rem] sm:pr-4 sm:text-left',
      cell: (q) => {
        const meta = quoteStatusMeta[q.status as QuoteStatus];
        return <span className={cn(crm.badge, meta?.className ?? 'border-slate-200 bg-slate-50 text-slate-700')}>{meta?.label ?? q.status}</span>;
      },
    },
    { header: 'Ex moms', className: 'hidden w-[7.5rem] text-right tabular-nums sm:table-cell', cell: (q) => formatCurrency(netAmount(q), q.currency_code) },
  ];
  // `min(320px,100%)`: på en telefon är kolumnen smalare än 320 px, och utan min() hade griden
  // tvingat fram vågrät scroll.
  const pairGrid = 'grid gap-5 grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))]';

  return (
    // 🧨 `grid-cols-1` = minmax(0,1fr). Utan mall växer rutnätets automatiska kolumn till innehållets
    // bredd, och på en telefon stack korten ut 200 px till höger om panelen (uppmätt 564 px på 358).
    <div className="grid grid-cols-1 gap-5">
      <div className={pairGrid}>
        {isB2B ? (
          <InfoCard title="Företagsuppgifter" action={<EditLink onClick={() => onEdit('grundinfo')} />}>
            <DefinitionList>
              <Field label="Företagsnamn">{customer.company_name || <Muted>Ej angivet</Muted>}</Field>
              <Field label="Org.nr">{customer.organization_number || <Muted>Ej angivet</Muted>}</Field>
              <Field label="Bolagsform">{customer.legal_entity_type || <Muted>Ej angivet</Muted>}</Field>
              <Field label="Bransch">
                {customer.sni_name || customer.sni_code
                  ? [
                    customer.sni_name,
                    customer.sni_code && !customer.sni_name?.includes(customer.sni_code) ? `SNI ${customer.sni_code}` : null,
                  ].filter(Boolean).join(' · ')
                  : <Muted>Ej angivet</Muted>}
              </Field>
            </DefinitionList>
          </InfoCard>
        ) : (
          <InfoCard title="Personuppgifter" action={<EditLink onClick={() => onEdit('grundinfo')} />}>
            <DefinitionList>
              <Field label="Namn">
                {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || <Muted>Ej angivet</Muted>}
              </Field>
              <Field label="Personnummer">{customer.personal_number || <Muted>Ej angivet</Muted>}</Field>
            </DefinitionList>
          </InfoCard>
        )}

        <InfoCard title="Kontaktuppgifter" action={<EditLink onClick={() => onEdit('kontakt')} />}>
          <DefinitionList>
            <Field label="E-post">{customer.email ? <EmailLink value={customer.email} /> : <Muted>Ej angivet</Muted>}</Field>
            <Field label="Telefon">{customer.phone ? <PhoneLink value={customer.phone} /> : <Muted>Ej angivet</Muted>}</Field>
            <Field label="Mobil">{customer.mobile ? <PhoneLink value={customer.mobile} /> : <Muted>Ej angivet</Muted>}</Field>
          </DefinitionList>
        </InfoCard>
      </div>

      <div className={pairGrid}>
        <InfoCard title="Adresser" action={<EditLink onClick={() => onEdit('adresser')} />}>
          <DefinitionList>
            <Field label="Besöksadress">
              <AddressValue
                display={hasAddress(customer.visit_address)
                  ? { kind: 'address', lines: addressLines(customer.visit_address) }
                  : { kind: 'empty' }}
              />
            </Field>
            <Field label="Leveransadress"><AddressValue display={deliveryAddressDisplay(customer)} /></Field>
            <Field label="Fakturaadress"><AddressValue display={invoiceAddressDisplay(customer)} /></Field>
            <Field label="Faktura-e-post">
              {customer.invoice_email ? <EmailLink value={customer.invoice_email} /> : <Muted>Ej angivet</Muted>}
            </Field>
          </DefinitionList>
        </InfoCard>

        <InfoCard title="Fakturering" action={<EditLink onClick={() => onEdit('fakturering')} />}>
          <DefinitionList>
            {/* Tomt = Fortnox standard — samma ord som formulärens väljare använder för det tomma valet. */}
            <Field label="Betalningsvillkor">{customer.payment_terms || <Muted>Standard (Fortnox)</Muted>}</Field>
            <Field label="Prislista">{customer.price_list || <Muted>Standard (Fortnox)</Muted>}</Field>
            {isB2B ? <Field label="Momsreg.nr">{customer.vat_number || <Muted>Ej angivet</Muted>}</Field> : null}
            <Field label="Rabatt">{customer.discount ? `${customer.discount} %` : <Muted>Ingen</Muted>}</Field>
            {isB2B ? (
              <Field label="Omvänd moms">
                {customer.reverse_vat
                  ? <Chip className="h-[22px] bg-[#fbf1dc] text-[#7a4d06]">Omvänd skattskyldighet</Chip>
                  : <Muted>Nej</Muted>}
              </Field>
            ) : null}
          </DefinitionList>
        </InfoCard>
      </div>

      {/* Företagsinformation (företag, från tic.io). Mest för Fortnox-importerade kunder som aldrig
          gick genom registreringens uppslag. Hämtningen fyller bara tomma fält. */}
      {isB2B ? (
        <InfoCard
          title="Företagsinformation"
          action={
            <button
              type="button"
              onClick={onFetchCompanyData}
              disabled={enriching || !customer.organization_number}
              title={!customer.organization_number ? 'Kräver organisationsnummer' : undefined}
              className={cardLinkButton}
            >
              {enriching ? 'Hämtar…' : companyInfo ? 'Uppdatera från tic.io' : 'Hämta från tic.io'}
            </button>
          }
        >
          {!companyInfo ? (
            <p className="m-0 text-sm text-slate-600">
              {customer.organization_number
                ? 'Hämta bransch, bolagsform, ekonomi och risk från tic.io.'
                : 'Lägg till ett organisationsnummer för att kunna hämta företagsdata.'}
            </p>
          ) : (
            <div className="grid gap-5">
              {keyFigures.length > 0 ? (
                <div>
                  {customer.financial_year != null ? (
                    <p className="m-0 mb-3 text-xs text-slate-600">Räkenskapsår {customer.financial_year}</p>
                  ) : null}
                  <div className="grid gap-x-5 gap-y-3 grid-cols-[repeat(auto-fill,minmax(min(170px,100%),1fr))]">
                    {keyFigures.map((f) => (
                      <div key={f.label}>
                        <p className="m-0 text-[13px] text-slate-600">{f.label}</p>
                        <p className="m-0 mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{f.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {customer.risk_indicators && customer.risk_indicators.length > 0 ? (
                <div className="grid gap-2">
                  <p className={cn(crm.groupTitle, 'm-0')}>Riskindikatorer</p>
                  <ul className="m-0 grid list-none gap-1.5 p-0">
                    {customer.risk_indicators.map((r, i) => (
                      <li key={`${r.type}-${i}`} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <span className="mt-0.5 shrink-0" aria-hidden>⚠</span>
                        <span>
                          <span className="font-semibold">{riskTypeLabel(r.type)}</span>
                          {r.notes ? <span className="text-amber-700"> – {r.notes}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {keyFigures.length === 0 && !(customer.risk_indicators && customer.risk_indicators.length > 0) ? (
                <p className="m-0 text-sm text-slate-600">Inga nyckeltal hämtade ännu.</p>
              ) : null}
            </div>
          )}
        </InfoCard>
      ) : null}

      <InfoCard
        title="Senaste offerter"
        action={quotes.length > 0 ? <button type="button" onClick={onShowQuotes} className={cardLinkButton}>Visa alla</button> : null}
      >
        {quotesLoading ? (
          <div className="h-16 animate-pulse rounded-xl bg-[#e6ede3]" />
        ) : recentQuotes.length === 0 ? (
          <EmptyState
            title="Inga offerter ännu"
            action={newQuoteHref ? (
              <a href={newQuoteHref} className={cn(crm.ghostButton, 'h-10 px-4 no-underline')}>Skapa första offerten</a>
            ) : null}
          >
            När du skapar en offert för kunden visas den här.
          </EmptyState>
        ) : (
          <CrmTable label="Senaste offerter" size="regular" columns={recentQuoteColumns} rows={recentQuotes} rowHref={quoteHref} />
        )}
      </InfoCard>
    </div>
  );
}
