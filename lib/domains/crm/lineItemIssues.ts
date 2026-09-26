import { isBlankLineItem, isConfiguredLineItem, isUnpricedLineItem, lineItemQuantity, type LineItemContentSource } from './lineItems';
import { lineItemDiscountPercent, lineItemRotLabor, lineItemUnitPrice, splitRowLabor, type PricingLineItem } from './pricing';

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

// Saknar raden pris SÅ SOM DEN SPARAS? Schemat gör om ett tomt artikelpris ('') till null, och
// pushen läser den sparade raden — så '' ska läsas som frånvaro redan här, annars säger editorn
// "prissatt" om en rad som efter sparningen får pushen att fallera. (isUnpricedLineItem själv rörs
// inte: pushen läser rå JSONB med den och ska bete sig som förut.)
function priceMissingAfterSave(row: IssueRow): boolean {
  const articlePrice = (row.article_price as unknown) === '' ? null : row.article_price;
  return isUnpricedLineItem({ ...row, article_price: articlePrice });
}

// En fakturerad rad kan inte få pris, artikel eller arbetskostnad ändrad (validateLineItemEdit), så
// en spärr eller ett råd om dem vore omöjligt att följa — och en spärr hade dessutom hindrat att
// antalet sänks till det fakturerade, alltså att ordern stängs.
const unlocked = (lockedIds: ReadonlySet<string> | undefined) => ({ row }: { row: IssueRow }) =>
  !(row.id && lockedIds?.has(row.id));

function laborEatsPrice(row: IssueRow): boolean {
  return !row.is_rot_work && splitRowLabor({
    laborCostPerUnit: row.labor_cost,
    unitPrice: lineItemUnitPrice(row),
    discountPercent: lineItemDiscountPercent(row),
    quantity: lineItemQuantity(row),
  }).leavesNoMaterial;
}

/**
 * En ny eller ändrad rad utan prisförankring — varken A-pris eller artikel.
 *
 * Den enda spärren som körs på SERVERN också (saveWorkOrderLineItems): det är den som annars
 * sparas och FÖRST därefter får Fortnox-pushen att säga nej (assertLineItemsArePriced, 409), med
 * ordern stämplad 'failed' och faktureringen spärrad. "Skriv 0 om raden ingår" står med för att
 * det är ett riktigt fall — en skriven nolla ÄR ett pris (se isUnpricedLineItem).
 */
export function unpricedRowsIssue(
  rows: IssueRow[],
  savedRows?: IssueRow[] | null,
  lockedIds?: ReadonlySet<string>,
): string | null {
  const unpriced = changedRows(rows, savedRows).filter(unlocked(lockedIds)).filter(({ row }) => priceMissingAfterSave(row));
  return unpriced.length
    ? `${rowsLabel(unpriced)}: pris saknas — välj artikel, ange A-pris, eller skriv 0 om raden ingår`
    : null;
}

type IssueOptions = {
  rotEnabled: boolean;
  savedRows?: IssueRow[] | null;
  /** Fakturerade rader — de som validateLineItemEdit låser. Prövas inte. */
  lockedIds?: ReadonlySet<string>;
};

/**
 * Vad som hindrar arbetsorderns artikelrader från att sparas i editorn — offertformulärets spärrar
 * (getValidationIssues), med radnummer, på NYA och ÄNDRADE rader:
 *
 *  • PRIS (unpricedRowsIssue — körs på servern också).
 *  • MÄNGD, bara på NYA rader. En befintlig rad med antal 0 är ett riktigt läge — det levererades
 *    inget, och att sänka antalet till det levererade är hur en delfakturerad order stängs. En rad
 *    som just lagts till utan mängd är däremot ett glömt fält: 0 kr, tyst, ur ordervärdet.
 *  • ROT-UTBRYTNING. Bara i editorn: den läser ÖVERSIKTENS utkast (är ROT påslaget just nu?), och
 *    servern ser bara det sparade läget. Pushen tål raden — den bryter bara inte ut något.
 *
 * Orörda rader spärrar aldrig (se changedRows) — de får varningar i stället, workOrderLineItemWarnings.
 */
export function workOrderLineItemIssues(rows: IssueRow[], opts: IssueOptions): string[] {
  const issues: string[] = [];
  const unpriced = unpricedRowsIssue(rows, opts.savedRows, opts.lockedIds);
  if (unpriced) issues.push(unpriced);

  const saved = savedById(opts.savedRows);
  const changed = changedRows(rows, opts.savedRows);
  const newWithoutQuantity = changed
    .filter(({ row }) => !(row.id && saved.has(row.id)) && !(lineItemQuantity(row) > 0));
  if (newWithoutQuantity.length) {
    issues.push(`${rowsLabel(newWithoutQuantity)}: mängd saknas — fyll i m² och tjocklek, eller antal`);
  }

  // En arbetskostnad över A-priset bryter inte ut något (splitRowLabor), så ordern hade gått till
  // Fortnox utan det ROT-underlag säljaren tror att den har.
  if (opts.rotEnabled) {
    const over = changed.filter(unlocked(opts.lockedIds)).filter(({ row }) => laborEatsPrice(row));
    if (over.length) {
      issues.push(`${rowsLabel(over)}: arbetskostnaden äter hela A-priset — inget material blir kvar`);
    }
  }

  return issues;
}

/**
 * Det editorn ska SÄGA men inte spärra — orörda rader som redan ligger sparade fel, och en ändring
 * som går igenom men stänger en senare väg. Spärrar vore fel här: en gammal rad hade låst varje
 * sparning av ordern, även en som rör en helt annan rad.
 *
 *  • Orörd rad utan pris: sparningen går igenom, men Fortnox-synken fallerar efteråt.
 *  • Orörd rad vars arbetskostnad äter A-priset, när ROT är på: det är ofta påslaget i översikten
 *    som gör en gammal rad fel, och då ska det synas nu — inte när avdraget saknas på fakturan.
 *  • Utbruten arbetskostnad på en order som delfaktureras: nästa delfaktura stoppas
 *    (hasCarvedRotLabor — delfakturering proportionerar inte utbrutet arbete än).
 */
export function workOrderLineItemWarnings(
  rows: IssueRow[],
  opts: IssueOptions & { partiallyInvoiced?: boolean },
): string[] {
  const warnings: string[] = [];
  const changed = new Set(changedRows(rows, opts.savedRows).map(({ row }) => row));
  const untouched = configuredRows(rows).filter(({ row }) => !changed.has(row)).filter(unlocked(opts.lockedIds));

  const stale = untouched.filter(({ row }) => priceMissingAfterSave(row));
  if (stale.length) {
    warnings.push(`${rowsLabel(stale)} saknar pris sedan tidigare. Sparningen går igenom, men Fortnox-synken misslyckas tills raden fått ett pris (eller 0 om den ingår).`);
  }

  if (opts.rotEnabled) {
    const over = untouched.filter(({ row }) => laborEatsPrice(row));
    if (over.length) {
      warnings.push(`${rowsLabel(over)}: arbetskostnaden äter hela A-priset — ingen arbetskostnad bryts ut, och ROT-avdraget blir mindre än väntat.`);
    }
  }

  if (opts.rotEnabled && opts.partiallyInvoiced
    && configuredRows(rows).some(({ row }) => !row.is_rot_work && lineItemRotLabor(row as PricingLineItem) > 0)) {
    warnings.push('Ordern delfaktureras. En utbruten arbetskostnad ("Varav arbetskostnad") stoppar nästa delfaktura — delfakturering med utbrutet ROT-arbete stöds inte än.');
  }

  return warnings;
}
