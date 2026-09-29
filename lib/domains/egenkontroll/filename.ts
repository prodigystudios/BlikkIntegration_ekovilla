// Egenkontrollens filnamn i arkivet: `Egenkontroll_<kund>_<ordernr>.pdf` (app/egenkontroll/page.tsx). Ren, och EN gång:
// återförsäljarportalen (lib/domains/portal/jobDocuments.ts) läser ordernumret ur namnet för att pröva att en
// egenkontroll hör till just den ordern. Två kopior av rensningen hade kunnat glida isär, och då hade varje egenkontroll
// sett ut att gälla en annan order.

/** En del av filnamnet: diakriter bort, allt utom bokstäver, siffror, `_ - .` blir `_`, inga `_` först eller sist. */
export function egenkontrollFilenamePart(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\-.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Namnet som egenkontrollens sida sparar. Arkivet lägger till `-1`, `-2` (eller `-<tid>-<slump>`) när det redan finns. */
export function egenkontrollFileName(clientName: string, orderRef: string): string {
  return `Egenkontroll_${egenkontrollFilenamePart(clientName || 'client')}_${egenkontrollFilenamePart(orderRef || 'order')}.pdf`;
}
