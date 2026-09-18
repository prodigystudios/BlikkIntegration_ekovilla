import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canReadPayroll, canReadWorkOrders } from '@/app/ekonomi/_lib/access';

// Lönebyrån läser arbetsordrar för att ta fram fakturaunderlag. De har LÄSNYCKLAR och ingen
// skrivnyckel, så varje skrivingång som ritas åt dem är en knapp vars enda utfall är ett 403 —
// efter att de fyllt i något. Den felklassen bet redan en gång på den här ytan (attestvyns
// "Rätta"/"Ta bort", som bara var gatade på `!locked`).
//
// Testerna nedan vaktar de två halvorna av skyddet: vem som släpps in, och att vyn inte visar
// dörrar som är låsta.

describe('ekonomiytans behörighetsgrindar', () => {
  describe('canReadWorkOrders', () => {
    it('öppnas av läsnyckeln', () => {
      expect(canReadWorkOrders(new Set(['crm.workorder.read']))).toBe(true);
    });

    it('⛔ den grova crm.access duger INTE — varken ensam eller som ersättning', () => {
      // Det här är fyndets kärna. crm.access öppnar /api/crm/reports, /sellers och /calc-settings,
      // och alla tre läser med getSupabaseAdmin() — alltså FÖRBI RLS. Hade grinden accepterat den
      // hade en extern part fått företagets försäljningssiffror och inköpspriser genom en nyckel
      // som såg ut att bara öppna en orderlista.
      expect(canReadWorkOrders(new Set(['crm.access']))).toBe(false);
      expect(canReadWorkOrders(new Set(['crm.access', 'crm.write']))).toBe(false);
    });

    it('en skrivnyckel ensam öppnar ingenting', () => {
      expect(canReadWorkOrders(new Set(['crm.workorder.write']))).toBe(false);
      expect(canReadWorkOrders(new Set(['crm.write']))).toBe(false);
    });

    it('en skrivnyckel är inte en ERSÄTTNING för läsnyckeln', () => {
      // ⛔ Grinden ska fråga efter exakt den nyckel RLS öppnar raderna på. Att låta
      // crm.workorder.write duga "eftersom den som får skriva rimligen får läsa" är att bygga in ett
      // antagande om seeden i grinden — och den dagen någon får skrivnyckeln utan läsnyckeln
      // släpps de in på en sida som visar noll ordrar, vilket ser ut som att det inte finns några.
      expect(canReadWorkOrders(new Set(['crm.access', 'crm.workorder.write']))).toBe(false);
      expect(canReadWorkOrders(new Set(['crm.write', 'crm.workorder.write']))).toBe(false);
    });

    it('failar closed på en tom mängd — ett trasigt RPC-anrop stänger dörren', () => {
      expect(canReadWorkOrders(new Set())).toBe(false);
    });

    it('löneunderlaget och fakturaunderlaget är OBEROENDE', () => {
      // Den som bara gör lönerna ska inte få ordrarna på köpet, och tvärtom. De två halvorna av
      // ytan delar adress men inte behörighet.
      const payrollOnly = new Set(['time.approve', 'time.entry.read.all', 'time.payroll.read']);
      expect(canReadPayroll(payrollOnly)).toBe(true);
      expect(canReadWorkOrders(payrollOnly)).toBe(false);

      const ordersOnly = new Set(['crm.workorder.read']);
      expect(canReadWorkOrders(ordersOnly)).toBe(true);
      expect(canReadPayroll(ordersOnly)).toBe(false);
    });
  });
});

// ── Statisk vakt: varje mutation i arbetsordervyn måste vara spärrad ─────────
//
// En mekanisk kontroll i stället för ett åtagande att minnas. Vyn är 2 000 rader och växer; nästa
// gång någon lägger till en funktion som skriver är risken inte att de struntar i spärren, utan att
// de aldrig får veta att den finns. Då fångar det här dem, i stället för lönebyrån.
//
// ⚠️ Testet läser KÄLLKOD, inte beteende. Det bevisar att spärren står skriven — inte att den
// fungerar. Den andra halvan (att knapparna faktiskt försvinner) sitter i `canEdit` genom
// komponentträdet och verifieras i webbläsaren; den vore bara prövbar här med testing-library,
// som repot inte har.

const DETAIL_CLIENT = join(process.cwd(), 'app/crm/arbetsorder/WorkOrderDetailClient.tsx');
const LIST_CLIENT = join(process.cwd(), 'app/crm/arbetsorder/WorkOrdersClient.tsx');

/**
 * Varje skrivande anrop, oavsett hur det är skrivet.
 *
 * ⚠️ Första versionen letade bara efter `method: 'POST'` med ENKLA citattecken. Den missade tre
 * saker en granskning pekade ut: dubbla citattecken, pilfunktioner, och — allvarligast — skrivningar
 * som går genom en hook (`sackReports.remove(...)`) och därför inte har något `method:` alls i den
 * här filen. `removeSackReport` var just en sådan, och den var oskyddad.
 */
const WRITE_MARKERS = [
  /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/,
  // Hook-skrivningar: vyn äger funktionen, hooken äger anropet.
  /\b(?:sackReports|progressReports|workOrderFiles)\.(?:remove|create|update|deleteFile|uploadFiles)\(/,
];

/** Alla funktioner i `source` med namn och kropp — deklarationer OCH pilfunktioner. */
function functionsWithBodies(source: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const decl = /\n  (?:async )?function (\w+)\(/g;
  const arrow = /\n  const (\w+) = (?:async )?\(/g;
  const starts: Array<{ name: string; index: number }> = [];
  for (const re of [decl, arrow]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) starts.push({ name: m[1], index: m.index });
  }
  starts.sort((a, b) => a.index - b.index);
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    out.push({ name: starts[i].name, body: source.slice(starts[i].index, end) });
  }
  return out;
}

describe('arbetsordervyns läsläge', () => {
  it('varje skrivande funktion i detaljvyn är spärrad av readOnly', () => {
    const source = readFileSync(DETAIL_CLIENT, 'utf8');
    const mutations = functionsWithBodies(source).filter((fn) =>
      WRITE_MARKERS.some((re) => re.test(fn.body)),
    );

    // Sanity: hittar vi inga alls har mönstren slutat matcha, och testet vore tomt. Siffran är
    // dagens antal — den ska höjas när fler tillkommer, aldrig sänkas för att få grönt.
    expect(mutations.length, 'mönstret matchar inga skrivningar längre — testet är tomt').toBeGreaterThanOrEqual(7);

    for (const fn of mutations) {
      expect(fn.body, `${fn.name}() skriver utan "if (readOnly) return"`).toContain('if (readOnly) return');
    }
  });

  it('listans skrivande funktion är spärrad av canEdit', () => {
    const source = readFileSync(LIST_CLIENT, 'utf8');
    const start = source.indexOf('async function createOrder(');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 600);
    expect(body, 'createOrder() saknar "if (!canEdit) return"').toContain('if (!canEdit) return');
  });

  it('vyerna tar emot flaggan utifrån i stället för att gissa rollen själva', () => {
    // ⛔ Vyn får ALDRIG läsa rollen direkt. Gör den det finns behörighetsregeln på två ställen som
    // kan säga emot varandra — samma felklass som isReadonlyRole + is_konsult_user(), det dyraste
    // fyndet i ekonomi-granskningen. Sidan äger frågan, komponenten tar svaret som en prop.
    const detail = readFileSync(DETAIL_CLIENT, 'utf8');
    const list = readFileSync(LIST_CLIENT, 'utf8');
    for (const [name, source] of [['detaljvyn', detail], ['listan', list]] as const) {
      expect(source, `${name} läser rollen själv i stället för att ta emot den`).not.toMatch(/role === '(ekonomi|admin|sales|member|konsult)'/);
    }
  });
});
