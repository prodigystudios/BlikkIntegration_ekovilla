// Svenska org-/person-/momsnummer. Rena funktioner, ingen sidoeffekt — anropas både från
// klientformulären (via app/crm/kunder/customerNumbers.ts, som återexporterar dem) och från
// API-routerna, och testas fristående i tests/crm/.

// Luhn (mod 10) över ett 10-siffrigt svenskt org-/personnummer. Sista siffran är en
// kontrollsiffra beräknad ur de nio första, så ett slumpat nummer validerar inte.
function luhn10Valid(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = digits.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Maskera som ######-#### medan man skriver: bara siffror (kapat vid 10) och bindestreck
// när man når de sista fyra.
export function formatSwedishIdNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

// Sant när värdet är ett komplett, kontrollsiffre-giltigt svenskt org.nr. Grindar
// momshärledningen och varnar innan ett trasigt nummer når Fortnox.
export function isValidSwedishOrgNumber(value: string): boolean {
  return luhn10Valid(value.replace(/\D/g, ''));
}

// Svenska momsnummer är deterministiska: SE + de tio siffrorna + 01. Returnerar null om
// org.numret inte är komplett och giltigt, så ett slumpat nummer aldrig ger ett moms-nr
// som Fortnox skulle avvisa.
//
// ⚠️ Suffixet 01 är standardfallet men inte det ENDA — koncernregistreringar kan ha 02, 03 …
// Därför härleds numret bara när fältet är TOMT, aldrig ovanpå ett befintligt värde.
export function vatFromOrgNumber(orgNumber: string): string | null {
  const digits = orgNumber.replace(/\D/g, '');
  if (!luhn10Valid(digits)) return null;
  return `SE${digits}01`;
}

const isBlank = (v: string | null | undefined) => v == null || v.trim() === '';
const digitsOf = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

type VatWriteFields = {
  customer_type?: 'business' | 'private' | null;
  organization_number?: string | null;
  vat_number?: string | null;
};

/**
 * Härleder momsregnumret när ett org.nr SÄTTS på en företagskund.
 *
 * 🧨 Varför den finns: härledningen låg tidigare bara i formulärens `onChange`, alltså bara
 * när någon SKREV i org-fältet för hand. Kom numret från Fortnox-importen eller tic-uppslaget
 * hände ingenting — och det gör det för nästan alla: 1376 av 1407 företagskunder hade org.nr
 * men tomt momsnummer när regeln flyttades hit (2026-09-02). Nu gäller den på skrivvägen och
 * omfattar därmed varje yta: formuläret, editorn, uppslaget och API:t.
 *
 * Fyra spärrar, alla avsiktliga:
 *  1. Bara företagskunder — privatpersoner har inget momsnummer.
 *  2. 🧨 ALDRIG när anroparen skickade med `vat_number` — inte ens när värdet är TOMT. Ett
 *     tomt fält som någon uttryckligen skickar betyder "den här kunden har inget
 *     momsnummer", och alla företag är inte momsregistrerade. Att fylla i ett påhittat
 *     SE…01 igen vore att skriva över ett medvetet val — och värdet pushas vidare till
 *     Fortnox som VATNumber, så felet skulle nå faktureringen. Formulären härleder redan
 *     själva medan man skriver; den här funktionen finns för vägarna där ingen skriver.
 *  3. Aldrig ovanpå ett ifyllt momsnummer på raden. Suffixet 01 är standard men inte givet
 *     (koncernregistreringar), så ett värde någon satt för hand vinner alltid.
 *  4. Bara när org.numret är NYTT eller ÄNDRAT i just den här skrivningen — annars hade en
 *     delvis PATCH som bara byter kundansvarig fyllt i momsnumret som bieffekt.
 *
 * ⚠️ `input` MÅSTE bara innehålla de fält anroparen faktiskt skickade, annars faller spärr 2.
 * PATCH-routen filtrerar med `pickProvidedFields`; POST-routen gör detsamma, för Zod defaultar
 * `vat_number` till null även när nyckeln saknades och den skillnaden är precis vad regeln bär.
 *
 * `before` är raden som den ser ut före skrivningen (null vid skapande).
 */
export function deriveVatNumberForWrite<T extends VatWriteFields>(
  input: T,
  before: VatWriteFields | null,
): T {
  const type = input.customer_type ?? before?.customer_type ?? null;
  if (type !== 'business') return input;

  if ('vat_number' in input) return input;
  if (!isBlank(before?.vat_number)) return input;

  const org = 'organization_number' in input ? input.organization_number : before?.organization_number;
  if (isBlank(org)) return input;

  const orgIsNewOrChanged = !before || digitsOf(org) !== digitsOf(before.organization_number);
  if (!orgIsNewOrChanged) return input;

  const derived = vatFromOrgNumber(org as string);
  return derived ? { ...input, vat_number: derived } : input;
}
