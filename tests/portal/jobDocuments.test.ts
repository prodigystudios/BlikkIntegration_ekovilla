import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PORTAL_JOB_DOCUMENTS_BUCKET,
  PORTAL_JOB_DOCUMENT_MAX_BYTES,
  buildPortalJobDocumentEvent,
  egenkontrollBelongsToOrder,
  formatDocumentSize,
  isPdfBytes,
  portalJobDocumentDelivery,
  portalJobDocumentKey,
  portalJobDocumentName,
  portalJobDocumentPath,
  portalJobDocumentSupersedeKey,
} from '@/lib/domains/portal/jobDocuments';
import { egenkontrollFileName, egenkontrollFilenamePart } from '@/lib/domains/egenkontroll/filename';

// Dokumenten till butiken, den rena delen (fas 7). Det som skyddas:
//   - kontraktets gräns (3 300 000 byte, decimalt, samma som portalens MAX_JOB_DOCUMENT_BYTES) och PDF-provet;
//   - köns händelse: nyckeln ur dokumentets id, ersättningen per jobb och sort, och en kropp som bara bär en referens;
//   - filnamnet som butiken ser (William 2026-09-28);
//   - att egenkontrollen i en kommentar hör till just den här ordern.

const pdf = (extra = 10) => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array(extra).fill(0x41)]);

describe('gränsen och PDF-provet', () => {
  it('3 300 000 byte, som portalen (decimalt, inte MiB)', () => {
    expect(PORTAL_JOB_DOCUMENT_MAX_BYTES).toBe(3_300_000);
    // Base64 av den största PDF:en: portalens egen gräns i tecken, och under Vercels 4,5 MB.
    expect(Math.ceil(PORTAL_JOB_DOCUMENT_MAX_BYTES / 3) * 4).toBe(4_400_000);
  });

  it('en PDF börjar med %PDF- och har något efter', () => {
    expect(isPdfBytes(pdf())).toBe(true);
    expect(isPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(false);
    expect(isPdfBytes(new TextEncoder().encode('<html>%PDF-'))).toBe(false);
    expect(isPdfBytes(new Uint8Array())).toBe(false);
  });

  it('storleken i text, avrundad uppåt så att en för stor fil aldrig ser ut att rymmas', () => {
    expect(formatDocumentSize(3_300_000)).toBe('3,3 MB');
    expect(formatDocumentSize(3_300_001)).toBe('3,4 MB');
    expect(formatDocumentSize(4_100_000)).toBe('4,1 MB');
  });
});

describe('köns händelse', () => {
  const row = {
    id: '7d0b8f5e-1a2b-4c3d-9e8f-0a1b2c3d4e5f',
    quoteId: 'q-1',
    kind: 'order_confirmation' as const,
    name: 'Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf',
    sha256: 'a'.repeat(64),
    byteSize: 1234,
    readyAt: '2026-10-12T08:30:00.123456+00:00',
  };

  it('nyckeln ur dokumentets id (som job.message-<id>), i jobbets kö, och en nyare av samma sort ersätter', () => {
    const event = buildPortalJobDocumentEvent(row);
    expect(event.idempotencyKey).toBe(`job.document-${row.id}`);
    expect(event.idempotencyKey).toBe(portalJobDocumentKey(row.id));
    expect(event.path).toBe('/api/ekovilla/events');
    expect(event.orderingKey).toBe('job:q-1');
    expect(event.supersedeKey).toBe('job.document:q-1:order_confirmation');
    expect(portalJobDocumentSupersedeKey('q-1', 'self_inspection')).toBe('job.document:q-1:self_inspection');
  });

  it('kroppen bär referensen, aldrig innehållet; tiden som …Z med millisekunder', () => {
    expect(buildPortalJobDocumentEvent(row).payload).toEqual({
      type: 'job.document',
      occurredAt: '2026-10-12T08:30:00.123Z',
      data: { quoteId: 'q-1', kind: 'order_confirmation', name: row.name },
      contentRef: { documentId: row.id, sha256: row.sha256, bytes: 1234 },
    });
    expect(JSON.stringify(buildPortalJobDocumentEvent(row).payload)).not.toContain('contentBase64');
  });

  it('samma rad ger samma händelse, också när tiden skrivs i en annan form', () => {
    const a = buildPortalJobDocumentEvent(row);
    const b = buildPortalJobDocumentEvent({ ...row, readyAt: '2026-10-12T08:30:00.123Z' });
    expect(b).toEqual(a);
  });

  it('filen ligger under jobbet, med dokumentets id', () => {
    expect(portalJobDocumentPath('q-1', row.id)).toBe(`q-1/${row.id}.pdf`);
    expect(PORTAL_JOB_DOCUMENTS_BUCKET).toBe('portal-job-documents');
  });

  it('läget hos butiken ur köns status', () => {
    expect(portalJobDocumentDelivery('sent')).toBe('sent');
    expect(portalJobDocumentDelivery('dead')).toBe('failed');
    expect(portalJobDocumentDelivery('superseded')).toBe('replaced');
    for (const s of ['pending', 'sending', undefined, null]) expect(portalJobDocumentDelivery(s)).toBe('sending');
  });
});

describe('filnamnet (William 2026-09-28)', () => {
  it('"Orderbekräftelse <Fortnox-nr> – <arbetsplats>.pdf", med svenska tecken', () => {
    expect(portalJobDocumentName('order_confirmation', '26', 'Rönnvägen 18, Gävle')).toBe('Orderbekräftelse 26 – Rönnvägen 18, Gävle.pdf');
    expect(portalJobDocumentName('self_inspection', '26', 'Rönnvägen 18, Gävle')).toBe('Egenkontroll 26 – Rönnvägen 18, Gävle.pdf');
  });

  it('utan arbetsplats bara sorten och numret', () => {
    expect(portalJobDocumentName('order_confirmation', '26', '  ')).toBe('Orderbekräftelse 26.pdf');
    expect(portalJobDocumentName('order_confirmation', '26', null)).toBe('Orderbekräftelse 26.pdf');
  });

  it('tecken som inte får stå i ett filnamn och radbrytningar tas bort; arbetsplatsen högst 60 tecken', () => {
    expect(portalJobDocumentName('order_confirmation', '26', 'Gata 1/B\n"Huset"')).toBe('Orderbekräftelse 26 – Gata 1 B Huset.pdf');
    const long = portalJobDocumentName('order_confirmation', '26', 'Å'.repeat(200));
    expect(long).toBe(`Orderbekräftelse 26 – ${'Å'.repeat(60)}.pdf`);
    // Portalens gräns är 200 tecken (UTF-16), också med emoji i adressen.
    expect(portalJobDocumentName('order_confirmation', '26', '🏠'.repeat(200)).length).toBeLessThanOrEqual(200);
  });
});

describe('egenkontrollen hör till ordern', () => {
  const file = (name: string) => `Egenkontroller/${name}`;

  it('samma rensning som egenkontrollens sida gör av ordernumret', () => {
    expect(egenkontrollFilenamePart(' 6579 ')).toBe('6579');
    expect(egenkontrollFilenamePart('AO-20260925-DF3269')).toBe('AO-20260925-DF3269');
    expect(egenkontrollFilenamePart('Åsa Öberg')).toBe('Asa_Oberg');
  });

  it('filnamnet slutar på Fortnox-numret eller AO-numret, med arkivets -1, -2', () => {
    const numbers = ['6579', 'AO-20260925-DF3269'];
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_6579.pdf'), numbers)).toBe(true);
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_6579-2.pdf'), numbers)).toBe(true);
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_AO-20260925-DF3269.pdf'), numbers)).toBe(true);
    expect(egenkontrollBelongsToOrder(file('egenkontroll_kund_ao-20260925-df3269-1.pdf'), numbers)).toBe(true);
  });

  it('🧨 det namn som egenkontrollens sida sparar känns igen: samma funktion åt båda hållen', () => {
    const saved = `Egenkontroller/${egenkontrollFileName('Rönnvägen 18, Gävle', ' 22 ')}`;
    expect(saved).toBe('Egenkontroller/Egenkontroll_Ronnvagen_18_Gavle_22.pdf');
    expect(egenkontrollBelongsToOrder(saved, ['22', 'AO-20260928-B99B61'])).toBe(true);
    expect(egenkontrollBelongsToOrder(`Egenkontroller/${egenkontrollFileName('Kund', 'AO-20260928-B99B61')}`, ['22', 'AO-20260928-B99B61'])).toBe(true);
    // Sidan har ingen egen kopia av rensningen längre.
    const page = readFileSync('app/egenkontroll/page.tsx', 'utf8');
    expect(page).toContain("import { egenkontrollFileName } from '@/lib/domains/egenkontroll/filename';");
    expect(page).toContain('egenkontrollFileName(clientName, orderId || projectNumber)');
    expect(page).not.toMatch(/const sanitize = /);
  });

  it('arkivets reservnamn när femton löpnummer är tagna (`-<tid>-<slump>`)', () => {
    const numbers = ['6579'];
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_6579-1727512345678-ab12cd.pdf'), numbers)).toBe(true);
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_6579-1727512345678-ab12cd9.pdf'), numbers)).toBe(false);
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_6579-1727512345678-.pdf'), numbers)).toBe(false);
  });

  it('en annan orders egenkontroll gör det inte', () => {
    const numbers = ['6579', 'AO-20260925-DF3269'];
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_16579.pdf'), numbers)).toBe(false);
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_6580.pdf'), numbers)).toBe(false);
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_6579.pdf.exe'), numbers)).toBe(false);
    expect(egenkontrollBelongsToOrder(file('Ritning_Kund_6579.pdf'), numbers)).toBe(false);
    // Kundens namn får inte räcka: numret måste stå sist.
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_6579_1234.pdf'), numbers)).toBe(false);
  });

  it('ett AO-nummer som slutar på siffror känns igen, och en annan order samma dag gör det inte', () => {
    // Att läsa ut numret ur namnet hade gett `AO-20260925` med löpnumret `-123456`. Nu prövas varje nummer mot slutet.
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_K_AO-20260925-123456.pdf'), ['AO-20260925-123456'])).toBe(true);
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_K_AO-20260925-123456.pdf'), ['AO-20260925-654321'])).toBe(false);
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_K_AO-20260925-123456-1.pdf'), ['AO-20260925-123456'])).toBe(true);
    // Känd gräns: `X` och `X-N` går inte att skilja åt (arkivets löpnummer). Ofarligt, eftersom inget ordernummer är ett
    // annat plus "-siffror": Fortnox-numren är bara siffror, och AO-numren har alltid tre delar.
  });

  it('tomma nummer räknas aldrig', () => {
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_.pdf'), ['', null, undefined])).toBe(false);
    expect(egenkontrollBelongsToOrder(file('Egenkontroll_Kund_6579.pdf'), [])).toBe(false);
  });
});

// Varje importform: `from '…'`, `import '…'` och `import('…')`.
const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('vakterna', () => {
  it('den rena modulen och kortet drar varken in zod, databasen, node:crypto eller databasdelen', () => {
    for (const file of ['lib/domains/portal/jobDocuments.ts', 'app/crm/arbetsorder/WorkOrderPortalDocuments.tsx']) {
      const imports = importsOf(file);
      if (file.endsWith('.tsx')) expect(imports, file).toContain('@/lib/domains/portal/jobDocuments');
      expect(
        imports.filter(
          (i) => i === 'zod' || i.startsWith('@supabase/') || i.startsWith('node:') || i.includes('Store') || i.includes('outboundContent'),
        ),
        file,
      ).toEqual([]);
    }
  });

  it('kortet och routen skickar aldrig en sökväg som servern läser: bara id, sort och den visade egenkontrollen', () => {
    const route = readFileSync('app/api/crm/portal/jobs/[workOrderId]/documents/route.ts', 'utf8');
    expect(route).toContain("sourcePath: parsed.data.kind === 'self_inspection'");
    const store = readFileSync('lib/domains/portal/jobDocumentsStore.ts', 'utf8');
    // Sökvägen som läses kommer ur servern själv (latestSelfInspection), och klientens jämförs bara med den.
    expect(store).toContain('if (latest.path !== input.sourcePath) return { kind: \'source_changed\' };');
    expect(store).toContain('selfInspectionPath = latest.path;');
  });
});

describe('migreringen', () => {
  const sql = readFileSync('supabase/migrations/20260928163644_portal_job_documents.sql', 'utf8');

  it('bucketens gräns är portalens, och bucketen är privat och bara för PDF', () => {
    expect(sql).toContain(`('portal-job-documents', 'portal-job-documents', false, ${PORTAL_JOB_DOCUMENT_MAX_BYTES}, array['application/pdf'])`);
    expect(sql).toContain(`byte_size between 6 and ${PORTAL_JOB_DOCUMENT_MAX_BYTES}`);
  });

  it('nyckeln härleds i databasen, på samma sätt som i koden', () => {
    expect(sql).toContain("outbound_key text generated always as ('job.document-' || id::text) stored");
    expect(portalJobDocumentKey('x')).toBe('job.document-x');
  });

  it('lock_timeout först (William 2026-09-28), och den återställs sist', () => {
    const statements = sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
    expect(statements[0]).toBe("set lock_timeout = '5s';");
    expect(statements.at(-1)).toBe('reset lock_timeout;');
  });

  it('sessionen lägger bara till ett beslut, och bara genom svarsregeln', () => {
    expect(sql).toContain('grant insert (id, quote_id, kind, created_by, created_by_name)');
    expect(sql).toMatch(/for insert to authenticated\s+with check \(\s+status = 'building'\s+and created_by = \(select auth\.uid\(\)\)\s+and public\.crm_portal_job_message_can_reply\(quote_id\)/);
    expect(sql).not.toMatch(/grant (update|delete)[^;]*crm_portal_job_documents to authenticated/);
  });

  it('en automatisk orderbekräftelse per jobb', () => {
    expect(sql).toContain('on public.crm_portal_job_documents (quote_id) where created_by is null');
    expect(sql).toContain("(created_by is not null or kind = 'order_confirmation')");
  });
});
