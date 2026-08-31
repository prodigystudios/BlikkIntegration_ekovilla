import { hasCrmPermission } from '@/app/crm/lib/pagePermissions';

/**
 * Får den inloggade byta ansvarig säljare på en offert?
 *
 * Själva läsningen bor i app/crm/lib/pagePermissions.ts — samma fråga ställs numera från flera
 * sidor, och tre kopior av `rpc('effective_permissions')` hade kunnat driva isär (den här saknade
 * t.ex. fail-closed-hanteringen som helpern har).
 *
 * Ligger kvar i en egen modul med ett eget namn därför att Next.js App Router bara tillåter ett
 * känt urval exporter ur en sidfil — och namnet säger vad frågan BETYDER här, vilket ett naket
 * `hasCrmPermission('crm.admin')` i page.tsx inte gör.
 */
export async function canReassignQuote(): Promise<boolean> {
  return hasCrmPermission('crm.admin');
}
