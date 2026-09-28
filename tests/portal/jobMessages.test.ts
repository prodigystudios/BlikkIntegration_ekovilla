import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PORTAL_JOB_MESSAGE_DEPARTMENTS,
  buildPortalJobMessageEvent,
  countChars,
  portalJobMessageByline,
  portalJobMessageKey,
  portalJobMessagePreview,
  portalReplyAuthorName,
  portalReplyDelivery,
  sliceChars,
} from '@/lib/domains/portal/jobMessages';
import { buildPortalJobMessageNotification } from '@/lib/domains/notifications/payload';

// Meddelandena på ett portaljobb (fas 6), den rena delen: kontraktets exakta fältnamn och värden, tecken räknade som
// Postgres räknar dem, och att kortet aldrig drar in zod eller databasen.

const REPLY = {
  quoteId: 'q-2026-015',
  messageId: '7f1c2b8e-2a1d-4c3e-9b5f-0a1b2c3d4e5f',
  authorName: 'Anna Berg',
  department: 'Planering' as const,
  body: 'Vi kommer tisdag 14 oktober, kl. 7.',
  // Som databasen skriver tiden: mikrosekunder och +00:00.
  sentAt: '2026-10-01T10:00:00.123456+00:00',
};

describe('kontraktet: job.message', () => {
  it('avdelningarna är exakt portalens (utom den tomma, som ett svar aldrig får)', () => {
    expect(PORTAL_JOB_MESSAGE_DEPARTMENTS).toEqual(['Försäljning', 'Planering', 'Ekonomi']);
  });

  it('händelsen: type/occurredAt/data med exakt kontraktets fält, tiden …Z med millisekunder, i jobbets kö', () => {
    const event = buildPortalJobMessageEvent(REPLY);
    expect(event).toEqual({
      idempotencyKey: `job.message-${REPLY.messageId}`,
      path: '/api/ekovilla/events',
      orderingKey: 'job:q-2026-015',
      payload: {
        type: 'job.message',
        occurredAt: '2026-10-01T10:00:00.123Z',
        data: {
          quoteId: 'q-2026-015',
          messageId: REPLY.messageId,
          authorName: 'Anna Berg',
          department: 'Planering',
          body: 'Vi kommer tisdag 14 oktober, kl. 7.',
          sentAt: '2026-10-01T10:00:00.123Z',
        },
      },
    });
  });

  it('samma sparade rad ger samma händelse, i vilken form tiden än läses (cron köar om utan att kön nekar)', () => {
    const again = buildPortalJobMessageEvent({ ...REPLY, sentAt: '2026-10-01T10:00:00.123Z' });
    expect(again).toEqual(buildPortalJobMessageEvent(REPLY));
  });

  it('nyckeln är samma som databasens härledda outbound_key', () => {
    expect(portalJobMessageKey('abc')).toBe('job.message-abc');
    const migration = readFileSync('supabase/migrations/20260928151026_portal_job_messages.sql', 'utf8');
    expect(migration).toContain("case when direction = 'to_store' then 'job.message-' || message_id end");
  });
});

describe('tecknen, som Postgres räknar dem', () => {
  it('ett emoji är ett tecken, inte två', () => {
    expect('😀'.length).toBe(2);
    expect(countChars('😀')).toBe(1);
    expect(countChars('Hej 😀!')).toBe(6);
  });

  it('sliceChars delar aldrig ett emoji', () => {
    expect(sliceChars('ab😀cd', 3)).toBe('ab😀');
  });
});

describe('svararens namn', () => {
  it('profilens namn, med blanksteg ihopslagna; utan namn "Ekovilla"', () => {
    expect(portalReplyAuthorName('  Anna   Berg ')).toBe('Anna Berg');
    expect(portalReplyAuthorName(null)).toBe('Ekovilla');
    expect(portalReplyAuthorName('   ')).toBe('Ekovilla');
  });

  it('högst 200 tecken', () => {
    expect(countChars(portalReplyAuthorName('ä'.repeat(250)))).toBe(200);
  });
});

describe('notisen', () => {
  it('början av meddelandet på en rad, kortad med …', () => {
    expect(portalJobMessagePreview('Hej!\n\nVindsluckan   sitter ute.')).toBe('Hej! Vindsluckan sitter ute.');
    const long = portalJobMessagePreview('a'.repeat(300));
    expect(countChars(long)).toBe(120);
    expect(long.endsWith('…')).toBe(true);
    expect(portalJobMessagePreview('😀'.repeat(200), 10)).toBe(`${'😀'.repeat(9)}…`);
  });

  it('"Meddelande från <butik>", "<namn>: <början>", länken till arbetsordern, egen typ', () => {
    expect(
      buildPortalJobMessageNotification({ workOrderId: 'wo-1', storeName: 'K-Bygg Sandviken', authorName: 'Sara Ek', preview: 'Hej från Gävle' }),
    ).toEqual({
      type: 'portal_job.message',
      title: 'Meddelande från K-Bygg Sandviken',
      body: 'Sara Ek: Hej från Gävle',
      href: '/crm/arbetsorder/wo-1',
      entity_type: 'work_order',
      entity_id: 'wo-1',
    });
  });
});

describe('kortet', () => {
  it('svarets läge ur köns status: skickat, kom inte fram, annars skickas', () => {
    expect(portalReplyDelivery('sent')).toBe('sent');
    expect(portalReplyDelivery('dead')).toBe('failed');
    for (const status of ['pending', 'sending', null, undefined]) expect(portalReplyDelivery(status)).toBe('sending');
  });

  it('"Anna Berg · Planering", och bara namnet utan avdelning', () => {
    expect(portalJobMessageByline({ authorName: 'Anna Berg', department: 'Planering' })).toBe('Anna Berg · Planering');
    expect(portalJobMessageByline({ authorName: 'Sara Ek', department: '' })).toBe('Sara Ek');
  });
});

// Varje importform: `from '…'`, `import '…'` och `import('…')`.
const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('vakterna', () => {
  it('den rena modulen och kortet importerar varken zod, databasklienten eller databasdelen', () => {
    for (const file of ['lib/domains/portal/jobMessages.ts', 'app/crm/arbetsorder/WorkOrderPortalMessagesCard.tsx']) {
      const imports = importsOf(file);
      // Kortet har importer; hittar mönstret inga där har det slutat fungera och testet är tomt.
      if (file.endsWith('.tsx')) expect(imports, file).toContain('@/lib/domains/portal/jobMessages');
      expect(imports.filter((i) => i === 'zod' || i.startsWith('@supabase/') || i.includes('jobMessagesStore')), file).toEqual([]);
    }
  });

  it('meddelandena och de interna kommentarerna rör aldrig varandras tabell eller kod', () => {
    const FROM = (table: string) => new RegExp(`from\\(\\s*['"\`]${table}['"\`]`);
    const messageFiles = [
      'lib/domains/portal/jobMessages.ts',
      'lib/domains/portal/jobMessagesStore.ts',
      'app/api/portal/jobs/[quoteId]/messages/route.ts',
      'app/api/crm/portal/jobs/[workOrderId]/messages/route.ts',
      'app/crm/arbetsorder/WorkOrderPortalMessagesCard.tsx',
    ];
    const commentFiles = [
      'app/api/crm/work-orders/[id]/comments/route.ts',
      'lib/domains/crm/work-orders.ts',
      'app/crm/arbetsorder/WorkOrderCommentsTab.tsx',
      'app/crm/arbetsorder/useWorkOrderActivity.ts',
    ];
    // Mönstret måste hitta något där det ska, annars är testet tomt.
    expect(FROM('crm_work_order_comments').test(readFileSync('lib/domains/crm/work-orders.ts', 'utf8'))).toBe(true);
    for (const file of messageFiles) {
      const source = readFileSync(file, 'utf8');
      expect(FROM('crm_work_order_comments').test(source), file).toBe(false);
      expect(source.includes('/comments'), file).toBe(false);
    }
    for (const file of commentFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source.includes('crm_portal_job_messages'), file).toBe(false);
      expect(importsOf(file).some((i) => i.includes('jobMessages') || i.includes('/portal/')), file).toBe(false);
    }
  });
});
