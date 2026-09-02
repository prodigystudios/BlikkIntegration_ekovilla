// Org-/moms-nummerhjälparna för kundformulären.
//
// Funktionerna BOR i `lib/domains/crm/orgNumber.ts` — de behövs numera även på skrivvägen
// (API-routerna), och en domänregel får inte ligga under `app/`. Den här filen är kvar som
// återexport så formulärens anropsplatser står orörda.
export {
  formatSwedishIdNumber,
  isValidSwedishOrgNumber,
  vatFromOrgNumber,
} from '@/lib/domains/crm/orgNumber';
