/**
 * Spärrarna för skripten som SKRIVER i Fortnox testbolag (copy-articles-to-test-company.ts,
 * copy-price-list-160-to-test-company.ts). Ett ställe, så att en skärpning når alla skript.
 *
 * Skripten skriver i det Fortnox-bolag som den lokala databasen är kopplad till. De får därför
 * bara köras om
 *   - databasen är lokal (.env.development.local måste finnas — utan den pekar .env.local på PROD), och
 *   - Fortnox svarar med ett bolag som står i FORTNOX_NONPROD_ALLOWED_ORG_NUMBERS.
 * Samma två frågor som spärren i OAuth-callbacken (lib/domains/fortnox/connectionGuard.ts).
 *
 * Anroparen måste ha laddat miljön (loadEnvConfig) innan den anropar något här; modulerna
 * importeras först i anropet, så att de ser den miljön.
 */
import type { FortnoxCompanySettingsResponse } from '@/lib/domains/fortnox/offerPdf';

export function abort(message: string): never {
  console.error(`\n⛔ ${message}\n`);
  process.exit(1);
}

/** Råa felet för en utvecklare, kapat — friendlyFortnoxMessage gör allt icke-Fortnox till "Något gick fel". */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 200) : String(e);
}

/** Avbryter skriptet om databasen inte är lokal eller bolaget inte är ett godkänt testbolag. */
export async function assertLocalFortnoxTestCompany(): Promise<{ name: string; orgNumber: string }> {
  const { fortnoxConnectionPolicy, judgeFortnoxCompany, isLocalSupabaseUrl } = await import(
    '@/lib/domains/fortnox/connectionGuard'
  );
  const { fortnoxGet } = await import('@/lib/domains/fortnox/client');

  // Spärr 1: databasen. Tokens läses och skrivs här — den får aldrig vara prods.
  const dbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!isLocalSupabaseUrl(dbUrl)) abort(`Databasen är inte lokal (${dbUrl ?? 'ingen URL'}). Kör bara mot den lokala stacken.`);

  // Spärr 2: bolaget. Med en lokal databas är policyn alltid tillåtelselistan; frågan är vilket bolag
  // kopplingen faktiskt gäller.
  const company = await fortnoxGet<{ CompanySettings?: FortnoxCompanySettingsResponse }>('/settings/company');
  const orgNumber = company.CompanySettings?.OrganizationNumber ?? null;
  const verdict = judgeFortnoxCompany(fortnoxConnectionPolicy(process.env), orgNumber);
  if (!verdict.ok) abort(verdict.message);

  const name = company.CompanySettings?.Name ?? '?';
  console.log(`Fortnox-bolag: ${name} (${orgNumber}) — godkänt testbolag.`);
  return { name, orgNumber: orgNumber as string };
}
