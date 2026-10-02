import { sameFortnoxCustomer } from './customerDelete';

/**
 * Pekar våra kundkort på rätt kund i Fortnox? Logiken bakom scripts/fortnox/check-customer-numbers.ts.
 *
 * Varför frågan finns: Fortnox återanvänder kundnummer (uppmätt i testbolaget 2026-10-02 — kund 21 raderad, nästa nya
 * kund fick 21). Tas en kund bort direkt i Fortnox står vårt kort kvar med numret, och nästa nya kund i Fortnox kan få
 * det. Då skickar kortets ändringar och dokument till fel kund, och Fortnox-importen (`syncFortnoxCustomers`, matchar på
 * nummer) skriver över kortet med den nya kundens uppgifter.
 *
 * Jämförelsen är raderingens (`sameFortnoxCustomer`), så kontrollen och borttagningen kan inte döma olika.
 */

export type LinkedCustomerRow = {
  id: string;
  customer_type: 'business' | 'private';
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  organization_number: string | null;
  personal_number: string | null;
  fortnox_customer_id: string;
  /** Offerter och arbetsordrar på kortet — hur mycket som hänger på kopplingen. */
  quotes: number;
  work_orders: number;
};

/** Det Fortnox kundlista (`GET /customers`) ger per kund och som kontrollen behöver. */
export type FortnoxListedCustomer = {
  CustomerNumber: string;
  Name: string | null;
  OrganisationNumber: string | null;
};

export type CustomerLinkFinding =
  /**
   * Numret finns inte i Fortnox: kunden togs bort där. Kortet väntar på att numret ska gå till en ny kund.
   * `sameNumberElsewhere`: Fortnox-kunder med kortets org.nr/personnummer — kunden kan ha lagts upp igen.
   */
  | { kind: 'missing_in_fortnox'; row: LinkedCustomerRow; sameNumberElsewhere: FortnoxListedCustomer[] }
  /**
   * Numret tillhör en annan kund i Fortnox. `basis` säger vad som avgjorde: org.nr när båda har ett (säkert), annars
   * namnet (kan också vara ett namnbyte som inte hunnit importeras).
   */
  | { kind: 'other_customer'; row: LinkedCustomerRow; fortnox: FortnoxListedCustomer; basis: 'org_number' | 'name' };

export type CustomerLinkReport = { checked: number; ok: number; findings: CustomerLinkFinding[] };

function lastTenDigits(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function cardNumber(row: LinkedCustomerRow): string | null {
  return lastTenDigits(row.customer_type === 'business' ? row.organization_number : row.personal_number);
}

export function checkCustomerLinks(rows: LinkedCustomerRow[], fortnoxCustomers: FortnoxListedCustomer[]): CustomerLinkReport {
  const byNumber = new Map(fortnoxCustomers.map((c) => [c.CustomerNumber.trim(), c]));
  const byOrgNumber = new Map<string, FortnoxListedCustomer[]>();
  for (const customer of fortnoxCustomers) {
    const key = lastTenDigits(customer.OrganisationNumber);
    if (key) byOrgNumber.set(key, [...(byOrgNumber.get(key) ?? []), customer]);
  }

  const findings: CustomerLinkFinding[] = [];
  for (const row of rows) {
    const fortnox = byNumber.get(row.fortnox_customer_id.trim());
    if (!fortnox) {
      const key = cardNumber(row);
      findings.push({ kind: 'missing_in_fortnox', row, sameNumberElsewhere: key ? byOrgNumber.get(key) ?? [] : [] });
      continue;
    }
    if (!sameFortnoxCustomer(row, { name: fortnox.Name, organisationNumber: fortnox.OrganisationNumber })) {
      const basis = cardNumber(row) && lastTenDigits(fortnox.OrganisationNumber) ? 'org_number' : 'name';
      findings.push({ kind: 'other_customer', row, fortnox, basis });
    }
  }

  // Det allvarligaste först: ett kort som redan pekar på en annan kund, säkrast avgjort överst.
  const rank = (f: CustomerLinkFinding) => (f.kind === 'other_customer' ? (f.basis === 'org_number' ? 0 : 1) : 2);
  findings.sort((a, b) => rank(a) - rank(b) || Number(a.row.fortnox_customer_id) - Number(b.row.fortnox_customer_id));

  return { checked: rows.length, ok: rows.length - findings.length, findings };
}
