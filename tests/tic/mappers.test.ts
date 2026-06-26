import { describe, it, expect } from 'vitest';
import { mapTicCompany, mapTicPerson, mapTicCreditReport, riskTypeLabel } from '@/lib/domains/tic/mappers';
import type { TicRawCompany, TicRawPerson, TicRawCompanyRisk } from '@/lib/domains/tic/types';

describe('mapTicCompany', () => {
  it('maps a full company document', () => {
    const doc: TicRawCompany = {
      companyId: 1893055,
      registrationNumber: '5560000001',
      // Real tic.io shape: each entry is { nameOrIdentifier, companyNamingType }.
      // Trading name listed first to prove we still prefer the registered legal name.
      names: [
        { nameOrIdentifier: 'Bahnhof', companyNamingType: 'tradingName' },
        { nameOrIdentifier: 'Bahnhof AB', companyNamingType: 'legalName' },
      ],
      legalEntityType: 'Aktiebolag',
      isCeased: false,
      activityStatus: 'isActive',
      // tic.io names the street line `streetAddress` (NOT `street`) — see CompanyAddressGeopoint
      // in the LENS swagger. Reading the wrong key dropped the street on every lookup.
      mostRecentRegisteredAddress: { streetAddress: 'Tunnelgatan 2', postalCode: '111 37', city: 'Stockholm' },
      phoneNumbers: [{ e164PhoneNumber: '+46101234567' }],
      emailAddresses: [{ emailAddress: 'info@bahnhof.se' }],
      mostRecentFinancialSummary: { rs_NetSalesK: 1730000, fn_NumberOfEmployees: 290 },
    };

    const r = mapTicCompany(doc);
    expect(r.kind).toBe('company');
    expect(r.company_name).toBe('Bahnhof AB'); // prefers legalName
    expect(r.organization_number).toBe('5560000001');
    expect(r.address).toEqual({ street: 'Tunnelgatan 2', postal_code: '111 37', city: 'Stockholm' });
    expect(r.phone).toBe('+46101234567');
    expect(r.email).toBe('info@bahnhof.se');
    // tic.io reports net sales in thousands SEK → ×1000
    expect(r.annual_revenue).toBe(1_730_000_000);
    expect(r.number_of_employees).toBe(290);
    expect(r.inactive).toBe(false);
    expect(r.sublabel).toBe('5560000001 · Stockholm');
  });

  it('returns null financials when the summary is missing', () => {
    const r = mapTicCompany({ names: [{ nameOrIdentifier: 'Litet Bolag AB' }], registrationNumber: '5560000019' });
    expect(r.annual_revenue).toBeNull();
    expect(r.number_of_employees).toBeNull();
    expect(r.company_name).toBe('Litet Bolag AB');
    expect(r.address).toBeUndefined();
  });

  it('rounds fractional employee counts', () => {
    const r = mapTicCompany({ mostRecentFinancialSummary: { fn_NumberOfEmployees: 12.6 } });
    expect(r.number_of_employees).toBe(13);
  });

  it('flags ceased companies as inactive', () => {
    expect(mapTicCompany({ isCeased: true }).inactive).toBe(true);
    expect(mapTicCompany({ activityStatus: 'isNoLongerActive' }).inactive).toBe(true);
    expect(mapTicCompany({ activityStatus: 'hasNeverBeenActive' }).inactive).toBe(true);
  });

  it('does not flag unknown status as inactive', () => {
    expect(mapTicCompany({ activityStatus: 'unknown' }).inactive).toBe(false);
  });

  it('falls back to a placeholder label when no name is present', () => {
    expect(mapTicCompany({}).label).toBe('Okänt företag');
  });

  it('maps extra economy/industry fields', () => {
    const doc: TicRawCompany = {
      legalEntityType: 'Aktiebolag',
      sniCodes: [
        { sni_2025Code: '43990', sni_2025Name: 'Bygg', sni_2007Code: '43991', sni_2007Name: 'Gammal bygg', rank: 0 },
      ],
      mostRecentFinancialSummary: {
        periodEnd: 1735603200, // 2024-12-31 (Unix seconds)
        rs_OperatingProfitOrLossK: 1500,
        rs_ProfitAfterFinancialItemsK: 1200,
        bs_TotalAssetsK: 5000,
        km_OperatingMargin: 12.34,
        km_EquityAssetsRatio: 45.67,
      },
    };

    const r = mapTicCompany(doc);
    expect(r.legal_entity_type).toBe('Aktiebolag');
    expect(r.sni_code).toBe('43990'); // prefers SNI 2025
    expect(r.sni_name).toBe('Bygg');
    expect(r.operating_profit).toBe(1_500_000); // ×1000
    expect(r.profit_after_financial_items).toBe(1_200_000);
    expect(r.total_assets).toBe(5_000_000);
    expect(r.operating_margin).toBe(12.3); // one decimal
    expect(r.equity_ratio).toBe(45.7);
    expect(r.financial_year).toBe(2024);
  });

  it('falls back to SNI 2007 when 2025 is missing and handles ms timestamps', () => {
    const r = mapTicCompany({
      sniCodes: [{ sni_2007Code: '43991', sni_2007Name: 'Gammal bygg' }],
      mostRecentFinancialSummary: { periodEnd: 1735603200000 }, // milliseconds
    });
    expect(r.sni_code).toBe('43991');
    expect(r.sni_name).toBe('Gammal bygg');
    expect(r.financial_year).toBe(2024);
  });

  it('maps risk indicators from intelligence', () => {
    const r = mapTicCompany({
      intelligence: [
        { companyIntelligenceType: 'claims', notes: '2 anmärkningar', score: 80 },
        { companyIntelligenceType: 'presentOnWarningList' },
      ],
    });
    expect(r.risk_indicators).toEqual([
      { type: 'claims', score: 80, notes: '2 anmärkningar' },
      { type: 'presentOnWarningList', score: null },
    ]);
  });

  it('returns empty extras when the document is sparse', () => {
    const r = mapTicCompany({});
    expect(r.legal_entity_type).toBeUndefined();
    expect(r.sni_code).toBeUndefined();
    expect(r.operating_profit).toBeNull();
    expect(r.operating_margin).toBeNull();
    expect(r.financial_year).toBeNull();
    expect(r.risk_indicators).toEqual([]);
  });
});

describe('riskTypeLabel', () => {
  it('translates known intelligence types to Swedish', () => {
    expect(riskTypeLabel('claims')).toBe('Betalningsanmärkningar');
    expect(riskTypeLabel('presentOnWarningList')).toBe('Finns på varningslista');
  });

  it('falls back to the raw type for unknown codes', () => {
    expect(riskTypeLabel('somethingNew')).toBe('somethingNew');
  });
});

describe('mapTicPerson', () => {
  it('maps a full person document', () => {
    const doc: TicRawPerson = {
      personId: 42,
      personalIdentityNumber: '199001011234',
      firstName: 'Anna',
      lastName: 'Svensson',
      fullName: 'Anna Svensson',
      spar: {
        folkbokforingsadress_SvenskAdress_Utdelningsadress1: 'Storgatan 1',
        folkbokforingsadress_SvenskAdress_PostNr: '11122',
        folkbokforingsadress_SvenskAdress_Postort: 'Stockholm',
      },
    };

    const r = mapTicPerson(doc);
    expect(r.kind).toBe('person');
    expect(r.label).toBe('Anna Svensson');
    expect(r.first_name).toBe('Anna');
    expect(r.last_name).toBe('Svensson');
    expect(r.personal_number).toBe('199001011234');
    expect(r.address).toEqual({ street: 'Storgatan 1', postal_code: '11122', city: 'Stockholm' });
    expect(r.inactive).toBe(false);
  });

  it('builds fullName from first + last when fullName is absent', () => {
    const r = mapTicPerson({ firstName: 'Erik', lastName: 'Ek' });
    expect(r.label).toBe('Erik Ek');
  });

  it('flags protected identities', () => {
    expect(mapTicPerson({ fullName: 'Skyddad', isProtected: true }).inactive).toBe(true);
  });

  it('falls back to a placeholder label when no name is present', () => {
    expect(mapTicPerson({}).label).toBe('Okänd person');
  });
});

describe('mapTicCreditReport', () => {
  it('maps the verified Volvo /risks shape (payment applications, no remarks)', () => {
    // Exact response observed live for Aktiebolaget Volvo.
    const raw: TicRawCompanyRisk = {
      creditScore: 100,
      riskForecast: 0,
      riskForecastClass: 5,
      riskForecastDescription: 'Mycket låg risk (riskklass 5)',
      debtorSummary: {
        recordOfPaymentApplications: { numberOfCases: 2, totalAmountInSEK: 12680, lastCaseDate: 1780610400 },
      },
    };
    const r = mapTicCreditReport(raw);
    expect(r.credit_score).toBe(100);
    expect(r.risk_forecast).toBe(0);
    expect(r.risk_class).toBe(5);
    expect(r.risk_description).toBe('Mycket låg risk (riskklass 5)');
    expect(r.payment_applications).toEqual({ number_of_cases: 2, total_amount_sek: 12680, last_case_date: '2026-06-04' });
    expect(r.non_payment).toBeNull();
    expect(r.debt_balance_sek).toBeNull();
  });

  it('maps non-payment remarks and a debt balance when present', () => {
    const r = mapTicCreditReport({
      creditScore: 18,
      riskForecast: 12.5,
      riskForecastClass: 1,
      debtorSummary: {
        recordOfNonPayment: { numberOfCases: 3, totalAmountInSEK: 45000, lastCaseDate: 1700000000 },
        debtBalance: { totalAmountInSEK: 9000 },
      },
    });
    expect(r.credit_score).toBe(18);
    expect(r.risk_forecast).toBe(12.5);
    expect(r.risk_class).toBe(1);
    expect(r.non_payment).toEqual({ number_of_cases: 3, total_amount_sek: 45000, last_case_date: '2023-11-14' });
    expect(r.debt_balance_sek).toBe(9000);
  });

  it('drops empty debtor records and tolerates a sparse response', () => {
    const r = mapTicCreditReport({
      creditScore: 60,
      debtorSummary: {
        recordOfPaymentApplications: { numberOfCases: 0, totalAmountInSEK: 0 },
        debtBalance: { totalAmountInSEK: 0 },
      },
    });
    expect(r.credit_score).toBe(60);
    expect(r.risk_class).toBeNull();
    expect(r.risk_description).toBeNull();
    expect(r.payment_applications).toBeNull();
    expect(r.debt_balance_sek).toBeNull();
  });

  it('returns all-null for an empty response', () => {
    const r = mapTicCreditReport({});
    expect(r).toEqual({
      credit_score: null,
      risk_forecast: null,
      risk_class: null,
      risk_description: null,
      payment_applications: null,
      non_payment: null,
      debt_balance_sek: null,
    });
  });
});
