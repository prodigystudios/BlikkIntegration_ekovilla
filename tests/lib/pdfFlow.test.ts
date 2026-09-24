import { describe, it, expect } from 'vitest';
import { PDFDocument, type PDFPage } from 'pdf-lib';

import { createFlow } from '@/lib/pdf/flow';

// Sidflödet delas av löneunderlaget och KMA-planen. Det som prövas är kontraktet båda lutar sig
// mot: SIDAN och BASLINJEN byter tillsammans, och fortsättningshuvudet hamnar på den NYA sidan.
// Ett fel här syns inte i en textextraktion — texten finns kvar, bara på fel blad.

async function setup(continuation?: (page: PDFPage, top: number) => number | void) {
  const doc = await PDFDocument.create();
  const first = doc.addPage();
  const created: PDFPage[] = [];
  const flow = createFlow({
    page: first,
    top: 700,
    continuationTop: 760,
    bottom: 80,
    newPage: () => {
      const page = doc.addPage();
      created.push(page);
      return page;
    },
    continuation,
  });
  return { doc, first, created, flow };
}

describe('createFlow', () => {
  it('börjar på startsidan vid startbaslinjen', async () => {
    const { first, flow } = await setup();
    expect(flow.page).toBe(first);
    expect(flow.y).toBe(700);
  });

  it('stannar på sidan när raden ryms — även exakt ned till foten', async () => {
    const { first, created, flow } = await setup();
    flow.y = 180;
    flow.ensure(100); // 180 − 100 = 80 = bottom: ryms precis
    expect(flow.page).toBe(first);
    expect(flow.y).toBe(180);
    expect(created).toHaveLength(0);
  });

  it('byter sida OCH baslinje tillsammans när raden inte ryms', async () => {
    const { first, created, flow } = await setup();
    flow.y = 180;
    flow.ensure(100.5);
    expect(created).toHaveLength(1);
    expect(flow.page).toBe(created[0]);
    expect(flow.page).not.toBe(first);
    expect(flow.y).toBe(760);
  });

  it('ritar fortsättningshuvudet på den NYA sidan, inte på den gamla', async () => {
    const drawnOn: PDFPage[] = [];
    const { first, created, flow } = await setup((page) => {
      drawnOn.push(page);
    });
    flow.y = 90;
    flow.ensure(20);
    expect(drawnOn).toEqual([created[0]]);
    expect(drawnOn).not.toContain(first);
  });

  it('en nollställd continuation ritar ingenting på nästa sida', async () => {
    const drawnOn: PDFPage[] = [];
    const { created, flow } = await setup((page) => {
      drawnOn.push(page);
    });
    flow.continuation = null;
    flow.y = 90;
    flow.ensure(20);
    expect(created).toHaveLength(1);
    expect(drawnOn).toHaveLength(0);
  });

  it('en hjälpare som fått OBJEKTET ser den nya sidan efter brytningen', async () => {
    // Det här är skälet till att sidan och baslinjen bor i ett objekt: en hjälpare som tog emot en
    // sidreferens FÖRE brytningen hade ritat vidare på den gamla sidan.
    const { first, flow } = await setup();
    const drawRow = (target: typeof flow) => {
      target.ensure(50);
      return target.page;
    };
    flow.y = 100;
    const drawnOn = drawRow(flow);
    expect(drawnOn).not.toBe(first);
    expect(drawnOn).toBe(flow.page);
  });

  it('ett fortsättningshuvud som anger sin höjd flyttar ned första raden', async () => {
    const { flow } = await setup((_page, top) => {
      expect(top).toBe(760);
      return 24;
    });
    flow.y = 90;
    flow.ensure(20);
    expect(flow.y).toBe(736);
  });

  it('ett huvud med fast plats (inget returvärde) lämnar baslinjen vid continuationTop', async () => {
    const { flow } = await setup(() => undefined);
    flow.y = 90;
    flow.ensure(20);
    expect(flow.y).toBe(760);
  });

  it('breakPage byter sida utan att rita fortsättningshuvudet', async () => {
    const drawnOn: PDFPage[] = [];
    const { first, created, flow } = await setup((page) => {
      drawnOn.push(page);
      return 30;
    });
    flow.y = 500; // gott om plats — brytningen är avsiktlig, inte platsbrist
    flow.breakPage();
    expect(created).toHaveLength(1);
    expect(flow.page).toBe(created[0]);
    expect(flow.page).not.toBe(first);
    expect(flow.y).toBe(760);
    expect(drawnOn).toHaveLength(0);
  });

  it('ensure fungerar även utplockad ur objektet', async () => {
    const { first, flow } = await setup();
    flow.y = 90;
    const { ensure } = flow;
    ensure(20);
    expect(flow.page).not.toBe(first);
    expect(flow.y).toBe(760);
  });
});
