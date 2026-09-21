import { describe, it, expect } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  formatAmount,
  formatClockRange,
  formatEntryDate,
  formatHours,
  payrollFilename,
  renderPayrollPdf,
  type PayrollPerson,
} from '@/lib/domains/time/payrollPdf';
import { loadDesignFonts, loadDesignLogo } from '@/lib/pdf/brandAssets';
import { summarizePerson, type SummarizableEntry } from '@/lib/domains/time/summary';
import type { CompensationItem } from '@/lib/domains/time/compensations';

// Löneunderlagets PDF. Det som prövas här är att dokumentet BÄR rätt uppgifter — inte att det är
// snyggt. Skillnaden är viktig: en felplacerad etikett syns när någon tittar på utskriften, men en
// bortkapad tidrad eller en rast som dras av två gånger syns inte förrän på en lönespecifikation.

const RANGE = { from: '2026-08-01', to: '2026-08-31' };

/** Textraderna på en given sida i en renderad PDF — så sidbrytningen kan prövas på riktigt. */
async function extractPageText(bytes: Uint8Array, pageNumber: number): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  return content.items
    .map((item) => (item as { str?: string }).str ?? '')
    .map((str) => str.trim())
    .filter(Boolean);
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await getDocument({ data: new Uint8Array(bytes) }).promise).numPages;
}

const ANNA = '44444444-4444-4444-8444-444444444444';

const shift = (overrides: Partial<SummarizableEntry> = {}): SummarizableEntry => ({
  kind: 'work_order',
  userId: ANNA,
  workDate: '2026-08-14',
  startTime: '08:00',
  endTime: '18:00',
  breakMinutes: 60,
  minutesWorked: 540,
  label: 'AO-20260729-42E7C4',
  note: null,
  ...overrides,
});

const compensation = (overrides: Partial<CompensationItem> = {}): CompensationItem => ({
  id: 'c1',
  user_id: ANNA,
  entry_date: '2026-08-14',
  kind: 'expense',
  quantity: null,
  amount: 240.5,
  vat_amount: 48.1,
  note: 'Skruv och remsa',
  receipt_name: 'kvitto.pdf',
  receipt_content_type: 'application/pdf',
  receipt_size_bytes: 1024,
  receipt_uploaded_at: '2026-08-14T10:00:00Z',
  ...overrides,
});

function person(entries: SummarizableEntry[], compensations: CompensationItem[] = [], name = 'Anna Andersson'): PayrollPerson {
  return { userId: ANNA, name, summary: summarizePerson(entries, RANGE, ANNA), compensations };
}

// Typsnitten och logotypen läses en gång — de kostar mer än allt annat i filen tillsammans.
const assets = { fonts: await loadDesignFonts(), logo: await loadDesignLogo() };

const render = (people: PayrollPerson[]) =>
  renderPayrollPdf({ periodStart: '2026-08-01', people, printedOn: '2026-09-21', ...assets });

describe('formatHours / formatAmount', () => {
  it('skriver timmar med svenskt decimalkomma, som attestvyn', () => {
    expect(formatHours(540)).toBe('9,00');
    expect(formatHours(0)).toBe('0,00');
    // 168 h är en hel normalmånad — talet som byrån stämmer av mot.
    expect(formatHours(10_080)).toBe('168,00');
  });

  it('grupperar tusental och behåller två decimaler på belopp', () => {
    expect(formatAmount(1234.5)).toBe('1 234,50');
    expect(formatAmount('240.50')).toBe('240,50');
    expect(formatAmount(null)).toBe('0,00');
  });
});

describe('formatEntryDate', () => {
  // ⚠️ Prövar DATUMET, inte klockan: funktionen får bara ett ISO-datum och måste svara likadant i
  // varje zon. Skrivs den om till lokala getters eller till Intl faller ett av de här.
  it('ger veckodag, dag och månad på svenska', () => {
    expect(formatEntryDate('2026-08-14')).toBe('fre 14 aug');
    expect(formatEntryDate('2026-01-01')).toBe('tor 1 jan');
    expect(formatEntryDate('2026-12-31')).toBe('tor 31 dec');
  });

  it('flyttar inte dagen över en sommartidsväxling', () => {
    // Sista söndagen i oktober: dygnet är 25 timmar i Europe/Stockholm. En implementation som
    // räknade i lokal tid eller adderade millisekunder hade kunnat svara "lör 24 okt" här.
    expect(formatEntryDate('2026-10-25')).toBe('sön 25 okt');
    expect(formatEntryDate('2026-03-29')).toBe('sön 29 mar');
  });

  it('lämnar skräp orört i stället för att gissa ett datum', () => {
    expect(formatEntryDate('inte ett datum')).toBe('inte ett datum');
  });
});

describe('formatClockRange', () => {
  it('skriver spannet på en arbetsrad', () => {
    expect(formatClockRange({ kind: 'work_order', startTime: '08:00:00', endTime: '18:00:00' }))
      .toEqual({ text: '08:00–18:00', missing: false });
  });

  it('flaggar en arbetsrad UTAN klockslag i stället för att visa ett tankstreck', () => {
    // Kontorets gamla rader. Ett "—" hade sett ut som en detalj; "saknas" är en uppgift att åtgärda.
    expect(formatClockRange({ kind: 'work_order', startTime: null, endTime: null }))
      .toEqual({ text: 'saknas', missing: true });
  });

  it('frågar inte efter klockslag på frånvaro', () => {
    // Byrån vill ha frånvaro i TIMMAR, inte som ett pass — tankstrecket är sant här.
    expect(formatClockRange({ kind: 'absence', startTime: null, endTime: null }))
      .toEqual({ text: '—', missing: false });
  });
});

describe('payrollFilename', () => {
  it('viker ned å/ä/ö till ren ASCII', () => {
    // Content-Disposition bär inte svenska tecken likadant i alla webbläsare, och ett namn
    // mottagaren inte kan spara är ett dokument som aldrig når lönesystemet.
    expect(payrollFilename({ periodStart: '2026-08-01', name: 'Åsa Öberg-Lindström' }))
      .toBe('Loneunderlag 2026-08 - Asa Oberg-Lindstrom.pdf');
  });

  it('tar bort tecken som inte får finnas i ett filnamn', () => {
    expect(payrollFilename({ periodStart: '2026-08-01', name: 'A/B: "C" #1' }))
      .toBe('Loneunderlag 2026-08 - AB C 1.pdf');
  });

  it('faller tillbaka på enbart perioden när namnet saknas', () => {
    expect(payrollFilename({ periodStart: '2026-08-01', name: null })).toBe('Loneunderlag 2026-08.pdf');
  });
});

describe('renderPayrollPdf', () => {
  it('renderar en giltig PDF', async () => {
    const bytes = await render([person([shift()])]);
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('bär namnet, perioden och byråns kolumner', async () => {
    const text = (await extractPageText(await render([person([shift()])]), 1)).join(' ');
    expect(text).toContain('LÖNEUNDERLAG');
    expect(text).toContain('Anna Andersson');
    expect(text).toContain('augusti 2026');
    expect(text).toContain('Period 2026-08-01 – 2026-08-31');
    // Kolumn för kolumn, som byrån bad om dem.
    expect(text).toContain('DATUM');
    expect(text).toContain('KLOCKSLAG');
    expect(text).toContain('ARBETAT');
    expect(text).toContain('FRÅNVARO');
    expect(text).toContain('ANTECKNING');
  });

  it('skriver byråns exempel rätt: 08–18 med en timmes rast är NIO timmar', async () => {
    // Hennes egen formulering, och det enda kravet hon uttryckte i siffror. Att det står 9,00 och
    // inte 10,00 är skillnaden mellan rätt och fel lön.
    const text = (await extractPageText(await render([person([shift()])]), 1)).join(' ');
    expect(text).toContain('08:00–18:00');
    expect(text).toContain('60 min');
    expect(text).toContain('9,00');
    expect(text).not.toContain('10,00');
  });

  it('visar INTE en rast som aldrig drogs av', async () => {
    // Gammal kontorsrad: ingen klockslag, så workedMinutes föll tillbaka på minutesWorked och
    // rasten påverkade ingenting. Trycktes den ändå hade raden sett överrapporterad ut med en
    // timme, och den som "rättar" den skriver bort riktig tid.
    const legacy = shift({ startTime: null, endTime: null, breakMinutes: 60, minutesWorked: 480 });
    const text = (await extractPageText(await render([person([legacy])]), 1)).join(' ');
    expect(text).toContain('saknas');
    expect(text).not.toContain('60 min');
    expect(text).toContain('8,00');
  });

  it('summerar månaden och delar upp frånvaron per orsak', async () => {
    const entries = [
      shift(),
      shift({ workDate: '2026-08-17' }),
      shift({ kind: 'absence', workDate: '2026-08-18', startTime: null, endTime: null, breakMinutes: 0, minutesWorked: 480, absenceReason: 'Semester', label: null }),
      shift({ kind: 'absence', workDate: '2026-08-19', startTime: null, endTime: null, breakMinutes: 0, minutesWorked: 240, absenceReason: 'VAB', label: null }),
    ];
    const text = (await extractPageText(await render([person(entries)]), 1)).join(' ');
    expect(text).toContain('Totalt');
    expect(text).toContain('18,00 h'); // arbetad tid, två pass om nio timmar
    expect(text).toContain('12,00 h'); // frånvaro, 8 + 4
    // ⚠️ VILKEN ledighet, inte bara hur mycket: orsakerna har olika lönesort hos byrån.
    expect(text).toContain('FRÅNVARO PER ORSAK');
    expect(text).toContain('Semester: 8,00 h');
    expect(text).toContain('VAB: 4,00 h');
  });

  it('bär ersättningarna med datum, antal, belopp och moms', async () => {
    const items = [
      compensation(),
      compensation({ id: 'c2', kind: 'travel', quantity: 12, amount: 0, vat_amount: null, note: null, receipt_name: null }),
    ];
    const text = (await extractPageText(await render([person([shift()], items)]), 1)).join(' ');
    expect(text).toContain('ERSÄTTNINGAR');
    expect(text).toContain('fre 14 aug');
    expect(text).toContain('240,50 kr');
    expect(text).toContain('varav moms 48,10 kr');
    expect(text).toContain('Skruv och remsa');
    expect(text).toContain('12 mil');
  });

  it('skriver INTE "0,00 kr" på en milersättning utan belopp', async () => {
    // Traktamente och milersättning ersätts med fasta satser som byrån äger. Ett nollbelopp hade
    // läst som ett påstående om att resan var gratis — mitt i underlaget satsen ska tillämpas på.
    const travel = compensation({ id: 'c2', kind: 'travel', quantity: 12, amount: 0, vat_amount: null, note: null, receipt_name: null });
    const text = (await extractPageText(await render([person([shift()], [travel])]), 1)).join(' ');
    expect(text).toContain('12 mil');
    expect(text).not.toContain('0,00 kr');
  });

  it('flaggar ett utlägg utan kvitto', async () => {
    // Efter attesten kan den anställde inte längre koppla kvittot själv — periodlåset gäller
    // kvittokolumnerna precis som timmarna. Ett papper som fattas måste synas medan det går att be om.
    const missing = compensation({ receipt_name: null, receipt_content_type: null, receipt_uploaded_at: null });
    const text = (await extractPageText(await render([person([shift()], [missing])]), 1)).join(' ');
    expect(text).toContain('Kvitto saknas');
  });

  it('säger rakt ut att personen inte rapporterat något', async () => {
    // En tom månad är precis den information man öppnar attesten för. Ett tomt blad hade sett ut
    // som ett renderingsfel.
    const text = (await extractPageText(await render([person([])]), 1)).join(' ');
    expect(text).toContain('har inte rapporterat något');
  });

  it('ger varje person ett eget avsnitt som börjar på ny sida', async () => {
    const other: PayrollPerson = {
      userId: '55555555-5555-4555-8555-555555555555',
      name: 'Björn Ek',
      summary: summarizePerson(
        [shift({ userId: '55555555-5555-4555-8555-555555555555', workDate: '2026-08-03' })],
        RANGE,
        '55555555-5555-4555-8555-555555555555',
      ),
      compensations: [],
    };
    const bytes = await render([person([shift()]), other]);
    expect(await pageCount(bytes)).toBe(2);
    expect((await extractPageText(bytes, 1)).join(' ')).toContain('Anna Andersson');
    expect((await extractPageText(bytes, 2)).join(' ')).toContain('Björn Ek');
  });

  it('bryter en lång månad till flera sidor och upprepar namnet på varje', async () => {
    // ⚠️ Namnet på VARJE sida är inte dekoration. En samlad utskrift delas nästan alltid i buntar
    // per anställd, och ett blad utan namn hamnar i fel hög utan att någon kan se det.
    const many = Array.from({ length: 60 }, (_, i) =>
      shift({ workDate: `2026-08-${String((i % 31) + 1).padStart(2, '0')}`, note: `Dag ${i + 1}` }));
    const bytes = await render([person(many)]);
    expect(await pageCount(bytes)).toBeGreaterThan(1);

    const second = (await extractPageText(bytes, 2)).join(' ');
    expect(second).toContain('Anna Andersson');
    expect(second).toContain('forts.');
    expect(second).toContain('DATUM'); // kolumnrubrikerna följer med, annars är sidan otydbar
    // Sidnumret räknar PERSONENS sidor, så en bunt går att kontrollera för sig.
    expect(second).toMatch(/Sida 2 \(\d+\)/);
  });

  it('fortsätter ersättningslistan på NÄSTA sida, inte ovanpå den förra', async () => {
    // 🧨 Regressionsvakt, och den prövar SIDAN — inte att texten finns någonstans.
    //
    // Ritfunktionerna tog först emot sidan som ett argument. En sidbrytning inne i
    // ersättningslistan bytte då `flow.page` utan att hjälparen såg det, och resten av posterna
    // ritades på den sida som redan var färdig: ovanpå tabellen, samtidigt som den nya sidan blev
    // tom. Varje post gick fortfarande att extrahera ur dokumentet, så ett test som bara letade
    // efter texten var grönt medan utskriften var oläslig — mutationsprovet visade just det.
    //
    // Med rätt flöde ligger posterna i ordning uppifrån och ned över sidorna, alltså står den
    // SISTA posten på den SISTA sidan. Med buggen står den på den första.
    const items = Array.from({ length: 60 }, (_, i) =>
      compensation({ id: `c${i}`, note: `Post ${String(i).padStart(2, '0')}` }));
    const rows = Array.from({ length: 10 }, (_, i) =>
      shift({ workDate: `2026-08-${String((i % 31) + 1).padStart(2, '0')}` }));
    const bytes = await render([person(rows, items)]);

    const pages = await pageCount(bytes);
    expect(pages).toBeGreaterThan(1);
    expect((await extractPageText(bytes, 1)).join(' ')).toContain('Post 00');
    expect((await extractPageText(bytes, pages)).join(' ')).toContain('Post 59');
    expect((await extractPageText(bytes, 1)).join(' ')).not.toContain('Post 59');
  });

  it('sätter INTE kolumnrubriker på en sida som bara bär ersättningar', async () => {
    // 🧨 Tabellhuvudet ritades först på varje fortsättningssida, oavsett vad som flödade dit. En
    // månad vars ersättningslista bröt till sida två fick då "DATUM · KLOCKSLAG · RAST · ARBETAT"
    // över fyra utläggsrader — kolumnrubriker som inte beskrev en enda siffra på sidan, i ett
    // dokument där allt annat är timmar.
    // Invarianten, inte ett enskilt radantal: en sida som bär kolumnrubriken KLOCKSLAG måste också
    // bära minst ett klockslag. Var brytningen hamnar beror på måttkonstanterna, så en fixtur med
    // ett magiskt radantal hade slutat pröva något så fort någon justerade en radhöjd — därför
    // svepet. Någonstans i det här intervallet trängs ersättningarna ut på en egen sida.
    const items = Array.from({ length: 4 }, (_, i) => compensation({ id: `c${i}`, note: `Post ${i}` }));
    let sawOwnPage = false;

    for (const rowCount of [38, 40, 42, 44, 46]) {
      const rows = Array.from({ length: rowCount }, (_, i) =>
        shift({ workDate: `2026-08-${String((i % 28) + 1).padStart(2, '0')}` }));
      const bytes = await render([person(rows, items)]);
      const pages = await pageCount(bytes);

      for (let n = 1; n <= pages; n++) {
        const text = (await extractPageText(bytes, n)).join(' ');
        if (text.includes('KLOCKSLAG')) expect(text).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
        if (text.includes('Post 3') && !/\d{2}:\d{2}–\d{2}:\d{2}/.test(text)) sawOwnPage = true;
      }
    }

    // Vaktar svepet självt: hittades aldrig fallet prövade testet ingenting.
    expect(sawOwnPage).toBe(true);
  });

  it('lämnar inte ersättningsrubriken ensam sist på en sida', async () => {
    // En rubrik utan innehåll läser som att listan är tom — och den som granskar går vidare utan
    // att bläddra. Rubriken, summeringen och minst en post hör ihop.
    //
    // Bandet där felet är möjligt är SMALT: rubriken måste rymmas där listan inte gör det, alltså
    // ett par tabellrader brett. Svepet måste täcka det — ett kortare svep var grönt medan spärren
    // var bortmuterad. Vakten nedan ser till att det inte tyst slutar göra det.
    let sawBreakAfterHeader = false;

    for (let rowCount = 36; rowCount <= 46; rowCount++) {
      const rows = Array.from({ length: rowCount }, (_, i) =>
        shift({ workDate: `2026-08-${String((i % 28) + 1).padStart(2, '0')}` }));
      const bytes = await render([person(rows, [compensation({ note: 'Spikpistol' })])]);
      const pages = await pageCount(bytes);
      for (let n = 1; n <= pages; n++) {
        const text = (await extractPageText(bytes, n)).join(' ');
        if (text.includes('ERSÄTTNINGAR')) {
          expect(text).toContain('Spikpistol');
          if (n > 1) sawBreakAfterHeader = true;
        }
      }
    }

    // Prövade svepet verkligen en brytning? Låg allt på sida ett bevisade det ingenting.
    expect(sawBreakAfterHeader).toBe(true);
  });

  it('bär utskriftsdatumet i foten', async () => {
    // Vilket underlag man håller i ska gå att se: en öppen månad kan ha rättats sedan utskriften.
    const text = (await extractPageText(await render([person([shift()])]), 1)).join(' ');
    expect(text).toContain('Utskrivet 2026-09-21');
  });

  it('svarar med ett besked i stället för ett tomt dokument när ingen valdes', async () => {
    const bytes = await render([]);
    expect(await pageCount(bytes)).toBe(1);
    expect((await extractPageText(bytes, 1)).join(' ')).toContain('Ingen anställd att visa');
  });

  it('skriver "Arbetsorder" när läsaren inte når jobbets namn', async () => {
    // ⚠️ Lönebyrån saknar crm.workorder.read med flit, så embedden svarar null och `label` blir
    // null på VARJE arbetsorderrad hon tittar på. Ett tankstreck hade lästs som "ingen uppgift
    // finns" och skickat henne att felanmäla en gräns som fungerar som den ska.
    const text = (await extractPageText(await render([person([shift({ label: null })])]), 1)).join(' ');
    expect(text).toContain('Arbetsorder');
  });
});
