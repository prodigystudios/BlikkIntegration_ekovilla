// Rollerna — EN definition för hela appen (lib/auth/route.ts och lib/getUserProfile.ts importerar den).
//
// Sedan RBAC-passet (2026-09-26) fattar rollen inga åtkomstbeslut: sidor, rutter, menyer och RLS gatas
// på behörighetsnycklar (lib/auth/permissions.ts, PERMISSIONS.md). Rollen är en etikett, den seedar
// nyckelknippen, och den styr presentation där det är vad som menas (t.ex. startsidans uppställning).
//
// `ekonomi` är lönebyrån: extern, ser ingen kund och inget pris, och har inget att göra i CRM:et. Hennes
// yta är /ekonomi, och det som gör den nåbar är BEHÖRIGHETEN time.approve.
export type UserRole = 'member' | 'sales' | 'admin' | 'konsult' | 'ekonomi';
