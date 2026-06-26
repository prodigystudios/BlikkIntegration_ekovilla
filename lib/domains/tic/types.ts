// Types for the tic.io (LENS v2) company/person lookup integration.
// Kept free of any runtime/server-only imports so the normalized result type can be
// imported by the client lookup component (type-only).

// ── Raw tic.io documents (Typesense search hits) ──
// Modelled loosely/defensively: tic.io returns a wide schema and we only read a few
// fields, so every field is optional and the mappers tolerate what's missing.

export type TicRawCompany = {
  id?: string;
  companyId?: number;
  registrationNumber?: string;
  names?: Array<Record<string, unknown>>;
  legalEntityType?: string;
  isCeased?: boolean;
  activityStatus?: string;
  mostRecentRegisteredAddress?: {
    // tic.io names the street line `streetAddress` (not `street`); the house number is
    // already included in it. Postal/city match our field names.
    streetAddress?: string;
    postalCode?: string;
    city?: string;
  };
  phoneNumbers?: Array<{ e164PhoneNumber?: string; phoneNumber?: string }>;
  emailAddresses?: Array<{ emailAddress?: string }>;
  sniCodes?: Array<Record<string, unknown>>;
  intelligence?: Array<Record<string, unknown>>;
  mostRecentFinancialSummary?: {
    periodEnd?: number;
    rs_NetSalesK?: number;
    rs_OperatingProfitOrLossK?: number;
    rs_ProfitAfterFinancialItemsK?: number;
    bs_TotalAssetsK?: number;
    fn_NumberOfEmployees?: number;
    km_OperatingMargin?: number;
    km_EquityAssetsRatio?: number;
  };
};

export type TicRawPerson = {
  id?: string;
  personId?: number;
  personalIdentityNumber?: string;
  givenName?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  birthday?: string;
  isProtected?: boolean;
  // SPAR population-register facts. tic.io exposes the Swedish address as flat keys,
  // e.g. spar.folkbokforingsadress_SvenskAdress_Utdelningsadress1 — see mappers.ts.
  spar?: Record<string, unknown>;
};

// Typesense response envelope.
export type TicSearchResponse<T> = {
  found?: number;
  hits?: Array<{ document?: T }>;
};

// ── Credit report: GET /companies/{id}/risks (Pro tier, cached 4h by tic.io) ──
// Raw shape verified live against Aktiebolaget Volvo. Modelled defensively — the
// debtorSummary sub-objects are only present when the company has the relevant records.
export type TicRawCompanyRisk = {
  creditScore?: number; // 0–100
  riskForecast?: number; // probability of default, %
  riskForecastClass?: number; // 1–5 (5 = lowest risk)
  riskForecastDescription?: string; // pre-formatted Swedish text
  debtorSummary?: {
    recordOfPaymentApplications?: TicRawDebtorRecord; // betalningsförelägganden
    recordOfNonPayment?: TicRawDebtorRecord; // betalningsanmärkningar
    debtBalance?: { totalAmountInSEK?: number; lastUpdatedDate?: number };
  };
};

type TicRawDebtorRecord = {
  numberOfCases?: number;
  totalAmountInSEK?: number;
  lastCaseDate?: number; // Unix epoch
};

// ── Normalized credit report stored as a snapshot on the customer (credit_report jsonb) ──
export type TicCreditDebtorRecord = {
  number_of_cases: number;
  total_amount_sek: number;
  last_case_date: string | null; // ISO date
};

export type TicCreditReport = {
  credit_score: number | null; // 0–100
  risk_forecast: number | null; // probability of default, %
  risk_class: number | null; // 1–5 (5 = lowest risk)
  risk_description: string | null; // Swedish, e.g. "Mycket låg risk (riskklass 5)"
  payment_applications: TicCreditDebtorRecord | null; // betalningsförelägganden
  non_payment: TicCreditDebtorRecord | null; // betalningsanmärkningar
  debt_balance_sek: number | null; // skuldsaldo hos Kronofogden
};

// ── Normalized result handed to the client ──
// One shape for both companies and persons; only the relevant fields are populated.
export type TicLookupAddress = {
  street: string;
  postal_code: string;
  city: string;
};

// A single risk/intelligence flag from tic.io (e.g. payment remarks, warning list).
export type TicRiskIndicator = {
  type: string; // raw companyIntelligenceType enum (use riskTypeLabel for display)
  subtype?: string;
  notes?: string;
  score?: number | null;
};

export type TicLookupResult = {
  kind: 'company' | 'person';
  label: string; // primary display name in the dropdown
  sublabel?: string; // org/personal number + city
  company_name?: string;
  organization_number?: string;
  first_name?: string;
  last_name?: string;
  personal_number?: string;
  email?: string;
  phone?: string;
  address?: TicLookupAddress;
  annual_revenue?: number | null; // SEK (tic.io reports thousands → ×1000)
  number_of_employees?: number | null;
  inactive?: boolean; // ceased company / protected identity → flagged in the UI
  // ── Extra company info (shown in the collapsible "Övrig information" section) ──
  legal_entity_type?: string; // bolagsform, e.g. "Aktiebolag"
  sni_code?: string; // SNI industry code
  sni_name?: string; // SNI industry name
  operating_profit?: number | null; // rörelseresultat, SEK
  profit_after_financial_items?: number | null; // resultat efter fin. poster, SEK
  total_assets?: number | null; // totala tillgångar, SEK
  operating_margin?: number | null; // rörelsemarginal, %
  equity_ratio?: number | null; // soliditet, %
  financial_year?: number | null; // räkenskapsår (year of periodEnd)
  risk_indicators?: TicRiskIndicator[]; // tic.io intelligence flags
};
