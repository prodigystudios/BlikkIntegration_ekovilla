import type { DepotDeliveryOnBoard } from './depotStock';
import type { ExpectedDelivery } from './expectedDeliveries';

// Leveransremsan på veckotavlan: vilka registrerade leveranser som ska ritas i vilken dagkolumn.
// Rent och sidoeffektfritt; läsningen ligger hos anroparen (listDeliveriesInRange).
//
// ⚠️ REMSAN ÄR HÄRLEDD, INTE EN ANTECKNING. Chippen speglar rader i ops_depot_deliveries och ska
// aldrig gå att redigera eller radera på tavlan — då kunde tavlan och lagret gå isär. En leverans
// ändras där den registreras (Administrera → Lager). Det är hela skillnaden mot dagsanteckningarna,
// som remsan annars ser ut som.

/**
 * Vad chipet påstår.
 *
 * 🧨 SKILLNADEN ÄR LASTBÄRANDE, inte kosmetisk. `arrived` är en rad i ops_depot_deliveries och
 * RÄKNAS I LAGERSALDOT. `expected` är en rad i ops_expected_deliveries och räknas INTE — den är
 * beställd, inte levererad. Ser de likadana ut på tavlan kommer någon planera mot material som inte
 * finns. Skilj dem på form OCH ord, aldrig bara på nyans.
 */
export type DeliveryChipKind = 'arrived' | 'expected';

export type DeliveryChip = {
  id: string;
  kind: DeliveryChipKind;
  depot_id: string;
  depot_name: string;
  material: string;
  sacks: number;
  /** Leveransens verkliga datum, som kan skilja sig från kolumnen chipet hamnar i. */
  delivered_on: string;
  /**
   * Sant när chipet ritas på en annan dag än sitt datum, för att dess egen dag inte är synlig.
   * Anroparen MÅSTE då skriva ut datumet — annars påstår chipet fel dag.
   */
  folded: boolean;
};

// Dagnummer, UTC-förankrat — samma idiom som sackLedger.isoToDayNumber.
//
// ⚠️ ANKRINGEN ÄR INTE BEVISAD AV TESTERNA, och det går inte att skriva ett test som bevisar den
// här. Funktionen använder bara dagnumren till JÄMFÖRELSER och ABSOLUTA AVSTÅND, aldrig till ett
// absolut värde, och `Math.round` sväljer både sommartidens timme (1/24 dygn) och en hel
// zonförskjutning — som dessutom slår likadant på alla datum och därför tar ut sig i differensen.
// En lokalt förankrad variant ger identiskt resultat i varje zon; det prövades.
//
// UTC står kvar ändå, för att det förblir rätt den dag någon jämför mot ett dagnummer som räknats
// någon annanstans. Skriv inga tester som PÅSTÅR att de vaktar ankringen — de blir tomma.
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoToDayNumber(iso: string): number | null {
  const m = ISO_DATE_RE.exec((iso ?? '').trim());
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/**
 * Grupperar leveranser på den dagkolumn de ska ritas i.
 *
 * ⚠️ HELGEN ÄR DOLD SOM STANDARD (`showWeekend` initieras false, och en blockerad localStorage ger
 * samma sak). Räknas remsan bara över de SYNLIGA dagarna försvinner en lördagsleverans spårlöst —
 * material som faktiskt står på depån syns inte någonstans. Därför fälls en leverans vars egen dag
 * är dold in på närmaste synliga dag, märkt med `folded` så anroparen kan skriva ut det riktiga
 * datumet.
 *
 * Ligger avståndet lika åt båda håll vinner den tidigare dagen — godtyckligt, men bestämt, så
 * chipet inte hoppar mellan renderingar.
 *
 * ⚠️ TVÅ DAGLISTOR, INTE EN. `weekDayISOs` är alla dagar brädet svarar för och avgör VAD som hör
 * hit; `visibleDayISOs` är kolumnerna som faktiskt ritas. Avgränsas spannet till de synliga dagarna
 * faller lördagen bort innan den hunnit fällas in — alltså precis det remsan finns för att undvika.
 * Leveranser utanför veckans spann hör till ett annat bräde och släpps.
 */
export function buildDeliveryChipsByDay(
  deliveries: DepotDeliveryOnBoard[],
  expected: ExpectedDelivery[],
  weekDayISOs: string[],
  visibleDayISOs: string[],
): Map<string, DeliveryChip[]> {
  const byDay = new Map<string, DeliveryChip[]>();

  const visible = visibleDayISOs
    .map((iso) => ({ iso, day: isoToDayNumber(iso) }))
    .filter((d): d is { iso: string; day: number } => d.day !== null);
  const weekDays = weekDayISOs.map(isoToDayNumber).filter((d): d is number => d !== null);
  if (visible.length === 0 || weekDays.length === 0) return byDay;

  const visibleSet = new Set(visible.map((d) => d.iso));
  const first = Math.min(...weekDays);
  const last = Math.max(...weekDays);

  // Båda sorterna går genom samma vikning: en väntad leverans på lördagen ska inte försvinna av
  // andra skäl än en ankommen.
  const source: Array<{ chip: Omit<DeliveryChip, 'folded'>; day: string }> = [
    ...deliveries.map((d) => ({
      day: d.delivered_on,
      chip: {
        id: d.id,
        kind: 'arrived' as const,
        depot_id: d.depot_id,
        depot_name: d.depot_name,
        material: d.material,
        sacks: d.sacks,
        delivered_on: d.delivered_on,
      },
    })),
    ...expected.map((e) => ({
      day: e.expected_on,
      chip: {
        id: e.id,
        kind: 'expected' as const,
        depot_id: e.depot_id,
        depot_name: e.depot_name,
        material: e.material,
        sacks: e.sacks,
        delivered_on: e.expected_on,
      },
    })),
  ];

  for (const item of source) {
    const day = isoToDayNumber(item.day);
    if (day === null || day < first || day > last) continue;

    let column = item.day;
    let folded = false;
    if (!visibleSet.has(item.day)) {
      let best = visible[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of visible) {
        const distance = Math.abs(candidate.day - day);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      column = best.iso;
      folded = true;
    }

    const list = byDay.get(column) ?? [];
    list.push({ ...item.chip, folded });
    byDay.set(column, list);
  }

  // Stabil ordning inom en dag: ankomna före väntade (det som FINNS är det säkrare beskedet), sedan
  // depå och material. Utan den flyttar sig chippen när svaret råkar komma i en annan ordning, och
  // två leveranser samma dag ser ut att byta plats.
  for (const list of byDay.values()) {
    list.sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === 'arrived' ? -1 : 1) ||
        a.depot_name.localeCompare(b.depot_name, 'sv') ||
        a.material.localeCompare(b.material, 'sv') ||
        a.id.localeCompare(b.id),
    );
  }
  return byDay;
}
