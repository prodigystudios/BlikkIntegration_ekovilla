import { isBlankLineItem, isConfiguredLineItem, isUnpricedLineItem, lineItemQuantity, type LineItemContentSource } from './lineItems';
import { lineItemDiscountPercent, lineItemUnitPrice, splitRowLabor } from './pricing';

type IssueRow = LineItemContentSource & {
  id?: string;
  pricing_mode?: string | null;
  article_price?: number | null;
  written_off?: boolean | null;
};

/**
 * Vad som hindrar arbetsorderns artikelrader från att sparas — samma tre spärrar som
 * offertformulärets getValidationIssues (mängd, pris, ROT-utbrytning), med radnummer.
 *
 * Körs på BÅDA sidor: artikeleditorn visar beskeden och stänger Spara, och saveWorkOrderLineItems
 * nekar samma rader — en gammal flik eller ett direkt API-anrop ska inte kunna spara det editorn
 * spärrar.
 *
 * ⚠️ Spärrar och inte varningar. Utan dem sparades raden och FÖRST Fortnox-pushen sa nej
 * (assertLineItemsArePriced, 409) — efter att raderna redan låg i databasen, med ordern stämplad
 * 'failed' och faktureringen spärrad, och ett besked som inte pekade ut vilken rad det gällde.
 *
 * Raderna numreras på sin plats i listan (1-baserat), som i editorn. Avskrivna rader skickas inte
 * till Fortnox och tomma rader sparas inte alls, så ingen av dem prövas.
 */
export function workOrderLineItemIssues(rows: IssueRow[], opts: { rotEnabled: boolean }): string[] {
  const checked = rows
    .map((row, i) => ({ row, n: i + 1 }))
    .filter(({ row }) => !row.written_off && !isBlankLineItem(row) && isConfiguredLineItem(row));
  const issues: string[] = [];

  // En ifylld rad utan mängd är 0 kr i Fortnox och i ordervärdet — tyst. Offerten spärrar samma sak
  // ("Ofullständiga rader — mängd och pris krävs"); här med radnummer, som de andra beskeden.
  const noQuantity = checked.filter(({ row }) => !(lineItemQuantity(row) > 0));
  if (noQuantity.length) {
    issues.push(`${noQuantity.length === 1 ? 'Rad' : 'Rader'} ${noQuantity.map(({ n }) => n).join(', ')}: mängd saknas — fyll i m² och tjocklek, eller antal`);
  }

  // "Skriv 0 om raden ingår" står med för att det är ett riktigt fall — en skriven nolla ÄR ett pris
  // (se isUnpricedLineItem). Utan meningen läses spärren som att gratisrader inte går att göra.
  const unpriced = checked.filter(({ row }) => isUnpricedLineItem(row));
  if (unpriced.length) {
    issues.push(`${unpriced.length === 1 ? 'Rad' : 'Rader'} ${unpriced.map(({ n }) => n).join(', ')}: pris saknas — välj artikel, ange A-pris, eller skriv 0 om raden ingår`);
  }

  // En arbetskostnad över A-priset bryter inte ut något (splitRowLabor), så ordern hade gått till
  // Fortnox utan det ROT-underlag säljaren tror att den har. Helt flaggade ROT-rader har ingen
  // utbrytning att pröva.
  if (opts.rotEnabled) {
    const over = checked.filter(({ row }) => !row.is_rot_work && splitRowLabor({
      laborCostPerUnit: row.labor_cost,
      unitPrice: lineItemUnitPrice(row),
      discountPercent: lineItemDiscountPercent(row),
      quantity: lineItemQuantity(row),
    }).leavesNoMaterial);
    if (over.length) {
      issues.push(`${over.length === 1 ? 'Rad' : 'Rader'} ${over.map(({ n }) => n).join(', ')}: arbetskostnaden äter hela A-priset — inget material blir kvar`);
    }
  }

  return issues;
}
