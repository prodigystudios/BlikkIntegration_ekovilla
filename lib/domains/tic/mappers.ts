// Pure, side-effect-free mapping from raw tic.io documents → the normalized
// TicLookupResult the UI consumes. This is the high-risk surface (external field
// names + money conversion) so it lives in its own module and is unit-tested.

import type {
  TicRawCompany,
  TicRawPerson,
  TicLookupResult,
  TicLookupAddress,
  TicRiskIndicator,
  TicRawCompanyRisk,
  TicCreditReport,
  TicCreditDebtorRecord,
} from './types';

// First non-empty trimmed string from the candidates, else undefined.
function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// tic.io reports money in thousands SEK (the *K fields) → multiply up to plain SEK.
function thousandsToSek(v: unknown): number | null {
  const n = finiteNumber(v);
  return n != null ? Math.round(n * 1000) : null;
}

// Ratios/margins come as doubles (typically a percentage) — keep one decimal.
function ratio(v: unknown): number | null {
  const n = finiteNumber(v);
  return n != null ? Math.round(n * 10) / 10 : null;
}

// tic.io timestamps are Unix epoch (int64). Some fields are seconds, some ms — detect
// by magnitude. Returns the calendar year, used for the financial period (räkenskapsår).
function unixYear(v: unknown): number | null {
  const n = finiteNumber(v);
  if (n == null || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const year = new Date(ms).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

// Pick the highest-priority SNI industry code/name, preferring the newer 2025 register.
function pickSni(sniCodes?: Array<Record<string, unknown>>): { code?: string; name?: string } {
  if (!Array.isArray(sniCodes) || sniCodes.length === 0) return {};
  const first = sniCodes[0];
  return {
    code: firstString(first.sni_2025Code, first.sni_2007Code),
    name: firstString(first.sni_2025Name, first.sni_2007Name),
  };
}

function mapRiskIndicators(intelligence?: Array<Record<string, unknown>>): TicRiskIndicator[] {
  if (!Array.isArray(intelligence)) return [];
  return intelligence.map((it) => {
    const indicator: TicRiskIndicator = {
      type: firstString(it.companyIntelligenceType) ?? 'unknown',
      score: finiteNumber(it.score),
    };
    const subtype = firstString(it.companyIntelligenceSubType);
    const notes = firstString(it.notes);
    if (subtype) indicator.subtype = subtype;
    if (notes) indicator.notes = notes;
    return indicator;
  });
}

// Raw tic.io intelligence enums → plain Swedish for display. Unknown codes fall back
// to the raw value so nothing silently disappears.
const RISK_TYPE_LABELS: Record<string, string> = {
  createdAsShelfCompany: 'Bildat som lagerbolag',
  suspectedForQuickLiquidation: 'Misstänkt snabbavveckling',
  couldBeFranchise: 'Möjlig franchise',
  affliatedWithArticle: 'Omnämnd i artikel',
  suspectedAddress: 'Misstänkt adress',
  formerChecks: 'Tidigare kontroller',
  presentOnWarningList: 'Finns på varningslista',
  annualReportDiscrepancies: 'Avvikelser i årsredovisning',
  auditorResignation: 'Revisor har avgått',
  registration: 'Registrering',
  registerChanges: 'Registerändringar',
  penaltyFees: 'Förseningsavgifter',
  beneficialOwner: 'Verklig huvudman',
  claims: 'Betalningsanmärkningar',
  forfeit: 'Förverkande',
  mentionedInCourtCase: 'Omnämnd i rättsfall',
  unknown: 'Okänd',
};

export function riskTypeLabel(type: string): string {
  return RISK_TYPE_LABELS[type] ?? type;
}

// Each tic.io `names` entry holds the string in `nameOrIdentifier` and its kind in
// `companyNamingType` (legalName / commonName / tradingName / …). Prefer the registered
// legal name; otherwise fall back to the first usable name of any type.
function pickCompanyName(names?: Array<Record<string, unknown>>): string | undefined {
  if (!Array.isArray(names)) return undefined;
  const legal = names.find((n) => n.companyNamingType === 'legalName');
  if (legal) {
    const s = firstString(legal.nameOrIdentifier);
    if (s) return s;
  }
  for (const n of names) {
    const s = firstString(n.nameOrIdentifier);
    if (s) return s;
  }
  return undefined;
}

function buildAddress(street?: unknown, postal?: unknown, city?: unknown): TicLookupAddress | undefined {
  const s = firstString(street) ?? '';
  const p = firstString(postal) ?? '';
  const c = firstString(city) ?? '';
  if (!s && !p && !c) return undefined;
  return { street: s, postal_code: p, city: c };
}

// Read a flat SPAR key (e.g. "folkbokforingsadress_SvenskAdress_Utdelningsadress1").
function sparString(spar: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!spar || typeof spar !== 'object') return undefined;
  return firstString(spar[key]);
}

export function mapTicCompany(doc: TicRawCompany): TicLookupResult {
  const name = pickCompanyName(doc.names);
  const org = firstString(doc.registrationNumber);
  const addr = doc.mostRecentRegisteredAddress;
  const city = firstString(addr?.city);
  const fin = doc.mostRecentFinancialSummary;
  const employees = finiteNumber(fin?.fn_NumberOfEmployees);
  const sni = pickSni(doc.sniCodes);

  // Only flag as inactive on an explicit ceased/never-active signal — never on
  // "unknown" status, which would wrongly scare the user off a live company.
  const status = firstString(doc.activityStatus);
  const inactive =
    doc.isCeased === true || status === 'isNoLongerActive' || status === 'hasNeverBeenActive';

  return {
    kind: 'company',
    label: name ?? 'Okänt företag',
    sublabel: [org, city].filter(Boolean).join(' · ') || undefined,
    company_name: name,
    organization_number: org,
    email: firstString(doc.emailAddresses?.[0]?.emailAddress),
    phone: firstString(doc.phoneNumbers?.[0]?.e164PhoneNumber, doc.phoneNumbers?.[0]?.phoneNumber),
    address: buildAddress(addr?.streetAddress, addr?.postalCode, addr?.city),
    annual_revenue: thousandsToSek(fin?.rs_NetSalesK),
    number_of_employees: employees != null ? Math.round(employees) : null,
    inactive,
    // ── Extra company info ──
    legal_entity_type: firstString(doc.legalEntityType),
    sni_code: sni.code,
    sni_name: sni.name,
    operating_profit: thousandsToSek(fin?.rs_OperatingProfitOrLossK),
    profit_after_financial_items: thousandsToSek(fin?.rs_ProfitAfterFinancialItemsK),
    total_assets: thousandsToSek(fin?.bs_TotalAssetsK),
    operating_margin: ratio(fin?.km_OperatingMargin),
    equity_ratio: ratio(fin?.km_EquityAssetsRatio),
    financial_year: unixYear(fin?.periodEnd),
    risk_indicators: mapRiskIndicators(doc.intelligence),
  };
}

// tic.io Unix epoch (seconds or ms) → ISO date string (date only), else null.
function unixIsoDate(v: unknown): string | null {
  const n = finiteNumber(v);
  if (n == null || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function mapDebtorRecord(rec: { numberOfCases?: number; totalAmountInSEK?: number; lastCaseDate?: number } | undefined): TicCreditDebtorRecord | null {
  if (!rec) return null;
  const cases = finiteNumber(rec.numberOfCases);
  const amount = finiteNumber(rec.totalAmountInSEK);
  // Only surface a record when there is actually something on it.
  if ((cases == null || cases <= 0) && (amount == null || amount <= 0)) return null;
  return {
    number_of_cases: cases != null ? Math.round(cases) : 0,
    total_amount_sek: amount != null ? Math.round(amount) : 0,
    last_case_date: unixIsoDate(rec.lastCaseDate),
  };
}

// Normalize the raw /risks response into the snapshot we store + render. Pure + tested.
export function mapTicCreditReport(raw: TicRawCompanyRisk): TicCreditReport {
  const summary = raw.debtorSummary;
  const debtBalance = finiteNumber(summary?.debtBalance?.totalAmountInSEK);
  return {
    credit_score: finiteNumber(raw.creditScore),
    risk_forecast: ratio(raw.riskForecast),
    risk_class: finiteNumber(raw.riskForecastClass),
    risk_description: firstString(raw.riskForecastDescription) ?? null,
    payment_applications: mapDebtorRecord(summary?.recordOfPaymentApplications),
    non_payment: mapDebtorRecord(summary?.recordOfNonPayment),
    debt_balance_sek: debtBalance != null && debtBalance > 0 ? Math.round(debtBalance) : null,
  };
}

export function mapTicPerson(doc: TicRawPerson): TicLookupResult {
  const first = firstString(doc.firstName, doc.givenName);
  const last = firstString(doc.lastName);
  const full = firstString(doc.fullName) ?? ([first, last].filter(Boolean).join(' ') || undefined);
  const pnr = firstString(doc.personalIdentityNumber);

  const street = sparString(doc.spar, 'folkbokforingsadress_SvenskAdress_Utdelningsadress1');
  const postal = sparString(doc.spar, 'folkbokforingsadress_SvenskAdress_PostNr');
  const city = sparString(doc.spar, 'folkbokforingsadress_SvenskAdress_Postort');

  return {
    kind: 'person',
    label: full ?? 'Okänd person',
    sublabel: [pnr, city].filter(Boolean).join(' · ') || undefined,
    first_name: first,
    last_name: last,
    personal_number: pnr,
    address: buildAddress(street, postal, city),
    inactive: doc.isProtected === true,
  };
}
