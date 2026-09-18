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
    it('kräver BÅDA nycklarna', () => {
      expect(canReadWorkOrders(new Set(['crm.access', 'crm.workorder.read']))).toBe(true);
      // 🧨 Bara crm.access: routen släpper igenom, men RLS filtrerar bort varenda rad — listan
      // svarar 200 med noll ordrar och ser ut som att det inte finns några.
      expect(canReadWorkOrders(new Set(['crm.access']))).toBe(false);
      // 🧨 Bara crm.workorder.read: RLS skulle släppa raderna, men requireCrmUser() svarar 403.
      expect(canReadWorkOrders(new Set(['crm.workorder.read']))).toBe(false);
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
      expect(canReadWorkOrders(new Set(['crm.access', 'crm.write', 'crm.workorder.write']))).toBe(false);
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

      const ordersOnly = new Set(['crm.access', 'crm.workorder.read']);
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

/** Funktionsnamnen i `source` som innehåller ett skrivande fetch-anrop. */
function mutatingFunctions(source: string): string[] {
  const found: string[] = [];
  // Dela på funktionsdeklarationer och behåll namnet med sin kropp. Kroppen räcker fram till nästa
  // deklaration, vilket är grovt men fullt tillräckligt: ett skrivanrop hamnar aldrig utanför den
  // funktion det står i.
  const parts = source.split(/\n  (?:async )?function /);
  for (const part of parts.slice(1)) {
    const name = part.slice(0, part.indexOf('('));
    const body = part.slice(0, part.length);
    if (/method: '(POST|PATCH|PUT|DELETE)'/.test(body.split(/\n  (?:async )?function /)[0])) {
      found.push(name);
    }
  }
  return found;
}

describe('arbetsordervyns läsläge', () => {
  it('varje skrivande funktion i detaljvyn är spärrad av readOnly', () => {
    const source = readFileSync(DETAIL_CLIENT, 'utf8');
    const mutations = mutatingFunctions(source);

    // Sanity: hittar vi inga alls har mönstret ovan slutat matcha, och testet vore tomt.
    expect(mutations.length).toBeGreaterThanOrEqual(5);

    for (const name of mutations) {
      // Funktionens kropp fram till nästa deklaration.
      const start = source.indexOf(`function ${name}(`);
      const rest = source.slice(start);
      const nextFn = rest.slice(1).search(/\n  (?:async )?function /);
      const body = nextFn === -1 ? rest : rest.slice(0, nextFn + 1);
      expect(body, `${name}() saknar "if (readOnly) return" — den skriver utan spärr`).toContain('if (readOnly) return');
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
