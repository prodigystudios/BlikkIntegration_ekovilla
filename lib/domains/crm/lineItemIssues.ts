import { isBlankLineItem, isConfiguredLineItem, isUnpricedLineItem, lineItemQuantity, type LineItemContentSource } from './lineItems';
import { lineItemDiscountPercent, lineItemUnitPrice, splitRowLabor } from './pricing';

type IssueRow = LineItemContentSource & {
  id?: string | null;
  pricing_mode?: string | null;
  article_price?: number | null;
  written_off?: boolean | null;
};

// Fälten spärrarna läser, normaliserade så att en rad som bara passerat Zod (nycklar i annan
// ordning, defaultvärden ifyllda, tal gjorda till strängar) inte läses som ändrad.
function sameForChecks(a: IssueRow, b: IssueRow): boolean {
  const text = (v: unknown) => (v == null ? '' : String(v).trim());
  const texts: Array<keyof IssueRow> = ['article_name', 'article_number', 'unit_price', 'discount_percent', 'labor_cost', 'quantity', 'm2', 'thickness_mm'];
  // Tom sträng och null är samma frånvaro av artikelpris — schemat gör om '' till null, och en
  // orörd gammal rad hade annars lästs som ändrad och nekats på servern.
  const price = (v: unknown) => (v == null || v === '' ? null : Number(v));
  return texts.every((k) => text(a[k]) === text(b[k]))
    && price(a.article_price) === price(b.article_price)
    && (a.pricing_mode || 'm3') === (b.pricing_mode || 'm3')
    && (a.is_rot_work === true) === (b.is_rot_work === true)
    && (a.written_off === true) === (b.written_off === true);
}

// Ifyllda, inte avskrivna rader — de som når Fortnox och ordervärdet. Numrerade på sin plats i
// listan (1-baserat), som i editorn.
function configuredRows(rows: IssueRow[]) {
  return rows
    .map((row, i) => ({ row, n: i + 1 }))
    .filter(({ row }) => !row.written_off && !isBlankLineItem(row) && isConfiguredLineItem(row));
}

function savedById(savedRows: IssueRow[] | null | undefined) {
  return new Map((savedRows ?? []).filter((r) => r.id).map((r) => [r.id as string, r]));
}

/**
 * Raderna pris- och mängdspärren ska pröva: NYA eller ÄNDRADE mot den sparade raden med samma id.
 *
 * ⚠️ BARA ÄNDRADE RADER, med flit. En äldre rad som redan ligger sparad utan pris hade annars
 * låst VARJE sparning av ordern — även en som bara skriver av en helt annan rad — tills någon
 * rättat en rad hen aldrig tänkt röra. Spärren ska göra det omöjligt att lägga till ett nytt fel,
 * inte göra ordern oredigerbar. Den gamla raden får i stället en varning (untouchedUnpricedWarning).
 */
function changedRows(rows: IssueRow[], savedRows: IssueRow[] | null | undefined) {
  const saved = savedById(savedRows);
  return configuredRows(rows).filter(({ row }) => {
    const before = row.id ? saved.get(row.id) : undefined;
    return !before || !sameForChecks(before, row);
  });
}

const rowsLabel = (list: Array<{ n: number }>) =>
  `${list.length === 1 ? 'Rad' : 'Rader'} ${list.map(({ n }) => n).join(', ')}`;

/**
 * En ny eller ändrad rad utan prisförankring — varken A-pris eller artikel.
 *
 * Den enda spärren som körs på SERVERN också (saveWorkOrderLineItems): det är den som annars
 * sparas och FÖRST därefter får Fortnox-pushen att säga nej (assertLineItemsArePriced, 409), med
 * ordern stämplad 'failed' och faktureringen spärrad. "Skriv 0 om raden ingår" står med för att
 * det är ett riktigt fall — en skriven nolla ÄR ett pris (se isUnpricedLineItem).
 */
export function unpricedRowsIssue(rows: IssueRow[], savedRows?: IssueRow[] | null): string | null {
  const unpriced = changedRows(rows, savedRows).filter(({ row }) => isUnpricedLineItem(row));
  return unpriced.length
    ? `${rowsLabel(unpriced)}: pris saknas — välj artikel, ange A-pris, eller skriv 0 om raden ingår`
    : null;
}

/**
 * En ORÖRD sparad rad utan pris. Spärrar inget (se changedRows) — men den får Fortnox-synken att
 * fallera efter sparningen, och det ska man få veta innan man trycker Spara, inte efteråt.
 */
export function untouchedUnpricedWarning(rows: IssueRow[], savedRows: IssueRow[] | null | undefined): string | null {
  const changed = new Set(changedRows(rows, savedRows).map(({ row }) => row));
  const stale = configuredRows(rows).filter(({ row }) => !changed.has(row) && isUnpricedLineItem(row));
  return stale.length
    ? `${rowsLabel(stale)} saknar pris sedan tidigare. Sparningen går igenom, men Fortnox-synken misslyckas tills raden fått ett pris (eller 0 om den ingår).`
    : null;
}

/**
 * Vad som hindrar arbetsorderns artikelrader från att sparas i editorn — offertformulärets spärrar
 * (getValidationIssues), med radnummer.
 *
 *  • PRIS: nya och ändrade rader (unpricedRowsIssue).
 *  • MÄNGD: bara NYA rader. En befintlig rad med antal 0 är ett riktigt läge — det levererades
 *    inget, och att sänka antalet till det levererade är hur en delfakturerad order stängs. En rad
 *    som just lagts till utan mängd är däremot ett glömt fält: 0 kr, tyst, ur ordervärdet.
 *  • ROT-UTBRYTNING: ALLA rader utom de låsta (fakturerade — deras arbetskostnad går inte att ändra).
 *    Det är ROT-påslaget i översikten som gör en gammal rad fel, så en spärr på bara ändrade rader
 *    hade tigit just när den behövs.
 *
 * ROT-spärren körs bara här, inte på servern: den läser ÖVERSIKTENS utkast (är ROT påslaget just
 * nu?), och servern ser bara det sparade läget. En order där utkastet och databasen säger olika
 * hade annars fått ett 422 om ett fält editorn inte ens visade. Pushen tål raden — den bryter
 * bara inte ut något.
 */
export function workOrderLineItemIssues(
  rows: IssueRow[],
  opts: { rotEnabled: boolean; savedRows?: IssueRow[] | null; lockedIds?: ReadonlySet<string> },
): string[] {
  const issues: string[] = [];
  const unpriced = unpricedRowsIssue(rows, opts.savedRows);
  if (unpriced) issues.push(unpriced);

  const saved = savedById(opts.savedRows);
  const newWithoutQuantity = changedRows(rows, opts.savedRows)
    .filter(({ row }) => !(row.id && saved.has(row.id)) && !(lineItemQuantity(row) > 0));
  if (newWithoutQuantity.length) {
    issues.push(`${rowsLabel(newWithoutQuantity)}: mängd saknas — fyll i m² och tjocklek, eller antal`);
  }

  // En arbetskostnad över A-priset bryter inte ut något (splitRowLabor), så ordern hade gått till
  // Fortnox utan det ROT-underlag säljaren tror att den har. Helt flaggade ROT-rader har ingen
  // utbrytning att pröva.
  if (opts.rotEnabled) {
    const over = configuredRows(rows)
      .filter(({ row }) => !(row.id && opts.lockedIds?.has(row.id)))
      .filter(({ row }) => !row.is_rot_work && splitRowLabor({
        laborCostPerUnit: row.labor_cost,
        unitPrice: lineItemUnitPrice(row),
        discountPercent: lineItemDiscountPercent(row),
        quantity: lineItemQuantity(row),
      }).leavesNoMaterial);
    if (over.length) {
      issues.push(`${rowsLabel(over)}: arbetskostnaden äter hela A-priset — inget material blir kvar`);
    }
  }

  return issues;
}
